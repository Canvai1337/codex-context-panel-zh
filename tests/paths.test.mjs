import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
test('Store profile and diagnostics are shared across packaged and unpackaged entrypoints',{skip:process.platform!=='win32'},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'panel-paths-'));
  try{
    const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./paths.test.ps1',import.meta.url)),'-WorkRoot',dir],{windowsHide:true});
    assert.match(stdout,/ordinary Roaming is ignored/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
