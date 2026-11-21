import { cpSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
// A disk PGlite directory must have exactly one process owner; a second opener can abort or corrupt it.
// The lock is `<dir>.lock` beside the folder, holds the owner pid and is stale once that pid is gone.
const held=new Set<string>();
function alive(pid:number){try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code==='EPERM';}}
function owner(file:string){try{return Number(readFileSync(file,'utf8').trim())||0;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
export function pgliteLockPath(dir:string){return resolve(dir)+'.lock';}
export function acquirePgliteLock(dir:string){
 const file=pgliteLockPath(dir);if(held.has(file))return;
 for(let attempt=0;attempt<2;attempt++){
  try{writeFileSync(file,String(process.pid),{flag:'wx',mode:0o600});held.add(file);return;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  const pid=owner(file);
  if(pid===process.pid){held.add(file);return;}
  if(pid&&alive(pid))break;
  try{unlinkSync(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 throw new Error('PGLITE_LOCKED');
}
export function releasePgliteLock(dir:string){
 const file=pgliteLockPath(dir);if(!held.delete(file))return;
 if(owner(file)===process.pid)try{unlinkSync(file);}catch{}
}
process.on('exit',()=>{for(const file of held)if(owner(file)===process.pid)try{unlinkSync(file);}catch{}});
// Checks and backups work on a private copy so they never open the live folder; refuses while it is in use.
export function snapshotPglite(source:string,label:string){
 const target=resolve('.test-data',`${label}-${new Date().toISOString().replace(/[-:.TZ]/g,'')}-${process.pid}`);
 acquirePgliteLock(source);
 try{mkdirSync(resolve('.test-data'),{recursive:true});cpSync(resolve(source),target,{recursive:true,errorOnExist:true,force:false});}
 finally{releasePgliteLock(source);}
 return target;
}
