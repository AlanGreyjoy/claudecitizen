//! The single chokepoint for every AsteronCredit balance mutation.
//!
//! ARC was mutated in place with no audit trail. Credits are bought with real money, so every
//! delta is written to `AsteronCreditLedger` in the same transaction that moves the balance, and
//! every caller supplies an idempotency key. Replaying a Stripe webhook is therefore a no-op
//! rather than free money.

use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};

/// Why a balance moved. Mirrors the `AsteronCreditLedger_reason_check` constraint.
#[derive(Clone, Copy, Debug)]
pub enum CreditReason {
    /// Fulfilled real-money purchase.
    Purchase,
    /// Operator granted credits by hand.
    Grant,
    /// Stripe refund reversed a purchase.
    Refund,
    /// Payment was disputed and clawed back.
    Chargeback,
    /// Player spent credits in the Item Mall.
    Spend,
    /// Credits awarded by gameplay.
    Award,
}

impl CreditReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Purchase => "purchase",
            Self::Grant => "grant",
            Self::Refund => "refund",
            Self::Chargeback => "chargeback",
            Self::Spend => "spend",
            Self::Award => "award",
        }
    }
}

/// Result of a ledger write.
#[derive(Clone, Copy, Debug)]
pub enum CreditOutcome {
    /// The delta was applied; carries the balance afterwards.
    Applied(i32),
    /// The idempotency key had already been consumed. Nothing changed.
    AlreadyApplied,
}

/// Applies a signed credit delta and records it, atomically within `tx`.
///
/// Negative deltas clamp the balance at zero: a refund or chargeback must never push a player
/// into debt, and the ledger still records the full requested delta alongside the real
/// `balanceAfter` so the discrepancy stays visible to an operator.
///
/// Returns [`CreditOutcome::AlreadyApplied`] when `idempotency_key` was already used.
pub async fn apply_credit_delta(
    tx: &mut Transaction<'_, Postgres>,
    player_id: &str,
    delta: i32,
    reason: CreditReason,
    reference: Option<(&str, &str)>,
    idempotency_key: &str,
) -> ApiResult<CreditOutcome> {
    let balance: i32 =
        sqlx::query(r#"SELECT "creditBalance" FROM "Player" WHERE "id" = $1 FOR UPDATE"#)
            .bind(player_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| ApiError::NotFound("Player not found.".to_owned()))?
            .try_get("creditBalance")?;

    let balance_after = balance.saturating_add(delta).max(0);
    let (ref_type, ref_id) = match reference {
        Some((ref_type, ref_id)) => (Some(ref_type), Some(ref_id)),
        None => (None, None),
    };

    // The unique index on "idempotencyKey" is what makes webhook replays safe.
    let inserted = sqlx::query(
        r#"INSERT INTO "AsteronCreditLedger"
           ("id", "playerId", "delta", "balanceAfter", "reason", "refType", "refId",
            "idempotencyKey", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT ("idempotencyKey") DO NOTHING"#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(player_id)
    .bind(delta)
    .bind(balance_after)
    .bind(reason.as_str())
    .bind(ref_type)
    .bind(ref_id)
    .bind(idempotency_key)
    .execute(&mut **tx)
    .await?;

    if inserted.rows_affected() == 0 {
        return Ok(CreditOutcome::AlreadyApplied);
    }

    sqlx::query(r#"UPDATE "Player" SET "creditBalance" = $2, "updatedAt" = NOW() WHERE "id" = $1"#)
        .bind(player_id)
        .bind(balance_after)
        .execute(&mut **tx)
        .await?;

    Ok(CreditOutcome::Applied(balance_after))
}

/// Reads a player's current credit balance outside a transaction.
pub async fn credit_balance(db: &sqlx::PgPool, player_id: &str) -> ApiResult<i32> {
    let balance: i32 =
        sqlx::query_scalar(r#"SELECT "creditBalance" FROM "Player" WHERE "id" = $1"#)
            .bind(player_id)
            .fetch_optional(db)
            .await?
            .ok_or_else(|| ApiError::NotFound("Player not found.".to_owned()))?;
    Ok(balance)
}
