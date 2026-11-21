import assert from 'node:assert/strict';
import { stat, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../server/schema';
import { setTestDb, type Database } from '../server/db';
import { acquirePgliteLock, releasePgliteLock, snapshotPglite } from '../server/pglite-lock';
import { login, logout } from '../server/auth';
import { actorFromToken } from '../server/session';
import { operation } from '../server/service';
import { syntheticPassword, syntheticCompany, isolationCompany } from '../server/synthetic';
async function main(){
 assert.equal(process.env.APP_ENV,'synthetic');assert.ok(!process.env.DATABASE_URL);const folder=resolve(process.env.PGLITE_DIR||'');assert.ok(folder===resolve('.pglite')||folder.startsWith(resolve('.test-data')+sep));assert.notEqual(process.env.NODE_ENV,'production');
 // Verify a private copy so the check never opens the live folder; refuses with PGLITE_LOCKED while it is in use.
 await stat(folder);const copy=snapshotPglite(folder,'seed-check');acquirePgliteLock(copy);const client=new PGlite(copy);setTestDb(drizzle(client,{schema}) as unknown as Database);
 try{
 for(const [company,email,role] of [[syntheticCompany,'hr@lattice.test','hr_admin'],[syntheticCompany,'manager@lattice.test','manager'],[syntheticCompany,'alex@lattice.test','employee'],[syntheticCompany,'blair@lattice.test','employee'],[isolationCompany,'hr@isolation.test','hr_admin']]){
 const token=await login({company,email,role,password:syntheticPassword}),actor=await actorFromToken(token);const data=await operation(actor,'workspace',{}) as {me:{email:string};assignments:unknown[];packets:unknown[]};assert.equal(data.me.email,email);if(company===isolationCompany){assert.equal(data.assignments.length,0);assert.equal(data.packets.length,0);}await logout(actor);
 }console.log('PASS: persisted synthetic HR, manager, employee, peer and isolation-company logins work; sessions logged out.');
 }finally{await client.close();releasePgliteLock(copy);await rm(copy,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'SEED_CHECK_FAILED');process.exitCode=1;});
