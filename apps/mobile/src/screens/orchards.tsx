import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import * as Location from 'expo-location';
import { harvestFromBloom, kanalToHectare, pollinizerCheck, treesPerKanal } from '@orchard/domain';
import { Badge, Button, Card, Empty, Field, H, NumField, P, Row, Screen, Select, Toggle, type Option } from '../ui/kit';
import { createRow, deleteRow, findRow, Q, updateRow, useTable } from '../db/repo';
import { useReference } from '../state/reference';
import { useAuth } from '../state/auth';
import { isIsoDate, fmtDate } from '../lib/dates';
import type { BlockRow, OrchardRow, VarietyShare } from '../lib/types';
import type { ScreenProps } from './nav';

export const DISTRICTS = ['Anantnag', 'Bandipora', 'Baramulla', 'Budgam', 'Ganderbal', 'Kulgam', 'Kupwara', 'Pulwama', 'Shopian', 'Srinagar', 'Kargil', 'Leh'];
const SYSTEMS: Option<BlockRow['system_type']>[] = [
  { value: 'traditional', label: 'Traditional (seedling / vigorous)' },
  { value: 'medium_density', label: 'Medium density (MM106 / MM111)' },
  { value: 'hdp', label: 'High density (M9 / B9, trellis + drip)' },
];

export function OrchardsScreen({ navigation }: ScreenProps<'Tabs'>) {
  const { rows } = useTable<OrchardRow>('orchards');
  const { can } = useAuth();
  return (
    <Screen>
      <H>Orchards</H>
      {can('manager') && <Button title="Add orchard" onPress={() => navigation.navigate('OrchardForm', {})} />}
      {rows.length === 0 && <Empty text="No orchards yet." />}
      {rows.map((o) => (
        <Card key={o.id} title={o.name} right={<Badge text={o.district ?? '—'} tone="muted" />} onPress={() => navigation.navigate('OrchardDetail', { orchardId: o.id })}>
          <P muted>
            {o.village ? `${o.village} · ` : ''}
            {o.area_kanal != null ? `${o.area_kanal} kanal (${kanalToHectare(o.area_kanal).toFixed(2)} ha)` : 'area not set'}
            {o.elevation_m != null ? ` · ${o.elevation_m} m` : ''}
          </P>
        </Card>
      ))}
    </Screen>
  );
}

export function OrchardDetailScreen({ route, navigation }: ScreenProps<'OrchardDetail'>) {
  const { orchardId } = route.params;
  const { rows: orchards } = useTable<OrchardRow>('orchards', [Q.where('id', orchardId)], [orchardId]);
  const { rows: blocks } = useTable<BlockRow>('blocks', [Q.where('orchard_id', orchardId)], [orchardId]);
  const { bundle } = useReference();
  const { can } = useAuth();
  const o = orchards[0];
  if (!o) return <Empty text="Orchard not found." />;
  return (
    <Screen>
      <H>{o.name}</H>
      <P muted>
        {[o.village, o.district].filter(Boolean).join(', ')} {o.lat != null ? `· ${o.lat.toFixed(4)}, ${o.lng?.toFixed(4)}` : '· no GPS (weather needs lat/long)'}
      </P>
      {can('manager') && (
        <Row>
          <View style={{ flex: 1 }}>
            <Button title="Edit orchard" kind="secondary" onPress={() => navigation.navigate('OrchardForm', { orchardId })} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Add block" onPress={() => navigation.navigate('BlockForm', { orchardId })} />
          </View>
        </Row>
      )}
      {blocks.length === 0 && <Empty text="No blocks. Add a block to plan sprays." />}
      {blocks.map((b) => {
        const rs = bundle.rootstocks.find((r) => r.id === b.rootstock_id);
        return (
          <Card key={b.id} title={b.name} right={<Badge text={b.system_type === 'hdp' ? 'HDP' : b.system_type === 'medium_density' ? 'Medium density' : 'Traditional'} tone={b.system_type === 'hdp' ? 'info' : 'muted'} />} onPress={() => navigation.navigate('BlockDetail', { blockId: b.id })}>
            <P muted>
              {b.tree_count ?? '?'} trees{rs ? ` · ${rs.name}` : ''}{b.planting_year ? ` · planted ${b.planting_year}` : ''}
              {b.scab_resistant ? ' · scab-resistant (low-spray)' : ''}
            </P>
            {b.expected_harvest_date && <P muted>Expected harvest {fmtDate(b.expected_harvest_date)}</P>}
          </Card>
        );
      })}
      <Button title="Add task" kind="secondary" onPress={() => navigation.navigate('TaskForm', { orchardId })} />
    </Screen>
  );
}

