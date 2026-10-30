import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
export const TIME_ZONE='America/Los_Angeles';
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export function dayKey(time){return dayFormat.format(new Date(time));}
export function periodKeys(now=Date.now()){
  const today=dayKey(now),d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return {today,weekStart:d.toISOString().slice(0,10)};
}
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const usageTotal=u=>count(u?.total_tokens)??(count(u?.input_tokens)!==null&&count(u?.output_tokens)!==null?u.input_tokens+u.output_tokens:null);
const fingerprint=(thread,total,u,at)=>[thread,count(total?.total_tokens)??at,count(u?.input_tokens),count(u?.output_tokens),usageTotal(u)].join(':');

export class UsageFile {
  constructor(file){this.file=file;this.reset();}
  reset(){this.offset=0;this.carry=Buffer.alloc(0);this.id=null;this.events=new Map();this.identity=null;this.errors=0;}
  ingest(record){
    const p=record.payload||{};if(record.type==='session_meta'){this.id=p.id||p.session_id;return;}
    const canonical=record.type==='token_usage_record'&&typeof p.response_id==='string';
    const legacy=record.type==='event_msg'&&p.type==='token_count'&&p.info?.last_token_usage;
    if(!canonical&&!legacy)return;
    const u=canonical?p.usage:p.info.last_token_usage,total=canonical?p.thread_token_usage:p.info.total_token_usage;
    const tokens=usageTotal(u),at=Date.parse(record.timestamp);if(tokens===null||!Number.isFinite(at))return;
    const thread=canonical?(p.thread_id||this.id):this.id;if(!thread)return;
    const alias=fingerprint(thread,total,u,at),key=canonical?'response:'+p.response_id:'legacy:'+alias;
    if(!this.events.has(key))this.events.set(key,{canonical,alias,at,tokens});
  }
  async refresh(){
    const stat=await fs.stat(this.file),identity=stat.dev+':'+stat.ino;
    if((this.identity&&identity!==this.identity)||stat.size<this.offset)this.reset();this.identity=identity;
    if(stat.size===this.offset)return;
    const file=await fs.open(this.file,'r');try{
      const target=stat.size;
      while(this.offset<target){const chunk=Buffer.allocUnsafe(Math.min(256*1024,target-this.offset));const {bytesRead}=await file.read(chunk,0,chunk.length,this.offset);if(!bytesRead)break;this.offset+=bytesRead;
        const buf=Buffer.concat([this.carry,chunk.subarray(0,bytesRead)]);let start=0,end;
        while((end=buf.indexOf(10,start))!==-1){const line=buf.subarray(start,end);start=end+1;
          // Only deserialize counter/meta records, never transcript/tool content.
          if(!line.includes(Buffer.from('"session_meta"'))&&!line.includes(Buffer.from('"token_count"'))&&!line.includes(Buffer.from('"token_usage_record"')))continue;
          let record;try{record=JSON.parse(line.toString('utf8'));}catch{this.errors++;continue;}this.ingest(record);
        }
        this.carry=Buffer.from(buf.subarray(start));if(this.carry.length>32*1024*1024)throw Error('日志记录超限');
      }
    }finally{await file.close();}
  }
}

export function summarizeUsage(files,now=Date.now()){
  const keys=periodKeys(now),canonical=new Map(),fallback=new Map(),aliases=new Set();
  for(const file of files)for(const [key,e]of file.events){if(e.canonical){if(!canonical.has(key))canonical.set(key,e);aliases.add(e.alias);}else if(!fallback.has(e.alias))fallback.set(e.alias,e);}
  let todayTokens=0,weekTokens=0,requests=0;
  for(const e of [...canonical.values(),...[...fallback].filter(([alias])=>!aliases.has(alias)).map(([,e])=>e)]){
    if(e.at>now)continue;const day=dayKey(e.at);if(day<keys.weekStart||day>keys.today)continue;requests++;weekTokens+=e.tokens;if(day===keys.today)todayTokens+=e.tokens;
  }
  return {status:'ready',todayTokens,weekTokens,...keys,timeZone:TIME_ZONE,scope:'local_all_sessions',requests,updatedAt:now};
}

export class LocalUsage {
  constructor(home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')){this.home=home;this.files=new Map();this.view={status:'loading',todayTokens:null,weekTokens:null,...periodKeys(),timeZone:TIME_ZONE,scope:'local_all_sessions'};}
  async refresh(now=Date.now()){
    let failures=0,found=0;const live=new Set(),cutoff=Date.parse(periodKeys(now).weekStart+'T00:00:00Z')-24*3600000;
    for(const folder of ['sessions','archived_sessions']){
      const root=path.join(this.home,folder);let paths;try{paths=await fs.readdir(root,{recursive:true});}catch(e){if(e.code!=='ENOENT')failures++;continue;}
      for(const item of paths){if(!item.endsWith('.jsonl'))continue;const file=path.join(root,item);live.add(file);found++;
        try{const stat=await fs.stat(file);if(stat.mtimeMs<cutoff)continue;let reader=this.files.get(file);if(!reader){reader=new UsageFile(file);this.files.set(file,reader);}await reader.refresh();}catch{failures++;}
      }
    }
    for(const file of this.files.keys())if(!live.has(file))this.files.delete(file);
    this.view=found?{...summarizeUsage(this.files.values(),now),partial:failures>0||[...this.files.values()].some(f=>f.errors>0)}:{...this.view,status:'unavailable',todayTokens:null,weekTokens:null,updatedAt:now};
    return this.view;
  }
}
