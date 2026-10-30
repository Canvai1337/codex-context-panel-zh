export class CDP {
  constructor(target){this.target=target;this.pending=new Map();this.id=0;this.closed=false;}
  async open(){
    const url=new URL(this.target.webSocketDebuggerUrl);
    if(url.protocol!=='ws:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('仅允许本机 CDP');
    this.ws=new WebSocket(url);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP 连接超时')),4000);this.ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});this.ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP 连接失败'));},{once:true});});
    this.ws.addEventListener('message',e=>{let r;try{r=JSON.parse(String(e.data));}catch{return;}const p=this.pending.get(r.id);if(!p)return;this.pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(r.error.message)):p.resolve(r.result);});
    this.ws.addEventListener('close',()=>{this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('CDP 已断开'));}this.pending.clear();});
    return this;
  }
  send(method,params={}){return new Promise((resolve,reject)=>{if(this.closed)return reject(Error('CDP 已断开'));const id=++this.id;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('CDP 请求超时'));},5000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
  async evaluate(expression){const result=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error('面板脚本执行失败');return result.result?.value;}
  close(){this.ws?.close();this.closed=true;}
}
export function isAppTarget(t){try{const u=new URL(t.url),r=u.searchParams.get('initialRoute');return t.type==='page'&&u.protocol==='app:'&&['-','codex'].includes(u.hostname)&&u.pathname==='/index.html'&&(!r||/^\/local\/[0-9a-f-]+\/?$/i.test(r));}catch{return false;}}
export async function targets(port){const r=await fetch(`http://127.0.0.1:${port}/json/list`,{redirect:'error',signal:AbortSignal.timeout(1500)});return (await r.json()).filter(isAppTarget);}
