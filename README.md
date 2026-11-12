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

`.github/workflows/render.yml` runs `render.js` every 15 minutes and publishes
`out/` to GitHub Pages. No server, no secrets — the worker is a public
unauthenticated endpoint and nothing on the dashboard is private.

| | |
|---|---|
| `index.html` | viewer page — the dashboard plus render age and status |
| `dashboard.json` | ~215 B manifest the device polls |
| `dashboard.png` | 1072×1448, 16-grey, ~70 KB |

Two behaviours worth knowing:

- **The schedule is best-effort.** GitHub delays cron under load; 5–20 minutes
  late is normal. The device's staleness badge reports that honestly rather than
  hiding it.
- **It fails closed.** If the worker is unreachable, `render.js` exits non-zero,
  the job fails, and the *previous* deployment stays live. Pages also sets
  `cache-control: max-age=600`, so the device can see a manifest up to ten
  minutes behind the newest render — still well inside the 30-minute badge
  threshold.

Scheduled workflows are disabled after 60 days of no repository activity. If the
dashboard goes quiet, check the Actions tab first.

Running `npm run dev` locally is still useful for design work — it renders and
serves on the LAN without touching the deployment.

### If the dashboard stops updating

Check the Actions tab first — the schedule is the weakest link in this setup.

**Known issue, unresolved as of first deploy.** In the first 80 minutes after
this repo was created, GitHub delivered **no scheduled runs at all** — not late,
never. Eight-plus slots were missed across two different cron expressions, while
push- and dispatch-triggered runs on the same workflow succeeded immediately.

Ruled out: the workflow is on the default branch, the API reports
`state=active`, the repo is not a fork, and the YAML is valid. The configuration
is correct; GitHub's scheduler simply was not firing for a new repository.

Things to try, in order:

1. **Wait.** New repos often wait before the scheduler picks them up, and
   schedule delivery is best-effort on every plan. This may resolve itself.
2. **`gh workflow run render.yml`** forces a render immediately, any time.
3. **Move the trigger off GitHub.** A Cloudflare Worker cron calling
   `workflow_dispatch` is reliable and keeps rendering free on Actions; it needs
   a GitHub token with `actions:write` as a Worker secret. A launchd job on a Mac
   running `gh workflow run` works with existing auth but only while awake.

Cron is deliberately set to `7,22,37,52` rather than `*/15`: GitHub's docs state
schedule delivery degrades at the start of every hour, and `*/15` lands on the
four most contended slots.

Whatever happens here, the device never lies about it — the plugin reads
`rendered_at` from the manifest and badges anything older than 30 minutes.
