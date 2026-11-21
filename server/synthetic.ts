import { randomUUID } from 'node:crypto';
import { emptyState, reviewTypes, type Person, type Cycle, type State } from './model';
import { audit, generate } from './service';
import { feedbackProjection } from './policy';
export const syntheticPassword='Lattice-demo-2026!';
export const syntheticCompany='lattice-synthetic';
export const isolationCompany='isolation-synthetic';
export function syntheticState(hash:string,clock=Date.now()):State {
 const s=emptyState(),day=86400000,at=(days:number)=>new Date(clock+days*day).toISOString();
 const add=(id:string,name:string,role:Person['role'],managerId:string|null=null)=>s.people.push({id,name,email:`${id}@lattice.test`,role,managerId,team:role==='hr_admin'?'People':'Product',title:role==='hr_admin'?'People lead':role==='manager'?'Team lead':'Specialist',active:true,passwordHash:hash,authVersion:0,revision:0});
 add('hr','Harper Reed','hr_admin');add('manager','Morgan Lee','manager');
 add('alex','Alex Chen','employee','manager');add('blair','Blair Patel','employee','manager');add('casey','Casey Rossi','employee','manager');add('drew','Drew Silva','employee','manager');
 for(const type of reviewTypes)s.templates.push({id:randomUUID(),family:randomUUID(),version:1,name:`${type} reflection`,role:'all',type,questions:[{id:randomUUID(),text:'Share a concrete example',kind:'written',required:true},{id:randomUUID(),text:'Impact rating',kind:'rating',required:false}]});
 const cycle=(id:string,name:string,past:boolean):Cycle=>({id,name,status:'open',minGroup:3,start:at(past?-30:-1),nominationDue:at(past?-20:2),reviewDue:at(past?-10:7),releaseDate:at(past?-5:8),roster:s.people.map(({id,name,team,role,managerId})=>({id,name,team,role,managerId})),templates:structuredClone(s.templates),policy:{self:{include:true,disclose:true},manager:{include:true,disclose:true},peer:{include:true,disclose:false},upward:{include:true,disclose:false}},revision:0});
 for(const c of [cycle('spring-history','Spring review history',true),cycle('autumn-growth','Autumn growth reviews',false)]){
 s.cycles.push(c);
 for(const [subjectId,authorId] of [['alex','blair'],['blair','casey'],['casey','drew'],['drew','alex']])s.nominations.push({id:randomUUID(),cycleId:c.id,subjectId,authorId,status:'approved'});
 generate(s,s.people[0],c);
 if(c.id==='spring-history'){
 for(const a of s.assignments){if(a.cycleId!==c.id)continue;a.status='submitted';a.revision=1;a.submittedAt=at(-12);a.answers={[a.questions[0].id]:'A useful example from our synthetic project'};if(a.subjectId!=='drew')a.answers[a.questions[1].id]=({alex:1,blair:3,casey:5} as Record<string,number>)[a.subjectId]||4;}
 const summary={id:randomUUID(),cycleId:c.id,subjectId:'alex',text:'Alex delivered clear, thoughtful work.',originalRating:3,rating:4,calibrationReason:'Consistent impact across projects',revision:2};s.summaries.push(summary);
 s.packets.push({id:randomUUID(),cycleId:c.id,subjectId:'alex',version:1,releasedAt:at(-4),summary:summary.text,originalRating:3,rating:4,calibrationReason:summary.calibrationReason,feedback:feedbackProjection(s,c,'alex')});
 }
 }
 const draft=s.assignments.find(a=>a.cycleId==='autumn-growth'&&a.authorId==='alex'&&a.type==='self')!;
 draft.answers={[draft.questions[0].id]:'Private synthetic draft: keep my examples until submission.'};draft.revision=1;
 s.actions.push({id:randomUUID(),subjectId:'alex',ownerId:'alex',title:'Practice presenting project updates',notes:'Prepare a short update and ask for feedback.',due:at(14),progress:'in_progress',revision:0});
 audit(s,s.people[0],'synthetic.seeded',syntheticCompany);return s;
}
