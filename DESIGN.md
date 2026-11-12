# ROBN4 Kindle Dashboard — Design

Target: Kindle Paperwhite 10th gen (PW4), jailbroken, KOReader.
Subject: a marine/sky almanac for New York Harbor, station ROBN4.

---

## 1. What we're building

One screen of pixels: date, time, conditions at Robbins Reef Light, sun and moon,
UV and air quality, tides at The Battery, and the ANZ338 marine forecast.

No calendar, no to-dos — those live on the phone and would be redundant here.
That removal is what makes the rest of this design possible: the three zones it
freed up are now the tide curve.

---

## 2. Decisions locked

| Decision | Choice |
|---|---|
| Rendering | Server renders one 1072×1448 grayscale PNG; thin KOReader Lua plugin fetches and displays it |
| Data | **Single GET** to `robn4-weather.chenrisius.workers.dev` |
| Render host | GH Actions cron → Pages (free, serverless), or a small box with Chromium |
| Usage | Glanced at a few times a day; refresh-on-open |

### What the existing worker changes

The whole data layer disappears. One unauthenticated GET returns everything —
`station`, `wind`, `air`, `pressure`, `water`, `visibility`, `tide`, `current`,
`forecast`, `waves`, `seas`, `moon`, `sun`, `uv`, `aqi`, `alerts`, `feed_status`,
`hourly`, `wind_forecast`, `verdict`. No API keys, no credentials, no fan-out,
no per-source failure handling in the renderer — the worker already did it.

Two consequences worth stating plainly:

- **There are no secrets any more.** The earlier design needed an Apple
  app-specific password in cloud storage to reach Reminders over CalDAV. Dropping
  calendar and to-dos deleted that entire risk. Nothing on this dashboard is
  private, so the PNG endpoint does not need a token and can be served publicly.
- **The renderer can be stateless and free.** With no secrets and one upstream
  call, GitHub Actions on a cron is sufficient — no VPS, no container registry,
  nothing to patch.

---

## 3. Device constraints that drive the design

| Property | Value | Consequence |
|---|---|---|
| Resolution | 1072 × 1448, portrait | Fixed canvas, rendered 1:1, never scaled |
| Density | 300 ppi | Content area is a **3.3″ × 4.6″ postcard** — think pocket almanac |
| Greys | 16 levels, non-linear gamma | Black, white, and two greys. Mid-grey text reads as mud |
| 1 px | 0.085 mm | Hairlines vanish: minor rules 2 px, major rules 4 px |
| Large grey fills | Mottle badly | Use hatch, whitespace and rules — never grey blocks |
| Ghosting | Partial refresh smears | Full refresh on every update |
| No colour | — | Contrast is the only emphasis channel |

**Hatch is the grey substitute.** Three places need a "more/less" ramp with no
colour and no flat grey: night in the daylight band, the unlit limb of the moon,
and the UV/AQI index scales. All three use the same 45° hatch at varying density
(white → 1.5 px → 3 px → 5 px → solid). One visual language: *hatch means less
light, or worse air*.

---

## 4. Architecture

```
  robn4-weather.chenrisius.workers.dev   (already exists, public, no auth)
                     │  one GET, ~91 KB JSON
  ┌──────────────────▼─────────────────────┐
  │ RENDERER  (GH Actions cron, every 15m) │
  │   fetch JSON → derive → Jinja/JS tmpl  │
  │   → headless Chromium 1072x1448        │
  │   → PIL: grayscale, optional dither    │
  │   → publish dash.png to GitHub Pages   │
  └──────────────────┬─────────────────────┘
                     │ HTTPS, ETag-aware
  ┌──────────────────▼─────────────────────┐
  │ KOReader plugin (dashboard.koplugin)   │
  │  wifi up → GET → cache → full refresh  │
  │  → wifi down → draw live clock on top  │
  └────────────────────────────────────────┘
```

**Derived on the renderer, not in the worker:** day/week/day-of-year arithmetic,
day length and dark length from `sun`, the tide curve interpolation, "in 2h 38m"
countdowns recomputed at render time, and Beaufort/sea-state phrasing.

**Three host options**, in the order I'd try them:

1. **GitHub Actions + Pages.** Free, no server, no secrets. The catch: scheduled
   workflows are best-effort — 5–20 min late is normal — and Actions pauses cron
   on repos with 60 days of no activity. For a dashboard you glance at, fine.
2. **Fly.io / small VPS with Chromium.** ~$4/mo, reliable 15-minute cadence,
   something to maintain.
3. **satori + resvg-wasm inside the existing worker.** Zero extra
   infrastructure, renders PNG in the Worker with no browser. The cost is design
   freedom: satori supports a flexbox subset only — no CSS grid, no
   `repeating-linear-gradient`. The three grid zones and every hatch would have
   to become inline SVG. Worth it only if host maintenance becomes annoying.

---

## 5. Layout

Canvas 1072 × 1448. Margins 44 side, 40 top, 36 bottom → content 984 × 1372.

```
WEDNESDAY                                            18:52
11 November 2026                               updated 18:52
Week 46 · Day 315 · 50 days left
═══════════════════════════════════════════════════════════
ROBN4 · ROBBINS REEF LIGHT · OBS 18:42          [FRESH 10M]
  58°F  High 63° 14:54  │  ↑  12.6 kt  Gust 14.8 kt
        Low  51° 06:30  │           From S · 182°
        Dew 49° RH 75%  │           Force 4 moderate
  PRESS 1011 mb 29.85″ │ VIS 8.7 nm │ WATER 59.4°
───────────────────────────────────────────────────────────
  ◐  Waxing crescent 8%  │ RISE 06:39   SET  16:43
     Rise 10:07 Set 18:57│ CIVIL 17:12  NAUT 17:45
     Full moon Nov 24    │ LENGTH 10h04 DARK 13h56
  ███████▨░░░░░░░░░░░░░░░░░░▨████████│███████    24h band
───────────────────────────────────────────────────────────
  UV  0 Low    peak 1.1  │  AQI 51 Moderate  PM2.5 20
  ▭▨▨▩▩▩███               │  ▭▨▨▩▩▩███
═══════════════════════════════════════════════════════════
TIDE · THE BATTERY                        MLLW · next 24 h
  3.71 ft flooding ↑  │ HIGH 21:30 4.15 ft  in 2h 38m
                      │ LOW  03:33 0.70 ft  +8h 41m
                      │ HIGH 09:38 5.02 ft  +14h 46m
      ╭──╮                  ╭──╮                          curve
  ╶───╯  ╰────╮        ╭────╯  ╰────╮        ╭──
  CURRENT 0.35 kt ebb SSW · slack 19:27 · flood 22:14
───────────────────────────────────────────────────────────
MARINE · ANZ338 NEW YORK HARBOR             issued 18:08
TONIGHT [S 5–10 kt][≤1 ft]  S winds 5 to 10 kt, becoming…
THU     [E 10–15 G20][1–2 ft] E winds 10 to 15 kt with…
───────────────────────────────────────────────────────────
50 DAYS LEFT · 86%  ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌│┆┆┆┆
72% · wifi off           robn4-weather v3.18.1 · AQI fallback
```

### The vertical budget — the most useful constraint in the design

Every zone has a hard pixel height and clips. These must sum to **1372**:

```
header 150 · rule 32 · conditions 250 · rule 24 · sky 200 · rule 24
windfc 134 · rule 32 · tide 290 · rule 24 · marine 180 · footer 32
```

Adding anything means taking pixels from something already on the page. This is
deliberate: on a postcard, every addition should have to argue against an
incumbent.

---

## 6. Widget notes

**Conditions.** Temperature and wind get equal visual weight — for a harbour
station the wind *is* the headline. Wind shows speed, gust, direction in degrees
and Beaufort force together, because 12.6 kt means something different at
gust-factor 1.17 than at 1.5. The arrow points downwind (rotated `dir + 180°`)
while the label says "From S", so the picture and the words can't be confused.
Pressure, visibility and water temperature sit in a quieter strip: they matter,
but you read them second.

**Freshness is a first-class element.** The worker reports `feed_status` with
age and thresholds, so the station line carries a boxed `FRESH 10M` chip that
becomes `STALE 52M` past the threshold. A marine dashboard that silently shows a
two-hour-old wind reading is worse than one showing nothing.

