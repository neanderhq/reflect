import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { parse } from 'csv-parse/sync';
import * as schema from '../server/schema';
import { setTestDb, loadState, transaction, type Database } from '../server/db';
import { type Actor, type Cycle, type Template, type Assignment, type Summary, type Packet, reviewTypes } from '../server/model';
import { operation } from '../server/service';
import { login, setup, invite, recover, redeem, logout } from '../server/auth';
import { actorFromToken, digest, newSession } from '../server/session';
import { configuredMail, disabledMail, runOutbox, DeliveryError, type Mail, type MailProvider } from '../server/notifications';
import { startScheduler } from '../server/scheduler';
import { GET as getWorkspace, POST as postWorkspace } from '../app/api/workspace/route';
import { GET as getExport } from '../app/api/export/route';
import { GET as getTemplate } from '../app/api/people/template/route';
import { POST as jobs } from '../app/api/jobs/route';
import { POST as authRoute } from '../app/api/auth/[action]/route';

export async function pdfText(bytes:Uint8Array) {
 const doc=await PDFDocument.load(bytes);let text='';
 for(const page of doc.getPages()){
 const contents=page.node.Contents();const streams=contents instanceof PDFArray?contents.asArray():[contents];
 for(const ref of streams){const stream=doc.context.lookup(ref);if(!(stream instanceof PDFRawStream))continue;const operators=Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
 for(const match of operators.matchAll(/<([\da-fA-F]+)>\s*Tj/g))text+=Buffer.from(match[1],'hex').toString('latin1')+'\n';
 }}return text;
}
async function main(){
 // This suite owns embedded fixtures; do not inherit the release verifier's PostgreSQL connection.
 delete process.env.DATABASE_URL;
 await mkdir('.test-data',{recursive:true});const folder=await mkdtemp(join(process.cwd(),'.test-data/workflows-'));
 let client=new PGlite(join(folder,'source'));let db=drizzle(client,{schema});setTestDb(db as unknown as Database);
 const fetchBefore=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('External network forbidden in workflow tests');};
 const dateNow=Date.now;let clock=dateNow();Date.now=()=>clock;
 process.env.APP_ENV='synthetic';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.AUTH_TOKEN_KEY='synthetic-token-key-for-tests-32-chars';process.env.HR_SETUP_KEY='synthetic-setup-key-for-tests-32-chars';process.env.SCHEDULER_SECRET='synthetic-scheduler-for-tests-32-chars';delete process.env.EMAIL_API_KEY;delete process.env.EMAIL_FROM;delete process.env.EMAIL_PROVIDER;
 const password='Synthetic-test-password!';const company='workflow-company',other='workflow-isolation';
 const at=(offset:number)=>new Date(clock+offset*86400000).toISOString();
 const command=<T=unknown>(actor:Actor,name:string,input:Record<string,unknown>={})=>operation(actor,name,input) as Promise<T>;
 const state=()=>loadState(db as unknown as Database,company);
 function req(path:string,cookie?:string,input?:unknown){return new NextRequest(`http://127.0.0.1:3000${path}`,{method:input?'POST':'GET',headers:{origin:process.env.APP_ORIGIN!,'x-lattice-request':'1',...(cookie?{cookie:`lattice_session=${cookie}`} : {}),...(input?{'Content-Type':'application/json'}:{})},...(input?{body:JSON.stringify(input)}:{})});}
 const fail=(fn:()=>Promise<unknown>,code:string)=>assert.rejects(fn,(e:unknown)=>e instanceof Error&&e.message===code);
 const snapshot=(cookie:string)=>getWorkspace(req('/api/workspace',cookie)).then(async r=>{assert.equal(r.status,200);return r.json();});
 try{
 await migrate(db,{migrationsFolder:'drizzle'});
 const hrCookie=await setup({setupKey:process.env.HR_SETUP_KEY,company,companyName:'Workflow company',email:'hr@workflow.test',name:'HR Owner',password});
 const hr=await actorFromToken(hrCookie);
 const otherCookie=await setup({setupKey:process.env.HR_SETUP_KEY,company:other,companyName:'Isolation company',email:'hr@isolation.test',name:'Isolation HR',password});const foreign=await actorFromToken(otherCookie);
 const csv='email,full_name,team,title,manager_email,role,active\nmanager@workflow.test,Morgan Manager,Product,Lead,,manager,true\nalex@workflow.test,Alex Author,Product,Specialist,manager@workflow.test,employee,true\nblair@workflow.test,Blair Peer,Product,Specialist,manager@workflow.test,employee,true\ncasey@workflow.test,Casey Peer,Product,Specialist,manager@workflow.test,employee,true\ndrew@workflow.test,Drew Peer,Product,Specialist,manager@workflow.test,employee,true';
 let preview=await command<any>(hr,'people.preview',{csv});assert.equal(preview.errors.length,0);
 await command(hr,'people.apply',{csv,directoryVersion:preview.directoryVersion});await fail(async()=>command(hr,'people.apply',{csv,directoryVersion:preview.directoryVersion}),'REVISION_CONFLICT');
 const duplicate=await command<any>(hr,'people.preview',{csv:csv+'\n'+csv.split('\n')[2]});assert.ok(duplicate.errors.some((x:any)=>x.message==='DUPLICATE_EMAIL'));
 await fail(async()=>command(hr,'people.apply',{csv:csv+'\n'+csv.split('\n')[2],directoryVersion:(await command<any>(hr,'people.preview',{csv})).directoryVersion}),'CSV_VALIDATION_FAILED');
 const revisedCsv=csv.replace('Drew Peer,Product,Specialist','Drew Peer,Product,Senior specialist');const updatePreview=await command<any>(hr,'people.preview',{csv:revisedCsv});await command(hr,'people.apply',{csv:revisedCsv,directoryVersion:updatePreview.directoryVersion});assert.equal((await state()).people.find(x=>x.email==='drew@workflow.test')!.title,'Senior specialist');
 const people=(await state()).people;const person=(email:string)=>people.find(p=>p.email===email+'@workflow.test')!;
 const actors:Record<string,Actor>={hr},cookies:Record<string,string>={hr:hrCookie};
 for(const who of ['manager','alex','blair','casey','drew']){
 const p=person(who),invitation=await invite(hr,{personId:p.id});assert.ok(invitation.syntheticLink);
 const token=new URL(invitation.syntheticLink!,'http://local').searchParams.get('token')!;
 const stored=(await db.select().from(schema.tokens).where(eq(schema.tokens.hash,digest(token))))[0];assert.ok(stored);assert.ok(!stored.sealed.includes(token));
 cookies[who]=await redeem({token,kind:'invite',password});actors[who]=await actorFromToken(cookies[who]);
 await fail(()=>redeem({token,kind:'invite',password}),'TOKEN_INVALID_OR_EXPIRED');
 }
 const alex=actors.alex,manager=actors.manager;
 await fail(()=>login({company,email:person('alex').email,role:'manager',password}),'INVALID_CREDENTIALS');
 const throttledLogin=async(email:string)=>authRoute(req('/api/auth/login',undefined,{company,email,password:'wrong-password'}),{params:Promise.resolve({action:'login'})});
 for(let attempt=0;attempt<9;attempt++){const failed=await throttledLogin(person('alex').email);assert.equal(failed.status,401);}
 const limited=await throttledLogin(person('alex').email);assert.equal(limited.status,429);assert.equal((await limited.json()).error,'RATE_LIMITED');
 const response=await authRoute(req('/api/auth/login',undefined,{company,email:person('alex').email,role:'employee',password}),{params:Promise.resolve({action:'login'})});assert.equal(response.status,429);assert.ok((await response.json()).error,'RATE_LIMITED');
 const derived=await authRoute(req('/api/auth/login',undefined,{company,email:person('alex').email,password}),{params:Promise.resolve({action:'login'})});assert.equal(derived.status,429);assert.ok((await derived.json()).error,'RATE_LIMITED');
 const otherLogin=await authRoute(req('/api/auth/login',undefined,{company,email:person('manager').email,password}),{params:Promise.resolve({action:'login'})});assert.equal(otherLogin.status,200);assert.ok(otherLogin.headers.get('set-cookie')?.includes('HttpOnly'));
 const csrfRejected=await postWorkspace(new NextRequest('http://127.0.0.1:3000/api/workspace',{method:'POST',body:JSON.stringify({command:'reminders'}),headers:{cookie:`lattice_session=${hrCookie}`}}));assert.equal(csrfRejected.status,403);
 const reset=await recover({company,email:person('alex').email});const resetToken=new URL(reset.syntheticLink!,'http://local').searchParams.get('token')!;
 cookies.alex=await redeem({token:resetToken,kind:'reset',password});actors.alex=await actorFromToken(cookies.alex);
 assert.equal((await getWorkspace(req('/api/workspace',cookies.manager))).status,200);assert.equal((await getWorkspace(req('/api/workspace',cookies.alex))).status,200);
 assert.deepEqual(await recover({company,email:'absent@workflow.test'}),{ok:true});
 const expiredSession=await newSession(db as unknown as Database,{companyId:company,personId:hr.personId},0);await db.update(schema.sessions).set({expires:new Date(0)}).where(eq(schema.sessions.hash,digest(expiredSession)));assert.equal((await getWorkspace(req('/api/workspace',expiredSession))).status,401);
 const expired=await invite(hr,{personId:person('drew').id});const expiredToken=new URL(expired.syntheticLink!,'http://local').searchParams.get('token')!;
 await db.update(schema.tokens).set({expires:new Date(0)}).where(eq(schema.tokens.hash,digest(expiredToken)));await fail(()=>redeem({token:expiredToken,kind:'invite',password}),'TOKEN_INVALID_OR_EXPIRED');
 const templateResponse=await getTemplate(req('/api/people/template',hrCookie));assert.equal(templateResponse.status,200);assert.equal((await templateResponse.text()).trim(),csv.split('\n')[0]);assert.equal((await getTemplate(req('/api/people/template',cookies.alex))).status,403);
 console.log('PASS 1: setup, server-derived role login, CSRF, encrypted one-use invite/reset, expiry, session revocation, import/duplicate/conflict and CSV template');

 const templates:Template[]=[];
 for(const type of reviewTypes)templates.push(await command<Template>(hr,'template',{name:`${type} template`,role:'all',type,questions:[{text:'Required example',kind:'written',required:true},{text:'Optional rating',kind:'rating',required:false}]}));
 const roleTemplate=await command<Template>(hr,'template',{name:'Employee self template',role:'employee',type:'self',questions:[{text:'Employee-specific example',kind:'written',required:true},{text:'Optional rating',kind:'rating',required:false}]});
 const cycle=await command<Cycle>(hr,'cycle',{name:'Acceptance cycle',start:at(-1),nominationDue:at(1),reviewDue:at(3),releaseDate:at(4),participantIds:people.map(x=>x.id),templateIds:[...templates.map(x=>x.id),roleTemplate.id]});
 await command(actors.alex,'nominate',{cycleId:cycle.id,authorId:person('blair').id});
 await fail(async()=>command(actors.alex,'nominate',{cycleId:cycle.id,authorId:person('blair').id}),'DUPLICATE_NOMINATION');
 const nomination=(await state()).nominations[0];await command(manager,'nomination.decide',{id:nomination.id,approve:true});
 const count=(await state()).assignments.length;await command(hr,'generate',{id:cycle.id});assert.equal((await state()).assignments.length,count);assert.equal(new Set((await state()).assignments.map(a=>a.type)).size,4);
 await command(hr,'template',{name:'New version',family:templates[0].family,role:'all',type:'self',questions:[{text:'Changed question',kind:'written',required:true}]});assert.equal((await state()).cycles[0].templates[0].questions[0].text,'Required example');
 const a=(await state()).assignments.find(a=>a.authorId===person('alex').id&&a.type==='self')!;
 assert.equal(a.questions[0].text,'Employee-specific example');
 const answers={ [a.questions[0].id]:'AUTHOR_ONLY_DRAFT', [a.questions[1].id]:3 };
 await command(actors.alex,'review.save',{id:a.id,revision:0,answers});await fail(async()=>command(actors.alex,'review.save',{id:a.id,revision:0,answers}),'REVISION_CONFLICT');
 // True concurrent attempts from the same revision: one wins, one returns conflict.
 const racing=await Promise.allSettled([command(actors.alex,'review.save',{id:a.id,revision:1,answers}),command(actors.alex,'review.save',{id:a.id,revision:1,answers})]);assert.equal(racing.filter(r=>r.status==='fulfilled').length,1);assert.equal(racing.filter(r=>r.status==='rejected'&&r.reason.message==='REVISION_CONFLICT').length,1);
 for(const cookie of [hrCookie,cookies.manager,cookies.blair,otherCookie])assert.ok(!JSON.stringify(await snapshot(cookie)).includes('AUTHOR_ONLY_DRAFT'));
 for(const cookie of [cookies.manager,hrCookie])for(const format of ['csv','pdf']){const r=await getExport(req(`/api/export?cycle=${cycle.id}&format=${format}`,cookie));assert.equal(r.status,200);const text=format==='pdf'?await pdfText(new Uint8Array(await r.arrayBuffer())):await r.text();assert.ok(!text.includes('AUTHOR_ONLY_DRAFT'));}
 await fail(async()=>command(actors.alex,'review.submit',{id:a.id,revision:2,answers:{}}),'REQUIRED_ANSWER');await fail(async()=>command(actors.alex,'review.submit',{id:a.id,revision:2,answers:{...answers,[a.questions[1].id]:6}}),'INVALID_RATING');
 await command(actors.alex,'review.submit',{id:a.id,revision:2,answers:{...answers,[a.questions[0].id]:'Submitted self example'}});
 await fail(async()=>command(actors.alex,'review.save',{id:a.id,revision:3,answers}),'REVIEW_LOCKED');
 await command(hr,'review.reopen',{id:a.id,revision:3,reason:'Correct an example'});assert.ok((await state()).audits.some(x=>x.action==='review.reopened'&&x.reason==='Correct an example'));
 await command(actors.alex,'review.submit',{id:a.id,revision:4,answers:{...answers,[a.questions[0].id]:'Submitted self example'}});
 const c0=(await state()).cycles[0];clock=Date.parse(c0.nominationDue)+1;await fail(async()=>command(manager,'nomination.decide',{id:nomination.id,approve:true}),'PHASE_DEADLINE_PASSED');clock=dateNow();
 await command(hr,'cycle.update',{id:cycle.id,revision:0,start:at(1),nominationDue:at(2),reviewDue:at(3),releaseDate:at(4)});await fail(async()=>command(actors.blair,'review.save',{id:(await state()).assignments.find(a=>a.authorId===person('blair').id)!.id,revision:0,answers:{}}),'PHASE_NOT_STARTED');
 await command(hr,'cycle.update',{id:cycle.id,revision:1,start:at(-1)});
 console.log('PASS 2–3: all four review types, approval, idempotent assignments, template snapshots, validation, draft privacy, submit lock, audited reopen and concurrent saves');

 for(const assignment of (await state()).assignments.filter(x=>x.status==='draft')){
 const who=Object.keys(actors).find(k=>actors[k].personId===assignment.authorId)!;
 const values:Record<string,string|number>={[assignment.questions[0].id]:`Submitted ${assignment.type} example`};
 // Known answers 1,3,5; Drew's optional rating is blank. Other roster members are separate teams.
 const score=assignment.subjectId===person('alex').id?1:assignment.subjectId===person('blair').id?3:assignment.subjectId===person('casey').id?5:assignment.subjectId===person('drew').id?null:4;
 if(score!==null)values[assignment.questions[1].id]=score;
 await command(actors[who],'review.submit',{id:assignment.id,revision:assignment.revision,answers:values});
 }
 // Normalize Alex self rating to 1 through the audited author workflow.
 let current=(await state()).assignments.find(x=>x.id===a.id)!;await command(hr,'review.reopen',{id:a.id,revision:current.revision,reason:'Known-answer math fixture'});current=(await state()).assignments.find(x=>x.id===a.id)!;await command(actors.alex,'review.submit',{id:a.id,revision:current.revision,answers:{[a.questions[0].id]:'Submitted self example',[a.questions[1].id]:1}});
 const report=await getExport(req(`/api/export?cycle=${cycle.id}&team=Product&type=self`,cookies.manager));const rows=await report.json();assert.equal(rows[0].average,3);assert.equal(rows[0].ratingCount,3);assert.equal(rows[0].submitted,4);
 const csvExport=parse(await (await getExport(req(`/api/export?cycle=${cycle.id}&team=Product&type=self&format=csv`,cookies.manager))).text(),{columns:true}) as Record<string,string>[];assert.equal(csvExport[0]['Average (1–5)'],'3');assert.equal(csvExport[0]['Rating count'],'3');for(const p of people)assert.ok(!JSON.stringify(csvExport).includes(p.name));
 const pdf=await pdfText(new Uint8Array(await (await getExport(req(`/api/export?cycle=${cycle.id}&team=Product&type=self&format=pdf`,cookies.manager))).arrayBuffer()));assert.match(pdf,/Average: 3 \/ 5 \| Rating count: 3/);for(const p of people)assert.ok(!pdf.includes(p.name));
 for(const format of ['csv','pdf']){const res=await getExport(req(`/api/export?format=${format}`,cookies.alex));assert.equal(res.status,403);}
 let live=(await state()).cycles[0];await command(hr,'cycle.update',{id:cycle.id,revision:live.revision,minGroup:4});const suppressed=await (await getExport(req(`/api/export?cycle=${cycle.id}&team=Product&type=self`,cookies.manager))).json();assert.equal(suppressed[0].average,null);
 for(const format of ['csv','pdf']){const res=await getExport(req(`/api/export?cycle=${cycle.id}&team=Product&type=self&format=${format}`,cookies.manager));const text=format==='pdf'?await pdfText(new Uint8Array(await res.arrayBuffer())):await res.text();assert.ok(text.includes('Suppressed'));assert.ok(!text.includes('Average: 3 / 5'));}
 live=(await state()).cycles[0];const policy=structuredClone(live.policy);policy.self.include=false;
 await command(hr,'cycle.update',{id:cycle.id,revision:live.revision,minGroup:3,policy});
 for(const cookie of [cookies.manager,hrCookie]){
 assert.deepEqual(await (await getExport(req(`/api/export?cycle=${cycle.id}&type=self`,cookie))).json(),[]);
 const text=await pdfText(new Uint8Array(await (await getExport(req(`/api/export?cycle=${cycle.id}&type=self&format=pdf`,cookie))).arrayBuffer()));assert.ok(!text.includes('Acceptance cycle /'));
 const records=parse(await (await getExport(req(`/api/export?cycle=${cycle.id}&type=self&format=csv`,cookie))).text(),{columns:true});assert.equal(records.length,0);
 }
 const managerData=await snapshot(cookies.manager);assert.ok(managerData.feedback.every((f:any)=>f.feedback.filter((x:any)=>x.type==='peer'||x.type==='upward').every((x:any)=>!('authorName' in x))));
 assert.ok((await snapshot(cookies.alex)).summaries.length===0);assert.ok((await snapshot(cookies.alex)).packets.length===0);assert.equal((await snapshot(otherCookie)).assignments.length,0);
 await fail(async()=>command(foreign,'review.save',{id:a.id,revision:0,answers:{}}),'NOT_FOUND');
 assert.deepEqual(await (await getExport(req(`/api/export?cycle=${cycle.id}`,otherCookie))).json(),[]);
 assert.deepEqual(await (await getExport(req(`/api/export?cycle=${cycle.id}&search=absent-query`,cookies.manager))).json(),[]);
 console.log('PASS 4/8: real JSON, parsed CSV and decoded PDF enforce inclusion, scope, draft/unreleased privacy, hidden names, blanks and configurable subgroup thresholds');

 let summary=await command<Summary>(manager,'summary',{cycleId:cycle.id,subjectId:person('alex').id,text:'PRIVATE_MANAGER_SUMMARY',rating:3,revision:0});
 await command(hr,'calibrate',{id:summary.id,revision:summary.revision,rating:4,reason:'Evidence across projects'});
 summary=(await state()).summaries[0];assert.equal(summary.originalRating,3);assert.equal(summary.rating,4);const calibration=(await state()).audits.find(x=>x.action==='summary.calibrated')!;assert.deepEqual(calibration.before,{rating:3,originalRating:3,reason:''});assert.deepEqual(calibration.after,{rating:4,originalRating:3,reason:'Evidence across projects'});
 assert.ok(!JSON.stringify(await snapshot(cookies.alex)).includes('PRIVATE_MANAGER_SUMMARY'));
 await fail(async()=>command(hr,'release',{cycleId:cycle.id,subjectId:person('alex').id,revision:summary.revision,expectedVersion:0}),'RELEASE_NOT_DUE');
 clock=Date.parse((await state()).cycles[0].releaseDate)+1;
 await fail(async()=>command(actors.blair,'review.save',{id:(await state()).assignments.find(a=>a.authorId===person('blair').id)!.id,revision:1,answers:{}}),'PHASE_DEADLINE_PASSED');
 const packet=await command<Packet>(hr,'release',{cycleId:cycle.id,subjectId:person('alex').id,revision:summary.revision,expectedVersion:0});assert.equal(packet.version,1);assert.ok(!packet.feedback.some(f=>f.type==='self'));assert.ok(packet.feedback.filter(f=>f.type==='peer').every(f=>!f.authorName));
 await command(actors.alex,'acknowledge',{id:packet.id});await command(actors.alex,'acknowledge',{id:packet.id});assert.equal((await state()).acknowledgments.length,1);
 await fail(async()=>command(hr,'release',{cycleId:cycle.id,subjectId:person('alex').id,revision:summary.revision,expectedVersion:0}),'PACKET_VERSION_CONFLICT');
 await command(hr,'release',{cycleId:cycle.id,subjectId:person('alex').id,revision:summary.revision,expectedVersion:1});assert.equal((await snapshot(cookies.alex)).packets.length,2);
 live=(await state()).cycles[0];const tighten=structuredClone(live.policy);tighten.manager.disclose=false;await command(hr,'cycle.update',{id:live.id,revision:live.revision,policy:tighten});assert.ok((await snapshot(cookies.alex)).packets.every((p:any)=>p.feedback.filter((f:any)=>f.type==='manager').every((f:any)=>!f.authorName)));assert.ok((await state()).packets[0].feedback.find(f=>f.type==='manager')?.authorName);
 await command(manager,'action',{subjectId:person('alex').id,ownerId:person('alex').id,title:'Develop facilitation',due:at(10),notes:'Practice next week',progress:'planned'});let action=(await state()).actions[0];
 await command(actors.alex,'action',{...action,progress:'in_progress'});await fail(async()=>command(actors.alex,'action',{...action,progress:'complete'}),'REVISION_CONFLICT');
 await fail(async()=>command(actors.alex,'action',{subjectId:person('alex').id,ownerId:person('blair').id,title:'Invalid',due:at(1),notes:'',progress:'planned'}),'INVALID_OWNER');
 const choices=(await snapshot(cookies.alex)).actionChoices[0];assert.deepEqual(new Set(choices.owners.map((x:any)=>x.id)),new Set([person('alex').id,person('manager').id]));assert.equal((await snapshot(cookies.blair)).actions.length,0);
 console.log('PASS 5–6: summary/calibration before-after audit, original rating, release dates/versions, acknowledgment, scoped actions and valid owner choices');

 live=(await state()).cycles[0];await command(hr,'cycle.status',{id:cycle.id,revision:live.revision,status:'closed',reason:'End acceptance cycle'});
 const mutations:[string,Record<string,unknown>,Actor][]=[['cycle.update',{id:cycle.id,revision:live.revision+1,reviewDue:at(10)},hr],['release',{cycleId:cycle.id,subjectId:person('alex').id},hr],['generate',{id:cycle.id},hr],['review.reopen',{id:a.id,revision:0,reason:'Blocked'},hr],['calibrate',{id:summary.id,rating:3,revision:summary.revision,reason:'Blocked'},hr],['summary',{cycleId:cycle.id,subjectId:person('alex').id},manager],['nominate',{cycleId:cycle.id,authorId:person('blair').id},actors.alex],['nomination.decide',{id:nomination.id,approve:true},manager],['review.save',{id:a.id,revision:0,answers:{}},actors.alex],['acknowledge',{id:packet.id},actors.alex]];
 for(const [name,input,actor] of mutations)await fail(async()=>command(actor,name,input),'CYCLE_LOCKED');
 await fail(async()=>command(hr,'cycle.status',{id:cycle.id,revision:live.revision+1,status:'archived'}),'REASON_REQUIRED');await command(hr,'cycle.status',{id:cycle.id,revision:live.revision+1,status:'archived',reason:'Test lifecycle transition'});await fail(async()=>command(hr,'cycle.status',{id:cycle.id,revision:live.revision+2,status:'open'}),'RESTORE_STATUS_REQUIRED');
 await command(hr,'cycle.status',{id:cycle.id,revision:live.revision+2,status:'closed',reason:'Test lifecycle transition'});await fail(async()=>command(hr,'cycle.status',{id:cycle.id,revision:live.revision+3,status:'open'}),'REASON_REQUIRED');await fail(async()=>command(hr,'cycle.status',{id:cycle.id,revision:live.revision+3,status:'open',reason:'  '}),'REASON_REQUIRED');await command(hr,'cycle.status',{id:cycle.id,revision:live.revision+3,status:'open',reason:'Follow-up correction'});assert.equal((await state()).packets.length,2);
 const drew=(await state()).people.find(p=>p.id===person('drew').id)!;
 const edits=await Promise.allSettled([command(hr,'person.update',{...drew,name:'Drew first',revision:drew.revision||0}),command(hr,'person.update',{...drew,name:'Drew second',revision:drew.revision||0})]);assert.equal(edits.filter(x=>x.status==='fulfilled').length,1);assert.ok(edits.some(x=>x.status==='rejected'&&x.reason.message==='REVISION_CONFLICT'));
 const alexCurrent=(await state()).people.find(p=>p.id===person('alex').id)!;await command(hr,'person.update',{...alexCurrent,managerId:null,revision:alexCurrent.revision||0});assert.ok(!(await snapshot(cookies.manager)).packets.some((x:any)=>x.subjectId===person('alex').id));assert.equal((await state()).cycles[0].roster.find(r=>r.id===person('alex').id)!.managerId,person('manager').id);
 const deactivated=(await state()).people.find(p=>p.id===person('blair').id)!;await command(hr,'person.update',{...deactivated,active:false,revision:deactivated.revision||0});assert.equal((await getWorkspace(req('/api/workspace',cookies.blair))).status,401);assert.ok((await state()).assignments.some(a=>a.authorId===deactivated.id));
 await fail(async()=>command(hr,'person.update',{...(await state()).people.find(x=>x.id===hr.personId),active:false,revision:0}),'PEOPLE_VALIDATION_FAILED');
 await logout(actors.casey);assert.equal((await getWorkspace(req('/api/workspace',cookies.casey))).status,401);
 console.log('PASS 9–10: complete closed-cycle mutation matrix, audited status transitions, archive/restore history, concurrent HR edits, manager transfers and deactivation preserve reviews');

 // Dedicated near-deadline cycle to exercise reminder dedupe and revalidation.
 clock=dateNow();const currentPeople=(await state()).people.filter(x=>x.active);const reminderCycle=await command<Cycle>(hr,'cycle',{name:'Reminder cycle',start:at(-1),nominationDue:at(1),reviewDue:at(2),releaseDate:at(3),participantIds:currentPeople.map(p=>p.id),templateIds:templates.map(t=>t.id)});
 await runOutbox(disabledMail);assert.ok((await state()).notices.some(n=>n.status==='disabled'&&n.diagnostic==='not delivered / provider not configured'));assert.ok(!(await state()).notices.some(n=>n.status==='sent'));
 assert.equal((await snapshot(hrCookie)).mailEnabled,false);assert.ok((await snapshot(hrCookie)).outbox.length>0);assert.equal((await snapshot(cookies.manager)).outbox.length,0);
 process.env.EMAIL_PROVIDER='brevo';process.env.EMAIL_API_KEY='synthetic-mock-key';process.env.EMAIL_FROM='verified@sender.test';
 let calls=0;const mock=async(url:Parameters<typeof fetch>[0],init?:RequestInit)=>{assert.equal(url,'https://api.brevo.com/v3/smtp/email');assert.equal((init!.headers as Record<string,string>)['api-key'],'synthetic-mock-key');const payload=JSON.parse(init!.body as string);assert.equal(payload.sender.email,'verified@sender.test');assert.ok(payload.to[0].email);assert.ok(payload.headers.idempotencyKey);assert.ok(payload.headers.idempotencyKey.length<=32,'Brevo rejects idempotency keys longer than 36 characters');assert.ok(!payload.textContent.includes('AUTHOR_ONLY_DRAFT'));calls++;return Response.json({messageId:'synthetic-message-id'},{status:201});};
 await configuredMail(mock as typeof fetch).send({to:'mock@receiver.test',subject:'Test',text:'Synthetic only',idempotencyKey:'stable-key'});assert.equal(calls,1);
 process.env.EMAIL_PROVIDER='resend';process.env.EMAIL_API_KEY='re_synthetic_mock';process.env.EMAIL_FROM='no-reply@apps.neander.ai';
 let rcalls=0;const rmock=async(url:Parameters<typeof fetch>[0],init?:RequestInit)=>{assert.equal(url,'https://api.resend.com/emails');const h=init!.headers as Record<string,string>;assert.equal(h['Authorization'],'Bearer re_synthetic_mock');assert.match(h['Idempotency-Key'],/^[0-9a-f]{64}$/);const payload=JSON.parse(init!.body as string);assert.equal(payload.from,'Reflect <no-reply@apps.neander.ai>');assert.deepEqual(payload.to,['mock@receiver.test']);assert.equal(payload.subject,'Test');assert.equal(payload.text,'Synthetic only');rcalls++;return Response.json({id:'synthetic-resend-id'},{status:200});};
 await configuredMail(rmock as typeof fetch).send({to:'mock@receiver.test',subject:'Test',text:'Synthetic only',idempotencyKey:'stable-key'});assert.equal(rcalls,1);
 await assert.rejects(()=>configuredMail((async()=>Response.json({name:'validation_error'},{status:422})) as typeof fetch).send({to:'mock@test.test',subject:'Test',text:'Test',idempotencyKey:'r-rejected'}),(e:unknown)=>e instanceof DeliveryError&&e.retryable);
 await assert.rejects(()=>configuredMail((async()=>Response.json({name:'application_error'},{status:500})) as typeof fetch).send({to:'mock@test.test',subject:'Test',text:'Test',idempotencyKey:'r-500'}),(e:unknown)=>e instanceof DeliveryError&&e.retryable);
 await assert.rejects(()=>configuredMail((async()=>{throw new Error('socket reset');}) as typeof fetch).send({to:'mock@test.test',subject:'Test',text:'Test',idempotencyKey:'r-net'}),(e:unknown)=>e instanceof DeliveryError&&!e.retryable);
 await assert.rejects(()=>configuredMail((async()=>Response.json({},{status:200})) as typeof fetch).send({to:'mock@test.test',subject:'Test',text:'Test',idempotencyKey:'r-noid'}),(e:unknown)=>e instanceof DeliveryError&&!e.retryable);
 process.env.EMAIL_PROVIDER='brevo';process.env.EMAIL_API_KEY='synthetic-mock-key';process.env.EMAIL_FROM='verified@sender.test';
 const sent:Mail[]=[];const good:MailProvider={enabled:true,send:async mail=>{sent.push(mail);}};
 await assert.rejects(()=>configuredMail((async()=>Response.json({error:'rate limit'},{status:429})) as typeof fetch).send({to:'mock@test.test',subject:'Test',text:'Test',idempotencyKey:'rejected'}),(e:unknown)=>e instanceof DeliveryError&&e.retryable);await assert.rejects(()=>configuredMail((async()=>{throw new Error('network unknown');}) as typeof fetch).send({to:'mock@test.test',subject:'Test',text:'Test',idempotencyKey:'uncertain'}),(e:unknown)=>e instanceof DeliveryError&&!e.retryable);
 const beforeDispatch=(await state()).assignments.find(a=>a.cycleId===reminderCycle.id&&a.authorId===hr.personId&&a.type==='self')!;await command(hr,'review.submit',{id:beforeDispatch.id,revision:0,answers:{[beforeDispatch.questions[0].id]:'Submitted before dispatch'}});assert.ok((await state()).notices.filter(n=>n.assignmentId===beforeDispatch.id).length>=2);assert.ok((await state()).notices.filter(n=>n.assignmentId===beforeDispatch.id).every(n=>n.status==='stale'));assert.ok(!(await snapshot(hrCookie)).notices.some((n:any)=>n.href.includes(beforeDispatch.id)));
 const rejection:MailProvider={enabled:true,send:async()=>{throw new DeliveryError(true);}};
 await runOutbox(rejection);const failed=(await state()).notices.find(n=>n.status==='failed'&&n.diagnostic==='DELIVERY_REJECTED')!;assert.ok(failed);await command(hr,'outbox.retry',{id:failed.id});
 await Promise.all([runOutbox(good),runOutbox(good)]);assert.equal(new Set(sent.map(m=>m.idempotencyKey)).size,sent.length);
 const sentCount=sent.length;await runOutbox(good);assert.equal(sent.length,sentCount);
 let rState=await state();assert.ok(!sent.some(n=>n.idempotencyKey.includes(beforeDispatch.id)));
 // Persist a claimed notice to simulate a process crash, and prove it is not automatically resent.
 await transaction(company,s=>{s.notices.push({id:'crashed-delivery',recipientId:hr.personId,kind:'release',key:'crashed-key',href:'/',status:'claimed',claim:'old',claimedAt:new Date(clock-180000).toISOString(),attempts:1,nextAttempt:at(-1),read:false});});
 await runOutbox(good);assert.equal((await state()).notices.find(n=>n.id==='crashed-delivery')!.diagnostic,'DELIVERY_UNCERTAIN');await fail(async()=>command(hr,'outbox.retry',{id:'crashed-delivery'}),'RETRY_NOT_SAFE');
 const logs:string[]=[];await transaction(company,s=>{s.notices.push({id:'timer-delivery',recipientId:hr.personId,kind:'release',key:'timer-key',href:'/',status:'pending',attempts:0,nextAttempt:at(-1),read:false});});
 const scheduler=startScheduler({intervalMs:30,provider:good,log:event=>logs.push(event)});
 await new Promise<void>((resolve,reject)=>{const started=dateNow();const timer=setInterval(()=>{if(logs.filter(x=>x.includes('processed=')).length>=2){clearInterval(timer);resolve();}else if(dateNow()-started>5000){clearInterval(timer);reject(new Error('SCHEDULER_TRIGGER_TIMEOUT'));}},20);});scheduler.stop();assert.ok(sent.some(x=>x.idempotencyKey.endsWith(':timer-key')));console.log(`PASS 7: real interval trigger emitted ${logs.length} ticks and dispatched timer-key through injected provider`);
 assert.equal((await jobs(req('/api/jobs',undefined,{}))).status,403);
 const authorized=new NextRequest('http://127.0.0.1:3000/api/jobs',{method:'POST',headers:{authorization:`Bearer ${process.env.SCHEDULER_SECRET}`}});delete process.env.EMAIL_API_KEY;assert.equal((await jobs(authorized)).status,200);process.env.CRON_SECRET='synthetic-cron-secret-for-tests-32-characters';assert.equal((await jobs(new NextRequest('http://127.0.0.1:3000/api/jobs',{method:'POST',headers:{authorization:`Bearer ${process.env.CRON_SECRET}`}}))).status,200);assert.equal((await jobs(new NextRequest('http://127.0.0.1:3000/api/jobs',{method:'POST',headers:{authorization:'Bearer wrong-cron-secret-for-tests-32-characters'}}))).status,403);process.env.CRON_SECRET='short';assert.equal((await jobs(new NextRequest('http://127.0.0.1:3000/api/jobs',{method:'POST',headers:{authorization:'Bearer short'}}))).status,403);delete process.env.CRON_SECRET;
 const closedBeforeDispatch=await command<Cycle>(hr,'cycle',{name:'Close before dispatch',start:at(-1),nominationDue:at(1),reviewDue:at(2),releaseDate:at(3),participantIds:currentPeople.map(p=>p.id),templateIds:templates.map(t=>t.id)});await runOutbox(disabledMail);await command(hr,'cycle.status',{id:closedBeforeDispatch.id,revision:0,status:'closed',reason:'Test lifecycle transition'});const beforeClosedSend=sent.length;await runOutbox(good);assert.equal(sent.length,beforeClosedSend);assert.ok((await state()).notices.filter(n=>n.cycleId===closedBeforeDispatch.id).every(n=>n.status==='stale'));
 rState=await state();const rc=rState.cycles.find(c=>c.id===reminderCycle.id)!;await command(hr,'cycle.status',{id:rc.id,revision:rc.revision,status:'closed',reason:'Test lifecycle transition'});await runOutbox(good);assert.ok((await state()).notices.filter(n=>n.cycleId===rc.id).every(n=>n.status==='sent'||n.status==='stale'));
 console.log('PASS 7: Brevo and Resend payload/headers, missing-provider diagnostics, retry/backoff, parallel dedupe, stale submission/closure and protected job endpoint; no external sends');

 const before=await state();const backup=await client.dumpDataDir('gzip');await writeFile(join(folder,'backup.tar.gz'),Buffer.from(await backup.arrayBuffer()));await client.close();
 client=new PGlite(join(folder,'source'));db=drizzle(client,{schema});setTestDb(db as unknown as Database);assert.deepEqual(await state(),before);
 const restored=new PGlite({dataDir:join(folder,'restored'),loadDataDir:backup});const restoredDb=drizzle(restored,{schema});assert.deepEqual(await loadState(restoredDb as unknown as Database,company),before);assert.equal((await loadState(restoredDb as unknown as Database,other)).people.length,1);
 setTestDb(restoredDb as unknown as Database);assert.equal((await snapshot(otherCookie)).packets.length,0);assert.equal((await getExport(req('/api/export',cookies.manager))).status,200);
 await restored.close();setTestDb(db as unknown as Database);console.log('PASS 10: disk restart and independent full database backup/export/restore preserve state, versions, audits, sessions and company isolation');
 console.log('ALL TEN REQUIREMENT WORKFLOW GROUPS PASSED (direct handlers and real disk-backed PGlite; no browser or hosted claims)');
 }finally{Date.now=dateNow;globalThis.fetch=fetchBefore;await client.close();await rm(folder,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
