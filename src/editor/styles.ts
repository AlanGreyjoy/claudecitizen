/** Injects the editor stylesheet once (editor chunk only, never in prod). */

const EDITOR_CSS = `
#editor-root {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) 240px;
  background: #060a14;
  color: var(--text);
  font: 13px/1.35 var(--sc-font);
  user-select: none;
}

.ed-toolbar {
  display: flex;
  align-items: center;
  padding: 0;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 60%), var(--panel);
  white-space: nowrap;
}

.ed-docbar {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 28px;
  padding: 0 8px;
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
  color: var(--text);
  font: 500 12px/1 var(--sc-font);
  letter-spacing: 0.04em;
  padding: 6px 10px;
  cursor: pointer;
}

.ed-menu-trigger:hover,
.ed-menu.is-open > .ed-menu-trigger {
  background: rgba(139, 216, 255, 0.12);
  color: var(--accent);
}

.ed-menu-dropdown {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 50;
  min-width: 200px;
  padding: 4px 0;
  border: 1px solid var(--line);
  background: rgba(6, 12, 26, 0.97);
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
  color: var(--text);
  font: 500 12px/1.2 var(--sc-font);
  padding: 6px 12px;
  cursor: pointer;
  text-align: left;
}

.ed-menu-item:hover:not(:disabled) {
  background: rgba(139, 216, 255, 0.14);
  color: var(--accent);
}

.ed-menu-item:disabled {
  opacity: 0.55;
  cursor: default;
}

.ed-menu-item.is-accent:not(:disabled) {
  color: var(--accent-2);
}

.ed-menu-item-label {
  flex: 1;
}

.ed-menu-item-shortcut {
  font: 500 10px/1 var(--sc-mono);
  color: var(--muted);
  letter-spacing: 0.02em;
}

.ed-menu-sep {
  height: 1px;
  margin: 4px 0;
  background: rgba(90, 190, 255, 0.16);
}

.ed-menu-heading {
  padding: 4px 12px 2px;
  font: 700 9px/1 var(--sc-font);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
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

.ed-menubar-doc {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ed-menubar-name {
  width: 170px;
}

.ed-menubar-kind {
  min-width: 120px;
}

.ed-toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 10px;
  border-right: 1px solid rgba(90, 190, 255, 0.16);
}

.ed-toolbar-group:last-child {
  border-right: none;
  margin-left: auto;
  padding-right: 0;
}

.ed-btn {
  border: 1px solid rgba(139, 216, 255, 0.28);
  background: rgba(139, 216, 255, 0.05);
  color: var(--text);
  font: 600 12px/1 var(--sc-font);
  letter-spacing: 0.06em;
  padding: 7px 10px;
  cursor: pointer;
}

.ed-btn:hover {
  background: rgba(139, 216, 255, 0.14);
}

.ed-btn.is-active {
  background: rgba(139, 216, 255, 0.24);
  border-color: rgba(139, 216, 255, 0.6);
  color: var(--accent);
}

.ed-btn.ed-btn-accent {
  border-color: rgba(255, 206, 111, 0.5);
  color: var(--accent-2);
  background: rgba(255, 206, 111, 0.07);
}

.ed-btn.ed-btn-accent:hover {
  background: rgba(255, 206, 111, 0.16);
}

.ed-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.ed-label {
  font: 600 10px/1 var(--sc-font);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}

.ed-input,
.ed-select {
  border: 1px solid rgba(90, 190, 255, 0.28);
  background: rgba(0, 0, 0, 0.32);
  color: var(--text);
  font: 500 12px/1.2 var(--sc-mono);
  padding: 6px 8px;
  outline: none;
  min-width: 0;
}

.ed-input:focus,
.ed-select:focus {
  border-color: rgba(139, 216, 255, 0.6);
}

.ed-input-narrow {
  width: 64px;
}

.ed-main {
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr) 320px;
  min-height: 0;
}

.ed-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border-right: 1px solid var(--line);
  background: rgba(6, 12, 26, 0.6);
}

.ed-panel:last-child {
  border-right: none;
  border-left: 1px solid var(--line);
}

.ed-panel-title {
  padding: 5px 10px;
  border-bottom: 1px solid rgba(90, 190, 255, 0.16);
  font: 700 11px/1 var(--sc-font);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
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

.ed-panel-body {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.ed-viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  background: #0a101d;
}

.ed-viewport-toolbar {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 10;
  display: flex;
  align-items: stretch;
  flex-wrap: nowrap;
  border: 1px solid var(--line);
  border-radius: 2px;
  background: rgba(6, 12, 26, 0.9);
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
  overflow: hidden;
}

.ed-viewport-toolbar-toggle {
  flex-shrink: 0;
  align-self: stretch;
  border: none;
  border-right: 1px solid rgba(90, 190, 255, 0.16);
  border-radius: 0;
  background: rgba(139, 216, 255, 0.08);
  color: var(--text);
  font: 600 11px/1 var(--sc-font);
  letter-spacing: 0.06em;
  padding: 6px 8px;
  cursor: pointer;
  white-space: nowrap;
}

.ed-viewport-toolbar-toggle:hover {
  background: rgba(139, 216, 255, 0.16);
  color: var(--accent);
}

.ed-viewport-toolbar-body {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  padding: 6px 10px;
  white-space: nowrap;
}

.ed-viewport-toolbar.is-collapsed .ed-viewport-toolbar-body {
  display: none;
}

.ed-viewport-toolbar.is-collapsed .ed-viewport-toolbar-toggle {
  border-right: none;
}

.ed-viewport-toolbar .ed-toolbar-group {
  padding-right: 10px;
  border-right: 1px solid rgba(90, 190, 255, 0.16);
}

.ed-viewport-toolbar .ed-toolbar-group:last-child {
  border-right: none;
  margin-left: 0;
  padding-right: 0;
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
  font: 500 11px/1.5 var(--sc-font);
  letter-spacing: 0.05em;
  color: rgba(143, 163, 201, 0.75);
  pointer-events: none;
}

.ed-drop-active::after {
  content: 'Drop to place';
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font: 700 18px/1 var(--sc-font);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--accent);
  background: rgba(80, 200, 255, 0.08);
  border: 1px dashed rgba(139, 216, 255, 0.5);
  pointer-events: none;
}

/* Hierarchy */
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
  background: rgba(139, 216, 255, 0.06);
}

.ed-tree-row.is-selected {
  background: rgba(139, 216, 255, 0.16);
  border-color: rgba(139, 216, 255, 0.35);
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
  font: 600 9px/1 var(--sc-mono);
  color: var(--accent-2);
  border: 1px solid rgba(255, 206, 111, 0.35);
  padding: 2px 4px;
}

.ed-eye {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
}

.ed-eye:hover {
  color: var(--accent);
}

.ed-tree-rename {
  flex: 1;
  min-width: 0;
}

.ed-empty-note {
  padding: 14px 12px;
  color: var(--muted);
  font: 500 12px/1.5 var(--sc-font);
}

/* Inspector */
.ed-section {
  border-bottom: 1px solid rgba(90, 190, 255, 0.14);
  padding: 10px 12px;
}

.ed-section-title {
  margin: 0 0 8px;
  font: 700 10px/1 var(--sc-font);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
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

.ed-field-label {
  font: 600 10px/1 var(--sc-font);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}

.ed-component {
  border: 1px solid rgba(90, 190, 255, 0.2);
  background: rgba(255, 255, 255, 0.02);
  margin-bottom: 8px;
}

.ed-component-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-bottom: 1px solid rgba(90, 190, 255, 0.14);
  font: 700 11px/1 var(--sc-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
}

.ed-component-body {
  padding: 8px;
}

.ed-remove-btn {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 13px;
}

.ed-remove-btn:hover {
  color: #ff7d7d;
}

.ed-add-component {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.ed-checkbox-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  color: var(--text);
}

.ed-checkbox-row input {
  accent-color: var(--accent);
}

/* Project panel */
.ed-project {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  border-top: 1px solid var(--line);
  min-height: 0;
  background: rgba(6, 12, 26, 0.7);
}

.ed-project-side {
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(90, 190, 255, 0.16);
  min-height: 0;
}

.ed-folder-tree {
  flex: 1;
  overflow: auto;
  padding: 6px 0;
}

.ed-folder-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  cursor: pointer;
  white-space: nowrap;
}

.ed-folder-row:hover {
  background: rgba(139, 216, 255, 0.06);
}

.ed-folder-row.is-selected {
  background: rgba(139, 216, 255, 0.16);
}

.ed-asset-grid {
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;
  padding: 10px;
  align-content: start;
}

.ed-asset-card {
  border: 1px solid rgba(90, 190, 255, 0.2);
  background: rgba(255, 255, 255, 0.02);
  padding: 6px;
  cursor: grab;
  text-align: center;
}

.ed-asset-card:hover {
  border-color: rgba(139, 216, 255, 0.5);
  background: rgba(139, 216, 255, 0.07);
}

.ed-asset-thumb {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  background: rgba(0, 0, 0, 0.35);
  display: grid;
  place-items: center;
  color: var(--muted);
  font: 700 20px/1 var(--sc-mono);
  overflow: hidden;
}

.ed-asset-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.ed-asset-name {
  margin-top: 4px;
  font: 500 10px/1.25 var(--sc-mono);
  color: var(--text);
  word-break: break-all;
  max-height: 26px;
  overflow: hidden;
}

.ed-toast {
  position: fixed;
  left: 50%;
  bottom: 260px;
  transform: translateX(-50%);
  z-index: 400;
  padding: 10px 18px;
  border: 1px solid var(--line);
  background: rgba(6, 12, 26, 0.94);
  color: var(--text);
  font: 600 13px/1.2 var(--sc-font);
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
`;

let injected = false;

export function injectEditorStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.dataset.editorStyles = 'true';
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}