**Sun.** Rise, set, civil and nautical dusk, day length and dark length. The 24 h
band underneath is the part you actually read at a glance: night solid, civil
twilight hatched, day white, a 4 px now-marker and a tick at solar noon.

**Moon.** Terminator drawn as exact geometry — a half-ellipse of semi-minor axis
`r·|1−2f|`, sweep flipping at `f = 0.5`, mirrored for waning. Lit limb is
paper-white with a 3 px outline, unlit is hatched. Note the worker's `phase`
(0.091) is the *cycle position*, not illumination; the disc must be drawn from
`illumination_pct` (8%) with waxing/waning taken from `phase < 0.5`.

**UV and AQI.** A bare number is meaningless without its scale, so each sits on a
banded bar with a marker triangle — UV against 0–11+, AQI against the 6 EPA
bands. The band word ("Low", "Moderate") comes straight from the worker.

**Tide.** The centrepiece, and the one thing here that genuinely needs a chart.
The next three extremes as text, plus a 24-hour curve interpolated cosine-wise
between successive extremes — which is how tide curves are actually drawn. Highs
are filled dots, lows hollow, every extreme labelled with height, and `NOW` is a
heavy rule at the left edge. Below it, the tidal *current* (a different thing
from tide height, and the one that matters under way): speed, set, and the next
slack.

**Marine.** ANZ338 verbatim, because NWS marine wording is precise and
paraphrasing it would be a disservice. Parsed wind and wave chips sit in front
for glanceability; the raw text is clamped to two lines.

**Year.** Compressed to a single 44 px strip — "50 days left · 86%" with a
52-week tick bar. It earned less space than it had when the page was emptier.

---

## 7. Typography and ink

- **Inter** — all numerals, labels, data. Tabular figures throughout.
- **Literata** — date headline, phase names, marine forecast prose.

| Role | Size | Weight |
|---|---|---|
| Hero (clock, temp, wind, tide) | 76–116 | 300 |
| Date headline | 52 | 400 Literata |
| Section value | 25–31 | 400 |
| Body / forecast prose | 23 | 400 Literata |
| Secondary | 19–22 | 400 |
| Label caps | 18–21 | 600, tracked .12–.14em |

```
--paper #FFFFFF   --ink #000000   --ink-2 #3A3A3A (never below 19px)   --rule #9A9A9A (rules only)
```

---

## 8. Refresh, power, staleness

The render is up to 15 minutes old at best, hours if a fetch fails — so **the
clock is not baked into the PNG.** The image reserves a blank rectangle; the
plugin draws real `HH:MM` from the device clock. The `updated 18:52` line beneath
comes from the PNG, so the gap between the two numbers *is* the staleness
indicator.

On open: show cache immediately → `NetworkMgr:runWhenOnline()` → conditional GET
→ `304` done / `200` cache + full refresh → wifi down. On failure, keep the
cached image and overlay a `STALE 2h 14m` badge. Skip the network entirely if the
cache is under 10 minutes old. Wifi is the dominant power cost, so it goes down
the moment the GET resolves.

**Nearly free bonus:** write the fetched PNG to KOReader's custom screensaver
path, and closing the cover leaves the dashboard on screen at zero battery cost.

---

## 9. Failure modes

| Failure | Behaviour |
|---|---|
| Worker returns `ok:false` or a section `available:false` | That zone renders its frame with `—`; footer names the degraded source |
| Feed stale per `feed_status` | `STALE 52M` chip replaces `FRESH`; observation values stay but are marked |
| AirNow down (already happening) | Footer says `AQI open-meteo (AirNow down)`, from `aqi.fallback_reason` |
| Worker unreachable | Previous PNG retained; renderer refuses to overwrite |
| Device offline | Cached PNG + plugin staleness badge |

Stale data clearly labelled beats no data; both beat wrong data shown as current.

---

## 10. Build order

| Phase | Deliverable | State |
|---|---|---|
| 0 | Pixel-exact mockup at 1:1 with live values | **done** |
| 1 | Template parameterised from worker JSON; fonts self-hosted | **done** |
| 2 | Grayscale pass: 16-level palette, no dither (225 KB -> 68 KB) | **done** |
| 2b | Wind forecast (block strip); UV/AQI demoted to the strip; render-error guard | **done** |
| 3 | GH Actions cron + Pages publish | **done — live** |
| 4 | KOReader plugin: fetch, cache, full refresh, staleness badge | **done — ran clean on hardware** |
| 5 | On-glass tuning: contrast, hatch pitch, type sizes | **done — hatch and type held at 300ppi; chart replaced by blocks** |

