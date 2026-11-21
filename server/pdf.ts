import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import type { ReportRow } from './reports';
// Reflect performance report. Each cycle/team/type block is kept together on one page,
// continuation pages repeat a short header, and every page has a numbered footer.
export async function reportPdf(rows:ReportRow[]) {
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const W=595,H=842,M=48,TOP=790,BOTTOM=70,ink=rgb(.12,.16,.22),muted=rgb(.42,.45,.5);
 const safe=(v:string)=>v.normalize('NFKD').replace(/[^\x20-\x7E]/g,'?');
 const wrap=(value:string,size:number,f=font)=>{const out:string[]=[];let cur='';for(const w of safe(value).split(' ')){const next=cur?`${cur} ${w}`:w;if(f.widthOfTextAtSize(next,size)>W-2*M&&cur){out.push(cur);cur=w;}else cur=next;}if(cur)out.push(cur);return out;};
 let page:PDFPage=doc.addPage([W,H]),y=TOP;
 const text=(v:string,size:number,f=font,color=ink)=>{page.drawText(v,{x:M,y,size,font:f,color});};
 const continuation=()=>{page=doc.addPage([W,H]);y=TOP;text('Reflect | Performance report (continued)',10,bold,muted);y-=24;};
 text('Reflect | Performance report',16,bold);y-=24;
 for(const l of wrap('Submitted, nonblank ratings only. Cohorts below each cycle privacy threshold are suppressed.',10)){text(l,10,font,muted);y-=15;}
 y-=12;
 for(const r of rows){
  const title=wrap(`${r.cycle} / ${r.team} / ${r.type}`,12,bold),body=[...wrap(`Assigned: ${r.assigned??'Suppressed'} | Submitted: ${r.submitted??'Suppressed'} | Overdue: ${r.overdue??'Suppressed'}`,10),...wrap(`Average: ${r.average??'Suppressed'} / 5 | Rating count: ${r.ratingCount??'Suppressed'}`,10)];
  const height=title.length*18+body.length*15+16;
  if(y-height<BOTTOM)continuation();
  for(const l of title){text(l,12,bold);y-=18;}
  for(const l of body){text(l,10);y-=15;}
  page.drawLine({start:{x:M,y:y+6},end:{x:W-M,y:y+6},thickness:.5,color:rgb(.85,.87,.9)});y-=16;
 }
 const total=doc.getPageCount();
 for(const [i,p] of doc.getPages().entries())p.drawText(`Reflect | Page ${i+1} of ${total}`,{x:M,y:36,size:9,font,color:muted});
 return doc.save();
}
