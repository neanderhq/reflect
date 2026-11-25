import { eq } from 'drizzle-orm';
import * as schema from './schema';
import { type State } from './model';
import type { Database } from './db';
export const exportFormat='lattice-company-export';
export type CompanyExport={format:typeof exportFormat;version:1;exportedAt:string;company:{id:string;name:string};counts:Record<string,number>;data:Record<string,unknown[]>};
// Keep the HR backup format explicit: participant-only advice is outside it.
const recoveryCollections = [
 'people','templates','cycles','assignments','nominations','summaries','packets',
 'acknowledgments','goals','actions','audits','notices',
] as const satisfies readonly (keyof State)[];
// Password hashes, sessions and invite/reset tokens are never exported.
export function buildExport(state:State,company:{id:string;name:string}):CompanyExport{
 const data:Record<string,unknown[]>={};
 for(const key of recoveryCollections){const rows=structuredClone(state[key]) as unknown[];data[key]=key==='people'?(rows as {passwordHash?:string}[]).map(({passwordHash:_hash,...person})=>person):rows;}
 return {format:exportFormat,version:1,exportedAt:new Date().toISOString(),company,counts:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])),data};
}
// Restores into a database that does not contain the company yet. Restored people have no password and must use "Forgot password".
export async function restoreExport(db:Database,dump:CompanyExport){
 if(dump?.format!==exportFormat||dump.version!==1)throw new Error('NOT_A_LATTICE_EXPORT');
 return db.transaction(async raw=>{
  const tx=raw as unknown as Database;
  const existing=await tx.select().from(schema.companies).where(eq(schema.companies.id,dump.company.id));
  if(existing.length)throw new Error('COMPANY_EXISTS');
  await tx.insert(schema.companies).values({id:dump.company.id,name:dump.company.name||dump.company.id});
  const counts:Record<string,number>={};
  for(const key of recoveryCollections){
   const rows=(dump.data[key]||[]) as {id:string;authVersion?:number}[];
   for(const row of rows){const data=key==='people'?{...row,passwordHash:'',authVersion:(row.authVersion||0)+1}:row;await tx.insert(schema.tables[key]).values({companyId:dump.company.id,id:row.id,data} as never);}
   counts[key]=rows.length;
  }
  return counts;
 });
}
