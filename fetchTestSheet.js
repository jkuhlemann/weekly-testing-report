#!/usr/bin/env node
require("dotenv").config();

const {
  fetchSheetData,
  parseRows,
  buildCurrentWeekReport,
  buildStaleTestsReport,
} = require("./googleSheet");

async function main() {
  try {
    const data = await fetchSheetData();
    const rows = parseRows(data);
    const currentWeekReport = buildCurrentWeekReport(rows);
    const staleTestsReport = buildStaleTestsReport(rows);

    const payload = {
      sheetRange: data.range,
      totalRowsFetched: rows.length,
      currentWeekReport,
      staleTestsReport,
    };

    console.log(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error("Failed to fetch Google Sheet data.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

main();
