import { BoardRole } from '@moodboard/contracts';
import { BoardAccessState, hasBoardPermission, resolveAccountBoardRole } from './board-role';

describe('Account board authorization', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  const base: BoardAccessState = {
    workspaceType: 'personal',
    workspaceRole: 'owner',
    generalAccess: 'restricted',
    workspaceDefaultRole: 'editor',
    participant: null,
    lockedAt: null,
    archivedAt: null,
  };
  it('does not grant personal owners access to restricted boards or accounts access through links', () => {
    expect(resolveAccountBoardRole(base, now)).toBeNull();
    expect(resolveAccountBoardRole({ ...base, generalAccess: 'link' }, now)).toBeNull();
  });
  it.each<BoardRole>(['viewer', 'approver', 'editor', 'owner'])(
    'honors an explicit %s role without workspace membership',
    (role) => {
      expect(
        resolveAccountBoardRole(
          { ...base, workspaceRole: null, participant: { role, revokedAt: null, expiresAt: null } },
          now,
        ),
      ).toBe(role);
      expect(hasBoardPermission(role, 'board.view')).toBe(true);
      for (const permission of ['item.create', 'item.edit', 'item.move', 'item.delete'] as const) {
        expect(hasBoardPermission(role, permission)).toBe(role === 'editor' || role === 'owner');
      }
      expect(hasBoardPermission(role, 'board.share')).toBe(role === 'owner');
    },
  );
  it('uses the highest candidate and treats role-null rows only as identities', () => {
    expect(
      resolveAccountBoardRole(
        {
          ...base,
          generalAccess: 'workspace',
          participant: { role: 'viewer', revokedAt: null, expiresAt: null },
        },
        now,
      ),
    ).toBe('editor');
    expect(
      resolveAccountBoardRole(
        { ...base, participant: { role: null, revokedAt: null, expiresAt: null } },
        now,
      ),
    ).toBeNull();
  });
  it.each(['revoked', 'expired'] as const)(
    '%s participants lose general access except business recovery owners',
    (condition) => {
      const state: BoardAccessState = {
        ...base,
        generalAccess: 'workspace',
        participant: {
          role: 'owner',
          revokedAt: condition === 'revoked' ? now : null,
          expiresAt: condition === 'expired' ? now : null,
        },
      };
      expect(resolveAccountBoardRole(state, now)).toBeNull();
      expect(resolveAccountBoardRole({ ...state, workspaceType: 'business' }, now)).toBe('owner');
    },
  );
  it.each(['lockedAt', 'archivedAt'] as const)('caps owners at viewer for %s', (field) => {
    expect(resolveAccountBoardRole({ ...base, workspaceType: 'business', [field]: now }, now)).toBe(
      'viewer',
    );
  });
});
