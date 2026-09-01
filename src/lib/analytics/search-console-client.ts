import { getGoogleServiceAccountAccessToken } from "./google-service-account";

export const SEARCH_CONSOLE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/webmasters.readonly";
export const SEARCH_CONSOLE_ROW_LIMIT = 25_000;
export const SEARCH_CONSOLE_DIMENSIONS = [
  "date",
  "query",
  "page",
  "country",
  "device",
] as const;

export interface SearchConsoleApiRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

interface SearchConsoleApiResponse {
  rows?: SearchConsoleApiRow[];
}

export interface SearchConsoleQueryRequest {
  startDate: string;
  endDate: string;
  dimensions: string[];
  type: "web";
  aggregationType: "auto";
  dataState: "final";
  rowLimit: number;
  startRow: number;
}

export class SearchConsoleApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "SearchConsoleApiError";
  }
}

export function getSearchConsoleSiteUrl(
  environment: { SEARCH_CONSOLE_SITE_URL?: string } = process.env as {
    SEARCH_CONSOLE_SITE_URL?: string;
  }
): string {
  const value = environment.SEARCH_CONSOLE_SITE_URL;
  if (!value || value !== value.trim()) {
    throw new Error("Missing or whitespace-padded SEARCH_CONSOLE_SITE_URL");
  }
  if (
    !/^sc-domain:[a-z0-9.-]+$/i.test(value) &&
    !/^https:\/\/[a-z0-9.-]+(?::\d+)?\/$/i.test(value)
  ) {
    throw new Error("Invalid SEARCH_CONSOLE_SITE_URL property identity");
  }
  return value;
}

export function buildSearchConsoleRequest(
  reportingDate: string,
  startRow = 0,
  rowLimit = SEARCH_CONSOLE_ROW_LIMIT
): SearchConsoleQueryRequest {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportingDate)) {
    throw new Error("Invalid Search Console reporting date");
  }
  if (!Number.isInteger(startRow) || startRow < 0) {
    throw new Error("Invalid Search Console start row");
  }
  if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 25_000) {
    throw new Error("Invalid Search Console row limit");
  }
  return {
    startDate: reportingDate,
    endDate: reportingDate,
    dimensions: [...SEARCH_CONSOLE_DIMENSIONS],
    type: "web",
    aggregationType: "auto",
    dataState: "final",
    rowLimit,
    startRow,
  };
}

export async function fetchSearchConsoleDate(
  reportingDate: string,
  options: {
    siteUrl?: string;
    rowLimit?: number;
    fetchImpl?: typeof fetch;
    accessToken?: () => Promise<string>;
  } = {}
): Promise<SearchConsoleApiRow[]> {
  const siteUrl = options.siteUrl ?? getSearchConsoleSiteUrl();
  const rowLimit = options.rowLimit ?? SEARCH_CONSOLE_ROW_LIMIT;
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = await (
    options.accessToken ??
    (() => getGoogleServiceAccountAccessToken(SEARCH_CONSOLE_READONLY_SCOPE))
  )();
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl
  )}/searchAnalytics/query`;
  const rows: SearchConsoleApiRow[] = [];

  for (let startRow = 0; startRow <= 50_000; startRow += rowLimit) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildSearchConsoleRequest(reportingDate, startRow, rowLimit)
      ),
    });
    if (!response.ok) {
      throw new SearchConsoleApiError(
        response.status,
        `Search Console query failed (${response.status})`
      );
    }
    const body = (await response.json()) as SearchConsoleApiResponse;
    const page = Array.isArray(body.rows) ? body.rows : [];
    rows.push(...page);
    if (page.length < rowLimit) break;
  }
  return rows;
}
