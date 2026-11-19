import React, { useState } from 'react';
import { Alert } from 'react-native';
import { Button, Card, Field, H, P, Screen } from '../ui/kit';
import { useAuth } from '../state/auth';
import { useT } from '../i18n';
import { meta } from '../db';
import { request, setToken, type User } from '../api/client';
import type { ScreenProps } from './nav';

const clean = (p: string) => p.replace(/\s/g, '');
const phoneOk = (p: string) => /^\+?\d{10,13}$/.test(clean(p));
const codeOk = (c: string) => /^\d{4,8}$/.test(c);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Purpose = 'login' | 'reset';
type Mode = 'password' | 'otp' | 'forgot';

const otpApi = {
  request: (phone: string, purpose: Purpose) => request<{ ok: true; expiresInSec: number }>('/v1/auth/otp/request', { method: 'POST', json: { phone, purpose } }).then((r) => r.data),
  verifyLogin: (phone: string, code: string) => request<{ token: string; user: User }>('/v1/auth/otp/verify', { method: 'POST', json: { phone, code, purpose: 'login' } }).then((r) => r.data),
  verifyReset: (phone: string, code: string) => request<{ resetToken: string }>('/v1/auth/otp/verify', { method: 'POST', json: { phone, code, purpose: 'reset' } }).then((r) => r.data),
  reset: (resetToken: string, password: string) => request<{ ok: true }>('/v1/auth/password/reset', { method: 'POST', json: { resetToken, password } }).then((r) => r.data),
};

/** Optional session adopter on the auth context (see docs/lanes/accounts.md). */
type AuthWithAdopt = ReturnType<typeof useAuth> & { adoptSession?: (token: string, user: User) => Promise<void> };

export function LoginScreen({ navigation }: ScreenProps<'Login'>) {
  const [mode, setMode] = useState<Mode>('password');
  if (mode === 'otp') return <OtpLogin onBack={() => setMode('password')} />;
  if (mode === 'forgot') return <ForgotPassword onBack={() => setMode('password')} />;
  return <PasswordLogin onSignup={() => navigation.navigate('Signup')} onMode={setMode} />;
}

function PasswordLogin({ onSignup, onMode }: { onSignup: () => void; onMode: (m: Mode) => void }) {
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
              await login(clean(phone), password);
            } catch (e) {
              Alert.alert('Login failed', message(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>
      <Button title="Log in with SMS code" kind="secondary" onPress={() => onMode('otp')} />
      <Button title="Forgot password?" kind="secondary" onPress={() => onMode('forgot')} />
      <Button title={t('signup')} kind="secondary" onPress={onSignup} />
    </Screen>
  );
}

/** Phone → code. Calls `onCode` with the verified phone and code. */
function OtpSteps({ purpose, title, intro, cta, onCode, onBack }: { purpose: Purpose; title: string; intro: string; cta: string; onCode: (phone: string, code: string) => Promise<void>; onBack: () => void }) {
  const { t } = useT();
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (p: string) => {
    setBusy(true);
    try {
      await otpApi.request(p, purpose);
      setSentTo(p);
      setCode('');
    } catch (e) {
      Alert.alert('Could not send code', message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <H>{title}</H>
      <P muted>{intro}</P>
      {!sentTo ? (
        <Card>
          <Field label={t('phone')} keyboardType="phone-pad" value={phone} onChangeText={setPhone} autoComplete="tel" />
          <Button title="Send code" loading={busy} disabled={!phoneOk(phone)} onPress={() => void send(clean(phone))} />
        </Card>
      ) : (
        <Card>
          <P muted>If {sentTo} is registered, a 6-digit code is on its way by SMS. It expires in 5 minutes.</P>
          <Field label="SMS code" keyboardType="number-pad" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 8))} autoComplete="sms-otp" textContentType="oneTimeCode" />
          <Button
            title={cta}
            loading={busy}
            disabled={!codeOk(code)}
            onPress={async () => {
              setBusy(true);
              try {
                await onCode(sentTo, code);
              } catch (e) {
                Alert.alert('Verification failed', message(e));
              } finally {
                setBusy(false);
              }
            }}
          />
          <Button title="Resend code" kind="secondary" disabled={busy} onPress={() => void send(sentTo)} />
          <Button title="Change number" kind="secondary" onPress={() => setSentTo(null)} />
        </Card>
      )}
      <Button title="Back to log in" kind="secondary" onPress={onBack} />
    </Screen>
  );
}

function OtpLogin({ onBack }: { onBack: () => void }) {
  const auth = useAuth() as AuthWithAdopt;
  return (
    <OtpSteps
      purpose="login"
      title="Log in with SMS code"
      intro="No password needed: we send a one-time code to your registered mobile number."
      cta="Log in"
      onBack={onBack}
      onCode={async (phone, code) => {
        const r = await otpApi.verifyLogin(phone, code);
        if (auth.adoptSession) {
          await auth.adoptSession(r.token, r.user);
          return;
        }
        // Persist the session exactly as the auth provider does; it is picked up on next launch.
        await setToken(r.token);
        await meta.set('auth.user', { user: r.user });
        Alert.alert('Signed in', 'Close and reopen Seb Orchard to continue.');
      }}
    />
  );
}

function ForgotPassword({ onBack }: { onBack: () => void }) {
  const { login } = useAuth();
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState(false);
  if (!resetToken)
    return (
      <OtpSteps
        purpose="reset"
        title="Reset password"
        intro="Verify your mobile number with an SMS code, then choose a new password."
        cta="Continue"
        onBack={onBack}
        onCode={async (p, code) => {
          const r = await otpApi.verifyReset(p, code);
          setPhone(p);
          setResetToken(r.resetToken);
        }}
      />
    );
  return (
    <Screen>
      <H>Choose a new password</H>
      <Card>
        <Field label="New password" secureTextEntry value={pw.a} onChangeText={(v) => setPw({ ...pw, a: v })} hint="At least 8 characters" />
        <Field label="Repeat new password" secureTextEntry value={pw.b} onChangeText={(v) => setPw({ ...pw, b: v })} error={pw.b && pw.a !== pw.b ? 'Passwords do not match' : undefined} />
        <Button
          title="Save and log in"
          loading={busy}
          disabled={pw.a.length < 8 || pw.a !== pw.b}
          onPress={async () => {
            setBusy(true);
            try {
              await otpApi.reset(resetToken, pw.a);
              await login(phone, pw.a);
            } catch (e) {
              Alert.alert('Could not reset password', message(e));
              setBusy(false);
            }
          }}
        />
      </Card>
      <Button title="Cancel" kind="secondary" onPress={onBack} />
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
              await signup({ ...f, phone: clean(f.phone) });
            } catch (e) {
              Alert.alert('Sign-up failed', message(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>
    </Screen>
  );
}