export function OrchardFormScreen({ route, navigation }: ScreenProps<'OrchardForm'>) {
  const id = route.params?.orchardId;
  const { rows, models } = useTable<OrchardRow>('orchards', [Q.where('id', id ?? '__new__')], [id]);
  const existing = rows[0];
  const [f, setF] = useState<Partial<OrchardRow>>({});
  const v = { ...existing, ...f };
  const set = (k: keyof OrchardRow) => (x: unknown) => setF((p) => ({ ...p, [k]: x }));
  const locate = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Location permission denied');
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setF((p) => ({ ...p, lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5), ...(pos.coords.altitude != null ? { elevation_m: Math.round(pos.coords.altitude) } : {}) }));
  };
  return (
    <Screen>
      <H>{existing ? 'Edit orchard' : 'New orchard'}</H>
      <Field label="Name" value={v.name ?? ''} onChangeText={set('name')} />
      <Select label="District" value={v.district} options={DISTRICTS.map((d) => ({ value: d, label: d }))} onChange={set('district')} />
      <Field label="Village" value={v.village ?? ''} onChangeText={set('village')} />
      <NumField label="Area (kanal)" value={v.area_kanal} onChange={set('area_kanal')} hint="1 kanal = 20 marla = 505.86 m²; 8 kanal = 1 acre" />
      <Button title={v.lat != null ? `GPS ${v.lat}, ${v.lng}` : 'Use current location'} kind="secondary" onPress={() => void locate()} />
      <NumField key={`el-${v.elevation_m}`} label="Elevation (m)" value={v.elevation_m} onChange={set('elevation_m')} hint="Shifts stage windows ≈ 3 days per 100 m above 1,700 m" />
      <Field label="Notes" value={v.notes ?? ''} onChangeText={set('notes')} multiline />
      <Button
        title="Save"
        disabled={!v.name?.trim()}
        onPress={async () => {
          if (existing && models[0]) await updateRow(models[0], f);
          else await createRow('orchards', v);
          navigation.goBack();
        }}
      />
      {existing && models[0] && (
        <Button
          title="Delete orchard"
          kind="danger"
          onPress={() =>
            Alert.alert('Delete orchard?', 'Blocks and records stay on the server for audit.', [
              { text: 'Cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => void deleteRow(models[0]!).then(() => navigation.popToTop()) },
            ])
          }
        />
      )}
    </Screen>
  );
}

