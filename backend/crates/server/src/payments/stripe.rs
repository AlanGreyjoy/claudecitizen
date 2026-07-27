//! Minimal Stripe REST client.
//!
//! Only two operations are needed — create a Checkout Session and verify a webhook signature —
//! so this talks to the REST API directly with `reqwest` rather than pulling in a full SDK.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, anyhow};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use subtle::ConstantTimeEq;

const STRIPE_API_BASE: &str = "https://api.stripe.com/v1";
/// Outbound calls happen inside a request handler, so they must not hang it indefinitely.
const STRIPE_TIMEOUT: Duration = Duration::from_secs(15);
/// Stripe's own recommended replay window for webhook timestamps.
const SIGNATURE_TOLERANCE_SECS: u64 = 300;

type HmacSha256 = Hmac<Sha256>;

/// What we need back from a created Checkout Session.
#[derive(Debug, Deserialize)]
pub struct CheckoutSession {
    pub id: String,
    pub url: Option<String>,
}

/// Everything the checkout handler wants to put on a session.
pub struct CheckoutRequest<'a> {
    pub secret_key: &'a str,
    pub success_url: &'a str,
    pub cancel_url: &'a str,
    pub client_reference_id: &'a str,
    pub purchase_id: &'a str,
    pub pack_id: &'a str,
    pub pack_name: &'a str,
    pub currency: &'a str,
    pub price_cents: i32,
    /// Pre-made Stripe Price, when the operator configured one. Otherwise an inline price.
    pub stripe_price_id: Option<&'a str>,
}

/// Creates a hosted Checkout Session and returns its id and redirect URL.
pub async fn create_checkout_session(request: CheckoutRequest<'_>) -> Result<CheckoutSession> {
    let mut form: Vec<(String, String)> = vec![
        ("mode".into(), "payment".into()),
        ("success_url".into(), request.success_url.to_owned()),
        ("cancel_url".into(), request.cancel_url.to_owned()),
        (
            "client_reference_id".into(),
            request.client_reference_id.to_owned(),
        ),
        (
            "metadata[purchaseId]".into(),
            request.purchase_id.to_owned(),
        ),
        ("metadata[packId]".into(), request.pack_id.to_owned()),
        (
            "metadata[playerId]".into(),
            request.client_reference_id.to_owned(),
        ),
        ("line_items[0][quantity]".into(), "1".into()),
    ];

    match request.stripe_price_id {
        Some(price_id) if !price_id.is_empty() => {
            form.push(("line_items[0][price]".into(), price_id.to_owned()));
        }
        _ => {
            form.push((
                "line_items[0][price_data][currency]".into(),
                request.currency.to_owned(),
            ));
            form.push((
                "line_items[0][price_data][unit_amount]".into(),
                request.price_cents.to_string(),
            ));
            form.push((
                "line_items[0][price_data][product_data][name]".into(),
                request.pack_name.to_owned(),
            ));
        }
    }

    let client = reqwest::Client::builder()
        .timeout(STRIPE_TIMEOUT)
        .build()
        .context("build Stripe HTTP client")?;
    let response = client
        .post(format!("{STRIPE_API_BASE}/checkout/sessions"))
        .bearer_auth(request.secret_key)
        // Stripe deduplicates on this key, so a retried request cannot double-charge.
        .header("Idempotency-Key", request.purchase_id)
        .form(&form)
        .send()
        .await
        .context("call Stripe checkout API")?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        // Stripe error bodies can echo request detail, so keep them in logs only.
        return Err(anyhow!(
            "Stripe checkout failed with status {status}: {body}"
        ));
    }
    serde_json::from_str(&body).context("parse Stripe checkout session")
}

/// Verifies a `Stripe-Signature` header against the raw request body.
///
/// Rejects on a malformed header, a timestamp outside the tolerance window, or no matching
/// signature. Comparison is constant-time. Callers must not parse the body before this passes.
pub fn verify_webhook_signature(
    payload: &[u8],
    signature_header: &str,
    webhook_secret: &str,
) -> Result<()> {
    let mut timestamp: Option<u64> = None;
    let mut signatures: Vec<&str> = Vec::new();
    for part in signature_header.split(',') {
        let Some((key, value)) = part.trim().split_once('=') else {
            continue;
        };
        match key {
            "t" => timestamp = value.parse().ok(),
            "v1" => signatures.push(value),
            _ => {}
        }
    }

    let timestamp = timestamp.ok_or_else(|| anyhow!("Stripe signature is missing a timestamp"))?;
    if signatures.is_empty() {
        return Err(anyhow!("Stripe signature is missing a v1 entry"));
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("read system clock")?
        .as_secs();
    let skew = now.abs_diff(timestamp);
    if skew > SIGNATURE_TOLERANCE_SECS {
        return Err(anyhow!("Stripe signature timestamp is outside tolerance"));
    }

    let mut mac = HmacSha256::new_from_slice(webhook_secret.as_bytes())
        .map_err(|_| anyhow!("Stripe webhook secret is unusable"))?;
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(payload);
    let expected = mac.finalize().into_bytes();

    let matched = signatures.iter().any(|candidate| {
        hex::decode(candidate)
            .map(|bytes| bytes.ct_eq(expected.as_slice()).into())
            .unwrap_or(false)
    });
    if !matched {
        return Err(anyhow!("Stripe signature did not match"));
    }
    Ok(())
}
