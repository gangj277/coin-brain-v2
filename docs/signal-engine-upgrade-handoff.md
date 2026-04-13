# Signal Engine v2 고도화 Handoff Document

> **목적**: Hyperliquid 온체인 스마트머니 트래킹 시스템의 시그널 엔진 고도화를 위한 기술 핸드오프
> **작성일**: 2026-04-13
> **대상**: 퀀트 전문가 (시스템 전체 맥락 없음을 가정)

---

## 1. 프로젝트 개요

Coin Brain은 Hyperliquid DEX에서 검증된 상위 트레이더(스마트머니) 300명의 포지션을 실시간 추적하여, 같은 코인에 다수의 트레이더가 몰리는 패턴을 시그널로 감지하고 텔레그램으로 알림을 보내는 시스템이다.

**핵심 가설**: 지속적으로 수익을 내는 검증된 트레이더들이 동시에 같은 방향으로 포지션을 잡으면, 그것은 유의미한 트레이딩 시그널이다.

**기술 스택**: Next.js (Vercel Serverless), Upstash Redis, Hyperliquid REST API, OpenRouter LLM, Telegram Bot API

---

## 2. 현재 파이프라인 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                     4-Stage Cron Pipeline                           │
│                                                                     │
│  [1] Universe (15m)    [2] Collect (2m)    [3] Analyze (10m)       │
│  리더보드 32K명         300명 포지션 폴링    LLM 내러티브 생성       │
│  → 스코어링/티어링      → 시그널 클러스터링  (상위 15개)             │
│  → 상위 300명 선별      → 타이밍 백필                               │
│                                                                     │
│  [4] Notify (2m)                                                    │
│  이전 스냅샷 diff → 이벤트 감지 → 텔레그램 알림                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.1 Stage 1: Trader Universe 구축

**파일**: `lib/pipeline/trader-universe-service.ts`, `lib/hyperliquid/scoring.ts`
**주기**: 15분

Hyperliquid 리더보드(`stats-data.hyperliquid.xyz`)에서 32,000+명을 가져와 필터링 후 스코어링한다.

#### 필터 기준 (`lib/pipeline/config.ts`)
| 파라미터 | 값 | 의미 |
|----------|-----|------|
| `minAccountValue` | $50,000 | 최소 계정 가치 |
| `minAllTimePnl` | $50,000 | 최소 누적 수익 |
| `minMonthPnl` | $1,000 | 최소 월 수익 |
| `minAllTimeRoi` | 20% | 최소 누적 ROI |
| `maxEntries` | 300 | 최종 트래킹 인원 |

#### 스코어링 (0-100 복합 점수)

```
totalScore = profitability × 0.30
           + consistency  × 0.25
           + riskMgmt     × 0.15
           + activity     × 0.15
           + scale        × 0.15
```

| 차원 | 가중치 | 산출 방식 |
|------|--------|----------|
| **Profitability** | 30% | allTimeRoi 기반. 0%→0, 100%→70, 500%→90, 1000%+→100 (비선형 매핑) |
| **Consistency** | 25% | dayPnl>0: +15, weekPnl>0: +25, monthPnl>0: +35, allTimePnl>0: +25, 보너스: monthRoi>5% & allTimePnl>0: +10 |
| **Risk Management** | 15% | monthRoi/allTimeRoi 비율. ≤0.5→80, ≤1.0→60, ≤2.0→40, >2.0→20 |
| **Activity** | 15% | log10(monthVolume) 기반. $1M→30, $10M→50, $100M→70, $10B+→100 |
| **Scale** | 15% | log10(accountValue) 기반. $10k→20, $100k→40, $1M→60, $10M→80 |

#### 티어 할당
| 티어 | 점수 |
|------|------|
| S | ≥ 80 |
| A | ≥ 65 |
| B | ≥ 50 |
| C | ≥ 35 |
| D | < 35 |

결과는 Redis `traders:universe:active`에 `TraderUniverseSnapshot`으로 저장.

---

### 2.2 Stage 2: Position Collection & Signal Aggregation

**파일**: `lib/pipeline/position-collection-service.ts`, `lib/signals/aggregator.ts`
**주기**: 2분

#### 2.2.1 데이터 수집

