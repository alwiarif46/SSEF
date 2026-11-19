import { describe, expect, it } from 'vitest';
import { mergeIncoming } from '@orchard/domain';
import {
  MAX_ATTEMPTS, attemptKey, backoffMs, filePart, isLocalUri, isPermanent, localUris, normalizePhotos, pendingUploads, photoRef, pruneLog,
  recordFailure, recordSuccess, replaceLocal, uploadedRefs, type AttemptLog,
} from '../src/media/photos';

const ID = '0b6f4f5e-8f7a-4c1e-9a55-2d4c8f1e7a10';
const URI = 'file:///data/user/0/host.exp.exponent/cache/ImagePicker/1.jpg';

describe('photo references', () => {
  it('recognises local URIs vs uploaded refs', () => {
    expect(isLocalUri(URI)).toBe(true);
    expect(isLocalUri('content://media/external/images/1')).toBe(true);
    expect(isLocalUri('ph://ABC-123')).toBe(true);
    expect(isLocalUri('https://cdn.example.com/a.jpg')).toBe(false);
    expect(isLocalUri('/v1/media/abc')).toBe(false);
    expect(photoRef(ID)).toEqual({ url: `/v1/media/${ID}`, mediaId: ID });
    expect(Object.keys(photoRef(ID))).toEqual(['url', 'mediaId']);
  });

  it('normalises legacy string arrays, JSON strings and mixed content', () => {
    expect(normalizePhotos(null)).toEqual([]);
    expect(normalizePhotos('not json')).toEqual([]);
    expect(normalizePhotos(JSON.stringify([URI, URI]))).toEqual([URI]);
    // A ref written with the opposite key order is canonicalised and deduped.
    expect(normalizePhotos([{ mediaId: ID, url: 'x' }, photoRef(ID), 42, URI])).toEqual([photoRef(ID), URI]);
    expect(localUris([URI, photoRef(ID)])).toEqual([URI]);
    expect(uploadedRefs([URI, photoRef(ID)])).toEqual([photoRef(ID)]);
  });

  it('replaces a local URI in place, once', () => {
    expect(replaceLocal(['a://1', URI, 'b://2'], URI, ID)).toEqual(['a://1', photoRef(ID), 'b://2']);
    expect(replaceLocal([photoRef(ID)], URI, ID)).toBeNull();
    expect(replaceLocal([URI, photoRef(ID)], URI, ID)).toEqual([photoRef(ID)]);
  });

  it('device and server copies of a ref merge without duplicates under the field-merge policy', () => {
    // Server row (from jsonb) already has the ref; the device pushes its replaced array.
    const server = { photos: JSON.parse(JSON.stringify([{ url: `/v1/media/${ID}`, mediaId: ID }])) };
    const m = mergeIncoming('field_merge', server, { photos: replaceLocal([URI], URI, ID) }, ['photos'], true);
    expect(m.action).toBe('noop');
    // Photos still pending on the device are kept alongside uploaded refs.
    const stale = mergeIncoming('field_merge', { photos: [photoRef(ID)] }, { photos: [photoRef(ID), 'file:///other.jpg'] }, ['photos'], false);
    expect(stale.row?.photos).toEqual([photoRef(ID), 'file:///other.jpg']);
  });

  it('builds React Native FormData file parts', () => {
    expect(filePart(URI)).toEqual({ uri: URI, name: '1.jpg', type: 'image/jpeg' });
    expect(filePart('content://media/external/images/media/77')).toEqual({ uri: 'content://media/external/images/media/77', name: '77.jpg', type: 'image/jpeg' });
    expect(filePart('file:///x/shot.PNG?v=1').type).toBe('image/png');
  });
});

describe('upload retry queue', () => {
  const rows = [
    { table: 'scouting_observations' as const, id: 'obs-1', photos: [URI, photoRef(ID)] },
    { table: 'scouting_observations' as const, id: 'obs-2', photos: ['file:///b.jpg', 'file:///c.jpg'] },
    { table: 'chemical_inventory' as const, id: 'inv-1', photos: null },
  ];

  it('derives pending uploads from the records themselves', () => {
    const p = pendingUploads(rows, {}, 1000);
    expect(p.due.map((d) => `${d.recordId}:${d.uri}`)).toEqual([`obs-1:${URI}`, 'obs-2:file:///b.jpg', 'obs-2:file:///c.jpg']);
    expect(p).toMatchObject({ waiting: 0, failed: 0 });
  });

  it('backs off exponentially, gives up on permanent errors or after MAX_ATTEMPTS', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(50)).toBe(6 * 3_600_000);
    const k = attemptKey('scouting_observations', 'obs-2', 'file:///b.jpg');
    let log: AttemptLog = recordFailure({}, k, 0, 'Network request failed');
    expect(log[k]).toMatchObject({ attempts: 1, nextAt: 30_000 });
    expect(pendingUploads(rows, log, 10_000)).toMatchObject({ waiting: 1, failed: 0 });
    expect(pendingUploads(rows, log, 30_000).due).toHaveLength(3);
    const k2 = attemptKey('scouting_observations', 'obs-2', 'file:///c.jpg');
    log = recordFailure(log, k2, 0, 'unsupported file type', 415);
    expect(isPermanent(415)).toBe(true);
    expect(isPermanent(503)).toBe(false);
    expect(pendingUploads(rows, log, 1e12)).toMatchObject({ failed: 1 });
    let many: AttemptLog = {};
    for (let i = 0; i < MAX_ATTEMPTS; i++) many = recordFailure(many, k, 0, 'offline');
    expect(many[k]!.failed).toBe(true);
    expect(recordSuccess(log, k)[k]).toBeUndefined();
    expect(Object.keys(pruneLog(log, new Set([k2])))).toEqual([k2]);
  });
});
