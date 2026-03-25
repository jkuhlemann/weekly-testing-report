const { google } = require("googleapis");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getSpreadsheetId() {
  if (process.env.GOOGLE_SHEETS_SPREADSHEET_ID) {
    return process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  }

  const url = process.env.GOOGLE_SHEETS_SPREADSHEET_URL;
  if (!url) {
    throw new Error(
      "Set GOOGLE_SHEETS_SPREADSHEET_ID or GOOGLE_SHEETS_SPREADSHEET_URL."
    );
  }

  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    throw new Error("Could not extract spreadsheet ID from GOOGLE_SHEETS_SPREADSHEET_URL.");
  }

  return match[1];
}

function getServiceAccountPrivateKey() {
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!privateKey) {
    return null;
  }

  return privateKey.replace(/\\n/g, "\n");
}

async function getAuthClient() {
  if (process.env.GOOGLE_SHEETS_API_KEY) {
    return null;
  }

  const scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (credentialsPath) {
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes,
    });
    return auth.getClient();
  }

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = getServiceAccountPrivateKey();

  if (clientEmail && privateKey) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes,
    });
    return auth.getClient();
  }

  throw new Error(
    [
      "Missing Google Sheets authentication config.",
      "Use GOOGLE_SHEETS_API_KEY for a public sheet,",
      "or set GOOGLE_APPLICATION_CREDENTIALS,",
      "or set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.",
    ].join(" ")
  );
}

async function fetchSheetData() {
  const spreadsheetId = getSpreadsheetId();
  const range = requireEnv("GOOGLE_SHEETS_RANGE");
  const majorDimension = process.env.GOOGLE_SHEETS_MAJOR_DIMENSION || "ROWS";
  const valueRenderOption =
    process.env.GOOGLE_SHEETS_VALUE_RENDER_OPTION || "FORMATTED_VALUE";
  const dateTimeRenderOption =
    process.env.GOOGLE_SHEETS_DATE_TIME_RENDER_OPTION || "SERIAL_NUMBER";
  const authClient = await getAuthClient();

  const sheets = google.sheets({
    version: "v4",
    auth: authClient || undefined,
  });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    majorDimension,
    valueRenderOption,
    dateTimeRenderOption,
    key: process.env.GOOGLE_SHEETS_API_KEY || undefined,
  });

  return response.data;
}

function parseRows(data) {
  const rows = data.values || [];
  if (rows.length === 0) {
    return [];
  }

  const [headers, ...records] = rows;

  return records.map((record) => {
    const row = {};

    headers.forEach((header, index) => {
      row[header] = record[index] ?? "";
    });

    return row;
  });
}

function parseIsoDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function getStartOfCurrentWeek(referenceDate = new Date()) {
  const utcDate = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate()
    )
  );
  const day = utcDate.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;

  utcDate.setUTCDate(utcDate.getUTCDate() - daysSinceMonday);
  return utcDate;
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function getStartOfDayUtc(referenceDate = new Date()) {
  return new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate()
    )
  );
}

function buildCurrentWeekReport(rows, referenceDate = new Date()) {
  const weekStart = getStartOfCurrentWeek(referenceDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  const testedThisWeek = rows.filter((row) => {
    const timestamp = parseIsoDate(row.timestamp);
    if (!timestamp) {
      return false;
    }

    return timestamp >= weekStart && timestamp <= weekEnd;
  });

  return {
    reportType: "current_week_tests",
    weekStart: formatIsoDate(weekStart),
    weekEnd: formatIsoDate(weekEnd),
    totalTests: testedThisWeek.length,
    testedThisWeek,
  };
}

/**
 * When GOOGLE_SHEETS_MANUAL_TEST_COLUMN is set, only rows whose cell matches one of
 * GOOGLE_SHEETS_MANUAL_TEST_VALUES (comma-separated, case-insensitive) count as manual.
 * When unset, every row is treated as a manual test record (typical dedicated log sheet).
 */
function parseManualTestValueMatchers() {
  const raw = process.env.GOOGLE_SHEETS_MANUAL_TEST_VALUES || "manual";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isManualTestRow(row) {
  const column = process.env.GOOGLE_SHEETS_MANUAL_TEST_COLUMN;
  if (!column || !String(column).trim()) {
    return true;
  }

  const cell = row[column];
  if (cell === undefined || cell === null || String(cell).trim() === "") {
    return false;
  }

  const normalized = String(cell).trim().toLowerCase();
  const matchers = parseManualTestValueMatchers();
  return matchers.some((m) => normalized === m);
}

function buildStaleTestsReport(rows, referenceDate = new Date(), maxAgeDays = 30) {
  const today = getStartOfDayUtc(referenceDate);
  const cutoffDate = new Date(today);
  cutoffDate.setUTCDate(today.getUTCDate() - maxAgeDays);

  const testsOlderThanThreshold = rows.filter((row) => {
    if (!isManualTestRow(row)) {
      return false;
    }

    const timestamp = parseIsoDate(row.timestamp);
    if (!timestamp) {
      return false;
    }

    return timestamp < cutoffDate;
  });

  return {
    reportType: "stale_manual_tests_warning",
    maxAgeDays,
    cutoffDate: formatIsoDate(cutoffDate),
    totalTests: testsOlderThanThreshold.length,
    warning: testsOlderThanThreshold.length > 0,
    testsOlderThanThreshold,
  };
}

module.exports = {
  fetchSheetData,
  parseRows,
  buildCurrentWeekReport,
  buildStaleTestsReport,
  isManualTestRow,
};
