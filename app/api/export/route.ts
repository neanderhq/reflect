import { NextRequest,NextResponse } from 'next/server';
import { requestActor,failure,response } from '@/server/http';
import { transaction } from '@/server/db';
import { checkSessionInTransaction } from '@/server/session';
import { member } from '@/server/policy';
import { reports,reportCsv } from '@/server/reports';
import { reportPdf } from '@/server/pdf';
import { audit } from '@/server/service';
export const runtime='nodejs';
export async function GET(r:NextRequest){try{const actor=await requestActor(r);const rows=await transaction(actor.companyId,async(s,db)=>{await checkSessionInTransaction(actor,db,s);const p=member(s,actor.personId);const rows=reports(s,p,{cycleId:r.nextUrl.searchParams.get('cycle')||undefined,team:r.nextUrl.searchParams.get('team')||undefined,search:r.nextUrl.searchParams.get('search')||undefined,type:r.nextUrl.searchParams.get('type')||undefined});audit(s,p,'report.accessed',actor.companyId);return rows;});const format=r.nextUrl.searchParams.get('format');if(format==='csv')return new NextResponse(reportCsv(rows),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="reflect-report.csv"','Cache-Control':'no-store'}});if(format==='pdf')return new NextResponse(Buffer.from(await reportPdf(rows)),{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="reflect-report.pdf"','Cache-Control':'no-store'}});return response(rows);}catch(e){return failure(e);}}
