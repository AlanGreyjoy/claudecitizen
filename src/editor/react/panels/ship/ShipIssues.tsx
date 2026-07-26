import type { ReactElement } from 'react';
import type { ShipIssueList } from './types';

/**
 * Ship authoring problems, worst first. Empty is the good state and says so —
 * a silent bar reads as "not checked yet".
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

  const summary = state.building
    ? 'Checking…'
    : state.error
      ? state.error
      : !state.checkedPrefabId
        ? 'Not checked'
        : ordered.length === 0
          ? 'Ready to test'
          : `${blockers.length} blocking · ${warnings.length} warning`;

  const tone = state.error || blockers.length > 0
    ? ' is-error'
    : ordered.length > 0
      ? ' is-warn'
      : '';

  return (
    <div className="ed-ship-issues">
      <button
        type="button"
        className={`ed-btn ed-ship-issues-summary${tone}`}
        onClick={onRefresh}
        title="Rebuild this ship's layout and re-check it"
      >
        {summary}
      </button>
      {ordered.length > 0 ? (
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
