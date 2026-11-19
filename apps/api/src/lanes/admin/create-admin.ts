/**
 * Create (or reset) a platform admin. Prompt-free, for bootstrap and automation:
 *   node dist/lanes/admin/create-admin.js <email> <name> <password> [--reset]
 * Connects with MIGRATION_DATABASE_URL (owner/superuser): the application role deliberately has
 * no way to create admins. --reset updates the name/password of an existing admin and reactivates it.
 */
import pg from 'pg';
import { z } from 'zod';
import { hashPassword } from '../../auth.js';
import { config } from '../../config.js';

export const adminInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12, 'password must be at least 12 characters').max(200),
});

export async function createAdmin(url: string, input: z.input<typeof adminInput>, opts: { reset?: boolean } = {}): Promise<{ id: string; email: string; created: boolean }> {
  const a = adminInput.parse(input);
  const hash = await hashPassword(a.password);
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    const existing = (await c.query('SELECT id FROM public.platform_admins WHERE email = $1 FOR UPDATE', [a.email])).rows[0];
    let id: string;
    if (existing) {
      if (!opts.reset) throw new Error(`admin ${a.email} already exists (use --reset to change the password)`);
      id = existing.id;
      await c.query('UPDATE public.platform_admins SET name = $2, password_hash = $3, active = true WHERE id = $1', [id, a.name, hash]);
    } else {
      id = (await c.query('INSERT INTO public.platform_admins (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id', [a.email, a.name, hash])).rows[0].id;
    }
    await c.query('SELECT app.admin_record_audit(NULL, $1, $2, $3::jsonb)', [existing ? 'admin.reset_cli' : 'admin.create_cli', a.email, JSON.stringify({ adminId: id })]);
    await c.query('COMMIT');
    return { id, email: a.email, created: !existing };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const [email, name, password] = args.filter((x) => x !== '--reset');
  if (!email || !name || !password) {
    console.error('usage: node dist/lanes/admin/create-admin.js <email> <name> <password> [--reset]');
    process.exit(2);
  }
  createAdmin(config.migrationUrl, { email, name, password }, { reset }).then(
    (r) => console.log(`${r.created ? 'created' : 'reset'} platform admin ${r.email} (${r.id})`),
    (e: Error) => {
      console.error(e instanceof z.ZodError ? e.issues.map((i) => i.message).join('; ') : e.message);
      process.exit(1);
    },
  );
}
