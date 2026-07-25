/**
 * Entertainment System (bunk mini-TV) — Google TV–style app launcher with
 * Docs, YouTube embeds, NASA TV (official YouTube live channel), and Local Now
 * (external tab — site blocks iframes).
 */

export const ES_DOCS_URL = "https://claudecitizen-docs.netlify.app/";

/** NASA Live — official NASA TV YouTube channel. */
export const ES_NASA_TV_CHANNEL_ID = "UCNwkvBoDag92nHiZBzbYicA";

export const ES_NASA_TV_EMBED_URL =
  `https://www.youtube-nocookie.com/embed/live_stream?channel=${ES_NASA_TV_CHANNEL_ID}&rel=0`;

/** Local Now — no public embed; opens in a new tab. */
export const ES_LOCALNOW_URL = "https://localnow.com/";

const FEATURED_VIDEOS: { id: string; title: string }[] = [
  { id: "aqz-KE-bpKQ", title: "Big Buck Bunny" },
  { id: "eRsGyueVLvQ", title: "Sintel" },
  { id: "YE7VzlLtp-4", title: "Big Buck Bunny (alt)" },
];

export type EsView = "home" | "docs" | "youtube" | "nasa" | "localnow";

export interface EntertainmentSystemElements {
  rootEl: HTMLElement;
  homeEl: HTMLElement;
  docsEl: HTMLElement;
  youtubeEl: HTMLElement;
  nasaEl: HTMLElement;
  localnowEl: HTMLElement;
  docsFrameEl: HTMLIFrameElement;
  youtubeFrameEl: HTMLIFrameElement;
  nasaFrameEl: HTMLIFrameElement;
  youtubeUrlInputEl: HTMLInputElement;
  youtubeGridEl: HTMLElement;
  powerBtnEl: HTMLButtonElement;
  backBtnEl: HTMLButtonElement;
  closeBtnEl: HTMLButtonElement;
  docsTileEl: HTMLButtonElement;
  youtubeTileEl: HTMLButtonElement;
  nasaTileEl: HTMLButtonElement;
  localnowTileEl: HTMLButtonElement;
  localnowOpenBtnEl: HTMLButtonElement;
  youtubeLoadBtnEl: HTMLButtonElement;
}

export interface EntertainmentSystemOpenOptions {
  /** Called when the player holds get-up (Y) while ES is open. */
  onExitBed?: () => void;
  /** Called when the panel closes (Esc / power / close / get-up). */
  onClose?: () => void;
}

