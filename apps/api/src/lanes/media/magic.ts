/** Content sniffing: the stored type is decided by the file's leading bytes, never by the client's header. */
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const isMediaType = (s: string): s is MediaType => (MEDIA_TYPES as readonly string[]).includes(s);

const startsWith = (b: Buffer, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);

export function sniff(b: Buffer): MediaType | null {
  // JPEG: SOI marker followed by another marker.
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // PNG: fixed 8-byte signature.
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // WebP: RIFF....WEBP
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  // PDF: "%PDF-" at offset 0 (leading junk, which some readers tolerate, is rejected).
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

export const kindFor = (t: MediaType): 'photo' | 'document' => (t === 'application/pdf' ? 'document' : 'photo');
