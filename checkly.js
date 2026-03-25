const CHECKLY_API_BASE = "https://api.checklyhq.com";

/** Env vars → stable keys in JSON output (set any subset in .env). */
const CHECKLY_GROUP_ENV_DEFINITIONS = [
  { envVar: "CHECKLY_CHECK_GROUP_ID", key: "checkGroup" },
  { envVar: "CHECKLY_E2E_CHECK_GROUP_ID", key: "e2e" },
  { envVar: "CHECKLY_LANDING_PAGE_CHECK_GROUP_ID", key: "landingPage" },
  { envVar: "CHECKLY_PUBLIC_ROUTES_CHECK_GROUP_ID", key: "publicRoutes" },
];

function getChecklyCredentialsFromEnv() {
  const apiKey = process.env.CHECKLY_API_KEY;
  const accountId = process.env.CHECKLY_ACCOUNT_ID;
  if (!apiKey || !accountId) {
    return null;
  }
  return { apiKey, accountId };
}

function getDefinedChecklyGroupsFromEnv() {
  return CHECKLY_GROUP_ENV_DEFINITIONS.map(({ envVar, key }) => {
    const groupId = process.env[envVar];
    return groupId ? { envVar, key, groupId } : null;
  }).filter(Boolean);
}

/**
 * Spec for fetching all configured groups (at least one group id required).
 * @returns {{ apiKey: string, accountId: string, groups: Array<{ envVar: string, key: string, groupId: string }> } | null}
 */
function getChecklyMultiGroupFetchSpecFromEnv() {
  const creds = getChecklyCredentialsFromEnv();
  if (!creds) {
    return null;
  }
  const groups = getDefinedChecklyGroupsFromEnv();
  if (groups.length === 0) {
    return null;
  }
  return { ...creds, groups };
}

/** Single-group config (CHECKLY_CHECK_GROUP_ID only); for backward compatibility. */
function getChecklyConfigFromEnv() {
  const creds = getChecklyCredentialsFromEnv();
  if (!creds) {
    return null;
  }
  const groupId = process.env.CHECKLY_CHECK_GROUP_ID;
  if (!groupId) {
    return null;
  }
  return { apiKey: creds.apiKey, accountId: creds.accountId, groupId };
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String(body.message)
        : text || response.statusText;
    throw new Error(`Checkly API ${response.status}: ${message}`);
  }

  return body;
}

/**
 * Paginates GET /v1/checks and returns all checks in the account.
 */
async function fetchAllChecks(creds) {
  const { apiKey, accountId } = creds;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "X-Checkly-Account": accountId,
  };

  const all = [];
  let page = 1;
  const limit = 100;

  for (;;) {
    const url = new URL(`${CHECKLY_API_BASE}/v1/checks`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));

    const batch = await fetchJson(url.toString(), headers);
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }

    all.push(...batch);
    if (batch.length < limit) {
      break;
    }
    page += 1;
  }

  return all;
}

/**
 * Index checks array by groupId for fast lookup.
 */
function indexChecksByGroupId(allChecks) {
  const map = new Map();
  for (const check of allChecks) {
    const gid = String(check.groupId);
    if (!map.has(gid)) {
      map.set(gid, []);
    }
    map.get(gid).push(check);
  }
  return map;
}

/**
 * Paginates GET /v1/check-groups/{id}/checks and returns checks plus a small summary.
 * Falls back to allChecksIndex (from GET /v1/checks) when the /checks endpoint fails
 * (e.g. mixed check types causing 500 errors on Checkly's side).
 */
async function fetchChecklyGroupApiOverview(config, allChecksIndex) {
  const { apiKey, accountId, groupId, groupKey = String(groupId) } = config;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "X-Checkly-Account": accountId,
  };

  let checks = [];

  try {
    let page = 1;
    const limit = 100;

    for (;;) {
      const url = new URL(
        `${CHECKLY_API_BASE}/v1/check-groups/${encodeURIComponent(groupId)}/checks`
      );
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", String(limit));

      const batch = await fetchJson(url.toString(), headers);
      if (!Array.isArray(batch) || batch.length === 0) {
        break;
      }

      checks.push(...batch);
      if (batch.length < limit) {
        break;
      }
      page += 1;
    }
  } catch {
    if (allChecksIndex) {
      checks = allChecksIndex.get(String(groupId)) || [];
    }
  }

  const byType = {};
  const byStatus = {};

  for (const check of checks) {
    const type = check.checkType ?? "UNKNOWN";
    byType[type] = (byType[type] || 0) + 1;
    const status = check.status ?? "unknown";
    byStatus[status] = (byStatus[status] || 0) + 1;
  }

  return {
    groupKey,
    groupId,
    fetchedAt: new Date().toISOString(),
    totalChecks: checks.length,
    checksByType: byType,
    checksByStatus: byStatus,
    checks,
  };
}

/**
 * GET /v1/reporting — returns per-check aggregate stats (successRatio, avg, p95, p99).
 * @param {{ apiKey: string, accountId: string }} creds
 * @param {string} [quickRange="last7Days"]
 * @returns {Promise<Array<{ name: string, checkId: string, checkType: string, deactivated: boolean, tags: string[], aggregate: { successRatio: number, avg: number, p95: number, p99: number } }>>}
 */
async function fetchChecklyReporting(creds, quickRange = "last7Days") {
  const { apiKey, accountId } = creds;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "X-Checkly-Account": accountId,
  };

  const url = new URL(`${CHECKLY_API_BASE}/v1/reporting`);
  url.searchParams.set("quickRange", quickRange);

  return fetchJson(url.toString(), headers);
}

/**
 * Index reporting array by checkId for fast lookup.
 * @param {Awaited<ReturnType<typeof fetchChecklyReporting>>} reportingData
 */
function indexReportingByCheckId(reportingData) {
  const map = new Map();
  for (const entry of reportingData) {
    if (entry.checkId) {
      map.set(entry.checkId, entry);
    }
  }
  return map;
}

module.exports = {
  CHECKLY_GROUP_ENV_DEFINITIONS,
  getChecklyCredentialsFromEnv,
  getDefinedChecklyGroupsFromEnv,
  getChecklyMultiGroupFetchSpecFromEnv,
  getChecklyConfigFromEnv,
  fetchAllChecks,
  indexChecksByGroupId,
  fetchChecklyGroupApiOverview,
  fetchChecklyReporting,
  indexReportingByCheckId,
};
