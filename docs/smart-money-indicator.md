# Coin Brain Smart Money Indicator (SMI) Specification

Version 1.0 | 2026-03-29

---

## 1. Overview

The Smart Money Indicator (SMI) is a composite quantitative score ranging from **-100 (extreme short conviction) to +100 (extreme long conviction)** that synthesizes on-chain positioning data from 300 verified top traders on Hyperliquid into a single directional signal per coin.

The indicator is computed per coin at 2-minute intervals (aligned with the existing `/api/cron/collect` schedule) and combines three orthogonal sub-indicators:

| Sub-indicator | What it measures | Weight |
|---|---|---|
| Smart Money Pressure (SMP) | Net capital flow direction weighted by trader skill tier | 0.50 |
| Funding Divergence (FD) | Disagreement between smart money direction and retail crowd (funding rate) | 0.25 |
| Conviction Velocity (CV) | Rate of change of conviction -- acceleration of consensus formation | 0.25 |

Design principles:
- Conservative: biased toward 0 (neutral) in ambiguous conditions.
- Tier-weighted: an S-tier trader's $1M position carries 5x the influence of a C-tier trader's $1M position.
- Self-damping: extreme values require simultaneous agreement across all three sub-indicators.

---

## 2. Data Requirements

### 2.1 Per-Coin Position Data (from `PositionStore`)

For each trader `i` holding coin `c`:

| Field | Symbol | Source |
|---|---|---|
| Signed position size in USD | `V_i` | `position.positionValue` (positive = long, negative = short) |
| Trader tier | `T_i` | `trader.tier` in {S, A, B, C, D} |
| Leverage | `L_i` | `position.leverage` |
| Unrealized PnL | `P_i` | `position.unrealizedPnl` |
| Margin used | `M_i` | `position.marginUsed` |

### 2.2 Market Data (from `getMetaAndAssetCtxs`)

| Field | Symbol | Source |
|---|---|---|
| Funding rate (hourly) | `F` | `ctx.funding` |
| Open interest (USD) | `OI` | `ctx.openInterest * ctx.markPx` |
| 24h volume (USD) | `Vol` | `ctx.dayNtlVlm` |
| Mark price | `P_mark` | `ctx.markPx` |

### 2.3 Historical State (from Redis)

| Field | Symbol | Source |
|---|---|---|
| Previous SMP value (t-1) | `SMP_prev` | Stored in Redis at key `smi:{coin}:history` |
| SMP values at t-2 through t-5 | `SMP_{t-k}` | Ring buffer of last 5 snapshots |
| Previous SMI composite | `SMI_prev` | For EMA smoothing |

### 2.4 Tier Weight Map

Mirrors the existing `TIER_WEIGHT` in `aggregator.ts`:

```
w(T) = { S: 5.0, A: 3.0, B: 1.5, C: 1.0, D: 0.5 }
```

---

## 3. Sub-Indicator 1: Smart Money Pressure (SMP)

### 3.1 Concept

SMP measures the net directional capital commitment of smart money, normalized to [-100, +100]. It answers: "Which direction are the best traders betting, and how much capital backs that bet?"

### 3.2 Formula

**Step 1: Compute tier-weighted net exposure**

For coin `c` with `N` traders holding positions:

```
WeightedLong_c  = SUM( w(T_i) * |V_i| )   for all i where V_i > 0
WeightedShort_c = SUM( w(T_i) * |V_i| )   for all i where V_i < 0
WeightedNet_c   = WeightedLong_c - WeightedShort_c
WeightedTotal_c = WeightedLong_c + WeightedShort_c
```

**Step 2: Compute raw pressure ratio**

```
R_c = WeightedNet_c / WeightedTotal_c       (range: [-1, +1])
```

If `WeightedTotal_c = 0`, then `R_c = 0`.

**Step 3: Apply participation scaling**

A signal from 2 traders is less meaningful than the same ratio from 20 traders. Apply a concavity-dampened participation factor:

```
N_effective = SUM( w(T_i) )                 for all i holding coin c
ParticipationFactor = min(1.0, sqrt(N_effective / 30))
```

