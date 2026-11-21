import { NextRequest } from 'next/server';
import { operation } from '@/server/service';
import { body,csrf,failure,requestActor,response } from '@/server/http';
export const runtime='nodejs';
export async function GET(r:NextRequest){try{return response(await operation(await requestActor(r),'workspace',{}));}catch(e){return failure(e);}}
export async function POST(r:NextRequest){try{csrf(r);const data=await body(r);return response(await operation(await requestActor(r),String(data.command),data));}catch(e){return failure(e);}}
