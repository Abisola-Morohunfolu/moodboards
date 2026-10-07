import { BoardResponse } from '@moodboard/contracts';
import { BoardEntity } from '@moodboard/database';
export function boardResponse(board: BoardEntity): BoardResponse {
  return {
    id: board.id,
    workspaceId: board.workspaceId,
    clientId: board.clientId,
    kitId: board.kitId,
    title: board.title,
    layout: board.layout,
    currency: board.currency,
    generalAccess: board.generalAccess,
    workspaceDefaultRole: board.workspaceDefaultRole,
    showPricesTo: board.showPricesTo,
    eventSeq: board.eventSeq,
    lockedAt: board.lockedAt?.toISOString() ?? null,
    archivedAt: board.archivedAt?.toISOString() ?? null,
    createdBy: board.createdBy,
    createdAt: board.createdAt.toISOString(),
  };
}
