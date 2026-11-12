/* Synthesises worker payloads for states we can't wait around for:
   a dead feed, an active marine alert, and a stale station. */
import { readFileSync, writeFileSync } from 'node:fs';
const base = JSON.parse(readFileSync('fixtures/live.json', 'utf8'));
const clone = () => JSON.parse(JSON.stringify(base));

/* 1. Half the upstreams down, nulls everywhere they're allowed */
const degraded = clone();
degraded.visibility = { available: false };
degraded.tide = { available: false };
degraded.current = { available: false };
degraded.forecast = { available: false };
degraded.uv = { available: false };
degraded.aqi = { available: false };
degraded.air = { temperature_f: 57.7, dew_point_f: null, humidity_pct: null, high_f: null, low_f: null };
degraded.pressure = { mb: null, inHg: null, trend: null };
degraded.moon = { phase: 0.62, illumination_pct: 91, label: 'Waning Gibbous' };
writeFileSync('fixtures/test-degraded.json', JSON.stringify(degraded, null, 2));

/* 2. Active small craft advisory + stale feed + waning moon */
const alert = clone();
alert.alerts = { available: true, count: 2,
  alerts: [{ event: 'Small Craft Advisory' }, { event: 'Gale Watch' }] };
alert.feed_status = { ...base.feed_status, level: 'stale', fresh: false, stale: true, age_minutes: 73 };
alert.wind = { ...base.wind, speed_kt: 27.4, gust_kt: 38.2, beaufort_force: 7,
               beaufort_desc: 'Near Gale', direction_deg: 51, direction_cardinal: 'NE' };
alert.moon = { ...base.moon, phase: 0.78, illumination_pct: 64, label: 'Waning Gibbous' };
writeFileSync('fixtures/test-alert.json', JSON.stringify(alert, null, 2));

/* 3. Worst case: worker answers but says almost nothing */
writeFileSync('fixtures/test-empty.json', JSON.stringify({ ok: true, version: '3.18.1',
  air: { temperature_f: 41 }, wind: {}, tide: { available: false } }, null, 2));

console.log('wrote 3 test fixtures');
