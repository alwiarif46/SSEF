import React, { createContext, useContext, useEffect, useState } from 'react';
import { BUNDLE_2026, validateBundle, type ReferenceBundle } from '@orchard/reference';
import { meta } from '../db';
import { api } from '../api/client';

const KEY = 'reference.bundle';
const ETAG = 'reference.etag';

const Ctx = createContext<{ bundle: ReferenceBundle; refresh: () => Promise<void>; source: 'bundled' | 'cached' | 'server' }>({
  bundle: BUNDLE_2026,
  refresh: async () => {},
  source: 'bundled',
});

/** Bundled 2026 schedule as fallback; cached server copy wins; refreshed with ETag when online. */
export function ReferenceProvider({ children }: { children: React.ReactNode }) {
  const [bundle, setBundle] = useState<ReferenceBundle>(BUNDLE_2026);
  const [source, setSource] = useState<'bundled' | 'cached' | 'server'>('bundled');

  const refresh = async () => {
    try {
      const etag = await meta.get<string>(ETAG);
      const r = await api.reference(etag);
      if (r.status === 304 || !r.bundle) return;
      if (validateBundle(r.bundle).length) return; // never adopt a broken bundle
      setBundle(r.bundle);
      setSource('server');
      await meta.set(KEY, r.bundle);
      if (r.etag) await meta.set(ETAG, r.etag);
    } catch {
      // offline — keep cached/bundled copy
    }
  };

  useEffect(() => {
    void (async () => {
      const cached = await meta.get<ReferenceBundle>(KEY);
      if (cached && !validateBundle(cached).length) {
        setBundle(cached);
        setSource('cached');
      }
      await refresh();
    })();
  }, []);

  return <Ctx.Provider value={{ bundle, refresh, source }}>{children}</Ctx.Provider>;
}

export const useReference = () => useContext(Ctx);
