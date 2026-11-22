import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Minimal Chrome DevTools Protocol driver for local preview checks. Uses an isolated temporary profile.
const chromePath=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export interface Page { evaluate:<T=unknown>(expression:string)=>Promise<T>; goto:(url:string)=>Promise<void>; setCookie:(cookie:string,url:string)=>Promise<void>; viewport:(width:number,height:number,mobile?:boolean)=>Promise<void>; screenshot:(file:string)=>Promise<void>; type:(text:string)=>Promise<void>; waitFor:(expression:string,timeoutMs?:number)=>Promise<number>; close:()=>Promise<void> }
export async function launch():Promise<Page> {
 const profile=await mkdtemp(join(tmpdir(),'lattice-cdp-'));
 const chrome:ChildProcess=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','about:blank'],{stdio:'ignore'});
 let port='';for(let i=0;i<100&&!port;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!/^\d{1,5}$/.test(port)||Number(port)<1||Number(port)>65535)throw new Error('CHROME_NOT_STARTED');
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as {type:string;webSocketDebuggerUrl:string}[];
 const socket=new WebSocket(targets.find(t=>t.type==='page')!.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
 let seq=0;const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();const listeners:((m:any)=>void)[]=[];
 socket.addEventListener('message',event=>{const m=JSON.parse(String(event.data));if(m.id&&pending.has(m.id)){const p=pending.get(m.id)!;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else listeners.forEach(l=>l(m));});
 const send=(method:string,params:Record<string,unknown>={})=>new Promise<any>((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 await send('Network.enable');await send('Page.enable');await send('Runtime.enable');
 const evaluate=async<T,>(expression:string)=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value as T;};
 const waitFor=async(expression:string,timeoutMs=30000)=>{const start=Date.now();while(Date.now()-start<timeoutMs){if(await evaluate<boolean>(`Boolean(${expression})`).catch(()=>false))return Date.now()-start;await new Promise(r=>setTimeout(r,50));}throw new Error(`TIMEOUT waiting for ${expression}`);};
 return {evaluate,waitFor,
  goto:async url=>{const loaded=new Promise<void>(resolve=>{const l=(m:any)=>{if(m.method==='Page.loadEventFired'){listeners.splice(listeners.indexOf(l),1);resolve();}};listeners.push(l);});await send('Page.navigate',{url});await loaded;},
 setCookie:async(cookie,url)=>{const separator=cookie.indexOf('=');if(separator<1)throw new Error('INVALID_COOKIE');const name=cookie.slice(0,separator),value=cookie.slice(separator+1);const result=await send('Network.setCookie',{name,value,url});if(!result.success)throw new Error('COOKIE_NOT_SET');},
  viewport:async(width,height,mobile=false)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:mobile?2:1,mobile});},
  screenshot:async file=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(file,Buffer.from(r.data,'base64'));},
  type:async text=>{for(const ch of text)await send('Input.insertText',{text:ch});},
  close:async()=>{socket.close();chrome.kill();await new Promise(r=>setTimeout(r,300));await rm(profile,{recursive:true,force:true});},
 };
}
