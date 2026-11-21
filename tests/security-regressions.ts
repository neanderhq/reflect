import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { NextRequest } from 'next/server';
import * as schema from '../server/schema';
import { type Database, setTestDb, persistState, loadState } from '../server/db';
import { emptyState, reviewTypes, type Person, type Cycle } from '../server/model';
import { generate, enqueue } from '../server/service';
import { workspace } from '../server/policy';
import { passwordHash, verifyPassword, newSession } from '../server/session';
import { GET as getWorkspace, POST as postWorkspace } from '../app/api/workspace/route';
import { GET as getExport } from '../app/api/export/route';

// No server or email provider is started. Every record belongs to this disposable fixture.
async function main() {
await mkdir('.test-data', { recursive:true });
const folder=await mkdtemp(join(process.cwd(),'.test-data/security-'));
let client=new PGlite(join(folder,'postgres'));
const embedded=drizzle(client,{schema});
const db=embedded as unknown as Database;
setTestDb(db);
process.env.APP_ORIGIN='http://127.0.0.1:3000';
const company='security-fixture',otherCompany='isolation-fixture';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
try {
  const initial=join(folder,'initial');await mkdir(join(initial,'meta'),{recursive:true});
  const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));
  await writeFile(join(initial,'meta/_journal.json'),JSON.stringify({...journal,entries:journal.entries.slice(0,1)}));
  await cp('drizzle/0000_careful_saracen.sql',join(initial,'0000_careful_saracen.sql'));
  await migrate(embedded,{migrationsFolder:initial});
  await db.insert(schema.companies).values([{id:company,name:'Synthetic company'},{id:otherCompany,name:'Isolation company'}]);
  const s=emptyState();
  function person(id:string,role:Person['role']='employee',managerId:string|null=null):Person {
    return {id,name:id,email:`${id}@example.test`,role,managerId,team:'Engineering',title:'Synthetic role',active:true,passwordHash:'private-hash',authVersion:3};
  }
  const hr=person('hr','hr_admin'),manager=person('manager','manager'),employee=person('employee','employee','manager');
  const former=person('former-report','employee','other-manager');
  const newReport=person('new-report','employee','manager');
  const peer=person('peer'),inactive={...person('inactive'),active:false};
  s.people=[hr,manager,employee,former,newReport,peer,inactive,person('other-manager','manager'),person('outsider')];
  const c:Cycle={id:'cycle',name:'Synthetic cycle',status:'open',start:'2020-01-01T00:00:00.000Z',nominationDue:'2099-01-01T00:00:00.000Z',reviewDue:'2099-02-01T00:00:00.000Z',releaseDate:'2099-03-01T00:00:00.000Z',revision:0,
    roster:[hr,manager,employee,former,peer,inactive].map(p=>({id:p.id,name:p.name,team:p.team,role:p.role,managerId:p.id===former.id?manager.id:p.managerId})),
    templates:reviewTypes.map(type=>({id:`template-${type}`,family:type,name:type,version:1,role:'all',type,questions:[{id:'rating',text:'Rating',kind:'rating',required:false}]})),
    policy:{self:{include:true,disclose:true},manager:{include:true,disclose:true},peer:{include:true,disclose:false},upward:{include:true,disclose:false}}};
  s.cycles.push(c);
  const legacyId='cycle:peer:peer:employee';
  s.assignments.push({id:legacyId,cycleId:c.id,type:'peer',authorId:peer.id,subjectId:employee.id,questions:c.templates[0].questions,answers:{rating:4},status:'draft',revision:0});
  s.notices.push({id:'legacy-notice',recipientId:peer.id,kind:'assignment',key:`assignment:${legacyId}`,href:`/?view=reviews&review=${encodeURIComponent(legacyId)}`,assignmentId:legacyId,cycleId:c.id,status:'pending',attempts:0,nextAttempt:new Date().toISOString(),read:false});
  s.notices.push({...s.notices[0],id:'legacy-reminder',kind:'reminder',key:`reminder:${legacyId}:${c.reviewDue}`,due:c.reviewDue});
  await persistState(db,company,emptyState(),s);
  const isolated=emptyState();isolated.people=[person('isolation-employee')];await persistState(db,otherCompany,emptyState(),isolated);
  await migrate(embedded,{migrationsFolder:'drizzle'});
  await migrate(embedded,{migrationsFolder:'drizzle'});
  const migrated=await loadState(db,company),assignment=migrated.assignments[0];
  assert.match(assignment.id,uuid);assert.notEqual(assignment.id,legacyId);
  assert.deepEqual(assignment.answers,{rating:4});
  assert.equal(migrated.notices[0].assignmentId,assignment.id);
  assert.equal(migrated.notices[0].href,`/?view=reviews&review=${assignment.id}`);
  assert.equal(migrated.notices[1].key,`reminder:${assignment.id}:${c.reviewDue}`);
  enqueue(migrated,peer.id,'reminder',`reminder:${assignment.id}:${c.reviewDue}`,`/?view=reviews&review=${assignment.id}`);
  assert.equal(migrated.notices.length,2);
  console.log('PASS: migrations preserve legacy answers, notification links and reminder deduplication; repeat migration is safe');

  const before=structuredClone(migrated);generate(migrated,hr,c);const count=migrated.assignments.length;generate(migrated,hr,c);
  assert.equal(migrated.assignments.length,count);assert.ok(migrated.assignments.every(a=>uuid.test(a.id)));
  await persistState(db,company,before,migrated);
  const mismatchedId=randomUUID();
  await assert.rejects(db.insert(schema.assignments).values({companyId:company,id:mismatchedId,data:{...assignment,id:randomUUID(),authorId:'outsider'}}));
  const duplicateId=randomUUID();
  await assert.rejects(db.insert(schema.assignments).values({companyId:company,id:duplicateId,data:{...assignment,id:duplicateId}}));
  const badId='cycle:peer:outsider:employee';
  await assert.rejects(db.insert(schema.assignments).values({companyId:company,id:badId,data:{...assignment,id:badId,authorId:'outsider'}}));
  console.log('PASS: generation is opaque and idempotent; database rejects duplicate assignment tuples and composite IDs');

  const employeeView=workspace(migrated,employee),managerView=workspace(migrated,manager),hrView=workspace(migrated,hr);
  assert.deepEqual(employeeView.people.map(p=>p.id),['employee']);
  assert.deepEqual(managerView.people.map(p=>p.id).sort(),['employee','manager']);
  assert.equal(hrView.people.length,s.people.length);
  assert.ok(!JSON.stringify([employeeView,managerView,hrView]).includes('private-hash'));
  assert.ok(!hrView.people.some(p=>'authVersion' in p));
  assert.deepEqual(Object.keys(managerView.people.find(p=>p.id==='employee')!).sort(),['active','id','managerId','name','team','title']);
  assert.ok(!employeeView.relatedPeople.some(p=>p.id==='outsider'));
  assert.ok(employeeView.nominationChoices[0].people.some(p=>p.id==='peer'));
  assert.ok(!employeeView.nominationChoices[0].people.some(p=>['inactive','outsider','employee'].includes(p.id)));
  assert.ok(employeeView.nominationChoices[0].people.every(p=>Object.keys(p).sort().join(',')==='id,name'));
  assert.ok(employeeView.relatedPeople.every(p=>Object.keys(p).sort().join(',')==='id,name'));
  const managerProgress=managerView.assignments.find(a=>a.id===assignment.id)!;
  assert.ok(!('authorId' in managerProgress)&&!('answers' in managerProgress)&&!('questions' in managerProgress));
  assert.match(managerProgress.id,uuid);
  assert.ok(!('answers' in hrView.assignments.find(a=>a.id===assignment.id)!));
  assert.equal(hrView.submittedFeedback.length,0);
  assert.ok(!employeeView.assignments.some(a=>a.id===assignment.id));
  const closed=structuredClone(migrated);closed.cycles[0].status='closed';assert.equal(workspace(closed,employee).nominationChoices.length,0);
  const expired=structuredClone(migrated);expired.cycles[0].nominationDue='2000-01-01T00:00:00.000Z';assert.equal(workspace(expired,employee).nominationChoices.length,0);
  console.log('PASS: role projections, historical/current manager intersection, minimal nomination choices and hidden progress identity');

  const employeeCookie=await newSession(db,{companyId:company,personId:employee.id},employee.authVersion);
  const managerCookie=await newSession(db,{companyId:company,personId:manager.id},manager.authVersion);
  const otherCookie=await newSession(db,{companyId:otherCompany,personId:'isolation-employee'},3);
  function request(path:string,cookie?:string,input?:unknown) {
    return new NextRequest(`http://127.0.0.1:3000${path}`,{method:input?'POST':'GET',headers:{...(cookie?{cookie:`lattice_session=${cookie}`} : {}),origin:'http://127.0.0.1:3000','x-lattice-request':'1',...(input?{'content-type':'application/json'}:{})},...(input?{body:JSON.stringify(input)}:{})});
  }
  assert.equal((await getWorkspace(request('/api/workspace'))).status,401);
  const response=await getWorkspace(request('/api/workspace',employeeCookie));assert.equal(response.status,200);
  const payload=await response.json();assert.deepEqual(payload.people.map((p:{id:string})=>p.id),['employee']);
  assert.ok(!JSON.stringify(payload).includes('private-hash'));
  assert.equal((await getExport(request('/api/export?format=csv',employeeCookie))).status,403);
  const managerResponse=await getWorkspace(request('/api/workspace',managerCookie));assert.equal(managerResponse.status,200);
  const managerPayload=await managerResponse.json();assert.ok(!JSON.stringify(managerPayload.assignments.find((a:{id:string})=>a.id===assignment.id)).includes('authorId'));
  const foreign=await getWorkspace(request('/api/workspace',otherCookie));assert.equal(foreign.status,200);
  const foreignPayload=await foreign.json();assert.deepEqual(foreignPayload.people.map((p:{id:string})=>p.id),['isolation-employee']);assert.equal(foreignPayload.assignments.length,0);
  assert.equal((await postWorkspace(request('/api/workspace',otherCookie,{command:'review.save',id:assignment.id,revision:0,answers:{rating:2}}))).status,404);
  assert.equal((await postWorkspace(request('/api/workspace',employeeCookie,{command:'review.save',id:assignment.id,revision:0,answers:{rating:2}}))).status,404);
  console.log('PASS: direct workspace/export handlers deny anonymous access, employee exports and cross-company/cross-author saves');

  const hash=await passwordHash('Synthetic-only-password');
  assert.equal(await verifyPassword('Synthetic-only-password',hash),true);
  assert.equal(await verifyPassword('Wrong-only-password',hash),false);
  assert.equal(await verifyPassword('Synthetic-only-password',''),false);
  console.log('PASS: recovered scrypt session helper verifies correct passwords and rejects invalid credentials');
  await client.close();client=new PGlite(join(folder,'postgres'));
  const restored=await loadState(drizzle(client,{schema}) as unknown as Database,company);
  assert.equal(restored.assignments.length,count);assert.deepEqual(restored.assignments.find(a=>a.id===assignment.id)?.answers,{rating:4});
  console.log('PASS: migrated IDs and answers survive closing and reopening the embedded database');
} finally {
  await client.close();await rm(folder,{recursive:true,force:true});
}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
