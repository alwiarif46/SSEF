import type { AlertType } from '@orchard/domain';
import { z } from 'zod';

/** Alert types the worker emits (labels for UIs). */
export const ALERT_TYPES = [
  'scab_infection', 'protect_before_rain', 'codling_moth_dd', 'frost', 'hail', 'heat_stress', 'spray_window',
] as const satisfies readonly AlertType[];

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];
const rank = (s: string | undefined | null): number => {
  const i = SEVERITIES.indexOf((s ?? '') as Severity);
  return i < 0 ? 1 : i; // unknown severity is treated as 'medium'
};

export interface NotificationPrefs {
  /** null = every type. */
  alertTypes: string[] | null;
  minSeverity: Severity;
  /** 'HH:MM' IST; both null = no quiet hours. */
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  smsFallback: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = { alertTypes: null, minSeverity: 'low', quietHoursStart: null, quietHoursEnd: null, smsFallback: false };

const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'time must be HH:MM (24h)');

export const prefsBody = z.object({
  alertTypes: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/)).max(32).nullable(),
  minSeverity: z.enum(SEVERITIES),
  quietHoursStart: hhmm.nullable(),
  quietHoursEnd: hhmm.nullable(),
  smsFallback: z.boolean(),
}).refine((p) => (p.quietHoursStart == null) === (p.quietHoursEnd == null), { message: 'set both quiet hours start and end, or neither', path: ['quietHoursEnd'] });

/** DB row → API shape. `time` columns come back as 'HH:MM:SS'. */
export function prefsFromRow(r: { alert_types: string[] | null; min_severity: string; quiet_hours_start: string | null; quiet_hours_end: string | null; sms_fallback: boolean } | undefined): NotificationPrefs {
  if (!r) return { ...DEFAULT_PREFS };
  return {
    alertTypes: r.alert_types,
    minSeverity: (SEVERITIES as readonly string[]).includes(r.min_severity) ? (r.min_severity as Severity) : 'low',
    quietHoursStart: r.quiet_hours_start ? r.quiet_hours_start.slice(0, 5) : null,
    quietHoursEnd: r.quiet_hours_end ? r.quiet_hours_end.slice(0, 5) : null,
    smsFallback: r.sms_fallback,
  };
}

const IST_OFFSET_MIN = 330;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Minutes past midnight in IST (India has no DST). */
export const istMinutes = (d: Date) => (((d.getUTCHours() * 60 + d.getUTCMinutes() + IST_OFFSET_MIN) % 1440) + 1440) % 1440;

/** True when `now` falls inside the [start, end) IST window (wrapping midnight when start > end). */
export function inQuietHours(p: Pick<NotificationPrefs, 'quietHoursStart' | 'quietHoursEnd'>, now: Date): boolean {
  if (!p.quietHoursStart || !p.quietHoursEnd) return false;
  const s = minutes(p.quietHoursStart), e = minutes(p.quietHoursEnd), m = istMinutes(now);
  if (s === e) return false;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

export interface AlertFacts { type?: string | undefined; severity?: string | undefined }

/** Should this user be notified about this alert right now? */
export function wantsAlert(p: NotificationPrefs, a: AlertFacts, now: Date): boolean {
  if (a.type && p.alertTypes && !p.alertTypes.includes(a.type)) return false;
  if (rank(a.severity) < rank(p.minSeverity)) return false;
  if (a.severity !== 'critical' && inQuietHours(p, now)) return false;
  return true;
}
