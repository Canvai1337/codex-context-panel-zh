// Isolated failure injection for the supervisor; never loads real user sessions.
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
const [marker,mode]=process.argv.slice(2);
let attempt=0;try{attempt=Number(await fs.readFile(marker,'utf8'));}catch{}
await fs.writeFile(marker,String(++attempt));
if(attempt===1&&mode==='crash')process.exit(7);
if(attempt===1&&mode==='hang'){
  const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  await fs.writeFile(marker+'.child',String(descendant.pid));
  setInterval(()=>{},1000); // Alive, but never completes its initial refresh.
}else{
  const timer=setInterval(()=>process.send?.({type:'heartbeat',phase:'connected'}),30);
  process.on('disconnect',()=>{clearInterval(timer);process.exit(0);});
}
