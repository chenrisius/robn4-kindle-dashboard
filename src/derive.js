/* Worker JSON -> view model for the Kindle dashboard template.
 *
 * Every accessor is defensive: the worker marks whole sections with
 * `available:false`, and any field may be null. Nothing in here throws;
 * missing values become EM ("—") so a dead upstream section degrades to a
 * labelled gap instead of killing the render.
 */

export const TZ = 'America/New_York';
const EM = '—';

/* ---------- timezone helpers (no dependencies) ---------- */

function tzParts(date, tz = TZ) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) if (part.type !== 'literal') p[part.type] = part.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

function tzOffsetMs(date, tz = TZ) {
  const p = tzParts(date, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - date.getTime();
}

/** Build a Date from wall-clock components in `tz`. Iterates to settle DST. */
function fromLocal(y, mo, d, h, mi, tz = TZ) {
  let ts = Date.UTC(y, mo, d, h, mi);
  for (let i = 0; i < 2; i++) ts = Date.UTC(y, mo, d, h, mi) - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

/** Parse the worker's "Nov 11, 6:39 AM" local strings. Year is inferred from `ref`. */
export function parseLocal(str, ref = new Date(), tz = TZ) {
  if (!str || typeof str !== 'string') return null;
  const m = str.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase());
  if (mo < 0) return null;
  let h = +m[3] % 12;
  if (/PM/i.test(m[5])) h += 12;
  const refY = tzParts(ref, tz).y;
  let dt = fromLocal(refY, mo, +m[2], h, +m[4], tz);
  // the string carries no year: snap to whichever year puts it nearest `ref`
  const HALF_YEAR = 182 * 864e5;
  if (dt - ref > HALF_YEAR) dt = fromLocal(refY - 1, mo, +m[2], h, +m[4], tz);
  else if (ref - dt > HALF_YEAR) dt = fromLocal(refY + 1, mo, +m[2], h, +m[4], tz);
  return dt;
}

/** Prefer the unambiguous *_utc field; fall back to parsing *_local. */
function when(obj, base, ref) {
  if (!obj) return null;
  const utc = obj[base + '_utc'];
  if (utc) { const d = new Date(utc); if (!isNaN(d)) return d; }
  return parseLocal(obj[base + '_local'], ref);
}

const hm = (d) => {
  if (!d || isNaN(d)) return EM;
  const p = tzParts(d);
  return String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0');
};

/** Fractional hours past local midnight, for positioning on the 24 h band. */
const hourOf = (d) => { if (!d || isNaN(d)) return null; const p = tzParts(d); return p.h + p.mi / 60; };

const dur = (ms) => {
  if (ms == null || !isFinite(ms)) return EM;
  const sign = ms < 0 ? '-' : '';
  const t = Math.abs(Math.round(ms / 60000));
  return `${sign}${Math.floor(t / 60)}h ${String(t % 60).padStart(2, '0')}m`;
};

const n1 = (v) => (v == null || !isFinite(v)) ? EM : (Math.round(v * 10) / 10).toFixed(1);
const n2 = (v) => (v == null || !isFinite(v)) ? EM : v.toFixed(2);
const n0 = (v) => (v == null || !isFinite(v)) ? EM : String(Math.round(v));
const ok  = (sec) => sec && sec.available !== false;

/* ---------- index scales ---------- */
/* Segment widths are PROPORTIONAL to the real band ranges, so a linear marker
   position is honest. Equal-width segments would misplace every value. */
const UV_MAX = 12;
const UV_BANDS  = [{ w: 3, h: 0 }, { w: 3, h: 1 }, { w: 2, h: 2 }, { w: 3, h: 3 }, { w: 1, h: 4 }];
const AQI_MAX = 300;
const AQI_BANDS = [{ w: 50, h: 0 }, { w: 50, h: 1 }, { w: 50, h: 2 }, { w: 50, h: 3 }, { w: 100, h: 4 }];
const markerPct = (v, max) => v == null ? 0 : Math.min(Math.max(v / max, 0.025), 1) * 100;

/* ---------- main ---------- */

export function derive(d, now = new Date()) {
  const out = {};
  const P = tzParts(now);

  /* --- date / time --- */
  const startOfYear = Date.UTC(P.y, 0, 1);
  const todayUTC = Date.UTC(P.y, P.mo - 1, P.d);
  const dayOfYear = Math.round((todayUTC - startOfYear) / 864e5) + 1;
  const daysInYear = ((P.y % 4 === 0 && P.y % 100 !== 0) || P.y % 400 === 0) ? 366 : 365;
  const daysLeft = daysInYear - dayOfYear;
  // ISO-8601 week number
  const dt = new Date(todayUTC);
  const dow = (dt.getUTCDay() + 6) % 7;            // Mon = 0
  dt.setUTCDate(dt.getUTCDate() - dow + 3);        // Thursday of this week
  const isoYearStart = Date.UTC(dt.getUTCFullYear(), 0, 4);
  const isoWeek = 1 + Math.round(((dt - isoYearStart) / 864e5 - 3 + ((new Date(isoYearStart).getUTCDay() + 6) % 7)) / 7);

  const fmt = (o) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o }).format(now);
  out.meta = {
    weekday:  fmt({ weekday: 'long' }).toUpperCase(),
    dateFull: `${P.d} ${fmt({ month: 'long' })} ${P.y}`,
    // carries the full year-progress text, so the 52-week tick strip can be
    // dropped for the wind forecast without losing any actual information
    metaLine: `Week ${isoWeek} · Day ${dayOfYear} · ${daysLeft} days / ` +
              `${(daysLeft / 7).toFixed(1)} weeks left in ${P.y}`,
    clock:    hm(now),
    updated:  `updated ${hm(when(d, 'updated', now) || new Date(d?.updated ?? now))}`
  };
  out.year = {
    label: `${daysLeft} days left · ${Math.round(dayOfYear / daysInYear * 100)}%`,
    week: Math.min(isoWeek, 52), total: 52
  };

  /* --- station + feed freshness --- */
  const st = d?.station, fs = d?.feed_status;
  out.station = {
    line: st ? `${st.id ?? EM} · ${st.name ?? EM} · obs ${hm(when(fs, 'last_obs', now))}` : EM,
    chip: fs ? `${(fs.level ?? '').toUpperCase() || 'UNKNOWN'} ${fs.age_minutes ?? EM}M` : 'NO FEED',
    stale: !(fs?.fresh)
  };

  /* --- air --- */
  const a = d?.air;
  out.air = {
    temp: n0(a?.temperature_f),
    high: n0(a?.high_f), highTime: hm(parseLocal(a?.high_time_local, now)),
    low:  n0(a?.low_f),  lowTime:  hm(parseLocal(a?.low_time_local, now)),
    dew:  n0(a?.dew_point_f), rh: n0(a?.humidity_pct)
  };

  /* --- wind --- */
  const w = d?.wind;
  out.wind = {
    kt: n1(w?.speed_kt), gust: n1(w?.gust_kt),
    cardinal: w?.direction_cardinal ?? EM, deg: n0(w?.direction_deg),
    // the arrow points DOWNWIND; the label says where it blows FROM
    arrowDeg: (w?.direction_deg ?? 0) + 180,
    // "F4" not "Force 4": standard shorthand, and it buys the ~60px that lets the
    // full descriptor fit at every force ("F4 moderate breeze", "F12 hurricane force")
    beaufort: w?.beaufort_force != null
      ? `F${w.beaufort_force} ${String(w.beaufort_desc ?? '').toLowerCase()}`.trim() : EM
  };

  /* --- pressure / visibility / water --- */
  const pr = d?.pressure, vis = d?.visibility, wa = d?.water;
  // The strip carries five cells now (UV and AQI joined it), so every trailing
  // string is cut to the bone: the trend becomes an arrow, water drops its source.
  const TREND = { falling: '↓', rising: '↑', steady: '→' };
  out.strip = {
    pressV: n0(pr?.mb),
    // inHg dropped: five cells in 984px can't carry it. mb + trend arrow is the
    // reading you act on; the absolute inHg value is a lookup, not a glance.
    pressX: pr ? `mb ${TREND[pr.trend] ?? ''}`.trim() : EM,
    visV: ok(vis) ? n1(vis.nm) : EM,
    visX: ok(vis) ? `nm · ${vis.station ?? EM}` : 'n/a',
    waterV: wa?.temperature_f != null ? n1(wa.temperature_f) + '°' : EM,
    waterX: ''
  };

  /* --- moon --- */
  const mo = d?.moon;
  out.moon = {
    // `phase` is cycle position (0=new, .5=full), NOT illumination.
    // The disc must be drawn from illumination_pct; phase only picks the limb.
    illum: mo?.illumination_pct ?? null,
    waxing: mo?.phase != null ? mo.phase < 0.5 : true,
    label: mo?.label ? `${mo.label} · ${mo.illumination_pct ?? EM}%` : EM,
    rise: hm(when(mo, 'moonrise', now)), set: hm(when(mo, 'moonset', now)),
    next: mo?.next_full_local ? `Full moon ${mo.next_full_local.split(',')[0]}`
        : mo?.next_new_local  ? `New moon ${mo.next_new_local.split(',')[0]}` : EM
  };

  /* --- sun --- */
  const s = d?.sun;
  const sr = parseLocal(s?.sunrise_local, now), ss = parseLocal(s?.sunset_local, now);
  const civ = parseLocal(s?.civil_twilight_end_local, now);
  const nau = parseLocal(s?.nautical_twilight_end_local, now);
  const dayMs = (sr && ss) ? ss - sr : null;
  out.sun = {
    rise: hm(sr), set: hm(ss), civil: hm(civ), naut: hm(nau),
    length: dur(dayMs), dark: dayMs != null ? dur(864e5 - dayMs) : EM
  };

  /* --- 24 h daylight band ---
     The worker gives civil dusk but not civil dawn. Twilight is near-symmetric
     about solar noon, so dawn is mirrored from the dusk interval. */
  const hRise = hourOf(sr), hSet = hourOf(ss), hCiv = hourOf(civ);
  const twilightLen = (hCiv != null && hSet != null) ? hCiv - hSet : 0.5;
  out.band = {
    dawnCivil: hRise != null ? Math.max(0, hRise - twilightLen) : null,
    rise: hRise, set: hSet,
    civilEnd: hCiv,
    noon: (hRise != null && hSet != null) ? (hRise + hSet) / 2 : null,
    now: P.h + P.mi / 60,
    riseLabel: `↑ ${hm(sr)}`, setLabel: `↓ ${hm(ss)}`
  };

  /* --- wind forecast ---
     25 hourly points of wind + gust. The gust spread is the informative part:
     14 kt steady and 14 kt gusting 32 are very different afternoons, so the
     chart carries both as an envelope rather than a single trace. */
  const wf = d?.wind_forecast;
  const wfPts = (ok(wf) && Array.isArray(wf.periods) ? wf.periods : [])
    .map(p => { const at = when(p, 'time', now); return at && !isNaN(at) ? {
      h: (at - now) / 36e5, at,
      kt: p.wind_kt, gust: (p.gust_kt != null && p.gust_kt > p.wind_kt) ? p.gust_kt : p.wind_kt,
      deg: p.dir_deg, card: p.dir_cardinal
    } : null; })
    .filter(p => p && p.kt != null && p.h >= -1.5 && p.h <= 24)
    .sort((x, y) => x.h - y.h);

  let pk = null;
  for (const p of wfPts) if (p.h >= 0 && (!pk || p.gust > pk.gust)) pk = p;

  // 12 two-hour blocks covering the next 24 h, snapped to whole clock hours so
  // the labels land on 20, 22, 00 ... rather than 19:39, 21:39.
  //
  // Each block reports the MAX wind and MAX gust inside its window, not a
  // sample at the boundary. Sampling every 2 h would silently drop a peak that
  // falls between samples, which on a wind forecast is the one thing you cannot
  // afford to lose.
  const BLOCK_H = 2, N_BLOCKS = 12;
  const startMs = Math.ceil(now.getTime() / 36e5) * 36e5;        // next whole hour
  const blocks = [];
  for (let i = 0; i < N_BLOCKS; i++) {
    const from = startMs + i * BLOCK_H * 36e5;
    const to = from + BLOCK_H * 36e5;
    const inBlock = wfPts.filter(p => p.at >= from && p.at < to);
    if (!inBlock.length) { blocks.push(null); continue; }
    let top = inBlock[0];
    for (const p of inBlock) if (p.kt > top.kt) top = p;
    blocks.push({
      label: hm(new Date(from)).slice(0, 2),
      // always one decimal, so the row reads as an aligned numeric column
      // rather than ragged "9 / 9.1 / 14 / 14.7"
      kt: Math.max(...inBlock.map(p => p.kt)).toFixed(1),
      gust: Math.round(Math.max(...inBlock.map(p => p.gust))),
      deg: top.deg, card: top.card,
      // Beaufort-aligned shading for the gust chip: F<4, F4, F5, F6, F7+.
      // Same hatch ramp as the moon and the daylight band - more ink, more wind.
      band: (function (g) {
        if (g < 11) return 0;
        if (g < 17) return 1;
        if (g < 22) return 2;
        if (g < 28) return 3;
        return 4;
      })(Math.max(...inBlock.map(p => p.gust))),
    });
  }

  out.windForecast = {
    available: blocks.filter(Boolean).length >= 3,
    blocks,
    peak: pk ? `peak gust ${n0(pk.gust)} kt ${hm(pk.at)}` : '',
    nowHour: P.h + P.mi / 60
  };

  /* --- UV / AQI --- */
  const uv = d?.uv, aq = d?.aqi;
  out.uv = {
    value: ok(uv) ? n0(uv.current) : EM, band: ok(uv) ? (uv.band ?? EM) : 'unavailable',
    x: ok(uv) && uv.peak_today != null
       ? `peak ${n1(uv.peak_today)} · ${hm(parseLocal(uv.peak_time_local, now))}` : '',
    available: ok(uv), bands: UV_BANDS, marker: ok(uv) ? markerPct(uv.current, UV_MAX) : 0
  };
  out.aqi = {
    value: ok(aq) ? n0(aq.current) : EM, band: ok(aq) ? (aq.band ?? EM) : 'unavailable',
    x: ok(aq) ? `PM2.5 ${n0(aq.pm2_5)} · PM10 ${n1(aq.pm10)}` : '',
    available: ok(aq), bands: AQI_BANDS, marker: ok(aq) ? markerPct(aq.current, AQI_MAX) : 0
  };

  /* --- tide --- */
  const t = d?.tide;
  const sched = (ok(t) && Array.isArray(t.schedule_24h) ? t.schedule_24h : [])
    .map(e => ({ ...e, at: when(e, 'time', now) }))
    .filter(e => e.at && !isNaN(e.at))
    .sort((x, y) => x.at - y.at);

  out.tide = {
    available: ok(t),
    level: ok(t) ? n2(t.current_level_ft) : EM,
    state: ok(t) ? `${t.state ?? EM} ${t.state === 'flooding' ? '↑' : t.state === 'ebbing' ? '↓' : ''}`.trim() : EM,
    station: ok(t) ? (t.reference_station ?? 'The Battery') : 'The Battery',
    next: sched.slice(0, 3).map(e => ({
      k: (e.type ?? '').toUpperCase(),
      time: hm(e.at),
      ht: `${n2(e.height_ft)} ft`,
      countdown: (e.at - now) < 3 * 36e5 ? `in ${dur(e.at - now)}` : `+${dur(e.at - now)}`
    })),
    // curve: observed level now, then every extreme inside the next 24 h
    curve: [
      { h: 0, ft: t?.current_level_ft ?? null, type: 'now' },
      ...sched
        .map(e => ({ h: (e.at - now) / 36e5, ft: e.height_ft, type: (e.type ?? '')[0]?.toUpperCase(), time: hm(e.at) }))
        .filter(p => p.h > 0 && p.h <= 24 && p.ft != null)
    ].filter(p => p.ft != null)
  };

  /* --- tidal current (distinct from tide height) --- */
  const c = d?.current;
  out.current = ok(c) ? {
    text: `${n2(c.velocity_now_kt)} kt ${c.direction ?? ''} ${c.set_cardinal ?? ''}`.trim(),
    detail: [
      (c.state ?? '').replace(/_/g, ' '),
      c.next ? `${c.next.type ?? ''} ${hm(when(c.next, 'time', now))}` : null,
      c.after ? `${c.after.type ?? ''} ${hm(when(c.after, 'time', now))} at ${n1(c.after.velocity_kt)} kt` : null
    ].filter(Boolean).join(' · ')
  } : { text: EM, detail: 'unavailable' };

  /* --- marine forecast --- */
  const f = d?.forecast;
  const chipWind = (p) => {
    if (!p?.wind) return EM;
    const base = `${p.wind.dir ?? ''} ${p.wind.kt_low ?? EM}–${p.wind.kt_high ?? EM} kt`.trim();
    return p.gust_kt ? `${base} G${p.gust_kt}` : base;
  };
  const chipWave = (p) => {
    if (!p?.waves) return EM;
    const { ft_low: lo, ft_high: hi } = p.waves;
    if (hi == null) return EM;
    return (lo == null || lo === 0) ? `≤${hi} ft` : `${lo}–${hi} ft`;
  };
  out.marine = {
    available: ok(f),
    zone: ok(f) ? `${f.zone ?? ''} ${f.zone_name ?? ''}`.trim() : EM,
    issued: ok(f) && f.issue_time_text ? `issued ${hm(parseIssue(f.issue_time_text, now))}` : '',
    rows: (ok(f) && Array.isArray(f.periods) ? f.periods.slice(0, 2) : []).map(p => ({
      name: p.name ?? EM, windChip: chipWind(p), waveChip: chipWave(p), text: p.text ?? EM
    }))
  };

  /* --- alerts: zero today, but it must have a designed state --- */
  const al = d?.alerts;
  out.alerts = (ok(al) && al.count > 0)
    ? { count: al.count, headline: (al.alerts?.[0]?.event ?? 'Active alert').toUpperCase() }
    : null;

  /* --- footer --- */
  const seas = d?.seas;
  out.footer = [
    d?.version ? `robn4-weather v${d.version}` : 'robn4-weather',
    aq?.fallback_used && aq?.fallback_reason ? `AQI ${aq.provider ?? 'fallback'} (${String(aq.fallback_reason).replace(/unavailable/i, 'down')})` : null,
    (seas && seas.fresh === false && seas.age_minutes != null) ? `seas ${seas.age_minutes}m` : null
  ].filter(Boolean).join(' · ');

  return out;
}

/** "608 PM EST Wed Nov 11 2026" -> Date */
function parseIssue(txt, ref) {
  const m = String(txt).match(/^(\d{3,4})\s*(AM|PM)\s+\w+\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{4})/i);
  if (!m) return null;
  const raw = m[1].padStart(4, '0');
  let h = +raw.slice(0, 2) % 12;
  if (/PM/i.test(m[2])) h += 12;
  const mo = MONTHS.indexOf(m[3].toLowerCase());
  if (mo < 0) return null;
  return fromLocal(+m[5], mo, +m[4], h, +raw.slice(2));
}
