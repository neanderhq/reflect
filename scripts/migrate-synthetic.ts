import { resolve, sep } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { acquirePgliteLock, releasePgliteLock } from '../server/pglite-lock';

async function main() {
  if (process.env.DATABASE_URL || process.env.NODE_ENV==='production' || process.env.APP_ENV!=='synthetic' || !process.env.PGLITE_DIR) {
    throw new Error('Use APP_ENV=synthetic and PGLITE_DIR with DATABASE_URL unset outside production');
  }
  const directory=resolve(process.env.PGLITE_DIR);
  if (directory!==resolve('.pglite')&&!directory.startsWith(resolve('.test-data')+sep)) {
    throw new Error('Synthetic migrations require a gitignored .pglite or .test-data folder inside this worktree');
  }
  acquirePgliteLock(directory);
  const client=new PGlite(directory);
  try {
    await migrate(drizzle(client),{migrationsFolder:resolve('drizzle')});
    console.log('Synthetic PGlite migrations applied. No company records were seeded.');
  } finally { await client.close(); releasePgliteLock(directory); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
