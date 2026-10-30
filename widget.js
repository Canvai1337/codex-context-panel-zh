(() => {
  const KEY='__BOSS_CONTEXT_PANEL__',ID='boss-context-panel',VERSION='1.4.0',STORE='boss-context-panel-ui-v2';
  if(window[KEY]?.version===VERSION)return;
  window[KEY]?.dispose();
  const UUID=/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i;
  let expanded=false;try{expanded=JSON.parse(localStorage.getItem(STORE)||'{}').expanded===true;}catch{}
  function save(){try{localStorage.setItem(STORE,JSON.stringify({expanded}));}catch{}}
  const host=document.createElement('div');host.id=ID;
  host.style.cssText='display:none;width:100%;min-width:0;box-sizing:border-box;margin:0 0 8px;flex:none;';
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>
  :host{--bg:var(--color-surface,#181818);--ink:var(--color-token-foreground,#fff);--muted:var(--color-token-text-secondary,rgba(255,255,255,.68));--faint:var(--app-color-text-foreground-tertiary,rgba(255,255,255,.52));--line:var(--color-border,rgba(255,255,255,.084));--accent:var(--color-token-foreground,#fff);--hover:var(--color-background-primary-surface,rgba(255,255,255,.04));--track:var(--color-border,rgba(255,255,255,.084));--quota-red:var(--color-text-danger-surface,#fa423e);--quota-yellow:var(--color-text-caution-surface,#ffc300);--quota-green:var(--color-text-success-surface,#04b84c);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif;color:var(--ink);color-scheme:dark;container-type:inline-size;user-select:none}
  :host([data-light]){--bg:var(--color-surface,#fff);--ink:var(--color-token-foreground,#181818);--muted:var(--color-token-text-secondary,rgba(0,0,0,.65));--faint:var(--app-color-text-foreground-tertiary,rgba(0,0,0,.52));--line:var(--color-border,rgba(0,0,0,.084));--accent:var(--color-token-foreground,#181818);--hover:var(--color-background-primary-surface,rgba(0,0,0,.04));--track:var(--color-border,rgba(0,0,0,.084));--quota-red:var(--color-text-danger-surface,#ba2623);--quota-yellow:var(--color-border-caution-outline,#916f00);--quota-green:var(--color-border-success-outline,#008635);color-scheme:light}
  *{box-sizing:border-box}[hidden]{display:none!important}button{font:inherit;color:inherit;border:0;cursor:pointer}button:focus-visible,summary:focus-visible{outline:2px solid var(--color-token-focus-border,#3a83f7);outline-offset:-3px;border-radius:6px}
  .surface{width:100%;min-width:0;border:0;border-radius:0;background:var(--bg);box-shadow:none;overflow:hidden;backdrop-filter:none}
  .toggle{width:100%;min-height:40px;display:flex;flex-wrap:wrap;align-items:center;gap:9px;padding:7px 8px;background:none;text-align:left;border-radius:6px}.toggle:hover{background:var(--hover)}
  .label{font-size:13px;font-weight:400;white-space:nowrap;color:var(--muted)}.pill{font-size:14px;font-weight:500;font-variant-numeric:tabular-nums;color:var(--accent);padding:0;border:0;background:none;white-space:nowrap}.token-usage{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap;margin-left:8px}.quick{margin-left:auto;display:flex;align-items:center;gap:9px;min-width:0;font-size:13px;font-variant-numeric:tabular-nums;color:var(--muted)}.quota-pill{font-size:14px;font-weight:600;white-space:nowrap}.chevron{width:14px;height:14px;flex:none;stroke:var(--muted);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;margin-left:2px}.surface.expanded .chevron{transform:rotate(180deg)}
  .body{border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:16px;max-height:min(var(--detail-max-height,min(560px,60vh)),max(90px,calc(100dvh - 260px)));overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
  .titleline{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.titleline h2{font-size:15px;font-weight:600;margin:0}.model{font-size:12px;color:var(--muted);max-width:58%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .top-summary{display:grid;grid-template-columns:minmax(0,1fr) 200px;gap:22px;align-items:stretch}.usage-main{min-width:0}.totals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.period-totals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:16px}
  .metric{background:transparent;border:0;border-radius:0;padding:2px 0;min-width:0}.metric-name{font-size:12px;color:var(--muted);margin-bottom:7px}.metric-value{font-size:18px;font-weight:600;letter-spacing:0;line-height:1.4;font-variant-numeric:tabular-nums;white-space:nowrap;user-select:text}.unit{display:block;font-size:11px;font-weight:400;color:var(--faint);margin-top:1px}
  .quota-details{display:flex;flex-direction:column;justify-content:space-between;gap:20px;border-left:1px solid var(--line);padding-left:18px;min-width:0}.quota-detail{background:transparent;border:0;border-radius:0;min-width:0}.quota-heading{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.quota-label{font-size:12px;color:var(--muted);white-space:nowrap}.quota-number{font-size:22px;font-weight:600;line-height:1.3;font-variant-numeric:tabular-nums;white-space:nowrap}.quota-reset{font-size:12px;line-height:1.65;color:var(--muted);margin-top:7px;overflow-wrap:anywhere}
  [data-tone="low"]{color:var(--quota-red)}[data-tone="medium"]{color:var(--quota-yellow)}[data-tone="high"]{color:var(--quota-green)}[data-tone="unknown"]{color:var(--muted)}
  .scope-note{font-size:11px;line-height:1.65;color:var(--faint);margin-top:15px}.bar{height:5px;display:flex;border-radius:5px;overflow:hidden;background:var(--track);margin:15px 0 16px}.bar i{display:block;height:100%;min-width:0}.section-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;font-size:12px;color:var(--muted)}.estimate{font-size:11px;border:1px solid var(--line);border-radius:4px;padding:1px 6px;color:var(--faint)}
  .rows{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 24px}.row{display:grid;grid-template-columns:7px minmax(0,1fr) 62px 46px;gap:8px;align-items:center;min-height:33px;font-size:13px;font-variant-numeric:tabular-nums}.dot{width:7px;height:7px;border-radius:2px;opacity:.9}.row-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.num,.pct{text-align:right;white-space:nowrap}.pct{color:var(--muted);font-size:12px}.unknown{color:var(--faint);grid-column:3/5;text-align:right;font-size:12px}
  .separator{height:1px;background:var(--line);margin:13px 0}.meta{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:11px;color:var(--faint);font-variant-numeric:tabular-nums}.foot{font-size:12px;color:var(--muted);line-height:1.7}.foot summary{display:flex;justify-content:space-between;cursor:pointer;list-style:none}.foot summary::-webkit-details-marker{display:none}.explain{padding:9px 0 1px;color:var(--muted);user-select:text}.status{font-size:13px;color:var(--muted);padding:2px 0 10px}.offline{color:var(--quota-yellow)}.stamp{margin-top:9px;font-size:11px;color:var(--faint)}
  @container(max-width:620px){.top-summary{grid-template-columns:1fr;gap:18px}.quota-details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;border-left:0;border-top:1px solid var(--line);padding:14px 0 0}.quota-heading{flex-direction:column;align-items:flex-start;gap:5px}.rows{grid-template-columns:1fr;gap:0}.body{padding:14px}.quick{gap:7px}.token-usage{margin-left:0}.toggle{gap:8px}.metric-value{font-size:18px}}
  @container(max-width:350px){.toggle{gap:7px;padding-inline:7px}.token-usage{font-size:13px}.metric-value{font-size:17px}.top-summary{gap:16px}.body{padding:12px}.totals{gap:8px}.quota-details{gap:12px}.quota-number{font-size:21px}}
  @media(prefers-reduced-motion:no-preference){.chevron{transition:transform .16s ease}.bar i{transition:width .25s ease}}
  </style><section class="surface" aria-label="当前聊天上下文用量"><button class="toggle" aria-label="展开上下文详情" aria-expanded="false" aria-controls="context-details"><span class="label">上下文</span><span class="pill">等待数据</span><span class="token-usage">已用 — / — · 剩余 —</span><span class="quick"><span>5小时剩余</span><span class="quota-pill">—</span></span><svg class="chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></button><div class="body" id="context-details" hidden></div></section>`;
  let current=null,last=null,renderKey=null,destroyed=false,lastPing=Date.now(),offline=false;
  const el=s=>root.querySelector(s);
  const active=n=>!n.closest('[data-app-shell-active-page="false"],[aria-hidden="true"],[inert]');
  function locate(){
    // The fixed-content portal belongs to Codex's progress pill, not the input.
    for(const container of document.querySelectorAll('[data-codex-composer-root]')){
      if(!active(container))continue;
      for(const attr of ['data-above-composer-conversation-id','data-conversation-id','data-thread-id']){
        const nodes=[...container.querySelectorAll('['+attr+']')].filter(n=>active(n)&&!n.hasAttribute('data-above-composer-fixed-content-portal'));
        for(const n of nodes){const value=n.getAttribute(attr)||'';if(/^chatgpt:/i.test(value))continue;const id=value.match(UUID)?.[0]?.toLowerCase();if(!id)continue;
          let before=container.querySelector('[data-codex-composer-reference-drop-target]');
          if(!before)continue;while(before.parentElement!==container&&before.parentElement)before=before.parentElement;
          return {id,container,before};
        }
      }
    }
    return null;
  }
  function select(){return locate()?.id||null;}
  function mount(){
    const placement=locate();if(!placement){host.style.display='none';return null;}
    if(host.parentElement!==placement.container||host.nextSibling!==placement.before)placement.container.insertBefore(host,placement.before);
    host.style.display='block';return placement.id;
  }
  function theme(){
    const rgb=getComputedStyle(host.parentElement||document.body).color.match(/[\d.]+/g)?.slice(0,3).map(Number);
    const light=rgb?.length===3?(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722)<145:!matchMedia('(prefers-color-scheme:dark)').matches;
    host.toggleAttribute('data-light',light);
  }
  function layout(){const placement=locate();if(!placement)return;const input=placement.before.getBoundingClientRect().height,header=el('.toggle').getBoundingClientRect().height;const max=Math.max(90,Math.min(560,Math.floor(innerHeight*.62),innerHeight-input-header-100));host.style.setProperty('--detail-max-height',max+'px');}
  let layoutFrame=null;
  function scheduleLayout(){if(layoutFrame==null)layoutFrame=requestAnimationFrame(()=>{layoutFrame=null;layout();});}
  function expansion(){el('.surface').classList.toggle('expanded',expanded);el('.body').hidden=!expanded;el('.toggle').setAttribute('aria-expanded',String(expanded));el('.toggle').setAttribute('aria-label',expanded?'收起上下文详情':'展开上下文详情');layout();}
  el('.toggle').onclick=()=>{expanded=!expanded;save();expansion();};
  const fmt=n=>n==null?'—':n>=1e6?(n/1e6).toFixed(2)+'M':n>=1000?(n/1000).toFixed(1)+'k':Math.round(n).toLocaleString('zh-CN');
  const compact=n=>fmt(n).replace(/\.0([kM])$/,'$1');
  const exact=n=>n==null?'—':Math.round(n).toLocaleString('zh-CN');
  const pc=n=>n==null?'—':n.toFixed(1)+'%';
  const ZONE='America/Los_Angeles';
  function resetTime(seconds,full=false){if(!seconds)return '重置时间未知';const time=new Date(seconds*1000);if(!Number.isFinite(time.getTime()))return '重置时间未知';if(time.getTime()<=Date.now())return '等待重置数据更新';return new Intl.DateTimeFormat('zh-CN',{timeZone:ZONE,...full?{year:'numeric',month:'2-digit',day:'2-digit'}:{month:'2-digit',day:'2-digit'},hour:'2-digit',minute:'2-digit',hour12:false}).format(time)+' 重置';}
  function quotaPercent(q){if(!q||typeof q.usedPercent!=='number'||!Number.isFinite(q.usedPercent)||q.usedPercent<0||q.usedPercent>100)return null;return Math.round(Math.max(0,Math.min(100,100-q.usedPercent))*10)/10;}
  function quotaRemaining(q){const value=quotaPercent(q);if(value==null)return '—';return q.resetsAt&&q.resetsAt*1000<=Date.now()?'待刷新':pc(value);}
  function quotaTone(q){const value=quotaPercent(q);if(value==null||(q.resetsAt&&q.resetsAt*1000<=Date.now()))return 'unknown';return value<=20?'low':value<=50?'medium':'high';}
  function updateQuota(n,q){n.textContent=quotaRemaining(q);n.dataset.tone=quotaTone(q);}
  function globalSummary(d){updateQuota(el('.quota-pill'),d.quota?.fiveHour);el('.token-usage').textContent='已用 '+compact(d.used)+' / '+compact(d.window)+' · 剩余 '+compact(d.remaining);el('.token-usage').title='当前窗口已用 '+exact(d.used)+' Token / 总容量 '+exact(d.window)+' Token · 剩余 '+exact(d.remaining)+' Token';for(const n of root.querySelectorAll('.quota-number'))updateQuota(n,d.quota?.[n.dataset.period]);for(const n of root.querySelectorAll('.quota-reset'))n.textContent=d.quota?.status==='ready'?resetTime(d.quota[n.dataset.period]?.resetsAt,true):'官方额度数据暂不可用';}
  function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
  function row(r,window){const n=node('div','row');const dot=node('span','dot');dot.style.background=r.color;n.append(dot,node('span','row-label',r.label));if(!r.observable||r.tokens==null)n.append(node('span','unknown','未记录'));else{const num=node('span','num',fmt(r.tokens));num.title='约 '+exact(r.tokens)+' Token';n.append(num,node('span','pct',pc(window?r.tokens/window*100:null)));}return n;}
  function metric(label,value){const tile=node('div','metric');const number=node('div','metric-value',exact(value));number.append(node('span','unit','Token'));tile.append(node('div','metric-name',label),number);return tile;}
  function globalDetails(body,d,showWindow=false){
    const activity=d.activity||{},quota=d.quota||{},top=node('div','top-summary'),main=node('div','usage-main');
    if(showWindow){const totals=node('div','totals');totals.append(metric('窗口已用总量',d.used),metric('窗口总容量',d.window),metric('剩余容量',d.remaining));main.append(totals);}
    const period=node('div','period-totals');period.append(metric('今日累计 Token · 本机',activity.todayTokens),metric('本周累计 Token · 本机',activity.weekTokens));main.append(period);
    const quotas=node('aside','quota-details');quotas.setAttribute('aria-label','账户额度剩余');
    for(const [label,key]of [['5小时额度','fiveHour'],['周额度','weekly']]){const value=quota[key],n=node('div','quota-detail'),heading=node('div','quota-heading'),number=node('span','quota-number');number.dataset.period=key;updateQuota(number,value);heading.append(node('span','quota-label',label+' · 剩余 '),number);const reset=node('div','quota-reset',quota.status==='ready'?resetTime(value?.resetsAt,true):'官方额度数据暂不可用');reset.dataset.period=key;n.append(heading,reset);quotas.append(n);}
    top.append(main,quotas);body.append(top,node('div','scope-note','额度为账户共享；Token 为本机已记录聊天，按太平洋时间统计，本周从周一 00:00 开始。'+(activity.partial?'部分日志无法读取，累计值可能不完整。':'')));
  }
  const statuses={waiting:'等待本聊天的首次用量记录',compacting:'上下文已压缩，等待新的用量记录',not_found:'未找到本聊天的本机日志',read_error:'暂时无法读取本聊天日志',identity_mismatch:'聊天标识不匹配，已停止显示'};
  function render(data){
    if(destroyed)return;const id=mount();if(id!==current){current=id;last=null;renderKey=null;}if(!id)return;
    if(data?.threadId===id){last=data;lastPing=Date.now();if(offline){offline=false;renderKey=null;}}
    const d=last||{status:'waiting',threadId:id},key=JSON.stringify(d);if(key===renderKey){theme();return;}renderKey=key;
    const body=el('.body'),scroll=body.scrollTop,explainOpen=el('details')?.open;body.replaceChildren();
    const accent=d.percent>=85?'var(--color-text-danger-surface,#fa423e)':d.percent>=70?'var(--color-text-warning-surface,#fb6a22)':null;
    if(accent)host.style.setProperty('--accent',accent);else host.style.removeProperty('--accent');
    el('.pill').textContent=d.percent==null?(d.status==='ready'?'容量未知':'等待数据'):pc(d.percent);
    globalSummary(d);
    el('.toggle').title=`上下文已用 ${pc(d.percent)} · 当前窗口已用 ${exact(d.used)} Token · 5小时额度剩余 ${quotaRemaining(d.quota?.fiveHour)}`;
    if(d.status!=='ready'){body.append(node('div','status',statuses[d.status]||'等待本聊天数据'));globalDetails(body,d);}
    else{
      const heading=node('div','titleline');heading.append(node('h2','','使用详情'),node('span','model',d.model||'模型未记录'));body.append(heading);
      globalDetails(body,d,true);
      const bar=node('div','bar');bar.setAttribute('role','img');bar.setAttribute('aria-label','上下文占比 '+pc(d.percent));
      if(d.window)for(const r of d.rows||[]){if(!r.tokens)continue;const seg=node('i');seg.style.background=r.color;seg.style.width=Math.max(0,Math.min(100,r.tokens/d.window*100))+'%';bar.append(seg);}body.append(bar);
      const caption=node('div','section-title');caption.append(node('span','','占用构成'),node('span','estimate','分类估算'));body.append(caption);
      const rows=node('div','rows');for(const r of d.rows||[])rows.append(row(r,d.window));body.append(rows);
      body.append(node('div','separator'));const meta=node('div','meta');meta.append(node('span','','自动压缩预留 · 未知'),node('span','','已压缩 '+(d.compactions||0)+' 次'));body.append(meta);
    }
    body.append(node('div','separator'));const details=node('details','foot'),summary=node('summary');summary.append(node('span','','数据说明'),node('span','','⌄'));details.append(summary,node('div','explain','窗口已用总量包含最近请求的输入与输出，容量采用同一条用量记录。分类按可观察内容估算，不是官方逐项计数；未记录不等于零。自动压缩预留未知，剩余容量不代表距离压缩的精确余量。'));details.open=!!explainOpen;body.append(details);
    const stamp=d.updatedAt?new Date(d.updatedAt).toLocaleTimeString('zh-CN',{hour12:false}):'等待更新';const footer=node('div','meta stamp');footer.append(node('span','','聊天 '+id.slice(0,8)),node('span','',stamp+' · 随请求记录更新'));footer.title=id;body.append(footer);
    if(d.parseErrors)body.append(node('div','stamp','有 '+d.parseErrors+' 条日志无法解析，分类可能不完整'));
    body.scrollTop=scroll;theme();expansion();
  }
  function sync(){if(destroyed)return;const id=mount();if(id!==current){current=id;last=null;renderKey=null;render(null);}scheduleLayout();}
  const observer=new MutationObserver(sync);observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-app-shell-active-page','data-above-composer-conversation-id','data-conversation-id','aria-hidden','inert']});
  const timer=setInterval(()=>{sync();if(last)globalSummary(last);if(current&&last&&!offline&&Date.now()-lastPing>12000){offline=true;renderKey=null;el('.pill').textContent='连接已断开';el('.body').prepend(node('div','status offline','本机连接已断开，以下为上次记录'));}if(host.isConnected)theme();},2000);
  window.addEventListener('resize',layout);
  window[KEY]={version:VERSION,select,update:render,dispose(){destroyed=true;observer.disconnect();clearInterval(timer);if(layoutFrame!=null)cancelAnimationFrame(layoutFrame);window.removeEventListener('resize',layout);host.remove();delete window[KEY];}};
  sync();render(null);
})()