300명 트레이더를 15명씩 배치로 `getClearinghouseState()` API 호출. 각 트레이더의 모든 오픈 포지션을 `PositionStore` (인메모리)에 적재한다.

**수집되는 포지션 데이터** (per position):
```typescript
{
  coin: string           // "BTC", "ETH", ...
  side: "LONG" | "SHORT"
  size: number           // 수량
  sizeUsd: number        // USD 환산 규모
  leverage: number       // 레버리지
  leverageType: string   // "cross" | "isolated"
  entryPx: number        // 진입가
  liquidationPx: number  // 청산가
  unrealizedPnl: number  // 미실현 손익
  returnOnEquity: number // ROE
  marginUsed: number     // 사용 증거금
}
```

**수집되는 마켓 데이터** (`getMetaAndAssetCtxs()`, per coin):
```typescript
{
  markPx: number          // 마크 가격
  prevDayPx: number       // 전일 종가
  dayChange: number       // 24h 변동률 (%)
  funding: number         // 현재 펀딩레이트 (hourly)
  fundingAnnual: number   // 연율 환산 (%)
  openInterest: number    // OI (수량)
  openInterestUsd: number // OI (USD)
  dayVolume: number       // 24h 거래량 (USD)
}
```

#### 2.2.2 Position Timing (포지션 진입 시점 역산)

**파일**: `lib/hyperliquid/timing/`

Hyperliquid API는 "현재 포지션 상태"만 반환하고 "언제 진입했는지"는 제공하지 않는다. 이를 해결하기 위해 fill 내역을 역추적하는 타이밍 서브시스템이 있다.

**동작 방식**:
1. 이전 스냅샷과 현재 스냅샷을 diff하여 새로운/변경된 포지션 감지
2. `userFillsByTime` API로 거래 내역 조회
3. signed size의 zero-crossing 지점을 찾아 포지션 오픈 시점 결정
4. 전략 에스컬레이션: incremental → 1d → 7d → 30d

**타이밍 데이터** (per position):
```typescript
{
  openedAt: number | null       // 포지션 최초 오픈 시점
  lastAddedAt: number | null    // 마지막 추가 매수/매도 시점
  lastChangedAt: number         // 마지막 변경 감지 시점
  observedAt: number            // 최초 관찰 시점
  timingSource: "diff" | "fills" | "bootstrap"
  timingConfidence: "high" | "medium" | "low"
  preexisting: boolean          // 트래킹 시작 전부터 있던 포지션인가
}
```

**제약**: S/A 티어만 백필. B 이하는 `bootstrap` (low confidence)으로 남음.

#### 2.2.3 Signal Aggregation (핵심 알고리즘)

**파일**: `lib/signals/aggregator.ts`

포지션을 코인별로 그룹핑 → 최소 2명 이상인 코인만 시그널로 생성.

##### Conviction 계산 (0-100)

```
countAlignment = max(longTraders, shortTraders) / totalTraders
                 // 0.5 = 완전 분열, 1.0 = 만장일치

valueAlignment = max(longValueUsd, shortValueUsd) / totalValueUsd
                 // 자본 기준 정렬도

sTierAlignment = max(sTierLongs, sTierShorts) / sTierCount
                 // S-tier 간 정렬도 (없으면 0.5)

conviction = countAlignment × 40 + valueAlignment × 30 + sTierAlignment × 30
```

##### Signal Type 분류

```
if countAlignment ≥ 0.70 → "consensus"  (dominantSide = 다수 방향)
if 0.35 ≤ countAlignment ≤ 0.65 → "divergence"  (dominantSide = "SPLIT")
else → "emerging"  (dominantSide = 자본 가중 다수 방향)
```

> **주의**: 0.65 < countAlignment < 0.70 구간이 "emerging"으로 빠지는 갭이 존재.

##### Strength 계산

3개의 step-function 점수를 합산:

| 요소 | 조건 | 점수 |
|------|------|------|
| **Scale** | totalValueUsd ≥ $10M | 30 |
| | ≥ $1M | 20 |
| | ≥ $100K | 10 |
| | < $100K | 5 |
| **Tier Quality** | sTierCount ≥ 5 | 30 |
| | ≥ 3 | 25 |
| | ≥ 1 | 15 |
| | aTierCount ≥ 3 (S 없음) | 10 |
| | else | 5 |
| **Conviction** | conviction ≥ 80 | 40 |
| | ≥ 65 | 30 |
| | ≥ 50 | 20 |
| | < 50 | 10 |

