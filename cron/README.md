# robn4-dashboard-cron

The clock for the Kindle dashboard.

## Why this exists

The render itself runs fine on GitHub Actions. What never worked was GitHub's
*scheduler*. Measured on this repo:

| Trigger | Fired |
|---|---|
| `push` | 7 of 7 |
| `workflow_dispatch` | 4 of 4 |
| `schedule` | **1 of ~46** |

Measured over 11.6 hours. One slot in forty-six is a 2% delivery rate, and the
one that landed was three minutes off its cron time — while everything that
wasn't the scheduler ran in seconds. GitHub documents `schedule` as best-effort
and makes no delivery guarantee on any plan, so this is within spec; it is just
useless for a dashboard, where the schedule *is* the product. An hourly digest
could live with 2%. A 15-minute dashboard cannot.

So the clock moved to Cloudflare, which does deliver cron triggers. Rendering
and hosting stay on GitHub. This Worker's only job is to say "now".

```
Cloudflare cron (every 15 min)
      -> POST /actions/workflows/render.yml/dispatches
            -> GitHub Actions renders the PNG
                  -> deploys to Pages
                        -> Kindle picks it up
```

## Setup

### 1. Install wrangler

```bash
cd cron && npm install
```

### 2. Sign in to Cloudflare

```bash
cd cron && npx wrangler login
```

Opens a browser; approve the account that already hosts your two Workers.

### 3. Create the GitHub token

This is the one credential in the whole project, so keep it as small as it can
possibly be. In GitHub → Settings → Developer settings →
**Fine-grained personal access tokens** → Generate new token:

| Field | Value |
|---|---|
| Resource owner | `chenrisius` |
| Repository access | **Only select repositories** → `robn4-kindle-dashboard` |
| Repository permissions | **Actions: Read and write** — and nothing else |
| Expiration | your call; see *When it expires* below |

Do not pick *Public Repositories (read-only)* at the Repository access step.
It grants read-only regardless of what you then set under Permissions, and the
failure surfaces only at the first cron tick, as
`403 Resource not accessible by personal access token`.

`Metadata: Read-only` is added automatically and cannot be removed. That is the
whole grant: it can start a workflow in one repository and do nothing else. Not
a classic token — a classic `repo` token would have write access to every
repository you own.

### 4. Store it as a secret

```bash
cd cron && npm run secret
```

Use the npm script, not `wrangler secret put` typed by hand. It hardcodes the
name, so there is nothing to mistype — and the first attempt at this stored the
**token as the secret name**, which is worse than it sounds: secret *names* are
not secret. They appear in `wrangler secret list`, in deploy output and in the
Cloudflare dashboard. That token had to be revoked and replaced.

Wait for `Enter a secret value:` and paste it *there*. The input is hidden, the
value goes straight to Cloudflare's secret store, and nothing lands in this
repo, in `wrangler.toml` or in your shell history.

Verify with `npx wrangler secret list`: it must print exactly one name,
`GITHUB_TOKEN`. If it prints anything starting `github_pat_`, the token leaked
into the name — revoke it and start over.

### 5. Deploy

```bash
cd cron && npx wrangler deploy
```

That uploads the Worker *and* registers the cron trigger.

## Verifying it

The health page needs no token and triggers nothing, so it is safe to open:

```bash
curl -s https://robn4-dashboard-cron.<your-subdomain>.workers.dev | python3 -m json.tool
```

```json
{
  "token_bound": true,
  "dashboard": { "age_minutes": 6, "healthy": true, "summary": "56F 3.7kt tide 4.17ft" }
}
```

`age_minutes` is the real test: renders land every 15 minutes, so anything past
~35 means a link in the chain is down rather than slow.

To watch a tick happen live:

```bash
cd cron && npx wrangler tail --format pretty
```

And from the GitHub side, a working cron shows up as a steady run of dispatches:

```bash
gh run list --repo chenrisius/robn4-kindle-dashboard --limit 10
```

## When it expires

A fine-grained token has a finite life. On the day it dies, the Worker starts
getting `401` and the dashboard quietly stops updating — the exact failure this
project already hit once, from the other end.

Three things make that visible instead of silent:

- the Kindle badges a stale image with its age, so the device itself tells you;
- the health page flips `healthy: false`;
- `wrangler tail` prints `dispatch failed 401`.

To fix: generate a new token the same way and re-run step 4. No redeploy needed.

## Cost

Free. Cloudflare's free plan includes cron triggers and 100k Worker
invocations/day; this uses 96 plus the odd health check. Actions minutes are
free on a public repository.
