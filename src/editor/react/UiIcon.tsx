import { createElement, type ReactElement } from 'react';
import type { IconNode } from 'lucide';

export type UiIconProps = {
  icon: IconNode;
  className?: string;
  size?: number;
  strokeWidth?: number;
};

/** React wrapper for Lucide `IconNode` (same icons as `src/ui/icons.ts`). */
export function UiIcon({
  icon,
  className = 'ed-ui-icon',
  size = 14,
  strokeWidth = 2,
}: UiIconProps): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {icon.map(([tag, attrs], index) =>
        createElement(tag, { key: index, ...attrs }),
      )}
    </svg>
  );
}
