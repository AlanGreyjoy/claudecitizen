use anyhow::Context;
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor, message::Mailbox,
    transport::smtp::authentication::Credentials,
};

use crate::config::Config;

pub async fn send_password_reset(
    config: &Config,
    recipient: &str,
    reset_url: &str,
) -> anyhow::Result<()> {
    if config.smtp_host.is_empty() {
        tracing::warn!(
            recipient,
            "SMTP is not configured; password reset email was not sent"
        );
        return Ok(());
    }
    let message = Message::builder()
        .from(config.smtp_from.parse::<Mailbox>().context("invalid SMTP_FROM")?)
        .to(recipient.parse::<Mailbox>().context("invalid reset recipient")?)
        .subject("Reset your ClaudeCitizen password")
        .body(format!(
            "A password reset was requested for your ClaudeCitizen account.\n\n{reset_url}\n\nThis link expires in 30 minutes."
        ))?;
    let mut builder = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.smtp_host)?
        .port(config.smtp_port);
    if !config.smtp_user.is_empty() {
        builder = builder.credentials(Credentials::new(
            config.smtp_user.clone(),
            config.smtp_pass.clone(),
        ));
    }
    builder.build().send(message).await?;
    Ok(())
}