The denominator 30 represents approximately 6 S-tier traders (6 * 5 = 30) as full participation. `sqrt` provides diminishing returns -- going from 2 to 10 traders matters more than 10 to 50.

**Step 4: Apply leverage adjustment**

High aggregate leverage amplifies conviction but also indicates higher risk. Dampen extreme leverage:

```
AvgLeverage = SUM( L_i * |V_i| ) / SUM( |V_i| )     (value-weighted)
LeverageFactor = min(1.2, 1.0 + 0.02 * min(AvgLeverage, 10))
```

Capped at 1.2 (20% boost) when average leverage >= 10x. Leverage above 10x provides no additional boost (to penalize reckless leverage indirectly by not rewarding it).

**Step 5: Compute SMP**

```
SMP_c = R_c * ParticipationFactor * LeverageFactor * 100
```

Clamp to [-100, +100].

### 3.3 Properties

- SMP = +100: all tracked capital is long, with high participation and meaningful leverage.
- SMP = 0: equal long/short capital, or insufficient participation.
- SMP = -100: all tracked capital is short, with high participation and meaningful leverage.
- A single S-tier trader going long with $10M has the same pressure as five C-tier traders going long with $10M each (both produce `w * V = 50M`).

---

## 4. Sub-Indicator 2: Funding Divergence (FD)

### 4.1 Concept

FD detects when smart money positioning diverges from the retail crowd direction implied by the funding rate. High positive funding means retail is net long (paying shorts); if smart money is also net long, there is no divergence. If smart money is net short while retail pays to be long, this is a meaningful contrarian signal.

### 4.2 Formula

**Step 1: Normalize funding rate**

Convert the hourly funding rate to a score in [-1, +1]:

```
F_norm = clamp(F * 10000 / 5, -1, +1)
```

Rationale: Hyperliquid funding rates are typically in the range [-0.0005, +0.0005] per hour. A rate of 0.0005 (5 bps/hr, ~44% annualized) is extreme; dividing by 5 bps maps it to +/-1. Values beyond this are clamped.

Interpretation:
- `F_norm > 0`: retail is net long (longs pay shorts)
- `F_norm < 0`: retail is net short (shorts pay longs)

**Step 2: Determine smart money direction**

Use the sign of SMP:

```
SM_direction = sign(SMP_c)     (+1 if SMP > 0, -1 if SMP < 0, 0 if SMP = 0)
```

**Step 3: Compute divergence**

```
Divergence = -1 * F_norm * SM_direction
```

When smart money opposes retail:
- Smart money SHORT (`SM_direction = -1`) and retail LONG (`F_norm > 0`): `Divergence = +1 * F_norm > 0` (positive -- smart money is fading retail)
- Smart money LONG (`SM_direction = +1`) and retail SHORT (`F_norm < 0`): `Divergence = +1 * |F_norm| > 0` (positive -- smart money is fading retail)

When they agree, divergence is negative (reduces signal strength).

**Step 4: Scale and sign-align**

The FD sub-indicator should have the same sign convention as SMP (positive = bullish, negative = bearish):

```
FD_c = SM_direction * |Divergence| * |SMP_c|
```

This ensures:
- FD is 0 when SMP is 0 (no smart money signal to diverge from).
- FD amplifies SMP when smart money opposes retail.
- FD dampens (goes negative relative to SMP) when smart money aligns with retail.

Clamp to [-100, +100].

### 4.3 Properties

- FD contributes most when funding is extreme AND smart money opposes it.
- FD contributes nothing when funding is near zero (no retail bias to fade).
- FD is directionally aligned with SMP by construction -- it modulates magnitude, not direction.

---

## 5. Sub-Indicator 3: Conviction Velocity (CV)

### 5.1 Concept

CV measures how quickly smart money consensus is forming or dissolving. A rapidly rising SMP suggests an emerging trade; a stable SMP suggests established positioning. CV rewards acceleration, not just magnitude.

### 5.2 Formula

**Step 1: Compute first derivative (rate of change)**

Using the previous 3 SMP snapshots (at 2-minute intervals):

