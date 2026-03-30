# 차트 선택 인디케이터 이슈

## 문제

유저가 하단 진입 포인트 리스트에서 특정 트레이더를 선택했을 때, 차트에 있는 여러 arrow 마커 중 **어떤 것이 선택된 건지** 시각적으로 구분이 안 됨.

## 현재 상태

- 차트에 최대 15개의 arrow 마커가 동시에 표시됨
- 유저가 하단에서 클릭하면 price line(진입가/PnL/청산가)과 플로팅 카드는 표시됨
- 하지만 **마커 자체에는 아무 변화가 없어서** 어떤 arrow가 선택된 건지 모름

## 원하는 동작

유저가 진입 포인트를 선택하면, 해당하는 arrow 마커에 **가벼운 시각적 인디케이터**가 추가되어야 함.

예시:
- 선택된 arrow 주변에 얇은 링/글로우
- 또는 선택된 arrow만 밝게, 나머지 arrow를 살짝 어둡게
- 또는 선택된 arrow 옆에 작은 점/라벨 추가

핵심: **차트의 마커 자체에 붙어야** 하고, 줌인/줌아웃/스크롤에 따라 **마커와 함께 이동**해야 함.

## 기술적 제약

### Lightweight Charts v5 마커 API 한계
- `createSeriesMarkers(series, markers[])` — 마커 배열을 한번에 설정
- 개별 마커의 스타일을 동적으로 변경하는 API 없음
- 마커를 업데이트하려면 전체 배열을 다시 전달해야 함
- 반환된 plugin 객체의 메서드가 문서와 다를 수 있음 (v5 API 불안정)

### 시도했던 접근들과 실패 이유

1. **마커 재생성 (rebuildMarkers)**: 선택 시 전체 마커를 다시 그려서 선택된 것만 흰색/크게, 나머지 반투명으로 → plugin.remove()가 정상 동작하지 않아 에러. 또한 선택된 마커가 흰색 큰 화살표가 되어 시각적으로 이상함.

2. **HTML 오버레이 (div ring)**: `priceToCoordinate()`로 Y좌표 계산 후 HTML 원형 인디케이터를 차트 위에 올림 → Y좌표가 줌/스크롤 시 업데이트 안 되어 마커와 분리됨. 또한 원형 디자인이 arrow와 시각적으로 안 맞음.

### 가능한 접근 방향

1. **`createSeriesMarkers` 재호출**: plugin.remove() 대신, 같은 series에 `createSeriesMarkers`를 다시 호출하면 이전 마커를 덮어쓰는지 확인. 되면 선택 시 선택된 마커만 color/size 변경한 새 배열로 재설정.

2. **chart.subscribeCrosshairMove + priceToCoordinate 실시간 추적**: 줌/스크롤 이벤트마다 `priceToCoordinate()`를 다시 호출해서 HTML 오버레이 위치를 실시간 동기화. 이러면 HTML 방식도 가능해짐.

3. **Lightweight Charts 커스텀 플러그인**: v5는 custom series plugin API를 지원함. 선택 상태를 가진 커스텀 마커 플러그인을 만들면 완전한 제어가 가능하지만, 구현 복잡도 높음.

4. **마커 대신 추가 price line만 사용**: 선택 시 굵은 color price line을 진입가에 추가하는 것만으로도 "이 가격대가 선택된 거구나"가 전달될 수 있음. 가장 심플한 접근.

## 현재 코드 위치

- 차트 컴포넌트: `app/components/coin-chart.tsx`
- 마커 빌드 로직: `lib/hyperliquid/timing/presentation.ts` → `buildEntryMarkers()`
- 선택 상태: `selectedIdx` state
- 기존 하이라이트 라인: `highlightLinesRef` (price line 기반, 정상 동작 중)
- 플로팅 카드: 차트 좌상단 오버레이 (정상 동작 중)

## 정리해야 할 코드

현재 실패한 시도의 잔여 코드가 남아있음:
- `selectedEntryY` state — HTML 오버레이용, 제거 대상
- 차트 div 안의 "Selected entry ring indicator" HTML — 제거 대상
- `markersPluginRef` 관련 코드 — 이미 제거됨
