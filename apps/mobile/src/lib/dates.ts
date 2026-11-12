export const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10); // IST
export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
};
export const daysUntil = (iso: string) => Math.round((Date.parse(iso) - Date.parse(today())) / 86_400_000);