```
dSMP_1 = SMP_t - SMP_{t-1}          (most recent change)
dSMP_2 = SMP_{t-1} - SMP_{t-2}      (previous change)
dSMP_3 = SMP_{t-2} - SMP_{t-3}      (oldest change)
```

**Step 2: Exponentially weighted velocity**

Recent changes matter more:

```
CV_raw = 0.5 * dSMP_1 + 0.3 * dSMP_2 + 0.2 * dSMP_3
```

**Step 3: Normalize**

The maximum possible change per interval is 200 (from -100 to +100), but realistic changes are much smaller. Normalize by a reference max delta of 40 points per interval:

```
CV_c = clamp(CV_raw / 40 * 100, -100, +100)
```

### 5.3 Bootstrapping

When fewer than 4 historical snapshots exist:
- 0 snapshots: `CV = 0`
- 1 snapshot: `CV = 0`
- 2 snapshots: `CV_raw = dSMP_1`, normalize as above
- 3 snapshots: `CV_raw = 0.6 * dSMP_1 + 0.4 * dSMP_2`, normalize as above

### 5.4 Properties

- CV > 0: smart money is accelerating into long positions (bullish momentum).
- CV < 0: smart money is accelerating into short positions (bearish momentum).
- CV near 0: positioning is stable -- existing signal persists but is not strengthening.
- CV rewards newly forming consensus (high value) over stale consensus (low value).

---

## 6. Composite Score Calculation

### 6.1 Weighted Sum

```
SMI_raw = 0.50 * SMP_c + 0.25 * FD_c + 0.25 * CV_c
```

### 6.2 EMA Smoothing

To prevent whipsaw, apply exponential moving average with the previous composite:

```
alpha = 0.3      (smoothing factor; lower = smoother)
SMI_smoothed = alpha * SMI_raw + (1 - alpha) * SMI_prev
```

If no previous value exists, `SMI_smoothed = SMI_raw`.

The alpha of 0.3 means the indicator fully incorporates a new regime in roughly `2/alpha ~ 7` updates (14 minutes), which is appropriate for crypto volatility.

### 6.3 Dead Zone

Apply a dead zone near zero to suppress noise:

```
DEAD_ZONE = 10

SMI_final =
  if |SMI_smoothed| < DEAD_ZONE:  0
  else:  sign(SMI_smoothed) * (|SMI_smoothed| - DEAD_ZONE) * (100 / (100 - DEAD_ZONE))
```

This remaps [10, 100] to [0, 100] and [-100, -10] to [-100, 0], with the interval (-10, +10) collapsed to zero.

### 6.4 Final Clamp

```
SMI_c = clamp(round(SMI_final), -100, +100)
```

---

## 7. Signal Generation Rules

### 7.1 Signal Thresholds

| Threshold | Value | Meaning |
|---|---|---|
| `ENTRY_LONG` | SMI >= **+55** | Open/consider long position |
| `ENTRY_SHORT` | SMI <= **-55** | Open/consider short position |
| `STRONG_LONG` | SMI >= **+75** | High-conviction long |
| `STRONG_SHORT` | SMI <= **-75** | High-conviction short |
| `EXIT_ZONE` | \|SMI\| < **25** | Close existing position / go neutral |
| `CAUTION` | SMI crosses zero | Directional shift underway |

### 7.2 Confirmation Requirements

A signal is only emitted when ALL of the following are true:

**Minimum participation guard:**
```
N_traders >= 3   AND   N_effective >= 5.0
```
At least 3 distinct traders must hold the coin, with a tier-weighted count >= 5 (e.g., one S-tier trader alone is `w = 5`, satisfying this).

**Persistence filter (anti-whipsaw):**
```
The SMI must remain above ENTRY_LONG (or below ENTRY_SHORT) for
at least 2 consecutive snapshots (4 minutes).
```
A single spike above +55 that immediately reverts is filtered out.

**Volume floor:**
```
Vol_24h >= $10,000,000
```
Signals on illiquid coins are suppressed entirely. Coins with 24h volume below $10M are excluded from signal generation (the indicator is still computed for display, but no entry signal is emitted).

