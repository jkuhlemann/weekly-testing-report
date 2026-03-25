#!/usr/bin/env node
/**
 * Posts a Slack message built from stdin (e.g. pipe from buildWeeklyReport.js).
 * Uses an Incoming Webhook: https://api.slack.com/messaging/webhooks
 *
 * Env: SLACK_WEBHOOK_URL (required)
 *      SLACK_WEBHOOK_FALLBACK_TEXT or SLACK_REPORT_TITLE — notification preview text
 */
require("dotenv").config({ quiet: true });

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url || !String(url).trim()) {
    console.error("Set SLACK_WEBHOOK_URL (Slack Incoming Webhook URL).");
    process.exitCode = 1;
    return;
  }

  const raw = await readStdin();
  if (!String(raw).trim()) {
    console.error("No JSON on stdin. Example: node buildWeeklyReport.js | node postSlackWebhook.js");
    process.exitCode = 1;
    return;
  }

  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    console.error("stdin is not valid JSON.");
    process.exitCode = 1;
    return;
  }

  const fallbackText =
    process.env.SLACK_WEBHOOK_FALLBACK_TEXT ||
    process.env.SLACK_REPORT_TITLE ||
    "Weekly Testing Report";

  const payload = {
    text: fallbackText,
    ...message,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();
  const ok = response.ok && bodyText.trim().toLowerCase() === "ok";
  if (!ok) {
    console.error(`Slack webhook failed: HTTP ${response.status} — ${bodyText.slice(0, 500)}`);
    process.exitCode = 1;
    return;
  }

  console.log("Posted to Slack.");
}

main();
