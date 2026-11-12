import { appSchema, tableSchema } from '@nozbe/watermelondb';
import { SYNC_SCHEMA_VERSION } from '@orchard/domain';
import { buildTableSpecs } from './schemaDef';

export const schema = appSchema({
  version: SYNC_SCHEMA_VERSION,
  tables: buildTableSpecs().map((t) => tableSchema(t)),
});
