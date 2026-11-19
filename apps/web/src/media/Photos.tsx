import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../ui';
import { downscaleImage, isPhotoRef, signedUrls, type PhotoEntry } from './media';
import './media.css';

export interface PendingPhoto { key: string; blob: Blob; preview: string; name: string }

/** Camera / file picker that downscales each photo client-side and keeps them pending until the form is saved. */
export function PhotoPicker({ value, onChange, disabled, max = 6 }: { value: PendingPhoto[]; onChange: (v: PendingPhoto[]) => void; disabled?: boolean; max?: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => () => value.forEach((p) => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setErr(null);
    const next = [...value];
    try {
      for (const f of Array.from(files).slice(0, Math.max(0, max - value.length))) {
        const blob = await downscaleImage(f);
        next.push({ key: crypto.randomUUID(), blob, preview: URL.createObjectURL(blob), name: f.name.replace(/\.[^.]+$/, '') + '.jpg' });
      }
      onChange(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const remove = (k: string) => {
    const p = value.find((x) => x.key === k);
    if (p) URL.revokeObjectURL(p.preview);
    onChange(value.filter((x) => x.key !== k));
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <button type="button" className="btn" disabled={disabled || busy || value.length >= max} onClick={() => input.current?.click()}>📷 {busy ? 'Preparing…' : 'Add photo'}</button>
        <span className="faint">{value.length ? `${value.length} photo${value.length > 1 ? 's' : ''} attached` : 'Leaf, fruit or trap close-ups help later diagnosis.'}</span>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple hidden onChange={(e) => void add(e.target.files)} />
      </div>
      {err && <div className="faint" style={{ color: 'var(--bad)' }}>{err}</div>}
      {value.length > 0 && (
        <div className="media-strip">
          {value.map((p) => (
            <div key={p.key} className="media-thumb">
              <img src={p.preview} alt="Photo to upload" />
              <button type="button" className="media-x" aria-label="Remove photo" onClick={() => remove(p.key)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Thumbnails for stored photos; click opens a viewer. Device-local URIs show as "pending upload". */
export function PhotoStrip({ photos, size = 48 }: { photos: PhotoEntry[]; size?: number }) {
  const ids = useMemo(() => photos.filter(isPhotoRef).map((p) => p.mediaId), [photos]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const idKey = ids.join(',');
  useEffect(() => {
    if (!ids.length) return;
    let live = true;
    signedUrls(ids).then((u) => { if (live) setUrls(u); }).catch(() => { /* thumbnails are best-effort */ });
    return () => { live = false; };
  }, [idKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!photos.length) return null;
  const pending = photos.filter((p) => typeof p === 'string').length;
  return (
    <>
      <div className="media-strip">
        {photos.filter(isPhotoRef).map((p) => (
          <button key={p.mediaId} type="button" className="media-thumb" style={{ width: size, height: size }} onClick={() => setOpen(p.mediaId)} aria-label="View photo">
            {urls[p.mediaId] ? <img src={urls[p.mediaId]} alt="Scouting photo" loading="lazy" /> : <span className="media-missing">…</span>}
          </button>
        ))}
        {pending > 0 && <span className="badge" title="Taken on a phone; uploads when it is next online">{pending} pending upload</span>}
      </div>
      {open && (
        <Dialog title="Photo" onClose={() => setOpen(null)}>
          {urls[open] ? <img className="media-full" src={urls[open]} alt="Scouting photo" /> : <div className="faint">Photo unavailable.</div>}
        </Dialog>
      )}
    </>
  );
}
