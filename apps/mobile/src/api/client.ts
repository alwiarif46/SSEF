import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import type { ReferenceBundle } from '@orchard/reference';
import type { Role } from '@orchard/domain';

const TOKEN_KEY = 'seb.token';
const API_KEY = 'seb.apiUrl';

export interface User { id: string; name: string; phone: string; role: Role; tenant_id?: string }
export interface Tenant { id: string; name: string; plan?: string }

let token: string | null = null;
let baseUrl: string = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? 'http://10.0.2.2:8080';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export async function loadSession(): Promise<string | null> {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  const url = await SecureStore.getItemAsync(API_KEY);
  if (url) baseUrl = url;
  return token;
}

export async function setToken(t: string | null) {
  token = t;
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export const getToken = () => token;
export const getBaseUrl = () => baseUrl;
export async function setBaseUrl(url: string) {
  baseUrl = url.replace(/\/$/, '');
  await SecureStore.setItemAsync(API_KEY, baseUrl);
}

export async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; data: T; headers: Headers }> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path.startsWith('http') ? path : `${baseUrl}${path}`, { ...init, headers, body });
  if (res.status === 304) return { status: 304, data: undefined as T, headers: res.headers };
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T) : (undefined as T);
  if (!res.ok) {
    const msg = (data as { error?: string; message?: string } | undefined)?.message ?? (data as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, data);
  }
  return { status: res.status, data, headers: res.headers };
}

export const api = {
  signup: (b: { tenantName: string; name: string; phone: string; password: string }) =>
    request<{ token: string; user: User; tenant: Tenant }>('/v1/auth/signup', { method: 'POST', json: b }).then((r) => r.data),
  login: (b: { phone: string; password: string }) => request<{ token: string; user: User }>('/v1/auth/login', { method: 'POST', json: b }).then((r) => r.data),
  me: () => request<{ user: User; tenant: Tenant }>('/v1/me').then((r) => r.data),
  users: () => request<User[] | { users: User[] }>('/v1/users').then((r) => (Array.isArray(r.data) ? r.data : r.data.users)),
  createUser: (b: { name: string; phone: string; password: string; role: Role }) => request<User>('/v1/users', { method: 'POST', json: b }).then((r) => r.data),
  pushToken: (b: { token: string; platform: string }) => request('/v1/push-tokens', { method: 'POST', json: b }),
  reference: (etag?: string) =>
    request<ReferenceBundle>('/v1/reference/current', { headers: etag ? { 'If-None-Match': etag } : {} }).then((r) => ({
      status: r.status,
      bundle: r.data,
      etag: r.headers.get('etag') ?? undefined,
    })),
};
