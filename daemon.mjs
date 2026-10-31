import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SessionStore} from './data.mjs';
import {CDP,targets} from './cdp.mjs';
import {AccountClient,normalizeQuota} from './account.mjs';
import {LocalUsage} from './usage.mjs';
import {runtimeOptions,ownerAlive,portFromFile,acquireRuntime,writeState,diagnostics,stateDirectory} from './runtime.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const options=runtimeOptions();let port=options.port;
const VERSION='1.6.3';
const stateDir=stateDirectory();
const supervised=process.env.CODEX_PANEL_SUPERVISED==='1'&&typeof process.send==='function';
const lease=supervised?null:await acquireRuntime(stateDir);if(!supervised&&!lease)process.exit(0);
const log=diagnostics(stateDir);
function heartbeat(phase){if(supervised&&process.connected)process.send({type:'heartbeat',phase});}
heartbeat('starting');
const widget=await fs.readFile(path.join(here,'widget.js'),'utf8');
const store=new SessionStore();const connections=new Map();
let config={};try{config=JSON.parse((await fs.readFile(path.join(here,'install-config.json'),'utf8')).replace(/^\uFEFF/,''));}catch{}
const account=process.env.CODEX_PANEL_DISABLE_ACCOUNT==='1'?null:new AccountClient(process.env.CODEX_PANEL_CLI||config.cliPath||'codex');
const usage=new LocalUsage();let quota={status:'loading',fiveHour:null,weekly:null,fetchedAt:null},quotaAt=0,usageAt=0,quotaPending=false,usagePending=false;
function refreshGlobal(){
  const now=Date.now(),expired=[quota.fiveHour,quota.weekly].some(w=>w?.resetsAt&&w.resetsAt*1000<=now);
  if(!quotaPending&&(!quotaAt||now-quotaAt>=60000||(expired&&now-quotaAt>=10000))){quotaPending=true;quotaAt=now;
    (account?account.read():Promise.resolve(null)).then(r=>{quota=normalizeQuota(r);}).catch(()=>{quota={status:'unavailable',fiveHour:null,weekly:null,fetchedAt:Date.now()};}).finally(()=>{quotaPending=false;});
  }
  if(!usagePending&&(!usageAt||now-usageAt>=10000)){usagePending=true;usageAt=now;usage.refresh().catch(()=>{usage.view={...usage.view,status:'unavailable',todayTokens:null,weekTokens:null};}).finally(()=>{usagePending=false;});}
}
let stopping=false,lastReady=Date.now(),warmAt=0,warming=false;const bootAt=Date.now();
function warm(){if(warming||Date.now()-warmAt<10000)return;warming=true;warmAt=Date.now();store.prewarm().catch(()=>{}).finally(()=>{warming=false;});}
async function state(value){await writeState(path.join(stateDir,'status.json'),{version:VERSION,pid:process.pid,supervisorPid:supervised?process.ppid:null,port,ownerPid:options.ownerPid,updatedAt:new Date().toISOString(),...value});heartbeat(value.phase);}
async function tick(){
  if(options.portFile&&!connections.size){
    const discovered=await portFromFile(options.portFile);
    if(discovered!==null&&discovered!==port){port=discovered;await writeState(path.join(stateDir,'runtime.json'),{version:VERSION,port,daemonPid:process.pid,ownerPid:options.ownerPid,installRoot:here,startedAt:new Date().toISOString()});}
  }
  if(port===null){
    port=await portFromFile(options.portFile);
    if(port===null){
      if(Date.now()-bootAt>10000)await log('port-file-wait',Error('接入端口文件不可用：'+options.portFile));
      await state({phase:'starting',windows:0,reason:'port-file-unavailable',portFile:options.portFile});return;
    }
    await writeState(path.join(stateDir,'runtime.json'),{version:VERSION,port,daemonPid:process.pid,ownerPid:options.ownerPid,installRoot:here,startedAt:new Date().toISOString()});
  }
  let list;try{list=await targets(port);}catch{list=[];}
  if(list.length){refreshGlobal();warm();}
  const ids=new Set(list.map(t=>t.id));
  for(const [id,c]of connections)if(!ids.has(id)||c.closed){c.close();connections.delete(id);}
  await Promise.all(list.map(async target=>{
    let c=connections.get(target.id);
    try{
      if(!c){c=await new CDP(target).open();connections.set(target.id,c);}
      let panel=await c.evaluate('({version:window.__BOSS_CONTEXT_PANEL__?.version,id:window.__BOSS_CONTEXT_PANEL__?.select()||null})');
      if(panel.version!==VERSION){
        const seed={threads:[...store.reports.values()],quota,activity:usage.view};
        await c.evaluate(`window.__BOSS_CONTEXT_PANEL_SEED__=${JSON.stringify(seed)};\n${widget}`);
        panel=await c.evaluate('({id:window.__BOSS_CONTEXT_PANEL__?.select()||null})');c.panelReports=new Map();c.panelGlobals=null;
      }
      const data=await store.get(panel.id);
      const reports=[...[...store.reports.values()].filter(d=>d.threadId!==panel.id),data].filter(d=>d.threadId);
      c.panelReports??=new Map();const changed=[];
      const liveReports=new Set(reports.map(d=>d.threadId));for(const id of c.panelReports.keys())if(!liveReports.has(id))c.panelReports.delete(id);
      for(const report of reports){const key=JSON.stringify(report);if(c.panelReports.get(report.threadId)!==key){changed.push(report);c.panelReports.set(report.threadId,key);}}
      const globalKey=JSON.stringify({quota,activity:usage.view}),globalChanged=globalKey!==c.panelGlobals;c.panelGlobals=globalKey;
      if(changed.length||globalChanged){
        const packet={threads:changed,...globalChanged?{quota,activity:usage.view}:{}};
        await c.evaluate(`window.__BOSS_CONTEXT_PANEL__?.updatePacket(${JSON.stringify(packet)})`);
      }else await c.evaluate('window.__BOSS_CONTEXT_PANEL__?.ping()');
      lastReady=Date.now();
    }catch(error){await log('window-connect',error);c?.close();connections.delete(target.id);}
  }));
  await state({phase:connections.size?'connected':'waiting',windows:connections.size,cachedThreads:store.reports.size,quotaStatus:quota.status,quotaFetchedAt:quota.fetchedAt,usageStatus:usage.view.status,tokenUpdatedAt:usage.view.updatedAt});
}
for(const event of ['SIGTERM','SIGINT'])process.on(event,()=>{stopping=true;for(const c of connections.values())c.close();});
if(supervised)process.on('disconnect',()=>{stopping=true;account?.close();for(const c of connections.values())c.close();});
let failures=0;
try{
  if(port!==null)await writeState(path.join(stateDir,'runtime.json'),{version:VERSION,port,daemonPid:process.pid,ownerPid:options.ownerPid,installRoot:here,startedAt:new Date().toISOString()});
  while(!stopping&&ownerAlive(options.ownerPid)){
    try{await tick();failures=0;}catch(error){await log('tick',error);if(++failures>=3)throw error;}
    if(options.ownerPid===null&&Date.now()-lastReady>180000)break;
    await new Promise(r=>setTimeout(r,port===null?150:1000));
  }
}finally{
  for(const c of connections.values())c.close();account?.close();try{await state({phase:'stopped',windows:0});}finally{await lease?.close();}
}
