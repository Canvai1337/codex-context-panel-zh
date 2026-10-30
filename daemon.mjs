import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SessionStore} from './data.mjs';
import {CDP,targets} from './cdp.mjs';
import {AccountClient,normalizeQuota} from './account.mjs';
import {LocalUsage} from './usage.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.argv[process.argv.indexOf('--port')+1]);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('必须提供有效端口');
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
const stateDir=process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'CodexContextPanel'):path.join(here,'runtime');
await fs.mkdir(stateDir,{recursive:true});
let stopping=false,lastReady=Date.now(),warmAt=0,warming=false;
function warm(){if(warming||Date.now()-warmAt<10000)return;warming=true;warmAt=Date.now();store.prewarm().catch(()=>{}).finally(()=>{warming=false;});}
async function state(value){const tmp=path.join(stateDir,`status-${process.pid}.tmp`);await fs.writeFile(tmp,JSON.stringify({version:'1.5.0',pid:process.pid,port,updatedAt:new Date().toISOString(),...value}));await fs.rename(tmp,path.join(stateDir,'status.json'));}
async function tick(){
  refreshGlobal();
  warm();
  let list;try{list=await targets(port);}catch{list=[];}
  const ids=new Set(list.map(t=>t.id));
  for(const [id,c]of connections)if(!ids.has(id)||c.closed){c.close();connections.delete(id);}
  await Promise.all(list.map(async target=>{
    let c=connections.get(target.id);
    try{
      if(!c){c=await new CDP(target).open();connections.set(target.id,c);}
      const cached=[...store.reports.values()].map(data=>({...data,quota,activity:usage.view}));
      await c.evaluate(`if(window.__BOSS_CONTEXT_PANEL__?.version!=='1.5.0')window.__BOSS_CONTEXT_PANEL_SEED__=${JSON.stringify(cached)};\n${widget}`);
      const threadId=await c.evaluate('window.__BOSS_CONTEXT_PANEL__?.select()||null');
      const data={...await store.get(threadId),quota,activity:usage.view};
      const batch=[...cached.filter(d=>d.threadId!==threadId),data];
      await c.evaluate(`window.__BOSS_CONTEXT_PANEL__?.updateBatch(${JSON.stringify(batch)})`);
      lastReady=Date.now();
    }catch{c?.close();connections.delete(target.id);}
  }));
  await state({phase:connections.size?'connected':'waiting',windows:connections.size,cachedThreads:store.reports.size,quotaStatus:quota.status,quotaFetchedAt:quota.fetchedAt,usageStatus:usage.view.status,tokenUpdatedAt:usage.view.updatedAt});
}
for(const event of ['SIGTERM','SIGINT'])process.on(event,()=>{stopping=true;for(const c of connections.values())c.close();});
while(!stopping){try{await tick();}catch{}if(Date.now()-lastReady>180000)break;await new Promise(r=>setTimeout(r,2000));}
account?.close();await state({phase:'stopped',windows:0});
