# CUB Value

Cloudflare Worker app for monitoring a CUB equities portfolio, with an optional Railway MarketData proxy for production-safe token usage.

## Data sources

- Holdings: public Google Sheet (`Sym`, `Shares`, `Cost`)
- Live prices: MarketData.app real-time stock prices
- Lookback performance: MarketData.app daily candles

## Local development

```bash
npm install
npx wrangler secret put MARKETDATA_TOKEN
npx wrangler dev
```

## Deploy

```bash
npm run deploy
```

## Railway proxy

MarketData documents a single-IP policy, so production requests are safer through a stable Railway service.

```bash
cd proxy
npm install
npm start
```

Required Railway variable:

- `MARKETDATA_TOKEN`

Then set the Cloudflare Worker secret:

```bash
npx wrangler secret put MARKETDATA_PROXY_URL
```

## Environment

- `MARKETDATA_TOKEN` required for local direct mode
- `MARKETDATA_PROXY_URL` recommended for production
- `HOLDINGS_SHEET_ID` optional, defaults to the shared CUB holdings sheet
