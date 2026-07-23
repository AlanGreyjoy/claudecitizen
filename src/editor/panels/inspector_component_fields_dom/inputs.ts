import { el } from "../../dom";
import { ASSET_DND_TYPE } from "../../api";
import { isAudioAssetUrl, isImageAssetUrl } from "../inspector_logic";

export function numberInput(
  value: number,
  onCommit: (next: number) => void,
  step = 0.1,
): HTMLInputElement {
  return el("input", {
    className: "ed-input",
    attrs: {
      type: "number",
      step: String(step),
      value: String(Math.round(value * 1000) / 1000),
    },
    on: {
      change: (event) => {
        const next = Number((event.target as HTMLInputElement).value);
        if (Number.isFinite(next)) onCommit(next);
      },
      keydown: (event) => event.stopPropagation(),
    },
  });
}

export function textInput(
  value: string,
  onCommit: (next: string) => void,
): HTMLInputElement {
  return el("input", {
    className: "ed-input",
    attrs: { type: "text", value },
    on: {
      change: (event) => onCommit((event.target as HTMLInputElement).value),
      keydown: (event) => event.stopPropagation(),
    },
  });
}

export function typedAssetUrlField(
  label: string,
  value: string | undefined,
  onCommit: (next: string | undefined) => void,
  accepts: (url: string) => boolean,
): HTMLElement {
  const input = textInput(value ?? "", (next) => onCommit(next.trim() || undefined));
  input.addEventListener("dragover", (event) => event.preventDefault());
  input.addEventListener("drop", (event) => {
    event.preventDefault();
    const url =
      event.dataTransfer?.getData(ASSET_DND_TYPE) ||
      event.dataTransfer?.getData("text/plain");
    if (url?.startsWith("/") && accepts(url)) onCommit(url);
  });
  const controls = el("div", { className: "ed-field-controls" }, [
    input,
    el("button", {
      className: "ed-btn",
      text: "Clear",
      title: "Remove assigned asset",
      on: {
        click: () => onCommit(undefined),
      },
    }),
  ]);
  return el("div", { className: "ed-field-row-wide" }, [
    el("span", { className: "ed-field-label", text: label }),
    controls,
  ]);
}

export function assetUrlField(
  label: string,
  value: string | undefined,
  onCommit: (next: string | undefined) => void,
): HTMLElement {
  return typedAssetUrlField(label, value, onCommit, isAudioAssetUrl);
}

export function imageAssetUrlField(
  label: string,
  value: string | undefined,
  onCommit: (next: string | undefined) => void,
): HTMLElement {
  return typedAssetUrlField(label, value, onCommit, isImageAssetUrl);
}

export function colorInput(
  value: string,
  onCommit: (next: string) => void,
): HTMLInputElement {
  return el("input", {
    className: "ed-input",
    attrs: { type: "color", value },
    on: {
      change: (event) => onCommit((event.target as HTMLInputElement).value),
    },
  });
}

export function selectInput(
  options: readonly string[],
  value: string,
  onCommit: (next: string) => void,
): HTMLSelectElement {
  const select = el("select", {
    className: "ed-select",
    on: {
      change: (event) => onCommit((event.target as HTMLSelectElement).value),
    },
  });
  for (const option of options) {
    const optionEl = el("option", { text: option, attrs: { value: option } });
    if (option === value) optionEl.selected = true;
    select.append(optionEl);
  }
  return select;
}
