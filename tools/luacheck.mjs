/* Parses the plugin against the Lua grammar KOReader actually runs (LuaJIT,
   5.1 semantics). Catches 5.3-isms like \u{...} escapes that would only blow
   up on the device. Not a substitute for running it on a Kindle. */
import { readFileSync } from 'node:fs';
import luaparse from 'luaparse';
let bad = 0;
for (const f of process.argv.slice(2)) {
  for (const ver of ['5.1', 'LuaJIT']) {
    try {
      luaparse.parse(readFileSync(f, 'utf8'), { luaVersion: ver, comments: false });
      console.log(`OK    ${ver.padEnd(7)} ${f}`);
    } catch (e) {
      bad++;
      console.log(`FAIL  ${ver.padEnd(7)} ${f}\n        ${e.message}`);
    }
  }
}
process.exit(bad ? 1 : 0);
