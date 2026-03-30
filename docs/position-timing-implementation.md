# Position Timing Implementation

> Updated: 2026-03-29

## 목적

`clearinghouseState`만으로는 포지션의 실제 진입 시점을 알 수 없어서, 차트 마커가 "진입가와 가장 가까운 캔들"에 찍히는 문제가 있었다.

이번 구현의 목표는 다음이다.

- 모든 추적 트레이더에 대해 포지션 타이밍 상태를 누적 관리한다.
- 진입 시점을 단일 값으로 뭉개지 않고 `openedAt`와 `lastAddedAt`를 분리한다.
- 정확한 시간을 모르면 추정하지 않고 `observedAt`와 confidence를 내려서 명시한다.
- `userFills*` 호출은 bounded backfill로 제한해 rate-limit 리스크를 낮춘다.

## 구현 요약

구현 방식은 `diff-first, fills-reconcile hybrid`다.

- 1차 소스: cron 수집 시점의 `clearinghouseState` diff
- 2차 보정: 제한된 수의 `userFillsByTime(..., aggregateByTime=true)` backfill
- 영속 상태: Redis
- 표시 정책: `openedAt`가 `high` confidence일 때만 차트에 시간 기반 엔트리 마커 표시

## 추가된 상태와 키

Redis에 아래 3개 키를 추가했다.

- `positions:snapshots:latest`
- `positions:timings:latest`
- `positions:timings:queue`

`positions:timings:latest`의 레코드는 `address:coin` 단위로 저장된다.

```ts
{
  address: string;
  coin: string;
  openedAt: number | null;
  lastAddedAt: number | null;
  lastChangedAt: number;
  observedAt: number;
  timingSource: "diff" | "fills" | "bootstrap";
  timingConfidence: "high" | "medium" | "low";
  preexisting: boolean;
  backfillStatus: "pending" | "done" | "exhausted";
}
```

queue에는 아래 작업 단위가 들어간다.

```ts
{
  positionKey: string;
  address: string;
  coin: string;
  strategy: "incremental" | "1d" | "7d" | "30d";
  startTime?: number;
  endTime?: number;
  enqueuedAt: number;
  traderTier: "S" | "A" | "B" | "C" | "D";
}
```

## 수집 파이프라인 변경

핵심 변경 파일은 [app/api/cron/collect/route.ts](/Users/gangjimin/Documents/main_dev/startup-ideas/trading-product/coin-brain-v2/app/api/cron/collect/route.ts)다.

수집 흐름은 다음과 같다.

1. Redis에서 이전 snapshot/timing/queue를 로드한다.
2. 기존과 같이 상위 트레이더의 `clearinghouseState`를 가져온다.
3. trader별 이전 snapshot과 현재 snapshot을 비교해서 timing state를 갱신한다.
4. queue에서 최대 5건만 꺼내 `userFillsByTime`로 backfill한다.
5. fills 역추적으로 `openedAt`/`lastAddedAt`를 복원한다.
6. 최신 signals와 timing state를 다시 Redis에 저장한다.

Backfill budget은 cron 1회당 최대 5건으로 고정했다.

## diff 규칙

구현된 상태 전이 규칙은 아래와 같다.

- `position_opened`
  - `observedAt = now`
  - `lastAddedAt = now`
  - `lastChangedAt = now`
  - `timingSource = "diff"`
  - `timingConfidence = "medium"`
  - `backfillStatus = "pending"`
  - `incremental` backfill queue 추가

- `position_increased`
  - `lastAddedAt = now`
  - `lastChangedAt = now`
  - `backfillStatus = "pending"`
  - `incremental` backfill queue 추가

- `position_decreased`
  - `lastChangedAt = now`
  - `lastAddedAt`는 유지

- `position_flipped`
  - 기존 lineage를 끊고 신규 포지션처럼 처리
  - `openedAt`는 다시 backfill로 복원

- `position_closed`
  - timing record와 queue task 제거

- 첫 수집 시 이미 열려 있던 포지션
  - `preexisting = true`
  - `openedAt = null`
  - `timingSource = "bootstrap"`
  - `timingConfidence = "low"`
  - S/A tier만 `1d` backfill queue 추가

## fills 복원 알고리즘

핵심 구현은 [lib/hyperliquid/timing/reconcile.ts](/Users/gangjimin/Documents/main_dev/startup-ideas/trading-product/coin-brain-v2/lib/hyperliquid/timing/reconcile.ts)다.

알고리즘은 현재 포지션 크기에서 시작해서 동일 coin fills를 최신순으로 따라간다.

