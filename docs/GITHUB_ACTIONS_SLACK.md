# GitHub Actions: weekly Slack report

The workflow [`.github/workflows/weekly-report.yml`](../.github/workflows/weekly-report.yml) runs **every Friday at 11:00 UTC** (same wall-clock as **12:00 CET** when Central Europe is on UTC+1). During **CEST** (UTC+2), that run is **13:00** local in Germany—adjust the cron expression if you need a fixed local time year-round.

| Cron (UTC) | Meaning |
|------------|---------|
| `0 11 * * 5` | Friday 11:00 UTC |

You can also run it anytime: **Actions** → **Weekly report to Slack** → **Run workflow**.

---

## 1. Create a Slack Incoming Webhook

1. Open [Slack API: Your Apps](https://api.slack.com/apps) → **Create New App** (or pick an existing app) → e.g. **From scratch**, name it “Weekly testing report”, pick your workspace.
2. In the app: **Incoming Webhooks** → turn **Activate Incoming Webhooks** **On**.
3. **Add New Webhook to Workspace** → choose the channel (e.g. `#engineering`) → **Allow**.
4. Copy the **Webhook URL** (starts with `https://hooks.slack.com/services/...`).

---

## 2. Add GitHub repository secrets

In GitHub: **Repository** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

### Required for Slack

| Secret | Value |
|--------|--------|
| `SLACK_WEBHOOK_URL` | The webhook URL from step 1. |

### Required for Checkly (if you use Checkly in the report)

| Secret | Value |
|--------|--------|
| `CHECKLY_API_KEY` | From [Checkly API keys](https://app.checklyhq.com/settings/user/api-keys). |
| `CHECKLY_ACCOUNT_ID` | Account ID from [account settings](https://app.checklyhq.com/settings/account/general). |
| At least one group ID | Set one or more of: `CHECKLY_CHECK_GROUP_ID`, `CHECKLY_E2E_CHECK_GROUP_ID`, `CHECKLY_LANDING_PAGE_CHECK_GROUP_ID`, `CHECKLY_PUBLIC_ROUTES_CHECK_GROUP_ID` (numeric IDs from the Checkly UI URL). |

If none of the group secrets are set, the workflow still runs but the Checkly section will be empty.

### Required for Google Sheets (manual tests)

| Secret | Value |
|--------|--------|
| `GOOGLE_SHEETS_RANGE` | Same as local (e.g. `Sheet1!A:Z`). |
| `GOOGLE_SHEETS_SPREADSHEET_ID` **or** `GOOGLE_SHEETS_SPREADSHEET_URL` | Your sheet. |

**Service account (typical for private sheets)**

| Secret | Value |
|--------|--------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the JSON key. |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | `private_key` from the JSON key. You can paste it as a **multiline** secret, or a single line with `\n` where line breaks belong (the app normalizes `\n`). |

Share the spreadsheet with that service account email (**Viewer** is enough for read-only).

**Public sheet with API key (optional alternative)**

| Secret | Value |
|--------|--------|
| `GOOGLE_SHEETS_API_KEY` | Google API key with Sheets API enabled. |

Do **not** set service account secrets if you use only the API key path.

### Optional

| Secret | Purpose |
|--------|---------|
| `SLACK_REPORT_TITLE` | Custom header text for the Slack message and notification preview. |
| `GOOGLE_SHEETS_MANUAL_TEST_COLUMN` | Limit stale warnings to rows where this column matches manual values. |
| `GOOGLE_SHEETS_MANUAL_TEST_VALUES` | Comma-separated values (default locally is `manual`). |

---

## 3. Push the workflow to the default branch

Commit and push `.github/workflows/weekly-report.yml` (and the rest of the repo). Scheduled workflows only run from the **default** branch.

---

## 4. Test manually

1. **Actions** → **Weekly report to Slack**.
2. **Run workflow** → branch **main** (or your default) → **Run workflow**.
3. Open the run log: you should see **Posted to Slack.** and the message in the channel.

---

## 5. Local dry run (optional)

```bash
cp .env.example .env   # then fill in real values
npm run report:slack
```

Same as CI: `buildWeeklyReport.js` → JSON → `postSlackWebhook.js` → Slack.

---

## Troubleshooting

- **`Slack webhook failed: HTTP 400`** — Body too large or invalid blocks; reduce Checkly groups or sheet payload, or check Slack’s limits.
- **`No data from either source`** — Checkly groups and/or Google env vars are missing or wrong; the script exits before posting.
- **Sheet permission denied** — Service account email must be invited to the spreadsheet.
