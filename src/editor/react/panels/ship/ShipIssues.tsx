import { useEffect, useState, type ReactElement } from 'react';
import { UiIcons } from '../../../../ui/icons';
import { UiIcon } from '../../UiIcon';
import type { ShipIssueList } from './types';

function issueSummary(
  state: ShipIssueList,
  blockerCount: number,
  warningCount: number,
): string {
  if (state.building) return 'Checking…';
  if (state.error) return state.error;
  if (!state.checkedPrefabId) return 'Not checked';
  if (blockerCount + warningCount === 0) return 'Ready to test';
  return `${blockerCount} blocking · ${warningCount} warning`;
}

function issueTone(state: ShipIssueList, blockerCount: number, hasList: boolean): string {
  if (state.error || blockerCount > 0) return ' is-error';
  return hasList ? ' is-warn' : '';
}

function issueTitle(hasList: boolean, open: boolean): string {
  if (!hasList) return "Rebuild this ship's layout and re-check it";
  return open
    ? 'Hide issues (right-click to re-check)'
    : 'Show issues (opens with a fresh check)';
}

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

  const summary = issueSummary(state, blockers.length, warnings.length);
  const tone = issueTone(state, blockers.length, hasList);

  return (
    <div className={`ed-ship-issues${open && hasList ? ' is-open' : ''}`}>
      <button
        type="button"
        className={`ed-btn ed-ship-issues-summary${tone}`}
        aria-expanded={hasList ? open : undefined}
        onClick={() => {
          if (!hasList) {
            onRefresh();
            return;
          }
          setOpen((prev) => {
            const next = !prev;
            // Opening the list re-checks so seat/door edits are not stale.
            if (next) onRefresh();
            return next;
          });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onRefresh();
        }}
        title={issueTitle(hasList, open)}
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
