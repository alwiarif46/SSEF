import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, Empty, Field, H, P, Row, Screen, Select } from '../ui/kit';
import { createRow, Q, updateRow, useTable } from '../db/repo';
import { useAuth } from '../state/auth';
import { api, type User } from '../api/client';
import { meta } from '../db';
import { fmtDate, isIsoDate, today } from '../lib/dates';
import type { BlockRow, OrchardRow, TaskRow } from '../lib/types';
import type { ScreenProps } from './nav';

const KINDS = ['spray', 'scouting', 'pruning', 'fertiliser', 'irrigation', 'trellis', 'hail_net', 'harvest', 'other'];

/** Team list, cached for offline assignment. */
export function useTeam(): User[] {
  const [team, setTeam] = useState<User[]>([]);
  const { can } = useAuth();
  useEffect(() => {
    void (async () => {
      const cached = await meta.get<User[]>('team');
      if (cached) setTeam(cached);
      if (!can('manager')) return;
      try {
        const u = await api.users();
        setTeam(u);
        await meta.set('team', u);
      } catch {
        /* offline */
      }
    })();
  }, []);
  return team;
}

export function TasksScreen({ navigation }: ScreenProps<'Tasks'>) {
  const { user, can } = useAuth();
  const mineOnly = !can('manager');
  const { rows, models } = useTable<TaskRow>('tasks', mineOnly ? [Q.where('assignee_user_id', user?.id ?? '')] : [], [mineOnly, user?.id]);
  const team = useTeam();
  const open = rows.map((r, i) => ({ r, m: models[i]! })).filter((x) => x.r.status !== 'done').sort((a, b) => (a.r.due_on ?? '9').localeCompare(b.r.due_on ?? '9'));
  const done = rows.filter((r) => r.status === 'done').length;
  return (
    <Screen>
      <H>Tasks</H>
      {can('manager') && <Button title="New task" onPress={() => navigation.navigate('TaskForm', {})} />}
      {open.length === 0 && <Empty text="No open tasks." />}
      {open.map(({ r, m }) => {
        const overdue = r.due_on && r.due_on < today();
        return (
          <Card key={r.id} title={r.title} right={<Badge text={r.kind} tone="muted" />}>
            <P muted>
              Due {fmtDate(r.due_on)} · {team.find((u) => u.id === r.assignee_user_id)?.name ?? (r.assignee_user_id ? 'assigned' : 'unassigned')}
            </P>
            {overdue && <Badge text="Overdue" tone="danger" />}
            {r.notes ? <P>{r.notes}</P> : null}
            <Row>
              {r.status === 'open' && (
                <View style={{ flex: 1 }}>
                  <Button title="Start" kind="secondary" onPress={() => void updateRow(m, { status: 'in_progress' })} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Button title="Mark done" onPress={() => void updateRow(m, { status: 'done', completed_at: new Date().toISOString(), completed_by: user?.id })} />
              </View>
            </Row>
          </Card>
        );
      })}
      <P muted>{done} completed task(s).</P>
    </Screen>
  );
}

export function TaskFormScreen({ route, navigation }: ScreenProps<'TaskForm'>) {
  const team = useTeam();
  const { rows: orchards } = useTable<OrchardRow>('orchards');
  const [orchardId, setOrchardId] = useState(route.params?.orchardId);
  const { rows: blocks } = useTable<BlockRow>('blocks', [Q.where('orchard_id', orchardId ?? '__none__')], [orchardId]);
  const [f, setF] = useState<{ title: string; kind: string; block_id?: string; assignee_user_id?: string; due_on: string; notes: string }>({ title: '', kind: 'spray', block_id: route.params?.blockId, due_on: today(), notes: '' });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Screen>
      <H>New task</H>
      <Field label="Title" value={f.title} onChangeText={set('title')} />
      <Select label="Kind" value={f.kind} options={KINDS.map((k) => ({ value: k, label: k.replace('_', ' ') }))} onChange={set('kind')} />
      <Select label="Orchard" value={orchardId} options={orchards.map((o) => ({ value: o.id, label: o.name }))} onChange={setOrchardId} />
      <Select label="Block (optional)" value={f.block_id} options={blocks.map((b) => ({ value: b.id, label: b.name }))} onChange={set('block_id')} />
      <Select label="Assign to" value={f.assignee_user_id} options={team.map((u) => ({ value: u.id, label: u.name, sub: u.role }))} onChange={set('assignee_user_id')} />
      <Field label="Due (YYYY-MM-DD)" value={f.due_on} onChangeText={set('due_on')} />
      <Field label="Instructions" value={f.notes} onChangeText={set('notes')} multiline />
      <Button
        title="Create task"
        disabled={!f.title.trim() || !orchardId || !isIsoDate(f.due_on)}
        onPress={async () => {
          await createRow('tasks', { ...f, orchard_id: orchardId, status: 'open' });
          navigation.goBack();
        }}
      />
    </Screen>
  );
}
