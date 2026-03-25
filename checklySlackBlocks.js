/**
 * Builds Slack Block Kit payloads for the weekly testing report.
 * Combines Checkly monitoring data and manual test data from Google Sheets.
 * Paste the printed JSON into https://app.slack.com/block-kit-builder.
 */

const GROUP_LABELS = {
  checkGroup: "API checks",
  e2e: "End-to-end",
  landingPage: "Landing page",
  publicRoutes: "Public routes",
};

const CHECK_TYPE_SUFFIXES = [
  " API Check",
  " Browser Check",
  " E2E Check",
  " URL Monitor",
  " ICMP Monitor",
  " TCP Monitor",
  " DNS Monitor",
  " Heartbeat Monitor",
  " Multistep Check",
  " Playwright Check",
  " Check",
  " Monitor",
];

const AVAILABILITY_EMOJI = {
  green: "large_green_circle",
  orange: "large_orange_circle",
  red: "red_circle",
  none: "white_circle",
};

const DEFAULT_OPTIONS = {
  title: "Weekly Testing Report",
};

function cleanCheckName(rawName) {
  let name = rawName || "Unnamed";
  for (const suffix of CHECK_TYPE_SUFFIXES) {
    const idx = name.indexOf(suffix);
    if (idx !== -1) {
      name = name.slice(0, idx) + name.slice(idx + suffix.length);
      break;
    }
  }
  return name.trim();
}

function availabilityEmojiName(pct) {
  if (pct >= 95) return AVAILABILITY_EMOJI.green;
  if (pct >= 85) return AVAILABILITY_EMOJI.orange;
  return AVAILABILITY_EMOJI.red;
}

function formatAvailabilityText(successRatio) {
  if (successRatio == null || Number.isNaN(successRatio)) {
    return "n/a";
  }
  const pct = Number(successRatio);
  if (pct === 100) return "100%";
  if (pct >= 99.9) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

function buildCheckRichTextSection(check) {
  const name = cleanCheckName(check.name || check.id);
  const hasData = check.successRatio != null && !Number.isNaN(check.successRatio);
  const emojiName = hasData
    ? availabilityEmojiName(Number(check.successRatio))
    : AVAILABILITY_EMOJI.none;
  const availText = formatAvailabilityText(check.successRatio);

  return {
    type: "rich_text_section",
    elements: [
      { type: "emoji", name: emojiName },
      { type: "text", text: `  ${name}`, style: { bold: true } },
      { type: "text", text: `  —  ${availText}` },
    ],
  };
}

function formatTestName(testType) {
  return (testType || "unnamed_test").replace(/_/g, " ");
}

function manualTestEmojiName(row) {
  const status = (row.status || "").toLowerCase();
  if (status === "fail") return AVAILABILITY_EMOJI.red;
  const bugs = Number(row.bugs_found);
  if (bugs > 0) return AVAILABILITY_EMOJI.orange;
  return AVAILABILITY_EMOJI.green;
}

function buildManualTestRichTextSection(row) {
  const name = formatTestName(row.test_type);
  const emojiName = manualTestEmojiName(row);

  const elements = [
    { type: "emoji", name: emojiName },
    { type: "text", text: `  ${name}`, style: { bold: true } },
  ];

  const details = [];
  if (row.status) details.push(row.status);
  const bugs = Number(row.bugs_found);
  if (bugs > 0) {
    details.push(`${bugs} bug${bugs === 1 ? "" : "s"}`);
  }
  if (row.environment) details.push(row.environment);

  if (details.length > 0) {
    elements.push({ type: "text", text: `  —  ${details.join(" · ")}` });
  }

  return { type: "rich_text_section", elements };
}

// --- Checkly blocks ---

function buildChecklyGroupBlocks(checklyPayload) {
  const blocks = [];
  const groupKeys = Object.keys(checklyPayload.groups || {}).sort();

  for (const key of groupKeys) {
    const group = checklyPayload.groups[key];
    if (!group) continue;

    const label = GROUP_LABELS[key] || key;
    const checks = Array.isArray(group.checks) ? group.checks : [];

    blocks.push({ type: "divider" });
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: label, emoji: true },
    });

    if (checks.length > 0) {
      blocks.push({
        type: "rich_text",
        elements: [{
          type: "rich_text_list",
          style: "bullet",
          elements: checks.map(buildCheckRichTextSection),
        }],
      });
    }
  }

  const errors = checklyPayload.errors;
  if (errors && typeof errors === "object" && Object.keys(errors).length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: "⚠️ Errors", emoji: true },
    });

    blocks.push({
      type: "rich_text",
      elements: [{
        type: "rich_text_list",
        style: "bullet",
        elements: Object.entries(errors).map(([k, msg]) => ({
          type: "rich_text_section",
          elements: [
            { type: "text", text: k, style: { bold: true } },
            { type: "text", text: ` — ${String(msg)}` },
          ],
        })),
      }],
    });
  }

  return blocks;
}

