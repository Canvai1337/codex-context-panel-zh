import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('Windows shortcut install, upgrade and exact binary restoration',{skip:process.platform!=='win32'},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'panel-shortcut-'));
 try{const result=await promisify(execFile)('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./shortcuts.test.ps1',import.meta.url)),'-WorkRoot',dir],{windowsHide:true});assert.match(result.stdout,/passed/);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
