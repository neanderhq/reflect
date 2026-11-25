import { randomUUID, createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { Actor, State, Person, Cycle, Assignment, Template, ReviewType, DevelopmentAction, DevelopmentGoal, Summary, Packet, reviewTypes, requireThat, text, id, email, AppError, Snapshot } from './model';
import { transaction, Database } from './db';
import { member, hr, cycle, canManage, actionAllowed, feedbackProjection, workspace, eligibleOwners, goalWritable, packetProjection } from './policy';
import { checkSessionInTransaction } from './session';
import { closeoutRows } from './closeout';
import { resolveAdvice, sendAdvice } from './advice';
const uid=()=>randomUUID(); const now=()=>new Date(Date.now()).toISOString();
const roles=['hr_admin','manager','employee'];
export function audit(s:State,p:Person,action:string,targetId:string,reason?:string) {s.audits.push({id:uid(),actorId:p.id,action,targetId,at:now(),...(reason?{reason}:{})});}
export function enqueue(s:State,recipientId:string,kind:State['notices'][number]['kind'],key:string,href:string,extra:Partial<State['notices'][number]>={}) {
  if(!s.notices.some(n=>n.key===key)) s.notices.push({id:uid(),recipientId,kind,key,href,status:'pending',attempts:0,nextAttempt:now(),read:false,...extra});
}
export function stale(s:State) {
  for(const n of s.notices) {
    if(n.status==='sent'||n.status==='stale') continue;
    const person=s.people.find(p=>p.id===n.recipientId); const c=n.cycleId?s.cycles.find(c=>c.id===n.cycleId):undefined; const a=n.assignmentId?s.assignments.find(a=>a.id===n.assignmentId):undefined;
    if(!person?.active || ((n.kind==='assignment'||n.kind==='reminder')&&n.cycleId&&c?.status!=='open') || ((n.kind==='assignment'||n.kind==='reminder')&&(!a || a.status==='submitted'||(n.due&&(n.due!==c?.reviewDue||Date.now()>Date.parse(n.due)))))) {n.status='stale';delete n.claim;}
  }
}
export const directoryVersion=(s:State)=>createHash('sha256').update(JSON.stringify(s.people)).digest('hex');
function phase(c:Cycle,end:string) {open(c);requireThat(Date.now()>=Date.parse(c.start),'PHASE_NOT_STARTED',409);requireThat(Date.now()<=Date.parse(end),'PHASE_DEADLINE_PASSED',409);}
function rev(entity:{revision:number},value:unknown) {requireThat(Number.isInteger(value)&&value===entity.revision,'REVISION_CONFLICT',409);}
function open(c:Cycle) {requireThat(c.status==='open','CYCLE_LOCKED',409);}
function date(v:unknown) {
 const d=text(v,40);
 const day=d.slice(0,10);
 const midnight=Date.parse(day);
 requireThat(/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(d) && Number.isFinite(Date.parse(d)) &&
   Number.isFinite(midnight) && new Date(midnight).toISOString().slice(0,10)===day,'INVALID_DATE');
 return new Date(d).toISOString();
}
function rating(v:unknown) {requireThat(Number.isInteger(v)&&Number(v)>=1&&Number(v)<=5,'INVALID_RATING');return Number(v);}
export function generate(s:State,p:Person,c:Cycle) {
 const add=(type:ReviewType,authorId:string,subjectId:string)=>{
   const key=`${c.id}:${type}:${authorId}:${subjectId}`; if(s.assignments.some(a=>a.cycleId===c.id&&a.type===type&&a.authorId===authorId&&a.subjectId===subjectId))return;
   const subject=c.roster.find(r=>r.id===subjectId)!;
   const template=c.templates.find(t=>t.type===type&&t.role===subject.role)||c.templates.find(t=>t.type===type&&t.role==='all');
   requireThat(template,'TEMPLATE_MISSING');
   const assignmentId=uid();
   s.assignments.push({id:assignmentId,cycleId:c.id,type,authorId,subjectId,questions:structuredClone(template.questions),answers:{},status:'draft',revision:0});
   enqueue(s,authorId,'assignment',`assignment:${key}`,`/?view=reviews&review=${encodeURIComponent(assignmentId)}`,{cycleId:c.id,assignmentId,due:c.reviewDue});
   audit(s,p,'assignment.created',key);
 };
 for(const r of c.roster) {add('self',r.id,r.id);if(r.managerId&&c.roster.some(x=>x.id===r.managerId)) {add('manager',r.managerId,r.id);add('upward',r.id,r.managerId);}}
 for(const n of s.nominations.filter(n=>n.cycleId===c.id&&n.status==='approved')) add('peer',n.authorId,n.subjectId);
}
export function validatePeople(s:State,rows:Record<string,string>[]) {
 const errors:{row:number;message:string}[]=[];const next=structuredClone(s.people);const addresses=new Set<string>();
 const normalized: {row:number;person:Person;managerEmail:string}[]=[];
 for(let i=0;i<rows.length;i++) {try {
   const r=rows[i]; const e=email(r.email);requireThat(!addresses.has(e),'DUPLICATE_EMAIL');addresses.add(e);
   requireThat(roles.includes(r.role),'INVALID_ROLE');requireThat(r.active==='true'||r.active==='false','INVALID_ACTIVE');requireThat(text(r.full_name,120),'NAME_REQUIRED');
   const current=next.find(p=>p.email===e); const person:Person={id:current?.id||uid(),email:e,name:text(r.full_name,120),team:text(r.team,100),title:text(r.title,120),managerId:null,role:r.role as Person['role'],active:r.active==='true',passwordHash:current?.passwordHash||'',authVersion:current?.authVersion||0,revision:current?.revision||0};
   normalized.push({row:i+2,person,managerEmail:r.manager_email?email(r.manager_email):''});
   if(current)next[next.indexOf(current)]=person;else next.push(person);
 }catch(e){errors.push({row:i+2,message:e instanceof AppError?e.code:'INVALID_ROW'});}}
 for(const r of normalized) {const m=r.managerEmail?next.find(p=>p.email===r.managerEmail):undefined;if(r.managerEmail&&(!m||!m.active||!['manager','hr_admin'].includes(m.role)))errors.push({row:r.row,message:'INVALID_MANAGER'});r.person.managerId=m?.id||null;}
 for(const r of normalized) {let cursor:Person|undefined=r.person;const seen=new Set<string>();while(cursor){if(seen.has(cursor.id)){errors.push({row:r.row,message:'REPORTING_LOOP'});break;}seen.add(cursor.id);cursor=next.find(p=>p.id===cursor?.managerId);}}
 // Validate existing reports too when an imported manager changes role or status.
 for(const p of next) if(p.active&&p.managerId){const m=next.find(x=>x.id===p.managerId);if(!m?.active||!['manager','hr_admin'].includes(m.role))errors.push({row:0,message:`INVALID_MANAGER_FOR:${p.email}`});}
 if(!next.some(p=>p.active&&p.role==='hr_admin'))errors.push({row:0,message:'LAST_HR_PROTECTED'});
 return {errors,next};
}
export function parsePeople(csv:unknown) {
 const raw=text(csv,200000);let records:string[][];try{records=parse(raw,{bom:true,skip_empty_lines:true,relax_column_count:false});}catch{throw new AppError('INVALID_CSV');}
 requireThat(records.length>1&&records.length<=1001,'CSV_ROW_LIMIT');
 const expected=['email','full_name','team','title','manager_email','role','active'];const headers=records[0]; requireThat(headers.length===7&&new Set(headers).size===7&&headers.every(h=>expected.includes(h)),'INVALID_HEADERS');
 return records.slice(1).map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]])));
}
function actionFields(s:State,p:Person,subjectId:string,input:Record<string,unknown>) {
 const ownerId=id(input.ownerId);
 requireThat(eligibleOwners(s,p,subjectId).some(x=>x.id===ownerId),'INVALID_OWNER');
 const progress=text(input.progress) as DevelopmentAction['progress'];
 requireThat(['planned','in_progress','complete'].includes(progress));
 const title=text(input.title,200);
 requireThat(title);
 return {subjectId,ownerId,title,notes:text(input.notes,10000),due:date(input.due),progress};
}
function saveGoal(s:State,p:Person,input:Record<string,unknown>) {
 const title=text(input.title,200),successMeasure=text(input.successMeasure,2000);
 requireThat(title && successMeasure,'GOAL_FIELDS_REQUIRED');
 if(input.id!==undefined) {
  const goalId=id(input.id);
  const goal=s.goals.find(g=>g.id===goalId);
  requireThat(goal && actionAllowed(s,p,goal.subjectId),'NOT_FOUND',404);
  requireThat(goalWritable(s,p,goal.subjectId),'FORBIDDEN',403);
  rev(goal,input.revision);
  Object.assign(goal,{title,successMeasure,revision:goal.revision+1});
  audit(s,p,'goal.saved',goal.id);
  return {id:goal.id};
 }
 const packetId=id(input.packetId);
 const packet=s.packets.find(x=>x.id===packetId);
 requireThat(packet && packetProjection(s,p,packet),'NOT_FOUND',404);
 requireThat(goalWritable(s,p,packet.subjectId),'FORBIDDEN',403);
 requireThat(!s.goals.some(g=>g.packetId===packet.id),'GOAL_EXISTS',409);
 const goal:DevelopmentGoal={id:uid(),subjectId:packet.subjectId,packetId:packet.id,title,successMeasure,revision:0};
 requireThat(text(input.actionTitle,200),'ACTION_TITLE_REQUIRED');
 const fields=actionFields(s,p,goal.subjectId,{ownerId:input.ownerId,title:input.actionTitle,due:input.due,notes:'',progress:'planned'});
 s.goals.push(goal);
 const action:DevelopmentAction={id:uid(),goalId:goal.id,...fields,revision:0};
 s.actions.push(action);
 audit(s,p,'goal.saved',goal.id);
 audit(s,p,'action.saved',action.id);
 return {id:goal.id};
}
function saveAction(s:State,p:Person,input:Record<string,unknown>) {
 const subjectId=id(input.subjectId);
 requireThat(s.people.some(x=>x.id===subjectId)&&actionAllowed(s,p,subjectId),'FORBIDDEN',403);
 const existing=input.id?s.actions.find(x=>x.id===input.id):undefined;
 if(input.id)requireThat(existing,'NOT_FOUND',404);
 if(existing) {
  requireThat(existing.subjectId===subjectId,'FORBIDDEN',403);
  rev(existing,input.revision);
 }
 const goalId=existing?existing.goalId:input.goalId===undefined?undefined:id(input.goalId);
 if(goalId) {
  requireThat(s.goals.some(g=>g.id===goalId&&g.subjectId===subjectId),'NOT_FOUND',404);
  requireThat(goalWritable(s,p,subjectId),'FORBIDDEN',403);
 }
 const fields=actionFields(s,p,subjectId,input);
 const action=existing??{id:uid(),...(goalId?{goalId}:{}),...fields,revision:0};
 if(existing)Object.assign(existing,{...fields,revision:existing.revision+1});
 else s.actions.push(action);
 audit(s,p,'action.saved',action.id);
}
function publishPacket(state: State, actor: Person, cycle: Cycle, summary: Summary, version: number): Packet {
 const {subjectId,text,originalRating,rating,calibrationReason}=summary;
 const packet={id:uid(),cycleId:cycle.id,subjectId,version,releasedAt:now(),summary:text,originalRating,rating,
   calibrationReason,feedback:feedbackProjection(state,cycle,subjectId)};
 state.packets.push(packet);
 enqueue(state,subjectId,'release',`release:${packet.id}`,'/?view=history');
 audit(state,actor,'packet.released',packet.id);
 return packet;
}
function publishReadyPackets(state: State, actor: Person, cycle: Cycle, selection: unknown) {
 requireThat(Array.isArray(selection)&&selection.length>0&&selection.length<=100,'INVALID_CLOSEOUT_SELECTION');
 const rows=new Map(closeoutRows(state,cycle,Date.now()).map(row=>[row.subjectId,row]));
 const seen=new Set<string>();
 const summaries=selection.map((entry: unknown)=>{
   requireThat(entry&&typeof entry==='object'&&'subjectId' in entry&&'token' in entry,'INVALID_CLOSEOUT_SELECTION');
   const subjectId=id(entry.subjectId);
   requireThat(!seen.has(subjectId),'INVALID_CLOSEOUT_SELECTION');
   seen.add(subjectId);
   const row=rows.get(subjectId);
   requireThat(row?.status==='ready'&&row.token===entry.token,'CLOSEOUT_CHANGED',409);
   return state.summaries.find(summary=>summary.cycleId===cycle.id&&summary.subjectId===subjectId)!;
 });
 return {released:summaries.map(summary=>publishPacket(state,actor,cycle,summary,1).id)};
}
export async function operation(actor:Actor,command:string,input:Record<string,unknown>) {
 return transaction(actor.companyId,async(s,db)=>{await checkSessionInTransaction(actor,db,s); const p=member(s,actor.personId);let result:unknown={ok:true};
 switch(command) {
 case 'workspace':return {...workspace(s,p),...(p.role==='hr_admin'?{directoryVersion:directoryVersion(s)}:{})};
 case 'template': {hr(p);const type=text(input.type) as ReviewType;requireThat(reviewTypes.includes(type));const role=text(input.role||'all');requireThat([...roles,'all'].includes(role));requireThat(Array.isArray(input.questions)&&input.questions.length>0&&input.questions.length<=30);
 const questions=input.questions.map((x:unknown)=>{requireThat(x&&typeof x==='object');const q=x as Record<string,unknown>;requireThat(q.kind==='written'||q.kind==='rating');requireThat(typeof q.required==='boolean');return{id:uid(),text:text(q.text,1000),kind:q.kind,required:q.required} as Template['questions'][number];});requireThat(questions.every(q=>q.text));
 const family=input.family?id(input.family):uid();const previous=s.templates.filter(t=>t.family===family);if(input.family)requireThat(previous.length,'NOT_FOUND',404);
 const t:Template={id:uid(),family,version:Math.max(0,...previous.map(t=>t.version))+1,name:text(input.name,120),type,role:role as Template['role'],questions};requireThat(t.name);s.templates.push(t);audit(s,p,'template.versioned',t.id);result=t;break;}
 case 'cycle': {hr(p);const start=date(input.start),nominationDue=date(input.nominationDue),reviewDue=date(input.reviewDue),releaseDate=date(input.releaseDate);requireThat(start<=nominationDue&&nominationDue<reviewDue&&reviewDue<=releaseDate,'DEADLINE_ORDER');requireThat(Array.isArray(input.participantIds)&&input.participantIds.length>0);requireThat(new Set(input.participantIds).size===input.participantIds.length);
 const roster=input.participantIds.map(v=>{const person=s.people.find(x=>x.id===v&&x.active);requireThat(person,'INVALID_PARTICIPANT');return{id:person.id,name:person.name,team:person.team,managerId:person.managerId,role:person.role};});requireThat(Array.isArray(input.templateIds));const templates=input.templateIds.map(v=>{const t=s.templates.find(t=>t.id===v);requireThat(t,'INVALID_TEMPLATE');return structuredClone(t);});
 requireThat(new Set(templates.map(t=>`${t.type}:${t.role}`)).size===templates.length,'DUPLICATE_TEMPLATE_ROLE');
 for(const r of roster)for(const t of reviewTypes)requireThat(templates.some(x=>x.type===t&&(x.role==='all'||x.role===r.role)),'TEMPLATE_MISSING');
 const c:Cycle={id:uid(),name:text(input.name,120),status:'open',minGroup:3,start,nominationDue,reviewDue,releaseDate,roster,templates,policy:{self:{include:true,disclose:true},manager:{include:true,disclose:true},upward:{include:true,disclose:false},peer:{include:true,disclose:false}},revision:0};requireThat(c.name);s.cycles.push(c);generate(s,p,c);audit(s,p,'cycle.created',c.id);result=c;break;}
 case 'cycle.update': {hr(p);const c=cycle(s,id(input.id));rev(c,input.revision);open(c);for(const field of ['start','nominationDue','reviewDue','releaseDate'] as const)if(input[field])c[field]=date(input[field]);requireThat(c.start<=c.nominationDue&&c.nominationDue<c.reviewDue&&c.reviewDue<=c.releaseDate,'DEADLINE_ORDER');if(input.minGroup!==undefined){requireThat(Number.isInteger(input.minGroup)&&Number(input.minGroup)>=3&&Number(input.minGroup)<=100,'INVALID_MIN_GROUP');c.minGroup=Number(input.minGroup);}
 if(input.policy){const policy=input.policy as Cycle['policy'];for(const t of reviewTypes){requireThat(typeof policy[t]?.include==='boolean'&&typeof policy[t]?.disclose==='boolean');}c.policy=Object.fromEntries(reviewTypes.map(t=>[t,{include:policy[t].include,disclose:policy[t].disclose}])) as Cycle['policy'];}
 c.revision++;stale(s);audit(s,p,'cycle.updated',c.id);break;}
 case 'cycle.status': {hr(p);const c=cycle(s,id(input.id));rev(c,input.revision);const status=text(input.status);requireThat(['open','closed','archived'].includes(status));if(c.status==='archived')requireThat(status===(c.previousStatus||'closed'),'RESTORE_STATUS_REQUIRED');if(status==='archived')c.previousStatus=c.status as 'open'|'closed';requireThat(c.status!==status,'STATUS_UNCHANGED',409);const prior=c.status;requireThat(text(input.reason||'',1000).trim().length>=3,'REASON_REQUIRED');c.status=status as Cycle['status'];c.revision++;stale(s);audit(s,p,prior==='archived'?'cycle.restored':prior==='closed'&&status==='open'?'cycle.reopened':`cycle.${status}`,c.id,text(input.reason||'HR status transition',1000));s.audits.at(-1)!.before=prior;s.audits.at(-1)!.after=status;break;}
 case 'generate': {hr(p);const c=cycle(s,id(input.id));open(c);generate(s,p,c);break;}
 case 'nominate': {const c=cycle(s,id(input.cycleId));phase(c,c.nominationDue);requireThat(c.roster.some(r=>r.id===p.id),'FORBIDDEN',403);const authorId=id(input.authorId);requireThat(authorId!==p.id&&c.roster.some(r=>r.id===authorId)&&s.people.some(r=>r.id===authorId&&r.active),'INVALID_NOMINEE');const key=`${c.id}:${p.id}:${authorId}`;requireThat(!s.nominations.some(n=>n.id===key),'DUPLICATE_NOMINATION',409);s.nominations.push({id:key,cycleId:c.id,subjectId:p.id,authorId,status:'pending'});audit(s,p,'nomination.created',key);break;}
 case 'nomination.decide': {const n=s.nominations.find(n=>n.id===input.id);requireThat(n,'NOT_FOUND',404);const c=cycle(s,n.cycleId);phase(c,c.nominationDue);requireThat(s.people.some(x=>x.id===n.authorId&&x.active)&&s.people.some(x=>x.id===n.subjectId&&x.active),'INVALID_NOMINEE');requireThat(canManage(s,p,c,n.subjectId),'FORBIDDEN',403);requireThat(n.status==='pending','NOMINATION_DECIDED',409);requireThat(typeof input.approve==='boolean');n.status=input.approve?'approved':'rejected';if(input.approve)generate(s,p,c);audit(s,p,`nomination.${n.status}`,n.id);break;}
 case 'review.save':case 'review.submit': {const a=s.assignments.find(a=>a.id===input.id);requireThat(a&&a.authorId===p.id,'NOT_FOUND',404);const c=cycle(s,a.cycleId);phase(c,c.reviewDue);requireThat(a.status==='draft','REVIEW_LOCKED',409);rev(a,input.revision);requireThat(input.answers&&typeof input.answers==='object'&&!Array.isArray(input.answers));const values=input.answers as Record<string,unknown>;requireThat(Object.keys(values).every(k=>a.questions.some(q=>q.id===k)),'UNKNOWN_ANSWER');const answers:Assignment['answers']={};
 for(const q of a.questions){const v=values[q.id];if(v===undefined||v===''||v===null){if(command==='review.submit'&&q.required)throw new AppError('REQUIRED_ANSWER');continue;}answers[q.id]=q.kind==='rating'?rating(v):text(v,10000);if(command==='review.submit'&&q.required)requireThat(answers[q.id]!=='','REQUIRED_ANSWER');}
 a.answers=answers;a.revision++;if(command==='review.submit'){a.status='submitted';a.submittedAt=now();audit(s,p,'review.submitted',a.id);stale(s);}result={revision:a.revision,status:a.status};break;}
 case 'review.reopen': {hr(p);const a=s.assignments.find(a=>a.id===input.id);requireThat(a,'NOT_FOUND',404);open(cycle(s,a.cycleId));rev(a,input.revision);requireThat(a.status==='submitted','REVIEW_NOT_SUBMITTED',409);const reason=text(input.reason,1000);requireThat(reason,'REASON_REQUIRED');a.status='draft';a.revision++;delete a.submittedAt;audit(s,p,'review.reopened',a.id,reason);break;}
 case 'summary': {const c=cycle(s,id(input.cycleId));open(c);const subjectId=id(input.subjectId);requireThat(c.roster.some(r=>r.id===subjectId)&&canManage(s,p,c,subjectId),'FORBIDDEN',403);let summary=s.summaries.find(x=>x.cycleId===c.id&&x.subjectId===subjectId);const content=text(input.text,10000);requireThat(content,'SUMMARY_REQUIRED');const score=rating(input.rating);
 if(summary){rev(summary,input.revision);requireThat(!summary.calibrationReason,'CALIBRATED_SUMMARY_LOCKED',409);summary.text=content;summary.originalRating=score;summary.rating=score;summary.revision++;}else {requireThat(input.revision===0,'REVISION_CONFLICT',409);summary={id:uid(),cycleId:c.id,subjectId,text:content,originalRating:score,rating:score,calibrationReason:'',revision:1};s.summaries.push(summary);}audit(s,p,'summary.saved',summary.id);result=summary;break;}
 case 'calibrate': {hr(p);const x=s.summaries.find(x=>x.id===input.id);requireThat(x,'NOT_FOUND',404);open(cycle(s,x.cycleId));rev(x,input.revision);const reason=text(input.reason,1000);requireThat(reason,'REASON_REQUIRED');const prior={rating:x.rating,originalRating:x.originalRating,reason:x.calibrationReason};x.rating=rating(input.rating);x.calibrationReason=reason;x.revision++;audit(s,p,'summary.calibrated',x.id,reason);s.audits.at(-1)!.before=prior;s.audits.at(-1)!.after={rating:x.rating,originalRating:x.originalRating,reason};break;}
 case 'release': {hr(p);const c=cycle(s,id(input.cycleId));open(c);requireThat(Date.now()>=Date.parse(c.releaseDate),'RELEASE_NOT_DUE',409);const subjectId=id(input.subjectId);const x=s.summaries.find(x=>x.cycleId===c.id&&x.subjectId===subjectId);requireThat(x,'SUMMARY_REQUIRED');rev(x,input.revision);requireThat(!s.assignments.some(a=>a.cycleId===c.id&&a.subjectId===subjectId&&a.status!=='submitted'),'REVIEWS_INCOMPLETE',409);
 const old=s.packets.filter(k=>k.cycleId===c.id&&k.subjectId===subjectId);requireThat(input.expectedVersion===old.length,'PACKET_VERSION_CONFLICT',409);
 result=publishPacket(s,p,c,x,old.length+1);break;}
 case 'cycle.closeout': {hr(p);return closeoutRows(s,cycle(s,id(input.cycleId)),Date.now());}
 case 'release.batch': {hr(p);result=publishReadyPackets(s,p,cycle(s,id(input.cycleId)),input.selection);break;}
 case 'acknowledge': {const packet=s.packets.find(x=>x.id===input.id&&x.subjectId===p.id);requireThat(packet,'NOT_FOUND',404);open(cycle(s,packet.cycleId));if(!s.acknowledgments.some(x=>x.packetId===packet.id)){s.acknowledgments.push({id:uid(),packetId:packet.id,subjectId:p.id,at:now()});audit(s,p,'packet.acknowledged',packet.id);}break;}
 case 'people.preview':case 'people.apply': {hr(p);const {errors,next}=validatePeople(s,parsePeople(input.csv));if(command==='people.preview')return {errors,directoryVersion:directoryVersion(s),rows:next.map(({passwordHash,authVersion,...r})=>r)};requireThat(input.directoryVersion===directoryVersion(s),'REVISION_CONFLICT',409);requireThat(!errors.length,'CSV_VALIDATION_FAILED',422);for(const person of next){const old=s.people.find(p=>p.id===person.id);if(old&&JSON.stringify(old)!==JSON.stringify(person)){person.authVersion++;person.revision=(old.revision||0)+1;audit(s,p,'person.access_changed',person.id);}}
 s.people=next;stale(s);audit(s,p,'people.imported',p.id);break;}
 case 'person.update': {hr(p);const person=s.people.find(x=>x.id===input.id);requireThat(person,'NOT_FOUND',404);rev({revision:person.revision||0},input.revision);const rows=[{email:person.email,full_name:text(input.name,120),team:text(input.team,100),title:text(input.title,120),manager_email:input.managerId?s.people.find(x=>x.id===input.managerId)?.email||'invalid':'',role:text(input.role),active:String(input.active)}];requireThat(typeof input.active==='boolean');const {errors,next}=validatePeople(s,rows);requireThat(!errors.length,'PEOPLE_VALIDATION_FAILED',422);const updated=next.find(x=>x.id===person.id)!;updated.authVersion++;updated.revision=(person.revision||0)+1;s.people=next;stale(s);audit(s,p,'person.access_changed',person.id);break;}
 case 'advice.send': result=sendAdvice(s,p,input);break;
 case 'advice.reply': result=resolveAdvice(s,p,input,'answered');break;
 case 'advice.cancel': result=resolveAdvice(s,p,input,'canceled');break;
 case 'advice.decline': result=resolveAdvice(s,p,input,'declined');break;
 case 'goal.save': result=saveGoal(s,p,input);break;
 case 'action': saveAction(s,p,input);break;
 case 'outbox.retry': {hr(p);const n=s.notices.find(n=>n.id===input.id);requireThat(n,'NOT_FOUND',404);stale(s);requireThat(n.status==='disabled'||(n.status==='failed'&&n.diagnostic==='DELIVERY_REJECTED'&&n.attempts<5),'RETRY_NOT_SAFE',409);n.status='pending';n.nextAttempt=now();audit(s,p,'outbox.retry',n.id);break;}
 case 'notice.read': {const n=s.notices.find(n=>n.id===input.id&&n.recipientId===p.id);requireThat(n,'NOT_FOUND',404);n.read=true;break;}
 case 'reminders': {hr(p);for(const a of s.assignments){const c=cycle(s,a.cycleId);if(c.status==='open'&&Date.now()>=Date.parse(c.start)&&a.status==='draft'&&Date.parse(c.reviewDue)>=Date.now()&&Date.parse(c.reviewDue)-Date.now()<7*86400000)enqueue(s,a.authorId,'reminder',`reminder:${a.id}:${c.reviewDue}`,`/?view=reviews&review=${encodeURIComponent(a.id)}`,{cycleId:c.id,assignmentId:a.id,due:c.reviewDue});}stale(s);audit(s,p,'reminders.queued',p.id);break;}
 default: throw new AppError('UNKNOWN_COMMAND');
 }
 return result;
 });
}
