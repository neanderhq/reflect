import { runOutbox, configuredMail, type MailProvider } from './notifications';
// Timer is a best-effort trigger while this web process has CPU. Database claims protect multiple instances.
export function startScheduler(options:{intervalMs?:number;provider?:MailProvider;log?:(event:string)=>void}={}) {
 let busy=false,stopped=false;
 const log=options.log||((event:string)=>console.info(event));
 const tick=async()=>{
   if(busy||stopped)return;
   busy=true;
   try{const result=await runOutbox(options.provider||configuredMail());log(`lattice_scheduler_tick processed=${result.processed}`);}
   catch{log('lattice_scheduler_tick failed');}
   finally{busy=false;}
 };
 const timer=setInterval(()=>void tick(),options.intervalMs||60000);timer.unref();void tick();
 return {tick,stop:()=>{stopped=true;clearInterval(timer);}};
}
