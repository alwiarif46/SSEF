import React, { useState } from 'react';
import { Badge, Button, Card, Empty, Field, H, NumField, P, Screen, Select } from '../ui/kit';
import { createRow, Q, updateRow, useTable } from '../db/repo';
import { useReference } from '../state/reference';
import { useAuth } from '../state/auth';
import { expiryStatus } from '../lib/context';
import { fmtDate, isIsoDate, today } from '../lib/dates';
import type { InventoryRow } from '../lib/types';
import type { ScreenProps } from './nav';

export function InventoryScreen({ navigation }: ScreenProps<'Inventory'>) {
  const { rows } = useTable<InventoryRow>('chemical_inventory', [Q.sortBy('expiry_date', Q.asc)]);
  const { bundle } = useReference();
  const { can } = useAuth();
  return (
    <Screen>
      <H>Inventory</H>
      <P muted>Buy only from licensed dealers; keep invoice, batch and CIBRC registration number for traceability.</P>
      {can('manager') && <Button title="Add stock" onPress={() => navigation.navigate('InventoryForm', {})} />}
      {rows.length === 0 && <Empty text="No stock recorded." />}
      {rows.map((r) => {
        const chem = bundle.chemicals.find((c) => c.id === r.chemical_id);
        const ex = expiryStatus(r.expiry_date, today());
        return (
          <Card key={r.id} title={chem?.product ?? r.chemical_id} onPress={() => navigation.navigate('InventoryForm', { id: r.id })} right={<Badge text={`${+r.quantity.toFixed(2)} ${r.unit}`} tone={r.quantity > 0 ? 'info' : 'muted'} />}>
            <P muted>
              Batch {r.batch_no ?? '—'} · expires {fmtDate(r.expiry_date)} · {r.dealer ?? 'dealer?'} · inv {r.invoice_no ?? '—'}
            </P>
            {ex === 'expired' && <Badge text="Expired — do not use; return to dealer" tone="danger" />}
            {ex === 'soon' && <Badge text="Expires within 60 days" tone="warn" />}
            {chem?.status === 'banned' && <Badge text={`Banned: ${chem.statusReference ?? ''}`} tone="danger" />}
            {chem?.status === 'watch' && <Badge text="Regulatory watch list" tone="warn" />}
            {!r.registration_no && <Badge text="CIBRC registration no. missing" tone="warn" />}
          </Card>
        );
      })}
    </Screen>
  );
}

export function InventoryFormScreen({ route, navigation }: ScreenProps<'InventoryForm'>) {
  const id = route.params?.id;
  const { bundle } = useReference();
  const { rows, models } = useTable<InventoryRow>('chemical_inventory', [Q.where('id', id ?? '__new__')], [id]);
  const existing = rows[0];
  const [f, setF] = useState<Partial<InventoryRow>>({});
  const v: Partial<InventoryRow> = { ...existing, ...f };
  v.unit ??= 'g';
  if (!existing) v.purchased_on ??= today();
  const set = (k: keyof InventoryRow) => (x: unknown) => setF((p) => ({ ...p, [k]: x }));
  const ok = !!v.chemical_id && v.quantity != null && !!v.unit && (!v.expiry_date || isIsoDate(v.expiry_date));
  return (
    <Screen>
      <H>{existing ? 'Edit stock' : 'Add stock'}</H>
      <Select label="Product" value={v.chemical_id} options={bundle.chemicals.filter((c) => c.status !== 'banned').map((c) => ({ value: c.id, label: c.product, sub: c.activeIngredients.join(' + ') }))} onChange={set('chemical_id')} />
      <NumField label="Quantity" value={v.quantity} onChange={set('quantity')} />
      <Select label="Unit" value={v.unit} options={['g', 'kg', 'ml', 'l'].map((u) => ({ value: u, label: u }))} onChange={set('unit')} />
      <Field label="Batch no." value={v.batch_no ?? ''} onChangeText={set('batch_no')} />
      <Field label="Expiry (YYYY-MM-DD)" value={v.expiry_date ?? ''} onChangeText={set('expiry_date')} />
      <Field label="Dealer" value={v.dealer ?? ''} onChangeText={set('dealer')} />
      <Field label="Dealer licence no." value={v.dealer_licence_no ?? ''} onChangeText={set('dealer_licence_no')} />
      <Field label="Invoice no." value={v.invoice_no ?? ''} onChangeText={set('invoice_no')} />
      <Field label="CIBRC registration no. (from label)" value={v.registration_no ?? ''} onChangeText={set('registration_no')} />
      <Field label="Purchased on (YYYY-MM-DD)" value={v.purchased_on ?? ''} onChangeText={set('purchased_on')} />
      <NumField label="Cost (₹)" value={v.cost_inr} onChange={set('cost_inr')} />
      <Button
        title="Save"
        disabled={!ok}
        onPress={async () => {
          if (existing && models[0]) await updateRow(models[0], f);
          else await createRow('chemical_inventory', v);
          navigation.goBack();
        }}
      />
    </Screen>
  );
}