```
totalScore = scaleScore + tierScore + convictionScore  (max 100)

strong:   totalScore ≥ 75
moderate: totalScore ≥ 50
weak:     totalScore < 50
```

##### 시그널 정렬

```
1차: strength (strong > moderate > weak)
2차: conviction + scaleBonus ($10M+→+30, $1M+→+20, $100K+→+10)
3차: totalValueUsd
```

---

### 2.3 Stage 3: LLM Analysis

**파일**: `lib/signals/narrator.ts`
**주기**: 10분

- strong/moderate이면서 totalTraders ≥ 3인 시그널만 대상
- 최대 15개
- Google Gemini 3 Flash (OpenRouter 경유)
- 구조화 출력: marketContext, positionAnalysis, riskAssessment, conclusion, sentiment, confidenceLevel
- Temperature: 0.3

---

### 2.4 Stage 4: Notification

**파일**: `lib/telegram/detector.ts`, `lib/telegram/formatter.ts`
**주기**: 2분

이전 ServedSignalSnapshot과 현재를 diff하여 5가지 이벤트 감지:

| 이벤트 | 조건 | 우선순위 |
|--------|------|---------|
| `new_signal` | 이전에 없던 코인, 3+ 트레이더 | S-tier 2+이면 P1, 아니면 P2 |
| `stier_surge` | S-tier 수 +2 이상 증가 | P1 |
| `strength_upgrade` | weak→moderate, moderate→strong | strong이면 P1, 아니면 P2 |
| `consensus_formed` | type이 consensus로 변경 | P1 |
| `side_flip` | dominantSide 방향 전환 | P2 |

- weak 시그널은 모두 스킵
- 코인별 30분 쿨다운
- 사이클당 최대 5건 알림

---

## 3. Redis 키 맵

| 키 | 내용 | 갱신 주기 |
|----|------|----------|
| `traders:universe:active` | 트레이더 유니버스 (300명) | 15분 |
| `signals:base:latest` | 베이스 시그널 스냅샷 | 2분 |
| `signals:served:latest` | 서빙용 스냅샷 (LLM 분석 포함) | 2분/10분 |
| `positions:snapshots:latest` | 트레이더별 이전 ClearinghouseState | 2분 |
| `positions:timings:latest` | 포지션 타이밍 레코드 | 2분 |
| `positions:timings:queue` | 백필 태스크 큐 | 2분 |
| `notify:last-state` | 이전 서빙 스냅샷 (diff용) | 2분 |
| `notify:cooldowns` | 코인별 쿨다운 타임스탬프 | 2분 |

---

## 4. 현재 시스템의 구조적 한계

아래는 수집되는 데이터 대비 활용되지 않는 차원과, 알고리즘 설계상 개선이 필요한 영역이다.

### 4.1 시간 차원 미활용 (가장 치명적)

**현상**: 타이밍 데이터(`openedAt`, `lastAddedAt`, `observedAt`, `timingConfidence`)가 수집되지만, conviction/strength 계산에 **전혀 반영되지 않는다.** 30일 전 포지션과 5분 전 포지션이 동일한 가중치를 받는다.

**문제점**:
- "S-tier 5명이 오늘 동시에 BTC LONG 진입" vs "2주째 들고 있는 BTC LONG 5명"을 구분 불가
- 시그널의 시의성(timeliness)이 완전히 무시됨
- 사용자가 받는 시그널이 "새로운 움직임"인지 "오래된 포지션의 반복 보고"인지 알 수 없음

**활용 가능한 데이터**:
```
timingRecords[key].openedAt     → 포지션 오픈 시점 (backfill 성공 시)
timingRecords[key].lastAddedAt  → 마지막 추가 진입 시점
timingRecords[key].observedAt   → 시스템이 처음 관찰한 시점
timingRecords[key].preexisting  → 트래킹 시작 이전 포지션 여부
```

**제안 — Time-Decay Weighted Conviction**:

개별 포지션에 시간 감쇠 가중치를 적용한다:

```
freshness(position) =
  if openedAt is known (high confidence):
    exp(-λ × (now - openedAt) / 3600)     // λ = decay rate, time in hours
  else if lastAddedAt is known:
    exp(-λ × (now - lastAddedAt) / 3600)
  else:
    baseWeight                              // preexisting/unknown → 낮은 고정 가중치

λ 제안값: 0.02 ~ 0.05 (반감기 14~35시간)
baseWeight 제안값: 0.3
```

이를 conviction 계산에 반영:

```
// 기존: 단순 카운트
countAlignment = max(longCount, shortCount) / totalCount

// 개선: freshness 가중 카운트
weightedLongs  = Σ freshness(p) for p in longs
weightedShorts = Σ freshness(p) for p in shorts
weightedCountAlignment = max(weightedLongs, weightedShorts) / (weightedLongs + weightedShorts)
```

### 4.2 포지션 변화 속도(Velocity) 미반영

**현상**: `differ.ts`가 `position_opened`, `position_increased`, `position_decreased`, `position_closed`, `position_flipped` 이벤트를 감지하지만, 이 정보가 aggregator로 **전달되지 않는다.** aggregator는 순수 스냅샷 기반이다.

**문제점**:
- "최근 1시간에 3명이 새로 진입" vs "어제부터 있던 3명" 구분 불가
- 포지션 증가(adding) 행위는 강한 conviction 시그널인데 무시됨
- 선행 시그널(momentum signal)을 잡을 수 없음

**제안 — Velocity Score**:

최근 N시간 내 포지션 변경 이벤트를 집계하여 시그널에 velocity 차원을 추가:

```
velocity_score(coin, side) =
  Σ event_weight(type) × tier_weight(tier) × recency(event.timestamp)
  for events in [position_opened, position_increased, position_flipped_to_side]
  where event.coin == coin AND resulting side == side

event_weight:
  position_opened  → 1.0
  position_increased → 0.6
  position_flipped → 1.5   // 방향 전환은 강한 의미

tier_weight: S→5, A→3, B→1.5, C→1, D→0.5  (기존 TIER_WEIGHT 재활용)

recency(ts) = exp(-0.1 × (now - ts) / 3600)  // 1시간 반감기
```

이 velocity_score를 strength 계산의 4번째 요소로 추가하거나, 별도의 "momentum" 시그널 유형으로 분리할 수 있다.

**구현 방향**: `PositionCollectionService.collect()` 내에서 `syncPositionTimingForTrader`가 반환하는 diff 결과를 별도 `RecentEvents` 구조에 축적 → aggregator 호출 시 전달.

### 4.3 마켓 컨텍스트가 스코어링에 미반영

**현상**: 펀딩레이트, OI, 가격변동, 거래량이 수집되어 `SignalMarketData`로 저장되지만, conviction/strength 계산에는 사용되지 않는다. LLM 내러티브에서만 참조된다.

**문제점 — Crowded Trade Blindness**:

| 시나리오 | 시그널 | 실제 위험 |
|---------|--------|----------|
| 펀딩 +0.1%/h, OI ATH, 모두 LONG | strong consensus LONG | 매우 과밀. 숏 스퀴즈 끝 가능성 |
| 펀딩 -0.05%/h, OI 하락 중, 모두 LONG | strong consensus LONG | 역발상 매수. 더 유의미한 시그널 |
| 24h -15%, 모두 SHORT | strong consensus SHORT | 이미 늦은 진입. 반등 리스크 |

현재 시스템은 위 세 경우를 동일한 "strong consensus LONG/SHORT"으로 분류한다.

**제안 — Market Regime Adjustment**:

```
crowding_penalty(coin) =
  funding_component + oi_component + extension_component

funding_component:
  if signal is LONG and funding > +0.01%/h → -5 × (funding / 0.01)
  if signal is SHORT and funding < -0.01%/h → -5 × (abs(funding) / 0.01)
  // 시그널 방향과 펀딩이 같으면 과밀 페널티

oi_component:
  // OI가 비정상적으로 높으면 → 청산 캐스케이드 리스크
  // 이를 위해서는 OI의 이동평균 대비 현재값 비교 필요 (추가 데이터 필요)

extension_component:
  if signal is LONG and dayChange > +10% → -10
  if signal is SHORT and dayChange < -10% → -10
  // 이미 큰 움직임 후 추격 진입

contrarian_bonus(coin):
  if signal is LONG and funding < -0.005%/h → +10
  if signal is SHORT and funding > +0.005%/h → +10
  // 펀딩 반대 방향 = 역발상 보너스

adjusted_conviction = conviction + contrarian_bonus - crowding_penalty
```

