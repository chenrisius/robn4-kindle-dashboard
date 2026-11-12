/* Re-renders on an interval. `npm run serve` only serves files — without this
   the PNG is frozen at whenever render.js last ran, and the device's staleness
   badge starts (correctly) accusing it of being old.

   Doubles as the scheduler for a VPS: no cron needed, just run it. A render
   failure is logged and skipped; it never kills the loop, and render.js leaves
   the previous PNG untouched on failure. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVERY_S = Number(process.env.INTERVAL_S || 900);
let running = false, n = 0;

function render() {
  if (running) { console.log('[autorender] previous run still going, skipping'); return; }
  running = true;
  const t0 = Date.now();
  const p = spawn(process.execPath, [join(ROOT, 'render.js')], { cwd: ROOT });
  let tail = '';
  p.stdout.on('data', d => { tail += d; });
  p.stderr.on('data', d => { tail += d; });
  p.on('close', code => {
    running = false;
    const stamp = new Date().toLocaleTimeString('en-GB');
    if (code === 0) {
      const line = tail.split('\n').find(l => l.includes('°F')) || '';
      console.log(`[${stamp}] #${++n} ok  ${Date.now() - t0}ms  ${line.trim()}`);
    } else {
      console.log(`[${stamp}] #${++n} FAILED (exit ${code}) — previous PNG kept`);
      console.log(tail.trim().split('\n').map(l => '    ' + l).join('\n'));
    }
  });
}

console.log(`[autorender] every ${EVERY_S}s`);
render();
setInterval(render, EVERY_S * 1000);
