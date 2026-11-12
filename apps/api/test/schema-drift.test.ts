import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('schema drift', () => {
  it('committed 002_sync_tables.sql matches SYNC_TABLES', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const generated = execFileSync('node', ['scripts/gen-sync-ddl.mjs'], { cwd: root, encoding: 'utf8' });
    expect(readFileSync(`${root}/migrations/002_sync_tables.sql`, 'utf8')).toBe(generated);
  });
});
