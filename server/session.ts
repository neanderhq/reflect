import { createHash, randomBytes, scrypt as rawScrypt, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { Database, getDb, waitForDbReady } from './db';
import { sessions, throttles, tokens } from './schema';
import { Actor, State, requireThat } from './model';
const scrypt=(password:string,salt:string,length:number)=>new Promise<Buffer>((resolve,reject)=>rawScrypt(password,salt,length,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));
export const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
export const secret=()=>randomBytes(32).toString('base64url');
export async function passwordHash(password:unknown) {requireThat(typeof password==='string'&&password.length>=12&&password.length<=256,'PASSWORD_LENGTH_12_256');const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64) as Buffer;return `${salt}:${key.toString('hex')}`;}
export async function verifyPassword(password:unknown,hash:string) {if(typeof password!=='string'||password.length>256)return false;const [salt,key]=hash.split(':');const value=await scrypt(password,salt||'00000000000000000000000000000000',64) as Buffer;return !!key&&key.length===128&&timingSafeEqual(value,Buffer.from(key,'hex'));}
export async function throttle(key:string,limit=10,windowMs=900000) {
 await waitForDbReady();
 const db=getDb(), hashed=digest(key), expires=new Date(Date.now()+windowMs);
 const [row]=await db.insert(throttles).values({key:hashed,count:1,expires}).onConflictDoUpdate({target:throttles.key,set:{count:sql`case when ${throttles.expires} < now() then 1 else ${throttles.count}+1 end`,expires:sql`case when ${throttles.expires} < now() then ${expires.toISOString()}::timestamptz else ${throttles.expires} end`}}).returning();
 requireThat(row.count<=limit,'RATE_LIMITED',429);
}
export async function newSession(db:Database,actor:Actor,version:number) {const value=secret();await db.insert(sessions).values({hash:digest(value),companyId:actor.companyId,personId:actor.personId,version,expires:new Date(Date.now()+8*3600000)});return value;}
export async function actorFromToken(value:string|undefined):Promise<Actor> {requireThat(value&&value.length<200,'UNAUTHENTICATED',401);await waitForDbReady();const [session]=await getDb().select().from(sessions).where(and(eq(sessions.hash,digest(value)),gt(sessions.expires,new Date())));requireThat(session,'UNAUTHENTICATED',401);return {companyId:session.companyId,personId:session.personId,sessionHash:session.hash,version:session.version};}
export async function checkSessionInTransaction(actor:Actor,db:Database,s:State) {
 requireThat(actor.sessionHash,'UNAUTHENTICATED',401);const [session]=await db.select().from(sessions).where(and(eq(sessions.hash,actor.sessionHash),gt(sessions.expires,new Date())));const person=s.people.find(p=>p.id===actor.personId&&p.active);
 requireThat(session&&session.companyId===actor.companyId&&session.personId===actor.personId&&person&&person.authVersion===session.version,'SESSION_REVOKED',401);
}
function encryptionKey(){const key=process.env.AUTH_TOKEN_KEY;requireThat(key&&key.length>=24,'TOKEN_KEY_NOT_CONFIGURED',503);return createHash('sha256').update(key).digest();}
export function seal(raw:string) {const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const encrypted=Buffer.concat([cipher.update(raw,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');}
export function unseal(raw:string){const data=Buffer.from(raw,'base64url'),decipher=createDecipheriv('aes-256-gcm',encryptionKey(),data.subarray(0,12));decipher.setAuthTag(data.subarray(12,28));return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');}
export async function issueToken(db:Database,companyId:string,personId:string,kind:'invite'|'reset') {
 await db.delete(tokens).where(and(eq(tokens.companyId,companyId),eq(tokens.personId,personId),eq(tokens.kind,kind)));
 const value=secret(),hash=digest(value);await db.insert(tokens).values({hash,companyId,personId,kind,sealed:seal(value),expires:new Date(Date.now()+3600000)});return {value,hash};
}
