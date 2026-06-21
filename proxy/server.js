import http from "node:http";

const token = process.env.MARKETDATA_TOKEN;
const port = Number(process.env.PORT || 3000);

if (!token) {
  throw new Error("MARKETDATA_TOKEN is required for the Railway proxy.");
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);

    if (requestUrl.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (requestUrl.pathname === "/quotes") {
      const symbols = requestUrl.searchParams.get("symbols");
      const extended = requestUrl.searchParams.get("extended") || "true";
      return proxyRequest(
        res,
        `https://api.marketdata.app/v1/stocks/prices/?symbols=${encodeURIComponent(symbols || "")}&extended=${encodeURIComponent(extended)}&token=${encodeURIComponent(token)}`,
      );
    }

    if (requestUrl.pathname.startsWith("/candles/")) {
      const symbol = requestUrl.pathname.split("/").pop();
      const countback = requestUrl.searchParams.get("countback") || "25";
      return proxyRequest(
        res,
        `https://api.marketdata.app/v1/stocks/candles/D/${encodeURIComponent(symbol || "")}/?countback=${encodeURIComponent(countback)}&token=${encodeURIComponent(token)}`,
      );
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Unknown proxy error",
    });
  }
});

server.listen(port, () => {
  console.log(`CUB Value MarketData proxy listening on ${port}`);
});

async function proxyRequest(res, url) {
  const response = await fetch(url);
  const body = await response.text();
  res.writeHead(response.status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(payload));
}
