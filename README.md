# ROBN4 Kindle Dashboard

Renders a 1072 × 1448 grayscale PNG for a jailbroken Kindle Paperwhite 10 (KOReader)
from the `robn4-weather` worker. See [DESIGN.md](DESIGN.md) for the why.

```bash
npm install
node render.js                       # fetch live -> out/dashboard.png
node render.js --fixture f.json      # render offline from a saved payload
node render.js --save-fixture f.json # stash the live payload
node render.js --out path.png        # choose output
node render.js --keep-html           # leave src/_render.html for debugging
```

Needs Chrome or Chromium. Set `CHROME_BIN` if it isn't in a standard location.
Override the upstream with `ROBN4_URL`.

## Layout

```
render.js            pipeline: fetch -> derive -> inject -> chrome -> sharp
src/derive.js        worker JSON -> view model (all the arithmetic + degradation)
src/template.html    the design; reads window.__DATA__, renders itself
src/fonts/           self-hosted Inter + Literata woff2
fixtures/            live.json plus synthetic failure states
tools/               fixture generator
out/                 rendered PNGs (gitignored)
```

The template is the single source of truth for the design and runs standalone in a
browser (it renders an all-`—` page with no data injected). `render.js` only
substitutes the `window.__DATA__ = null;` line.

## Testing failure states

```bash
node tools/make-test-fixtures.js
node render.js --fixture fixtures/test-degraded.json --out out/test-degraded.png
node render.js --fixture fixtures/test-alert.json    --out out/test-alert.png
node render.js --fixture fixtures/test-empty.json    --out out/test-empty.png
```

- **degraded** — half the upstream sections `available:false`
- **alert** — active small craft advisory, stale feed, near-gale wind, waning moon
- **empty** — worker answers but says almost nothing

Two guards, both exit non-zero and leave the previous PNG untouched:

- **No vital data** — air, wind *and* tide all empty.
- **Template script threw** — the page sets `data-render="ok"` when its script
  completes; `render.js` reads that back via `--dump-dom` and refuses to publish
  without it. Catches the half-populated page that would otherwise screenshot
  cleanly and ship silently.

---

## The Kindle plugin

`koreader/plugins/dashboard.koplugin/` — fetches the PNG and shows it full screen.

### Install

1. Connect the Kindle by USB.
2. Copy the whole `dashboard.koplugin` folder into `koreader/plugins/` on the
   device (usually `/mnt/us/koreader/plugins/`).
3. Eject, and restart KOReader.
4. **Tools → ROBN4 Dashboard → Set dashboard URL** — the folder serving
   `dashboard.json` and `dashboard.png`, with no trailing filename.

Optionally bind it to a gesture: **Gesture Manager → (pick a gesture) → General
→ Show dashboard**.

### Try it before deploying anywhere

```bash
npm run render
npm run serve     # prints a http://<your-lan-ip>:8080 URL
```

Put that URL into the plugin with the Kindle on the same wifi. No cloud account
needed to prove the device half works.

### On the device

| Gesture | Effect |
|---|---|
| Tap left third | Refresh now |
| Tap anywhere else | Close |
| Back | Close |

The cached image is shown **immediately** on open, then the network is touched
only if the cache is older than `min_interval` (default 600 s). The manifest
(~200 B) is fetched first and the 70 KB image is downloaded only when
`rendered_at` has actually moved — so an unchanged dashboard costs almost
nothing. Wifi is dropped as soon as the transfer resolves, success or failure.

If the image is older than `stale_after` (default 1800 s), a `STALE — 47m old`
badge is drawn over the footer. The clock in the PNG is from render time, so
without that badge a stale image could pass as current.

### Checking and debugging

```bash
npm run luacheck      # parses against Lua 5.1 and LuaJIT grammars
```

On the device, `koreader/crash.log` carries the plugin's `logger` output —
manifest results, download sizes, and failures. It is the only debugging channel
a Kindle gives you.

**The plugin has not been run on hardware.** It parses cleanly under both
grammars and every referenced module resolves, but KOReader's widget and
`NetworkMgr` APIs drift between releases, so expect to fix one or two calls on
first run. The likely candidates are `key_events` (format changed across
versions), `NetworkMgr:turnOffWifi()`, and the exact `ImageWidget` scaling
behaviour.

---

## Running it at home

```bash
npm run dev     # auto-render every 15 min + serve out/ on the LAN
```

`npm run serve` on its own only serves files — the PNG stays frozen at whenever
`render.js` last ran, and the device's staleness badge will (correctly) start
complaining. `npm run autorender` is the loop; `npm run dev` runs both.

`INTERVAL_S` overrides the 15-minute cadence. The same loop works as the
scheduler on a server, so no cron is needed there either.

