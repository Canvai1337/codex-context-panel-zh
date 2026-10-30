import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureHTML,demo} from './fixture.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),out=path.resolve(here,'outputs');
const widget=await fs.readFile(path.join(here,'widget.js'),'utf8');
await fs.mkdir(out,{recursive:true});
const html=fixtureHTML().replace('</body>',`<script>${widget}</script><script>const demo=${JSON.stringify(demo)};window.__BOSS_CONTEXT_PANEL__.update(demo);setInterval(()=>window.__BOSS_CONTEXT_PANEL__?.update(demo),2000);</script></body>`);
await fs.writeFile(path.join(out,'中文上下文面板-交互预览.html'),html);
