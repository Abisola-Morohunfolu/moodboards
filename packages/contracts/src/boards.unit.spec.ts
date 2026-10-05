import { randomUUID } from 'node:crypto';
import {
  boardCoreEventSchema,
  createBoardRequestSchema,
  createNoteRequestSchema,
  createSectionRequestSchema,
  moveNoteRequestSchema,
  updateBoardRequestSchema,
  updateNoteRequestSchema,
  updateSectionRequestSchema,
} from './boards';

describe('Board core contracts', () => {
  const board = { workspaceId: randomUUID(), title: '  Wedding  ' };
  const note = { id: randomUUID(), kind: 'note', zOrder: 'a0', note: '  preserve\nwhitespace  ' };
  it('normalizes names and preserves note content', () => {
    expect(createBoardRequestSchema.parse(board).title).toBe('Wedding');
    expect(createSectionRequestSchema.parse({ name: ' Ceremony ', position: 'a0' }).name).toBe(
      'Ceremony',
    );
    expect(createNoteRequestSchema.parse(note).note).toBe(note.note);
  });
  it('rejects unsupported kits, kinds, and fields', () => {
    expect(createBoardRequestSchema.safeParse({ ...board, kitId: 'events' }).success).toBe(false);
    expect(createBoardRequestSchema.safeParse({ ...board, clientId: 'invalid' }).success).toBe(
      false,
    );
    expect(createNoteRequestSchema.safeParse({ ...note, kind: 'image' }).success).toBe(false);
    expect(createNoteRequestSchema.safeParse({ ...note, createdBy: randomUUID() }).success).toBe(
      false,
    );
  });
  it('rejects empty patches and content without a version', () => {
    for (const schema of [
      updateBoardRequestSchema,
      updateSectionRequestSchema,
      moveNoteRequestSchema,
    ]) {
      expect(schema.safeParse({}).success).toBe(false);
    }
    expect(updateNoteRequestSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateNoteRequestSchema.safeParse({ version: 1, note: undefined }).success).toBe(false);
    expect(updateNoteRequestSchema.safeParse({ note: 'edit' }).success).toBe(false);
    expect(updateNoteRequestSchema.safeParse({ note: 'edit', version: 1 }).success).toBe(true);
    expect(moveNoteRequestSchema.safeParse({ x: 1, version: 1 }).success).toBe(false);
  });
  it.each([
    { x: Infinity },
    { y: NaN },
    { x: 1e39 },
    { priceCents: -1 },
    { priceCents: 2147483648 },
    { quantity: 0 },
    { quantity: 1.5 },
    { zOrder: 'a 0' },
    { sectionId: 'bad' },
    { note: 'x'.repeat(20001) },
  ])('rejects invalid note fields %j', (fields) => {
    expect(createNoteRequestSchema.safeParse({ ...note, ...fields }).success).toBe(false);
  });
  it.each([1e-50, -1e-50, 1e-46, -1e-46, Number.MIN_VALUE, -Number.MIN_VALUE])(
    'rejects coordinates that underflow Postgres real: %s',
    (value) => {
      for (const field of ['x', 'y']) {
        expect(createNoteRequestSchema.safeParse({ ...note, [field]: value }).success).toBe(false);
        expect(moveNoteRequestSchema.safeParse({ [field]: value }).success).toBe(false);
      }
    },
  );
  it.each([0, 1e-45, -1e-45])('accepts zero and representable small coordinates: %s', (value) => {
    expect(createNoteRequestSchema.safeParse({ ...note, x: value, y: value }).success).toBe(true);
    expect(moveNoteRequestSchema.safeParse({ x: value, y: value }).success).toBe(true);
  });
  it('limits event payloads to typed metadata without content or prices', () => {
    const event = {
      type: 'item.updated',
      payload: { itemId: note.id, version: 2, changedFields: ['priceCents'] },
    };
    expect(boardCoreEventSchema.safeParse(event).success).toBe(true);
    expect(
      boardCoreEventSchema.safeParse({ ...event, payload: { ...event.payload, priceCents: 20 } })
        .success,
    ).toBe(false);
  });
});
