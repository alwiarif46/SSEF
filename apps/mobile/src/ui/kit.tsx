import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, radius, space, touch } from './theme';

export function Screen({ children, scroll = true, padded = true }: { children: React.ReactNode; scroll?: boolean; padded?: boolean }) {
  const inner = <View style={[{ gap: space(1.5) }, padded && { padding: space(2) }]}>{children}</View>;
  return scroll ? (
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space(6) }}>
      {inner}
    </ScrollView>
  ) : (
    <View style={[s.screen, padded && { padding: space(2) }]}>{children}</View>
  );
}

export function Card({ children, title, right, style, onPress }: { children?: React.ReactNode; title?: string; right?: React.ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const body = (
    <View style={[s.card, style]}>
      {(title || right) && (
        <View style={s.row}>
          {title ? <Text style={s.cardTitle}>{title}</Text> : <View />}
          {right}
        </View>
      )}
      {children}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} android_ripple={{ color: colors.border }} accessibilityRole="button">
      {body}
    </Pressable>
  ) : (
    body
  );
}

type BtnKind = 'primary' | 'secondary' | 'danger';
export function Button({ title, onPress, kind = 'primary', disabled, loading }: { title: string; onPress: () => void; kind?: BtnKind; disabled?: boolean; loading?: boolean }) {
  const bg = kind === 'primary' ? colors.primary : kind === 'danger' ? colors.danger : colors.card;
  const fg = kind === 'secondary' ? colors.primary : colors.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, kind === 'secondary' && { borderWidth: 1, borderColor: colors.primary }]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted';
export function Badge({ text, tone = 'info' }: { text: string; tone?: Tone }) {
  const c = tone === 'muted' ? colors.muted : colors[tone];
  return (
    <View style={[s.badge, { borderColor: c, backgroundColor: `${c}14` }]}>
      <Text style={[s.badgeText, { color: c }]}>{text}</Text>
    </View>
  );
}

export function Field({ label, hint, error, ...props }: TextInputProps & { label: string; hint?: string; error?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={[s.input, error ? { borderColor: colors.danger } : null]} {...props} />
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : hint ? <Text style={s.muted}>{hint}</Text> : null}
    </View>
  );
}

export function NumField({ value, onChange, ...p }: { label: string; value?: number; onChange: (n: number | undefined) => void; hint?: string; error?: string }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  return (
    <Field
      {...p}
      keyboardType="decimal-pad"
      value={text}
      onChangeText={(t) => {
        setText(t);
        const n = Number(t.replace(',', '.'));
        onChange(t.trim() === '' || !Number.isFinite(n) ? undefined : n);
      }}
    />
  );
}

export interface Option<T extends string = string> { value: T; label: string; sub?: string }
export function Select<T extends string>({ label, value, options, onChange, placeholder = 'Select…' }: { label: string; value?: T; options: Option<T>[]; onChange: (v: T) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find((o) => o.value === value);
  const filtered = q ? options.filter((o) => (o.label + (o.sub ?? '')).toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable style={s.input} onPress={() => setOpen(true)} accessibilityRole="button">
        <Text style={{ color: current ? colors.text : colors.muted, fontSize: 16 }}>{current?.label ?? placeholder}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[s.screen, { padding: space(2), gap: space(1) }]}>
          <Text style={s.cardTitle}>{label}</Text>
          {options.length > 8 && <TextInput placeholder="Search" value={q} onChangeText={setQ} style={s.input} />}
          <FlatList
            data={filtered}
            keyExtractor={(o) => o.value}
            renderItem={({ item }) => (
              <Pressable
                style={[s.option, item.value === value && { backgroundColor: `${colors.primary}14` }]}
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
              >
                <Text style={{ fontSize: 16, color: colors.text }}>{item.label}</Text>
                {item.sub ? <Text style={s.muted}>{item.sub}</Text> : null}
              </Pressable>
            )}
          />
          <Button title="Close" kind="secondary" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={[s.row, { minHeight: touch }]} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <Text style={{ fontSize: 16, color: colors.text, flex: 1 }}>{label}</Text>
      <View style={[s.check, value && { backgroundColor: colors.primary, borderColor: colors.primary }]}>{value ? <Text style={{ color: '#fff', fontWeight: '700' }}>✓</Text> : null}</View>
    </Pressable>
  );
}

export const H = ({ children }: { children: React.ReactNode }) => <Text style={s.h}>{children}</Text>;
export const P = ({ children, muted }: { children: React.ReactNode; muted?: boolean }) => <Text style={muted ? s.muted : s.p}>{children}</Text>;
export const Row = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => <View style={[s.row, style]}>{children}</View>;
export const Empty = ({ text }: { text: string }) => <Text style={[s.muted, { textAlign: 'center', padding: space(3) }]}>{text}</Text>;

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.card, borderRadius: radius, padding: space(2), gap: space(1), borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(1) },
  btn: { minHeight: touch, borderRadius: radius, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space(2) },
  btnText: { fontSize: 16, fontWeight: '700' },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '600', color: colors.muted },
  input: { minHeight: touch, borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: space(1.5), backgroundColor: '#fff', fontSize: 16, color: colors.text, justifyContent: 'center' },
  option: { minHeight: touch, paddingVertical: space(1), paddingHorizontal: space(1), borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, justifyContent: 'center' },
  check: { width: 28, height: 28, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  h: { fontSize: 20, fontWeight: '800', color: colors.text },
  p: { fontSize: 15, color: colors.text, lineHeight: 21 },
  muted: { fontSize: 13, color: colors.muted, lineHeight: 18 },
});
