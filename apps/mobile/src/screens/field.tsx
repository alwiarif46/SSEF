import React, { useMemo, useState } from 'react';
import { Alert, Image, View } from 'react-native';
import * as IP from 'expo-image-picker';
import * as L from 'expo-location';
import { MITE_THRESHOLDS, BOX_TYPES, MANDIS, GRADES } from '@orchard/reference';
import { assessMaturity, currentStage } from '@orchard/domain';
import { Badge, Button, Card, Empty, Field, H, NumField, P, Row, Screen, Select } from '../ui/kit';
import { createRow, Q, useTable } from '../db/repo';
import { useReference } from '../state/reference';
import { useAuth } from '../state/auth';
import { fmtDate, isIsoDate, today } from '../lib/dates';
import type { BlockRow, HarvestRow, OrchardRow, ScoutRow } from '../lib/types';
import type { ScreenProps } from './nav';

export function FieldHomeScreen({ navigation }: ScreenProps<'Tabs'>) {
  const { rows: obs } = useTable<ScoutRow>('scouting_observations', [Q.sortBy('observed_on', Q.desc), Q.take(20)]);
  const { rows: harvest } = useTable<HarvestRow>('harvest_records', [Q.sortBy('picked_on', Q.desc), Q.take(20)]);
  const { bundle } = useReference();
  const boxes = harvest.reduce((s, h) => s + (h.box_count ?? 0), 0);
  const revenue = harvest.reduce((s, h) => s + (h.box_count ?? 0) * (h.price_per_box_inr ?? 0), 0);
  return (
    <Screen>
      <H>Field</H>
      <Row>
        <View style={{ flex: 1 }}>
          <Button title="Scout" onPress={() => navigation.navigate('ScoutingForm', {})} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Harvest" onPress={() => navigation.navigate('HarvestForm', {})} />
        </View>
      </Row>
      <Card title="Recent scouting">
        {obs.length === 0 && <P muted>No observations yet.</P>}
        {obs.map((o) => (
          <P key={o.id}>
            {fmtDate(o.observed_on)} · {bundle.pests.find((p) => p.id === o.pest_id)?.name ?? o.pest_id}
            {o.value != null ? ` · ${o.value} ${o.metric ?? ''}` : ''}
            {o.photos?.length ? ` · ${o.photos.length} photo(s)` : ''}
          </P>
        ))}
      </Card>
      <Card title="Harvest">
        <P muted>Recent: {boxes} boxes · ₹{revenue.toLocaleString('en-IN')}</P>
        {harvest.map((h) => (
          <P key={h.id}>
            {fmtDate(h.picked_on)} · {h.box_count ?? 0} × {h.box_type ?? 'box'} · grade {h.grade ?? '—'} {h.mandi ? `· ${h.mandi}` : ''}
          </P>
        ))}
      </Card>
    </Screen>
  );
}

