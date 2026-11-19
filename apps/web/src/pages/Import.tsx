import { useState } from 'react';
import { ApiError, api, downloadFile } from '../api';
import { useData } from '../data';
import { Badge, Card, Empty, Field, Note, PageHead, useToast } from '../ui';
import '../media/media.css';

type Kind = 'orchards' | 'blocks' | 'spray_events' | 'harvest_records';

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: 'orchards', label: 'Orchards', hint: 'One row per orchard. Import these first.' },
  { id: 'blocks', label: 'Blocks', hint: 'Reference the orchard by name. Varieties as "Gala Redlum:1400; Golden Delicious:200".' },
  { id: 'spray_events', label: 'Spray records', hint: 'One product per row; rows with the same spray_ref (or block + date + stage) form one tank-mix. Products by name, catalogue id or active ingredient. Imported sprays are locked and re-checked for compliance.' },
  { id: 'harvest_records', label: 'Harvest records', hint: 'Reference the block (and orchard if block names repeat) by name.' },
];

interface RowOutcome { row: number; ok: boolean; errors: string[]; warnings: string[]; preview: Record<string, unknown> }
interface ImportResult {
  kind: Kind;
  dryRun: boolean;
  committed: boolean;
  summary: { rows: number; valid: number; invalid: number; warnings: number; records: number };
  unknownColumns: string[];
  rows: RowOutcome[];
  maxRows: number;
}

const MAX_FILE = 5 * 1024 * 1024;

/** CSV import — dry run with per-row validation, then an all-or-nothing import. */
export function Import() {
  const toast = useToast();
  const { refresh } = useData();
  const [kind, setKind] = useState<Kind>('orchards');
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [checkedCsv, setCheckedCsv] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = KINDS.find((k) => k.id === kind)!;

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      let r: ImportResult;
      try {
        r = await api<ImportResult>(`/v1/import/${kind}`, { body: { csv, dryRun } });
      } catch (e) {
        if (e instanceof ApiError && e.status === 422 && e.body) r = e.body as ImportResult;
        else throw e;
      }
      setResult(r);
      setCheckedCsv(dryRun ? csv : null);
      if (!dryRun && r.committed) {
        toast(`Imported ${r.summary.records} record${r.summary.records === 1 ? '' : 's'}`);
        setCsv('');
        await refresh();
      }
    } catch (e) {
      setResult(null);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE) return setErr('File is larger than 5 MB — split it into smaller files.');
    setCsv(await f.text());
    setResult(null);
  };

  const canImport = !!result && result.dryRun && checkedCsv === csv && result.summary.invalid === 0 && result.summary.rows > 0;
  const previewKeys = result ? [...new Set(result.rows.flatMap((r) => Object.keys(r.preview)))].slice(0, 8) : [];

  return (
    <>
      <PageHead title="Import records" sub="Bring existing orchard registers, spray diaries and harvest books in from a spreadsheet (CSV)." />
      <div className="stack">
        <Card title="1 · Choose what to import">
          <div className="stack">
            <div className="seg" role="radiogroup" aria-label="Record type">
              {KINDS.map((k) => (
                <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className={kind === k.id ? 'on' : ''} onClick={() => { setKind(k.id); setResult(null); }}>{k.label}</button>
              ))}
            </div>
            <div className="faint">{meta.hint}</div>
            <div className="row">
              <button type="button" className="btn" onClick={() => downloadFile(`/v1/import/templates/${kind}`, `seb-orchard-${kind}-template.csv`).catch((e) => toast((e as Error).message))}>⬇ Download template</button>
              <span className="faint">Dates as YYYY-MM-DD or DD/MM/YYYY. Keep the header row.</span>
            </div>
          </div>
        </Card>

        <Card title="2 · Paste or upload the CSV">
          <div className="stack">
            <Field label="CSV file"><input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} /></Field>
            <Field label="…or paste it here">
              <textarea className="import-csv" value={csv} onChange={(e) => { setCsv(e.target.value); }} placeholder="name,district,lat,lng&#10;Shopian Upper,Shopian,33.72,74.83" spellCheck={false} />
            </Field>
            {err && <Note tone="bad">{err}</Note>}
            <div className="row">
              <button type="button" className="btn" disabled={busy || !csv.trim()} onClick={() => void run(true)}>{busy ? 'Checking…' : 'Check (dry run)'}</button>
              <button type="button" className="btn primary" disabled={busy || !canImport} onClick={() => void run(false)}>Import {result?.summary.records ? `${result.summary.records} record${result.summary.records === 1 ? '' : 's'}` : ''}</button>
              {result && checkedCsv !== csv && result.dryRun && <span className="faint">The CSV changed — check it again before importing.</span>}
            </div>
          </div>
        </Card>

        {result && (
          <Card title="3 · Preview" actions={<>
            <Badge tone="ok">{result.summary.valid} valid</Badge>
            {result.summary.invalid > 0 && <Badge tone="bad">{result.summary.invalid} with errors</Badge>}
            {result.summary.warnings > 0 && <Badge tone="warn">{result.summary.warnings} warnings</Badge>}
          </>}>
            <div className="stack">
              {result.committed && <Note tone="ok">Imported {result.summary.records} record{result.summary.records === 1 ? '' : 's'}.</Note>}
              {!result.dryRun && !result.committed && <Note tone="bad">Nothing was imported: fix the rows marked below and check again. Imports are all-or-nothing.</Note>}
              {result.dryRun && result.summary.invalid > 0 && <Note tone="warn">Fix the rows with errors, then check again. Nothing has been written yet.</Note>}
              {result.dryRun && result.summary.invalid === 0 && <Note tone="info">All rows are valid. Nothing has been written yet — press Import to save them.</Note>}
              {result.unknownColumns.length > 0 && <Note tone="warn">Ignored column{result.unknownColumns.length > 1 ? 's' : ''}: {result.unknownColumns.join(', ')}</Note>}
              {result.rows.length ? (
                <div className="tbl-wrap">
                  <table className="import-table">
                    <thead><tr><th className="num">Row</th><th>Status</th>{previewKeys.map((k) => <th key={k}>{k.replaceAll('_', ' ')}</th>)}<th>Messages</th></tr></thead>
                    <tbody>
                      {result.rows.map((r) => (
                        <tr key={r.row} className={!r.ok ? 'bad' : r.warnings.length ? 'warn' : ''}>
                          <td className="num">{r.row}</td>
                          <td>{r.ok ? <Badge tone="ok">ok</Badge> : <Badge tone="bad">error</Badge>}</td>
                          {previewKeys.map((k) => <td key={k} className="mono">{fmt(r.preview[k])}</td>)}
                          <td>{[...r.errors.map((m) => <div key={`e${m}`} style={{ color: 'var(--bad)' }}>{m}</div>), ...r.warnings.map((m) => <div key={`w${m}`} style={{ color: 'var(--warn)' }}>{m}</div>)]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty>No rows.</Empty>}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function fmt(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return Array.isArray(v) ? v.map((x) => (typeof x === 'object' && x ? Object.values(x).join(':') : String(x))).join('; ') : JSON.stringify(v);
  return String(v);
}
