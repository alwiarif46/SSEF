import React, { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { currentStage, isBlocked, planStage, scaleDose, sprayVolumeLitres, validateSpray, type PlannedRecommendation } from '@orchard/domain';
import type { ProductOption } from '@orchard/reference';
import { Badge, Button, Card, Empty, Field, H, NumField, P, Row, Screen, Select } from '../ui/kit';
import { colors } from '../ui/theme';
import { createRow, Q, updateRow, useTable } from '../db/repo';
import { useReference } from '../state/reference';
import { useAuth } from '../state/auth';
import { fmtDate, isIsoDate, today } from '../lib/dates';
import { buildPlanContext, sprayHistory, usageByChemical, weatherHours } from '../lib/context';
import type { BlockRow, InventoryRow, OrchardRow, ScoutRow, SprayEventRow, WeatherDailyRow } from '../lib/types';
import type { ScreenProps } from './nav';

const statusTone = { due: 'danger', conditional: 'warn', not_needed: 'muted', done: 'ok', skipped_resistant: 'ok' } as const;
const statusLabel = { due: 'Due', conditional: 'Need-based', not_needed: 'Not needed', done: 'Done', skipped_resistant: 'Skipped (resistant)' } as const;

export function SprayHomeScreen({ navigation }: ScreenProps<'Tabs'>) {
  const { rows: orchards } = useTable<OrchardRow>('orchards');
  const { rows: blocks } = useTable<BlockRow>('blocks');
  const { bundle } = useReference();
  return (
    <Screen>
      <H>Spray planner</H>
      <P muted>SKUAST-K {bundle.version.season} schedule. Choose a block.</P>
      <Button title="Tank calculator" kind="secondary" onPress={() => navigation.navigate('TankCalc')} />
      <Button title="Browse full schedule" kind="secondary" onPress={() => navigation.navigate('Schedule')} />
      {blocks.length === 0 && <Empty text="Add an orchard and a block first." />}
      {orchards.map((o) => {
        const bs = blocks.filter((b) => b.orchard_id === o.id);
        if (!bs.length) return null;
        const stage = currentStage(bundle.stages, today(), { elevationM: o.elevation_m });
        return (
          <Card key={o.id} title={o.name} right={stage ? <Badge text={stage.name} tone="info" /> : undefined}>
            {bs.map((b) => (
              <Button key={b.id} title={b.name} kind="secondary" onPress={() => navigation.navigate('SprayPlan', { blockId: b.id })} />
            ))}
          </Card>
        );
      })}
    </Screen>
  );
}

function useBlockData(blockId: string) {
  const { rows: blocks } = useTable<BlockRow>('blocks', [Q.where('id', blockId)], [blockId]);
  const block = blocks[0];
  const orchardId = block?.orchard_id ?? '__none__';
  const { rows: orchards } = useTable<OrchardRow>('orchards', [Q.where('id', orchardId)], [orchardId]);
  const { rows: events } = useTable<SprayEventRow>('spray_events', [Q.where('block_id', blockId)], [blockId]);
  const { rows: scouting } = useTable<ScoutRow>('scouting_observations', [Q.where('block_id', blockId)], [blockId]);
  const { rows: weather } = useTable<WeatherDailyRow>('weather_daily', [Q.where('orchard_id', orchardId)], [orchardId]);
  return { block, orchard: orchards[0], events, scouting, weather };
}

export function SprayPlanScreen({ route, navigation }: ScreenProps<'SprayPlan'>) {
  const { blockId } = route.params;
  const { bundle } = useReference();
  const { block, orchard, events, scouting, weather } = useBlockData(blockId);
  const [tank, setTank] = useState<number | undefined>(200);
  const [stageId, setStageId] = useState<string>();
  const date = today();
  const autoStage = block ? currentStage(bundle.stages, date, { elevationM: orchard?.elevation_m, observedStageId: block.observed_stage_id }) : undefined;
  const sid = stageId ?? autoStage?.id;
  const plan: PlannedRecommendation[] = useMemo(() => {
    if (!block || !sid || !tank || tank <= 0) return [];
    return planStage(bundle, sid, buildPlanContext({ block, events, scouting, weather, chemicals: bundle.chemicals, date, tankLitres: tank }));
  }, [block, sid, tank, events, scouting, weather, bundle, date]);
  const stage = bundle.stages.find((s) => s.id === sid);
  if (!block) return <Empty text="Block not found." />;

  return (
    <Screen>
      <H>{block.name}</H>
      <Select label="Stage" value={sid} options={bundle.stages.map((s) => ({ value: s.id, label: `${s.order}. ${s.name}${s.id === autoStage?.id ? ' (now)' : ''}`, sub: s.phenology }))} onChange={setStageId} />
      {stage && (
        <Card>
          <P>{stage.timingGuidance}</P>
          {stage.culturalPractices.map((c) => (
            <P key={c} muted>• {c}</P>
          ))}
          {stage.pollinatorSensitive && <Badge text="Bloom: no insecticides — protect pollinators" tone="danger" />}
        </Card>
      )}
      <NumField label="Tank size (litres)" value={tank} onChange={setTank} />
      {!block.expected_harvest_date && <Badge text="Set expected harvest date on the block to enable PHI checks" tone="warn" />}
      {plan.length === 0 && <Empty text="No recommendations for this stage." />}
      {plan.map((p) => (
        <Card
          key={p.recommendation.id}
          title={`${p.recommendation.category[0]!.toUpperCase()}${p.recommendation.category.slice(1).replace('_', ' ')}`}
          right={
            <Row>
              <Badge text={p.supplementary ? 'Supplementary' : 'SKUAST-K'} tone={p.supplementary ? 'muted' : 'ok'} />
              <Badge text={statusLabel[p.status]} tone={statusTone[p.status]} />
            </Row>
          }
        >
          <P muted>
            Target: {p.recommendation.target.map((t) => bundle.pests.find((x) => x.id === t)?.name ?? t).join(', ')}
          </P>
          <P muted>{p.reason}</P>
          {p.recommendation.notes ? <P muted>{p.recommendation.notes}</P> : null}
          {p.status !== 'done' && p.status !== 'skipped_resistant' &&
            p.options.map((o) => (
              <View key={o.chemical.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 6, gap: 4, opacity: o.eligible ? 1 : 0.6 }}>
                <Row>
                  <Text style={{ fontWeight: '700', color: colors.text, flex: 1 }}>
                    {o.preferred ? '★ ' : ''}
                    {o.chemical.product}
                  </Text>
                  {o.chemical.fracGroup ? <Badge text={`FRAC ${o.chemical.fracGroup}`} tone="muted" /> : o.chemical.iracGroup ? <Badge text={`IRAC ${o.chemical.iracGroup}`} tone="muted" /> : null}
                </Row>
                <P>
                  Official: {o.dose.officialPer100L} {o.dose.unit} / 100 L → <Text style={{ fontWeight: '800' }}>{o.dose.display}</Text> per {tank} L tank
                </P>
                {o.chemical.phiDays != null && <P muted>PHI {o.chemical.phiDays} days</P>}
                {o.violations.map((v, i) => (
                  <Badge key={i} text={v.message} tone={v.severity === 'block' ? 'danger' : v.severity === 'warn' ? 'warn' : 'info'} />
                ))}
                {o.eligible ? (
                  <Button
                    title="Record this spray"
                    kind={o.preferred ? 'primary' : 'secondary'}
                    onPress={() => navigation.navigate('RecordSpray', { blockId, stageId: sid, chemicalIds: [o.chemical.id], recommendationIds: { [o.chemical.id]: p.recommendation.id } })}
                  />
                ) : (
                  <Badge text="Blocked — cannot be selected" tone="danger" />
                )}
              </View>
            ))}
        </Card>
      ))}
      <Button title="Record a different / mixed spray" kind="secondary" onPress={() => navigation.navigate('RecordSpray', { blockId, stageId: sid })} />
      <P muted>{bundle.version.disclaimer}</P>
    </Screen>
  );
}

