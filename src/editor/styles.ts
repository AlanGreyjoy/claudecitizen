/** Injects the editor stylesheet once (dedicated editor renderer chunk only). */

const EDITOR_CSS = `
/*
 * AsteronEngine editor theme. Two tones carry the whole shell: --ed-chrome for
 * frames (toolbar, panel headers, tab strips, splitters) and --ed-surface for
 * panel bodies. Everything else is a step off those two. Editor rules use only
 * --ed-* tokens so play-mode game HUD styles keep the sc-ui palette.
 */
:root {
  --ed-window: #141a21;
  --ed-chrome: #232b36;
  --ed-chrome-hi: #2d3742;
  --ed-surface: #192028;
  --ed-raised: #1e262f;
  --ed-inset: #151b21;
  --ed-input: #11161c;
  --ed-popover: #262f3a;
  --ed-viewport: #10161d;
  --ed-btn: #2c3541;
  --ed-btn-hover: #37424f;
  --ed-line: #0f141a;
  --ed-line-soft: rgba(255, 255, 255, 0.07);
  --ed-text: #d7dce4;
  --ed-text-strong: #f1f4f8;
  --ed-muted: #7f8a99;
  --ed-focus: #4d84c0;
  --ed-select: rgba(77, 132, 192, 0.32);
  --ed-warn: #ffb861;
  --ed-danger: #ff8b8b;
  --ed-font: var(--sc-font);
  --ed-mono: var(--sc-mono);
}

#editor-root {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--ed-window);
  color: var(--ed-text);
  font: 13px/1.35 var(--ed-font);
  user-select: none;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) rgba(255, 255, 255, 0.04);
}

#editor-root * {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) rgba(255, 255, 255, 0.04);
}

#editor-root ::-webkit-scrollbar {
  width: 7px;
  height: 7px;
}

#editor-root ::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.03);
}

#editor-root ::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  background-clip: padding-box;
}

#editor-root ::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
  background-clip: padding-box;
}

#editor-root ::-webkit-scrollbar-thumb:active {
  background: var(--ed-focus);
  background-clip: padding-box;
}

#editor-root ::-webkit-scrollbar-corner {
  background: transparent;
}

.ed-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 0 8px;
  border-bottom: 1px solid var(--ed-line);
  background: var(--ed-chrome);
  white-space: nowrap;
  user-select: none;
}

.ed-toolbar-left,
.ed-toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ed-toolbar-left {
  justify-self: start;
}

.ed-toolbar-center {
  display: flex;
  align-items: center;
  justify-content: center;
  justify-self: center;
}

.ed-toolbar-right {
  justify-content: flex-end;
  justify-self: end;
}

.ed-toolbar-group {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 8px;
  margin-right: 2px;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
}

.ed-toolbar-group:last-child {
  border-right: none;
  margin-right: 0;
  padding-right: 0;
}

.ed-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--ed-text);
  cursor: pointer;
}

.ed-tool-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--ed-text-strong);
}

.ed-tool-btn.is-active {
  background: var(--ed-chrome-hi);
  color: #ffffff;
}

.ed-tool-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.ed-tool-chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--ed-text);
  font: 600 11px/1 var(--ed-font);
  letter-spacing: 0.04em;
  cursor: pointer;
}

.ed-tool-chip:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--ed-text-strong);
}

.ed-tool-chip.is-active {
  background: var(--ed-chrome-hi);
  color: #ffffff;
}

.ed-toolbar-playback {
  display: flex;
  align-items: center;
  gap: 2px;
}

/*
 * Game view (Play mode). The transform makes this element the containing block
 * for the HUD's position: fixed descendants, so in-play chrome stays inside the
 * Game region instead of covering the editor toolbar.
 */
#editor-play-host {
  position: fixed;
  inset: 37px 0 0 0;
  z-index: 40;
  overflow: hidden;
  background: var(--ed-viewport);
  transform: translateZ(0);
}

#editor-play-host.is-paused::after {
  content: 'Paused';
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 999;
  padding: 6px 16px;
  border: 1px solid rgba(255, 206, 111, 0.5);
  background: rgba(24, 31, 39, 0.94);
  color: #ffce6f;
  font: 600 12px/1 'Rajdhani', sans-serif;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  pointer-events: none;
}

#editor-root.is-playing .ed-main,
#editor-root.is-playing .ed-project-panel,
#editor-root.is-playing .ed-splitter {
  visibility: hidden;
}

.ed-user-menu {
  position: relative;
}

.ed-user-menu .ed-menu-dropdown {
  display: block;
  top: calc(100% + 4px);
  right: 0;
  left: auto;
  min-width: 200px;
}

.ed-browse-overlay {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 72px;
  background: rgba(0, 0, 0, 0.45);
}

.ed-browse-dialog {
  width: min(420px, calc(100vw - 32px));
  border: 1px solid var(--ed-line);
  border-radius: 4px;
  background: var(--ed-popover);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.ed-browse-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--ed-line-soft);
  color: var(--ed-text);
  font: 700 11px/1 var(--ed-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ed-menubar {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
}

.ed-menu {
  position: relative;
}

.ed-menu-trigger {
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--ed-text);
  font: 500 12px/1 var(--ed-font);
  letter-spacing: 0.04em;
  padding: 6px 10px;
  cursor: pointer;
}

.ed-menu-trigger:hover,
.ed-menu.is-open > .ed-menu-trigger {
  background: rgba(255, 255, 255, 0.08);
  color: var(--ed-text-strong);
}

.ed-menu-dropdown {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 50;
  min-width: 200px;
  padding: 4px 0;
  border: 1px solid var(--ed-line);
  background: var(--ed-popover);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.ed-menu.is-open > .ed-menu-dropdown {
  display: block;
}

.ed-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--ed-text);
  font: 500 12px/1.2 var(--ed-font);
  padding: 6px 12px;
  cursor: pointer;
  text-align: left;
}

.ed-menu-item:hover:not(:disabled) {
  background: var(--ed-focus);
  color: #ffffff;
}

.ed-menu-item:disabled {
  opacity: 0.55;
  cursor: default;
}

.ed-menu-item.is-accent:not(:disabled) {
  color: var(--ed-warn);
}

.ed-menu-item-label {
  flex: 1;
}

.ed-menu-item-shortcut {
  font: 500 10px/1 var(--ed-mono);
  color: var(--ed-muted);
  letter-spacing: 0.02em;
}

.ed-menu-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--ed-line-soft);
}

.ed-context-menu {
  display: block;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 500;
  min-width: 180px;
}

.ed-menu-heading {
  padding: 4px 12px 2px;
  font: 700 9px/1 var(--ed-font);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ed-muted);
}

.ed-menu-submenu {
  position: relative;
}

.ed-menu-flyout {
  display: none;
  top: -4px;
  left: 100%;
}

.ed-menu-submenu.is-open > .ed-menu-flyout {
  display: block;
}

.ed-open-flyout {
  min-width: 260px;
  padding: 0;
}

.ed-open-search-wrap {
  padding: 6px 8px 4px;
}

.ed-open-search {
  width: 100%;
  padding: 5px 8px;
  font-size: 11px;
}

.ed-open-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  border-bottom: 1px solid var(--ed-line-soft);
  background: var(--ed-chrome);
}

.ed-open-tabs.is-hidden {
  display: none;
}

.ed-open-tab {
  border: none;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  background: transparent;
  color: var(--ed-muted);
  font: 700 9px/1 var(--ed-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 5px 8px;
  cursor: pointer;
}

.ed-open-tab:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--ed-text);
}

.ed-open-tab.is-active {
  background: var(--ed-chrome-hi);
  color: var(--ed-text-strong);
}

.ed-open-list {
  max-height: 220px;
  overflow-y: auto;
  padding: 4px 0;
}

.ed-open-empty {
  padding: 10px 12px;
  color: var(--ed-muted);
  font: 500 11px/1.4 var(--ed-font);
}

.ed-open-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.ed-open-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--ed-text);
  padding: 7px 12px;
  cursor: pointer;
  text-align: left;
}

.ed-open-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.ed-open-item-name {
  font: 600 12px/1.2 var(--ed-font);
}

.ed-open-item-id {
  font: 500 10px/1.2 var(--ed-mono);
  color: var(--ed-muted);
}

.ed-move-to-panel {
  width: 320px;
  max-width: min(320px, calc(100vw - 24px));
}

.ed-move-to-panel .ed-menu-item {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ed-btn {
  border: 1px solid var(--ed-line);
  border-radius: 3px;
  background: var(--ed-btn);
  color: var(--ed-text);
  font: 600 12px/1 var(--ed-font);
  letter-spacing: 0.06em;
  padding: 7px 10px;
  cursor: pointer;
}

.ed-btn:hover {
  background: var(--ed-btn-hover);
  color: var(--ed-text-strong);
}

.ed-btn.is-active {
  background: var(--ed-focus);
  border-color: var(--ed-line);
  color: #ffffff;
}

.ed-btn.ed-btn-accent {
  border-color: rgba(255, 206, 111, 0.5);
  color: var(--ed-warn);
  background: rgba(255, 206, 111, 0.07);
}

.ed-btn.ed-btn-accent:hover {
  background: rgba(255, 206, 111, 0.16);
}

.ed-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.ed-bulk-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.ed-label {
  font: 600 10px/1 var(--ed-font);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ed-muted);
}

.ed-input,
.ed-select {
  border: 1px solid var(--ed-line);
  border-radius: 2px;
  background: var(--ed-input);
  color: var(--ed-text);
  font: 500 12px/1.2 var(--ed-mono);
  padding: 6px 8px;
  outline: none;
  min-width: 0;
}

.ed-input:focus,
.ed-select:focus {
  border-color: var(--ed-focus);
}

.ed-input-narrow {
  width: 64px;
}

.ed-main {
  display: grid;
  grid-template-columns:
    var(--ed-hierarchy-width, 264px)
    4px
    minmax(0, 1fr)
    4px
    var(--ed-inspector-width, 320px);
  grid-template-rows:
    minmax(0, 1fr)
    4px
    var(--ed-project-height, 240px);
  min-height: 0;
}

.ed-hierarchy-panel {
  grid-column: 1;
  grid-row: 1;
}

.ed-hierarchy-splitter {
  grid-column: 2;
  grid-row: 1;
}

.ed-scene-shell {
  grid-column: 3;
  grid-row: 1;
}

.ed-inspector-splitter {
  grid-column: 4;
  grid-row: 1 / -1;
}

.ed-inspector-panel {
  grid-column: 5;
  grid-row: 1 / -1;
}

.ed-project-splitter {
  grid-column: 1 / 4;
  grid-row: 2;
}

/* Bottom Project|Console dock spans under hierarchy + scene (not inspector). */
.ed-bottom-dock {
  grid-column: 1 / 4;
  grid-row: 3;
  display: grid;
  grid-template-columns:
    var(--ed-project-side-width, 264px)
    4px
    minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  border-top: 1px solid var(--ed-line);
  background: var(--ed-surface);
}

.ed-bottom-dock.is-console {
  grid-template-columns: minmax(0, 1fr);
}

.ed-bottom-dock.is-console .ed-project-side-splitter,
.ed-bottom-dock.is-console .ed-asset-browser {
  display: none;
}

.ed-bottom-left {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--ed-line);
}

.ed-bottom-dock.is-console .ed-bottom-left {
  border-right: none;
}

.ed-project-side-splitter {
  min-width: 0;
}

.ed-asset-browser {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  width: 100%;
}

.ed-splitter {
  position: relative;
  z-index: 2;
  background: var(--ed-chrome);
  touch-action: none;
}

.ed-splitter-col {
  cursor: col-resize;
  margin: 0 -1px;
}

.ed-splitter-row {
  cursor: row-resize;
  margin: -1px 0;
  border-top: 1px solid var(--ed-line);
}

.ed-splitter:hover,
.ed-splitter.is-dragging {
  background: var(--ed-focus);
}

body.ed-resize-active {
  user-select: none;
}

body.ed-resize-col,
body.ed-resize-col * {
  cursor: col-resize !important;
}

body.ed-resize-row,
body.ed-resize-row * {
  cursor: row-resize !important;
}

.ed-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border-right: 1px solid var(--ed-line);
  background: var(--ed-surface);
}

.ed-inspector-panel.ed-panel {
  border-right: none;
  border-left: 1px solid var(--ed-line);
}

.ed-panel-title {
  padding: 6px 10px;
  border-bottom: 1px solid var(--ed-line);
  background: var(--ed-chrome);
  font: 700 11px/1 var(--ed-font);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ed-text-strong);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: nowrap;
  min-height: 0;
}

.ed-panel-title-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.ed-panel-title .ed-toolbar-group {
  padding-right: 0;
  border-right: none;
}

.ed-panel-title .ed-btn {
  padding: 3px 7px;
  font-size: 11px;
}

.ed-panel-title .ed-hierarchy-filter-select {
  max-width: 132px;
  padding: 2px 4px;
  font: 600 10px/1.2 var(--ed-font);
  letter-spacing: 0.04em;
}

.ed-panel-body {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.ed-scene-shell {
  display: grid;
  grid-template-rows: 30px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  background: var(--ed-viewport);
}

.ed-scene-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 4px 4px 0;
  border-bottom: 1px solid var(--ed-line);
  background: var(--ed-chrome);
}

/* Dock tabs read as plates of the panel body sitting on the chrome strip. */
.ed-scene-tab {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  border: none;
  border-radius: 3px 3px 0 0;
  background: transparent;
  color: var(--ed-muted);
  font: 700 10px/1 var(--ed-font);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 0 14px;
  cursor: pointer;
}

.ed-scene-tab:hover {
  background: var(--ed-chrome-hi);
  color: var(--ed-text);
}

.ed-scene-tab.is-active {
  background: var(--ed-surface);
  color: var(--ed-text-strong);
}

.ed-scene-body {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.ed-scene-body > .ed-viewport,
.ed-scene-body > .ed-material-manager,
.ed-scene-body > .ed-base-characters,
.ed-scene-body > .ed-planet-authoring-host,
.ed-scene-body > .ed-system-map-host,
.ed-scene-body > .ed-menu-manager-host,
.ed-scene-body > .ed-server-console-host {
  position: absolute;
  inset: 0;
}

/* System Map / Menu Manager / Server hide Project + Console + asset browser. */
#editor-root.is-system-map .ed-main,
#editor-root.is-menu-manager .ed-main,
#editor-root.is-server .ed-main {
  grid-template-rows: minmax(0, 1fr);
}

#editor-root.is-system-map .ed-project-splitter,
#editor-root.is-system-map .ed-bottom-dock,
#editor-root.is-menu-manager .ed-project-splitter,
#editor-root.is-menu-manager .ed-bottom-dock,
#editor-root.is-server .ed-project-splitter,
#editor-root.is-server .ed-bottom-dock {
  display: none;
}

/* Server console owns the whole workspace: no hierarchy, no inspector. */
#editor-root.is-server .ed-main {
  grid-template-columns: minmax(0, 1fr);
}

#editor-root.is-server .ed-hierarchy-panel,
#editor-root.is-server .ed-hierarchy-splitter,
#editor-root.is-server .ed-inspector-panel,
#editor-root.is-server .ed-inspector-splitter {
  display: none;
}

.ed-server-console-host {
  overflow: auto;
  background: var(--ed-viewport);
}

/* The ported operator console styles assume a full-viewport shell. */
.ed-server-console-host .sc-admin-screen {
  position: static;
  inset: auto;
  min-height: 100%;
}

/* Left-only tab editors: keep hierarchy chrome, drop empty inspector column. */
#editor-root.is-planet-authoring .ed-main,
#editor-root.is-system-map .ed-main,
#editor-root.is-menu-manager .ed-main {
  grid-template-columns:
    var(--ed-hierarchy-width, 264px)
    4px
    minmax(0, 1fr);
}

#editor-root.is-planet-authoring .ed-inspector-panel,
#editor-root.is-planet-authoring .ed-inspector-splitter,
#editor-root.is-system-map .ed-inspector-panel,
#editor-root.is-system-map .ed-inspector-splitter,
#editor-root.is-menu-manager .ed-inspector-panel,
#editor-root.is-menu-manager .ed-inspector-splitter {
  display: none;
}

.ed-planet-authoring-host,
.ed-system-map-host,
.ed-menu-manager-host {
  background: var(--ed-viewport);
}

.ed-hierarchy-panel > .ed-planet-sidebar,
.ed-hierarchy-panel > .ed-system-sidebar,
.ed-hierarchy-panel > .ed-menu-manager-sidebar {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border-right: none;
}

.ed-planet-sidebar {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  background: var(--ed-surface);
}







.ed-scene-settings-heading {
  color: var(--ed-text-strong);
  font: 700 17px/1.2 var(--ed-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ed-scene-settings-copy {
  max-width: 620px;
  margin: 8px 0 22px;
  color: var(--ed-muted);
}

.ed-scene-settings-form {
  display: grid;
  gap: 14px;
}

.ed-scene-settings-field {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 6px 14px;
  align-items: center;
}

.ed-scene-settings-label {
  color: var(--ed-muted);
  font: 700 10px/1.2 var(--ed-font);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.ed-scene-settings-detail {
  grid-column: 2;
  color: var(--ed-muted);
  font: 500 10px/1.35 var(--ed-font);
}

.ed-scene-settings-note {
  border-left: 2px solid rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.04);
  color: var(--ed-muted);
  padding: 12px 14px;
}

.ed-planet-form {
  display: grid;
  gap: 8px;
}

.ed-planet-section {
  display: grid;
  gap: 6px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ed-planet-section:last-child {
  border-bottom: none;
}

.ed-planet-section-title {
  margin: 0;
  color: var(--ed-muted);
  font: 700 13px/1.3 var(--ed-font);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 28px;
  padding: 4px 0;
}

.ed-planet-section-body {
  display: grid;
  gap: 6px;
}

.ed-planet-section.is-collapsed .ed-planet-section-body {
  display: none;
}

.ed-planet-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px;
  gap: 8px;
  align-items: center;
  color: var(--ed-muted);
  font: 600 11px/1.2 var(--ed-font);
}

.ed-planet-field-wide {
  grid-template-columns: minmax(0, 1fr);
}

.ed-planet-field-check {
  grid-template-columns: minmax(0, 1fr) auto;
}

.ed-planet-checkbox {
  width: 16px;
  height: 16px;
}

.ed-planet-drop-input.is-drop-target {
  outline: 1px solid var(--ed-text-strong);
  background: rgba(255, 255, 255, 0.08);
}

.ed-planet-spawn-layer {
  display: grid;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--ed-line-soft);
  border-radius: 4px;
  background: var(--ed-raised);
}

.ed-planet-veg-assets {
  display: grid;
  gap: 6px;
}

.ed-planet-veg-asset-row {
  display: grid;
  gap: 6px;
}

.ed-planet-spawn-layer-title {
  color: var(--ed-text-strong);
  font: 700 11px/1.2 var(--ed-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ed-planet-biome-row {
  display: grid;
  gap: 6px;
}

.ed-planet-biome-label {
  color: var(--ed-muted);
  font: 600 11px/1.2 var(--ed-font);
}

.ed-planet-biome-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.ed-planet-biome-chip {
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: var(--ed-muted);
  font: 600 10px/1 var(--ed-font);
  padding: 4px 6px;
  cursor: pointer;
  text-transform: lowercase;
}

.ed-planet-biome-chip.is-active {
  border-color: var(--ed-focus);
  color: var(--ed-text-strong);
  background: rgba(255, 255, 255, 0.08);
}

.ed-planet-remove-layer {
  justify-self: start;
  margin-top: 4px;
}

.ed-spawn-catalog-warning {
  padding: 8px 10px;
  border: 1px solid rgba(255, 180, 72, 0.45);
  border-radius: 4px;
  background: rgba(80, 48, 8, 0.55);
  color: #ffd59a;
  font: 600 11px/1.4 var(--ed-font);
}

.ed-planet-color {
  padding: 0;
  min-height: 28px;
}

.ed-planet-status {
  margin-bottom: 8px;
  color: var(--ed-text-strong);
  font: 600 12px/1.3 var(--ed-font);
}

.ed-planet-status.is-error {
  color: var(--ed-danger);
}

.ed-planet-preview {
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
  background: var(--ed-viewport);
}

.ed-planet-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.ed-planet-preview-hint {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 2;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  background: rgba(24, 31, 39, 0.9);
  color: var(--ed-muted);
  font: 600 11px/1.3 var(--ed-font);
  letter-spacing: 0.04em;
  pointer-events: none;
}

.ed-planet-diagnostics {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 3;
  display: grid;
  gap: 8px;
  width: min(380px, calc(100% - 24px));
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 5px;
  background: rgba(24, 31, 39, 0.94);
  box-shadow: 0 10px 30px var(--ed-input);
  color: var(--ed-muted);
  font: 600 11px/1.3 var(--ed-font);
}

.ed-planet-diagnostics-title {
  color: var(--ed-text);
  font: 700 13px/1.2 var(--ed-font);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.ed-planet-diagnostics-note {
  color: var(--ed-muted);
  font-weight: 500;
}

.ed-planet-destination-chips,
.ed-planet-diagnostic-actions,
.ed-planet-variant-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}

.ed-planet-destination-chip {
  padding: 4px 7px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  background: var(--ed-raised);
  color: var(--ed-muted);
  font: 700 10px/1.2 var(--ed-font);
  text-transform: uppercase;
  cursor: pointer;
}

.ed-planet-destination-chip:hover,
.ed-planet-destination-chip.is-active {
  border-color: var(--ed-focus);
  background: var(--ed-select);
  color: var(--ed-text-strong);
}

.ed-planet-destination-chip.is-missing:not(.is-active) {
  border-style: dashed;
  opacity: 0.5;
}

.ed-planet-variant-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.ed-planet-variant-label {
  overflow: hidden;
  color: var(--ed-text);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ed-planet-metrics {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 12px;
  padding: 7px;
  border-radius: 3px;
  background: var(--ed-inset);
}

.ed-planet-metrics strong {
  color: var(--ed-text);
  font-weight: 700;
  text-align: right;
}

.ed-planet-metric-label {
  color: var(--ed-muted);
}

.ed-planet-diagnostic-actions .ed-btn:last-child {
  margin-left: auto;
}

.ed-system-sidebar {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  background: var(--ed-surface);
}

.ed-system-form {
  display: grid;
  gap: 8px;
}

.ed-system-section {
  display: grid;
  gap: 6px;
}

.ed-system-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 130px;
  gap: 8px;
  align-items: center;
  color: var(--ed-muted);
  font: 600 11px/1.2 var(--ed-font);
}

.ed-system-status {
  margin-bottom: 8px;
  color: var(--ed-text-strong);
  font: 600 12px/1.3 var(--ed-font);
}

.ed-system-status.is-error {
  color: var(--ed-danger);
}

.ed-system-list-row {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border: 1px solid var(--ed-line-soft);
  border-radius: 3px;
  background: var(--ed-raised);
  color: var(--ed-text);
  font: 600 11px/1.3 var(--ed-font);
  cursor: pointer;
}

.ed-system-list-row.is-selected {
  border-color: var(--ed-focus);
  background: var(--ed-select);
}

.ed-system-empty {
  color: var(--ed-muted);
  font: 600 11px/1.3 var(--ed-font);
}

.ed-system-map-view {
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
  background: var(--ed-viewport);
}

.ed-system-canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: crosshair;
}

.ed-system-map-hint {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 2;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  background: rgba(24, 31, 39, 0.9);
  color: var(--ed-muted);
  font: 600 11px/1.3 var(--ed-font);
  letter-spacing: 0.04em;
  pointer-events: none;
}

.ed-menu-manager-sidebar {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  background: var(--ed-surface);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ed-menu-manager-status {
  color: var(--ed-text-strong);
  font: 600 12px/1.3 var(--ed-font);
}

.ed-menu-manager-note {
  margin: 0;
  color: var(--ed-muted);
  font: 600 11px/1.4 var(--ed-font);
}

.ed-menu-manager-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ed-menu-manager-section-title {
  color: var(--ed-muted);
  font: 600 10px/1.2 var(--ed-font);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.ed-menu-manager-tab-btn {
  appearance: none;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: 1px solid var(--ed-line-soft);
  border-radius: 3px;
  background: var(--ed-raised);
  color: var(--ed-text);
  font: 600 11px/1.3 var(--ed-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}

.ed-menu-manager-tab-btn:hover {
  border-color: rgba(255, 255, 255, 0.18);
}

.ed-menu-manager-tab-btn.is-active {
  border-color: var(--ed-focus);
  background: var(--ed-select);
  color: var(--ed-text-strong);
}

.ed-menu-manager-check {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ed-text);
  font: 600 11px/1.3 var(--ed-font);
  cursor: pointer;
}

.ed-menu-manager-preview {
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--ed-viewport);
}

/* Stage-only host in Scene body; left/right dock into hierarchy/inspector. */
.ed-base-character-editor {
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--ed-viewport);
}

.ed-hierarchy-panel > .ed-base-sidebar,
.ed-inspector-panel > .ed-base-sidebar {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  background: var(--ed-surface);
}

.ed-hierarchy-panel > .ed-panel-swap,
.ed-inspector-panel > .ed-panel-swap {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ed-base-sidebar {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  background: var(--ed-surface);
}

/* Segmented control: inactive segments sit in the inset, active lifts to chrome. */
.ed-base-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  margin: 0 0 10px;
  border: 1px solid var(--ed-line);
  border-radius: 3px;
  overflow: hidden;
  background: var(--ed-inset);
}

.ed-base-tab {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  border-radius: 0;
  border-right: 1px solid var(--ed-line-soft);
  background: transparent;
  color: var(--ed-muted);
  font: 700 9px/1 var(--ed-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 8px 6px;
  cursor: pointer;
}

.ed-base-tab:last-child {
  border-right: none;
}

.ed-base-tab:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--ed-text);
}

.ed-base-tab.is-active {
  background: var(--ed-chrome-hi);
  color: var(--ed-text-strong);
}

.ed-base-tab-body {
  min-width: 0;
}

.ed-base-panel-title {
  margin: 0 0 10px;
  color: var(--ed-text-strong);
  font: 700 12px/1.2 var(--ed-font);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.ed-base-subtitle {
  margin: 12px 0 6px;
  color: var(--ed-muted);
  font: 700 10px/1.2 var(--ed-font);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.ed-base-actions,
.ed-base-type-toggle {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.ed-base-anim-panel {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px;
  border: 1px solid var(--ed-line-soft);
  border-radius: 4px;
  background: var(--ed-raised);
}

.ed-base-anim-panel .ed-base-actions {
  margin-bottom: 0;
}

.ed-base-anim-speed {
  width: 100%;
  padding: 0;
}

.ed-base-controller-panel {
  margin-bottom: 0;
}

.ed-base-controller-states {
  display: grid;
  gap: 4px;
  margin-top: 8px;
}

.ed-base-controller-state-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
}

.ed-base-controller-state-row > span {
  color: var(--ed-muted);
  font: 600 10px/1.2 var(--ed-font);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.ed-base-source-badge {
  color: var(--ed-muted);
  font: 500 10px/1 var(--ed-font);
  opacity: 0.85;
}

.ed-base-type-toggle .is-active {
  border-color: var(--ed-focus);
  color: var(--ed-text-strong);
  background: rgba(255, 255, 255, 0.1);
}

.ed-base-actions .is-active {
  border-color: var(--ed-focus);
  color: var(--ed-text-strong);
  background: rgba(255, 255, 255, 0.1);
}

.ed-base-slot-list {
  display: grid;
  gap: 5px;
  margin-bottom: 10px;
}

.ed-base-slot,
.ed-base-catalog-item {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 3px;
  padding: 8px;
  background: var(--ed-raised);
  color: var(--ed-text);
  text-align: left;
  cursor: pointer;
}

.ed-base-slot:hover,
.ed-base-slot.is-selected,
.ed-base-catalog-item:hover {
  border-color: var(--ed-focus);
  background: rgba(255, 255, 255, 0.06);
}

.ed-base-slot.is-unavailable {
  opacity: 0.45;
}

.ed-base-stage {
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
}

.ed-base-stage canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.ed-base-stage canvas:focus-visible {
  outline: 1px solid var(--ed-focus);
  outline-offset: -2px;
}

.ed-base-stage.is-play-testing canvas {
  cursor: grab;
}

.ed-base-stage.is-play-testing canvas:active {
  cursor: grabbing;
}

.ed-base-playtest-hud {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  display: grid;
  justify-items: center;
  gap: 7px;
  pointer-events: none;
}

.ed-base-playtest-hud[hidden] {
  display: none;
}

.ed-base-playtest-title,
.ed-base-playtest-state,
.ed-base-playtest-help {
  padding: 6px 9px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  background: rgba(24, 31, 39, 0.92);
  box-shadow: 0 5px 16px var(--ed-input);
}

.ed-base-playtest-title {
  color: var(--ed-text-strong);
  font: 700 11px/1 var(--ed-font);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.ed-base-playtest-state {
  color: var(--ed-text);
  font: 600 11px/1.2 var(--ed-font);
}

.ed-base-playtest-help {
  color: var(--ed-muted);
  font-size: 10px;
}

.ed-base-playtest-loadout {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 5px;
  pointer-events: auto;
}

.ed-base-playtest-weapon {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 3px;
  padding: 6px 8px;
  background: rgba(24, 31, 39, 0.92);
  color: var(--ed-muted);
  font: 600 10px/1 var(--ed-font);
  cursor: pointer;
}

.ed-base-playtest-weapon:hover,
.ed-base-playtest-weapon.is-active {
  border-color: var(--ed-focus);
  background: rgba(255, 255, 255, 0.1);
  color: var(--ed-text-strong);
}

.ed-base-playtest-panel {
  margin-top: 4px;
}

.ed-base-stage-status {
  position: absolute;
  left: 12px;
  bottom: 12px;
  max-width: min(620px, calc(100% - 24px));
  padding: 7px 9px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  background: rgba(24, 31, 39, 0.9);
  color: var(--ed-muted);
  pointer-events: none;
}

.ed-base-stage-status.is-error,
.ed-base-warning {
  color: var(--ed-danger);
  border-color: rgba(255, 96, 96, 0.42);
}

.ed-base-section {
  display: grid;
  gap: 7px;
  padding: 0 0 14px;
  margin: 0 0 14px;
  border-bottom: 1px solid var(--ed-line-soft);
}

.ed-base-section h3 {
  margin: 0;
  color: var(--ed-text-strong);
  font: 700 11px/1.2 var(--ed-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ed-base-field {
  display: grid;
  grid-template-columns: minmax(88px, 0.75fr) minmax(0, 1.25fr);
  align-items: center;
  gap: 7px;
  color: var(--ed-muted);
  font-size: 11px;
}

.ed-base-field code {
  overflow: hidden;
  color: var(--ed-text-strong);
  text-overflow: ellipsis;
}

.ed-base-vector {
  display: grid;
  grid-template-columns: 1fr repeat(3, minmax(0, 0.7fr));
  align-items: center;
  gap: 4px;
  color: var(--ed-muted);
  font-size: 11px;
}

.ed-base-vector .ed-input {
  min-width: 0;
  padding: 4px;
}

.ed-base-note,
.ed-base-warning {
  margin: 0;
  padding: 7px;
  border: 1px solid var(--ed-line-soft);
  border-radius: 3px;
  font-size: 11px;
}

.ed-base-catalog-item {
  font-size: 11px;
}

.ed-viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  background: var(--ed-viewport);
}

.ed-viewport canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
}

.ed-viewport-hint {
  position: absolute;
  left: 10px;
  bottom: 8px;
  font: 500 11px/1.5 var(--ed-font);
  letter-spacing: 0.05em;
  color: var(--ed-muted);
  pointer-events: none;
}

.ed-viewport.is-playing .ed-viewport-hint {
  color: rgba(180, 255, 190, 0.9);
}

.ed-play-mode-banner {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  padding: 4px 12px;
  border: 1px solid rgba(120, 220, 140, 0.45);
  border-radius: 3px;
  background: rgba(12, 40, 22, 0.88);
  color: #b8ffc4;
  font: 700 11px/1.2 var(--ed-font);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  pointer-events: none;
}

.ed-drop-active::after {
  content: 'Drop to place';
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font: 700 18px/1 var(--ed-font);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ed-text-strong);
  background: rgba(255, 255, 255, 0.07);
  border: 1px dashed var(--ed-focus);
  pointer-events: none;
}

/* Hierarchy */
.ed-hierarchy-search {
  position: relative;
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: var(--ed-inset);
}

.ed-hierarchy-search-input {
  width: 100%;
  padding: 4px 22px 4px 6px;
  font-size: 11px;
  border-radius: 2px;
  border-color: var(--ed-line-soft);
}

.ed-hierarchy-search-clear {
  position: absolute;
  right: 14px;
  background: none;
  border: none;
  color: var(--ed-muted);
  font-size: 14px;
  cursor: pointer;
  padding: 0;
  display: none;
  line-height: 1;
}

.ed-hierarchy-search-clear.is-visible {
  display: block;
}

.ed-hierarchy-search-clear:hover {
  color: var(--ed-text-strong);
}

.ed-tree {
  padding: 6px 0;
}

.ed-tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  cursor: pointer;
  border: 1px solid transparent;
}

.ed-tree-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.ed-tree-row.is-selected {
  background: var(--ed-select);
  border-color: var(--ed-focus);
}

.ed-tree-row.is-in-selection {
  background: rgba(77, 132, 192, 0.18);
  border-color: rgba(77, 132, 192, 0.32);
}

.ed-tree-row.is-drop-target {
  border-color: rgba(255, 206, 111, 0.7);
}

.ed-tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.ed-tree-name.is-hidden-entity {
  opacity: 0.45;
}

.ed-tree-badge {
  font: 600 9px/1 var(--ed-mono);
  color: var(--ed-warn);
  border: 1px solid rgba(255, 206, 111, 0.35);
  padding: 2px 4px;
}

.ed-eye {
  background: none;
  border: none;
  color: var(--ed-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
}

.ed-eye:hover {
  color: var(--ed-text-strong);
}

.ed-tree-rename {
  flex: 1;
  min-width: 0;
}

.ed-tree-row.is-parent-selected {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.12);
}

.ed-tree-row-glb {
  cursor: pointer;
  color: var(--ed-muted);
  font-size: 12px;
}

.ed-tree-row-glb.is-selected {
  background: rgba(77, 132, 192, 0.22);
  border-color: rgba(77, 132, 192, 0.4);
  color: var(--ed-text);
}

.ed-tree-row-glb-asset {
  font: 600 9px/1 var(--ed-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ed-tree-name-glb {
  font-family: var(--ed-mono);
  font-size: 11px;
}

.ed-tree-label-muted {
  color: var(--ed-muted);
  font: 600 9px/1 var(--ed-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ed-tree-chevron {
  background: none;
  border: none;
  color: var(--ed-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  padding: 0;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.ed-tree-chevron:hover {
  color: var(--ed-text-strong);
}

.ed-tree-chevron-spacer {
  display: inline-block;
  width: 14px;
  flex-shrink: 0;
}

.ed-ui-icon {
  display: block;
  flex-shrink: 0;
  pointer-events: none;
}

.ed-ui-icon-muted {
  opacity: 0.35;
}

.ed-remove-btn {
  background: none;
  border: none;
  color: var(--ed-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
}

.ed-remove-btn:hover {
  color: var(--ed-danger);
}

.ed-context-menu .ed-menu-flyout {
  position: absolute;
  min-width: 180px;
}

.ed-empty-note {
  padding: 14px 12px;
  color: var(--ed-muted);
  font: 500 12px/1.5 var(--ed-font);
}

/* Inspector */
.ed-section {
  border-bottom: 1px solid var(--ed-line-soft);
  padding: 10px 12px;
}

.ed-section-title {
  margin: 0 0 8px;
  font: 700 10px/1 var(--ed-font);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ed-muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ed-section-title-toggle {
  cursor: pointer;
  user-select: none;
}

.ed-section-title-toggle:hover {
  color: var(--ed-text);
}

.ed-section-caret {
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0;
}

.ed-section.is-collapsed .ed-section-title {
  margin-bottom: 0;
}

.ed-section.is-collapsed > :not(.ed-section-title) {
  display: none;
}

.ed-field-row {
  display: grid;
  grid-template-columns: 56px repeat(3, minmax(0, 1fr));
  gap: 4px;
  align-items: center;
  margin-bottom: 6px;
}

.ed-field-row-wide {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 4px;
  align-items: center;
  margin-bottom: 6px;
}

.ed-field-controls {
  display: flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
}

.ed-field-controls .ed-input {
  flex: 1;
  min-width: 0;
}

.ed-input.is-drop-target {
  border-color: rgba(255, 206, 111, 0.85);
  background: rgba(255, 206, 111, 0.08);
}

.ed-input.is-missing-ref {
  border-color: rgba(255, 120, 100, 0.55);
  color: rgba(255, 170, 150, 0.9);
}

.ed-field-label {
  font: 600 10px/1 var(--ed-font);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ed-muted);
}

.ed-inspector-material-list {
  display: grid;
  gap: 6px;
}

.ed-inspector-material-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 6px;
  border: 1px solid var(--ed-line-soft);
  background: var(--ed-raised);
}

.ed-inspector-material-swatch {
  width: 18px;
  height: 18px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: #ffffff;
}

.ed-inspector-material-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.ed-inspector-material-name,
.ed-inspector-material-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ed-inspector-material-name {
  color: var(--ed-text);
  font: 700 11px/1.1 var(--ed-font);
}

.ed-inspector-material-meta,
.ed-inspector-material-values {
  color: var(--ed-muted);
  font: 600 9px/1.1 var(--ed-mono);
}

.ed-inspector-material-values {
  text-align: right;
  white-space: nowrap;
}

.ed-component {
  border: 1px solid var(--ed-line);
  border-radius: 3px;
  overflow: hidden;
  background: var(--ed-raised);
  margin-bottom: 8px;
}

.ed-component-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-bottom: 1px solid var(--ed-line);
  background: var(--ed-chrome);
  font: 700 11px/1 var(--ed-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ed-text-strong);
}

.ed-component-body {
  padding: 8px;
}

.ed-add-component {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.ed-combobox {
  position: relative;
  flex: 1;
  min-width: 0;
}

.ed-combobox .ed-input {
  width: 100%;
}

.ed-combobox-list {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 60;
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--ed-line);
  background: var(--ed-popover);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.ed-combobox-list.is-open {
  display: block;
}

.ed-combobox-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  cursor: pointer;
}

.ed-combobox-item.is-highlighted {
  background: var(--ed-focus);
}

.ed-combobox-item-label {
  font: 600 12px/1.2 var(--ed-font);
  color: var(--ed-text);
}

.ed-combobox-item.is-highlighted .ed-combobox-item-label {
  color: var(--ed-text-strong);
}

.ed-combobox-item-type {
  font: 500 10px/1 var(--ed-mono);
  color: var(--ed-muted);
}

.ed-combobox-empty {
  padding: 8px 10px;
  font: 500 11px/1.3 var(--ed-font);
  color: var(--ed-muted);
}

.ed-door-node-row {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) auto;
  gap: 4px;
  align-items: center;
}

.ed-door-spawn-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ed-door-spawn-row .ed-checkbox-row {
  flex: 1;
  min-width: 0;
}

.ed-mode-chip {
  padding: 4px 8px;
  border: 1px solid rgba(255, 206, 111, 0.5);
  color: var(--ed-warn);
  font: 700 10px/1 var(--ed-font);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  white-space: nowrap;
}

.ed-ship-doors {
  display: inline-flex;
  gap: 4px;
}

.ed-checkbox-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  color: var(--ed-text);
}

.ed-checkbox-row input {
  accent-color: var(--ed-focus);
}

.ed-particle-module {
  margin: 6px 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 4px;
  background: var(--ed-raised);
}

.ed-particle-module-title {
  cursor: pointer;
  padding: 6px 8px;
  color: var(--ed-text);
  font-size: 12px;
  user-select: none;
}

.ed-particle-module-body {
  padding: 4px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Project / Console / asset browser (Rogue-style bottom row) */
.ed-bottom-left-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  flex: 0 0 auto;
  padding: 4px 4px 0;
  border-bottom: 1px solid var(--ed-line);
  background: var(--ed-chrome);
}

.ed-bottom-left-body {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.ed-bottom-left-pane {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.ed-bottom-left-pane.is-hidden {
  display: none;
}

.ed-project-side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
}

.ed-folder-tree {
  flex: 1;
  overflow: auto;
  padding: 4px 0;
}

.ed-folder-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px 3px 2px;
  cursor: pointer;
  white-space: nowrap;
  color: var(--ed-text);
  font: 500 12px/1.2 var(--ed-font);
}

.ed-folder-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.ed-folder-row.is-selected {
  background: rgba(255, 255, 255, 0.1);
}

.ed-folder-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ed-muted);
  cursor: pointer;
  flex: 0 0 auto;
}

.ed-folder-chevron.is-leaf {
  cursor: default;
  visibility: hidden;
}

.ed-folder-chevron:not(.is-leaf):hover {
  color: var(--ed-text);
}

.ed-folder-icon {
  color: #9aa3ad;
  flex: 0 0 auto;
}

.ed-folder-row.is-selected .ed-folder-icon {
  color: #c4ccd4;
}

.ed-folder-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.ed-asset-browser-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  width: 100%;
  flex: 1 1 auto;
}

.ed-asset-browser-toolbar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: 0 0 auto;
  width: 100%;
  box-sizing: border-box;
  min-height: 30px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--ed-line);
  background: var(--ed-chrome);
}

.ed-asset-breadcrumbs {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 0;
  min-width: 0;
  flex: 1 1 0;
  overflow: hidden;
  color: var(--ed-muted);
  font: 500 12px/1.2 var(--ed-font);
}

.ed-asset-breadcrumb {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  flex: 0 1 auto;
}

.ed-asset-breadcrumb-sep {
  margin: 0 6px;
  color: var(--ed-muted);
  opacity: 0.7;
  flex: 0 0 auto;
}

.ed-asset-breadcrumb-link {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--ed-muted);
  font: inherit;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ed-asset-breadcrumb-link:hover {
  color: var(--ed-text);
  text-decoration: underline;
}

.ed-asset-breadcrumb-current {
  color: var(--ed-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ed-asset-scope-select {
  flex: 0 0 auto;
  width: auto;
  min-width: 118px;
  max-width: 160px;
  padding: 4px 8px;
  font: 500 11px/1.2 var(--ed-font);
}

.ed-asset-grid {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;
  padding: 10px;
  align-content: start;
}

.ed-console {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
}

.ed-console-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--ed-line);
  background: var(--ed-inset);
  flex: 0 0 auto;
}

.ed-console-hint {
  color: var(--ed-muted);
  font: 600 10px/1 var(--ed-font);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.ed-console-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 6px 8px;
  font: 500 11px/1.35 var(--ed-mono);
}

.ed-console-line {
  display: grid;
  grid-template-columns: 64px 48px minmax(0, 1fr);
  gap: 8px;
  padding: 2px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  word-break: break-word;
}

.ed-console-time {
  color: var(--ed-muted);
}

.ed-console-level {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 10px;
}

.ed-console-log .ed-console-level,
.ed-console-info .ed-console-level {
  color: var(--ed-text-strong);
}

.ed-console-warn .ed-console-level,
.ed-console-warn .ed-console-msg {
  color: var(--ed-warn);
}

.ed-console-error .ed-console-level,
.ed-console-error .ed-console-msg {
  color: var(--ed-danger);
}

.ed-asset-card {
  border: 1px solid rgba(255, 255, 255, 0.09);
  background: var(--ed-raised);
  padding: 6px;
  cursor: grab;
  text-align: center;
}

.ed-asset-card:hover {
  border-color: var(--ed-focus);
  background: rgba(255, 255, 255, 0.05);
}

.ed-asset-card.is-unavailable {
  cursor: default;
  opacity: 0.72;
}

.ed-asset-thumb {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  background: var(--ed-inset);
  display: grid;
  place-items: center;
  color: var(--ed-muted);
  font: 700 20px/1 var(--ed-mono);
  overflow: hidden;
}

.ed-asset-thumb.is-warning {
  color: var(--ed-warn);
}

.ed-asset-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.ed-asset-name {
  margin-top: 4px;
  font: 500 10px/1.25 var(--ed-mono);
  color: var(--ed-text);
  word-break: break-all;
  max-height: 26px;
  overflow: hidden;
}

.ed-asset-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-top: 6px;
}

.ed-asset-action {
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: var(--ed-text);
  font: 700 9px/1 var(--ed-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 5px 4px;
  cursor: pointer;
}

.ed-asset-action:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--ed-text-strong);
}

.ed-asset-action:disabled {
  color: var(--ed-muted);
  cursor: default;
  opacity: 0.45;
}

.ed-material-manager {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  background: var(--ed-surface);
}

.ed-material-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--ed-line-soft);
  background: var(--ed-chrome);
}

.ed-material-toolbar-title {
  font: 700 10px/1 var(--ed-font);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ed-text-strong);
}

.ed-material-toolbar-status {
  font: 600 10px/1 var(--ed-mono);
  color: var(--ed-muted);
}

.ed-material-list {
  min-height: 0;
  overflow: auto;
}

.ed-material-row {
  display: grid;
  grid-template-columns:
    minmax(180px, 1.6fr)
    minmax(72px, 0.55fr)
    minmax(72px, 0.55fr)
    minmax(72px, 0.55fr)
    minmax(72px, 0.55fr)
    minmax(72px, 0.55fr)
    minmax(72px, 0.55fr)
    auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ed-material-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.ed-material-name {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.ed-material-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ed-text);
  font: 700 12px/1.1 var(--ed-font);
}

.ed-material-subtitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ed-muted);
  font: 600 10px/1.1 var(--ed-mono);
}

.ed-material-field {
  min-width: 0;
  display: grid;
  gap: 4px;
  color: var(--ed-muted);
  font: 700 9px/1 var(--ed-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ed-material-number {
  width: 100%;
  padding: 5px 6px;
}

.ed-material-color {
  width: 100%;
  height: 28px;
  padding: 2px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: var(--ed-input);
  cursor: pointer;
}

.ed-material-actions {
  display: flex;
  justify-content: flex-end;
}

.ed-material-reset {
  padding: 6px 8px;
}

.ed-material-empty {
  padding: 24px;
  color: var(--ed-muted);
  font: 600 12px/1.2 var(--ed-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ed-toast {
  position: fixed;
  left: 50%;
  bottom: 260px;
  transform: translateX(-50%);
  z-index: 400;
  padding: 10px 18px;
  border: 1px solid var(--ed-line);
  background: var(--ed-popover);
  color: var(--ed-text);
  font: 600 13px/1.2 var(--ed-font);
  letter-spacing: 0.06em;
  opacity: 0;
  transition: opacity 150ms ease;
  pointer-events: none;
}

.ed-toast.is-visible {
  opacity: 1;
}

.ed-toast.is-error {
  border-color: rgba(255, 125, 125, 0.6);
  color: #ffb0b0;
}

.ed-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(8, 11, 15, 0.66);
  backdrop-filter: blur(4px);
  opacity: 0;
  transition: opacity 150ms ease;
}

.ed-dialog-overlay.is-visible {
  opacity: 1;
}

.ed-scene-settings-modal {
  width: min(520px, 100%);
  max-height: min(80vh, 720px);
  overflow: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ed-dialog {
  width: min(420px, 100%);
  border: 1px solid var(--ed-line);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, transparent 24%),
    var(--ed-popover);
  box-shadow:
    0 0 24px rgba(0, 0, 0, 0.4),
    0 16px 48px rgba(0, 0, 0, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  clip-path: polygon(
    10px 0,
    calc(100% - 10px) 0,
    100% 10px,
    100% calc(100% - 10px),
    calc(100% - 10px) 100%,
    10px 100%,
    0 calc(100% - 10px),
    0 10px
  );
  padding: 20px 22px 18px;
  font: 13px/1.35 var(--ed-font);
  color: var(--ed-text);
}

.ed-dialog-title {
  margin: 0 0 10px;
  font: 700 14px/1.2 var(--ed-font);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ed-text-strong);
}

.ed-dialog-message {
  margin: 0 0 18px;
  font: 500 14px/1.45 var(--ed-font);
  color: var(--ed-text);
}

.ed-dialog-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 0 0 18px;
}

.ed-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ed-dialog-btn-cancel,
.ed-dialog-btn-confirm {
  min-width: 96px;
}

.ed-field-value-static {
  font: 500 12px/1.2 var(--ed-mono);
  color: var(--ed-text);
  padding: 6px 8px;
  background: var(--ed-inset);
  border: 1px dashed var(--ed-line-soft);
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.ae-projects {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 32px 24px;
  background:
    radial-gradient(ellipse 80% 55% at 50% -10%, var(--ed-line-soft), transparent 55%),
    linear-gradient(180deg, #1d242d 0%, #12171c 100%);
  color: var(--ed-text);
  font: 14px/1.4 var(--ed-font);
}

.ae-projects-shell {
  width: min(820px, 100%);
  display: grid;
  gap: 20px;
}

.ae-projects-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
}

.ae-projects-kicker {
  margin: 0 0 4px;
  font: 600 12px/1 var(--ed-font);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ed-focus);
}

.ae-projects-brand {
  margin: 0;
  font: 700 42px/1 var(--ed-font);
  letter-spacing: 0.02em;
  color: var(--ed-text-strong);
}

.ae-projects-tag {
  margin: 8px 0 0;
  color: var(--ed-muted);
}

.ae-projects-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.ae-projects-btn {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: var(--ed-chrome);
  color: var(--ed-text);
  font: 600 13px/1 var(--ed-font);
  letter-spacing: 0.04em;
  padding: 10px 16px;
  cursor: pointer;
}

.ae-projects-btn:hover:not(:disabled) {
  border-color: var(--ed-focus);
  background: var(--ed-chrome-hi);
}

.ae-projects-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.ae-projects-btn-primary {
  border-color: var(--ed-focus);
  background: linear-gradient(180deg, #3f6fa4 0%, #2c5079 100%);
  color: var(--ed-text-strong);
}

.ae-projects-error {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid rgba(255, 120, 120, 0.45);
  background: rgba(70, 16, 24, 0.55);
  color: #ffd0d0;
}

.ae-projects-create,
.ae-projects-recent {
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--ed-surface);
  padding: 16px;
}

.ae-projects-section-title {
  margin: 0 0 12px;
  font: 600 15px/1.2 var(--ed-font);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ed-focus);
}

.ae-projects-field {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
  font: 600 12px/1.2 var(--ed-font);
  color: var(--ed-muted);
}

.ae-projects-field input {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: var(--ed-input);
  color: var(--ed-text);
  font: 500 14px/1.3 var(--ed-font);
  padding: 9px 10px;
  width: 100%;
}

.ae-projects-location-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.ae-projects-create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ae-projects-empty {
  margin: 0;
  color: var(--ed-muted);
}

.ae-projects-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.ae-projects-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  border: 1px solid var(--ed-line-soft);
  background: var(--ed-inset);
}

.ae-projects-item-main {
  display: grid;
  gap: 2px;
  text-align: left;
  border: none;
  background: transparent;
  color: inherit;
  padding: 12px;
  cursor: pointer;
  min-width: 0;
}

.ae-projects-item-main:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
}

.ae-projects-item-main:disabled {
  opacity: 0.55;
  cursor: default;
}

.ae-projects-item-name {
  font: 600 16px/1.2 var(--ed-font);
  color: var(--ed-text-strong);
}

.ae-projects-item-path,
.ae-projects-item-meta {
  font: 500 12px/1.3 var(--ed-mono);
  color: var(--ed-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ae-projects-item-side {
  display: flex;
  gap: 8px;
  padding-right: 12px;
}

.ae-projects-link {
  border: none;
  background: transparent;
  color: var(--ed-text-strong);
  font: 600 12px/1 var(--ed-font);
  cursor: pointer;
  padding: 4px 2px;
}

.ae-projects-link:hover:not(:disabled) {
  color: #fff;
  text-decoration: underline;
}

.ae-projects-link:disabled {
  opacity: 0.4;
  cursor: default;
}
`;

/** Inject or hot-swap editor CSS (HMR-safe). */
export function injectEditorStyles(): void {
  let style = document.querySelector<HTMLStyleElement>('style[data-editor-styles]');
  if (!style) {
    style = document.createElement('style');
    style.dataset.editorStyles = 'true';
    document.head.appendChild(style);
  }
  style.textContent = EDITOR_CSS;
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    injectEditorStyles();
  });
}
