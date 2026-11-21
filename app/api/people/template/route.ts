import { NextRequest, NextResponse } from 'next/server';
import { requestActor, failure } from '@/server/http';
import { transaction } from '@/server/db';
import { checkSessionInTransaction } from '@/server/session';
import { member, hr } from '@/server/policy';
export const runtime='nodejs';
export async function GET(request:NextRequest) {
 try {
  const actor=await requestActor(request);
  await transaction(actor.companyId,async(s,db)=>{await checkSessionInTransaction(actor,db,s);hr(member(s,actor.personId));});
  return new NextResponse('email,full_name,team,title,manager_email,role,active\n',{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="reflect-people-template.csv"','Cache-Control':'no-store'}});
 }catch(error){return failure(error);}
}
