import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { NextRequest } from 'next/server';
import * as schema from '../server/schema';
import { setTestDb, loadState, type Database } from '../server/db';
import { setup } from '../server/auth';
import { operation } from '../server/service';
import { actorFromToken } from '../server/session';
import { restoreExport, type CompanyExport } from '../server/backup';
import { GET as getBackup } from '../app/api/backup/route';

test('HR company export restores into an empty database without secrets', async()=>{
 process.env.APP_ENV='synthetic';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.AUTH_TOKEN_KEY='synthetic-token-key-for-tests-32-chars';process.env.HR_SETUP_KEY='synthetic-setup-key-for-tests-32-chars';process.env.SCHEDULER_SECRET='synthetic-scheduler-for-tests-32-chars';delete process.env.DATABASE_URL;
 const folder=await mkdtemp(join(tmpdir(),'lattice-backup-'));
 const source=new PGlite(join(folder,'source'));const db=drizzle(source,{schema});await migrate(db,{migrationsFolder:'drizzle'});setTestDb(db as unknown as Database);
 try{
  const cookie=await setup({setupKey:process.env.HR_SETUP_KEY,company:'backup-co',companyName:'Backup Co',email:'hr@backup.test',name:'HR Owner',password:'Synthetic-test-password!'});
  const actor=await actorFromToken(cookie);
  await operation(actor,'template',{name:'Self 2026',type:'self',role:'all',questions:[{kind:'written',text:'Results?',required:true}]});
  const res=await getBackup(new NextRequest('http://127.0.0.1:3000/api/backup',{headers:{origin:'http://127.0.0.1:3000',cookie:`lattice_session=${cookie}`}}));
  assert.equal(res.status,200);
  const text=await res.text();assert.ok(!text.includes('passwordHash'),'password hashes must not be exported');
  const dump=JSON.parse(text) as CompanyExport;
  assert.equal(dump.company.name,'Backup Co');assert.equal(dump.counts.people,1);assert.equal(dump.counts.templates,1);
  const before=await loadState(db as unknown as Database,'backup-co');
  assert.ok(before.audits.some(a=>a.action==='backup.exported'),'export is audited');
  const unauth=await getBackup(new NextRequest('http://127.0.0.1:3000/api/backup',{headers:{origin:'http://127.0.0.1:3000'}}));assert.equal(unauth.status,401);
  const target=new PGlite(join(folder,'target'));const tdb=drizzle(target,{schema});await migrate(tdb,{migrationsFolder:'drizzle'});
  const counts=await restoreExport(tdb as unknown as Database,dump);
  assert.deepEqual(counts,dump.counts);
  const restored=await loadState(tdb as unknown as Database,'backup-co');
  assert.equal(restored.people[0].email,'hr@backup.test');assert.equal(restored.people[0].passwordHash,'');
  assert.deepEqual(restored.templates,before.templates);assert.equal(restored.audits.length,dump.counts.audits);
  await assert.rejects(()=>restoreExport(tdb as unknown as Database,dump),/COMPANY_EXISTS/);
  await target.close();
 } finally { await source.close(); await rm(folder,{recursive:true,force:true}); }
});
