/* robn4-dashboard-cron — the trigger GitHub's own scheduler never pulled.
 *
 * GitHub Actions' `schedule` event is explicitly best-effort, and on this repo
 * it delivered 0 of ~13 slots while every push and workflow_dispatch fired in
 * seconds. So the clock moves off GitHub: Cloudflare's cron triggers fire the
 * render workflow by API instead.
 *
 * scheduled() is the whole job. fetch() is a credential-free health page: it
 * reads the published manifest, so you can see at a glance whether the chain
 * (cron -> dispatch -> render -> Pages) is actually delivering.
 */

const API_VERSION = '2022-11-28';
// GitHub rejects API requests without a User-Agent. Deliberately generic: it
// travels to a third party, so it names the job, never the person running it.
const UA = 'robn4-dashboard-cron';

async function dispatch(env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}` +
              `/actions/workflows/${env.WORKFLOW_FILE}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': API_VERSION,
      'user-agent': UA,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ref: env.GIT_REF }),
  });
  // A successful dispatch is 204 No Content. Anything else carries a reason in
  // the body, and that reason is the only thing that makes a failure fixable:
  // 401 expired token, 403 missing actions:write, 404 wrong repo/workflow path.
  if (res.status === 204) return { ok: true, status: 204 };
  return { ok: false, status: res.status, body: (await res.text()).slice(0, 400) };
}

export default {
  async scheduled(event, env, ctx) {
    if (!env.GITHUB_TOKEN) {
      console.error('no GITHUB_TOKEN bound — run: wrangler secret put GITHUB_TOKEN');
      return;
    }

    let r = await dispatch(env);

    // One retry, because a cron tick that loses a transient 5xx is a 15-minute
    // hole in the dashboard and Cloudflare does not re-run a failed tick.
    if (!r.ok && r.status >= 500) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const again = await dispatch(env);
      console.log(`retry after ${r.status}: ${again.ok ? 'ok' : again.status}`);
      r = again;
    }

    if (r.ok) console.log(`dispatched ${env.WORKFLOW_FILE}@${env.GIT_REF}`);
    else console.error(`dispatch failed ${r.status}: ${r.body}`);
  },

  // Health page. Reads only the public manifest — no token, nothing to leak,
  // and nothing here can trigger a render, so the URL is safe to leave open.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });

    let out = {
      worker: 'robn4-dashboard-cron',
      triggers: 'every 15 min (Cloudflare cron)',
      dispatches: `${env.GITHUB_REPO} ${env.WORKFLOW_FILE}@${env.GIT_REF}`,
      token_bound: Boolean(env.GITHUB_TOKEN),
    };

    try {
      const res = await fetch(`${env.DASHBOARD_URL}/dashboard.json?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'user-agent': UA },
      });
      if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
      const m = await res.json();
      const age = Math.round(Date.now() / 1000) - m.rendered_at;
      out.dashboard = {
        rendered_iso: m.rendered_iso,
        age_minutes: Math.round(age / 60),
        summary: m.summary,
        // The honest verdict: renders land every 15 min, so anything past ~35
        // means a link in the chain is down, not merely slow.
        healthy: age < 35 * 60,
      };
    } catch (err) {
      out.dashboard = { error: String(err.message || err) };
    }

    return new Response(JSON.stringify(out, null, 2) + '\n', {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  },
};
