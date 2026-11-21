import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { digest } from '@/server/session';
import { requireThat } from '@/server/model';
import { runOutbox,configuredMail } from '@/server/notifications';
import { response,failure } from '@/server/http';
export const runtime='nodejs';
// Protected trigger for an external scheduler (cron). Accepts the platform-generated SCHEDULER_SECRET
// or an operator-chosen CRON_SECRET (32+ characters) that can be shared with the cron service.
const matches=(key:string|undefined,header:string)=>!!key&&key.length>=24&&timingSafeEqual(Buffer.from(digest(`Bearer ${key}`)),Buffer.from(digest(header)));
export async function POST(r:NextRequest){try{const header=r.headers.get('authorization')||'';const cron=process.env.CRON_SECRET&&process.env.CRON_SECRET.length>=32?process.env.CRON_SECRET:undefined;requireThat(matches(process.env.SCHEDULER_SECRET,header)||matches(cron,header),'FORBIDDEN',403);return response(await runOutbox(configuredMail()));}catch(e){return failure(e);}}
