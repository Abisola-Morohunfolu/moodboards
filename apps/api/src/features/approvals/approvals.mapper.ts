import { ApprovalDecisionEntity } from '@moodboard/database';

export function decisionResponse(row: ApprovalDecisionEntity) {
  return {
    id: row.id,
    itemId: row.itemId,
    itemVersion: row.itemVersion,
    status: row.status,
    comment: row.comment,
    decidedAt: row.decidedAt.toISOString(),
  };
}
