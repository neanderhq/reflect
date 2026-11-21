// Called after normal Publish migrations. Fictional data only; an existing workspace is untouched.
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../server/schema';
import { persistState, type Database } from '../server/db';
import { emptyState } from '../server/model';
import { passwordHash } from '../server/session';
import { syntheticState } from '../server/synthetic';

export const DEMO_COMPANY = 'reflect-demo';
export async function seedTemplate(databaseUrl = process.env.DATABASE_URL, password = process.env.DEMO_PASSWORD) {
  if (!databaseUrl || !password) throw new Error('DATABASE_URL and DEMO_PASSWORD are required');
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  try {
    const db = drizzle(pool, { schema });
    return await db.transaction(async tx => {
      const inserted = await tx.insert(schema.companies).values({ id: DEMO_COMPANY, name: 'Reflect Demo' })
        .onConflictDoNothing().returning();
      if (!inserted.length) return { created: false };
      const state = syntheticState(await passwordHash(password));
      for (const person of state.people) person.email = `${person.id}@reflect.test`;
      // Do not seed queued email or inherit the delivered application's provider accounts.
      state.notices = [];
      await persistState(tx as unknown as Database, DEMO_COMPANY, emptyState(), state);
      return { created: true };
    });
  } finally { await pool.end(); }
}
if (process.argv[1]?.endsWith('seed-template.ts')) {
  seedTemplate().then(result => console.log(result.created ? 'Reflect sample workspace created' : 'Reflect sample workspace preserved'))
    .catch(error => { console.error(error instanceof Error ? error.message : 'SEED_FAILED'); process.exitCode = 1; });
}