**Open interest floor:**
```
OI >= $5,000,000
```
Insufficient open interest means the market cannot absorb meaningful positions.

### 7.3 Signal Output Schema

```typescript
interface SMISignal {
  coin: string;
  smi: number;                          // -100 to +100
  components: {
    smp: number;                        // -100 to +100
    fd: number;                         // -100 to +100
    cv: number;                         // -100 to +100
  };
  signal: "STRONG_LONG" | "LONG" | "NEUTRAL" | "SHORT" | "STRONG_SHORT";
  confirmed: boolean;                   // passed persistence + guard checks
  confidence: "high" | "medium" | "low";
  meta: {
    traderCount: number;
    effectiveParticipation: number;      // N_effective
    weightedLongUsd: number;
    weightedShortUsd: number;
    avgLeverage: number;
    fundingRate: number;
    volume24h: number;
    openInterest: number;
    persistenceCount: number;            // consecutive snapshots at signal level
  };
  timestamp: number;
}
```

### 7.4 Confidence Level Derivation

```
confidence =
  "high"   if |SMI| >= 75 AND N_effective >= 15 AND persistenceCount >= 3
  "medium" if |SMI| >= 55 AND N_effective >= 8  AND persistenceCount >= 2
  "low"    otherwise (when signal threshold is met but guards are marginal)
```

---

## 8. Edge Cases and Safety Guards

### 8.1 Low Trader Count

| Condition | Behavior |
|---|---|
| `N_traders = 0` | SMI = 0, signal = NEUTRAL, skip computation |
| `N_traders = 1` | Compute SMP but cap `ParticipationFactor` at 0.3; no signal emitted |
| `N_traders = 2` | Compute normally but `ParticipationFactor` will be low (~0.41 for two C-tier); no confirmed signal unless both are S-tier |

### 8.2 Extreme Funding Rate

When `|F| > 0.001` (10 bps/hr, ~88% annualized):

```
F_extreme_flag = true
FD contribution is capped at 80% of its computed value
```

Rationale: extreme funding often precedes funding rate resets or liquidation cascades. The divergence signal becomes less reliable as the funding mechanism itself may force position changes.

### 8.3 Single-Trader Dominance

If one trader accounts for more than 60% of `WeightedTotal_c`:

```
DominanceFactor = 1.0 - 0.5 * (max_trader_share - 0.6) / 0.4
SMP_c = SMP_c * max(0.5, DominanceFactor)
```

This scales down SMP by up to 50% when a single trader dominates. At 60% share, no penalty. At 100% share, SMP is halved.

### 8.4 Stale Data

If the most recent snapshot is older than 10 minutes (5 missed cron cycles):

```
Staleness = (now - last_update) / (10 * 60 * 1000)
StaleFactor = max(0, 1.0 - Staleness)
SMI_c = SMI_c * StaleFactor
```

After 20 minutes with no update, the indicator decays to 0.

### 8.5 Market Regime Detection

Compute a simple volatility proxy from recent SMP history:

```
SMP_stddev = stddev(SMP_{t}, SMP_{t-1}, ..., SMP_{t-4})    (last 5 snapshots)
```

| Regime | Condition | Adjustment |
|---|---|---|
| **Trending** | `|mean(SMP history)| > 40` AND `SMP_stddev < 15` | No adjustment (ideal conditions for the indicator) |
| **Ranging** | `|mean(SMP history)| < 20` AND `SMP_stddev < 15` | Raise entry threshold by 10 points (`ENTRY_LONG = +65`, `ENTRY_SHORT = -65`) |
| **Volatile** | `SMP_stddev > 30` | Raise entry threshold by 15 points AND increase persistence requirement to 3 snapshots (6 minutes) |

### 8.6 Position Size Sanity Check

Ignore any individual position where:
```
|V_i| > 0.10 * OI
```
A single trader holding more than 10% of total open interest is likely a market maker or protocol position, not a directional bet.

---

## 9. Redis Storage Schema

### 9.1 Keys