Phase 5 matters more than it looks. Every e-ink decision above is a prediction;
the panel is the only authority. Expect to redo the hatch pitch — 1.5 px lines
may well disappear — and bump two or three type sizes.

---

## 11. Open questions

1. **`verdict`** — the worker computes a go/caution/no-go sailing call against
   J/24 thresholds, with flags. It is clearly the point of the original
   dashboard. Not included here because you didn't ask for it; a chip in the
   header would cost ~40 px and could replace the year strip.
2. **Time format** — 24 h throughout at the moment. Confirm, or switch to 12 h.
3. **Temperature** — °F, matching the worker. Confirm.
4. **Unused data worth a slot?** `waves` (1 ft now, 2 ft peak 07:00), `seas`
   (1.6 ft at the Harbour Entrance buoy), `hourly`/`wind_forecast` (25 h series
   that would make a good sparkline), and `alerts` (currently 0 — but it needs a
   designed treatment for when it isn't).
5. **Refresh cadence** — 15 min assumed. Tides and marine move slowly; wind does
   not.

---

## 16. Adding the wind forecast — what it cost

The 25-hour `wind_forecast` series earned a slot. The page was already full at
1372 px, so it was paid for by evicting two things:

| Evicted | Pixels | Real cost |
|---|---|---|
| 52-week tick strip | 44 | **None.** The header meta line now reads "Week 46 · Day 315 · 50 days / 7.1 weeks left in 2026" — every fact the strip carried is still there in words. Only decoration was lost. |
| UV + AQI banded scales | 90 | **Modest.** UV and AQI moved into the conditions strip as compact cells: `UV 0 Low`, `AQI 51 Moderate`. They lose the proportional band bars, so you can no longer see *where in the range* a value sits — but the band word was always doing most of that work. |

A third, smaller cost: the strip now carries five cells instead of three, which
forced `inHg` out of the pressure cell. It shows `1011 mb ↓`. The millibar value
and the trend direction are what you act on; the inches reading is a lookup.

### What the chart can and cannot do

It gets 134 px — about 88 px of actual plot once the heading and hour labels are
taken out, dropping to ~44 px when an active alert claims its bar back. Over a
0–35 kt range that is roughly 2.5 kt per 10 px.

So it reads as **shape, not value**: "calm tonight, building through tomorrow
morning, gusting 30 by evening" is legible at a glance. Reading the forecast
speed at 14:00 off the trace is not. The design leans into that — the gust
envelope is hatched rather than plotted as a second line, direction arrows are
placed every four hours rather than hourly, and only the top gridline is
labelled, because at 88 px tall the 10 kt lines sit 17 px apart and stacked
labels collide.

If reading values matters more than reading shape, the honest fix is not more
tuning — it is the **two-page layout** from §5: the renderer emits two PNGs and
the plugin flips on a right-edge tap. The wind forecast would get a full screen,
and the UV/AQI scales and year strip could come back.

### A failure mode this exposed

Removing the year strip left `$('year').classList.add('off')` in the alert
branch. On the one code path that ran it, `null.classList` threw, aborting the
template script mid-way — and the renderer **still exited 0 and wrote a
plausible-looking PNG** with most of its text silently missing.

The template now wraps its whole script in try/catch, sets
`data-render="ok"` on completion, and paints a black `RENDER ERROR` banner on
failure. `render.js` passes `--dump-dom` alongside `--screenshot` (one Chrome
run gives both) and refuses to publish unless it sees the marker. A half-built
page that screenshots cleanly is the worst failure this system can have; it is
now impossible to ship one.

---

## 17. The device half

### The clock problem, resolved differently than planned

§8 proposed that the plugin draw a live `HH:MM` natively into a blank rectangle
reserved in the PNG. In practice that requires matching Inter Light at 116 px
with a KOReader font face, positioned to the pixel — unverifiable without the
device, and ugly when it is a little off.

The shipped answer keeps the honesty guarantee at a fraction of the risk: the
PNG keeps its baked clock, and the plugin draws a **staleness badge** over the
footer whenever the image is older than `stale_after`. You are never misled,
because the moment the clock could be wrong, there is a badge saying so. A small
bordered badge is forgiving about font metrics in a way a 116 px numeral is not.

The live-clock overlay remains a possible refinement once the plugin has been
tuned on glass.

### The manifest

`render.js` writes `dashboard.json` (~215 B) next to the PNG:

```json
{"rendered_at":1794443451,"rendered_iso":"...","width":1072,"height":1448,
 "bytes":71543,"image":"dashboard.png","worker_version":"3.18.1",
 "feed_level":"fresh","summary":"58F 11.3kt tide 3.91ft"}
```

It does two jobs. The device polls it instead of the image, so an unchanged
dashboard costs 215 bytes rather than 70 KB of wifi time. And it carries
`rendered_at` from the renderer, so staleness is judged against when the page was
actually built rather than against an HTTP header or the device's own guess.

### What is verified and what is not

Verified here: both Lua files parse against the 5.1 *and* LuaJIT grammars; every
identifier resolves to a local, so no module name is typo'd; all 30 requires are
used; the local server serves the manifest and image correctly and rejects path
traversal.

Not verified: **anything that needs a Kindle.** KOReader's widget APIs and
`NetworkMgr` change between releases. The three most likely to need adjusting are
`key_events` (its table format changed), `NetworkMgr:turnOffWifi()` (guarded with
an existence check, but it may fight KOReader's own wifi management), and
`ImageWidget` scaling — the PNG is exactly 1072×1448 so the scale factor should
resolve to 1 and resample nothing, but that is an assumption until seen.

A note on the Lua check: `\u{XXXX}` string escapes are a LuaJIT extension that
plain Lua 5.1 rejects. The first draft used one for the badge's em dash. It now
uses a literal UTF-8 em dash, which is just bytes and works under either.

### API verification against the actual device (KOReader v2026.07.2)

The Kindle ships KOReader's full Lua source, so the three risks flagged above
were checked against the real frontend rather than guessed:

| Flagged risk | Verdict |
|---|---|
| `key_events` table format | **Correct as written.** `Close = { { Device.input.group.Back } }` is exactly what `imageviewer.lua` and `bookmapwidget.lua` use in this release. |
| `NetworkMgr:turnOffWifi()` | **Exists and is implemented.** The base class declares an empty stub; `frontend/device/kindle/device.lua:441` provides the real Kindle implementation. `isWifiOn` is aliased to `sysfsWifiOn`. |
| `ImageWidget` scaling | **Was wrong — fixed.** With `width`/`height` set and `scale_factor` nil, ImageWidget *stretches to those dimensions ignoring aspect ratio*, taking a resample path even at 1:1. Now passes `scale_factor = 1`, which keeps the native bitmap with no resampling at all — the thing that preserves 300 ppi hairlines and the hatch. The manifest's `width`/`height` are compared against the panel first, falling back to `scale_factor = 0` (best fit, aspect preserved) if a render is ever not panel-sized. |

Also confirmed present on device: `OverlapGroup`, `BottomContainer`,
`RightContainer`, `GestureRange`, `Dispatcher`; `Size.border.thick` and
`Size.padding.small`; `Dispatcher:registerAction(name, value)`;
`socketutil:set_timeout(block, total)` and `reset_timeout()`;
`registerToMainMenu(widget)`; and `common/rapidjson.so`, so JSON decoding takes
the fast path rather than the dkjson fallback.

What remains genuinely untested is only what needs the thing switched on:
whether the hatch survives the panel's 16 grey levels, whether contrast and type
sizes hold up at 300 ppi, and whether the refresh behaviour feels right.

### First run on hardware (11 Nov, KOReader v2026.07.2)

It worked on the first attempt. From `crash.log`:

```
19:45:08 WARN  PluginLoader: dashboard name in _meta.lua, is deprecated and will be ignored.
19:47:36 INFO  dashboard: new render 2026-11-12T00:39:51.461Z - 57F 11.5kt tide 4.21ft
19:47:36 INFO  dashboard: image cached, 70681 bytes
```

No Lua errors, no tracebacks. The manifest-then-image flow, the cache write and
the logging all behaved. Two things came out of the log that were worth fixing:

**1. `name` in `_meta.lua` is deprecated.** `pluginloader.lua:256` explicitly
discards it and warns on every startup. Removed — the directory name is used
instead. (The `name` in `main.lua`'s `WidgetContainer:extend{}` is a different
field and is still required.)

**2. A failed refresh was completely silent.** The log shows two
`NetworkMgr:enableWifi: Connection failed!` entries at 20:08 with *no* dashboard
line after them. Reading the source explains why — `runWhenOnline`'s own
documentation says:

> If you're currently connected but without Internet access, it will just
> attempt to re-connect, *without* running the callback.

So when wifi fails to associate, our callback never fires: the user taps refresh
and gets nothing at all — no image change, no error, no indication the tap
registered. The obvious alternative, `goOnlineToRun`, is the wrong tool: it
blocks the UI, kills pending callbacks, and only works when `wifi_enable_action`
is `turn_on`.

The fix keeps `runWhenOnline` and adds a deadline. A `started` flag is set on
entry to the callback, and a 25-second `UIManager:scheduleIn` reports failure if
it was never set. Because the flag is set on *entry*, a merely slow fetch cannot
trip it — only never getting online does.

This is the class of bug that only ever appears in the field: everything is
correct, nothing throws, and the feature just quietly does nothing.

---

## 18. The wind forecast, second attempt

§16 admitted the line chart read as shape, not value — 88 px over a 0–35 kt
range is about 2.5 kt per 10 px. On glass that turned out to be the weakest
thing on the page, so it was rebuilt as blocks, following the pattern from the
existing ROBN4 web dashboard.

**Why 12 blocks and not 24.** 24 columns in 984 px is 41 px each, which cannot
hold a number like `11.5` at a legible size. Twelve two-hour blocks give 76 px
per column — comfortable for a 28 px figure — and still cover the full 24 hours.

**Each block reports its maximum, not a sample.** Sampling the hourly series
every two hours would silently drop any peak falling between samples, which on a
wind forecast is the one thing you cannot afford to lose. Each block carries the
highest wind and highest gust inside its window, and the direction arrow comes
from the hour that produced the peak wind.

**The gust chip breaks the hatch convention, deliberately.** Everywhere else on
the page, more ink means less light or more intensity — the moon's unlit limb,
night in the daylight band, the old index scales. The gust chip carries a
*number*, and text over a hatch pattern is unreadable on e-ink. So intensity is
encoded as border weight and inversion instead, on Beaufort boundaries:

| Gust | Chip |
|---|---|
| < 17 kt (below F5) | thin border, regular weight |
| 17–27 kt (F5–F6) | heavy border, semibold |
| ≥ 28 kt (F7+) | solid black, reversed out |

Three states rather than five, because legibility beat granularity. The
underlying `band` value in the view model still has all five levels, so a future
layout with more room can use them.

**It degrades better than the chart did.** When an active alert claims its 44 px
back, the arrows drop out and the type tightens, but all twelve blocks and every
number survive — where the line chart simply became an illegible 44 px smear.

Read across the live strip and the forecast tells itself: `4.7 4.3 2.7` with
thin chips overnight, climbing through `9.0 9.1 9.3`, then `14.0 14.7` under
solid black chips at `30` and `32` by evening.

---

## 19. Moving the clock off GitHub

The design assumed the hosting choice could own the schedule too. That was the
one wrong call in the deployment, and it was wrong in a way worth recording,
because the symptom looked exactly like the failure mode the whole staleness
system was built to expose.

**What happened.** The dashboard rendered perfectly and then stopped updating.
Not broken — frozen, with a correct-looking page from 20:39 and a device badge
honestly reporting its age. The tally after 3h20m:

| Trigger | Fired |
|---|---|
| `push` | 7 of 7 |
| `workflow_dispatch` | 4 of 4 |
| `schedule` | **1 of ~46** |

Eleven for eleven on everything that wasn't the scheduler. One for forty-six on
the scheduler, across two cron expressions and 11.6 hours — and that single
delivery landed three minutes off its slot. A 2% delivery rate is not a slow
scheduler; it is an absent one that occasionally remembers.

**What it wasn't.** Workflow on the default branch, API reporting
`state=active`, not a fork, valid YAML, no 60-day inactivity disable. The usual
suspects were all cleared. Offsetting cron to `7,22,37,52` to dodge the
top-of-hour stampede — the documented mitigation — changed nothing, because the
runs were not being delayed. Forty-five of forty-six were never created.

**The reasoning error.** GitHub's docs say `schedule` "can be delayed during
periods of high loads" and guarantee no delivery on any plan. That was read as
a latency caveat and mitigated as one, with a staleness badge to tell the truth
about late renders. But for a dashboard the schedule is not a supporting detail
— it *is* the product. A renderer that produces a perfect PNG on demand and a
device that honestly reports a six-hour-old image still add up to a dashboard
nobody wants. Best-effort was the wrong reliability tier for the one component
that had to work unattended, and no amount of honesty downstream fixes that.

**The fix: separate the clock from the renderer.**

```
Cloudflare cron  ->  workflow_dispatch  ->  Actions renders  ->  Pages  ->  Kindle
   (says "now")        (the one API call)     (unchanged)
```

Cloudflare delivers cron triggers; `workflow_dispatch` fired 4 of 4. Compose the
two and the dashboard runs on the paths that were observed to work, rather than
on the one that was not. Everything downstream is untouched: same `render.js`,
same workflow, same Pages deployment, same plugin.

**What it costs.** One credential, where the project previously had none — a
GitHub fine-grained token, scoped to Actions: write on this single repository,
stored as a Worker secret. That is the honest price, and the reason GitHub's own
scheduler was given every chance first. The scope is as small as the grant can
be made: that token can start a workflow in one repo and do nothing else. Not a
classic `repo` token, which would carry write access to everything.

**Three ways the new single point of failure announces itself.** A token has a
finite life, so the day it expires is a scheduled outage:

- the device badges the image with its real age — the failure the user sees;
- the Worker's health page flips `healthy: false`, from the public manifest and
  no token at all;
- `wrangler tail` prints `dispatch failed 401`, naming the cause.

The first one is what mattered. Throughout the outage the Kindle kept telling
the truth about what it was showing, which is why the problem was diagnosable at
all rather than a dashboard quietly lying about the tide.

**What stayed.** GitHub's `schedule` block is still in the workflow, dormant,
with the `concurrency` group making a duplicate render harmless on the rare
occasion it does fire. The launchd plist stays too, uninstalled, as a one-command bridge
that needs no credential — useful precisely when the token is the thing that
broke.

**Measured, after the switch.** Cloudflare fired its first slot one second late:

| | |
|---|---|
| cron slot | 14:30:07Z |
| Worker invoked | 14:30:08Z (+1.0 s) |
| GitHub run created | 14:45:18Z (next slot, after a token fix) |
| published | 14:45:26Z |

Against GitHub's one delivery in forty-six, that is the whole argument. The
15:00 slot is not an improvement on the 14:30 slot — it is the point: a clock
that is boring is a clock that works.

**Two things went wrong in the setup, and both are worth recording because
neither was a code fault.**

The first was mine to own: the token was stored as the secret *name* rather than
its value. Secret names are not secret — they appear in `wrangler secret list`,
in deploy output and in the dashboard — so the token had to be revoked and
replaced. The cause was ergonomic. A copyable one-liner ending in
`secret put GITHUB_TOKEN` invites pasting the token onto the end of it. The fix
is to remove the choice: `npm run secret` hardcodes the name, so the only thing
left to type is the hidden prompted value.

The second was a permission, and the useful part is how cheaply it localised.
`403 Resource not accessible by personal access token` means the token
authenticated and was then refused, which is a different fault from `401` (bad
token) and `404` (wrong repo) — one glance, no guessing. The underlying trap:
choosing *Public Repositories (read-only)* for Repository access grants
read-only no matter what the Permissions section then says.

**And one design idea that did not survive contact.** The health page reports
`token_bound`, which was true throughout the 403 and therefore told nobody
anything. The obvious fix — probe the token with a cheap authenticated read —
is worse than nothing: on a *public* repo even a read-only token passes such a
read, so the page would have shown a green light on a chain that could not
dispatch. There is no introspection endpoint for a fine-grained token's
permissions, so the only honest test of "can this token dispatch" is
dispatching. A health page can report the last *observed* dispatch outcome; it
cannot predict the next one. Reporting history beats asserting capability.
