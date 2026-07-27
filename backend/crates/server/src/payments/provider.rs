//! Resolves the effective Stripe configuration.
//!
//! Two sources, deliberately: environment variables for containerized deploys that manage
//! secrets externally, and the `PaymentProvider` table for solo operators who configure Stripe
//! from the Server console without a redeploy. **Environment always wins** so an ops-managed
//! secret can never be silently overridden from the UI.

use sqlx::Row;

use crate::{
    error::{ApiError, ApiResult},
    payments::crypto,
    state::AppState,
};

/// Where a resolved secret came from, so the console can explain itself to the operator.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SecretSource {
    Environment,
    Console,
    Unset,
}

/// The stored provider row plus whatever the environment overrides.
#[derive(Clone, Debug)]
pub struct StripeConfig {
    pub mode: String,
    pub secret_key: Option<String>,
    pub secret_key_source: SecretSource,
    pub secret_key_last4: Option<String>,
    pub webhook_secret: Option<String>,
    pub webhook_secret_source: SecretSource,
    pub success_url: String,
    pub cancel_url: String,
}

impl StripeConfig {
    /// Checkout can only be offered when a secret key is available.
    pub fn is_checkout_ready(&self) -> bool {
        self.secret_key.is_some()
    }

    /// Secret key or a 503, so handlers do not each repeat the message.
    pub fn require_secret_key(&self) -> ApiResult<&str> {
        self.secret_key.as_deref().ok_or(ApiError::Unavailable)
    }
}

/// Loads the singleton `PaymentProvider` row and layers environment overrides on top.
pub async fn load_stripe_config(state: &AppState) -> ApiResult<StripeConfig> {
    let row = sqlx::query(
        r#"SELECT "mode", "secretKeyCiphertext", "secretKeyLast4", "webhookSecretCiphertext",
                  "successUrl", "cancelUrl"
           FROM "PaymentProvider" WHERE "id" = 'stripe'"#,
    )
    .fetch_optional(&state.db)
    .await?;

    let encryption_key = state.config.payments_encryption_key.as_str();
    let mut mode = "test".to_owned();
    let mut stored_secret: Option<String> = None;
    let mut stored_last4: Option<String> = None;
    let mut stored_webhook: Option<String> = None;
    let mut success_url = String::new();
    let mut cancel_url = String::new();

    if let Some(row) = row {
        mode = row.try_get("mode")?;
        success_url = row.try_get("successUrl")?;
        cancel_url = row.try_get("cancelUrl")?;
        stored_last4 = row.try_get("secretKeyLast4")?;
        // A stored secret we cannot unwrap (rotated or missing key) is treated as absent rather
        // than as a hard error, so the console stays reachable and can re-save the key.
        stored_secret = decrypt_optional(encryption_key, row.try_get("secretKeyCiphertext")?);
        stored_webhook = decrypt_optional(encryption_key, row.try_get("webhookSecretCiphertext")?);
    }

    let (secret_key, secret_key_source) = match state.config.stripe_secret_key.clone() {
        Some(env_secret) => (Some(env_secret), SecretSource::Environment),
        None => match stored_secret {
            Some(secret) => (Some(secret), SecretSource::Console),
            None => (None, SecretSource::Unset),
        },
    };
    let (webhook_secret, webhook_secret_source) = match state.config.stripe_webhook_secret.clone() {
        Some(env_secret) => (Some(env_secret), SecretSource::Environment),
        None => match stored_webhook {
            Some(secret) => (Some(secret), SecretSource::Console),
            None => (None, SecretSource::Unset),
        },
    };

    let secret_key_last4 = match secret_key_source {
        SecretSource::Environment => secret_key.as_deref().map(crypto::last4),
        SecretSource::Console => stored_last4,
        SecretSource::Unset => None,
    };

    Ok(StripeConfig {
        mode,
        secret_key,
        secret_key_source,
        secret_key_last4,
        webhook_secret,
        webhook_secret_source,
        success_url,
        cancel_url,
    })
}

fn decrypt_optional(encryption_key: &str, ciphertext: Option<Vec<u8>>) -> Option<String> {
    let ciphertext = ciphertext?;
    match crypto::decrypt_secret(encryption_key, &ciphertext) {
        Ok(secret) => Some(secret),
        Err(error) => {
            tracing::warn!(?error, "stored Stripe secret could not be decrypted");
            None
        }
    }
}

/// Public URL Stripe should post webhooks to, shown in the console for copy-paste.
pub fn webhook_url(state: &AppState) -> String {
    format!(
        "{}/payments/stripe/webhook",
        state.config.api_public_url.trim_end_matches('/')
    )
}