const toBase = (q: number, unit: string) => (unit === 'kg' || unit === 'l' ? q * 1000 : q);

export function RecordSprayScreen({ route, navigation }: ScreenProps<'RecordSpray'>) {
  const { blockId, stageId, chemicalIds = [], recommendationIds = {} } = route.params;
  const { bundle } = useReference();
  const { user } = useAuth();
  const { block, events, weather } = useBlockData(blockId);
  const { rows: inventory, models: invModels } = useTable<InventoryRow>('chemical_inventory');
  const [date, setDate] = useState(today());
  const [ids, setIds] = useState<string[]>(chemicalIds);
  const [tank, setTank] = useState<number | undefined>(200);
  const [total, setTotal] = useState<number | undefined>();
  const [override, setOverride] = useState('');
  const [notes, setNotes] = useState('');
  const [add, setAdd] = useState<string>();
  const [busy, setBusy] = useState(false);

  const age = block?.planting_year ? +date.slice(0, 4) - block.planting_year : undefined;
  const suggestedTotal = block?.tree_count ? sprayVolumeLitres({ trees: block.tree_count, system: block.system_type, treeAgeYears: age }) : undefined;
  const totalL = total ?? suggestedTotal ?? tank ?? 0;

  const doseFor = (chemicalId: string): ProductOption | undefined => {
    const recs = bundle.recommendations.filter((r) => r.options.some((o) => o.chemicalId === chemicalId));
    const r = recs.find((x) => x.stageId === stageId) ?? recs[0];
    return r?.options.find((o) => o.chemicalId === chemicalId);
  };
  const lines = ids.map((id) => ({ id, opt: doseFor(id), chem: bundle.chemicals.find((c) => c.id === id)! })).filter((l) => l.chem);
  const violations = useMemo(
    () => (block && isIsoDate(date) ? validateSpray({ date, chemicalIds: ids, ...(stageId ? { stageId } : {}), ...(block.expected_harvest_date ? { plannedHarvestDate: block.expected_harvest_date } : {}) }, sprayHistory(events), bundle) : []),
    [block, date, ids, stageId, events, bundle],
  );
  const blocked = isBlocked(violations);
  const warned = violations.some((v) => v.severity === 'warn');
  const selectable = bundle.chemicals.filter((c) => c.status !== 'banned' && c.cibrcRegistered && !ids.includes(c.id));

  const save = async () => {
    if (!block || blocked || !tank) return;
    if (warned && override.trim().length < 5) return Alert.alert('Reason needed', 'Give a reason for spraying despite the warnings.');
    setBusy(true);
    try {
      const products = lines.map((l) => {
        const opt = l.opt ?? { chemicalId: l.id, dosePer100L: 0, doseUnit: 'g' as const };
        const scaled = scaleDose(opt, Math.max(totalL, 0.001));
        return { chemicalId: l.id, dosePer100L: opt.dosePer100L, unit: opt.doseUnit, quantity: scaled.quantity, ...(recommendationIds[l.id] ? { recommendationId: recommendationIds[l.id] } : {}) };
      });
      const hours = weatherHours(weather);
      const nowH = hours.filter((h) => h.time <= new Date().toISOString()).at(-1);
      await createRow('spray_events', {
        block_id: blockId,
        stage_id: stageId,
        schedule_version_id: bundle.version.id,
        sprayed_on: date,
        products,
        tank_litres: tank,
        total_litres: totalL,
        tank_fills: Math.max(1, Math.ceil(totalL / tank)),
        operator_user_id: user?.id,
        weather_snapshot: nowH ?? null,
        violations,
        override_reason: warned ? override.trim() : null,
        locked: false,
        notes: notes || null,
      });
      // Deduct stock (earliest-expiry batch first, unit-compatible only).
      const usage = usageByChemical(products.map((p) => ({ chemicalId: p.chemicalId, quantity: toBase(p.quantity, p.unit) })));
      for (const [chemId, needBase] of Object.entries(usage)) {
        let remaining = needBase;
        const batches = inventory.map((r, i) => ({ r, m: invModels[i]! })).filter((x) => x.r.chemical_id === chemId && x.r.quantity > 0).sort((a, b) => (a.r.expiry_date ?? '9').localeCompare(b.r.expiry_date ?? '9'));
        for (const { r, m } of batches) {
          if (remaining <= 0) break;
          const haveBase = toBase(r.quantity, r.unit);
          const take = Math.min(haveBase, remaining);
          remaining -= take;
          const left = haveBase - take;
          await updateRow(m, { quantity: r.unit === 'kg' || r.unit === 'l' ? left / 1000 : left });
        }
      }
      navigation.goBack();
    } finally {
      setBusy(false);
    }
  };

  if (!block) return <Empty text="Block not found." />;
  return (
    <Screen>
      <H>Record spray · {block.name}</H>
      <P muted>Stage: {bundle.stages.find((s) => s.id === stageId)?.name ?? 'not set'}</P>
      <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} error={isIsoDate(date) ? undefined : 'Use YYYY-MM-DD'} />
      <NumField label="Tank size (L)" value={tank} onChange={setTank} />
      <NumField label="Total spray liquid (L)" value={total} onChange={setTotal} hint={suggestedTotal ? `Suggested for ${block.tree_count} trees: ${suggestedTotal} L` : undefined} />
      <Card title="Products">
        {lines.length === 0 && <P muted>Add at least one product.</P>}
        {lines.map((l) => {
          const per = l.opt && tank ? scaleDose(l.opt, tank) : undefined;
          const all = l.opt ? scaleDose(l.opt, Math.max(totalL, 0.001)) : undefined;
          return (
            <View key={l.id} style={{ gap: 2 }}>
              <Row>
                <Text style={{ fontWeight: '700', color: colors.text, flex: 1 }}>{l.chem.product}</Text>
                <Button title="Remove" kind="secondary" onPress={() => setIds(ids.filter((x) => x !== l.id))} />
              </Row>
              {l.opt ? (
                <P muted>
                  {l.opt.dosePer100L} {l.opt.doseUnit}/100 L · per tank {per?.display} · total {all?.display}
                </P>
              ) : (
                <Badge text="No schedule dose for this product — follow the label" tone="warn" />
              )}
            </View>
          );
        })}
        <Select label="Add product" value={add} options={selectable.map((c) => ({ value: c.id, label: c.product, sub: `${c.category}${c.fracGroup ? ` · FRAC ${c.fracGroup}` : ''}${c.iracGroup ? ` · IRAC ${c.iracGroup}` : ''}` }))} onChange={(v) => { setIds([...ids, v]); setAdd(undefined); }} />
      </Card>
      {violations.map((v, i) => (
        <Badge key={i} text={v.message} tone={v.severity === 'block' ? 'danger' : v.severity === 'warn' ? 'warn' : 'info'} />
      ))}
      {warned && !blocked && <Field label="Reason for proceeding despite warnings" value={override} onChangeText={setOverride} />}
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
      <Button title={blocked ? 'Blocked by safety rules' : 'Save spray'} disabled={blocked || !ids.length || !isIsoDate(date) || !tank} loading={busy} onPress={() => void save()} />
      <P muted>Records become locked after sync. Mistakes are fixed with a linked correction, never by editing history.</P>
    </Screen>
  );
}