```
smi:{coin}:current        -> JSON(SMISignal)          // latest computed signal
smi:{coin}:history        -> JSON(SMISnapshot[])      // ring buffer, max 30 entries (1 hour)
smi:all:latest            -> JSON(SMISignal[])         // all coins, latest snapshot
smi:meta:last_compute     -> number                    // timestamp of last computation
```

### 9.2 SMI Snapshot (for history ring buffer)

```typescript
interface SMISnapshot {
  smi: number;
  smp: number;
  fd: number;
  cv: number;
  traderCount: number;
  timestamp: number;
}
```

### 9.3 Storage Lifecycle

- Computed every 2 minutes by the `/api/cron/collect` route (appended to existing flow).
- History buffer holds 30 entries (1 hour of data). Older entries are evicted.
- `smi:all:latest` is overwritten each cycle (not appended).

---

## 10. Update Frequency and Computational Cost

| Step | Operations | Estimated Time |
|---|---|---|
| Compute SMP per coin | O(N_traders) per coin, ~20 coins | < 5ms |
| Compute FD per coin | O(1) per coin | < 1ms |
| Read history + compute CV per coin | 1 Redis read per coin | < 50ms total (batched) |
| Composite + smoothing + guards | O(1) per coin | < 1ms |
| Write results to Redis | 1 write per coin + 1 bulk write | < 50ms total |
| **Total per cron cycle** | | **< 200ms** |

This fits comfortably within the 2-minute cron interval and the 60-second `maxDuration` of the existing collect route.

---

## 11. Implementation Notes

### 11.1 Integration Point

The SMI computation should be added as a new step in `/api/cron/collect/route.ts`, after step 5 (attach market data) and before step 6 (store in Redis). This avoids a separate cron job and ensures SMI is always computed from fresh position data.

### 11.2 TypeScript Implementation Skeleton

```typescript
// lib/signals/smi.ts

interface SMIConfig {
  tierWeights: Record<TraderTier, number>;
  participationRef: number;           // 30
  leverageCap: number;                // 10
  leverageBoostRate: number;          // 0.02
  fundingNormBps: number;             // 5
  velocityWeights: number[];          // [0.5, 0.3, 0.2]
  velocityNormRef: number;            // 40
  emaAlpha: number;                   // 0.3
  deadZone: number;                   // 10
  entryThreshold: number;             // 55
  strongThreshold: number;            // 75
  exitThreshold: number;              // 25
  minTraders: number;                 // 3
  minEffectiveParticipation: number;  // 5
  persistenceRequired: number;        // 2
  volumeFloor: number;               // 10_000_000
  oiFloor: number;                    // 5_000_000
  maxSingleTraderShare: number;       // 0.6
  maxPositionOiShare: number;         // 0.1
  historySize: number;               // 30
}
```

### 11.3 Testing Strategy

1. **Unit tests**: Pure functions for each sub-indicator with known inputs/outputs.
2. **Boundary tests**: Verify behavior at exactly 0, +/-55, +/-75, +/-100.
3. **Edge case tests**: Single trader, all same direction, extreme funding, stale data.
4. **Regime tests**: Synthetic SMP history sequences for trending/ranging/volatile detection.
5. **Integration test**: Full pipeline from mock `PositionStore` + market data to final signal.

---

## 12. Worked Example

**Scenario**: BTC with 15 traders, moderate funding, emerging consensus.

| Trader | Tier | Side | Size (USD) | Leverage |
|---|---|---|---|---|
| A1 | S | LONG | $5,000,000 | 3x |
| A2 | S | LONG | $3,000,000 | 5x |
| A3 | A | LONG | $2,000,000 | 4x |
| A4 | A | LONG | $1,500,000 | 2x |
| A5 | A | SHORT | $1,000,000 | 8x |
| B1-B5 | B | LONG | $500,000 each | 5x |
| C1-C5 | C | SHORT | $200,000 each | 10x |

**SMP Calculation:**

