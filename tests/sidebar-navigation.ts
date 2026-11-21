import assert from 'node:assert/strict';
import { launch } from './browser-cdp';
import { syntheticCompany, syntheticPassword } from '../server/synthetic';

const origin=process.env.PREVIEW_URL||'http://127.0.0.1:3001';
async function main(){
 assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Only the local synthetic preview is authorized');
const browser=await launch();
try {
 await browser.goto(`${origin}/login`);
 const login=await browser.evaluate<number>(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Lattice-Request':'1'},body:JSON.stringify(${JSON.stringify({company:syntheticCompany,email:'hr@lattice.test',role:'hr_admin',password:syntheticPassword})})}).then(r=>r.status)`);
 assert.equal(login,200);
 await browser.goto(origin);
 await browser.waitFor("document.querySelector('nav[aria-label=\"Main navigation\"]')");
 for(const width of [1280,390]){
  await browser.viewport(width,900,width===390);
  for(const [label,title] of [['Cycles','Review cycles'],['People','People']] as const){
   await browser.evaluate(`Array.from(document.querySelectorAll('nav button')).find(button=>button.textContent.trim().startsWith(${JSON.stringify(label)})).click()`);
   await browser.waitFor(`document.querySelector('h1')?.textContent===${JSON.stringify(title)} && new URLSearchParams(location.search).get('view')===${JSON.stringify(label.toLowerCase())}`,5000);
  }
  for(let attempt=0;attempt<2;attempt++){
   await browser.evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Import people')).click()");
   await browser.waitFor("document.querySelector('[role=dialog]')?.textContent.includes('Import people')",5000);
   await browser.evaluate("document.querySelector('[role=dialog] [data-slot=dialog-close]').click()");
   await browser.waitFor("!document.querySelector('[role=dialog]')",5000);
  }
 }
 await browser.evaluate('history.back()');
 await browser.waitFor("document.querySelector('h1')?.textContent==='Review cycles' && new URLSearchParams(location.search).get('view')==='cycles'",5000);
 await browser.goto(`${origin}/?view=people`);
 await browser.waitFor("document.querySelector('h1')?.textContent==='People'",5000);
 console.log('PASS: sidebar navigation, history, direct URL and repeated import dialog at desktop and mobile widths');
} finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
