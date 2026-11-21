import { NextRequest } from 'next/server';
import { login,setup,recover,redeem,logout,invite } from '@/server/auth';
import { body,csrf,failure,requestActor,response,sessionResponse } from '@/server/http';
import { AppError } from '@/server/model';
export const runtime='nodejs';
export async function POST(r:NextRequest,{params}:{params:Promise<{action:string}>}){try{csrf(r);const data=await body(r);const {action}=await params;switch(action){case 'login':return sessionResponse(await login(data));case 'setup':return sessionResponse(await setup(data));case 'redeem':return sessionResponse(await redeem(data));case 'recover':return response(await recover(data));case 'invite':return response(await invite(await requestActor(r),data));case 'logout':await logout(await requestActor(r));const out=response({ok:true});out.cookies.delete('lattice_session');return out;default:throw new AppError('NOT_FOUND',404);}}catch(e){return failure(e);}}
