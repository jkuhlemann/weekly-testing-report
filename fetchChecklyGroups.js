#!/usr/bin/env node
require("dotenv").config({ quiet: true });

const {
  CHECKLY_GROUP_ENV_DEFINITIONS,
  getChecklyMultiGroupFetchSpecFromEnv,
  fetchAllChecks,
  indexChecksByGroupId,
  fetchChecklyGroupApiOverview,
  fetchChecklyReporting,
  indexReportingByCheckId,
} = require("./checkly");

function formatMissingGroupsHelp() {
  const vars = CHECKLY_GROUP_ENV_DEFINITIONS.map((d) => d.envVar).join(", ");
  return `Set at least one of: ${vars}`;
}

async function main() {
  const spec = getChecklyMultiGroupFetchSpecFromEnv();
  if (!spec) {
    const credsOk =
      process.env.CHECKLY_API_KEY && process.env.CHECKLY_ACCOUNT_ID;
    if (!credsOk) {
      console.error(
        "Set CHECKLY_API_KEY and CHECKLY_ACCOUNT_ID in your environment or .env file."
      );
    } else {
      console.error(
        `${formatMissingGroupsHelp()} (with CHECKLY_API_KEY and CHECKLY_ACCOUNT_ID).`
      );
    }
    process.exitCode = 1;
    return;
  }

  const { apiKey, accountId, groups } = spec;
  const creds = { apiKey, accountId };
  const payload = {
    fetchedAt: new Date().toISOString(),
    groups: {},
  };
  /** @type {Record<string, string>} */
  const errors = {};
  let hadError = false;

  let reportingIndex = new Map();
  try {
    const reportingData = await fetchChecklyReporting(creds, "last7Days");
    reportingIndex = indexReportingByCheckId(reportingData);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to fetch Checkly reporting data.");
    console.error(message);
    errors._reporting = message;
    hadError = true;
  }

  let allChecksIndex = null;
  try {
    const allChecks = await fetchAllChecks(creds);
    allChecksIndex = indexChecksByGroupId(allChecks);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to fetch Checkly checks list.");
    console.error(message);
    errors._checksList = message;
    hadError = true;
  }

  for (const { key, groupId } of groups) {
    try {
      const groupData = await fetchChecklyGroupApiOverview({
        apiKey,
        accountId,
        groupId,
        groupKey: key,
      }, allChecksIndex);

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
      const message = error instanceof Error ? error.message : String(error);
      errors[key] = message;
      console.error(`Failed to fetch Checkly group "${key}" (${groupId}).`);
      console.error(message);
    }
  }

  if (hadError) {
    payload.errors = errors;
  }

  console.log(JSON.stringify(payload, null, 2));

  if (hadError) {
    process.exitCode = 1;
  }
}

main();
