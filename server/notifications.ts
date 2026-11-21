import { randomUUID, createHash } from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import { getDb, transaction, waitForDbReady } from './db';
import { companies,tokens } from './schema';
import { enqueue,stale } from './service';
import { unseal } from './session';
import { mailConfigured, notConfigured } from './mail-config';
import { appOrigin } from './runtime-config';
import { renderEmail, PRODUCT_NAME } from './email-template';
export interface Mail { to:string; subject:string; text:string; html?:string; idempotencyKey:string }
export interface MailProvider { enabled:boolean; send:(mail:Mail)=>Promise<void> }
export class DeliveryError extends Error { constructor(public retryable:boolean){super(retryable?'DELIVERY_REJECTED':'DELIVERY_UNCERTAIN');} }
export const disabledMail:MailProvider={enabled:false,send:async()=>{throw new Error(notConfigured);}};
// Injectable transport is used by tests. The production endpoint cannot be redirected by settings.
export function configuredMail(transport:typeof fetch=fetch):MailProvider {
 if(!mailConfigured())return disabledMail;
 const key=process.env.EMAIL_API_KEY!,from=process.env.EMAIL_FROM!;
 if(process.env.EMAIL_PROVIDER==='resend')return{enabled:true,send:async mail=>{
   // Resend: verified-domain sender, 24 h idempotency on the stable outbox key (prevents duplicate sends on retry).
   let response:Response;
   try {response=await transport('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json','Accept':'application/json','Idempotency-Key':createHash('sha256').update(mail.idempotencyKey).digest('hex')},body:JSON.stringify({from:`${PRODUCT_NAME} <${from}>`,to:[mail.to],subject:mail.subject,text:mail.text,...(mail.html?{html:mail.html}:{})}),signal:AbortSignal.timeout(10000),redirect:'error'});}
   catch {throw new DeliveryError(false);}
   // Rejections and temporary errors are retried with the same Idempotency-Key, which Resend keeps for 24 h, so a retry cannot send twice.
   if(!response.ok)throw new DeliveryError([400,401,403,409,422,429,500,503].includes(response.status));
   let result:{id?:string};try{result=await response.json();}catch{throw new DeliveryError(false);}
   if(!result.id)throw new DeliveryError(false);
 }};
 return{enabled:true,send:async mail=>{
   let response:Response;
   try {response=await transport('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':key,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({sender:{name:PRODUCT_NAME,email:from},to:[{email:mail.to}],subject:mail.subject,textContent:mail.text,...(mail.html?{htmlContent:mail.html}:{}),headers:{idempotencyKey:createHash('sha256').update(mail.idempotencyKey).digest('hex').slice(0,32)}}),signal:AbortSignal.timeout(10000),redirect:'error'});}
   catch {throw new DeliveryError(false);}
   if(!response.ok)throw new DeliveryError(response.status===429 || response.status===400 || response.status===401 || response.status===403);
   let result:{messageId?:string};try{result=await response.json();}catch{throw new DeliveryError(false);}
   if(!result.messageId)throw new DeliveryError(false);
 }};
}
export async function runOutbox(provider:MailProvider=disabledMail) {
 await waitForDbReady();
 const tenants=await getDb().select().from(companies);let processed=0;
 for(const tenant of tenants){
 await transaction(tenant.id,s=>{for(const a of s.assignments){const c=s.cycles.find(c=>c.id===a.cycleId);if(c?.status==='open'&&Date.now()>=Date.parse(c.start)&&a.status==='draft'&&Date.parse(c.reviewDue)-Date.now()<7*86400000&&Date.parse(c.reviewDue)>=Date.now())enqueue(s,a.authorId,'reminder',`reminder:${a.id}:${c.reviewDue}`,`/?view=reviews&review=${a.id}`,{cycleId:c.id,assignmentId:a.id,due:c.reviewDue});}stale(s);
 // Ambiguous delivery after a crash must be reconciled with the provider, never blindly retried.
 for(const n of s.notices)if(n.status==='claimed'&&Date.parse(n.claimedAt||'0')<Date.now()-120000){n.status='failed';n.diagnostic='DELIVERY_UNCERTAIN';delete n.claim;}
 if(!provider.enabled)for(const n of s.notices)if(n.status==='pending'||n.status==='disabled'){n.status='disabled';n.diagnostic=notConfigured;}
 });
 if(!provider.enabled)continue;
 for(let i=0;i<30&&processed<100;i++) {
 const claim=await transaction(tenant.id,s=>{stale(s);const n=s.notices.find(n=>(n.status==='pending'||n.status==='disabled'||(n.status==='failed'&&n.diagnostic==='DELIVERY_REJECTED'&&n.attempts<5))&&Date.parse(n.nextAttempt)<=Date.now());if(!n)return null;n.status='claimed';n.claim=randomUUID();n.claimedAt=new Date(Date.now()).toISOString();return{id:n.id,claim:n.claim};});
 if(!claim)break;
 // Company row lock serializes the final validity check and dispatch against submissions/closure.
 await transaction(tenant.id,async(s,db)=>{stale(s);const n=s.notices.find(n=>n.id===claim.id&&n.claim===claim.claim&&n.status==='claimed');if(!n)return;const p=s.people.find(p=>p.id===n.recipientId&&p.active);if(!p){n.status='stale';return;}let href=n.href;
 if(n.kind==='invite'||n.kind==='reset'){const [token]=await db.select().from(tokens).where(and(eq(tokens.hash,n.key),eq(tokens.companyId,tenant.id),eq(tokens.personId,p.id),eq(tokens.kind,n.kind),gt(tokens.expires,new Date())));if(!token){n.status='stale';delete n.claim;return;}href=`/login?token=${unseal(token.sealed)}&kind=${n.kind}`;}
 n.attempts++;
 try {const m=renderEmail({kind:n.kind,url:`${appOrigin()}${href}`,company:tenant.name});await provider.send({to:p.email,subject:m.subject,text:m.text,html:m.html,idempotencyKey:`${tenant.id}:${n.key}`});n.status='sent';n.diagnostic='accepted by provider';}
 catch(error){n.status='failed';n.diagnostic=error instanceof DeliveryError&&error.retryable?'DELIVERY_REJECTED':'DELIVERY_UNCERTAIN';n.nextAttempt=new Date(Date.now()+Math.min(3600000,30000*2**n.attempts)).toISOString();}delete n.claim;processed++;});
 }
 }return{processed};
}
