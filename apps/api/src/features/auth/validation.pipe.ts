import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

export class SchemaPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException('Invalid request');
    }
    return result.data;
  }
}
