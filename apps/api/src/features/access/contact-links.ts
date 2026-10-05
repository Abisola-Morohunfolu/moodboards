import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiConfig } from '../../config';

export function contactSignature(secret: string, participantId: string, version: number): string {
  return createHmac('sha256', secret)
    .update(`contact-board:${participantId}:${version}`)
    .digest('base64url');
}
export function validContactSignature(
  secret: string,
  participantId: string,
  version: number,
  signature: string,
): boolean {
  const expected = Buffer.from(contactSignature(secret, participantId, version), 'base64url');
  const supplied = Buffer.from(signature, 'base64url');
  return (
    supplied.length === expected.length &&
    timingSafeEqual(expected, supplied) &&
    supplied.toString('base64url') === signature
  );
}
@Injectable()
export class ContactLinks {
  constructor(private readonly config: ConfigService<ApiConfig, true>) {}
  configuration() {
    const secret = this.config.get('LINK_SECRET', { infer: true });
    const baseUrl = this.config.get('PUBLIC_API_URL', { infer: true });
    if (!secret || !baseUrl) {
      throw new ServiceUnavailableException('Client links unavailable');
    }
    return { secret, baseUrl, fingerprint: createHash('sha256').update(secret).digest('hex') };
  }
  fingerprint(): string | undefined {
    const secret = this.config.get('LINK_SECRET', { infer: true });
    return secret ? createHash('sha256').update(secret).digest('hex') : undefined;
  }
  url(participantId: string, version: number): string {
    const { secret, baseUrl } = this.configuration();
    return `${baseUrl}/share/${participantId}.${contactSignature(secret, participantId, version)}`;
  }
}
