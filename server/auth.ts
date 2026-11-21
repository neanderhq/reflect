import { timingSafeEqual, randomUUID } from 'node:crypto';
import { and, eq, sql, gt } from 'drizzle-orm';
import { getDb, transaction, loadState, persistState, uniqueEmail, waitForDbReady, Database } from './db';
import { Actor, AppError, email, id, text, requireThat, emptyState } from './model';
import { companies, people, sessions, tokens } from './schema';
import { audit, enqueue, stale } from './service';
import { member, hr } from './policy';
import { digest, verifyPassword, passwordHash, newSession, throttle, issueToken, checkSessionInTransaction } from './session';
export async function login(input:Record<string,unknown>) {
 const address=email(input.email),companyId=id(input.company),role=typeof input.role==='string'&&input.role?input.role:'';await throttle('login:'+companyId+':'+address);await throttle('global-login',300);
 return transaction(companyId,async(s,db)=>{const p=s.people.find(p=>p.email===address);const valid=await verifyPassword(input.password,p?.passwordHash||'');requireThat(valid&&p?.active&&(!role||p.role===role),'INVALID_CREDENTIALS',401);return newSession(db,{companyId,personId:p.id},p.authVersion);}).catch(e=>{if(e instanceof AppError&&e.code==='NOT_FOUND')throw new AppError('INVALID_CREDENTIALS',401);throw e;});
}
export async function setup(input:Record<string,unknown>) {
 await throttle('setup',5);const configured=process.env.HR_SETUP_KEY;const supplied=String(input.setupKey||'');requireThat(configured&&timingSafeEqual(Buffer.from(digest(configured)),Buffer.from(digest(supplied))),'SETUP_NOT_AUTHORIZED',403);
 const companyId=id(input.company),name=text(input.companyName,120),address=email(input.email),fullName=text(input.name,120);requireThat(name&&fullName);const hash=await passwordHash(input.password);
 await waitForDbReady();return getDb().transaction(async raw=>{const db=raw as unknown as Database;await db.execute(sql`select pg_advisory_xact_lock(417362)`);const existing=await db.select().from(companies).where(eq(companies.id,companyId));requireThat(!existing.length,'WORKSPACE_EXISTS',409);
 await db.insert(companies).values({id:companyId,name});const s=emptyState();const p={id:randomUUID(),name:fullName,email:address,team:'People',title:'HR Administrator',managerId:null,role:'hr_admin' as const,active:true,passwordHash:hash,authVersion:0};s.people.push(p);audit(s,p,'workspace.created',companyId);await persistState(db,companyId,emptyState(),s);return newSession(db,{companyId,personId:p.id},0);});
}
export async function invite(actor:Actor,input:Record<string,unknown>) {
 await throttle('invite:'+actor.companyId+':'+actor.personId,30);
 return transaction(actor.companyId,async(s,db)=>{await checkSessionInTransaction(actor,db,s);const p=member(s,actor.personId);hr(p);const person=s.people.find(x=>x.id===input.personId&&x.active);requireThat(person,'NOT_FOUND',404);const issued=await issueToken(db,actor.companyId,person.id,'invite');enqueue(s,person.id,'invite',issued.hash,'/login');audit(s,p,'invite.created',person.id);return {ok:true,...(process.env.APP_ENV==='synthetic'&&process.env.NODE_ENV!=='production'&&!process.env.DATABASE_URL&&person.email.endsWith('.test')?{syntheticLink:`/login?token=${issued.value}&kind=invite`}:{})};});
}
export async function recover(input:Record<string,unknown>) {
 const address=email(input.email),companyId=id(input.company);await throttle('recover:'+companyId+':'+address,4);await throttle('global-recover',100);
 try{return await transaction(companyId,async(s,db)=>{const p=s.people.find(x=>x.email===address&&x.active);if(!p)return{ok:true};const issued=await issueToken(db,companyId,p.id,'reset');enqueue(s,p.id,'reset',issued.hash,'/login');return{ok:true,...(process.env.APP_ENV==='synthetic'&&process.env.NODE_ENV!=='production'&&!process.env.DATABASE_URL&&address.endsWith('.test')?{syntheticLink:`/login?token=${issued.value}&kind=reset`}:{})};});}catch(e){if(e instanceof AppError&&e.code==='NOT_FOUND')return{ok:true};throw e;}
}
export async function redeem(input:Record<string,unknown>) {
 const value=text(input.token,100),kind=text(input.kind,20);requireThat(kind==='invite'||kind==='reset');await throttle('redeem:'+digest(value),5);const hash=await passwordHash(input.password);
 await waitForDbReady();const [token]=await getDb().select().from(tokens).where(and(eq(tokens.hash,digest(value)),eq(tokens.kind,kind),gt(tokens.expires,new Date())));requireThat(token,'TOKEN_INVALID_OR_EXPIRED',400);
 return transaction(token.companyId,async(s,db)=>{const consumed=await db.delete(tokens).where(and(eq(tokens.hash,token.hash),gt(tokens.expires,new Date()))).returning();requireThat(consumed.length,'TOKEN_INVALID_OR_EXPIRED',400);const p=member(s,token.personId);p.passwordHash=hash;p.authVersion++;await db.delete(sessions).where(and(eq(sessions.companyId,token.companyId),eq(sessions.personId,p.id)));audit(s,p,'password.changed',p.id);for(const n of s.notices.filter(n=>n.recipientId===p.id&&(n.kind==='invite'||n.kind==='reset')))n.status='stale';return newSession(db,{companyId:token.companyId,personId:p.id},p.authVersion);});
}
export async function logout(actor:Actor) {await waitForDbReady();await getDb().delete(sessions).where(eq(sessions.hash,actor.sessionHash!));}