export function BlockFormScreen({ route, navigation }: ScreenProps<'BlockForm'>) {
  const { orchardId, blockId } = route.params;
  const { bundle } = useReference();
  const { rows, models } = useTable<BlockRow>('blocks', [Q.where('id', blockId ?? '__new__')], [blockId]);
  const existing = rows[0];
  const [f, setF] = useState<Partial<BlockRow>>({});
  const v: Partial<BlockRow> = { ...existing, ...f };
  v.system_type ??= 'traditional';
  v.variety_mix ??= [];
  const set = (k: keyof BlockRow) => (x: unknown) => setF((p) => ({ ...p, [k]: x }));
  const mix: VarietyShare[] = v.variety_mix ?? [];
  const rootstocks = bundle.rootstocks.filter((r) => (v.system_type === 'hdp' ? r.vigor === 'dwarf' : true));
  const rs = bundle.rootstocks.find((r) => r.id === v.rootstock_id);
  const varietyOpts = bundle.varieties.filter((x) => (v.system_type === 'hdp' ? x.hdpSuitable : true)).map((x) => ({ value: x.id, label: x.name, sub: [x.scabResistant ? `scab-resistant ${x.resistanceGene ?? ''}` : '', x.pollinizerRole !== 'main' ? 'pollinizer' : '', x.harvestWindow ?? ''].filter(Boolean).join(' · ') }));
  const mainVariety = bundle.varieties.find((x) => x.id === [...mix].sort((a, b) => b.trees - a.trees)[0]?.varietyId);
  const allResistant = mix.length > 0 && mix.every((m) => bundle.varieties.find((x) => x.id === m.varietyId)?.scabResistant);
  const earliestDafb = Math.min(...mix.map((m) => bundle.varieties.find((x) => x.id === m.varietyId)?.dafbMin ?? Infinity));
  const suggestedHarvest = v.full_bloom_date && isIsoDate(v.full_bloom_date) && Number.isFinite(earliestDafb) ? harvestFromBloom(v.full_bloom_date, earliestDafb) : undefined;
  const pol = mix.length ? pollinizerCheck(mix, bundle.varieties) : undefined;
  const [addVar, setAddVar] = useState<string>();
  const [addTrees, setAddTrees] = useState<number>();

  return (
    <Screen>
      <H>{existing ? 'Edit block' : 'New block'}</H>
      <Field label="Block name" value={v.name ?? ''} onChangeText={set('name')} />
      <Select label="System" value={v.system_type} options={SYSTEMS} onChange={set('system_type')} />
      <Select label="Rootstock" value={v.rootstock_id} options={rootstocks.map((r) => ({ value: r.id, label: r.name, sub: `${r.vigor.replace('_', '-')}${r.spacingM ? ` · ${r.spacingM[0]}×${r.spacingM[1]} m ≈ ${r.treesPerKanal}/kanal` : ''}` }))} onChange={set('rootstock_id')} />
      {rs?.cautions.map((c) => <Badge key={c} text={c} tone="warn" />)}
      <NumField label="Planting year" value={v.planting_year} onChange={set('planting_year')} />
      <NumField label="Area (kanal)" value={v.area_kanal} onChange={set('area_kanal')} hint={rs?.spacingM && v.area_kanal ? `≈ ${Math.round(treesPerKanal(rs.spacingM[0], rs.spacingM[1]) * v.area_kanal)} trees at ${rs.spacingM[0]}×${rs.spacingM[1]} m` : undefined} />
      <NumField label="Tree count" value={v.tree_count} onChange={set('tree_count')} />
      <Card title="Variety mix">
        {mix.length === 0 && <P muted>Add varieties with tree counts (include pollinizers).</P>}
        {mix.map((m) => (
          <Row key={m.varietyId}>
            <P>{bundle.varieties.find((x) => x.id === m.varietyId)?.name ?? m.varietyId}: {m.trees}</P>
            <Button title="Remove" kind="secondary" onPress={() => set('variety_mix')(mix.filter((x) => x.varietyId !== m.varietyId))} />
          </Row>
        ))}
        <Select label="Variety" value={addVar} options={varietyOpts} onChange={setAddVar} />
        <NumField label="Trees" value={addTrees} onChange={setAddTrees} />
        <Button
          title="Add variety"
          kind="secondary"
          disabled={!addVar || !addTrees}
          onPress={() => {
            set('variety_mix')([...mix.filter((x) => x.varietyId !== addVar), { varietyId: addVar!, trees: addTrees! }]);
            setAddVar(undefined);
          }}
        />
        {pol && <Badge text={`Pollinizers ${pol.share}% — ${pol.advice}`} tone={pol.ok ? 'ok' : 'warn'} />}
      </Card>
      <Toggle label={`Scab-resistant (Rvi6) low-spray programme${allResistant ? ' — all varieties resistant' : ''}`} value={!!v.scab_resistant} onChange={set('scab_resistant')} />
      {v.scab_resistant && !allResistant && <Badge text="Not every variety in this block is scab-resistant — the full schedule is safer." tone="warn" />}
      <Field label="Full bloom date (YYYY-MM-DD)" value={v.full_bloom_date ?? ''} onChangeText={set('full_bloom_date')} error={v.full_bloom_date && !isIsoDate(v.full_bloom_date) ? 'Use YYYY-MM-DD' : undefined} />
      <Field label="Expected harvest date (YYYY-MM-DD)" value={v.expected_harvest_date ?? ''} onChangeText={set('expected_harvest_date')} hint={suggestedHarvest ? `Suggested from DAFB (${mainVariety?.name ?? 'earliest variety'}): ${suggestedHarvest}` : 'Needed for PHI checks — sprays stop 3–4 weeks before harvest'} />
      {suggestedHarvest && v.expected_harvest_date !== suggestedHarvest && <Button title={`Use ${suggestedHarvest}`} kind="secondary" onPress={() => set('expected_harvest_date')(suggestedHarvest)} />}
      <Select label="Observed stage (overrides calendar)" value={v.observed_stage_id} options={bundle.stages.map((s) => ({ value: s.id, label: `${s.order}. ${s.name}`, sub: s.phenology }))} onChange={set('observed_stage_id')} />
      {v.system_type !== 'traditional' && (
        <>
          <Toggle label="Drip irrigation" value={!!v.drip} onChange={set('drip')} />
          <Toggle label="Trellis" value={!!v.trellis} onChange={set('trellis')} />
        </>
      )}
      <Toggle label="Anti-hail net" value={!!v.hail_net} onChange={set('hail_net')} />
      <Button
        title="Save"
        disabled={!v.name?.trim() || (!!v.expected_harvest_date && !isIsoDate(v.expected_harvest_date))}
        onPress={async () => {
          if (existing && models[0]) await updateRow(models[0], f);
          else await createRow('blocks', { ...v, orchard_id: orchardId });
          navigation.goBack();
        }}
      />
      {existing && models[0] && <Button title="Delete block" kind="danger" onPress={() => void deleteRow(models[0]!).then(() => navigation.goBack())} />}
    </Screen>
  );
}

