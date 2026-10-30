import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {fixtureHTML,demo,ID,ID2} from '../fixture.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));const widget=await fs.readFile(path.join(here,'../widget.js'),'utf8');
test('inline bar: exact totals, native layout, dark/light, narrow widths, selection, remount and offline',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:850}});await page.clock.install();await page.setContent(fixtureHTML());await page.addScriptTag({content:widget});
  await page.evaluate(d=>window.__BOSS_CONTEXT_PANEL__.update(d),demo);
  const panel=page.locator('#boss-context-panel'),body=panel.locator('.body'),toggle=panel.locator('.toggle');
  assert.equal(await body.isVisible(),false);assert((await panel.locator('.pill').textContent()).includes('29.3%'));
  assert(Number.parseFloat(await panel.locator('.token-usage').evaluate(n=>getComputedStyle(n).fontSize))>=13);
  assert((await panel.locator('.quick').textContent()).includes('5小时剩余73.0%'));assert.equal(await panel.getAttribute('data-light'),null);
  const summary=await toggle.textContent();assert(summary.includes('已用 139.2k / 475k · 剩余 335.8k'));assert(!summary.includes('周额度'));assert(!summary.includes('重置'));
  assert.equal(await panel.locator('.overview').count(),0);
  // Remaining quota must distinguish a real 0%/100% from missing or expired data.
  await page.evaluate(d=>window.__BOSS_CONTEXT_PANEL__.update({...d,quota:{...d.quota,fiveHour:{...d.quota.fiveHour,usedPercent:0}}}),demo);assert.equal(await panel.locator('.quota-pill').textContent(),'100.0%');
  await page.evaluate(d=>window.__BOSS_CONTEXT_PANEL__.update({...d,quota:{...d.quota,fiveHour:{...d.quota.fiveHour,usedPercent:100}}}),demo);assert.equal(await panel.locator('.quota-pill').textContent(),'0.0%');
  await page.evaluate(d=>window.__BOSS_CONTEXT_PANEL__.update({...d,quota:{status:'unavailable',fiveHour:null}}),demo);assert.equal(await panel.locator('.quota-pill').textContent(),'—');
  await page.evaluate(d=>window.__BOSS_CONTEXT_PANEL__.update({...d,quota:{...d.quota,fiveHour:{...d.quota.fiveHour,resetsAt:1}}}),demo);assert.equal(await panel.locator('.quota-pill').textContent(),'待刷新');
  await page.evaluate(d=>window.__BOSS_CONTEXT_PANEL__.update(d),demo);
  const geometry=()=>page.evaluate(()=>{const p=document.getElementById('boss-context-panel'),input=document.querySelector('[data-codex-composer-reference-drop-target]');const a=p.getBoundingClientRect(),b=input.getBoundingClientRect();return {position:getComputedStyle(p).position,parent:p.parentElement.hasAttribute('data-codex-composer-root'),panel:{x:a.x,y:a.y,w:a.width,h:a.height,bottom:a.bottom},input:{x:b.x,y:b.y,w:b.width,h:b.height,bottom:b.bottom}};});
  const closed=await geometry();assert.equal(closed.position,'static');assert.equal(closed.parent,true);assert.equal(closed.panel.x,closed.input.x);assert.equal(closed.panel.w,closed.input.w);assert(closed.panel.bottom<=closed.input.y);
  const out=path.resolve(here,'../outputs');await fs.mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,'内嵌栏-收起预览.png')});
  await toggle.click();assert.equal(await body.isVisible(),true);const texts=await body.textContent();assert(texts.includes('分类估算'));assert(texts.includes('未记录'));assert(texts.includes('139,193'));assert(texts.includes('475,000'));assert(texts.includes('335,807'));
  const left=await panel.locator('.usage-main').boundingBox(),right=await panel.locator('.quota-details').boundingBox();assert(right.x>=left.x+left.width);assert(Math.abs(right.y-left.y)<2);
  assert(Number.parseFloat(await panel.locator('.quota-number').first().evaluate(n=>getComputedStyle(n).fontSize))>=21);
  for(const [used,tone]of [[0,'high'],[49.9,'high'],[50,'medium'],[79.9,'medium'],[80,'low'],[100,'low']]){
    await page.evaluate(({d,used})=>window.__BOSS_CONTEXT_PANEL__.update({...d,quota:{...d.quota,fiveHour:{...d.quota.fiveHour,usedPercent:used},weekly:{...d.quota.weekly,usedPercent:used}}}),{d:demo,used});
    assert.equal(await panel.locator('.quota-pill').getAttribute('data-tone'),tone);
    assert.deepEqual(await panel.locator('.quota-number').evaluateAll(ns=>ns.map(n=>n.dataset.tone)),[tone,tone]);
  }
  await page.evaluate(d=>window.__BOSS_CONTEXT_PANEL__.update({...d,quota:{status:'unavailable',fiveHour:null,weekly:null}}),demo);
  assert.equal(await panel.locator('.quota-pill').getAttribute('data-tone'),'unknown');
  await page.evaluate(d=>window.__BOSS_CONTEXT_PANEL__.update(d),demo);
  assert(texts.includes('12,345,678'));assert(texts.includes('175,527,138'));assert(texts.includes('额度为账户共享'));
  assert(texts.includes('5小时额度 · 剩余 73.0%'));assert(texts.includes('周额度 · 剩余 53.0%'));assert(texts.includes('重置'));
  // Native semantic variables must drive the card palette, not a copied RGB theme.
  await page.evaluate(()=>{const s=document.documentElement.style;s.setProperty('--color-surface','#303030');s.setProperty('--color-token-foreground','#eeeeee');});
  const palette=await panel.evaluate(n=>{const s=n.shadowRoot;return {body:getComputedStyle(s.querySelector('.body')).backgroundColor,text:getComputedStyle(s.querySelector('.metric-value')).color,tile:getComputedStyle(s.querySelector('.metric')).backgroundColor,shadow:getComputedStyle(s.querySelector('.surface')).boxShadow,gradient:getComputedStyle(s.querySelector('.surface')).backgroundImage,blur:getComputedStyle(s.querySelector('.surface')).backdropFilter,badge:getComputedStyle(s.querySelector('.pill')).backgroundColor};});
  assert.deepEqual(palette,{body:'rgb(48, 48, 48)',text:'rgb(238, 238, 238)',tile:'rgba(0, 0, 0, 0)',shadow:'none',gradient:'none',blur:'none',badge:'rgba(0, 0, 0, 0)'});
  await page.evaluate(()=>{for(const name of ['--color-surface','--color-token-foreground'])document.documentElement.style.removeProperty(name);});
  const opened=await geometry();assert.equal(opened.input.bottom,closed.input.bottom);assert(opened.panel.y<closed.panel.y);assert(opened.panel.bottom<=opened.input.y);assert(opened.panel.y>=0);
  await page.screenshot({path:path.join(out,'内嵌栏-深色展开预览.png')});await panel.screenshot({path:path.join(out,'内嵌栏-详情.png')});
  for(const width of [390,320]){await page.setViewportSize({width,height:700});const r=await geometry();assert(r.panel.x>=0&&r.panel.x+r.panel.w<=width);assert(r.panel.bottom<=r.input.y);assert(r.input.bottom<=700);assert(r.panel.y>=0);const overflow=await panel.evaluate(n=>{const s=n.shadowRoot;return [...s.querySelectorAll('.toggle,.token-usage,.totals,.metric-value,.rows,.quota-heading')].map(e=>({class:e.className,overflow:e.scrollWidth-e.clientWidth}));});assert(overflow.every(r=>r.overflow<=1),JSON.stringify(overflow));}
  await page.setViewportSize({width:390,height:700});await page.screenshot({path:path.join(out,'内嵌栏-窄窗口预览.png')});
  await page.setViewportSize({width:390,height:450});let short=await geometry();assert(short.panel.y>=0&&short.input.bottom<=450);assert(short.panel.bottom<=short.input.y);
  // Native multiline composition grows upward without overlapping the bar.
  await page.setViewportSize({width:1200,height:850});await page.locator('.composer').evaluate(n=>n.style.height='190px');const grown=await geometry();assert(grown.panel.bottom<=grown.input.y);assert.equal(grown.input.bottom,closed.input.bottom);
  await page.locator('.composer').evaluate(n=>n.style.height='100px');
  await page.evaluate(id=>document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id),ID2);await page.waitForTimeout(40);assert(!(await panel.locator('.pill').textContent()).includes('29.3%'));
  await page.evaluate(d=>window.__BOSS_CONTEXT_PANEL__.update(d),demo);assert(!(await panel.locator('.pill').textContent()).includes('29.3%'));
  await page.evaluate(d=>window.__BOSS_CONTEXT_PANEL__.update({...d,threadId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',status:'not_found',used:null,percent:null}),demo);
  assert((await body.textContent()).includes('175,527,138'));assert((await body.textContent()).includes('周额度 · 剩余 53.0%'));
  await page.evaluate(()=>document.querySelector('[data-app-shell-active-page]').setAttribute('data-app-shell-active-page','false'));await page.waitForTimeout(40);assert.equal(await panel.isVisible(),false);
  await page.evaluate(id=>{document.querySelector('[data-app-shell-active-page]').setAttribute('data-app-shell-active-page','true');document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id);document.body.style.color='#24272d';document.body.style.background='#fafafa';},ID);
  await page.evaluate(d=>window.__BOSS_CONTEXT_PANEL__.update(d),demo);assert.notEqual(await panel.getAttribute('data-light'),null);await page.screenshot({path:path.join(out,'内嵌栏-浅色预览.png')});
  // React may replace the composer while the renderer itself stays alive.
  await page.evaluate(()=>{const n=document.querySelector('[data-codex-composer-root]'),copy=n.cloneNode(true);copy.querySelector('#boss-context-panel')?.remove();n.replaceWith(copy);});await page.waitForTimeout(40);assert.equal(await panel.isVisible(),true);assert.equal((await geometry()).parent,true);
  await page.addScriptTag({content:widget});assert.equal(await page.locator('#boss-context-panel').count(),1);
  await page.clock.fastForward(16000);assert((await panel.locator('.pill').textContent()).includes('29.3%'));assert((await toggle.getAttribute('title')).includes('连接已断开'));await page.evaluate(d=>window.__BOSS_CONTEXT_PANEL__.update(d),demo);assert((await panel.locator('.pill').textContent()).includes('29.3%'));
  await page.evaluate(()=>window.__BOSS_CONTEXT_PANEL__.dispose());assert.equal(await page.locator('#boss-context-panel').count(),0);
 }finally{await browser.close();}
});
test('cached switching is synchronous; a running turn freezes every visible metric',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});try{
  const page=await browser.newPage();await page.clock.install();await page.setContent(fixtureHTML());
  await page.evaluate(({d,id})=>window.__BOSS_CONTEXT_PANEL_SEED__=[d,{...d,threadId:id,used:200000,percent:42.1}],{d:demo,id:ID2});await page.addScriptTag({content:widget});
  const panel=page.locator('#boss-context-panel');await panel.locator('.toggle').click();
  const before=await panel.textContent();
  await page.evaluate(d=>window.__BOSS_CONTEXT_PANEL__.update({...d,turnActive:true,used:250000,percent:52.6,quota:{status:'ready',fiveHour:{usedPercent:99}},activity:{todayTokens:999}}),demo);
  await page.clock.fastForward(4000);assert.equal(await panel.textContent(),before);
  await page.evaluate(id=>document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id),ID2);
  assert.equal(await panel.locator('.pill').textContent(),'42.1%');
  await page.evaluate(id=>document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id),ID);
  assert.equal(await panel.textContent(),before);
  await page.evaluate(d=>window.__BOSS_CONTEXT_PANEL__.update({...d,turnActive:false,used:250000,percent:52.6}),demo);assert.equal(await panel.locator('.pill').textContent(),'52.6%');
  await page.evaluate(id=>window.__BOSS_CONTEXT_PANEL__.update({threadId:id,status:'read_error'}),ID);assert.equal(await panel.locator('.pill').textContent(),'52.6%');
  await page.evaluate(()=>window.__BOSS_CONTEXT_PANEL__.dispose());
 }finally{await browser.close();}
});
