# Flux billing reconciliation

TypeScript/Node reference service for interval energy billing. It reconciles
meter intervals, tariff periods, demand and export against the invoice before a
customer sees it.

## Pain point

Flux’s own framing is “you can’t sell what you can’t bill.” Complex tariffs,
missing intervals, demand resets and market-specific billing rules create
invoice variance that is expensive to explain and correct. This service makes
the expected charge and every variance driver explicit.

## Stack

- TypeScript 5 / Node.js 22
- Vitest
- Event stream contract for meter reads and reconciliation
- IBM Plex Sans + Inter, Flux navy `#050c2f`, blue `#0b30b0`, purple `#0f1372`

## Formula

- period = tariff window for each interval
- energy = Σ(kWh × period rate)
- demand = max(interval kWh × 2) × demand rate
- expected = fixed + energy + demand − export credit
- variance = invoiced − expected
- flags for missing/duplicate intervals, bill shock, zero usage, export above import

## Run

```bash
npm install
npm test
npm run build
node dist/server.js
# http://127.0.0.1:5184
```

## Verification

- 32 Vitest tests.
- Dashboard and JSON API.
- GitHub Actions CI.

This is a reference implementation, not a claim of Flux production access.