- `startPosition`은 fill 직전 포지션
- `dir`과 `sz`로 fill 이후 포지션을 재구성
- reconstructed end position이 현재 추적 포지션과 맞는 fill만 lineage에 포함
- 같은 방향 노출을 늘린 가장 최근 fill 시각을 `lastAddedAt`으로 기록
- 0 또는 반대 방향에서 현재 방향으로 처음 넘어온 fill 시각을 `openedAt`으로 기록

복원 창은 다음처럼 제한된다.

- fresh open/increase: `incremental`
- bootstrap unresolved: `1d -> 7d -> 30d`
- 끝까지 못 찾으면 `backfillStatus = "exhausted"`

## 시그널 및 UI 반영

시그널 aggregation은 [lib/signals/aggregator.ts](/Users/gangjimin/Documents/main_dev/startup-ideas/trading-product/coin-brain-v2/lib/signals/aggregator.ts)에서 timing metadata를 `positions[]`에 붙인다.

추가된 필드:

- `openedAt`
- `lastAddedAt`
- `observedAt`
- `timingSource`
- `timingConfidence`
- `preexisting`

차트는 [app/components/coin-chart.tsx](/Users/gangjimin/Documents/main_dev/startup-ideas/trading-product/coin-brain-v2/app/components/coin-chart.tsx)에서 더 이상 가격 근사 캔들에 가짜 엔트리 마커를 찍지 않는다.

- `openedAt !== null`
- `timingConfidence === "high"`
- 차트 캔들 범위 안에 있음

위 조건을 모두 만족할 때만 시간 기준 마커를 표시한다.

상세 페이지 [app/dashboard/[coin]/page.tsx](/Users/gangjimin/Documents/main_dev/startup-ideas/trading-product/coin-brain-v2/app/dashboard/[coin]/page.tsx)에서는 아래 fallback을 보여준다.

- exact known: `최초 진입`, `최근 추가`
- unresolved but observed: `관측 시작 (tracked since)`
- preexisting: `추적 시작 전부터 보유 (pre-existing)`

## 새 모듈

추가된 모듈은 아래와 같다.

- [lib/hyperliquid/timing/types.ts](/Users/gangjimin/Documents/main_dev/startup-ideas/trading-product/coin-brain-v2/lib/hyperliquid/timing/types.ts)
- [lib/hyperliquid/timing/state.ts](/Users/gangjimin/Documents/main_dev/startup-ideas/trading-product/coin-brain-v2/lib/hyperliquid/timing/state.ts)
- [lib/hyperliquid/timing/reconcile.ts](/Users/gangjimin/Documents/main_dev/startup-ideas/trading-product/coin-brain-v2/lib/hyperliquid/timing/reconcile.ts)
- [lib/hyperliquid/timing/repository.ts](/Users/gangjimin/Documents/main_dev/startup-ideas/trading-product/coin-brain-v2/lib/hyperliquid/timing/repository.ts)
- [lib/hyperliquid/timing/presentation.ts](/Users/gangjimin/Documents/main_dev/startup-ideas/trading-product/coin-brain-v2/lib/hyperliquid/timing/presentation.ts)

## 테스트와 검증

테스트 파일:

- [tests/position-timing.test.ts](/Users/gangjimin/Documents/main_dev/startup-ideas/trading-product/coin-brain-v2/tests/position-timing.test.ts)

검증한 항목:

- scaled short 포지션의 `openedAt`/`lastAddedAt` 복원
- fill history 부족 시 incomplete 처리
- bootstrap pre-existing 처리
- open/increase/decrease/flip/close state transition
- backfill success 및 fallback retry escalation
- high-confidence marker만 차트에 표시되는지
- UI fallback 문구 생성

실행한 명령:

```bash
npm test
npx tsc --noEmit
npm run build
```

## 현재 한계

- bootstrap pre-existing 포지션의 exact open time은 `30d` window 밖이면 끝까지 모를 수 있다.
- 현재 backfill은 cron 경로에서만 수행되며, 온디맨드 화면 진입 시 추가 정밀 복원은 아직 없다.
- `openedAt` exact marker는 candle lookback 범위 밖이면 표시되지 않는다.
- lint warning은 기존 코드의 unrelated warning이 남아 있다.

## 운영 메모

- 이 기능의 핵심은 "정확하지 않으면 정확하지 않다고 표시"하는 것이다.
- 따라서 timing confidence가 낮은 포지션에 대해 과거 캔들에 추정 마커를 다시 찍지 않도록 유지해야 한다.
- backfill budget을 늘릴 경우 Hyperliquid `userFills*` weight 증가를 먼저 검토해야 한다.
