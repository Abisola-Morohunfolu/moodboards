import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const cursorSchema = z.strictObject({
  scope: z.string(),
  type: z.enum(['board', 'item']),
  time: z.iso.datetime(),
  id: z.uuid(),
});
export type PageCursor = z.infer<typeof cursorSchema>;
export function encodeCursor(value: PageCursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
export function decodeCursor(value: string | undefined, scope: string): PageCursor | null {
  if (!value) {
    return null;
  }
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString()));
    if (cursor.scope !== scope) {
      throw new Error('Cursor scope changed');
    }
    return cursor;
  } catch {
    throw new BadRequestException('Invalid pagination cursor');
  }
}
