# StockPilot 시장 웹 출시·장애 점검

## 기획에서 운영까지 같은 상태 정의

- [토스증권 웹](https://www.tossinvest.com/)의 탐색·현재가 우선순위, [당근 SEED Foundations](https://seed-design.io/foundations)의 토큰·상태·접근성, [배민 디자인시스템 사례](https://techblog.woowahan.com/28538/)의 기획과 구현 간 상태 합의를 참고했다. 기존 StockPilot의 코드·스타일·브랜드에서 출발했으며 다른 서비스의 화면이나 자산은 포함하지 않는다.
- [AWS의 타임아웃·재시도 설명](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)에서 실패 시 무제한 재시도를 피하는 원칙을 적용했다. 현 구현은 거래소별 실패에 15초의 재시도 대기와 소스별 요청 상한을 둔다. 지터나 모든 프로세스에 걸친 전역 제한을 적용한 것은 아니다.
- [Google SRE의 외부·내부 점검 구분](https://sre.google/sre-book/monitoring-distributed-systems/)에 맞춰서 서비스 준비 상태와 실제 검색 계약을 함께 읽기 전용으로 점검한다. 배포 검증을 통과했다고 공급자 장애가 없거나 모든 시세를 수신했다고 결론 내리지는 않는다.

## 상태 계약

`GET /api/trading/bootstrap`의 `quoteSummary.KR/US`는 기존 응답에 추가된 선택 소비 필드다. `count`는 해당 응답에 포함된 시장별 양수 가격 기록 수이고 `latestAt`은 그중 시간대가 명시된 최신 기록 시각(UTC) 또는 `null`이다. `asOf`는 응답 생성 시각으로, 시세 시각과 별개다. 웹은 기록 범위를 표시하고 이 값으로 주문 허용 여부나 금융 계산을 바꾸지 않는다.

종목 목록의 `partial`과 `coverage`는 공급자 자료를 확인한 범위다. 장중 시세 지연 여부와 다르다. 제공 범위가 일부라면 결과 수는 수신한 범위만 의미한다. 실패한 공급자 응답을 빈 거래소로 기록하지 않는다.

## 출시 체크리스트

1. 로컬에서 `cd frontend && pnpm lint && pnpm run verify:safety && pnpm run verify:product && pnpm build`. 격리 브라우저에서는 360/390/768/1440 CSS px와 다크·라이트, 자산 카드 제목·금액의 대비, 최초 계좌 조회 지연/실패, 정상·부분 목록, 상세 및 모의주문 경로를 확인한다. 브라우저 접수 테스트는 운영 계좌를 사용하지 않는다.
2. 백엔드 `cd backend && uv run pytest -q`. 카탈로그 회귀에서 HTTP 실패·잘못된 압축·빈 자료·시간 초과·호출 취소·실패 소스 재시도 후 복구를 점검한다.
3. [코더스 공식 안내](https://coders.kr/llms.txt)에 따라 원본 → 실제 포크 동일 SHA → 기존 프로젝트 배포 순서를 따른다. 이미 진행 중인 배포가 있으면 같은 작업을 다시 요청하지 않는다. 운영 검증 전에는 새 데이터 마이그레이션이나 계좌 변경이 없음을 확인한다.
4. 배포 상태 `ready` 뒤에 `node frontend/scripts/smoke-market-release.mjs`를 실행한다. 고정된 운영 주소에서 홈·준비 상태·시세 샘플 계약·국내외 대표 종목 검색을 제한 시간 내 읽는다. 키·계좌·모의주문 쓰기는 없다. 표시된 ms는 해당 실행의 응답 관측값이며 부하 시험이나 SLO 보장이 아니다.
5. 오류가 발생하면 HTTP 상태, 실패한 단계, 현재 배포 ID만으로 범위를 좁힌다. 일시적인 준비 지연이면 동일 배포의 상태를 읽고 다시 확인한다. 반복 실패나 주문 정확성 문제는 추가 출시를 멈추고 운영 설정·공급자·직전 정상 버전 복구 가능성을 확인한다.
