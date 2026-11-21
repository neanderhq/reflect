import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { getDb } from '../server/db';
import { acquirePgliteLock, pgliteLockPath } from '../server/pglite-lock';
import { register } from '../instrumentation';
import { GET as health } from '../app/api/health/route';
import { appOrigin, runtimeReadiness } from '../server/runtime-config';
import { csrf, sessionResponse } from '../server/http';
import { seal, unseal } from '../server/session';
import { NextRequest } from 'next/server';
async function main(){
 const saved={...process.env};
 try{
  process.env.APP_ORIGIN='example.com/';process.env.AUTH_TOKEN_KEY='a'.repeat(24);process.env.HR_SETUP_KEY='h'.repeat(32);process.env.SCHEDULER_SECRET='s'.repeat(24);
  assert.equal(appOrigin(),'https://example.com');assert.deepEqual(runtimeReadiness(),{APP_ORIGIN:true,AUTH_TOKEN_KEY:true,HR_SETUP_KEY:true,SCHEDULER_SECRET:true});
  csrf(new NextRequest('https://example.com/api/auth/login',{headers:{origin:'https://example.com','x-lattice-request':'1'}}));
  assert.match(sessionResponse('test').headers.get('set-cookie')||'',/Secure/i);assert.equal(unseal(seal('test')),'test');
  for(const [key,length] of [['AUTH_TOKEN_KEY',23],['HR_SETUP_KEY',31],['SCHEDULER_SECRET',23]] as const){const old=process.env[key];process.env[key]='x'.repeat(length);assert.equal(runtimeReadiness()[key],false);process.env[key]=old;}
  for(const origin of ['http://example.com','https://example.com/path','https://user@example.com','']){process.env.APP_ORIGIN=origin;assert.equal(runtimeReadiness().APP_ORIGIN,false);}
  process.env.APP_ORIGIN='example.com/';process.env.AUTH_TOKEN_KEY='secret-too-short';const result=health();assert.equal(result.status,200);const payload=await result.json();assert.deepEqual(payload,{status:'ok',runtime:{APP_ORIGIN:true,AUTH_TOKEN_KEY:false,HR_SETUP_KEY:true,SCHEDULER_SECRET:true}});assert.ok(!JSON.stringify(payload).includes('secret-too-short'));
 }finally{process.env=saved;}
 const clean={...process.env,DATABASE_URL:'',APP_ENV:'synthetic',PGLITE_DIR:'.pglite',AUTH_TOKEN_KEY:'',HR_SETUP_KEY:'',SCHEDULER_SECRET:'',APP_ORIGIN:''};
 const configured={...clean,NODE_ENV:'production' as const,DATABASE_URL:'postgresql://unused.invalid/test',APP_ORIGIN:'example.com/',AUTH_TOKEN_KEY:'a'.repeat(24),HR_SETUP_KEY:'h'.repeat(32),SCHEDULER_SECRET:'s'.repeat(24)};
 const valid=spawnSync(process.execPath,['--import','tsx',process.argv[1],'valid'],{env:configured,encoding:'utf8'});assert.equal(valid.status,0,valid.stderr);
 for(const [key,length] of [['AUTH_TOKEN_KEY',23],['HR_SETUP_KEY',31],['SCHEDULER_SECRET',23]] as const){const result=spawnSync(process.execPath,['--import','tsx',process.argv[1],'child','RUNTIME_SECRETS_NOT_CONFIGURED'],{env:{...configured,[key]:'x'.repeat(length)},encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
 for(const [env,expected] of [
  [{...clean,NODE_ENV:'production'},'DATABASE_NOT_CONFIGURED'],
  [{...clean,NODE_ENV:'production',DATABASE_URL:'postgresql://unused.invalid/test'},'RUNTIME_SECRETS_NOT_CONFIGURED'],
  [{...clean,NODE_ENV:'development',PGLITE_DIR:'/tmp/forbidden-synthetic-location'},'SYNTHETIC_PATH_FORBIDDEN'],
  [{...clean,NODE_ENV:'development',APP_ENV:'',PGLITE_DIR:''},'DATABASE_NOT_CONFIGURED'],
 ] as const){const result=spawnSync(process.execPath,['--import','tsx',process.argv[1],'child',expected],{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
 const startup=spawnSync(process.execPath,['--import','tsx',process.argv[1],'startup'],{env:{...clean,NODE_ENV:'production',NEXT_RUNTIME:'nodejs',NEXT_PHASE:'',DATABASE_URL:'postgresql://unused.invalid/test'},encoding:'utf8'});
 assert.equal(startup.status,0,startup.stderr);assert.match(startup.stderr,/lattice_scheduler_start skipped/);
 // One process owns a PGlite folder: while a holder runs, a second opener fails fast instead of corrupting data.
 const dir=`.test-data/lock-guard-${process.pid}`,lock=pgliteLockPath(dir);rmSync(lock,{force:true});
 const holder=spawn(process.execPath,['--import','tsx',process.argv[1],'hold',dir],{stdio:['pipe','pipe','inherit']});
 const [ready]=await once(holder.stdout!,'data');assert.equal(String(ready).trim(),'held');
 try{
  const second=spawnSync(process.execPath,['--import','tsx',process.argv[1],'child','PGLITE_LOCKED'],{env:{...clean,NODE_ENV:'development',PGLITE_DIR:dir},encoding:'utf8'});assert.equal(second.status,0,second.stderr);
 }finally{holder.stdin!.end();}
 await once(holder,'exit');assert.ok(!existsSync(lock),'lock released when the owner exits');
 // A lock left by a process that no longer exists is stale and is reclaimed.
 const dead=spawnSync(process.execPath,['-e','process.exit(0)']).pid!;writeFileSync(lock,String(dead));
 acquirePgliteLock(dir);rmSync(lock,{force:true});
 console.log('PASS: isolated runtime processes reject production PGlite, missing production secrets, outside-worktree synthetic storage and unconfigured persistence; a second PGlite opener gets PGLITE_LOCKED and stale locks are reclaimed. No database connections attempted.');
}
if(process.argv[2]==='child'){
 try{getDb();process.exitCode=2;}catch(error){assert.equal(error instanceof Error?error.message:'',process.argv[3]);if(process.argv[3]==='RUNTIME_SECRETS_NOT_CONFIGURED')assert.match(String((error as {details?:unknown}).details),/HR_SETUP_KEY must be at least 32 characters/);}
}else if(process.argv[2]==='valid'){
 assert.ok(getDb());
}else if(process.argv[2]==='startup'){
 register().then(async()=>{assert.equal((globalThis as {latticeScheduler?:unknown}).latticeScheduler,undefined);assert.equal(health().status,200);assert.throws(()=>getDb(),/RUNTIME_SECRETS_NOT_CONFIGURED/);}).catch(error=>{console.error(error);process.exitCode=1;});
}else if(process.argv[2]==='hold'){
 acquirePgliteLock(process.argv[3]);process.stdout.write('held\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));
}else main().catch(error=>{console.error(error);process.exitCode=1;});
