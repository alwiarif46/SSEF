import React, { useState } from 'react';
import { Alert } from 'react-native';
import { Button, Card, Field, H, P, Screen } from '../ui/kit';
import { useAuth } from '../state/auth';
import { useT } from '../i18n';
import type { ScreenProps } from './nav';

const phoneOk = (p: string) => /^\+?\d{10,13}$/.test(p.replace(/\s/g, ''));

export function LoginScreen({ navigation }: ScreenProps<'Login'>) {
  const { login } = useAuth();
  const { t } = useT();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Screen>
      <H>Seb Orchard</H>
      <P muted>Kashmir apple orchard management — SKUAST-K schedule, offline-first.</P>
      <Card>
        <Field label={t('phone')} keyboardType="phone-pad" value={phone} onChangeText={setPhone} autoComplete="tel" />
        <Field label={t('password')} secureTextEntry value={password} onChangeText={setPassword} />
        <Button
          title={t('login')}
          loading={busy}
          disabled={!phoneOk(phone) || password.length < 6}
          onPress={async () => {
            setBusy(true);
            try {
              await login(phone.replace(/\s/g, ''), password);
            } catch (e) {
              Alert.alert('Login failed', e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>
      <Button title={t('signup')} kind="secondary" onPress={() => navigation.navigate('Signup')} />
    </Screen>
  );
}

export function SignupScreen() {
  const { signup } = useAuth();
  const { t } = useT();
  const [f, setF] = useState({ tenantName: '', name: '', phone: '', password: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const valid = f.tenantName.trim().length > 1 && f.name.trim().length > 1 && phoneOk(f.phone) && f.password.length >= 8;
  return (
    <Screen>
      <H>{t('signup')}</H>
      <P muted>Creates your orchard business. You become the owner and can add managers and workers.</P>
      <Card>
        <Field label="Orchard business name" value={f.tenantName} onChangeText={set('tenantName')} />
        <Field label={t('name')} value={f.name} onChangeText={set('name')} />
        <Field label={t('phone')} keyboardType="phone-pad" value={f.phone} onChangeText={set('phone')} />
        <Field label={t('password')} secureTextEntry value={f.password} onChangeText={set('password')} hint="At least 8 characters" />
        <Button
          title={t('signup')}
          loading={busy}
          disabled={!valid}
          onPress={async () => {
            setBusy(true);
            try {
              await signup({ ...f, phone: f.phone.replace(/\s/g, '') });
            } catch (e) {
              Alert.alert('Sign-up failed', e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>
    </Screen>
  );
}
