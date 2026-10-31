import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {fixtureHTML,ID,ID2} from '../fixture.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await wait(200);}throw Error('等待验证结果超时');}
test('daemon end-to-end: local CDP, selected log, switching, renderer replacement',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ctx-bridge-'));let context,daemon,successor,server,firstOwner,nextOwner;
 try{
  const dataHome=path.join(dir,'data');await fs.mkdir(path.join(dataHome,'sessions'),{recursive:true});
  const record=(type,payload)=>JSON.stringify({type,payload,timestamp:'2026-10-30T02:00:00Z'})+'\n';
  const file=path.join(dataHome,'sessions',`rollout-${ID}.jsonl`);
  const usage=n=>record('event_msg',{type:'token_count',info:{last_token_usage:{input_tokens:n,output_tokens:0,total_tokens:n},model_context_window:1000}});
  await fs.writeFile(file,record('session_meta',{id:ID})+record('response_item',{type:'message',role:'user',content:[{text:'测试消息'}]})+usage(100));
  await fs.writeFile(path.join(dataHome,'sessions',`rollout-${ID2}.jsonl`),record('session_meta',{id:ID2})+usage(330));
  const profile=path.join(dir,'chrome');context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,args:['--remote-debugging-port=0']});
  const active=await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8');const realPort=Number(active.split('\n')[0]);
  // Chrome may publish its port file before the HTTP listener is ready.
  await until(async()=>{try{return (await fetch(`http://127.0.0.1:${realPort}/json/version`)).ok;}catch{return false;}});
  // Only the test metadata is mapped to the app URL. No production app is touched.
  server=http.createServer(async(req,res)=>{try{const list=await(await fetch(`http://127.0.0.1:${realPort}/json/list`)).json();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(list.filter(t=>t.type==='page').map(t=>({...t,url:'app://-/index.html'}))));}catch{res.writeHead(503);res.end('[]');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  let page=context.pages()[0];await page.setContent(fixtureHTML());
  const portFile=path.join(dir,'panel-port');
  const newOwner=()=>spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  const launch=owner=>spawn(process.execPath,[path.resolve(here,'../service.mjs'),'--port-file',portFile,'--owner-pid',String(owner.pid)],{env:{...process.env,CODEX_HOME:dataHome,CODEX_PANEL_DISABLE_ACCOUNT:'1',CODEX_PANEL_STATE_DIR:path.join(dir,'local','CodexContextPanel'),LOCALAPPDATA:path.join(dir,'local')},stdio:'pipe',windowsHide:true});
  firstOwner=newOwner();daemon=launch(firstOwner);
  let stderr='';daemon.stderr.on('data',b=>stderr+=b.toString());
  const pill=()=>page.locator('#boss-context-panel .pill').textContent().catch(()=>null);
  await until(async()=>{try{return JSON.parse(await fs.readFile(path.join(dir,'local','CodexContextPanel','status.json'),'utf8')).phase==='starting';}catch{return false;}});
  await fs.writeFile(portFile,`${port}\n/devtools/browser/fixture\n`);
  await until(async()=>String(await pill()).includes('10.0%'));assert.equal(stderr,'');
  await fs.appendFile(file,usage(220));await until(async()=>String(await pill()).includes('22.0%'));
  await fs.appendFile(file,record('event_msg',{type:'task_started'})+usage(440));await wait(2600);assert.equal(await pill(),'22.0%');
  await fs.appendFile(file,record('event_msg',{type:'task_complete'}));await until(async()=>String(await pill()).includes('44.0%'));
  await page.evaluate(id=>document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id),ID2);
  assert.equal(await pill(),'33.0%');
  // A crashed background must be restarted and reinject the missing widget.
  const stateDir=path.join(dir,'local','CodexContextPanel');
  const first=JSON.parse(await fs.readFile(path.join(stateDir,'status.json'),'utf8'));
  await page.evaluate(()=>window.__BOSS_CONTEXT_PANEL__.dispose());process.kill(first.pid);
  await until(async()=>{try{return JSON.parse(await fs.readFile(path.join(stateDir,'status.json'),'utf8')).pid!==first.pid&&String(await pill()).includes('33.0%');}catch{return false;}});
  await page.close();page=await context.newPage();await page.setContent(fixtureHTML());
  await until(async()=>String(await pill()).includes('44.0%'));
  // Rapid reopen must hand the lease to the new owner and continue refreshing.
  nextOwner=newOwner();firstOwner.kill();successor=launch(nextOwner);successor.stderr.resume();
  await until(async()=>{try{const status=JSON.parse(await fs.readFile(path.join(stateDir,'status.json'),'utf8'));return status.ownerPid===nextOwner.pid&&status.phase==='connected';}catch{return false;}});
  await fs.appendFile(file,usage(550));await until(async()=>String(await pill()).includes('55.0%'));
  const status=JSON.parse(await fs.readFile(path.join(dir,'local','CodexContextPanel','status.json'),'utf8'));assert.equal(status.phase,'connected');assert.equal(status.ownerPid,nextOwner.pid);
 }finally{
  firstOwner?.kill();nextOwner?.kill();
  for(const child of [daemon,successor])if(child){await new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);setTimeout(()=>{child.kill();r();},4000);});}
  await context?.close();if(server)await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:200});
 }
});
