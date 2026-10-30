import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SessionScanner,SessionStore,splitInstructions} from '../data.mjs';
import {isAppTarget} from '../cdp.mjs';
import {ID,ID2} from '../fixture.mjs';
const record=(type,payload)=>JSON.stringify({type,payload,timestamp:'2026-10-30T02:00:00Z'})+'\n';
const usage=(n=100)=>record('event_msg',{type:'token_count',info:{last_token_usage:{input_tokens:n-5,output_tokens:5,total_tokens:n,cached_input_tokens:50},total_token_usage:{total_tokens:1000000},model_context_window:1000}});
const message=text=>record('response_item',{type:'message',role:'user',content:[{type:'input_text',text}]});
test('incremental UTF-8, partial lines, exact totals, no transcript export',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ctx-test-'));const file=path.join(dir,'test.jsonl');
 try{
  const input=record('session_meta',{id:ID,base_instructions:{text:'系统指令'}})+message('中文消息 BOSS');
  const bytes=Buffer.from(input+usage());const split=Buffer.from(input).length+25;
  await fs.writeFile(file,bytes.subarray(0,split));const scanner=new SessionScanner(file);await scanner.refresh();assert.equal(scanner.report(ID).used,null);
  await fs.appendFile(file,bytes.subarray(split));await scanner.refresh();const r=scanner.report(ID);
  assert.equal(r.used,100);assert.equal(r.sessionTotal,1000000);assert.equal(r.percent,10);assert.equal(r.remaining,900);
  assert.equal(r.rows.reduce((s,r)=>s+(r.tokens||0),0),100);assert.equal(r.rows.find(r=>r.key==='mcp').tokens,null);
  assert(!JSON.stringify(r).includes('中文消息'));assert(!JSON.stringify(r).includes('系统指令'));const offset=scanner.offset;await scanner.refresh();assert.equal(scanner.offset,offset);
  assert.equal(scanner.report(ID2).status,'identity_mismatch');
  await fs.appendFile(file,record('compacted',{message:'压缩摘要'}));await scanner.refresh();assert.equal(scanner.report(ID).status,'compacting');assert.equal(scanner.report(ID).used,null);
  await fs.appendFile(file,message('新消息')+usage(40));await scanner.refresh();assert.equal(scanner.report(ID).used,40);assert.equal(scanner.report(ID).compactions,1);assert(scanner.report(ID).rows.find(r=>r.key==='summary').observable);
  await fs.writeFile(file,record('session_meta',{id:ID})+usage(20));await scanner.refresh();assert.equal(scanner.report(ID).used,20);assert.equal(scanner.compactions,0);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('chat lookup is explicit, and never falls back to newest session',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ctx-store-'));try{
  await fs.mkdir(path.join(dir,'sessions'));await fs.writeFile(path.join(dir,'sessions',`rollout-${ID}.jsonl`),record('session_meta',{id:ID})+usage());
  const store=new SessionStore(dir);assert.equal((await store.get(ID)).used,100);assert.equal((await store.get(ID2)).status,'not_found');assert.equal((await store.get('../../auth.json')).status,'no_thread');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('instruction sections are split without double attribution',()=>{
 const rows=splitInstructions('系统<skills_instructions>技能</skills_instructions><tools>工具</tools>');
 assert.equal(rows.get('system'),Buffer.byteLength('系统'));assert.equal(rows.size,3);
});
test('world-state hashes and encrypted reasoning are excluded; counters freeze at event',()=>{
 const scanner=new SessionScanner('unused');scanner.ingest({type:'session_meta',payload:{id:ID}});
 scanner.ingest({type:'world_state',payload:{state:{tools:'x'.repeat(100000)}}});
 scanner.ingest({type:'response_item',payload:{type:'reasoning',encrypted_content:'y'.repeat(100000),summary:[]}});
 scanner.ingest(JSON.parse(usage()));const before=scanner.report(ID).rows.map(r=>r.tokens);
 scanner.ingest(JSON.parse(message('new content after usage')));assert.deepEqual(scanner.report(ID).rows.map(r=>r.tokens),before);
});
test('only main app and popped-out task renderer targets are eligible',()=>{
 assert(isAppTarget({type:'page',url:'app://-/index.html'}));assert(isAppTarget({type:'page',url:`app://-/index.html?initialRoute=/local/${ID}`}));
 assert(!isAppTarget({type:'page',url:'app://-/index.html?initialRoute=/avatar-overlay'}));assert(!isAppTarget({type:'page',url:'https://chatgpt.com'}));
});
test('a model change waits for the new model usage instead of reusing old capacity',()=>{
 const s=new SessionScanner('unused');s.ingest({type:'session_meta',payload:{id:ID}});s.ingest({type:'turn_context',payload:{model:'model-a'}});s.ingest(JSON.parse(usage()));assert.equal(s.report(ID).used,100);
 s.ingest({type:'turn_context',payload:{model:'model-b'}});assert.equal(s.report(ID).used,null);assert.equal(s.report(ID).status,'waiting');s.ingest(JSON.parse(usage(200)));assert.equal(s.report(ID).used,200);
});