**This only works while the Mac is awake and on the same network.** Making the
dashboard work unattended is the one phase still outstanding — see DESIGN.md §4
for the three hosting options.

---

## Deployed

Live at **https://chenrisius.github.io/robn4-kindle-dashboard/**

Three pieces, each doing one thing:

| Piece | Job |
|---|---|
| Cloudflare Worker cron (`cron/`) | says "now", every 15 minutes |
| GitHub Actions (`.github/workflows/render.yml`) | renders and publishes `out/` |
| GitHub Pages | serves it to the Kindle |

Published files:

| | |
|---|---|
| `index.html` | viewer page — the dashboard plus render age and status |
| `dashboard.json` | ~215 B manifest the device polls |
| `dashboard.png` | 1072×1448, 16-grey, ~70 KB |

**Why the clock is on Cloudflare.** The first deployment relied on GitHub's own
`schedule` event, which delivered **1 of ~46 slots over 11.6 hours** — a 2%
delivery rate, and that one fired three minutes off its cron time. All 7 pushes
and all 4 dispatches ran in seconds. GitHub
documents `schedule` as best-effort with no delivery guarantee on any plan, so
this was within spec and simply unusable for a dashboard, where the schedule
*is* the product. The render stayed on Actions; only the trigger moved.
Setup, token scope and verification: [`cron/README.md`](cron/README.md).

**It fails closed.** If the worker is unreachable, `render.js` exits non-zero,
the job fails, and the *previous* deployment stays live — a stale dashboard that
admits it beats a broken one. Pages also sets `cache-control: max-age=600`, so
the device can see a manifest up to ten minutes behind the newest render, still
well inside the 30-minute badge threshold.

Running `npm run dev` locally is still useful for design work — it renders and
serves on the LAN without touching the deployment.

### If the dashboard stops updating

Work down the chain. Each step is one command.

**1. Is the published render actually old?** The Worker's health page answers
this without a token and triggers nothing:

```bash
curl -s https://robn4-dashboard-cron.<your-subdomain>.workers.dev
```

`age_minutes` past ~35 means something is genuinely down. The Kindle's own
staleness badge says the same thing from the device side.

**2. Is the cron firing?** A working trigger is a steady run of dispatches:

```bash
gh run list --repo chenrisius/robn4-kindle-dashboard --limit 10
```

All `workflow_dispatch`, 15 minutes apart — good. Nothing recent — watch a live
tick with `cd cron && npx wrangler tail`, which separates "the trigger never
fired" from "the trigger fired and the API call failed". The status code then
localises the fault exactly:

| Code | Cause | Fix |
|---|---|---|
| `401` | token expired or revoked | new token, then `cd cron && npm run secret` |
| `403` | authenticates, but lacks `Actions: write` — usually *Public Repositories (read-only)* was picked for Repository access | edit the token in place; nothing to re-store |
| `404` | wrong repo, or `WORKFLOW_FILE` names no file in `.github/workflows/` | fix `wrangler.toml`, redeploy |
| nothing logged | Cloudflare never invoked the Worker | check the cron registered |

Only `404` needs a redeploy: secrets bind at runtime, and editing a token's
permissions does not change its value. Observed on first setup: a cron tick
reaches the Worker about **1 second** after its slot, so if the tail is silent
15 seconds past the quarter-hour, the trigger is the problem, not the token.

**3. Are the runs failing rather than missing?** Then the render broke, not the
clock — read the failing step in the Actions tab. `render.js` names what went
wrong and refuses to publish a half-built page.

**4. Force one by hand**, any time, from anywhere:

```bash
gh workflow run render.yml --repo chenrisius/robn4-kindle-dashboard
```

GitHub's `schedule` block is still in the workflow as a dormant fallback. It has
fired once in 11.6 hours, so treat it as noise rather than cover. The
`concurrency` group queues a duplicate render instead of racing it, so the
overlap is harmless.

Whatever happens anywhere in this chain, the device never lies about it — the
plugin reads `rendered_at` from the manifest and badges anything older than 30
minutes with its real age.

#### The other option: trigger from this Mac

`tools/com.robn4.dashboard.plist` calls `gh workflow run` every 15 minutes using
the `gh` auth already on the machine — no new credential, nothing stored.

```bash
cp tools/com.robn4.dashboard.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.robn4.dashboard.plist
```

Remove it with `launchctl unload -w ~/Library/LaunchAgents/com.robn4.dashboard.plist`.

It only fires while the Mac is awake, which is why Cloudflare got the job. Kept
as a belt-and-braces option: if the token lapses while you are away, loading
this plist is a one-command bridge.
