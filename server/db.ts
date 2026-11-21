import { resolve, sep } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { drizzle as embeddedDrizzle } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { eq, and, sql } from 'drizzle-orm';
import * as schema from './schema';
import { acquirePgliteLock } from './pglite-lock';
import { Actor, AppError, State, collections, emptyState, requireThat } from './model';
import { runtimeReadiness } from './runtime-config';
export type Database = ReturnType<typeof drizzle<typeof schema>>;
const runtimeState=globalThis as typeof globalThis & {latticeDatabase?:Database;latticeDatabaseReady?:Promise<void>};
export function getDb(): Database {
  if (runtimeState.latticeDatabase) return runtimeState.latticeDatabase;
  if(process.env.NODE_ENV==='production'){
    requireThat(process.env.DATABASE_URL,'DATABASE_NOT_CONFIGURED',503);
    if(!Object.values(runtimeReadiness()).every(Boolean))throw new AppError('RUNTIME_SECRETS_NOT_CONFIGURED',503,'HR_SETUP_KEY must be at least 32 characters; generated keys must be at least 24 characters.');
  }
  if(process.env.PGLITE_DIR&&!process.env.DATABASE_URL){const folder=resolve(process.env.PGLITE_DIR);requireThat(folder===resolve('.pglite')||folder.startsWith(resolve('.test-data')+sep),'SYNTHETIC_PATH_FORBIDDEN',503);}
  if (process.env.DATABASE_URL) runtimeState.latticeDatabase = drizzle(new Pool({connectionString:process.env.DATABASE_URL, max:10, connectionTimeoutMillis:10000}), {schema});
  else if (process.env.PGLITE_DIR && process.env.APP_ENV === 'synthetic' && process.env.NODE_ENV !== 'production') {
    try{acquirePgliteLock(process.env.PGLITE_DIR);}catch(error){if(error instanceof Error&&error.message==='PGLITE_LOCKED')throw new AppError('PGLITE_LOCKED',503);throw error;}
    const client=new PGlite(process.env.PGLITE_DIR);
    runtimeState.latticeDatabaseReady=client.waitReady;
    runtimeState.latticeDatabase = embeddedDrizzle(client, {schema}) as unknown as Database;
  }
  else throw new AppError('DATABASE_NOT_CONFIGURED',503);
  return runtimeState.latticeDatabase;
}
export async function waitForDbReady() { getDb(); await runtimeState.latticeDatabaseReady; }
export function setTestDb(db: Database) { runtimeState.latticeDatabase = db; runtimeState.latticeDatabaseReady=Promise.resolve(); }
export async function loadState(db: Database, companyId: string): Promise<State> {
  const state = emptyState();
  for (const key of collections) {
    const table = schema.tables[key];
    const rows = await db.select().from(table).where(eq(table.companyId,companyId));
    (state[key] as unknown[]) = rows.map(row=>row.data);
  }
  return state;
}
export async function persistState(db: Database, companyId: string, before: State, after: State) {
  for (const key of collections) {
    const table = schema.tables[key];
    const original = new Map(before[key].map(row=>[row.id,JSON.stringify(row)]));
    for (const row of after[key]) {
      if (original.get(row.id) === JSON.stringify(row)) continue;
      if ((key === 'packets' || key === 'audits' || key === 'acknowledgments') && original.has(row.id)) throw new AppError('IMMUTABLE_RECORD',409);
      await db.insert(table).values({companyId,id:row.id,data:row} as never).onConflictDoUpdate({target:[table.companyId,table.id],set:{data:row}});
    }
    const remaining = new Set(after[key].map(row=>row.id));
    for (const row of before[key]) if (!remaining.has(row.id)) throw new AppError('HISTORY_DELETION_FORBIDDEN',409);
  }
}
export async function transaction<T>(companyId: string, fn:(state:State, db:Database)=>Promise<T> | T):Promise<T> {
  await waitForDbReady();
  return getDb().transaction(async raw=>{
    const db = raw as unknown as Database;
    await db.execute(sql`SET LOCAL lock_timeout = '15000ms'`);
    await db.execute(sql`SET LOCAL statement_timeout = '20000ms'`);
    const company = await db.select().from(schema.companies).where(eq(schema.companies.id,companyId)).for('update');
    requireThat(company.length,'NOT_FOUND',404);
    const state = await loadState(db,companyId); const before = structuredClone(state);
    const result = await fn(state,db);
    await persistState(db,companyId,before,state);
    return result;
  });
}
export async function readActor(actor: Actor) { return transaction(actor.companyId, s=>{ const person=s.people.find(p=>p.id===actor.personId && p.active); requireThat(person,'SESSION_REVOKED',401); return {state:s,person}; }); }
export async function uniqueEmail(db: Database, companyId:string, address:string) {
  const rows = await db.select().from(schema.people).where(and(eq(schema.people.companyId, companyId),sql`${schema.people.data}->>'email' = ${address}`)); return rows[0];
}
