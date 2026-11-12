/* Pulls the new tail of the Kindle's crash.log and surfaces anything that
   matters for the dashboard plugin: load failures, Lua tracebacks, our own
   logger lines, and the network path.

   usage: node tools/check-crash.mjs [baselineLineCount] */
import { readFileSync, existsSync } from 'node:fs';

const LOG = '/Volumes/Kindle/koreader/crash.log';
const baseline = Number(process.argv[2] ?? 1426);

if (!existsSync(LOG)) {
  console.log('Kindle not mounted (no ' + LOG + ')');
  process.exit(2);
}

const all = readFileSync(LOG, 'latin1').split('\n');
// A rotated/truncated log means the baseline no longer applies; take the tail.
const rotated = all.length < baseline;
const fresh = rotated ? all.slice(-400) : all.slice(baseline);
console.log(`crash.log: ${all.length} lines (baseline ${baseline})` +
            (rotated ? ' — looks ROTATED, showing last 400' : `, ${fresh.length} new`));

const show = (title, lines, limit = 40) => {
  console.log(`\n--- ${title} (${lines.length}) ---`);
  if (!lines.length) { console.log('  (none)'); return; }
  lines.slice(0, limit).forEach(l => console.log('  ' + l.trimEnd()));
  if (lines.length > limit) console.log(`  ... +${lines.length - limit} more`);
};

const has = (re) => fresh.filter(l => re.test(l));

// Our plugin identifies itself in every logger call as "dashboard:"
show('dashboard plugin', has(/dashboard/i));

// Lua blow-ups: KOReader prints these with a traceback
const errors = has(/\.lua:\d+:|stack traceback|attempt to (index|call|concat|compare)|\bERROR\b|assertion failed/i);
show('Lua errors / tracebacks', errors);

show('plugin loading', has(/plugin|Plugin/).filter(l => !/dashboard/i.test(l)), 15);
show('network / wifi', has(/wifi|Wifi|network|NetworkMgr|dhcp|wpa_/).slice(-25), 25);

console.log('\n=== verdict ===');
if (!fresh.some(l => /dashboard/i.test(l))) {
  console.log('  No "dashboard" lines at all. Either the plugin never loaded');
  console.log('  (check the Lua errors above), or KOReader was not restarted.');
} else if (errors.length) {
  console.log('  Plugin ran but something threw — see the traceback above.');
} else {
  console.log('  Plugin logged normally and nothing threw.');
}
