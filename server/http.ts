import { NextRequest, NextResponse } from 'next/server';
import { AppError, requireThat } from './model';
import { actorFromToken } from './session';
import { appOrigin } from './runtime-config';
export function csrf(request:NextRequest) {
 const configured=appOrigin();
 const origin=request.headers.get('origin');const expected=process.env.APP_ORIGIN?configured:'http://127.0.0.1:3000';
 requireThat(origin===expected&&request.headers.get('x-lattice-request')==='1','CSRF_REJECTED',403);
}
export async function body(request:NextRequest){requireThat(Number(request.headers.get('content-length')||0)<=250000,'BODY_TOO_LARGE',413);const raw=await request.text();requireThat(Buffer.byteLength(raw)<=250000,'BODY_TOO_LARGE',413);let data;try{data=JSON.parse(raw);}catch{throw new AppError('INVALID_JSON');}requireThat(data&&typeof data==='object'&&!Array.isArray(data));return data as Record<string,unknown>;}
export const requestActor=(r:NextRequest)=>actorFromToken(r.cookies.get('lattice_session')?.value);
export const response=(data:unknown)=>NextResponse.json(data,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function failure(e:unknown){if(e instanceof AppError)return NextResponse.json({error:e.code,...(e.details?{details:e.details}:{})},{status:e.status,headers:{'Cache-Control':'no-store'}});console.error('lattice_request_failed',e instanceof Error?e.name:'unknown');return NextResponse.json({error:'SERVICE_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store'}});}
export function sessionResponse(value:string){const r=response({ok:true});r.cookies.set('lattice_session',value,{httpOnly:true,secure:appOrigin()?.startsWith('https://')||false,sameSite:'strict',path:'/',maxAge:8*3600});return r;}
