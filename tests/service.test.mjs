import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {supervise} from '../service.mjs';
import {acquireRuntime,ownerAlive} from '../runtime.mjs';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<120;i++){if(await fn())return;await wait(50);}throw Error('supervisor verification timed out');}

for(const mode of ['hang','crash'])test(`supervisor recovers a ${mode}, keeps one instance and exits with owner`,async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'panel-service-'));
  const owner=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  const marker=path.join(dir,'attempt'),statusFile=path.join(dir,'service-status.json');let running;
  const status=async()=>{try{return JSON.parse(await fs.readFile(statusFile,'utf8'));}catch{return {};}};
  try{
    running=supervise({stateDir:dir,ownerPid:owner.pid,args:[marker,mode],workerFile:path.resolve('tests/service-worker.mjs'),heartbeatMs:700,pollMs:30,retryMs:20,maxRetryMs:50});
    await until(async()=>Number(await fs.readFile(marker,'utf8').catch(()=>0))>=2&&(await status()).workerPhase==='connected');
    assert.equal(await acquireRuntime(dir),null);
    const recovered=await status();assert.equal(recovered.restarts,1);assert(ownerAlive(owner.pid));
    if(mode==='hang')assert.equal(ownerAlive(Number(await fs.readFile(marker+'.child','utf8'))),false,'hung worker descendant must be removed');
    assert.match(await fs.readFile(path.join(dir,'service-error.log'),'utf8'),mode==='hang'?/heartbeat-timeout/:/worker-restart/);
    await wait(800);assert.equal((await status()).restarts,1,'healthy worker is not restarted');
    owner.kill();await running;assert.equal((await status()).phase,'stopped');assert.equal(ownerAlive(recovered.workerPid),false);
    const lease=await acquireRuntime(dir);assert(lease);await lease.close();
  }finally{owner.kill();await running;await fs.rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
