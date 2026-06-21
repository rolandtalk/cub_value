interface Env {
  ASSETS: Fetcher;
  MARKETDATA_TOKEN: string;
  HOLDINGS_SHEET_ID?: string;
  MARKETDATA_PROXY_URL?: string;
}

interface HoldingRow {
  symbol: string;
  shares: number;
  cost: number;
}

interface HoldingSnapshot extends HoldingRow {
  price: number | null;
  dayChangeValue: number | null;
  dayChangePercent: number | null;
  value: number | null;
  costBasis: number;
  gainValue: number | null;
  gainPercent: number | null;
  perf1d: number | null;
  perf3d: number | null;
  perf5d: number | null;
  perf20d: number | null;
  updatedAt: number | null;
}

interface MarketDataPriceResponse {
  s: string;
  symbol?: string[];
  mid?: number[];
  change?: number[];
  changepct?: number[];
  updated?: number[];
  errmsg?: string;
}

interface MarketDataCandleResponse {
  s: string;
  c?: number[];
  t?: number[];
  errmsg?: string;
}

interface PortfolioResponse {
  asOf: string | null;
  sourceNote: string;
  summary: {
    totalMarketValue: number;
    totalCostBasis: number;
    totalGainValue: number;
    totalGainPercent: number | null;
    dayChangeValue: number;
    dayChangePercent: number | null;
  };
  holdings: HoldingSnapshot[];
}

const DEFAULT_SHEET_ID = "1MLuED5LD_WV8RTkmDCk-VYAyXsO3ZHQ1DiZ2UnL1ViE";
const LOOKBACK_INDEXES: Record<string, number> = {
  perf1d: 1,
  perf3d: 3,
  perf5d: 5,
  perf20d: 20,
};
const SYMBOL_ALIASES: Record<string, string> = {
  ABB: "ABBNY",
  SPDR: "SPY",
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/portfolio") {
      return handlePortfolio(env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function handlePortfolio(env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.MARKETDATA_TOKEN && !env.MARKETDATA_PROXY_URL) {
    return json(
      { error: "Missing MARKETDATA_TOKEN or MARKETDATA_PROXY_URL." },
      { status: 500 },
    );
  }

  try {
    const holdings = await fetchHoldings(env);
    const payload = await enrichPortfolio(holdings, env, ctx);
    return json(payload, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ error: message }, { status: 500 });
  }
}

async function fetchHoldings(env: Env): Promise<HoldingRow[]> {
  const sheetId = env.HOLDINGS_SHEET_ID || DEFAULT_SHEET_ID;
  const csvUrl =
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
  const response = await fetch(csvUrl, {
    headers: { accept: "text/csv,text/plain;q=0.9,*/*;q=0.8" },
  });

  if (!response.ok) {
    throw new Error(`Unable to read holdings sheet (${response.status}).`);
  }

  const csv = await response.text();
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map((value) => value.trim().toLowerCase());
  const symbolIndex = headers.indexOf("sym");
  const sharesIndex = headers.indexOf("shares");
  const costIndex = headers.indexOf("cost");

  if (symbolIndex === -1 || sharesIndex === -1 || costIndex === -1) {
    throw new Error("Expected sheet columns: Sym, Shares, Cost.");
  }

  return lines
    .slice(1)
    .map((line) => parseCsvLine(line))
    .map((row) => ({
      symbol: String(row[symbolIndex] || "").trim().toUpperCase(),
      shares: parseNumericCell(row[sharesIndex]),
      cost: parseNumericCell(row[costIndex]),
    }))
    .filter((row) => row.symbol && Number.isFinite(row.shares) && Number.isFinite(row.cost));
}

async function enrichPortfolio(
  holdings: HoldingRow[],
  env: Env,
  ctx: ExecutionContext,
): Promise<PortfolioResponse> {
  const symbols = holdings.map((holding) => holding.symbol);
  const quotesPromise = fetchQuotes(symbols, env);
  const historyTasks = holdings.map((holding) => fetchHistory(holding.symbol, env));
  const historiesPromise = Promise.all(historyTasks);

  ctx.waitUntil(Promise.allSettled([quotesPromise, historiesPromise]));

  const [quotes, histories] = await Promise.all([quotesPromise, historiesPromise]);
  const snapshots = holdings
    .map((holding, index) => buildSnapshot(holding, quotes.get(holding.symbol), histories[index]))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));

  const totalMarketValue = sumNumbers(snapshots.map((item) => item.value));
  const totalCostBasis = sumNumbers(snapshots.map((item) => item.costBasis));
  const totalGainValue = totalMarketValue - totalCostBasis;
  const dayChangeValue = sumNumbers(snapshots.map((item) => item.dayChangeValue));

  return {
    asOf: latestIsoTimestamp(snapshots.map((item) => item.updatedAt)),
    sourceNote: "Live prices from MarketData.app and holdings from Google Sheets.",
    summary: {
      totalMarketValue,
      totalCostBasis,
      totalGainValue,
      totalGainPercent: totalCostBasis > 0 ? totalGainValue / totalCostBasis : null,
      dayChangeValue,
      dayChangePercent: totalMarketValue - dayChangeValue > 0
        ? dayChangeValue / (totalMarketValue - dayChangeValue)
        : null,
    },
    holdings: snapshots,
  };
}

