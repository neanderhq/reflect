import { resolve, sep } from 'node:path';
import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { acquirePgliteLock, releasePgliteLock, snapshotPglite } from '../server/pglite-lock';
// Backups dump a private copy, never the live folder; copying refuses with PGLITE_LOCKED while the preview owns it.
async function main(){
 if(process.env.DATABASE_URL||process.env.NODE_ENV==='production'||process.env.APP_ENV!=='synthetic'||!process.env.PGLITE_DIR)throw new Error('SYNTHETIC_ENV_REQUIRED');
 const source=resolve(process.env.PGLITE_DIR);if(source!==resolve('.pglite')&&!source.startsWith(resolve('.test-data')+sep))throw new Error('SYNTHETIC_PATH_FORBIDDEN');
 const [action,fileArg]=process.argv.slice(2),file=resolve(fileArg||'.test-data/synthetic-backup.tar.gz');
 if(!file.startsWith(resolve('.test-data')+sep))throw new Error('Backup must be inside ignored .test-data');
 if(action==='backup'){
 await stat(source);
 await mkdir(resolve('.test-data'),{recursive:true});const copy=snapshotPglite(source,'backup-copy');acquirePgliteLock(copy);const db=new PGlite(copy);
 try{await db.waitReady;const backup=await db.dumpDataDir('gzip');await writeFile(file,Buffer.from(await backup.arrayBuffer()),{flag:'wx',mode:0o600});console.log('Synthetic database backup saved. Existing backups are never overwritten.');}finally{await db.close();releasePgliteLock(copy);await rm(copy,{recursive:true,force:true});}
 }else if(action==='restore'){
 try{await stat(source);throw new Error('RESTORE_TARGET_EXISTS');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 acquirePgliteLock(source);const backup=new Blob([await readFile(file)]);const db=new PGlite({dataDir:source,loadDataDir:backup});try{await db.waitReady;console.log('Synthetic backup restored into a new isolated directory.');}finally{await db.close();releasePgliteLock(source);}
 }else throw new Error('Use backup or restore with a .test-data archive path');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'BACKUP_FAILED');process.exitCode=1;});
