/** Injects the editor stylesheet once (editor chunk only, never in prod). */

const EDITOR_CSS = `
#editor-root {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) 4px var(--ed-project-height, 240px);
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
  grid-template-columns:
    var(--ed-hierarchy-width, 264px)
    4px
    minmax(0, 1fr)
    4px
    var(--ed-inspector-width, 320px);
  min-height: 0;
}

.ed-splitter {
  position: relative;
  z-index: 2;
  touch-action: none;
}

.ed-splitter-col {
  cursor: col-resize;
  margin: 0 -1px;
}

.ed-splitter-row {
  cursor: row-resize;
  margin: -1px 0;
  border-top: 1px solid var(--line);
}

.ed-splitter:hover,
.ed-splitter.is-dragging {
  background: rgba(139, 216, 255, 0.22);
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

.ed-scene-shell {
  display: grid;
  grid-template-rows: 30px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  background: #0a101d;
}

.ed-scene-tabs {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid rgba(90, 190, 255, 0.16);
  background: rgba(0, 0, 0, 0.22);
}

.ed-scene-tab {
  border: none;
  border-right: 1px solid rgba(90, 190, 255, 0.16);
  background: transparent;
  color: var(--muted);
  font: 700 10px/1 var(--sc-font);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 0 14px;
  cursor: pointer;
}

.ed-scene-tab:hover,
.ed-scene-tab.is-active {
  background: rgba(139, 216, 255, 0.1);
  color: var(--accent);
}

.ed-scene-body {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.ed-scene-body > .ed-viewport,
.ed-scene-body > .ed-character-preview {
  position: absolute;
  inset: 0;
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

.ed-tree-row.is-parent-selected {
  background: rgba(139, 216, 255, 0.08);
  border-color: rgba(139, 216, 255, 0.2);
}

.ed-tree-row-glb {
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
}

.ed-tree-row-glb.is-selected {
  background: rgba(139, 216, 255, 0.12);
  border-color: rgba(139, 216, 255, 0.28);
  color: var(--text);
}

.ed-tree-row-glb-asset {
  font: 600 9px/1 var(--sc-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ed-tree-name-glb {
  font-family: var(--sc-mono);
  font-size: 11px;
}

.ed-tree-label-muted {
  color: var(--muted);
  font: 600 9px/1 var(--sc-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ed-tree-chevron {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  padding: 0;
  width: 12px;
  flex-shrink: 0;
}

.ed-tree-chevron:hover {
  color: var(--accent);
}

.ed-tree-chevron-spacer {
  display: inline-block;
  width: 12px;
  flex-shrink: 0;
}

.ed-context-menu .ed-menu-flyout {
  position: absolute;
  min-width: 180px;
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
  border: 1px solid var(--line);
  background: rgba(6, 12, 26, 0.97);
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
  background: rgba(139, 216, 255, 0.14);
}

.ed-combobox-item-label {
  font: 600 12px/1.2 var(--sc-font);
  color: var(--text);
}

.ed-combobox-item.is-highlighted .ed-combobox-item-label {
  color: var(--accent);
}

.ed-combobox-item-type {
  font: 500 10px/1 var(--sc-mono);
  color: var(--muted);
}

.ed-combobox-empty {
  padding: 8px 10px;
  font: 500 11px/1.3 var(--sc-font);
  color: var(--muted);
}

.ed-door-node-row {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) auto;
  gap: 4px;
  align-items: center;
}

.ed-mode-chip {
  padding: 4px 8px;
  border: 1px solid rgba(255, 206, 111, 0.5);
  color: var(--accent-2);
  font: 700 10px/1 var(--sc-font);
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
  color: var(--text);
}

.ed-checkbox-row input {
  accent-color: var(--accent);
}

/* Project panel */
.ed-project {
  display: grid;
  grid-template-columns:
    var(--ed-project-side-width, 280px)
    4px
    minmax(0, 1fr);
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
  flex: 1;
  min-height: 0;
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

.ed-asset-card.is-unavailable {
  cursor: default;
  opacity: 0.72;
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

.ed-asset-thumb.is-warning {
  color: var(--accent-2);
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

.ed-asset-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-top: 6px;
}

.ed-asset-action {
  min-width: 0;
  border: 1px solid rgba(139, 216, 255, 0.22);
  background: rgba(139, 216, 255, 0.05);
  color: var(--text);
  font: 700 9px/1 var(--sc-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 5px 4px;
  cursor: pointer;
}

.ed-asset-action:hover:not(:disabled) {
  background: rgba(139, 216, 255, 0.14);
  color: var(--accent);
}

.ed-asset-action:disabled {
  color: var(--muted);
  cursor: default;
  opacity: 0.45;
}

.ed-character-preview {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(140px, 1fr) auto;
}

.ed-character-preview-toolbar {
  display: grid;
  grid-template-columns: auto minmax(120px, 220px) auto auto minmax(80px, 140px) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(90, 190, 255, 0.16);
  background: rgba(0, 0, 0, 0.18);
}

.ed-character-preview-select {
  width: 100%;
}

.ed-character-preview-speed {
  width: 100%;
  accent-color: var(--accent);
}

.ed-character-preview-canvas {
  min-height: 0;
  position: relative;
  background: #090f1c;
}

.ed-character-preview-canvas canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.ed-character-preview-meta {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(180px, 1.2fr);
  gap: 8px;
  padding: 7px 10px;
  border-top: 1px solid rgba(90, 190, 255, 0.16);
  background: rgba(0, 0, 0, 0.22);
}

.ed-character-preview-source,
.ed-character-preview-status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font: 600 10px/1.2 var(--sc-mono);
}

.ed-character-preview-status {
  color: var(--accent);
}

.ed-character-preview-status.is-error {
  color: #ffb0b0;
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

.ed-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(2, 5, 13, 0.72);
  backdrop-filter: blur(4px);
  opacity: 0;
  transition: opacity 150ms ease;
}

.ed-dialog-overlay.is-visible {
  opacity: 1;
}

.ed-dialog {
  width: min(420px, 100%);
  border: 1px solid var(--line);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, transparent 24%),
    rgba(6, 12, 26, 0.97);
  box-shadow:
    0 0 24px var(--sc-glow),
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
  font: 13px/1.35 var(--sc-font);
  color: var(--text);
}

.ed-dialog-title {
  margin: 0 0 10px;
  font: 700 14px/1.2 var(--sc-font);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent);
}

.ed-dialog-message {
  margin: 0 0 18px;
  font: 500 14px/1.45 var(--sc-font);
  color: var(--text);
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
