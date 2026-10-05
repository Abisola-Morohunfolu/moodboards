import { randomUUID } from 'node:crypto';
import {
  createClientRequestSchema,
  createContactRequestSchema,
  clientListQuerySchema,
  assignContactRequestSchema,
  updateContactParticipantRequestSchema,
} from './clients';
describe('Client access contracts', () => {
  it('normalizes names and optional email, and validates list flags', () => {
    expect(createClientRequestSchema.parse({ name: ' Client ' })).toEqual({ name: 'Client' });
    expect(createContactRequestSchema.parse({ name: ' Ada ', email: ' ADA@example.COM ' })).toEqual(
      { name: 'Ada', email: 'ada@example.com' },
    );
    expect(clientListQuerySchema.parse({})).toEqual({ includeArchived: false });
    expect(clientListQuerySchema.parse({ includeArchived: 'true' })).toEqual({
      includeArchived: true,
    });
    expect(clientListQuerySchema.safeParse({ includeArchived: 'yes' }).success).toBe(false);
  });
  it('rejects empty names, unsupported fields, and elevated contact roles', () => {
    expect(createClientRequestSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createClientRequestSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false);
    expect(
      createContactRequestSchema.safeParse({ name: 'Ada', userId: randomUUID() }).success,
    ).toBe(false);
    for (const role of ['owner', 'editor']) {
      expect(assignContactRequestSchema.safeParse({ contactId: randomUUID(), role }).success).toBe(
        false,
      );
    }
    expect(updateContactParticipantRequestSchema.safeParse({}).success).toBe(false);
    expect(updateContactParticipantRequestSchema.safeParse({ role: undefined }).success).toBe(
      false,
    );
    expect(updateContactParticipantRequestSchema.safeParse({ expiresAt: 'tomorrow' }).success).toBe(
      false,
    );
  });
});
