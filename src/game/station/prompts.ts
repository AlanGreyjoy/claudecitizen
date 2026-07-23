import type { KeyboardActionId } from "../../flight/input_settings";
import type { LoopContext } from "../loop_context";

export interface Prompts {
  keyLabel: (action: KeyboardActionId) => string;
  pressInteractPrompt: (text: string) => string;
  holdPrompt: (action: KeyboardActionId, text: string) => string;
}

/** Shared interaction-prompt helpers reused by every walking/flying mode. */
export function createPrompts(ctx: LoopContext): Prompts {
  const keyLabel = (action: KeyboardActionId): string =>
    ctx.controls.getKeyboardActionLabel(action);

  const pressInteractPrompt = (text: string): string =>
    `Press ${keyLabel("interact")} — ${text}`;

  const holdPrompt = (action: KeyboardActionId, text: string): string =>
    `Hold ${keyLabel(action)} — ${text}`;

  return { keyLabel, pressInteractPrompt, holdPrompt };
}
