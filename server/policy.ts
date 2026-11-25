import { mailConfigured, notConfigured } from './mail-config';
import { Assignment, Cycle, Feedback, Packet, Person, State, requireThat } from './model';
export function member(s:State, personId:string) { const p=s.people.find(p=>p.id===personId && p.active); requireThat(p,'SESSION_REVOKED',401); return p; }
export function hr(p:Person) { requireThat(p.role==='hr_admin','FORBIDDEN',403); }
export function historicalManager(s:State,p:Person,c:Cycle,subjectId:string) {
  return p.role==='manager' && c.roster.some(r=>r.id===subjectId && r.managerId===p.id) && s.people.some(r=>r.id===subjectId && r.managerId===p.id);
}
export function canManage(s:State,p:Person,c:Cycle,subjectId:string) { return p.role==='hr_admin' || historicalManager(s,p,c,subjectId); }
export function cycle(s:State,cycleId:string) { const c=s.cycles.find(c=>c.id===cycleId); requireThat(c,'NOT_FOUND',404); return c; }
export function assignmentProjection(s:State,p:Person,a:Assignment) {
  const c=cycle(s,a.cycleId);
  if(a.authorId===p.id) return a;
  if(!canManage(s,p,c,a.subjectId)) return null;
  // Metadata does not expose draft content, author identity or author-correlated identifiers.
  return {id:a.id,cycleId:a.cycleId,type:a.type,subjectId:a.subjectId,status:a.status,revision:a.revision};
}
export function feedbackProjection(s:State,c:Cycle,subjectId:string):Feedback[] {
  return s.assignments.filter(a=>a.cycleId===c.id && a.subjectId===subjectId && a.status==='submitted' && c.policy[a.type].include).map(a=>({
    type:a.type,...(c.policy[a.type].disclose?{authorName:s.people.find(p=>p.id===a.authorId)?.name || 'Former colleague'}:{}),
    answers:a.questions.filter(q=>a.answers[q.id]!==undefined && a.answers[q.id]!=='').map(q=>({question:q.text,value:a.answers[q.id]}))
  }));
}
export function packetProjection(s:State,p:Person,packet:Packet):Packet|null {
  const c=cycle(s,packet.cycleId); if(packet.subjectId!==p.id && !canManage(s,p,c,packet.subjectId)) return null;
  return {...packet,feedback:packet.feedback.filter(f=>c.policy[f.type].include).map(f=>{const {authorName,...anonymous}=f;return c.policy[f.type].disclose?f:anonymous;})};
}
export function actionAllowed(s:State,p:Person,subjectId:string) { return p.id===subjectId || p.role==='hr_admin' || (p.role==='manager' && s.people.some(x=>x.id===subjectId && x.managerId===p.id)); }
export function goalWritable(s:State,p:Person,subjectId:string) {
 return p.role!=='hr_admin' && actionAllowed(s,p,subjectId) && s.people.some(x=>x.id===subjectId&&x.active);
}
export function eligibleOwners(s:State,p:Person,subjectId:string) {
 if(!actionAllowed(s,p,subjectId))return [];
 const subject=s.people.find(x=>x.id===subjectId);
 return s.people.filter(x=>x.active&&(x.id===subjectId||x.id===subject?.managerId||x.id===p.id)).map(({id,name})=>({id,name}));
}
type WorkspacePerson = Pick<Person,'id'|'name'> & Partial<Omit<Person,'id'|'name'|'passwordHash'|'authVersion'>>;
function profile({passwordHash,authVersion,...person}:Person):WorkspacePerson { return person; }
export function workspace(s:State,p:Person) {
  const permittedCycles=s.cycles.filter(c=>p.role==='hr_admin'||c.roster.some(r=>r.id===p.id));
  const managed=s.people.filter(person=>person.id!==p.id&&s.cycles.some(c=>historicalManager(s,p,c,person.id)));
  const people:WorkspacePerson[]=p.role==='hr_admin'?s.people.map(profile):[
    profile(p),...managed.map(({id,name,team,title,managerId,active})=>({id,name,team,title,managerId,active})),
  ];
  const nominations=s.nominations.filter(n=>n.subjectId===p.id||canManage(s,p,cycle(s,n.cycleId),n.subjectId));
  const actions=s.actions.filter(a=>actionAllowed(s,p,a.subjectId));
  const packets=s.packets.map(x=>packetProjection(s,p,x)).filter(packet=>packet!==null);
  const goals=s.goals.filter(g=>actionAllowed(s,p,g.subjectId)).map(({packetId,...goal})=>{
    const packet=packets.find(x=>x.id===packetId);
    return {...goal, canEdit:goalWritable(s,p,goal.subjectId),
      source:packet?{id:packet.id,cycleId:packet.cycleId,version:packet.version}:null};
  });
  const namedIds=new Set([
    ...s.assignments.filter(a=>a.authorId===p.id).map(a=>a.subjectId),
    ...nominations.map(n=>n.authorId),...actions.flatMap(a=>[a.ownerId,a.subjectId]),
    ...(p.managerId?[p.managerId]:[]),
  ]);
  return {
    me:{id:p.id,name:p.name,email:p.email,role:p.role,team:p.team},
    people,
    relatedPeople:s.people.filter(person=>namedIds.has(person.id)).map(({id,name})=>({id,name})),
    nominationChoices:permittedCycles.filter(c=>c.status==='open'&&Date.now()>=Date.parse(c.start)&&Date.now()<=Date.parse(c.nominationDue)&&c.roster.some(r=>r.id===p.id)).map(c=>({
      cycleId:c.id,people:c.roster.filter(r=>r.id!==p.id&&s.people.some(person=>person.id===r.id&&person.active)).map(({id,name})=>({id,name})),
    })),
    templates:p.role==='hr_admin'?s.templates:[],
    cycles:permittedCycles.map(c=>p.role==='hr_admin'?c:{...c,templates:[],roster:c.roster.filter(r=>r.id===p.id||historicalManager(s,p,c,r.id))}),
    assignments:s.assignments.map(a=>assignmentProjection(s,p,a)).filter(assignment=>assignment!==null),
    nominations,
    feedback:s.cycles.flatMap(c=>c.roster.filter(r=>canManage(s,p,c,r.id)).map(r=>({cycleId:c.id,subjectId:r.id,feedback:feedbackProjection(s,c,r.id)}))),
    submittedFeedback:p.role==='hr_admin'?s.assignments.filter(a=>a.status==='submitted').map(a=>({...a,authorName:s.people.find(x=>x.id===a.authorId)?.name})):[],
    summaries:s.summaries.filter(x=>canManage(s,p,cycle(s,x.cycleId),x.subjectId)),
    packets,
    acknowledgments:s.acknowledgments.filter(a=>a.subjectId===p.id||s.packets.some(k=>k.id===a.packetId&&canManage(s,p,cycle(s,k.cycleId),k.subjectId))),
    goals,
    actions,
    actionChoices:s.people.filter(x=>x.active&&actionAllowed(s,p,x.id)).map(x=>({subjectId:x.id,name:x.name,owners:eligibleOwners(s,p,x.id)})),
    outbox:p.role==='hr_admin'?s.notices.map(({id,recipientId,kind,status,attempts,diagnostic,nextAttempt})=>({id,recipientId,kind,status,attempts,diagnostic:(status==='pending'||status==='disabled')&&!mailConfigured()?notConfigured:diagnostic,nextAttempt})):[],
    audits:p.role==='hr_admin'?s.audits:[],
    notices:s.notices.filter(n=>n.recipientId===p.id&&n.status!=='stale'&&(!['assignment','reminder'].includes(n.kind)||s.assignments.some(a=>a.id===n.assignmentId&&a.status==='draft'&&s.cycles.some(c=>c.id===a.cycleId&&c.status==='open'&&Date.now()<=Date.parse(c.reviewDue))))).map(({id,kind,href,read,status,diagnostic})=>({id,kind,href,read,status,diagnostic})),
    mailEnabled:mailConfigured(),
  };
}
