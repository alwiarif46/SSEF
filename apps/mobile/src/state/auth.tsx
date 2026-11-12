import React, { createContext, useContext, useEffect, useState } from 'react';
import { roleAtLeast, type Role } from '@orchard/domain';
import { api, loadSession, setToken, type Tenant, type User } from '../api/client';
import { meta } from '../db';
import { database } from '../db';

interface AuthState {
  ready: boolean;
  user?: User;
  tenant?: Tenant;
  signedIn: boolean;
  can: (min: Role) => boolean;
  login: (phone: string, password: string) => Promise<void>;
  signup: (b: { tenantName: string; name: string; phone: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);
const USER_KEY = 'auth.user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User>();
  const [tenant, setTenant] = useState<Tenant>();

  useEffect(() => {
    void (async () => {
      const t = await loadSession();
      if (t) {
        const cached = await meta.get<{ user: User; tenant?: Tenant }>(USER_KEY);
        if (cached) {
          setUser(cached.user);
          setTenant(cached.tenant);
        }
        try {
          const me = await api.me(); // refresh role if online
          setUser(me.user);
          setTenant(me.tenant);
          await meta.set(USER_KEY, me);
        } catch {
          /* offline: keep cached identity */
        }
      }
      setReady(true);
    })();
  }, []);

  const value: AuthState = {
    ready,
    user,
    tenant,
    signedIn: !!user,
    can: (min) => !!user && roleAtLeast(user.role, min),
    login: async (phone, password) => {
      const r = await api.login({ phone, password });
      await setToken(r.token);
      const me = await api.me().catch(() => ({ user: r.user, tenant: undefined }));
      await meta.set(USER_KEY, me);
      setUser(me.user);
      setTenant(me.tenant);
    },
    signup: async (b) => {
      const r = await api.signup(b);
      await setToken(r.token);
      await meta.set(USER_KEY, { user: r.user, tenant: r.tenant });
      setUser(r.user);
      setTenant(r.tenant);
    },
    logout: async () => {
      await setToken(null);
      await meta.remove(USER_KEY);
      // Wipe local tenant data so another user on this device can't see it.
      await database.write(() => database.unsafeResetDatabase());
      setUser(undefined);
      setTenant(undefined);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