**주의**: OI 히스토리(z-score 기반)를 위해서는 추가 데이터 저장이 필요하다. 현재 매 사이클 `getMetaAndAssetCtxs()`로 받는 OI는 현재값뿐이다. Redis에 시계열로 쌓거나 외부 소스(Coinalyze 등)를 연동해야 한다.

### 4.4 S-tier 정렬이 인원 수만 반영 (자본 가중 없음)

**현상** (`aggregator.ts:139`):
```typescript
const sTierAlignment = sTierCount > 0
  ? Math.max(sTierLongs, sTierShorts) / sTierCount
  : 0.5;
```

S-tier 중 $50M LONG 1명 vs $100K SHORT 3명 → SHORT 정렬로 판정. S-tier 내에서도 자본 규모 차이가 크기 때문에 head count만으로는 부정확하다.

**제안**:
```
sTierLongValue  = Σ sizeUsd for s-tier longs
sTierShortValue = Σ sizeUsd for s-tier shorts
sTierValueAlignment = max(sTierLongValue, sTierShortValue)
                    / (sTierLongValue + sTierShortValue)

// 기존 인원 정렬과 자본 정렬의 블렌드
sTierAlignment = sTierCountAlignment × 0.4 + sTierValueAlignment × 0.6
```

### 4.5 레버리지가 conviction에 미반영

**현상**: 평균 레버리지는 표시용으로만 계산(`avgLeverage`). 스코어링에 사용되지 않음.

**문제점**: 50x로 진입한 트레이더는 2x보다 훨씬 높은 개인 conviction을 표현하는 것. 동일하게 취급하면 정보 손실.

**제안 — Leverage-Weighted Conviction**:

포지션별 conviction weight에 레버리지 팩터를 반영:

```
leverage_factor(lev) = 1 + log2(max(lev, 1)) × 0.15
// 1x → 1.0, 2x → 1.15, 5x → 1.35, 10x → 1.5, 25x → 1.7, 50x → 1.85

// value alignment 계산 시:
weighted_value(position) = sizeUsd × leverage_factor(leverage)
```

**주의**: 과도한 레버리지가 오히려 리스크 시그널일 수 있으므로, 일정 수준(예: 50x) 이상은 cap을 두어야 한다.

### 4.6 포지션 비중(Concentration) 미반영

**현상**: $10M 계정에서 $100K 포지션(1%) vs $200K 계정에서 $100K 포지션(50%)을 동일하게 취급.

**제안**:
```
concentration(position) = marginUsed / accountValue
// accountValue는 ClearinghouseState.marginSummary.accountValue에서 확보 가능

conviction_weight(position) = base_weight × (1 + concentration × 2)
// concentration 50% → 2.0x, 10% → 1.2x, 1% → 1.02x
```

`PositionStore`에 accountValue를 같이 저장하도록 확장 필요. 현재 `store.updateState()`에서 `marginSummary`는 접근 가능하지만 포지션 레벨로 전달되지 않는다.

### 4.7 알림 쿨다운 구조 문제

**현상** (`detector.ts`): 쿨다운이 `coin` 단위로만 적용.

```typescript
const COOLDOWN_MS = 30 * 60 * 1000;
function isOnCooldown(coin: string, cooldowns: CooldownState, now: number): boolean {
  const lastSent = cooldowns[coin];
  return now - lastSent < COOLDOWN_MS;
}
```

**문제점**: BTC `side_flip` 알림 후 30분 내에 `stier_surge`가 발생하면 무시됨. 중요 이벤트 누락.

**제안**: 쿨다운 키를 `{coin}:{eventType}`으로 변경하고, 이벤트 유형별 쿨다운을 차등 적용:
```
new_signal:       30분
stier_surge:      20분
strength_upgrade: 30분
consensus_formed: 60분 (한번 형성되면 잘 안 바뀜)
side_flip:        15분 (빠른 후속 변화 가능)
```

