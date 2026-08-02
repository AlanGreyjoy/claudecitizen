/**
 * Shared primitive readers for planet document parsing.
 *
 * Planet JSON is authored by hand and by the editor, so every field has to
 * survive missing keys, wrong types, and legacy names. These helpers keep that
 * normalization in one place instead of once per recipe module.
 */

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function readNumber(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

/** Reads a number and clamps it into an authoring-safe range. */
export function readClampedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, readNumber(value, fallback)));
}

export function readHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) return fallback;
  return trimmed.toLowerCase();
}

export function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}
