import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const root='.next/standalone';
assert.ok(existsSync(join(root,'server.js')),'Build standalone output before this check');
function inspect(folder){
 for(const item of readdirSync(folder,{withFileTypes:true})){
  assert.ok(!['.pglite','.test-data','.env','.env.local','.env.production','.env.development'].includes(item.name),`Forbidden local artifact in standalone output: ${item.name}`);
  if(item.isDirectory())inspect(join(folder,item.name));
 }
}
inspect(root);
console.log('PASS: standalone server exists; no synthetic databases, test backups or local environment files in packaged output.');
