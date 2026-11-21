// Restore a Lattice company export (HR → Reports → Backup) into an empty database or a new Neon branch.
// Usage: DATABASE_URL=postgres://... pnpm exec tsx scripts/restore-export.ts lattice-backup-<company>-<date>.json
// Run `node .neander/migrate.mjs` against the target first. Refuses if the company already exists.
// Passwords are not exported: after restore every user sets a new password with "Forgot password".
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../server/schema';
import { restoreExport, type CompanyExport } from '../server/backup';
import type { Database } from '../server/db';
async function main(){
 const file=process.argv[2];
 if(!file||!process.env.DATABASE_URL){console.error('Usage: DATABASE_URL=... tsx scripts/restore-export.ts <export.json>');process.exit(2);}
 const dump=JSON.parse(readFileSync(file,'utf8')) as CompanyExport;
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 try{
  const counts=await restoreExport(drizzle(pool,{schema}) as unknown as Database,dump);
  for(const [k,v] of Object.entries(counts))console.log(`${k}: ${v}${dump.counts[k]===v?'':` (export says ${dump.counts[k]})`}`);
  console.log(`Restored company ${dump.company.id}. Users must set a new password with "Forgot password".`);
 } finally { await pool.end(); }
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exit(1);});
