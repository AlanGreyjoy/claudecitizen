import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

export type ImperativeMountResult = {
  dispose?: () => void;
} | void;

type ImperativeHostProps = {
  className?: string;
  hidden?: boolean;
  children?: ReactNode;
  /** Mount imperative UI into the host element. Re-runs when `deps` change. */
  mount: (host: HTMLElement) => ImperativeMountResult;
  deps?: ReadonlyArray<unknown>;
};

/**
 * Host div for factories that own DOM/WebGL (viewport, legacy panels, tab editors).
 * Clears the host and calls dispose on unmount / remount.
 */
export function ImperativeHost({
  className,
  hidden = false,
  children,
  mount,
  deps = [],
}: ImperativeHostProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef(mount);
  mountRef.current = mount;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    const result = mountRef.current(host);
    return () => {
      result?.dispose?.();
      host.replaceChildren();
    };
    // Mount identity is owned by callers via `deps`.
  }, deps);

  return (
    <div
      ref={hostRef}
      className={`${className ?? ''}${hidden ? ' is-hidden' : ''}`.trim()}
    >
      {children}
    </div>
  );
}
