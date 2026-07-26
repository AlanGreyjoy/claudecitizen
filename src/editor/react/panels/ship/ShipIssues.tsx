import { useEffect, useState, type ReactElement } from 'react';
import { UiIcons } from '../../../../ui/icons';
import { UiIcon } from '../../UiIcon';
import type { ShipIssueList } from './types';

/**
 * Ship authoring problems, worst first. Summary stays in the bar; the list is a
 * dropdown so a long alert stack never permanently eats chrome. Empty is the
 * good state and says so — a silent bar reads as "not checked yet".
 */
export function ShipIssues({
  state,
  onRefresh,
}: {
  state: ShipIssueList;
  onRefresh: () => void;
}): ReactElement {
  const blockers = state.issues.filter((issue) => issue.severity === 'blocker');
  const warnings = state.issues.filter((issue) => issue.severity === 'warning');
  const ordered = [...blockers, ...warnings];
  const hasList = ordered.length > 0;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!hasList) setOpen(false);
  }, [hasList]);

  const summary = state.building
    ? 'Checking…'
    : state.error
      ? state.error
      : !state.checkedPrefabId
        ? 'Not checked'
        : !hasList
          ? 'Ready to test'
          : `${blockers.length} blocking · ${warnings.length} warning`;

  const tone = state.error || blockers.length > 0
    ? ' is-error'
    : hasList
      ? ' is-warn'
      : '';

  return (
    <div className={`ed-ship-issues${open && hasList ? ' is-open' : ''}`}>
      <button
        type="button"
        className={`ed-btn ed-ship-issues-summary${tone}`}
        aria-expanded={hasList ? open : undefined}
        onClick={() => {
          if (hasList) setOpen((prev) => !prev);
          else onRefresh();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onRefresh();
        }}
        title={
          hasList
            ? open
              ? 'Hide issues (right-click to re-check)'
              : 'Show issues (right-click to re-check)'
            : 'Rebuild this ship\'s layout and re-check it'
        }
      >
        {summary}
        {hasList ? (
          <UiIcon
            icon={open ? UiIcons.chevronDown : UiIcons.chevronRight}
            className="ed-ship-issues-chevron"
            size={12}
            strokeWidth={2}
          />
        ) : null}
      </button>
      {open && hasList ? (
        <ul className="ed-ship-issue-list">
          {ordered.map((issue) => (
            <li
              key={issue.message}
              className={`ed-ship-issue${issue.severity === 'blocker' ? ' is-blocker' : ''}`}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
