import { useEffect, useReducer, useRef, type ReactElement } from 'react';

type LogLevel = 'log' | 'info' | 'warn' | 'error';

type LogEntry = {
  id: number;
  level: LogLevel;
  message: string;
  timeMs: number;
};

const MAX_ENTRIES = 400;
const LEVELS: ReadonlyArray<LogLevel> = ['log', 'info', 'warn', 'error'];

let nextId = 1;

function formatArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatArgs(args: unknown[]): string {
  return args.map(formatArg).join(' ');
}

/**
 * Bottom Console tab: captures console.log/info/warn/error into a ring buffer.
 * Expands to the full bottom dock width when the Console tab is active.
 *
 * Updates are coalesced via rAF so a burst of console output (e.g. WebGL context
 * warnings during HMR) cannot synchronously re-enter React and blow the update depth.
 */
export function ConsolePanel(): ReactElement {
  const [revision, bump] = useReducer((n: number) => n + 1, 0);
  const entriesRef = useRef<LogEntry[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  const capturingRef = useRef(false);

  useEffect(() => {
    const originals: Partial<Record<LogLevel, (...args: unknown[]) => void>> = {};
    const scheduleBump = (): void => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        bump();
      });
    };
    const push = (level: LogLevel, args: unknown[]): void => {
      if (capturingRef.current) return;
      capturingRef.current = true;
      try {
        const entry: LogEntry = {
          id: nextId++,
          level,
          message: formatArgs(args),
          timeMs: Date.now(),
        };
        const next = entriesRef.current.concat(entry);
        entriesRef.current =
          next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
        scheduleBump();
      } finally {
        capturingRef.current = false;
      }
    };

    for (const level of LEVELS) {
      const original = console[level].bind(console);
      originals[level] = original as (...args: unknown[]) => void;
      console[level] = (...args: unknown[]) => {
        originals[level]?.(...args);
        push(level, args);
      };
    }

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      for (const level of LEVELS) {
        const original = originals[level];
        if (original) console[level] = original as typeof console.log;
      }
    };
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !stickToBottomRef.current) return;
    list.scrollTop = list.scrollHeight;
  }, [revision]);

  const entries = entriesRef.current;

  return (
    <div className="ed-console">
      <div className="ed-console-toolbar">
        <span className="ed-console-hint">Editor log sink</span>
        <button
          type="button"
          className="ed-btn"
          title="Clear console"
          onClick={() => {
            entriesRef.current = [];
            bump();
          }}
        >
          Clear
        </button>
      </div>
      <div
        className="ed-console-list"
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {entries.length === 0 ? (
          <div className="ed-empty-note">
            Console — log, warn, and error output appears here.
          </div>
        ) : (
          entries.map((entry) => {
            const time = new Date(entry.timeMs);
            const stamp = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;
            return (
              <div
                key={entry.id}
                className={`ed-console-line ed-console-${entry.level}`}
              >
                <span className="ed-console-time">{stamp}</span>
                <span className="ed-console-level">{entry.level}</span>
                <span className="ed-console-msg">{entry.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
