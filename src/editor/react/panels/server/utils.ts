import type { AdminScene, AdminTab } from './types';

export function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatArc(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toLocaleString()} ARC`;
}

export function formatCredits(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toLocaleString()} AC`;
}

export function formatMoney(cents: number, currency: string): string {
  const code = currency.toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(
      cents / 100,
    );
  } catch {
    // Intl throws on an unrecognised currency code, which an operator can easily type.
    return `${(cents / 100).toFixed(2)} ${code}`;
  }
}

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function truncateText(text: string, maxLen = 24): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

export function isTabActive(tab: AdminTab, currentTab: AdminTab, currentScene: AdminScene): boolean {
  return (
    currentTab === tab &&
    currentScene !== 'user-detail' &&
    currentScene !== 'ship-form' &&
    currentScene !== 'prop-form' &&
    currentScene !== 'item-form' &&
    currentScene !== 'weapon-form' &&
    currentScene !== 'backpack-form' &&
    currentScene !== 'wearable-form' &&
    currentScene !== 'credit-pack-form' &&
    currentScene !== 'mall-form'
  );
}
