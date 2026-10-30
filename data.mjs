// Local, read-only telemetry. Classification follows the observable-byte method
// documented by androidZzT/context-window-inspector, with incremental reads.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';

export const CATEGORIES = [
  ['messages','消息与工具记录','#61a5fa'],
  ['system','系统提示与运行指令','#fbbf24'],
  ['tools','系统工具定义','#fb923c'],
  ['mcp','MCP 与动态工具定义','#2dd4bf'],
  ['skills','技能目录与指令','#a78bfa'],
  ['memory','记忆与项目指令','#94a3b8'],
  ['summary','压缩摘要','#f472b6'],
  ['other','其他可观察内容','#a3a3a3'],
];
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const serial = v => typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
const length = v => Buffer.byteLength(serial(v),'utf8');
const positive = v => Number.isFinite(v) && v >= 0 ? v : null;
function add(map,key,value) { const n=length(value); if(n)map.set(key,(map.get(key)||0)+n); }
function sumMaps(...maps) {const out=new Map();for(const map of maps)for(const [k,v]of map)out.set(k,(out.get(k)||0)+v);return out;}

export function splitInstructions(text, fallback='system') {
  const map=new Map(); let remaining=serial(text);
  const tags={skills_instructions:'skills',plugins_instructions:'mcp',apps_instructions:'mcp',mcp_server_instructions:'mcp',memory_files:'memory',tools:'tools',custom_agents:'system'};
  for(const [tag,key]of Object.entries(tags)) {
    remaining=remaining.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`,'g'),block=>{add(map,key,block);return '';});
  }
  add(map,fallback,remaining.trim());return map;
}

export class SessionScanner {
  constructor(file) {this.file=file;this.reset();}
  reset() {
    this.offset=0;this.carry=Buffer.alloc(0);this.base=new Map();this.history=new Map();this.definitions=new Map();
    this.instructions=new Map();this.latest=null;this.snapshot=new Map();this.model=null;this.window=null;
    this.sessionId=null;this.compactions=0;this.parseErrors=0;this.updatedAt=null;this.pendingCompaction=false;
    this.seenMeta=false;this.identity=null;this.snapshotModel=null;this.pendingModel=false;
  }
  response(p) {
    if(p.type==='message') {
      const text=Array.isArray(p.content)?p.content.filter(x=>typeof x?.text==='string').map(x=>x.text).join('\n'):serial(p.content);
      if(p.role==='system'||p.role==='developer') {
        const hash=createHash('sha256').update(text).digest('hex');
        this.instructions.set(hash,splitInstructions(text,text.trimStart().startsWith('# Tools')?'tools':'system'));
      } else if(/^# AGENTS\.md instructions/.test(text.trimStart())) {
        // Keep the latest project instruction block once, not once per replay.
        this.definitions.set('agents',new Map([['memory',length(text)]]));
      } else add(this.history,'messages',text);
    } else if(p.type==='additional_tools') {
      const map=new Map();
      for(const tool of p.tools||[])add(map,/^mcp|mcp__/i.test(tool.namespace||tool.name||'')?'mcp':'tools',tool);
      this.definitions.set('additional_tools',map);
    } else if(['function_call','custom_tool_call'].includes(p.type)) {
      add(this.history,'messages',serial({name:p.name,arguments:p.arguments??p.input}));
    } else if(['function_call_output','custom_tool_call_output'].includes(p.type)) {
      // Data-URL/base64 image payloads are not meaningful byte weights.
      add(this.history,'messages',serial(p.output).replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]+/g,'[图像：无法按文本归因]'));
    } else if(p.type==='reasoning') {
      // encrypted_content is opaque and must not dominate attribution.
      add(this.history,'messages',serial(p.summary)+serial(p.content));
    }
  }
  ingest(o) {
    const p=o.payload||{};
    if(o.type==='session_meta') {
      this.sessionId=String(p.id||p.session_id||'').toLowerCase();this.seenMeta=true;
      this.base=splitInstructions(p.base_instructions?.text||'');
      // Metadata capacity is only a fallback; token-count capacity takes priority.
      if(!this.window)this.window=positive(p.context_window);
    } else if(o.type==='turn_context') {
      this.model=p.model||this.model;
      if(this.latest&&this.snapshotModel&&this.snapshotModel!==this.model)this.pendingModel=true;
      if(p.user_instructions)this.definitions.set('user_instructions',new Map([['memory',length(p.user_instructions)]]));
      if(p.developer_instructions)this.definitions.set('developer_instructions',splitInstructions(p.developer_instructions));
    } else if(o.type==='response_item')this.response(p);
    else if(o.type==='compacted') {
      this.history=new Map();this.instructions.clear();this.compactions++;this.pendingCompaction=true;
      if(Array.isArray(p.replacement_history))for(const item of p.replacement_history)this.response(item);
      else add(this.history,'summary',p.message||p.summary||'');
    } else if(o.type==='event_msg'&&p.type==='token_count'&&p.info?.last_token_usage) {
      const u=p.info.last_token_usage;
      if(positive(u.input_tokens)===null)return;
      this.latest={input:u.input_tokens,output:positive(u.output_tokens),cached:positive(u.cached_input_tokens),
        total:positive(u.total_tokens)??u.input_tokens+(positive(u.output_tokens)||0)};
      const w=positive(p.info.model_context_window);if(w)this.window=w;
      this.total=positive(p.info.total_token_usage?.total_tokens);
      this.updatedAt=o.timestamp||null;this.pendingCompaction=false;this.pendingModel=false;this.snapshotModel=this.model;
      // Freeze attribution at the same event as exact usage, not at a later log tail.
      this.snapshot=sumMaps(this.base,this.history,...this.definitions.values(),...this.instructions.values());
    }
    // world_state contains internal hashes and runtime metadata. These are not
    // prompt text and are deliberately excluded from the byte denominator.
  }
  async refresh() {
    const stat=await fs.stat(this.file);
    const identity=`${stat.dev}:${stat.ino}`;
    if((this.identity&&identity!==this.identity)||stat.size<this.offset)this.reset();
    this.identity=identity;
    if(stat.size===this.offset)return;
    const file=await fs.open(this.file,'r');
    try {
      const target=stat.size;
      while(this.offset<target) {
        const count=Math.min(256*1024,target-this.offset);const chunk=Buffer.allocUnsafe(count);
        const {bytesRead}=await file.read(chunk,0,count,this.offset);if(!bytesRead)break;this.offset+=bytesRead;
        let buf=Buffer.concat([this.carry,chunk.subarray(0,bytesRead)]),start=0,end;
        while((end=buf.indexOf(10,start))!==-1) {
          const line=buf.subarray(start,end).toString('utf8').trim();start=end+1;if(!line)continue;
          let o;try{o=JSON.parse(line);}catch{this.parseErrors++;continue;}
          this.ingest(o);
        }
        this.carry=Buffer.from(buf.subarray(start));
        if(this.carry.length>32*1024*1024)throw new Error('单条日志超过读取上限');
      }
    }finally{await file.close();}
  }
  report(expectedId) {
    if(this.sessionId!==expectedId)return {status:'identity_mismatch',threadId:expectedId};
    const known=this.latest&&!this.pendingCompaction&&!this.pendingModel;
    const used=known?this.latest.total:null,window=positive(this.window);
    const bytes=[...this.snapshot.values()].reduce((a,b)=>a+b,0);
    const rows=CATEGORIES.map(([key,label,color])=>({key,label,color,observable:this.snapshot.has(key),bytes:this.snapshot.get(key)||0,tokens:null}));
    if(known&&bytes) {
      const raw=rows.map(r=>used*r.bytes/bytes);rows.forEach((r,i)=>r.tokens=r.observable?Math.floor(raw[i]):null);
      const missing=used-rows.reduce((s,r)=>s+(r.tokens||0),0);
      const order=rows.map((r,i)=>({i,frac:raw[i]-Math.floor(raw[i])})).filter(v=>rows[v.i].observable).sort((a,b)=>b.frac-a.frac);
      for(let i=0;i<missing;i++)rows[order[i%order.length].i].tokens++;
    }
    return {status:this.pendingCompaction?'compacting':known?'ready':'waiting',threadId:expectedId,model:this.model,
      used,window,percent:known&&window?100*used/window:null,remaining:known&&window?Math.max(0,window-used):null,
      input:known?this.latest.input:null,output:known?this.latest.output:null,cached:known?this.latest.cached:null,
      sessionTotal:this.total??null,updatedAt:this.updatedAt,compactions:this.compactions,rows,parseErrors:this.parseErrors,
      attribution:'observable_bytes',reserve:null};
  }
}

export class SessionStore {
  constructor(home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')){this.home=home;this.index=new Map();this.scanners=new Map();this.indexAt=0;}
  async reindex(){
    const index=new Map();
    for(const folder of ['sessions','archived_sessions']) {
      const root=path.join(this.home,folder);let files=[];try{files=await fs.readdir(root,{recursive:true});}catch{}
      for(const file of files){if(!file.endsWith('.jsonl'))continue;const id=file.match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i)?.[1]?.toLowerCase();if(!id)continue;
        if(!index.has(id))index.set(id,path.join(root,file));}
    }
    this.index=index;this.indexAt=Date.now();
  }
  async get(id){
    if(!UUID.test(id||''))return {status:'no_thread',threadId:null};id=id.toLowerCase();
    if(!this.indexAt||(!this.index.has(id)&&Date.now()-this.indexAt>5000))await this.reindex();
    const file=this.index.get(id);if(!file)return {status:'not_found',threadId:id};
    let scanner=this.scanners.get(id);if(!scanner||scanner.file!==file){scanner=new SessionScanner(file);this.scanners.set(id,scanner);}
    // Only retain counters for a bounded set of recently viewed sessions.
    this.scanners.delete(id);this.scanners.set(id,scanner);if(this.scanners.size>12)this.scanners.delete(this.scanners.keys().next().value);
    try{await scanner.refresh();return scanner.report(id);}catch{return {status:'read_error',threadId:id};}
  }
}
