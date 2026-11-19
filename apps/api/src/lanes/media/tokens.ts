import { SignJWT, jwtVerify } from 'jose';

/**
 * Short-lived, single-object media links (`/v1/media/:id?t=...`) so `<img src>` works without
 * an Authorization header. The token is server-signed, bound to one media id and one tenant, and
 * uses its own audience and key, so it can never be replayed as a session token (or vice versa).
 */
const ISSUER = 'seb-orchard';
const AUDIENCE = 'seb-orchard:media';

export interface MediaGrant {
  mediaId: string;
  tenantId: string;
}

export class MediaTokens {
  private readonly key: Uint8Array;
  constructor(secret: string, private readonly ttlSec: number) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(g: MediaGrant, now = Date.now()): Promise<{ token: string; expiresAt: string }> {
    const exp = Math.floor(now / 1000) + this.ttlSec;
    const token = await new SignJWT({ tid: g.tenantId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(g.mediaId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(exp)
      .sign(this.key);
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** Returns the grant, or null for a bad/expired token or one minted for another object. */
  async verify(token: string, mediaId: string): Promise<MediaGrant | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      if (payload.sub !== mediaId || typeof payload.tid !== 'string') return null;
      return { mediaId, tenantId: payload.tid };
    } catch {
      return null;
    }
  }
}