```
WeightedLong  = 5*5M + 5*3M + 3*2M + 3*1.5M + 1.5*(5*500k) = 25M + 15M + 6M + 4.5M + 3.75M = 54.25M
WeightedShort = 3*1M + 1*(5*200k) = 3M + 1M = 4M
WeightedNet   = 54.25M - 4M = 50.25M
WeightedTotal = 54.25M + 4M = 58.25M
R             = 50.25 / 58.25 = 0.863

N_effective   = 2*5 + 3*3 + 5*1.5 + 5*1 = 10 + 9 + 7.5 + 5 = 31.5
PartFactor    = min(1.0, sqrt(31.5/30)) = min(1.0, 1.025) = 1.0

AvgLev (value-weighted) = (5M*3 + 3M*5 + 2M*4 + 1.5M*2 + 1M*8 + 2.5M*5 + 1M*10) / (5M+3M+2M+1.5M+1M+2.5M+1M)
                        = (15+15+8+3+8+12.5+10) / 16M = 71.5M / 16M = 4.47
LevFactor     = 1.0 + 0.02 * min(4.47, 10) = 1.089

SMP           = 0.863 * 1.0 * 1.089 * 100 = 94.0
```

**FD Calculation** (assuming funding = 0.0002, i.e., retail slightly long):

```
F_norm        = clamp(0.0002 * 10000 / 5, -1, 1) = clamp(0.4, -1, 1) = 0.4
SM_direction  = +1 (SMP > 0)
Divergence    = -1 * 0.4 * 1 = -0.4  (smart money AGREES with retail, negative divergence)
FD            = +1 * 0.4 * 94.0 = 37.6  -> but sign is negative since they agree
FD            = SM_direction * |Divergence| * |SMP| = 1 * 0.4 * 94 = 37.6
              (But Divergence is -0.4, so:)
FD            = -0.4 * 94.0 = -37.6

Wait -- re-deriving carefully:
FD_c          = SM_direction * |Divergence| * |SMP_c| ... NO, let me use the actual formula.
FD_c          = Divergence * |SMP_c| / 100
              = -0.4 * 94.0 = -37.6
```

Since smart money and retail agree, FD is -37.6 (dampening -- this is a crowded trade).

**CV Calculation** (assuming previous SMP values: [70, 55, 40]):

```
dSMP_1 = 94.0 - 70 = 24.0
dSMP_2 = 70 - 55 = 15.0
dSMP_3 = 55 - 40 = 15.0
CV_raw = 0.5*24 + 0.3*15 + 0.2*15 = 12 + 4.5 + 3.0 = 19.5
CV     = clamp(19.5/40*100, -100, 100) = 48.75
```

Strong positive velocity -- consensus is rapidly forming.

**Composite:**

```
SMI_raw       = 0.50*94.0 + 0.25*(-37.6) + 0.25*48.75
              = 47.0 + (-9.4) + 12.19
              = 49.79

SMI_smoothed  = 0.3*49.79 + 0.7*SMI_prev
              (assuming SMI_prev = 35):
              = 14.94 + 24.5 = 39.44

Dead zone:    |39.44| > 10, so:
SMI_final     = sign(39.44) * (39.44 - 10) * (100/90) = 1 * 29.44 * 1.111 = 32.7

SMI_c         = 33
```

**Result**: SMI = +33 (moderately bullish, but not at entry threshold of +55). Signal = NEUTRAL. The dampening from FD (crowded long) and the EMA smoothing prevent a premature entry signal despite strong SMP. If the SMP continues rising for 2-3 more cycles while funding normalizes, the signal will reach entry threshold.

This is the intended conservative behavior.

---

## 13. Appendix: FD Formula Clarification

The FD formula in Section 4 can be stated more precisely as a single expression:

```
FD_c = -F_norm * sign(SMP_c) * |SMP_c|
```

Where:
- When smart money is LONG (`SMP > 0`) and funding is positive (retail long): `FD = -F_norm * SMP` which is negative (dampening -- crowded trade).
- When smart money is LONG (`SMP > 0`) and funding is negative (retail short): `FD = -F_norm * SMP = |F_norm| * SMP` which is positive (amplifying -- smart money fading retail).
- The magnitude scales with both the strength of the funding signal and the strength of SMP.
- When `SMP = 0`, `FD = 0` regardless of funding (no smart money direction to modulate).
