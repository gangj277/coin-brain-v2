# Crowding Alpha Research

## One-Sentence Thesis

Leveraged one-way crowding, revealed by aligned price extension, same-side taker aggression, and funding pressure, tends to mean-revert over the next few hours on liquid Binance perpetual markets.

## Why This Thesis

- Price extension captures that the move is already stretched.
- Taker imbalance captures that aggressive flow is still chasing the move.
- Funding captures that leveraged positioning is tilted to the same side.
- When all three line up, the move is often crowded enough to mean-revert rather than continue cleanly.

## Current Implementation

Code:

- [crowding-alpha.ts](/Users/gangjimin/Documents/main_dev/startup-ideas/trading-product/coin-brain-v2/lib/research/crowding-alpha.ts)
- [backtest-crowding-alpha.ts](/Users/gangjimin/Documents/main_dev/startup-ideas/trading-product/coin-brain-v2/scripts/research/backtest-crowding-alpha.ts)
- [crowding-alpha.test.ts](/Users/gangjimin/Documents/main_dev/startup-ideas/trading-product/coin-brain-v2/tests/crowding-alpha.test.ts)

The research script:

1. Fetches Binance USDT perpetual 1h klines
2. Fetches Binance funding rate history
3. Builds a crowding score from:
   - 24h price extension z-score
   - 4h taker imbalance z-score
   - funding z-score
4. Fires only when all three components are aligned and individually meaningful
5. Trades contrarian for a fixed hold window
6. Splits results into full sample and out-of-sample windows

## Default Research Command

```bash
npm run research:backtest-crowding-alpha -- \
  --symbols=BTCUSDT,ETHUSDT \
  --start=2024-01-01 \
  --end=2026-04-03 \
  --split=2025-07-01 \
  --threshold=2.2 \
  --hold-bars=4 \
  --extension-lookback=24 \
  --component-min-z=0.5
```

## Interpretation

- This is intentionally simple and falsifiable.
- It is not yet a production strategy.
- If the symmetric long/short version is weak, that is useful evidence, not failure.
- The next step is to combine this crowding layer with the project's smart-money timing layer so the market microstructure signal and trader-flow signal can confirm each other.
