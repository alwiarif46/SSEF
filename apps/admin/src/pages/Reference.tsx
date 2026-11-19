import { useRef, useState, type ChangeEvent } from 'react';
import { adminApi, type BundleDiff, type EntityDiff, type PublishResponse, type ReferenceVersion, type ValidateResponse } from '../api';
import { Badge, Card, Empty, Field, Note, PageHead, fmtDateTime, useLoad, useToast, type Tone } from '../ui';

const statusTone: Record<ReferenceVersion['status'], Tone> = { published: 'ok', under_review: 'warn', draft: 'info', superseded: '' };
type Target = 'draft' | 'under_review' | 'published';

export function Reference() {
  const list = useLoad(adminApi.reference);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ValidateResponse | null>(null);
  const [validated, setValidated] = useState<string | null>(null);
  const [busy, setBusy] = useState<'validate' | 'publish' | 'load' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>('published');
  const [verifiedBy, setVerifiedBy] = useState('');
  const [attested, setAttested] = useState(false);
  const [published, setPublished] = useState<PublishResponse | null>(null);

  const edit = (t: string) => {
    setText(t);
    setParseError(null);
    setPublished(null);
    setError(null);
  };
  const stale = result != null && validated !== text;

  const loadVersion = async (versionId: string) => {
    setBusy('load');
    try {
      edit(JSON.stringify(await adminApi.referenceBundle(versionId), null, 2));
      setResult(null);
      toast(`Loaded ${versionId} into the editor`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    edit(await f.text());
    setResult(null);
    e.target.value = '';
  };

  const parse = (): unknown => {
    try {
      return JSON.parse(text);
    } catch (e) {
      setParseError(`Not valid JSON: ${(e as Error).message}`);
      return undefined;
    }
  };

  const validate = async () => {
    const bundle = parse();
    if (bundle === undefined) return;
    setBusy('validate');
    setError(null);
    try {
      const r = await adminApi.validate(bundle);
      setResult(r);
      setValidated(text);
      const status = (bundle as { version?: { status?: string } }).version?.status;
      if (status === 'draft' || status === 'under_review' || status === 'published') setTarget(r.ok ? status : 'draft');
      else if (!r.ok) setTarget('draft');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    const bundle = parse();
    if (bundle === undefined) return;
    setBusy('publish');
    setError(null);
    try {
      const r = await adminApi.publish({ bundle, status: target, ...(target === 'published' ? { verifiedBy: verifiedBy.trim() } : {}) });
      setPublished(r);
      setAttested(false);
      toast(`Stored ${r.version_id} as ${r.status.replace('_', ' ')}`);
      list.reload();
    } catch (e) {
      const body = (e as { body?: { errors?: string[] } }).body;
      setError(`${(e as Error).message}${body?.errors?.length ? ` — ${body.errors.length} validation error(s)` : ''}`);
    } finally {
      setBusy(null);
    }
  };

  const canStore = result != null && !stale && result.diff != null &&
    (target === 'draft' || result.ok) &&
    (target !== 'published' || (verifiedBy.trim().length >= 2 && attested));

  const step = !text ? 0 : !result || stale ? 1 : published ? 3 : 2;

  return (
    <>
      <PageHead title="Reference data" sub="Season-versioned spray schedule, chemical catalogue and pest library served to every grower." actions={<button className="btn" onClick={list.reload}>⟳ Refresh</button>} />

      <Card title="Versions" className="stack">
        {list.error && <Note tone="bad">{list.error}</Note>}
        {list.loading && !list.data ? <Empty>Loading…</Empty> : !list.data?.versions.length ? <Empty>No versions stored — growers receive the compiled default bundle.</Empty> : (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Version</th><th>Season</th><th>Status</th><th>Signed off</th><th className="num">Stages</th><th className="num">Recs</th><th className="num">Chemicals</th><th>Published</th><th>ETag</th><th /></tr></thead>
              <tbody>
                {list.data.versions.map((v) => (
                  <tr key={v.version_id}>
                    <td><b>{v.version_id}</b>{list.data?.current.versionId === v.version_id && <> <Badge tone="brand">serving</Badge></>}<div className="faint">{v.source}</div></td>
                    <td>{v.season}</td>
                    <td><Badge tone={statusTone[v.status]}>{v.status.replace('_', ' ')}</Badge></td>
                    <td>{v.verified_by ?? <span className="faint">—</span>}</td>
                    <td className="num">{v.stages}</td>
                    <td className="num">{v.recommendations}</td>
                    <td className="num">{v.chemicals}</td>
                    <td>{fmtDateTime(v.published_at)}</td>
                    <td className="code faint" title={v.etag}>{v.etag.slice(0, 10)}</td>
                    <td><button className="btn sm" disabled={busy === 'load'} onClick={() => void loadVersion(v.version_id)}>Edit copy</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ height: 16 }} />

      <Card title="Publish a bundle">
        <div className="steps" aria-label="Progress">
          {['Load bundle', 'Validate', 'Review & sign off', 'Stored'].map((s, i) => <span key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{i + 1}. {s}</span>)}
        </div>
        <div className="stack">
          <div className="row">
            <button className="btn" onClick={() => fileRef.current?.click()}>⇪ Upload JSON…</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e)} />
            {list.data && <button className="btn" disabled={busy === 'load'} onClick={() => void loadVersion(list.data!.current.versionId)}>Start from serving version</button>}
            <span className="faint">…or paste a ReferenceBundle below.</span>
          </div>
          <textarea className="code" spellCheck={false} value={text} onChange={(e) => edit(e.target.value)} placeholder='{ "version": { "id": "skuastk-2027", "season": 2027, … }, "stages": [ … ], … }' aria-label="Bundle JSON" />
          {parseError && <Note tone="bad">{parseError}</Note>}
          {error && <Note tone="bad">{error}</Note>}
          <div className="row">
            <button className="btn primary" disabled={!text.trim() || busy === 'validate'} onClick={() => void validate()}>{busy === 'validate' ? 'Validating…' : 'Validate'}</button>
            {stale && <span className="faint">Edited since last validation — validate again.</span>}
          </div>
        </div>

        {result && !stale && (
          <div className="stack" style={{ marginTop: 18 }}>
            {result.ok ? <Note tone="ok"><b>No validation errors.</b> Compared against <span className="code">{result.against.versionId}</span>.</Note> : (
              <Note tone="bad">
                <div>
                  <b>{result.errors.length} validation error{result.errors.length > 1 ? 's' : ''}</b> — this bundle can only be stored as a draft.
                  <ul className="err-list" style={{ marginTop: 6 }}>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
              </Note>
            )}
            {result.regulatoryImpact.length > 0 && <Impact result={result} />}
            {result.diff && <Diff diff={result.diff} />}

            {result.diff && (
              <Card title="Store">
                <div className="stack">
                  <div className="form-grid">
                    <Field label="Status">
                      <select value={target} onChange={(e) => setTarget(e.target.value as Target)}>
                        <option value="draft">Draft (not served)</option>
                        <option value="under_review" disabled={!result.ok}>Under review (served, marked unverified)</option>
                        <option value="published" disabled={!result.ok}>Published</option>
                      </select>
                    </Field>
                    {target === 'published' && (
                      <Field label="Verified by (agronomist) *">
                        <input value={verifiedBy} onChange={(e) => setVerifiedBy(e.target.value)} placeholder="Dr. Name, SKUAST-K" />
                      </Field>
                    )}
                  </div>
                  {target === 'published' && (
                    <label className="f check">
                      <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                      I confirm every stage, dose and product above was checked against the printed SKUAST-K edition.
                    </label>
                  )}
                  {target === 'published' && <Note tone="warn">Publishing supersedes the currently published version. Growers receive it on their next sync. A season older than the published one cannot be published.</Note>}
                  {target !== 'published' && <Note tone="info">Drafts and under-review bundles carry no sign-off. A stored published, superseded or under-review version is never demoted: store a revision under a new version id.</Note>}
                  <div className="row">
                    <button className="btn primary" disabled={!canStore || busy === 'publish'} onClick={() => void publish()}>
                      {busy === 'publish' ? 'Storing…' : target === 'published' ? 'Publish' : `Store as ${target.replace('_', ' ')}`}
                    </button>
                  </div>
                </div>
              </Card>
            )}
            {published && (
              <Note tone="ok">
                <div>
                  <b>Stored {published.version_id} as {published.status.replace('_', ' ')}.</b> ETag <span className="code">{published.etag}</span>
                  {published.superseded.length > 0 && <> — superseded {published.superseded.join(', ')}</>}
                  {published.warnings.length > 0 && <> — {published.warnings.length} warning(s) kept with the draft</>}
                </div>
              </Note>
            )}
          </div>
        )}
      </Card>
    </>
  );
}

function Impact({ result }: { result: ValidateResponse }) {
  return (
    <Card title={`Regulatory impact (${result.regulatoryImpact.length})`}>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Stage</th><th>Recommendation</th><th>Affected products</th><th>Remaining alternatives</th></tr></thead>
          <tbody>
            {result.regulatoryImpact.map((i) => (
              <tr key={i.recommendationId}>
                <td>{i.stage}</td>
                <td className="code">{i.recommendationId}</td>
                <td>{i.affected.map((a) => <div key={a.chemicalId}><Badge tone={a.status === 'banned' ? 'bad' : 'warn'}>{a.status}</Badge> {a.product}<div className="faint">{a.reason}</div></div>)}</td>
                <td>{i.alternatives.length ? i.alternatives.join(', ') : <Badge tone="bad">none left</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Diff({ diff }: { diff: BundleDiff }) {
  const s = diff.summary;
  const nothing = s.added + s.removed + s.changed + s.doseChanges === 0 && diff.version.length === 0;
  return (
    <Card title={<h2>Changes vs <span className="code">{diff.against.versionId}</span> <Badge>{diff.against.status.replace('_', ' ')}</Badge></h2>}>
      {nothing ? <Empty>Content identical to the serving version.</Empty> : (
        <div className="stack">
          <div className="row">
            <Badge tone="ok">+{s.added} added</Badge><Badge tone="bad">−{s.removed} removed</Badge><Badge tone="warn">~{s.changed} changed</Badge><Badge tone="info">{s.doseChanges} dose change{s.doseChanges === 1 ? '' : 's'}</Badge>
            {diff.version.length > 0 && <span className="faint">Version fields: {diff.version.join(', ')}</span>}
          </div>
          {diff.doseChanges.length > 0 && (
            <div className="tbl-wrap">
              <table>
                <thead><tr><th>Stage</th><th>Product</th><th>Recommendation</th><th className="num">Before (per 100 L)</th><th className="num">After (per 100 L)</th></tr></thead>
                <tbody>
                  {diff.doseChanges.map((d) => (
                    <tr key={`${d.recommendationId}:${d.chemicalId}`}>
                      <td>{d.stage}</td>
                      <td className={d.kind === 'added' ? 'diff-add' : d.kind === 'removed' ? 'diff-del' : 'diff-chg'}>{d.kind === 'added' ? '+ ' : d.kind === 'removed' ? '− ' : '~ '}{d.product}</td>
                      <td className="code faint">{d.recommendationId}</td>
                      <td className="num">{d.before ? `${d.before.dosePer100L} ${d.before.doseUnit}` : '—'}</td>
                      <td className="num"><b>{d.after ? `${d.after.dosePer100L} ${d.after.doseUnit}` : '—'}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {diff.chemicalStatus.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 6 }}>Regulatory status changes</h3>
              {diff.chemicalStatus.map((c) => <div key={c.chemicalId}>{c.product}: <Badge>{c.before}</Badge> → <Badge tone={c.after === 'banned' ? 'bad' : c.after === 'registered' ? 'ok' : 'warn'}>{c.after}</Badge></div>)}
            </div>
          )}
          <div className="grid g3">
            <EntityBlock title="Stages" d={diff.stages} />
            <EntityBlock title="Recommendations" d={diff.recommendations} />
            <EntityBlock title="Chemicals" d={diff.chemicals} />
          </div>
        </div>
      )}
    </Card>
  );
}

function EntityBlock({ title, d }: { title: string; d: EntityDiff }) {
  const n = d.added.length + d.removed.length + d.changed.length;
  return (
    <div className="card" style={{ boxShadow: 'none' }}>
      <h3 style={{ marginBottom: 8 }}>{title} <span className="faint">({n})</span></h3>
      {n === 0 ? <div className="faint">No changes</div> : (
        <ul className="v-list" style={{ maxHeight: 240, overflowY: 'auto' }}>
          {d.added.map((x) => <li key={`a${x.id}`} className="diff-add">+ {x.label} <span className="faint code">{x.id}</span></li>)}
          {d.removed.map((x) => <li key={`r${x.id}`} className="diff-del">− {x.label} <span className="faint code">{x.id}</span></li>)}
          {d.changed.map((x) => <li key={`c${x.id}`} className="diff-chg">~ {x.label} <span className="faint">({x.fields.join(', ')})</span></li>)}
        </ul>
      )}
    </div>
  );
}