export function BlockDetailScreen({ route, navigation }: ScreenProps<'BlockDetail'>) {
  const { blockId } = route.params;
  const { rows } = useTable<BlockRow>('blocks', [Q.where('id', blockId)], [blockId]);
  const { rows: sprays } = useTable<{ id: string; sprayed_on: string; stage_id?: string; products: { chemicalId: string; quantity: number; unit: string }[] | null; locked?: boolean; corrects_id?: string }>('spray_events', [Q.where('block_id', blockId), Q.sortBy('sprayed_on', Q.desc)], [blockId]);
  const { bundle } = useReference();
  const { can } = useAuth();
  const b = rows[0];
  if (!b) return <Empty text="Block not found." />;
  return (
    <Screen>
      <H>{b.name}</H>
      <Row>
        <View style={{ flex: 1 }}>
          <Button title="Spray plan" onPress={() => navigation.navigate('SprayPlan', { blockId })} />
        </View>
        {can('manager') && (
          <View style={{ flex: 1 }}>
            <Button title="Edit" kind="secondary" onPress={() => navigation.navigate('BlockForm', { orchardId: b.orchard_id, blockId })} />
          </View>
        )}
      </Row>
      <Row>
        <View style={{ flex: 1 }}>
          <Button title="Scout" kind="secondary" onPress={() => navigation.navigate('ScoutingForm', { blockId })} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Harvest" kind="secondary" onPress={() => navigation.navigate('HarvestForm', { blockId })} />
        </View>
      </Row>
      <Card title="Spray log">
        {sprays.length === 0 && <P muted>No sprays recorded.</P>}
        {sprays.map((s) => (
          <View key={s.id} style={{ gap: 2 }}>
            <Row>
              <P>
                {fmtDate(s.sprayed_on)} · {bundle.stages.find((x) => x.id === s.stage_id)?.name ?? 'off-schedule'}
              </P>
              {s.locked ? <Badge text="Locked" tone="muted" /> : <Badge text="Pending sync" tone="warn" />}
            </Row>
            <P muted>
              {(s.products ?? []).map((p) => `${bundle.chemicals.find((c) => c.id === p.chemicalId)?.product ?? p.chemicalId} ${p.quantity} ${p.unit}`).join(' + ')}
              {s.corrects_id ? ' (correction)' : ''}
            </P>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

export { findRow };