### 4.8 Signal Type 분류 갭

**현상** (`aggregator.ts:153-162`):
```typescript
if (countAlignment >= 0.7)        → "consensus"
if (countAlignment <= 0.65 && countAlignment >= 0.35) → "divergence"
else                              → "emerging"
```

0.65 < countAlignment < 0.70 구간이 emerging으로 분류됨. 이 구간은 사실상 consensus에 근접한데, 의도된 설계인지 불분명.

**제안**: 경계를 명확히 정리하거나, emerging 대신 "near-consensus"와 같은 중간 카테고리 도입.
```
≥ 0.70 → consensus
≥ 0.60 → near_consensus (또는 emerging을 여기로)
> 0.40 → divergence
≤ 0.40 → counter_consensus (소수가 반대)
```

### 4.9 카피트레이딩 클러스터 미탐지

**현상**: 5명이 같은 시간에 같은 코인, 비슷한 레버리지로 진입하면 "5명의 독립적 판단"으로 카운트되지만, 실제로는 1명의 시그널을 따라하는 카피트레이더일 수 있다.

이를 탐지하면 시그널의 **실질 독립 트레이더 수(effective independent traders)**를 추정할 수 있다.

**제안 — Entry Similarity Clustering**:

```
같은 코인에서 두 트레이더 (A, B)의 유사도:
time_sim = 1 - min(|openedAt_A - openedAt_B| / 3600, 1)     // 1시간 윈도우
lev_sim  = 1 - min(|leverage_A - leverage_B| / max(lev_A, lev_B), 1)
size_sim = 1 - min(|sizeUsd_A - sizeUsd_B| / max(size_A, size_B), 1)

similarity = time_sim × 0.5 + lev_sim × 0.25 + size_sim × 0.25

if similarity > 0.8 → likely copy-trading pair
```

고유사도 쌍을 그래프로 연결 → connected component = 카피 클러스터 → effective_traders = num_clusters + num_independent_traders.

**우선순위**: 낮음. 정밀한 진입 시간 데이터(backfill이 완료된 high-confidence 타이밍)가 전제되므로, 4.1 해결 후 시도.

### 4.10 시그널 정확도 추적 (Feedback Loop) 부재

**현상**: 시그널 발생 후 실제로 수익이 났는지 추적하지 않는다. 시스템이 "학습"하지 않음.

**제안 — Signal Outcome Tracking**:

1. 시그널 발생 시 `markPx`를 기록 (이미 `market.markPx`로 저장)
2. 1h / 4h / 24h 후 해당 코인의 `markPx`를 다시 조회하여 수익률 계산
3. 시그널 유형 / 강도 / 마켓 컨디션별로 적중률 집계

```
outcome = (exit_price - entry_price) / entry_price × direction_multiplier
// direction_multiplier: LONG → +1, SHORT → -1

// 집계 예시
{
  "strong_consensus_LONG": { count: 142, win_rate: 0.68, avg_return_1h: 0.3%, avg_return_24h: 1.2% },
  "moderate_emerging_SHORT": { count: 89, win_rate: 0.52, avg_return_1h: -0.1%, avg_return_24h: 0.4% }
}
```

이 데이터는:
- 스코어링 가중치 자동 최적화의 기반
- 알림에 "이 유형 시그널의 과거 적중률 68%"를 첨부하여 사용자 신뢰 구축
- 트레이더별 시그널 기여도 평가

**구현 방향**: 별도 크론(`/api/cron/outcome`)을 추가하여 1h/4h/24h 전에 발생한 시그널의 outcome을 계산해 Redis에 적재.

---

## 5. 데이터 가용성 정리

현재 수집되고 있으나 **aggregator에서 사용하지 않는** 데이터:

| 데이터 | 수집 위치 | aggregator 활용 | 제안 활용 |
|--------|----------|----------------|----------|
| `openedAt` | timing/reconcile | X | time-decay weight |
| `lastAddedAt` | timing/state | X | time-decay weight |
| `timingConfidence` | timing/types | X | weight confidence |
| `preexisting` | timing/types | X | stale position 할인 |
| `position_opened` events | differ.ts | X | velocity score |
| `position_increased` events | differ.ts | X | velocity score |
| `funding` | market data | LLM만 | crowding penalty |
| `openInterest` | market data | LLM만 | crowding penalty |
| `dayChange` | market data | LLM만 | extension penalty |
| `dayVolume` | market data | X | liquidity context |
| `leverage` | position data | 표시만 | conviction weight |
| `marginUsed` | position data | X | concentration |
| `accountValue` | ClearinghouseState | X | concentration |
| `returnOnEquity` | position data | X | profitability signal |
| `liquidationPx` | position data | X | risk proximity |

**수집되지 않으나 필요한 데이터**:

| 데이터 | 필요 이유 | 확보 방법 |
|--------|----------|----------|
| OI 히스토리 (시계열) | OI z-score 기반 과밀 탐지 | Redis 시계열 적재 or Coinalyze API |
| 펀딩레이트 히스토리 | 펀딩 z-score | 매 사이클 Redis append |
| 과거 시그널 outcome | feedback loop | 별도 크론으로 지연 계산 |
| 트레이더 간 거래 패턴 유사도 | 카피트레이딩 탐지 | 타이밍 데이터 교차 분석 |

---

## 6. 제안 구현 우선순위

```
Phase 1: Quick Wins (기존 데이터만으로 가능)
├── [P1-1] Time-decay weighted conviction (§4.1)
├── [P1-2] S-tier 자본 가중 정렬 (§4.4)
├── [P1-3] Signal type 갭 수정 (§4.8)
└── [P1-4] 이벤트별 쿨다운 분리 (§4.7)

Phase 2: Medium Lift (aggregator 확장)
├── [P2-1] Velocity score (§4.2) — differ 결과를 aggregator로 전달 필요
├── [P2-2] Leverage-weighted conviction (§4.5)
├── [P2-3] Concentration factor (§4.6) — store에 accountValue 추가
└── [P2-4] Market regime adjustment - funding/extension (§4.3 부분)

Phase 3: Infrastructure (추가 데이터 수집 필요)
├── [P3-1] OI/funding 시계열 적재 + z-score 기반 crowding (§4.3 전체)
├── [P3-2] Signal outcome tracking + feedback loop (§4.10)
└── [P3-3] Copy-trading cluster detection (§4.9)
```

---

## 7. 코드 진입점 가이드

고도화 작업 시 수정이 필요한 파일들:

| 파일 | 수정 내용 |
|------|----------|
| `lib/signals/aggregator.ts` | conviction/strength 계산 로직 전체 (핵심) |
| `lib/pipeline/position-collection-service.ts` | differ 결과 축적, aggregator 호출 시 추가 데이터 전달 |
| `lib/hyperliquid/tracker/store.ts` | accountValue 저장 확장 (§4.6) |
| `lib/hyperliquid/tracker/differ.ts` | 변경 이벤트를 외부로 반환하는 인터페이스 (§4.2) |
| `lib/telegram/detector.ts` | 쿨다운 키 구조 변경 (§4.7) |
| `lib/pipeline/types.ts` | 새로운 시그널 필드 (velocity, crowding 등) 타입 추가 |

**테스트**: `tests/` 디렉토리에 기존 테스트가 있을 수 있음. 새로운 스코어링 로직은 단위 테스트 필수.

**주의사항**:
- Vercel Serverless 환경 (2분 크론, 60초 max duration). 무거운 연산 주의.
- Redis 용량 제한 (Upstash Free/Pro). 시계열 데이터 적재 시 TTL 관리 필수.
- Hyperliquid API rate limit: 명시적 문서 없으나, 배치 15 동시요청으로 운영 중.

---

## 8. 기존 리서치 참고

`lib/research/crowding-alpha.ts`에 별도의 평균회귀(mean-reversion) 백테스팅 프레임워크가 존재한다. Binance Futures 데이터 기반이며, 가격 extension z-score + taker imbalance z-score + funding rate z-score의 복합 시그널을 사용한다. 현재 메인 파이프라인과는 독립적이나, §4.3(마켓 컨텍스트)의 설계 참고로 유용하다.

---

*끝.*
