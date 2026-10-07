import { ContactParticipantResponse } from '@moodboard/contracts';
import { BoardParticipantEntity } from '@moodboard/database';
export type ContactAssignment = Omit<BoardParticipantEntity, 'contactId' | 'role'> & {
  contactId: string;
  role: 'viewer' | 'approver';
};
export function participantResponse(p: ContactAssignment): ContactParticipantResponse {
  return {
    id: p.id,
    boardId: p.boardId,
    contactId: p.contactId,
    role: p.role,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    revokedAt: p.revokedAt?.toISOString() ?? null,
    joinedAt: p.joinedAt.toISOString(),
  };
}
