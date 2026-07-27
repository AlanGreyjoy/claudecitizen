import type { CreditPack, MallListing } from '../../../player/mall/types';
import {
  creditPackBonusPercent,
  formatPackPrice,
  mallPurchaseBlockedReason,
} from '../../../player/mall/types';
import type { HaloBandMallCallbacks, HaloBandMallElements } from './haloband-types';

/**
 * Item Mall panel for the HaloBand.
 *
 * Two sections: the storefront (spend AsteronCredits) and the credit packs (buy credits with
 * real money). Buying credits leaves the game — the panel opens hosted Stripe Checkout
 * externally and then polls, because credits are granted by the Stripe webhook and never by a
 * client-side success signal.
 */

type MallView = {
  listings: MallListing[];
  packs: CreditPack[];
  creditBalance: number;
  checkoutEnabled: boolean;
};

const EMPTY_VIEW: MallView = {
  listings: [],
  packs: [],
  creditBalance: 0,
  checkoutEnabled: false,
};

/** How long to keep polling for webhook fulfillment after a checkout hand-off. */
const POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 3000;

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface HaloBandMall {
  /** Fetches storefront and pack data, then renders. Safe to call repeatedly. */
  refresh: () => void;
  /** Renders from cached data without a network round trip. */
  render: () => void;
  dispose: () => void;
}

