import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fork,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runtimeOptions,ownerAlive,acquireRuntime,writeState,diagnostics,stateDirectory} from './runtime.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const execute=promisify(execFile);

async function stopWorker(child,graceful=false){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  if(graceful&&child.connected){
    child.disconnect();
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),wait(2500)]);
    if(child.exitCode!==null||child.signalCode!==null)return;
  }
  // Kill only our fork and its descendants, including the read-only app-server.
  if(process.platform==='win32'){
    try{await execute('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:5000});}catch{child.kill();}
  }else child.kill('SIGKILL');
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),wait(1000)]);
}

export async function supervise({stateDir,ownerPid,args,workerFile=path.join(here,'daemon.mjs'),heartbeatMs=30000,pollMs=1000,retryMs=1000,maxRetryMs=10000}){
  const lease=await acquireRuntime(stateDir);if(!lease)return;
  const log=diagnostics(stateDir,'service-error.log');
  let stopping=false,child=null,restarts=0,lastBeat=0,startedAt=0,failures=0,lastPhase='starting';
  const stop=()=>{stopping=true;};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  const state=phase=>writeState(path.join(stateDir,'service-status.json'),{version:'1.6.2',pid:process.pid,ownerPid,workerPid:child?.pid||null,restarts,phase,workerPhase:lastPhase,updatedAt:new Date().toISOString()});
  try{
    while(!stopping&&ownerAlive(ownerPid)){
      startedAt=lastBeat=Date.now();lastPhase='starting';
      child=fork(workerFile,args,{cwd:here,windowsHide:true,execArgv:[],env:{...process.env,CODEX_PANEL_STATE_DIR:stateDir,CODEX_PANEL_SUPERVISED:'1'},stdio:['ignore','ignore','pipe','ipc']});
      child.stderr.on('data',buffer=>{void log('worker-stderr',Error(String(buffer).slice(0,800)));});
      child.on('error',error=>{void log('worker-start',error);});
      child.on('message',message=>{if(message?.type==='heartbeat'){lastBeat=Date.now();lastPhase=message.phase||'starting';}});
      while(!stopping&&ownerAlive(ownerPid)&&child.exitCode===null&&child.signalCode===null){
        if(Date.now()-lastBeat>heartbeatMs){await log('heartbeat-timeout',Error('后台未完成刷新，重新启动'));await stopWorker(child);break;}
        await state('running').catch(error=>log('service-status',error));
        await wait(pollMs);
      }
      if(stopping||!ownerAlive(ownerPid))break;
      await log('worker-restart',Error(`后台退出或超时，exit=${child.exitCode},signal=${child.signalCode}`));
      await stopWorker(child);child=null;restarts++;
      failures=Date.now()-startedAt>=heartbeatMs?0:failures+1;
      await state('recovering').catch(error=>log('service-status',error));
      const until=Date.now()+Math.min(maxRetryMs,retryMs*2**Math.min(failures,4));
      while(!stopping&&ownerAlive(ownerPid)&&Date.now()<until)await wait(Math.min(pollMs,until-Date.now()));
    }
  }finally{
    await stopWorker(child,true);child=null;
    await state('stopped').catch(error=>log('service-status',error));
    await lease.close();process.off('SIGINT',stop);process.off('SIGTERM',stop);
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options=runtimeOptions();
  const stateDir=stateDirectory();
  try{await supervise({stateDir,ownerPid:options.ownerPid,args:process.argv.slice(2)});}
  catch(error){await diagnostics(stateDir,'service-error.log')('service-fatal',error);process.exitCode=1;}
}
