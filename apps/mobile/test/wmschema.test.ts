import { describe, expect, it } from 'vitest';
// Schema module is plain JS (no native deps) — validates our specs with Watermelon's own checks.
import { appSchema, tableSchema } from '@nozbe/watermelondb/Schema';
import { SYNC_SCHEMA_VERSION } from '@orchard/domain';
import { buildTableSpecs } from '../src/db/schemaDef';

describe('WatermelonDB accepts the generated schema', () => {
  it('builds appSchema', () => {
    const s = appSchema({ version: SYNC_SCHEMA_VERSION, tables: buildTableSpecs().map((t) => tableSchema(t)) });
    expect(Object.keys(s.tables)).toContain('spray_events');
    expect(s.tables.spray_events!.columns.products!.type).toBe('string');
  });
});
