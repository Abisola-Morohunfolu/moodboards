import {
  decisionRequestSchema,
  type ApprovalStatus,
  type DecisionRequest,
} from '@moodboard/contracts';

export const approvalLabels: Record<ApprovalStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  swap_requested: 'Swap requested',
};
export type ApprovalFilter = ApprovalStatus | 'all';
type VersionedItem = {
  id: string;
  version: number;
  sectionId: string | null;
  deletedAt: string | null;
};
type VersionedApproval = { itemId: string; itemVersion: number; status: ApprovalStatus };

export function matchingApproval<T extends VersionedApproval>(
  item: Pick<VersionedItem, 'id' | 'version'>,
  approvals?: readonly T[],
): T | undefined {
  return approvals?.find(
    (approval) => approval.itemId === item.id && approval.itemVersion === item.version,
  );
}

export function sectionApprovals<T extends VersionedItem>(
  items: readonly T[],
  approvals: readonly VersionedApproval[] | undefined,
  sectionId: string | null,
  filter: ApprovalFilter,
) {
  const section = items.filter((item) => !item.deletedAt && item.sectionId === sectionId);
  const counts: Record<ApprovalFilter, number> = {
    all: section.length,
    pending: 0,
    approved: 0,
    rejected: 0,
    swap_requested: 0,
  };
  for (const item of section) {
    const approval = matchingApproval(item, approvals);
    if (approval) {
      counts[approval.status] += 1;
    }
  }
  return {
    counts,
    items:
      filter === 'all'
        ? section
        : section.filter((item) => matchingApproval(item, approvals)?.status === filter),
  };
}

/** Capture a validated, immutable request once; ambiguous retries use this exact payload. */
export function decisionAttempt(input: DecisionRequest): Readonly<DecisionRequest> {
  return Object.freeze(decisionRequestSchema.parse(input));
}