function BlockPicker({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  const { rows: blocks } = useTable<BlockRow>('blocks');
  const { rows: orchards } = useTable<OrchardRow>('orchards');
  return (
    <Select
      label="Block"
      value={value}
      options={blocks.map((b) => ({ value: b.id, label: b.name, sub: orchards.find((o) => o.id === b.orchard_id)?.name }))}
      onChange={onChange}
    />
  );
}

export function ScoutingFormScreen({ route, navigation }: ScreenProps<'ScoutingForm'>) {
  const { bundle } = useReference();
  const { user } = useAuth();
  const [blockId, setBlockId] = useState(route.params?.blockId);
  const { rows: blocks } = useTable<BlockRow>('blocks', [Q.where('id', blockId ?? '__none__')], [blockId]);
  const { rows: orchards } = useTable<OrchardRow>('orchards', [Q.where('id', blocks[0]?.orchard_id ?? '__none__')], [blocks[0]?.orchard_id]);
  const [pestId, setPestId] = useState<string>();
  const [value, setValue] = useState<number>();
  const [severity, setSeverity] = useState<number>();
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [gps, setGps] = useState<{ lat: number; lng: number }>();
  const pest = bundle.pests.find((p) => p.id === pestId);
  const stage = currentStage(bundle.stages, today(), { elevationM: orchards[0]?.elevation_m, observedStageId: blocks[0]?.observed_stage_id });
  const threshold = pest?.kind === 'mite' && stage ? MITE_THRESHOLDS[stage.id] ?? pest.actionThreshold : pest?.actionThreshold;
  const over = threshold != null && value != null && value >= threshold;

  const photo = async (camera: boolean) => {
    const perm = camera ? await IP.requestCameraPermissionsAsync() : await IP.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission denied');
    const r = camera ? await IP.launchCameraAsync({ quality: 0.5 }) : await IP.launchImageLibraryAsync({ quality: 0.5 });
    if (!r.canceled && r.assets[0]) setPhotos((p) => [...p, r.assets[0]!.uri]);
  };
  const locate = async () => {
    if ((await L.requestForegroundPermissionsAsync()).status !== 'granted') return;
    const pos = await L.getCurrentPositionAsync({ accuracy: L.Accuracy.Balanced });
    setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
  };

  return (
    <Screen>
      <H>Scouting</H>
      <BlockPicker value={blockId} onChange={setBlockId} />
      <Select label="Pest / disease" value={pestId} options={bundle.pests.map((p) => ({ value: p.id, label: p.name, sub: p.scoutingMetric }))} onChange={setPestId} />
      {pest?.scoutingMetric ? (
        <NumField label={`Count (${pest.scoutingMetric})`} value={value} onChange={setValue} hint={threshold != null ? `Action threshold${stage ? ` at ${stage.name}` : ''}: ${threshold} ${pest.thresholdUnit ?? ''}` : undefined} />
      ) : (
        <NumField label="Severity (0–5)" value={severity} onChange={setSeverity} />
      )}
      {pest?.thresholdNote && <P muted>{pest.thresholdNote}</P>}
      {threshold != null && value != null && <Badge text={over ? 'Above threshold — check the spray plan' : 'Below threshold — no spray needed'} tone={over ? 'danger' : 'ok'} />}
      <Row>
        <View style={{ flex: 1 }}>
          <Button title="Camera" kind="secondary" onPress={() => void photo(true)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Gallery" kind="secondary" onPress={() => void photo(false)} />
        </View>
      </Row>
      <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        {photos.map((u) => (
          <Image key={u} source={{ uri: u }} style={{ width: 72, height: 72, borderRadius: 8 }} />
        ))}
      </Row>
      <Button title={gps ? `GPS ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'Add GPS location'} kind="secondary" onPress={() => void locate()} />
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
      <Button
        title="Save observation"
        disabled={!blockId || !pestId}
        onPress={async () => {
          await createRow('scouting_observations', {
            block_id: blockId,
            observed_on: today(),
            pest_id: pestId,
            metric: pest?.scoutingMetric ?? 'severity',
            value: value ?? null,
            severity: severity ?? null,
            lat: gps?.lat ?? null,
            lng: gps?.lng ?? null,
            photos, // local URIs; uploaded separately when online (see known gaps)
            observer_user_id: user?.id,
            notes: notes || null,
          });
          navigation.goBack();
        }}
      />
    </Screen>
  );
}

export function HarvestFormScreen({ route, navigation }: ScreenProps<'HarvestForm'>) {
  const { bundle } = useReference();
  const [blockId, setBlockId] = useState(route.params?.blockId);
  const { rows: blocks } = useTable<BlockRow>('blocks', [Q.where('id', blockId ?? '__none__')], [blockId]);
  const block = blocks[0];
  const [f, setF] = useState<{ variety_id?: string; picked_on: string; starch_index?: number; tss_brix?: number; firmness_lb?: number; red_colour_pct?: number; seed_brown?: number; grade?: string; box_type?: string; box_count?: number; mandi?: string; price_per_box_inr?: number; buyer?: string; purpose: 'table' | 'ca_storage' }>({ picked_on: today(), box_type: 'wooden', purpose: 'table' });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const varieties = (block?.variety_mix ?? []).map((m) => bundle.varieties.find((v) => v.id === m.varietyId)).filter((v): v is NonNullable<typeof v> => !!v);
  const variety = bundle.varieties.find((v) => v.id === f.variety_id);
  const verdict = useMemo(
    () =>
      assessMaturity(
        { date: f.picked_on, firmnessLb: f.firmness_lb, tssBrix: f.tss_brix, starchIndex: f.starch_index, redColourPct: f.red_colour_pct, seedBrownPct: f.seed_brown },
        { ...(variety ? { variety } : {}), ...(block?.full_bloom_date ? { fullBloom: block.full_bloom_date } : {}), purpose: f.purpose },
      ),
    [f, variety, block],
  );
  const kg = (BOX_TYPES.find((b) => b.id === f.box_type)?.kg ?? 0) * (f.box_count ?? 0);
  return (
    <Screen>
      <H>Harvest</H>
      <BlockPicker value={blockId} onChange={setBlockId} />
      <Select label="Variety" value={f.variety_id} options={(varieties.length ? varieties : bundle.varieties).map((v) => ({ value: v.id, label: v.name, sub: v.harvestWindow }))} onChange={set('variety_id')} />
      <Field label="Picked on (YYYY-MM-DD)" value={f.picked_on} onChangeText={set('picked_on')} error={isIsoDate(f.picked_on) ? undefined : 'Use YYYY-MM-DD'} />
      <Card title="Maturity check">
        <Select label="Purpose" value={f.purpose} options={[{ value: 'table', label: 'Table fruit (starch ≈ 3.5)' }, { value: 'ca_storage', label: 'CA storage (starch ≈ 2.5)' }]} onChange={set('purpose')} />
        <NumField label="Starch-iodine index (1–6)" value={f.starch_index} onChange={set('starch_index')} />
        <NumField label="TSS (°Brix)" value={f.tss_brix} onChange={set('tss_brix')} />
        <NumField label="Firmness (lb)" value={f.firmness_lb} onChange={set('firmness_lb')} />
        <NumField label="Red colour (%)" value={f.red_colour_pct} onChange={set('red_colour_pct')} />
        <NumField label="Seed colour (% brown)" value={f.seed_brown} onChange={set('seed_brown')} />
        {verdict.checks.filter((c) => c.pass != null).map((c) => (
          <Badge key={c.index} text={`${c.index}: ${c.value} (target ${c.target})`} tone={c.pass ? 'ok' : 'warn'} />
        ))}
        <Badge text={verdict.advice} tone={verdict.ready ? 'ok' : 'warn'} />
        {verdict.dafb != null && <P muted>{verdict.dafb} days after full bloom</P>}
      </Card>
      <Select label="Grade" value={f.grade} options={GRADES.map((g) => ({ value: g, label: `Grade ${g}` }))} onChange={set('grade')} />
      <Select label="Box type" value={f.box_type} options={BOX_TYPES.map((b) => ({ value: b.id, label: `${b.label} (~${b.kg} kg)` }))} onChange={set('box_type')} />
      <NumField label="Boxes" value={f.box_count} onChange={set('box_count')} hint={kg ? `≈ ${kg} kg` : undefined} />
      <Select label="Mandi" value={f.mandi} options={MANDIS.map((m) => ({ value: m, label: m }))} onChange={set('mandi')} />
      <NumField label="Price per box (₹)" value={f.price_per_box_inr} onChange={set('price_per_box_inr')} />
      <Field label="Buyer / commission agent" value={f.buyer ?? ''} onChangeText={set('buyer')} />
      <Button
        title="Save harvest"
        disabled={!blockId || !isIsoDate(f.picked_on)}
        onPress={async () => {
          const { purpose: _p, seed_brown: _s, ...rest } = f;
          await createRow('harvest_records', { ...rest, block_id: blockId, kg: kg || null, locked: false });
          navigation.goBack();
        }}
      />
    </Screen>
  );
}
