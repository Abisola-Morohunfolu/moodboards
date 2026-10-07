import {
  matchingApproval,
  sectionApprovals,
  decisionAttempt,
} from '../apps/web/src/features/board/approvals';
import type { DecisionRequest } from '@moodboard/contracts';

const item = {
  id: '33333333-3333-4333-8333-333333333333',
  version: 2,
  sectionId: null,
  deletedAt: null,
};
const pending = { itemId: item.id, itemVersion: 2, status: 'pending' as const };
const input: DecisionRequest = {
  id: '44444444-4444-4444-8444-444444444444',
  itemId: item.id,
  itemVersion: 2,
  status: 'swap_requested',
  comment: '  A warmer color please  ',
};

describe('Web approval consistency and submissions', () => {
  it('matches both identity and content version, including an unknown read', () => {
    expect(matchingApproval(item, [pending])).toBe(pending);
    expect(matchingApproval({ ...item, version: 3 }, [pending])).toBeUndefined();
    expect(matchingApproval({ ...item, id: 'another' }, [pending])).toBeUndefined();
    expect(matchingApproval(item)).toBeUndefined();
  });
  it('counts the selected section, excludes tombstones, and does not infer pending for unknown versions', () => {
    const items = [
      item,
      { ...item, id: 'unknown' },
      { ...item, id: 'deleted', deletedAt: '2026-10-07' },
      { ...item, id: 'other', sectionId: 'section' },
    ];
    expect(sectionApprovals(items, [pending], null, 'all').counts).toEqual({
      all: 2,
      pending: 1,
      approved: 0,
      rejected: 0,
      swap_requested: 0,
    });
    expect(sectionApprovals(items, [pending], null, 'pending').items).toEqual([item]);
    expect(sectionApprovals(items, undefined, null, 'pending').items).toEqual([]);
    expect(items).toHaveLength(4);
  });
  it('filters named sections by exact status and preserves item content and positions', () => {
    const positioned = { ...item, sectionId: 'section', x: 84, y: 101 };
    const result = sectionApprovals(
      [positioned, item],
      [{ ...pending, status: 'swap_requested' }],
      'section',
      'swap_requested',
    );
    expect(result.items).toEqual([positioned]);
    expect(result.items[0]).toBe(positioned);
    expect(result.counts.swap_requested).toBe(1);
    expect(
      sectionApprovals([positioned], [{ ...pending, status: 'rejected' }], 'section', 'approved')
        .items,
    ).toEqual([]);
  });
  it('requires a nonempty swap comment and enforces the backend comment length', () => {
    expect(() => decisionAttempt({ ...input, comment: '   ' })).toThrow();
    expect(() => decisionAttempt({ ...input, comment: 'a'.repeat(2001) })).toThrow();
    expect(decisionAttempt({ ...input, comment: 'a'.repeat(2000) }).comment).toHaveLength(2000);
    expect(decisionAttempt({ ...input, status: 'approved', comment: null }).comment).toBeNull();
    expect(decisionAttempt({ ...input, status: 'rejected', comment: null }).status).toBe(
      'rejected',
    );
  });
  it('snapshots and freezes a trimmed request so retries cannot use an edited draft or newer version', () => {
    const draft = { ...input };
    const attempt = decisionAttempt(draft);
    const wire = JSON.stringify(attempt);
    draft.comment = 'A changed draft';
    draft.itemVersion = 3;
    draft.status = 'approved';
    expect(Object.isFrozen(attempt)).toBe(true);
    expect(JSON.stringify(attempt)).toBe(wire);
    expect(attempt).toEqual({ ...input, comment: 'A warmer color please' });
    expect(attempt.id).toBe(input.id);
  });
});