// --- Manual test blocks ---

function buildManualTestBlocks(sheetPayload) {
  const blocks = [];
  const week = sheetPayload.currentWeekReport;
  if (!week) return blocks;

  const tests = week.testedThisWeek || [];

  blocks.push({ type: "divider" });
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: "Manual tests", emoji: true },
  });

  blocks.push({
    type: "context",
    elements: [{
      type: "mrkdwn",
      text: `${tests.length} test${tests.length === 1 ? "" : "s"} completed  ·  ${week.weekStart} → ${week.weekEnd}`,
    }],
  });

  if (tests.length > 0) {
    blocks.push({
      type: "rich_text",
      elements: [{
        type: "rich_text_list",
        style: "bullet",
        elements: tests.map(buildManualTestRichTextSection),
      }],
    });

    const withComments = tests.filter((t) => t.comments);
    if (withComments.length > 0) {
      const noteElements = [];
      for (const t of withComments) {
        const name = formatTestName(t.test_type);
        noteElements.push(
          { type: "text", text: name, style: { bold: true } },
          { type: "text", text: `: ${t.comments}\n` },
        );
      }
      noteElements[noteElements.length - 1].text =
        noteElements[noteElements.length - 1].text.trimEnd();

      blocks.push({
        type: "rich_text",
        elements: [{
          type: "rich_text_quote",
          elements: noteElements,
        }],
      });
    }
  }

  const stale = sheetPayload.staleTestsReport;
  if (stale && stale.totalTests > 0) {
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `⚠️ ${stale.totalTests} manual test${stale.totalTests === 1 ? "" : "s"} last run more than ${stale.maxAgeDays} days ago (before ${stale.cutoffDate})`,
      }],
    });
  }

  return blocks;
}

// --- Combined report ---

/**
 * @param {{ checkly?: object, sheet?: object }} report
 * @param {Partial<typeof DEFAULT_OPTIONS>} [options]
 * @returns {object[]} Slack Block Kit blocks array
 */
function buildWeeklyReportBlocks(report, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const blocks = [];

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: opts.title.slice(0, 150),
      emoji: true,
    },
  });

  if (report.checkly) {
    blocks.push(...buildChecklyGroupBlocks(report.checkly));
  }

  if (report.sheet) {
    blocks.push(...buildManualTestBlocks(report.sheet));
  }

  if (blocks.length > 50) {
    return blocks.slice(0, 49).concat([{
      type: "section",
      text: { type: "mrkdwn", text: "_Truncated (Slack limit: 50 blocks)._" },
    }]);
  }

  return blocks;
}

function buildWeeklyReportMessage(report, options) {
  return { blocks: buildWeeklyReportBlocks(report, options) };
}

/** Backward compat: Checkly-only message. */
function buildChecklySlackMessage(checklyPayload, options) {
  return buildWeeklyReportMessage({ checkly: checklyPayload }, options);
}

module.exports = {
  GROUP_LABELS,
  buildChecklyGroupBlocks,
  buildManualTestBlocks,
  buildWeeklyReportBlocks,
  buildWeeklyReportMessage,
  buildChecklySlackMessage,
  cleanCheckName,
};
