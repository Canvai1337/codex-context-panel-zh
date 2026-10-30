import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {normalizeQuota,AccountClient} from '../account.mjs';
import {UsageFile,LocalUsage,summarizeUsage,periodKeys} from '../usage.mjs';
const id='a-thread';
const u=(input=90,output=10)=>({input_tokens:input,output_tokens:output,cached_input_tokens:80,reasoning_output_tokens:5,total_tokens:input+output});
const count=(at,total=100,thread=id)=>({type:'event_msg',timestamp:at,payload:{type:'token_count',info:{last_token_usage:u(),total_token_usage:{total_tokens:total}}}});
const canonical=(at,response='r1',thread=id,total=100)=>({type:'token_usage_record',timestamp:at,payload:{response_id:response,thread_id:thread,usage:u(),thread_token_usage:{total_tokens:total}}});
function reader(){const f=new UsageFile('unused');f.ingest({type:'session_meta',payload:{id}});return f;}
test('quota normalization uses Codex bucket and duration; missing is unknown, zero is real',()=>{
 const r=normalizeQuota({limits:{rateLimitsByLimitId:{codex:{primary:{usedPercent:0,windowDurationMins:300,resetsAt:2000000000},secondary:{usedPercent:47,windowDurationMins:10080,resetsAt:2100000000}}},rateLimits:{limitId:'other',primary:{usedPercent:99,windowDurationMins:300}}}},123);
 assert.equal(r.fiveHour.usedPercent,0);assert.equal(r.weekly.usedPercent,47);assert.equal(r.fetchedAt,123);
 assert.equal(normalizeQuota({limits:{rateLimitsByLimitId:{other:{}},rateLimits:{limitId:'codex',primary:{usedPercent:99,windowDurationMins:300}}}}).fiveHour,null);
 assert.equal(normalizeQuota({limits:{rateLimits:{primary:{usedPercent:9,windowDurationMins:15}}}}).fiveHour,null);
 assert.equal(normalizeQuota(null).status,'unavailable');
});
test('read-only account client denies reset and turn actions',async()=>{
 const c=new AccountClient('unused');await assert.rejects(c.call('account/rateLimitResetCredit/consume',{}));await assert.rejects(c.call('turn/start',{}));
});
test('today and week boundaries use Los Angeles including DST, not host timezone',()=>{
 assert.deepEqual(periodKeys(Date.parse('2026-10-30T06:59:00Z')),{today:'2026-10-29',weekStart:'2026-10-26'});
 assert.deepEqual(periodKeys(Date.parse('2026-10-30T07:00:00Z')),{today:'2026-10-30',weekStart:'2026-10-26'});
 assert.deepEqual(periodKeys(Date.parse('2026-11-02T07:59:00Z')),{today:'2026-11-01',weekStart:'2026-10-26'});
 assert.deepEqual(periodKeys(Date.parse('2026-11-02T08:00:00Z')),{today:'2026-11-02',weekStart:'2026-11-02'});
});
test('request IDs deduplicate copied forks, legacy aliases and repeated quota events',()=>{
 const f=reader();f.ingest(canonical('2026-10-30T07:10:00Z'));f.ingest(count('2026-10-30T07:10:01Z'));f.ingest(count('2026-10-30T07:15:00Z'));
 const fork=reader();fork.id='fork-thread';fork.ingest(canonical('2026-10-30T07:10:00Z','r1','fork-thread'));fork.ingest(count('2026-10-30T07:10:01Z'));
 const view=summarizeUsage([f,fork],Date.parse('2026-10-30T08:00:00Z'));assert.equal(view.todayTokens,100);assert.equal(view.requests,1);
});
test('midnight event pair belongs to canonical request date; cache and reasoning not added again',()=>{
 const f=reader();f.ingest(canonical('2026-10-30T06:59:59Z'));f.ingest(count('2026-10-30T07:00:00Z'));f.ingest(canonical('2026-10-30T07:20:00Z','r2',id,200));
 const v=summarizeUsage([f],Date.parse('2026-10-30T08:00:00Z'));assert.equal(v.todayTokens,100);assert.equal(v.weekTokens,200);
 const monday=summarizeUsage([f],Date.parse('2026-11-02T08:01:00Z'));assert.equal(monday.weekTokens,0);
});
test('legacy requests with different cumulative totals count, repeated snapshot does not',()=>{
 const f=reader();f.ingest(count('2026-10-30T07:00:00Z',100));f.ingest(count('2026-10-30T07:01:00Z',100));f.ingest(count('2026-10-30T07:02:00Z',200));assert.equal(summarizeUsage([f],Date.parse('2026-10-30T08:00:00Z')).todayTokens,200);
});
test('local aggregate incrementally reads both roots, tolerates partial lines and file truncation',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'ctx-usage-'));try{
  await fs.mkdir(path.join(home,'sessions'));await fs.mkdir(path.join(home,'archived_sessions'));
  const file=path.join(home,'sessions','r.jsonl'),meta=JSON.stringify({type:'session_meta',payload:{id}})+'\n',line=JSON.stringify(canonical('2026-10-30T07:10:00Z'))+'\n';
  await fs.writeFile(file,meta+line.slice(0,20));const s=new LocalUsage(home),now=Date.parse('2026-10-30T08:00:00Z');assert.equal((await s.refresh(now)).todayTokens,0);
  await fs.appendFile(file,line.slice(20));assert.equal((await s.refresh(now)).todayTokens,100);assert.equal((await s.refresh(now)).todayTokens,100);
  await fs.copyFile(file,path.join(home,'archived_sessions','copy.jsonl'));assert.equal((await s.refresh(now)).todayTokens,100);
  await fs.writeFile(file,meta);assert.equal((await s.refresh(now)).todayTokens,100);
  await fs.writeFile(path.join(home,'archived_sessions','copy.jsonl'),meta);assert.equal((await s.refresh(now)).todayTokens,0);
 }finally{await fs.rm(home,{recursive:true,force:true});}
});
