import assert from 'node:assert/strict';
// This executable consumes a parent-started synthetic preview; it never starts/stops a server.
async function main(){
 const origin=process.env.PREVIEW_ORIGIN||'http://127.0.0.1:3000';const parsed=new URL(origin);
 assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname),'Only the local synthetic preview is authorized');
 const password='Lattice-demo-2026!';
 async function session(company:string,email:string,role:string){const r=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{origin,'Content-Type':'application/json','X-Lattice-Request':'1'},body:JSON.stringify({company,email,role,password})});assert.equal(r.status,200,`Login failed for ${role}`);const cookie=r.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);return cookie;}
 const hr=await session('lattice-synthetic','hr@lattice.test','hr_admin'),manager=await session('lattice-synthetic','manager@lattice.test','manager'),employee=await session('lattice-synthetic','alex@lattice.test','employee'),other=await session('isolation-synthetic','hr@isolation.test','hr_admin');
 {const r=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{origin,'Content-Type':'application/json','X-Lattice-Request':'1'},body:JSON.stringify({company:'lattice-synthetic',email:'alex@lattice.test',password})});assert.equal(r.status,200,'Role-free login must derive the account role');}
 async function request(path:string,cookie?:string,input?:unknown){return fetch(origin+path,{method:input?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(input?{origin,'Content-Type':'application/json','X-Lattice-Request':'1'}:{})},...(input?{body:JSON.stringify(input)}:{})});}
 assert.equal((await request('/api/health')).status,200);assert.equal((await request('/api/workspace')).status,401);
 const views=await Promise.all([hr,manager,employee,other].map(async cookie=>{const r=await request('/api/workspace',cookie);assert.equal(r.status,200);return r.json();}));
 assert.equal(views[2].people.length,1);assert.equal(views[3].people.length,1);assert.equal(views[3].assignments.length,0);
 assert.ok(!JSON.stringify(views).includes('passwordHash'));assert.ok(!JSON.stringify(views).includes('authVersion'));
 const own=views[2].assignments.find((a:any)=>a.status==='draft'&&a.type==='self');assert.ok(own);
 for(const v of [views[0],views[1],views[3]])assert.ok(!JSON.stringify(v).includes('Private synthetic draft:'));
 assert.equal((await request('/api/export?format=csv',employee)).status,403);assert.equal((await request('/api/export?format=pdf',employee)).status,403);
 for(const cookie of [hr,manager])for(const format of ['csv','pdf']){const r=await request(`/api/export?format=${format}`,cookie);assert.equal(r.status,200);assert.ok((await r.arrayBuffer()).byteLength>0);}
 assert.equal((await request('/api/workspace',other,{command:'review.save',id:own.id,revision:own.revision,answers:{}})).status,404);
 // A harmless save proves live cookies, CSRF, database writes and conflict response; preserve existing draft answers.
 const save=await request('/api/workspace',employee,{command:'review.save',id:own.id,revision:own.revision,answers:own.answers});assert.equal(save.status,200);
 const conflict=await request('/api/workspace',employee,{command:'review.save',id:own.id,revision:own.revision,answers:own.answers});assert.equal(conflict.status,409);
 assert.equal((await request('/api/people/template',hr)).status,200);assert.equal((await request('/api/people/template',employee)).status,403);
 assert.equal((await request('/api/jobs',undefined,{})).status,403);
 for(const cookie of [hr,manager,employee,other])assert.equal((await request('/api/auth/logout',cookie,{})).status,200);
 console.log('PASS: live HTTP synthetic HR/manager/employee login (role derived server-side), sessions, projections, drafts, tenant boundaries, exports, CSV template, save/conflict, job auth and logout');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'HTTP_CHECK_FAILED');process.exitCode=1;});
