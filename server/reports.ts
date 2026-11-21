import { State, Person, ReviewType, reviewTypes, requireThat } from './model';
import { canManage } from './policy';
export interface ReportRow { cycle: string; cycleId: string; team: string; type: ReviewType; assigned: number | null; submitted: number | null; overdue: number | null; average: number | null; ratingCount: number | null; suppressed: boolean }
export function reports(s:State,p:Person,filters:{cycleId?:string;team?:string;type?:string;search?:string}={}) {
 requireThat(p.role==='hr_admin'||p.role==='manager','FORBIDDEN',403);const rows:ReportRow[]=[];
 for(const c of s.cycles.filter(c=>!filters.cycleId||c.id===filters.cycleId)) {
 const roster=c.roster.filter(r=>canManage(s,p,c,r.id));
 for(const team of [...new Set(roster.map(r=>r.team))].sort())for(const type of reviewTypes) {
  if(!c.policy[type].include)continue;
  if(filters.search&&!`${c.name} ${team} ${type}`.toLowerCase().includes(filters.search.toLowerCase()))continue;
  if((filters.team&&filters.team!==team)||(filters.type&&filters.type!==type))continue;
  const subjects=new Set(roster.filter(r=>r.team===team).map(r=>r.id));const assignments=s.assignments.filter(a=>a.cycleId===c.id&&a.type===type&&subjects.has(a.subjectId));
  if(!assignments.length)continue;
  const cohort=new Set(assignments.map(a=>a.subjectId)).size;const submitted=assignments.filter(a=>a.status==='submitted');
  const ratingAssignments=submitted.filter(a=>a.questions.some(q=>q.kind==='rating'&&typeof a.answers[q.id]==='number'));
  const ratingCohort=new Set(ratingAssignments.map(a=>a.subjectId)).size;
  const values=ratingAssignments.flatMap(a=>a.questions.filter(q=>q.kind==='rating'&&typeof a.answers[q.id]==='number').map(q=>Number(a.answers[q.id])));
  const hidden=cohort<(c.minGroup||3);const hiddenRatings=hidden||ratingCohort<(c.minGroup||3);
  rows.push({cycle:c.name,cycleId:c.id,team,type,assigned:hidden?null:assignments.length,submitted:hidden?null:submitted.length,overdue:hidden?null:assignments.filter(a=>a.status!=='submitted'&&c.status==='open'&&Date.parse(c.reviewDue)<Date.now()).length,average:hiddenRatings||!values.length?null:Math.round(values.reduce((a,b)=>a+b,0)/values.length*100)/100,ratingCount:hiddenRatings?null:values.length,suppressed:hidden||hiddenRatings});
 }
 }return rows;
}
export function csvCell(value:unknown) {let v=value===null||value===undefined?'Suppressed':String(value);if(/^[\s]*[=+\-@\t\r]/.test(v))v="'"+v;return `"${v.replaceAll('"','""')}"`;}
export const reportCsv=(rows:ReportRow[])=>[['Cycle','Team','Review type','Assigned','Submitted','Overdue','Average (1–5)','Rating count'],...rows.map(r=>[r.cycle,r.team,r.type,r.assigned,r.submitted,r.overdue,r.average,r.ratingCount])].map(row=>row.map(csvCell).join(',')).join('\r\n');
