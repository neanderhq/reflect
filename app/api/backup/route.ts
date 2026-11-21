import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requestActor, failure } from '@/server/http';
import { transaction, getDb } from '@/server/db';
import { checkSessionInTransaction } from '@/server/session';
import { member, hr } from '@/server/policy';
import { audit } from '@/server/service';
import { companies } from '@/server/schema';
import { buildExport } from '@/server/backup';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// HR-only company recovery export (see docs/handover.md "Backup, export and recovery").
export async function GET(request:NextRequest) {
 try {
  const actor=await requestActor(request);
  const [company]=await getDb().select().from(companies).where(eq(companies.id,actor.companyId));
  const body=await transaction(actor.companyId,async(s,db)=>{
   await checkSessionInTransaction(actor,db,s);
   const p=member(s,actor.personId);hr(p);
   const result=buildExport(s,{id:actor.companyId,name:company?.name||''});
   audit(s,p,'backup.exported',actor.companyId);
   return result;
  });
  return new NextResponse(JSON.stringify(body,null,1),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="reflect-backup-${actor.companyId}-${body.exportedAt.slice(0,10)}.json"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 } catch(error){ return failure(error); }
}
