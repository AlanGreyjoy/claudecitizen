/**
 * Undo/redo command stack for the editor document. Every mutation of the
 * document goes through a command so the whole session is reversible.
 */
export interface EditorCommand {
  label: string;
  do: () => void;
  undo: () => void;
}

export interface CommandStack {
  execute: (command: EditorCommand) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

const MAX_UNDO_DEPTH = 200;

export function createCommandStack(onChange: () => void): CommandStack {
  const undoStack: EditorCommand[] = [];
  const redoStack: EditorCommand[] = [];

  return {
    execute(command) {
      command.do();
      undoStack.push(command);
      if (undoStack.length > MAX_UNDO_DEPTH) undoStack.shift();
      redoStack.length = 0;
      onChange();
    },
    undo() {
      const command = undoStack.pop();
      if (!command) return;
      command.undo();
      redoStack.push(command);
      onChange();
    },
    redo() {
      const command = redoStack.pop();
      if (!command) return;
      command.do();
      undoStack.push(command);
      onChange();
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      onChange();
    },
  };
}
