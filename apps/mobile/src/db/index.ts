import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from './schema';
import { modelClasses } from './models';

const adapter = new SQLiteAdapter({
  schema,
  dbName: 'seb_orchard',
  jsi: true,
  onSetUpError: (error) => {
    console.error('Database failed to load', error);
  },
});

export const database = new Database({ adapter, modelClasses });

/** Local key-value (not synced): tokens' companions, reference cache, sync state, settings. */
export const meta = {
  get: <T,>(key: string) => database.localStorage.get<T>(key) as Promise<T | undefined>,
  set: <T,>(key: string, value: T) => database.localStorage.set<T>(key, value),
  remove: (key: string) => database.localStorage.remove(key),
};
