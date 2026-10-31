import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const percent=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100?v:null;
export function normalizeQuota(response,now=Date.now()){
  const buckets=response?.limits?.rateLimitsByLimitId,legacy=response?.limits?.rateLimits;
  const bucket=buckets&&typeof buckets==='object'?buckets.codex:legacy&&(!legacy.limitId||legacy.limitId==='codex')?legacy:null;
  const windows=[bucket?.primary,bucket?.secondary].filter(Boolean);
  const take=minutes=>{const w=windows.find(w=>w.windowDurationMins===minutes);if(!w)return null;return {usedPercent:percent(w.usedPercent),resetsAt:Number.isSafeInteger(w.resetsAt)&&w.resetsAt>0?w.resetsAt:null,windowDurationMins:minutes};};
  return {status:bucket?'ready':'unavailable',fiveHour:take(300),weekly:take(10080),fetchedAt:now};
}
// A separate, read-only client of Codex's official local app-server protocol.
// It never starts a turn, reads credential contents, or consumes a reset.
export class AccountClient {
  constructor(command){this.command=command;this.child=null;this.pending=new Map();this.seq=0;}
  rejectAll(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('额度服务已断开'));}this.pending.clear();}
  async open(){
    if(this.child&&this.child.exitCode===null)return;
    const child=spawn(this.command,['app-server','--listen','stdio://'],{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});this.child=child;
    child.stderr.resume();child.stdin.on('error',()=>{if(this.child===child)this.rejectAll();});
    child.on('error',()=>{if(this.child===child){this.rejectAll();this.child=null;}});
    child.on('exit',()=>{if(this.child===child){this.rejectAll();this.child=null;}});
    createInterface({input:child.stdout,crlfDelay:Infinity}).on('line',line=>{let msg;try{msg=JSON.parse(line);}catch{return;}const p=this.pending.get(msg.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(msg.id);msg.error?p.reject(Error('额度接口未返回数据')):p.resolve(msg.result);});
    await this.call('initialize',{clientInfo:{name:'codex-context-panel',title:'Codex 中文上下文面板',version:'1.6.3'},capabilities:{optOutNotificationMethods:[]}});
    child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  }
  call(method,params){
    if(!['initialize','account/rateLimits/read','account/usage/read'].includes(method))return Promise.reject(Error('未允许的操作'));
    return new Promise((resolve,reject)=>{if(!this.child?.stdin?.writable)return reject(Error('额度服务未连接'));const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('额度查询超时'));},12000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,...params===undefined?{}:{params}})+'\n');});
  }
  async read(){
    // Metadata only: a changed login file invalidates this read-only connection.
    let revision=null;try{const s=await fs.stat(path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'auth.json'));revision=s.mtimeMs+':'+s.size;}catch{}
    if(this.revision!==undefined&&this.revision!==revision)this.close();this.revision=revision;
    await this.open();const limits=await this.call('account/rateLimits/read');return {limits};
  }
  close(){this.rejectAll();this.child?.stdin.end();this.child?.kill();this.child=null;}
}
