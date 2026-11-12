import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import type { Role } from '@orchard/domain';
import { GENERAL_INSTRUCTIONS_2026 } from '@orchard/reference';
import { Badge, Button, Card, Field, H, P, Row, Screen, Select } from '../ui/kit';
import { useAuth } from '../state/auth';
import { useReference } from '../state/reference';
import { useT, type Lang } from '../i18n';
import { api, getBaseUrl, setBaseUrl, type User } from '../api/client';
import { synchronize } from '../sync/sync';
import type { ScreenProps } from './nav';

export function MoreScreen({ navigation }: ScreenProps<'Tabs'>) {
  const { can } = useAuth();
  const { t } = useT();
  const items: [string, () => void, boolean][] = [
    [t('tasks'), () => navigation.navigate('Tasks'), true],
    [t('inventory'), () => navigation.navigate('Inventory'), true],
    [t('tank'), () => navigation.navigate('TankCalc'), true],
    ['SKUAST-K schedule', () => navigation.navigate('Schedule'), true],
    [t('safety'), () => navigation.navigate('Safety'), true],
    [t('users'), () => navigation.navigate('Users'), can('manager')],
    [t('settings'), () => navigation.navigate('Settings'), true],
  ];
  return (
    <Screen>
      <H>{t('more')}</H>
      {items.filter(([, , show]) => show).map(([label, go]) => (
        <Button key={label} title={label} kind="secondary" onPress={go} />
      ))}
    </Screen>
  );
}

export function SafetyScreen() {
  const { bundle } = useReference();
  return (
    <Screen>
      <H>Applicator safety</H>
      <Card title="Do">
        {bundle.safety.filter((x) => x.kind === 'do').map((x) => (
          <P key={x.id}>✓ {x.text}</P>
        ))}
      </Card>
      <Card title="Don't">
        {bundle.safety.filter((x) => x.kind === 'dont').map((x) => (
          <P key={x.id}>✗ {x.text}</P>
        ))}
      </Card>
      <Card title="SKUAST-K general instructions">
        {GENERAL_INSTRUCTIONS_2026.map((g) => (
          <P key={g}>• {g}</P>
        ))}
      </Card>
      <Card title="Poisoning emergency">
        <P>Move the person to fresh air, remove contaminated clothes, wash skin with soap and water, and take the pesticide label to the nearest hospital.</P>
      </Card>
    </Screen>
  );
}

export function SettingsScreen() {
  const { user, tenant, logout } = useAuth();
  const { lang, setLang, t } = useT();
  const { bundle, source, refresh } = useReference();
  const [url, setUrl] = useState(getBaseUrl());
  return (
    <Screen>
      <H>{t('settings')}</H>
      <Card title="Account">
        <P>{user?.name} · {user?.phone}</P>
        <Row>
          <Badge text={user?.role ?? '—'} tone="info" />
          <P muted>{tenant?.name}</P>
        </Row>
      </Card>
      <Select<Lang> label="Language" value={lang} options={[{ value: 'en', label: 'English' }, { value: 'ur', label: 'اردو (Urdu — preview)' }]} onChange={setLang} />
      <Card title="Reference data">
        <P>{bundle.version.source}</P>
        <Row>
          <Badge text={bundle.version.status} tone={bundle.version.status === 'published' ? 'ok' : 'warn'} />
          <Badge text={`source: ${source}`} tone="muted" />
        </Row>
        <P muted>{bundle.version.disclaimer}</P>
        <Button title="Check for schedule update" kind="secondary" onPress={() => void refresh()} />
      </Card>
      <Card title="Server">
        <Field label="API URL" value={url} onChangeText={setUrl} autoCapitalize="none" />
        <Button title="Save URL" kind="secondary" onPress={() => void setBaseUrl(url)} />
        <Button title={t('sync')} kind="secondary" onPress={() => void synchronize()} />
      </Card>
      <Button
        title={t('logout')}
        kind="danger"
        onPress={() =>
          Alert.alert('Log out?', 'Unsynced changes on this device will be lost.', [
            { text: 'Cancel' },
            { text: 'Log out', style: 'destructive', onPress: () => void logout() },
          ])
        }
      />
    </Screen>
  );
}

export function UsersScreen() {
  const { can } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [f, setF] = useState<{ name: string; phone: string; password: string; role: Role }>({ name: '', phone: '', password: '', role: 'worker' });
  const load = () => api.users().then(setUsers).catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  return (
    <Screen>
      <H>Team</H>
      {users.map((u) => (
        <Card key={u.id} title={u.name} right={<Badge text={u.role} tone="info" />}>
          <P muted>{u.phone}</P>
        </Card>
      ))}
      {can('owner') && (
        <Card title="Add team member">
          <Field label="Name" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} />
          <Field label="Phone" keyboardType="phone-pad" value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} />
          <Field label="Temporary password" secureTextEntry value={f.password} onChangeText={(v) => setF({ ...f, password: v })} />
          <Select<Role> label="Role" value={f.role} options={[{ value: 'worker', label: 'Worker / sprayer' }, { value: 'manager', label: 'Manager' }]} onChange={(r) => setF({ ...f, role: r })} />
          <Button
            title="Add"
            disabled={!f.name || f.phone.length < 10 || f.password.length < 8}
            onPress={async () => {
              try {
                await api.createUser(f);
                setF({ name: '', phone: '', password: '', role: 'worker' });
                await load();
              } catch (e) {
                Alert.alert('Could not add', e instanceof Error ? e.message : String(e));
              }
            }}
          />
        </Card>
      )}
      {!can('owner') && <P muted>Only the owner can add team members (requires connection).</P>}
    </Screen>
  );
}
