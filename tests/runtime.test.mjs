import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {runtimeOptions,portFromFile,acquireRuntime} from '../runtime.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function exit(child,timeout=5000){if(child.exitCode!==null)return child.exitCode;return Promise.race([new Promise(r=>child.once('exit',r)),wait(timeout).then(()=>{throw Error('child exit timeout');})]);}
test('runtime validates arguments and the Chromium port-file format',async()=>{
 assert.equal(runtimeOptions(['--port','9340']).port,9340);
 assert.throws(()=>runtimeOptions(['--port','0']));assert.throws(()=>runtimeOptions(['--owner-pid','-1','--port','9340']));assert.throws(()=>runtimeOptions(['--unknown','x']));assert.throws(()=>runtimeOptions([]));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'panel-port-'));try{
  const file=path.join(dir,'port');await fs.writeFile(file,'12345\n/devtools/browser/fixture-123\n');assert.equal(await portFromFile(file),12345);
  for(const bad of ['12345\nhttps://remote.example/','0\n/devtools/browser/x','65536\n/devtools/browser/x','9'.repeat(9000)]){await fs.writeFile(file,bad);assert.equal(await portFromFile(file),null);}
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('a state directory has one service, and the service exits with its owner',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'panel-owner-'));let owner,daemon,duplicate;
 try{
  const state=path.join(dir,'state');const lease=await acquireRuntime(state);assert(lease);assert.equal(await acquireRuntime(state),null);await lease.close();
  owner=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  const args=[path.resolve('daemon.mjs'),'--owner-pid',String(owner.pid),'--port-file',path.join(dir,'not-created-yet')];
  const env={...process.env,CODEX_PANEL_STATE_DIR:state,CODEX_PANEL_DISABLE_ACCOUNT:'1',CODEX_HOME:path.join(dir,'data')};
  daemon=spawn(process.execPath,args,{env,windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';daemon.stderr.on('data',b=>stderr+=b);
  let status;for(let i=0;i<40;i++){try{status=JSON.parse(await fs.readFile(path.join(state,'status.json'),'utf8'));}catch{}if(status?.phase==='starting')break;await wait(50);}assert.equal(status?.phase,'starting');
  duplicate=spawn(process.execPath,args,{env,windowsHide:true,stdio:'ignore'});assert.equal(await exit(duplicate),0);
  owner.kill();await exit(owner);assert.equal(await exit(daemon),0);assert.equal(stderr,'');
  assert.equal(JSON.parse(await fs.readFile(path.join(state,'status.json'),'utf8')).phase,'stopped');
 }finally{for(const child of [duplicate,daemon,owner])if(child&&child.exitCode===null)child.kill();await fs.rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
