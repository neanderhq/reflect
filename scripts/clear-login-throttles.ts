import { resolve, sep } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { acquirePgliteLock, releasePgliteLock } from '../server/pglite-lock';

async function main() {
  if (process.env.DATABASE_URL || process.env.NODE_ENV==='production' || process.env.APP_ENV!=='synthetic' || !process.env.PGLITE_DIR) {
    throw new Error('Use APP_ENV=synthetic and PGLITE_DIR with DATABASE_URL unset outside production');
  }
  const directory=resolve(process.env.PGLITE_DIR);
  if (directory!==resolve('.pglite')&&!directory.startsWith(resolve('.test-data')+sep)) {
    throw new Error('Login throttle clearing requires a gitignored .pglite or .test-data folder inside this worktree');
  }
  acquirePgliteLock(directory);
  const client=new PGlite(directory);
  try {
    const removed=await client.query<{ count: string }>('DELETE FROM auth_throttles RETURNING 1');
    console.log(`Removed ${removed.rows.length} synthetic login throttle rows.`);
  } finally { await client.close(); releasePgliteLock(directory); }
}
main().catch(error=>{console.error(error.message==='PGLITE_LOCKED'?'Stop the preview first; .pglite has one owner':error.message);process.exitCode=1;});
