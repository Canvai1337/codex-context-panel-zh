import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {createHash} from 'node:crypto';

export function stateDirectory(env=process.env){
  if(env.CODEX_PANEL_STATE_DIR)return env.CODEX_PANEL_STATE_DIR;
  if(env.LOCALAPPDATA)return path.join(env.LOCALAPPDATA,'Packages','OpenAI.Codex_2p2nqsd0c76g0','LocalCache','Local','CodexContextPanel');
  return path.resolve('runtime');
}

export function runtimeOptions(args=process.argv.slice(2)){
  const options={port:null,portFile:null,ownerPid:null};
  for(let i=0;i<args.length;i+=2){
    const value=args[i+1];if(value===undefined)throw Error('启动参数缺少值');
    if(args[i]==='--port')options.port=Number(value);
    else if(args[i]==='--port-file')options.portFile=path.resolve(value);
    else if(args[i]==='--owner-pid')options.ownerPid=Number(value);
    else throw Error('未知的启动参数');
  }
  if(options.port!==null&&(!Number.isInteger(options.port)||options.port<1024||options.port>65535))throw Error('必须提供有效端口');
  if(options.ownerPid!==null&&(!Number.isInteger(options.ownerPid)||options.ownerPid<1))throw Error('无效的应用进程');
  if(options.port===null&&!options.portFile)throw Error('必须提供接入端口或端口文件');
  return options;
}

export function ownerAlive(pid){
  if(pid===null)return true;
  try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}
}

export async function portFromFile(file){
  try{
    const stat=await fs.stat(file);if(stat.size>8192)return null;
    const [number,browser]=String(await fs.readFile(file,'utf8')).trim().split(/\r?\n/);
    if(!/^\d+$/.test(number)||!/^\/devtools\/browser\/[\w-]+$/.test(browser||''))return null;
    const port=Number(number);return port>=1024&&port<=65535?port:null;
  }catch{return null;}
}

export async function acquireRuntime(stateDir){
  await fs.mkdir(stateDir,{recursive:true});
  const identity=createHash('sha256').update(path.resolve(stateDir).toLowerCase()).digest('hex').slice(0,24);
  const socket=process.platform==='win32'?`\\\\.\\pipe\\codex-context-panel-${identity}`:path.join(stateDir,'daemon.sock');
  const server=net.createServer(client=>client.end());
  const listening=await new Promise((resolve,reject)=>{
    server.once('error',error=>error.code==='EADDRINUSE'?resolve(false):reject(error));
    server.listen(socket,()=>resolve(true));
  });
  if(!listening){server.close();return null;}
  return {close:()=>new Promise(resolve=>server.close(resolve))};
}

export async function writeState(file,value){
  const temporary=file+'.'+process.pid+'.tmp';
  await fs.writeFile(temporary,JSON.stringify(value));await fs.rename(temporary,file);
}

// Bound diagnostic files and suppress repeated identical errors. Never log packets.
export function diagnostics(stateDir,name='daemon-error.log'){
  let previous='',previousAt=0,queue=Promise.resolve();
  return (stage,error)=>{
    const detail=`${stage}: ${error?.code||error?.name||'Error'} ${error?.message||'unknown error'}`.replace(/[\r\n]+/g,' ').slice(0,800);
    if(detail===previous&&Date.now()-previousAt<60000)return queue;
    previous=detail;previousAt=Date.now();
    queue=queue.catch(()=>{}).then(async()=>{
      const file=path.join(stateDir,name);await fs.mkdir(stateDir,{recursive:true});
      try{if((await fs.stat(file)).size>128*1024){await fs.rm(file+'.old',{force:true});await fs.rename(file,file+'.old');}}catch{}
      await fs.appendFile(file,new Date().toISOString()+' '+detail+'\n');
    }).catch(()=>{});
    return queue;
  };
}
