export async function register() {
 if(process.env.NEXT_RUNTIME!=='nodejs'||process.env.NEXT_PHASE==='phase-production-build')return;
 if(!process.env.DATABASE_URL&&!(process.env.APP_ENV==='synthetic'&&process.env.PGLITE_DIR&&process.env.NODE_ENV!=='production'))return;
 try{
  const {waitForDbReady}=await import('./server/db');
  await waitForDbReady();
  const {startScheduler}=await import('./server/scheduler');
  const state=globalThis as typeof globalThis & {latticeScheduler?:ReturnType<typeof startScheduler>};
  state.latticeScheduler ||= startScheduler();
 }catch{
  console.error('lattice_scheduler_start skipped: runtime configuration or database unavailable');
 }
}