export function TankCalcScreen() {
  const { bundle } = useReference();
  const [chem, setChem] = useState<string>();
  const [tank, setTank] = useState<number | undefined>(200);
  const [trees, setTrees] = useState<number | undefined>();
  const [age, setAge] = useState<number | undefined>(15);
  const [system, setSystem] = useState<'traditional' | 'hdp' | 'medium_density'>('traditional');
  const opts = useMemo(() => {
    const m = new Map<string, ProductOption>();
    for (const r of bundle.recommendations) for (const o of r.options) if (!m.has(o.chemicalId)) m.set(o.chemicalId, o);
    return m;
  }, [bundle]);
  const opt = chem ? opts.get(chem) : undefined;
  const vol = trees ? sprayVolumeLitres({ trees, system, treeAgeYears: age }) : undefined;
  return (
    <Screen>
      <H>Tank calculator</H>
      <Select label="Product" value={chem} options={[...opts.keys()].map((id) => ({ value: id, label: bundle.chemicals.find((c) => c.id === id)?.product ?? id }))} onChange={setChem} />
      <NumField label="Tank size (L)" value={tank} onChange={setTank} />
      {opt && tank ? (
        <Card>
          <P>Official dose: {opt.dosePer100L} {opt.doseUnit} per 100 L water</P>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.primary }}>{scaleDose(opt, tank).display} per {tank} L</Text>
        </Card>
      ) : null}
      <Card title="Spray liquid needed">
        <Select label="System" value={system} options={[{ value: 'traditional', label: 'Traditional' }, { value: 'medium_density', label: 'Medium density' }, { value: 'hdp', label: 'HDP' }]} onChange={setSystem} />
        <NumField label="Trees" value={trees} onChange={setTrees} />
        <NumField label="Tree age (years)" value={age} onChange={setAge} />
        {vol != null && tank ? (
          <P>
            ≈ {vol} L total → {Math.ceil(vol / tank)} tank fill(s){opt ? ` · ${scaleDose(opt, vol).display} product in total` : ''}
          </P>
        ) : null}
      </Card>
    </Screen>
  );
}

export function ScheduleScreen() {
  const { bundle } = useReference();
  return (
    <Screen>
      <H>{bundle.version.source}</H>
      <Badge text={`Status: ${bundle.version.status}`} tone={bundle.version.status === 'published' ? 'ok' : 'warn'} />
      {[...bundle.stages].sort((a, b) => a.order - b.order).map((s) => (
        <Card key={s.id} title={`${s.order}. ${s.name}`}>
          <P muted>{s.timingGuidance}</P>
          {bundle.recommendations.filter((r) => r.stageId === s.id).map((r) => (
            <View key={r.id}>
              <P>
                {r.category}
                {r.needBased ? ' (need-based)' : ''}: {r.options.map((o) => `${bundle.chemicals.find((c) => c.id === o.chemicalId)?.product} ${o.dosePer100L} ${o.doseUnit}`).join(' | ')}
              </P>
            </View>
          ))}
        </Card>
      ))}
      <P muted>{bundle.version.disclaimer}</P>
    </Screen>
  );
}

export { fmtDate };
