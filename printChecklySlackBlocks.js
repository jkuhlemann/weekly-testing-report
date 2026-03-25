#!/usr/bin/env node
/**
 * Reads Checkly JSON from stdin (e.g. `npm run fetch:checkly | node printChecklySlackBlocks.js`)
 * and prints a Slack message object: { "blocks": [...] } for Block Kit Builder / chat.postMessage.
 */

const { buildChecklySlackMessage } = require("./checklySlackBlocks");

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

/**
 * When stdin is `npm run …` banners + dotenv tips + JSON, plain JSON.parse fails.
 * Pulls out the first top-level `{ ... }` object.
 */
function parseChecklyPayloadJson(raw) {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const slice = extractFirstJsonObject(trimmed);
  if (slice) {
    return JSON.parse(slice);
  }

  throw new Error("no JSON object found");
}

function extractFirstJsonObject(s) {
  const start = s.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const c = s[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }

    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }

  return null;
}

async function main() {
  const raw = await readStdin();
  if (!raw) {
    console.error(
      "Usage: pipe Checkly JSON on stdin, e.g.\n  node fetchChecklyGroups.js | node printChecklySlackBlocks.js\n  npm run fetch:checkly --silent | node printChecklySlackBlocks.js"
    );
    process.exitCode = 1;
    return;
  }

  let data;
  try {
    data = parseChecklyPayloadJson(raw);
  } catch {
    console.error(
      "Could not parse Checkly JSON from stdin (expected one top-level object with fetchedAt / groups)."
    );
    process.exitCode = 1;
    return;
  }

  const title = process.env.SLACK_CHECKLY_TITLE;
  const message = buildChecklySlackMessage(data, title ? { title } : undefined);
  process.stdout.write(`${JSON.stringify(message, null, 2)}\n`);
}

main();