async function fetchQuotes(symbols: string[], env: Env): Promise<Map<string, {
  price: number | null;
  dayChangeValuePerShare: number | null;
  dayChangePercent: number | null;
  updatedAt: number | null;
}>> {
  if (symbols.length === 0) {
    return new Map();
  }

  const aliasEntries = symbols.map((symbol) => [symbol, resolveMarketSymbol(symbol)] as const);
  const endpoint = buildMarketDataUrl(env, "/quotes");
  endpoint.searchParams.set(
    "symbols",
    Array.from(new Set(aliasEntries.map(([, marketSymbol]) => marketSymbol))).join(","),
  );
  endpoint.searchParams.set("extended", "true");

  const response = await fetch(endpoint.toString());
  if (response.status !== 200 && response.status !== 203) {
    throw new Error(`MarketData price request failed (${response.status}).`);
  }

  const payload = await response.json() as MarketDataPriceResponse;
  if (payload.s !== "ok" || !payload.symbol || !payload.mid) {
    throw new Error(payload.errmsg || "MarketData price payload was incomplete.");
  }

  const prices = new Map<string, {
    price: number | null;
    dayChangeValuePerShare: number | null;
    dayChangePercent: number | null;
    updatedAt: number | null;
  }>();

  const originalsByMarketSymbol = new Map<string, string[]>();
  aliasEntries.forEach(([originalSymbol, marketSymbol]) => {
    const existing = originalsByMarketSymbol.get(marketSymbol) || [];
    existing.push(originalSymbol);
    originalsByMarketSymbol.set(marketSymbol, existing);
  });

  payload.symbol.forEach((marketSymbol, index) => {
    const originals = originalsByMarketSymbol.get(marketSymbol) || [marketSymbol];
    originals.forEach((originalSymbol) => {
      prices.set(originalSymbol, {
        price: payload.mid?.[index] ?? null,
        dayChangeValuePerShare: payload.change?.[index] ?? null,
        dayChangePercent: payload.changepct?.[index] ?? null,
        updatedAt: payload.updated?.[index] ?? null,
      });
    });
  });

  return prices;
}

async function fetchHistory(symbol: string, env: Env): Promise<Record<string, number | null>> {
  const endpoint = buildMarketDataUrl(env, `/candles/${resolveMarketSymbol(symbol)}`);
  endpoint.searchParams.set("countback", "25");

  const response = await fetch(endpoint.toString());
  if (response.status !== 200 && response.status !== 203) {
    return emptyHistory();
  }

  const payload = await response.json() as MarketDataCandleResponse;
  if (payload.s !== "ok" || !payload.c || payload.c.length === 0) {
    return emptyHistory();
  }

  const closes = payload.c;
  const latest = closes[closes.length - 1];
  const performance: Record<string, number | null> = emptyHistory();

  Object.entries(LOOKBACK_INDEXES).forEach(([key, offset]) => {
    const lookbackIndex = closes.length - 1 - offset;
    const priorClose = lookbackIndex >= 0 ? closes[lookbackIndex] : null;
    performance[key] = priorClose && priorClose > 0 ? (latest - priorClose) / priorClose : null;
  });

  return performance;
}

function buildSnapshot(
  holding: HoldingRow,
  quote: {
    price: number | null;
    dayChangeValuePerShare: number | null;
    dayChangePercent: number | null;
    updatedAt: number | null;
  } | undefined,
  history: Record<string, number | null>,
): HoldingSnapshot {
  const price = quote?.price ?? null;
  const costBasis = holding.shares * holding.cost;
  const value = price == null ? null : holding.shares * price;
  const gainValue = value == null ? null : value - costBasis;
  const gainPercent = gainValue == null || costBasis <= 0 ? null : gainValue / costBasis;
  const dayChangeValue = quote?.dayChangeValuePerShare == null
    ? null
    : quote.dayChangeValuePerShare * holding.shares;

  return {
    ...holding,
    price,
    dayChangeValue,
    dayChangePercent: quote?.dayChangePercent ?? null,
    value,
    costBasis,
    gainValue,
    gainPercent,
    perf1d: history.perf1d ?? quote?.dayChangePercent ?? null,
    perf3d: history.perf3d ?? null,
    perf5d: history.perf5d ?? null,
    perf20d: history.perf20d ?? null,
    updatedAt: quote?.updatedAt ?? null,
  };
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseNumericCell(value: string | undefined): number {
  const normalized = String(value || "")
    .replace(/[$,%\s]/g, "")
    .replace(/,/g, "");
  return Number.parseFloat(normalized);
}

function sumNumbers(values: Array<number | null>): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function latestIsoTimestamp(values: Array<number | null>): string | null {
  const latest = values.reduce<number | null>((max, value) => {
    if (value == null) {
      return max;
    }
    return max == null || value > max ? value : max;
  }, null);

  if (latest == null) {
    return null;
  }

  return new Date(latest * 1000).toISOString();
}

function buildMarketDataUrl(env: Env, path: string): URL {
  if (env.MARKETDATA_PROXY_URL) {
    return new URL(path, normalizeBaseUrl(env.MARKETDATA_PROXY_URL));
  }

  if (!env.MARKETDATA_TOKEN) {
    throw new Error("Missing MARKETDATA_TOKEN or MARKETDATA_PROXY_URL.");
  }

  const directPath = path.startsWith("/quotes")
    ? "https://api.marketdata.app/v1/stocks/prices/"
    : `https://api.marketdata.app/v1/stocks/candles/D/${path.split("/").pop()}/`;
  const url = new URL(directPath);
  url.searchParams.set("token", env.MARKETDATA_TOKEN);
  return url;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function resolveMarketSymbol(symbol: string): string {
  return SYMBOL_ALIASES[symbol] || symbol;
}

function emptyHistory(): Record<string, null> {
  return {
    perf1d: null,
    perf3d: null,
    perf5d: null,
    perf20d: null,
  };
}

function json(data: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}
