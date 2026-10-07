import type { ApprovalStatus as Status, PlannerApproval } from '@moodboard/contracts';
import { SecondaryButton } from '@moodboard/ui';
import { approvalLabels, type ApprovalFilter } from './approvals';

export function ApprovalStatus({ status }: { status: Status }) {
  return (
    <span
      className={`inline-block text-xs font-semibold ${status === 'rejected' || status === 'swap_requested' ? 'text-danger' : 'text-muted'}`}
    >
      {approvalLabels[status]}
    </span>
  );
}

export function ApprovalFilters({
  filter,
  counts,
  onChange,
  disabled,
}: {
  filter: ApprovalFilter;
  counts: Record<ApprovalFilter, number>;
  onChange: (filter: ApprovalFilter) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-5 py-2">
      <label className="flex items-center gap-2 text-sm">
        Approval status
        <select
          aria-label="Filter approval status"
          value={filter}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as ApprovalFilter)}
          className="min-h-11 border border-line px-3"
        >
          <option value="all">All items ({counts.all})</option>
          {Object.entries(approvalLabels).map(([status, label]) => (
            <option key={status} value={status}>
              {label}
              {disabled ? '' : ` (${counts[status as Status]})`}
            </option>
          ))}
        </select>
      </label>
      {!disabled && (
        <p className="text-xs text-muted" aria-live="polite">
          {counts.approved} approved · {counts.pending} pending ·{' '}
          {counts.rejected + counts.swap_requested} need changes
        </p>
      )}
    </div>
  );
}

export function ApprovalReadNotice({
  loading,
  error,
  syncing,
  retry,
}: {
  loading: boolean;
  error: boolean;
  syncing: boolean;
  retry: () => void;
}) {
  if (!loading && !error && !syncing) {
    return null;
  }
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-5 py-3 text-sm text-muted"
      role={error ? 'alert' : 'status'}
    >
      <p>
        {error
          ? 'Approval status is unavailable. Your board is still here.'
          : loading
            ? 'Loading approval status…'
            : 'Refreshing approval status for the latest items…'}
      </p>
      {(error || syncing) && <SecondaryButton onClick={retry}>Retry</SecondaryButton>}
    </div>
  );
}

export function PlannerFeedback({ approval }: { approval: PlannerApproval }) {
  return (
    <section className="mt-6 border-t border-line pt-5" aria-label="Client feedback">
      <h3 className="text-sm font-semibold">Client feedback</h3>
      <div className="mt-2">
        <ApprovalStatus status={approval.status} />
      </div>
      <p className="mt-2 text-xs leading-5 text-muted">
        Content edits start a new approval round. Moving this item keeps its approval.
      </p>
      {approval.decisions.length ? (
        <ul className="mt-4 divide-y divide-line">
          {approval.decisions.map((decision) => (
            <li key={decision.id} className="py-3">
              <p className="break-words text-sm font-semibold">{decision.contactName}</p>
              <ApprovalStatus status={decision.status} />
              {decision.comment && (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                  {decision.comment}
                </p>
              )}
              <time dateTime={decision.decidedAt} className="mt-2 block text-xs text-muted">
                {new Date(decision.decidedAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">
          No decisions on this version yet. Every current approver must approve before sign-off.
        </p>
      )}
    </section>
  );
}
