import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { currentStage, nextStage, diseaseRisks, wetnessProgress } from '@orchard/domain';
import { Badge, Button, Card, Empty, H, P, Row, Screen, type Tone } from '../ui/kit';
import { colors } from '../ui/theme';
import { Q, updateRow, useTable } from '../db/repo';
import { useReference } from '../state/reference';
import { useAuth } from '../state/auth';
import { useT } from '../i18n';
import { fmtDate, today } from '../lib/dates';
import { weatherHours } from '../lib/context';
import { getSyncStatus, onSyncStatus, synchronize, type SyncStatus } from '../sync/sync';
import type { AlertRow, BlockRow, OrchardRow, WeatherDailyRow } from '../lib/types';
import type { ScreenProps } from './nav';

const sevTone = (s: string): Tone => (s === 'critical' || s === 'high' ? 'danger' : s === 'medium' ? 'warn' : 'info');

export function useSyncStatus() {
  const [s, setS] = useState<SyncStatus>(getSyncStatus());
  useEffect(() => {
    const off = onSyncStatus(setS);
    return () => {
      off();
    };
  }, []);
  return s;
}

export function SyncBar() {
  const s = useSyncStatus();
  const tone: Tone = s.state === 'error' ? 'danger' : s.state === 'offline' ? 'warn' : s.state === 'syncing' ? 'info' : 'ok';
  const label = s.state === 'syncing' ? 'Syncing…' : s.state === 'offline' ? 'Offline — changes saved on device' : s.state === 'error' ? `Sync error: ${s.error}` : s.lastSyncedAt ? `Synced ${new Date(s.lastSyncedAt).toLocaleTimeString()}` : 'Not synced yet';
  return (
    <Card>
      <Row>
        <Badge text={label} tone={tone} />
        <Button title="Sync" kind="secondary" onPress={() => void synchronize()} />
      </Row>
      {!!s.rejected?.length && <P muted>{s.rejected.length} change(s) rejected by server: {s.rejected.map((r) => r.reason).slice(0, 2).join('; ')}</P>}
      {!!s.conflicts?.length && <P muted>{s.conflicts.length} record(s) merged with newer server edits.</P>}
    </Card>
  );
}

function OrchardToday({ orchard, nav }: { orchard: OrchardRow; nav: ScreenProps<'Tabs'>['navigation'] }) {
  const { bundle } = useReference();
  const date = today();
  const { rows: blocks } = useTable<BlockRow>('blocks', [Q.where('orchard_id', orchard.id)], [orchard.id]);
  const { rows: alerts, models: alertModels } = useTable<AlertRow>('infection_alerts', [Q.where('orchard_id', orchard.id), Q.where('acknowledged', Q.notEq(true))], [orchard.id]);
  const { rows: weather } = useTable<WeatherDailyRow>('weather_daily', [Q.where('orchard_id', orchard.id), Q.where('day', Q.gte(addDaysIso(date, -7)))], [orchard.id, date]);
  const stage = currentStage(bundle.stages, date, { elevationM: orchard.elevation_m, observedStageId: blocks.find((b) => b.observed_stage_id)?.observed_stage_id });
  const next = nextStage(bundle.stages, date, orchard.elevation_m);
  const hours = useMemo(() => weatherHours(weather), [weather]);
  const risks = useMemo(() => diseaseRisks(hours.filter((h) => !h.isForecast)), [hours]);
  const wet = useMemo(() => (hours.length ? wetnessProgress(hours, new Date().toISOString()) : null), [hours]);
  const days = [...weather].sort((a, b) => a.day.localeCompare(b.day)).filter((d) => d.day >= date).slice(0, 5);

  return (
    <Card title={orchard.name} right={<Badge text={orchard.district ?? 'Kashmir'} tone="muted" />} onPress={() => nav.navigate('OrchardDetail', { orchardId: orchard.id })}>
      <Row>
        <View style={{ flex: 1 }}>
          <P muted>Current stage (est.)</P>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{stage ? `${stage.order}. ${stage.name}` : '—'}</Text>
          {stage && <P muted>{stage.timingGuidance}</P>}
        </View>
      </Row>
      {next && <P muted>Next: {next.stage.name} in ~{next.inDays} days ({fmtDate(next.start)})</P>}
      {wet && wet.percent > 0 && <Badge text={`Leaf wetness ${wet.wetHours} h — ${wet.percent}% toward scab infection (advisory)`} tone={wet.percent >= 75 ? 'danger' : 'warn'} />}
      {alerts.length > 0 && (
        <View style={{ gap: 6 }}>
          {alerts.map((a, i) => (
            <Card key={a.id} style={{ borderColor: colors[sevTone(a.severity) === 'danger' ? 'danger' : 'warn'] }}>
              <Row>
                <Text style={{ fontWeight: '700', flex: 1, color: colors.text }}>{a.title}</Text>
                <Badge text={a.advisory ? 'Advisory' : a.severity} tone={a.advisory ? 'muted' : sevTone(a.severity)} />
              </Row>
              {a.body ? <P>{a.body}</P> : null}
              {a.recommended_action ? <P muted>→ {a.recommended_action}</P> : null}
              <Button title="Acknowledge" kind="secondary" onPress={() => void updateRow(alertModels[i]!, { acknowledged: true, acknowledged_at: new Date().toISOString() })} />
            </Card>
          ))}
        </View>
      )}
      {days.length > 0 && (
        <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          {days.map((d) => (
            <View key={d.id} style={{ alignItems: 'center', minWidth: 58 }}>
              <P muted>{d.day.slice(5)}</P>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{Math.round(d.min_c ?? 0)}°/{Math.round(d.max_c ?? 0)}°</Text>
              <P muted>{(d.precip_mm ?? 0).toFixed(0)} mm</P>
            </View>
          ))}
        </Row>
      )}
      {risks.some((r) => r.level !== 'low') && (
        <Row style={{ flexWrap: 'wrap', justifyContent: 'flex-start' }}>
          {risks.filter((r) => r.level !== 'low').map((r) => (
            <Badge key={r.key} text={`${r.label}: ${r.level}`} tone={r.level === 'high' ? 'danger' : 'warn'} />
          ))}
        </Row>
      )}
      <P muted>{blocks.length} block(s) · tap for details</P>
    </Card>
  );
}

function addDaysIso(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function TodayScreen({ navigation }: ScreenProps<'Tabs'>) {
  const { rows: orchards } = useTable<OrchardRow>('orchards');
  const { user, can } = useAuth();
  const { t } = useT();
  const { bundle } = useReference();
  return (
    <Screen>
      <H>{t('today')} · {fmtDate(today())}</H>
      <P muted>Hello {user?.name}. Schedule: {bundle.version.source} ({bundle.version.status}).</P>
      <SyncBar />
      {orchards.length === 0 ? (
        <>
          <Empty text="No orchards yet." />
          {can('manager') && <Button title="Add orchard" onPress={() => navigation.navigate('OrchardForm', {})} />}
        </>
      ) : (
        orchards.map((o) => <OrchardToday key={o.id} orchard={o} nav={navigation} />)
      )}
    </Screen>
  );
}
