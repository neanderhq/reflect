import { resolve, sep } from 'node:path';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../server/schema';
import { persistState, type Database } from '../server/db';
import { acquirePgliteLock, releasePgliteLock } from '../server/pglite-lock';
import { emptyState } from '../server/model';
import { passwordHash } from '../server/session';
import { syntheticState, syntheticPassword, syntheticCompany, isolationCompany } from '../server/synthetic';
async function main(){
 if(process.env.DATABASE_URL||process.env.NODE_ENV==='production'||process.env.APP_ENV!=='synthetic'||!process.env.PGLITE_DIR)throw new Error('SYNTHETIC_ENV_REQUIRED');
 const folder=resolve(process.env.PGLITE_DIR);if(folder!==resolve('.pglite')&&!folder.startsWith(resolve('.test-data')+sep))throw new Error('SYNTHETIC_PATH_FORBIDDEN');
 let local='';try{local=await readFile('.env.local','utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(/^\s*DATABASE_URL\s*=\s*[^\s#]+/m.test(local))throw new Error('Remove DATABASE_URL from .env.local before synthetic seeding');
 await mkdir(folder,{recursive:true});acquirePgliteLock(folder);const client=new PGlite(folder),db=drizzle(client,{schema});
 try{
 await migrate(db,{migrationsFolder:resolve('drizzle')});const hash=await passwordHash(syntheticPassword);
 for(const company of [syntheticCompany,isolationCompany]){
 if((await db.select().from(schema.companies).where(eq(schema.companies.id,company))).length){console.log(`${company}: preserved existing data`);continue;}
 await db.transaction(async tx=>{await tx.insert(schema.companies).values({id:company,name:company===syntheticCompany?'Lattice synthetic company':'Isolation synthetic company'});
 const s=company===syntheticCompany?syntheticState(hash):emptyState();
 if(company===isolationCompany)s.people.push({id:'isolation-hr',email:'hr@isolation.test',name:'Isolation HR',team:'People',title:'HR',role:'hr_admin',managerId:null,active:true,passwordHash:hash,authVersion:0,revision:0});
 await persistState(tx as unknown as Database,company,emptyState(),s);});console.log(`${company}: synthetic fixtures created`);
 }
 // Generate local server secrets without printing them; preserve every existing setting.
 let additions='';for(const key of ['AUTH_TOKEN_KEY','HR_SETUP_KEY','SCHEDULER_SECRET'])if(!new RegExp(`^\\s*${key}\\s*=`,'m').test(local)&&!process.env[key])additions+=`${key}=${randomBytes(32).toString('hex')}\n`;
 if(additions)await appendFile('.env.local','\n# Synthetic local server secrets\n'+additions,{mode:0o600});
 console.log('Synthetic seed ready. Existing data preserved. Login instructions: docs/handover.md. No email sent.');
 }finally{await client.close();releasePgliteLock(folder);}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'SEED_FAILED');process.exitCode=1;});