export function createHaloBandMall(
  elements: HaloBandMallElements,
  callbacks: HaloBandMallCallbacks,
): HaloBandMall {
  let view: MallView = EMPTY_VIEW;
  let loading = false;
  let notice = '';
  let noticeIsError = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollsLeft = 0;
  let disposed = false;

  function setNotice(message: string, isError = false): void {
    notice = message;
    noticeIsError = isError;
    render();
  }

  function stopPolling(): void {
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
    pollsLeft = 0;
  }

  function pollForFulfillment(): void {
    if (disposed || pollsLeft <= 0) {
      if (pollsLeft <= 0 && !disposed) {
        setNotice(
          'Still waiting on Stripe. Credits appear automatically once payment clears — reopen the Mall to check.',
        );
      }
      stopPolling();
      return;
    }
    pollsLeft -= 1;
    void callbacks
      .fetchPurchases()
      .then((result) => {
        if (disposed) return;
        if (result.creditBalance > view.creditBalance) {
          view = { ...view, creditBalance: result.creditBalance };
          stopPolling();
          setNotice(`Credits added. Balance is now ${result.creditBalance.toLocaleString()} AC.`);
          return;
        }
        pollTimer = setTimeout(pollForFulfillment, POLL_INTERVAL_MS);
      })
      .catch(() => {
        if (disposed) return;
        pollTimer = setTimeout(pollForFulfillment, POLL_INTERVAL_MS);
      });
  }

  function refresh(): void {
    if (loading || disposed) return;
    loading = true;
    render();
    void callbacks
      .fetchMall()
      .then((next) => {
        if (disposed) return;
        view = next;
      })
      .catch((error: unknown) => {
        if (disposed) return;
        notice = error instanceof Error ? error.message : 'Could not reach the Item Mall.';
        noticeIsError = true;
      })
      .finally(() => {
        loading = false;
        if (!disposed) render();
      });
  }

  function buyListing(listing: MallListing): void {
    setNotice(`Purchasing ${listing.name}...`);
    void callbacks
      .purchaseListing(listing.id, 1)
      .then((creditBalance) => {
        if (disposed) return;
        view = { ...view, creditBalance };
        setNotice(`${listing.name} added to your inventory.`);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setNotice(error instanceof Error ? error.message : 'Purchase failed.', true);
      });
  }

  function buyPack(pack: CreditPack): void {
    setNotice(`Opening secure checkout for ${pack.name}...`);
    void callbacks
      .startCheckout(pack.id)
      .then((opened) => {
        if (disposed) return;
        if (!opened) {
          setNotice('Could not open the checkout page. Check your browser pop-up settings.', true);
          return;
        }
        setNotice('Complete the payment in your browser. Credits arrive here automatically.');
        stopPolling();
        pollsLeft = POLL_ATTEMPTS;
        pollTimer = setTimeout(pollForFulfillment, POLL_INTERVAL_MS);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setNotice(error instanceof Error ? error.message : 'Checkout is unavailable.', true);
      });
  }

  function renderListingCard(listing: MallListing): HTMLElement {
    const card = element('article', 'sc-haloband-mall-card');
    if (listing.featured) card.classList.add('is-featured');
    card.append(element('h4', 'sc-haloband-mall-card-title', listing.name));
    card.append(element('p', 'sc-haloband-mall-card-desc', listing.description));

    const footer = element('div', 'sc-haloband-mall-card-footer');
    footer.append(
      element('span', 'sc-haloband-mall-price', `${listing.priceCredits.toLocaleString()} AC`),
    );

    const owned = callbacks.getOwnedQuantity(listing.itemDefinitionId);
    const blocked = mallPurchaseBlockedReason(listing, view.creditBalance, owned);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sc-haloband-mall-buy';
    button.textContent = blocked ?? 'Buy';
    button.disabled = blocked !== null;
    if (blocked === null) button.addEventListener('click', () => buyListing(listing));
    footer.append(button);
    card.append(footer);

    if (listing.limitPerPlayer !== null) {
      card.append(
        element(
          'span',
          'sc-haloband-mall-note',
          `Owned ${owned} of ${listing.limitPerPlayer} max`,
        ),
      );
    }
    return card;
  }

  function renderPackCard(pack: CreditPack): HTMLElement {
    const card = element('article', 'sc-haloband-mall-pack');
    card.append(element('h4', 'sc-haloband-mall-card-title', pack.name));
    card.append(
      element('span', 'sc-haloband-mall-pack-credits', `${pack.totalCredits.toLocaleString()} AC`),
    );
    const bonus = creditPackBonusPercent(pack);
    if (bonus > 0) {
      card.append(element('span', 'sc-haloband-mall-pack-bonus', `+${bonus}% bonus`));
    }
    card.append(element('p', 'sc-haloband-mall-card-desc', pack.description));

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sc-haloband-mall-buy';
    button.textContent = formatPackPrice(pack);
    button.addEventListener('click', () => buyPack(pack));
    card.append(button);
    return card;
  }

  function render(): void {
    const { balanceEl, storeEl, packsEl, noticeEl } = elements;
    balanceEl.textContent = `${view.creditBalance.toLocaleString()} AC`;

    storeEl.replaceChildren();
    if (loading && view.listings.length === 0) {
      storeEl.append(element('p', 'sc-haloband-empty', 'Loading the Item Mall...'));
    } else if (view.listings.length === 0) {
      storeEl.append(element('p', 'sc-haloband-empty', 'Nothing is stocked right now.'));
    } else {
      for (const listing of view.listings) storeEl.append(renderListingCard(listing));
    }

    packsEl.replaceChildren();
    if (!view.checkoutEnabled) {
      // Checkout is off until an operator finishes Stripe setup; say so rather than
      // showing buttons that would fail.
      packsEl.append(
        element('p', 'sc-haloband-empty', 'Credit purchases are not available on this server.'),
      );
    } else if (view.packs.length === 0) {
      packsEl.append(element('p', 'sc-haloband-empty', 'No credit packs are on sale.'));
    } else {
      for (const pack of view.packs) packsEl.append(renderPackCard(pack));
    }

    noticeEl.textContent = notice;
    noticeEl.classList.toggle('is-error', noticeIsError);
    noticeEl.classList.toggle('is-hidden', notice === '');
  }

  return {
    refresh,
    render,
    dispose: () => {
      disposed = true;
      stopPolling();
    },
  };
}
