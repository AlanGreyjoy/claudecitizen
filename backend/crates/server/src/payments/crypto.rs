//! AES-256-GCM wrapping for payment-provider secrets stored in Postgres.
//!
//! The Server console lets an operator paste Stripe keys without a redeploy, so those keys land
//! in the database. A database dump on its own must not be enough to spend money: the ciphertext
//! is only useful together with `PAYMENTS_ENCRYPTION_KEY`, which never leaves the environment.
//!
//! Wire format is `nonce || ciphertext || tag`, with a fresh random 12-byte nonce per encryption.

use aes_gcm::{
    Aes256Gcm, Key, Nonce,
    aead::{Aead, KeyInit},
};
use anyhow::{Context, Result, anyhow, bail};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use rand::RngCore;

const NONCE_BYTES: usize = 12;
const KEY_BYTES: usize = 32;

/// Builds the AEAD cipher from the configured base64 key.
///
/// Returns `Ok(None)` when no key is configured, which callers surface as
/// "payments are not configured yet" rather than as an internal error.
fn cipher(encryption_key: &str) -> Result<Option<Aes256Gcm>> {
    if encryption_key.is_empty() {
        return Ok(None);
    }
    let raw = BASE64
        .decode(encryption_key)
        .context("PAYMENTS_ENCRYPTION_KEY must be base64")?;
    if raw.len() != KEY_BYTES {
        bail!("PAYMENTS_ENCRYPTION_KEY must decode to exactly {KEY_BYTES} bytes");
    }
    let key = Key::<Aes256Gcm>::from_slice(&raw);
    Ok(Some(Aes256Gcm::new(key)))
}

/// True when secrets can be wrapped, i.e. a usable key is configured.
pub fn is_configured(encryption_key: &str) -> bool {
    matches!(cipher(encryption_key), Ok(Some(_)))
}

/// Encrypts a provider secret for storage. The plaintext is never logged.
pub fn encrypt_secret(encryption_key: &str, plaintext: &str) -> Result<Vec<u8>> {
    let cipher = cipher(encryption_key)?
        .ok_or_else(|| anyhow!("PAYMENTS_ENCRYPTION_KEY is not configured"))?;
    let mut nonce_bytes = [0u8; NONCE_BYTES];
    rand::rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|_| anyhow!("failed to encrypt payment secret"))?;
    let mut stored = Vec::with_capacity(NONCE_BYTES + ciphertext.len());
    stored.extend_from_slice(&nonce_bytes);
    stored.extend_from_slice(&ciphertext);
    Ok(stored)
}

/// Decrypts a stored provider secret.
pub fn decrypt_secret(encryption_key: &str, stored: &[u8]) -> Result<String> {
    let cipher = cipher(encryption_key)?
        .ok_or_else(|| anyhow!("PAYMENTS_ENCRYPTION_KEY is not configured"))?;
    if stored.len() <= NONCE_BYTES {
        bail!("stored payment secret is malformed");
    }
    let (nonce_bytes, ciphertext) = stored.split_at(NONCE_BYTES);
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|_| anyhow!("failed to decrypt payment secret"))?;
    String::from_utf8(plaintext).context("decrypted payment secret is not valid UTF-8")
}

/// Last four characters of a secret, for the masked console preview.
pub fn last4(secret: &str) -> String {
    let chars: Vec<char> = secret.chars().collect();
    let start = chars.len().saturating_sub(4);
    chars[start..].iter().collect()
}
