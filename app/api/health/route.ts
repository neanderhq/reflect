import { runtimeReadiness } from '../../../server/runtime-config';
export function GET() { return Response.json({ status: 'ok', runtime: runtimeReadiness() }, {headers:{'Cache-Control':'no-store'}}); }
