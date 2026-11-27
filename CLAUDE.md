# Working in this repo

Renders a 1072×1448 grayscale PNG for a jailbroken Kindle PW4 (KOReader) from the
`robn4-weather` worker, publishes it to GitHub Pages, and a KOReader plugin draws it.

Three documents already carry the knowledge. Read the relevant one before changing
anything, and add to them rather than duplicating them in this file.

| | |
|---|---|
| `README.md` | how to run it, how to install the plugin, how to debug the deployment chain |
| `DESIGN.md` | why every decision is what it is. Numbered sections, append-only — new findings get a new section, they don't rewrite an old one |
| `cron/README.md` | the Cloudflare trigger: setup, token scope, verification |

## Commands

```bash
npm install                  # NOT npm ci — see below
npm run render               # fetch live -> out/dashboard.png
npm run fixtures             # regenerate the synthetic failure states
npm run dev                  # autorender loop + LAN server, for design work
npm run luacheck             # parse the Lua plugin against Lua 5.1 + LuaJIT
node render.js --fixture fixtures/test-degraded.json --out out/x.png
```

There is no test runner. Verification is: render each fixture, look at the PNG,
and check the guards still fire. `npm run luacheck` only parses — it proves
syntax, not behaviour.

## The standard of evidence

This repo's whole design is about not lying to the reader — the device badges its
own staleness rather than showing an old dashboard as current. Hold documentation
and commit messages to the same rule.

- **Never write that something works on hardware unless `crash.log` or a run log
  says so.** `DESIGN.md` §17 and the README's hardware table exist because an
  earlier version predicted API drift that never happened; the prediction was
  replaced with counts from a real device. Predictions are labelled as such.
- **Numbers, dates and sample sizes, not adjectives.** "1 of ~46 slots over 11.6
  hours", "~14% of runs", "three failures at 18:30, 22:30, 23:30 UTC". If you
  can't count it, say you couldn't.
- **When a fix replaces a previous fix, explain why the previous one was wrong.**
  The retry loop in `render.yml` carries a comment headed "THE RETRY IS NOT THE
  SAME MISTAKE AS THE LAST ONE" for exactly this reason: a retry on a read that
  was already succeeding was useless, a retry on an idempotent write is correct.
  Lose that distinction and the next person re-introduces the bad fix.
- **Report what you actually ran.** If a change is unverified, say which part and
  why, in the commit body. Don't describe an intended check as a completed one.

## Things that will bite you

- **`npm install`, never `npm ci`.** The lockfile was generated on darwin-arm64
  and `sharp` resolves a different optional binary per platform. The workflow
  comments this; keep it that way.
- **`src/template.html` is the single source of truth for the design.** It runs
  standalone in a browser and renders an all-`—` page with no data. `render.js`
  only substitutes the `window.__DATA__ = null;` line. Don't move design decisions
  into `render.js` or `derive.js`; all arithmetic and degradation belongs in
  `src/derive.js`, all appearance in the template.
- **Two publish guards, both exit non-zero and leave the previous PNG alone.**
  `render.js:70` checks for vital data (air, wind *and* tide empty = refuse), and
  `render.js:107` reads the template's `data-render` marker back via `--dump-dom`:
  `"error"` and a missing marker are both refusals, only `"ok"` publishes.
  Removing either lets a half-populated page screenshot cleanly and ship silently.
- **It fails closed on purpose.** A failed render means the previous deployment
  stays live. Never add a fallback that publishes something rather than nothing.
- **`gh-pages` is rewritten as one commit per render and force-pushed.** Don't add
  branch protection, don't try to preserve its history, and don't switch Pages
  back to the "GitHub Actions" source — the workflow would keep pushing while the
  site silently stopped updating.
- **The clock lives on Cloudflare, not GitHub.** The `schedule` block in
  `render.yml` is a dormant fallback that delivered 1 of ~46 slots. Don't "fix"
  the deployment by relying on it.
- **`_meta.lua` must not have a `name` field** — KOReader's PluginLoader now warns
  it is deprecated and ignored; the directory name is used. The `name` inside
  `main.lua`'s `WidgetContainer:extend{}` is a different thing and is required.
- **`out/` and `src/_render.html` are generated and gitignored.** Nothing in them
  is an input.
- Needs Chrome or Chromium; set `CHROME_BIN` if it isn't in a standard location.
  `ROBN4_URL` overrides the upstream worker.

## Commits

Sentence-case imperative subject, no `feat:`/`fix:` prefixes. The body is prose
that explains the problem, the evidence, and why this fix and not the obvious
alternative — see `git log` for the register. End with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