function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`;
}

/** Extract a YouTube video id from a watch / youtu.be / embed URL or raw id. */
export function parseYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.replace(/^\//, "").slice(0, 11);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (url.hostname.includes("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const embed = url.pathname.match(/\/embed\/([\w-]{11})/);
      if (embed) return embed[1]!;
    }
  } catch {
    return null;
  }
  return null;
}

export function createEntertainmentSystem(elements: EntertainmentSystemElements) {
  let open = false;
  let view: EsView = "home";
  let onExitBed: (() => void) | null = null;
  let onClose: (() => void) | null = null;
  let yHeldSinceMs: number | null = null;

  function setView(next: EsView): void {
    view = next;
    const views: { el: HTMLElement; id: EsView }[] = [
      { el: elements.homeEl, id: "home" },
      { el: elements.docsEl, id: "docs" },
      { el: elements.youtubeEl, id: "youtube" },
      { el: elements.nasaEl, id: "nasa" },
      { el: elements.localnowEl, id: "localnow" },
    ];
    for (const { el, id } of views) {
      const on = id === next;
      el.hidden = !on;
      el.classList.toggle("is-es-active", on);
      // Stylesheet `display: flex` must not win over inactive views.
      el.style.setProperty("display", on ? "flex" : "none", "important");
      el.style.pointerEvents = on ? "auto" : "none";
    }
    elements.backBtnEl.hidden = next === "home";
    if (next === "docs" && !elements.docsFrameEl.src) {
      elements.docsFrameEl.src = ES_DOCS_URL;
    }
    if (next === "nasa" && !elements.nasaFrameEl.src) {
      elements.nasaFrameEl.src = ES_NASA_TV_EMBED_URL;
    }
  }

  function clearFrames(): void {
    elements.docsFrameEl.removeAttribute("src");
    elements.youtubeFrameEl.removeAttribute("src");
    elements.nasaFrameEl.removeAttribute("src");
  }

  function playVideo(videoId: string): void {
    elements.youtubeFrameEl.src = youtubeEmbedUrl(videoId);
  }

  function renderFeatured(): void {
    elements.youtubeGridEl.replaceChildren();
    for (const video of FEATURED_VIDEOS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sc-es-video-tile";
      btn.innerHTML = `<span class="sc-es-video-thumb" style="background-image:url(https://i.ytimg.com/vi/${video.id}/mqdefault.jpg)"></span><span class="sc-es-video-title">${video.title}</span>`;
      btn.addEventListener("click", () => playVideo(video.id));
      elements.youtubeGridEl.appendChild(btn);
    }
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    elements.rootEl.classList.toggle("is-open", open);
    elements.rootEl.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      document.exitPointerLock?.();
      setView("home");
      renderFeatured();
      elements.powerBtnEl.focus({ preventScroll: true });
      return;
    }
    clearFrames();
    view = "home";
    yHeldSinceMs = null;
    elements.powerBtnEl.blur();
    const closeCb = onClose;
    onExitBed = null;
    onClose = null;
    closeCb?.();
  }

  // pointerdown + delegation: CSS3D skewed hit-tests often miss click on
  // right-side tiles; bubbling from icon spans is more reliable.
  const onAppTile = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tile = target.closest<HTMLElement>("[data-es-app]");
    if (!tile) return;
    const app = tile.dataset.esApp;
    if (
      app === "docs" ||
      app === "youtube" ||
      app === "nasa" ||
      app === "localnow"
    ) {
      event.preventDefault();
      event.stopPropagation();
      setView(app);
    }
  };
  elements.homeEl.addEventListener("pointerdown", onAppTile);
  elements.docsTileEl.addEventListener("click", () => setView("docs"));
  elements.youtubeTileEl.addEventListener("click", () => setView("youtube"));
  elements.nasaTileEl.addEventListener("click", () => setView("nasa"));
  elements.localnowTileEl.addEventListener("click", () => setView("localnow"));
  elements.localnowOpenBtnEl.addEventListener("click", () => {
    window.open(ES_LOCALNOW_URL, "_blank", "noopener,noreferrer");
  });
  elements.backBtnEl.addEventListener("click", () => setView("home"));
  elements.closeBtnEl.addEventListener("click", () => setOpen(false));
  elements.powerBtnEl.addEventListener("click", () => setOpen(false));

  elements.youtubeLoadBtnEl.addEventListener("click", () => {
    const id = parseYoutubeVideoId(elements.youtubeUrlInputEl.value);
    if (!id) {
      elements.youtubeUrlInputEl.setCustomValidity(
        "Paste a YouTube URL or 11-character video id.",
      );
      elements.youtubeUrlInputEl.reportValidity();
      return;
    }
    elements.youtubeUrlInputEl.setCustomValidity("");
    playVideo(id);
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (view !== "home") {
        setView("home");
        return;
      }
      setOpen(false);
      return;
    }
    if (event.code === "KeyY") {
      if (yHeldSinceMs === null) yHeldSinceMs = performance.now();
      if (performance.now() - yHeldSinceMs >= 500) {
        event.preventDefault();
        event.stopPropagation();
        const cb = onExitBed;
        setOpen(false);
        cb?.();
      }
    }
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.code === "KeyY") yHeldSinceMs = null;
  };

  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("keyup", handleKeyUp, true);

  return {
    dispose() {
      elements.homeEl.removeEventListener("pointerdown", onAppTile);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    },
    isOpen() {
      return open;
    },
    isPaused() {
      return open;
    },
    close() {
      setOpen(false);
    },
    open(options: EntertainmentSystemOpenOptions = {}) {
      onExitBed = options.onExitBed ?? null;
      onClose = options.onClose ?? null;
      setOpen(true);
    },
  };
}

export type EntertainmentSystemController = ReturnType<
  typeof createEntertainmentSystem
>;
