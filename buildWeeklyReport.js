#!/usr/bin/env node
require("dotenv").config({ quiet: true });

const {
  getChecklyMultiGroupFetchSpecFromEnv,
  fetchAllChecks,
  indexChecksByGroupId,
  fetchChecklyGroupApiOverview,
  fetchChecklyReporting,
  indexReportingByCheckId,
} = require("./checkly");

const {
  fetchSheetData,
  parseRows,
  buildCurrentWeekReport,
  buildStaleTestsReport,
} = require("./googleSheet");

const { buildWeeklyReportMessage } = require("./checklySlackBlocks");

async function fetchChecklyPayload() {
  const spec = getChecklyMultiGroupFetchSpecFromEnv();
  if (!spec) return null;

  const { apiKey, accountId, groups } = spec;
  const creds = { apiKey, accountId };
  const payload = { fetchedAt: new Date().toISOString(), groups: {} };
  const errors = {};
  let hadError = false;

  let reportingIndex = new Map();
  try {
    const reportingData = await fetchChecklyReporting(creds, "last7Days");
    reportingIndex = indexReportingByCheckId(reportingData);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Failed to fetch Checkly reporting data.");
    console.error(msg);
    errors._reporting = msg;
    hadError = true;
  }

  let allChecksIndex = null;
  try {
    const allChecks = await fetchAllChecks(creds);
    allChecksIndex = indexChecksByGroupId(allChecks);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Failed to fetch Checkly checks list.");
    console.error(msg);
    errors._checksList = msg;
    hadError = true;
  }

  for (const { key, groupId } of groups) {
    try {
      const groupData = await fetchChecklyGroupApiOverview(
        { apiKey, accountId, groupId, groupKey: key },
        allChecksIndex,
      );
      for (const check of groupData.checks) {
        const report = reportingIndex.get(check.id);
        if (report?.aggregate) {
          check.successRatio = report.aggregate.successRatio;
          check.avgResponseTime = report.aggregate.avg;
          check.p95ResponseTime = report.aggregate.p95;
          check.p99ResponseTime = report.aggregate.p99;
        }
      }
      payload.groups[key] = groupData;
    } catch (error) {
      hadError = true;
      const msg = error instanceof Error ? error.message : String(error);
      errors[key] = msg;
      console.error(`Failed to fetch Checkly group "${key}" (${groupId}).`);
      console.error(msg);
    }
  }

  if (hadError) payload.errors = errors;
  return payload;
}

async function fetchSheetPayload() {
  const data = await fetchSheetData();
  const rows = parseRows(data);
  return {
    sheetRange: data.range,
    totalRowsFetched: rows.length,
    currentWeekReport: buildCurrentWeekReport(rows),
    staleTestsReport: buildStaleTestsReport(rows),
  };
}

async function main() {
  const report = {};

  try {
    report.checkly = await fetchChecklyPayload();
  } catch (error) {
    console.error("Checkly fetch failed entirely.");
    console.error(error instanceof Error ? error.message : error);
  }

  try {
    report.sheet = await fetchSheetPayload();
  } catch (error) {
    console.error("Google Sheet fetch failed.");
    console.error(error instanceof Error ? error.message : error);
  }

  if (!report.checkly && !report.sheet) {
    console.error("No data from either source. Check your .env configuration.");
    process.exitCode = 1;
    return;
  }

  const title = process.env.SLACK_REPORT_TITLE;
  const message = buildWeeklyReportMessage(report, title ? { title } : undefined);
  process.stdout.write(`${JSON.stringify(message, null, 2)}\n`);
}

main();
