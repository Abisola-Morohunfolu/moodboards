import { BoardRole } from '@moodboard/contracts';

export type BoardPermission =
  'board.view' | 'board.share' | 'item.create' | 'item.edit' | 'item.move' | 'item.delete';
export const roleRank: Record<BoardRole, number> = { viewer: 0, approver: 1, editor: 2, owner: 3 };
export interface BoardAccessState {
  workspaceType: 'personal' | 'business';
  workspaceRole: 'owner' | 'staff' | 'partner' | null;
  generalAccess: 'restricted' | 'workspace' | 'link';
  workspaceDefaultRole: BoardRole;
  participant: { role: BoardRole | null; revokedAt: Date | null; expiresAt: Date | null } | null;
  lockedAt: Date | null;
  archivedAt: Date | null;
}

export function resolveAccountBoardRole(
  state: BoardAccessState,
  now = new Date(),
): BoardRole | null {
  const recoveryOwner = state.workspaceType === 'business' && state.workspaceRole === 'owner';
  const participant = state.participant;
  const blocked =
    participant !== null &&
    (participant.revokedAt !== null ||
      (participant.expiresAt !== null && participant.expiresAt.getTime() <= now.getTime()));
  if (blocked && !recoveryOwner) {
    return null;
  }
  const candidates: BoardRole[] = [];
  if (recoveryOwner) {
    candidates.push('owner');
  }
  if (!blocked && participant?.role) {
    candidates.push(participant.role);
  }
  if (!blocked && state.workspaceRole && state.generalAccess === 'workspace') {
    candidates.push(state.workspaceDefaultRole);
  }
  const role = candidates.sort((a, b) => roleRank[b] - roleRank[a])[0] ?? null;
  if (role !== null && (state.lockedAt !== null || state.archivedAt !== null)) {
    return 'viewer';
  }
  return role;
}

export function hasBoardPermission(role: BoardRole, permission: BoardPermission): boolean {
  const minimum =
    permission === 'board.view' ? 'viewer' : permission === 'board.share' ? 'owner' : 'editor';
  return roleRank[role] >= roleRank[minimum];
}
