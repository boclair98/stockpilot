# OpenUI Design Plan

## 2026-10-28 · 시장 상단 전체 종목·검색 통합

### Resolved inputs
- Topic: StockPilot 시장 화면에서 전체 상장 종목을 찾는 흐름.
- Offer: 별도 페이지 이동 없이 순위와 전체 종목을 한 패널에서 전환하고 검색·페이지 탐색·실제 종목 상세를 연결.
- Audience: 국내·미국 주식을 탐색하는 한국어 초보·재방문 사용자.
- Primary user action: 시장 상단 `전체 종목` 선택 → 회사명·코드·티커 검색 → `시세 보기`.
- Deliverable: 기존 Next.js 시장 컴포넌트와 URL 상태에 통합된 실제 웹 화면 1개.
- Style direction: 현재 StockPilot의 명료한 금융 행·필터·검색 UI 유지. 새 브랜딩이나 마케팅 hero 없음.
- Tonal key: 현재 다크 기본과 라이트 테마 동등 지원.
- Icon policy: 현재 lucide 아이콘만 재사용.
- Proof assets: 기존 `/api/market/instruments`의 공식 목록·실제 응답 건수·coverage. 검증 fixture는 운영과 분리.
- Motion intensity: Minimal. 탭·버튼 피드백만 사용하고 reduced-motion 유지.

### Audit and composition contract
- 실제 문제: RankedMarketBrowser 우측의 `/stocks` 링크와 아래 접힌 FullMarketCatalog가 분리돼 있고, 전체 목록 검색은 별도 StockDirectory 페이지에 있음.
- Hero archetype: asymmetrical 제품 작업 영역. 기존 시장·자산 요약을 유지하고 과도한 도입 화면 추가 없음.
- First viewport: 시장 탐색의 한국/미국 선택 → `전체 종목 · 시가총액 · 거래량 · 상승률 · 하락률` → 해당 목록. 전체 종목 선택 시 바로 검색 입력·거래소·20/50/100개 표시가 나옴.
- Primary visual/proof artifact: 실제 이름·티커·거래소를 정렬한 전체 목록. 전체 목록이 전체 종목의 실시간 가격을 일괄 수신한다는 표현은 금지하고 기존 시세 상세로 연결.
- Interaction behavior: GET 조회만 사용. URL에 탐색 방식·국가·검색어·거래소·페이지·표시 수 저장, Back/Forward·새로고침·상세에서 시장 복귀로 복원. 늦은 응답 취소, 409 snapshot 만료·오류·빈 결과 재조회 유지.
- Reuse boundary: StockDirectory를 embedded 변형으로 재사용하고 중복 브랜드 헤더/국가 선택/접힌 목록 제거. 기존 `/stocks` 북마크는 통합 화면으로 안전하게 연결. 계좌·주문·API·앱인토스·기존 사용자 변경은 보존.

### Visual and implementation contract
- 현재 Pretendard, --ws-brand/#5262db, --ws-canvas/#f6f7fb·다크 #0b0d13, --ws-ink/#182131·다크 #f2f4fa 재사용. 탭·본문14–16px, 입력16px, 제목20–24px, 행 보조12–13px, 숫자 tabular-nums.
- 간격8/12/16/24px, 기존 패널 반경·divider 유지. embedded 목록에 중복 외곽 카드나 새 전체 화면 제목을 넣지 않음.
- 모바일: 44px 이상 탭/검색/페이지 버튼, 검색은 한 줄 전체 폭, 거래소 필터는 안전하게 줄바꿈, 목록은 로고·이름/코드·통화·시세 보기로 재배치. 필수 필드를 숨기거나 작은 글자로 줄여 넘침 해결하지 않음.
- CTA: `전체 종목`→같은 시장 패널, `검색`→기존 읽기 API의 q/offset/limit, `시세 보기`→기존 상세 URL(종목·시장·거래소와 탐색 복귀 정보 보존).
- 대상: RankedMarketBrowser, StockDirectory, TradingTerminal, 주 메뉴/바로가기/모바일 전체 메뉴, legacy stocks route, URL helper·공통 scoped CSS·회귀 테스트·README.
- 검증: 전체/순위 전환, 국내/미국 검색, IME·빈 결과·오류·취소·페이지 20/50/100·마지막 페이지·Back/Forward·상세 복귀. TypeScript/ESLint/빌드/기존 안전성 회귀와 360/390/768/1440 라이트·다크 시각 검사. 사용자가 승인한 범위로 GitHub 원본→실제 포크→코더스 웹 배포·운영 검증.

### Filled generation prompt
Create one integrated StockPilot market-discovery experience using its existing Next.js React components and current financial light/dark tokens. Offer Korean and US official instrument discovery in the same market panel through an explicit first `전체 종목` tab next to market-cap, volume and movement rankings. Reuse the existing directory API, accessible search form and bounded pagination without fetching prices for the entire universe or inventing data. Keep the current market summary, stock-detail and simulated-order workflows. Remove duplicate lower catalog and separate-page navigation from the primary flow; retain old /stocks URLs as parameter-preserving compatibility entry points. Preserve query, exchange, page, market and instrument identity across URL navigation, refresh and return from detail. Use current Pretendard, aligned rows, 44px controls and minimal reduced-motion-aware feedback. Verify actual Korean mobile/desktop content, empty/error/retry states and financial non-mutation boundaries. No new hero, copied broker assets, new dependencies, backend schema or private Apps in Toss changes.

### Output target
- Existing market page, embedded directory component, compatibility route and domain URL helpers under `frontend/`; no new independent product page.

## 2026-10-28 · 워커 관측성과 증권형 공시 목록

### Resolved inputs
- Topic: StockPilot 워커의 실제 점검 상태와 기업 공시 읽기.
- Offer: 계좌를 변경하지 않는 운영 진단과 SEC/DART 원문 탐색.
- Audience: 한국어 초보 투자자와 별도 인증된 운영자.
- Primary user action: 공시 원문 열기; 운영자는 워커 상태 다시 확인.
- Deliverable: 기존 Next.js/FastAPI에 통합하는 공시 목록과 운영자 전용 상태 페이지.
- Style direction: 기존 StockPilot 금융 목록의 정렬·여백·반복 행을 유지하는 명료한 증권 제품.
- Tonal key: 기존 다크 기본, 동일한 라이트 토큰 지원.
- Icon policy: 기존 lucide와 MIT 라이선스 Base UI 버튼만 재사용.
- Proof assets: 실제 제출 이력, 워커 heartbeat/점검 시각. 검증 화면에는 명시적인 합성 fixture만 사용.
- Motion intensity: Minimal, 버튼 160ms와 reduced-motion. 금융 숫자 count-up 없음.

### Audit and reference record
- 실제 코드: Next 16 static export/React19, FastAPI, 기존 --ws/--ci 토큰. 워커의 `/` 경로가 없어 404가 기록되고, DB/Redis 준비 외 작업별 성공 상태가 표시되지 않음.
- 기존 공시 화면은 중첩 프레임·모바일 여백이 크며 미국 응답 8개를 항상 5개로 자름. 계산·시세·계좌는 변경하지 않고 해당 목록만 정돈.
- 토스증권 공식 공개 페이지의 검색·필터·금융 열 구조는 문서에서 확인. 실제 브라우저 열람은 권한 차단되어 시각 검사를 했다고 주장하지 않음. 로고·전용 소스·폰트 복사 없음.
- Base UI: https://github.com/mui/base-ui/blob/master/LICENSE 의 MIT 라이선스 확인. 이미 설치된 패키지를 그대로 사용하고 라이선스 보존. 새 유료 템플릿/새 프레임워크 없음.

### Composition contract
- Hero archetype: asymmetrical, 신규 마케팅 hero 없음. 작업 화면의 제목/확인 시각/재조회가 첫 영역.
- First viewport: 운영 상태 제목 → 관측 범위와 마지막 heartbeat → 작업 이름·상태·최근 성공·소요시간의 정렬 행. 모바일은 각 행을 이름/상태와 시각/소요시간 두 줄로 재배치.
- Primary visual/proof artifact: 실제 worker job heartbeat와 SEC 원문 목록. 모니터가 없으면 정상 대신 미확인 표시.
- Interaction behavior: GET만 수동 재조회, 8초 제한/취소, 인증 만료 안내, 이전 자료 보존 후 오류 표시. 공시는 실제 URL 새 탭 연결.
- Reuse boundary: 브랜드·홈·계좌·내비게이션·금융 함수·API 인증 보존. 운영 페이지는 운영자 allow-list 유지, 계좌 정보 노출 안 함. 앱인토스 및 사용자 LeagueRooms 변경 제외.

### Visual and content contract
- 기존 Pretendard/system sans, tabular-nums; 제목24–30px/750, 행14–16px/1.6, 보조13px. 입력/주요 버튼16px·44px 이상.
- 기존 --ws-ink/--ws-muted/--ws-surface/--ws-line/--ws-brand 토큰 재사용, 다크 배경 #10131B·밝은 글자, 라이트 #F7F9FB·#172333. 실패는 텍스트+아이콘으로도 구분.
- 간격8/12/16/24/32px, 페이지 최대1120px, 모바일16–20px. 상태 목록은 공유 표면과 divider, 개별 nested 카드 제거. 제목/회사명 keep-all·긴 문자열 안전 줄바꿈.
- 주 CTA `다시 확인` → `/api/operations/workers` GET; 보조 `운영센터로` → `/operations`. 권한 없으면 Google 로그인/시장 복귀만 제공. 주문·대사·재시작 버튼 없음.
- 공시는 미국 최대8·국내 최대5와 실제 표시 건수를 일치시키고 날짜→제출 종류·제목→원문 링크를 정렬. 빈 자료를 0건의 실제 결과로 꾸미지 않음.
- 대상: worker/core monitor/3개 poller instrumentation/read-only operations route, WorkerStatusPanel와 `/operations/workers`, CompanyInsight와 scoped CSS, 격리 검증/문서. DB schema·주문 금액·생산 인증 설정 변경 없음.
- 검증: 성공/실패/취소/관측 만료/대기·인증 거부, Python 테스트·타입·린트·빌드, 360/390/768/1440 라이트·다크·키보드·넘침. 유료 서버·운영 대량 부하·GitHub 푸시·배포는 이번 로컬 구현에 포함하지 않음.

### Filled generation prompt and output target
Create one precise Korean StockPilot worker-status screen and refine its existing company-filings list. Use the current Next.js React components, FastAPI, Pretendard, lucide, MIT Base UI and semantic light/dark tokens. The primary action is a bounded read-only refresh; secondary actions are the existing operations console or public SEC/DART original. Place a clear title and observation age before aligned job rows; recompose rows on phones. Use only real timestamps and explicit unknown/stale/failed states. Preserve accounts, trading calculations, public web shell, private Apps in Toss and unrelated user changes. Use clear financial hierarchy, 44px controls, visible focus and minimal reduced-motion-aware feedback. Do not introduce a landing hero, invented performance, copied broker assets, new dependencies, fake healthy status, automatic order replay or production load. Output integrated source, isolated tests and verified responsive screenshots at `frontend/app/operations/workers/page.tsx`, `frontend/components/WorkerStatusPanel.tsx`, `frontend/components/CompanyInsight.tsx` and existing scoped style files.

## 2026-10-25 · 매매 캘린더와 장기 이용 정확성

- 범위: 사용자가 코더스 웹의 기능 고도화·오류 수정·배포를 요청했다. 기존 디자인·계좌·금융 규칙·앱인토스·사용자 LeagueRooms 변경은 보존한다. 홈 구성이나 브랜드 개편은 하지 않는다.
- 근거: 투자 기록에 날짜별 체결 탐색이 없다. 계좌 명세는 최근100주문만 합산해 오래 사용한 계좌의 누계가 잘릴 수 있다. 정기매수는 종목 통화 전환 시 기존 예산 숫자가 남고 검색 중 이전 선택을 제출할 수 있다. 일부 개인 응답의 구조 오류가 화면을 중단시킬 수 있다.
- Resolved inputs: Topic=실제 모의 기록 탐색; Offer=월별 체결 캘린더와 정확한 누계; Audience=한국어 초보/재방문 투자자; Primary action=달/날짜 선택 후 실제 체결 기록 확인; Deliverable=기존 웹 통합; Style=current StockPilot; Tonal key=기존 light/dark; Icons=lucide; Proof=본인 계좌의 실제 저장 기록과 격리 fixture; Motion=minimal.
- Composition contract: 신규 hero 없음. 기존 투자 기록의 목록/캘린더 전환을 제공하고 월 선택→월별 통화 요약→날짜→선택일 요약→상세 기록으로 연결한다. 날짜별 기록은 체결 시각(구형 기록은 주문 시각)을 기준으로 표시하고 주문일 필터와 명확히 구분한다. 원화/달러를 합산하지 않는다.
- 시각: 기존 --ws-ink/muted/surface/soft/line/brand/up/down과 Pretendard 유지. 제목20–22px/700, 본문14–16px/1.6, 입력16px, 보조13px. 간격8/12/16/24, 기존12–16px 반경. 모바일 7열 날짜는 가능한 44px 조작 높이, 요약은 한 열, 태블릿/PC 통화 요약 두 열. 숫자 tabular-nums, keep-all/min-width:0, 선택/손익은 글자로도 표시한다.
- CTA: 이전/다음 달→읽기 API 재조회; 날짜→해당일 실제 요약; 체결 기록 보기→기존 목록을 FILLED+체결일 범위로 조회. 로그인·데이터 없음·오류·재시도·시간초과·늦은 응답·키보드 포커스 상태를 제공한다. 광고·주문·잔고 변경 없음.
- 안전성: 본인 인증+계정별 SQL집계, 조회 월 범위 제한, 캐시 no-store. 총계는 DB집계로 구하며 기록 전체를 브라우저로 가져오지 않는다. 없는 손익·통화는 0으로 꾸미지 않는다. FX 재확인은 원래 견적/요청번호를 유지하며 새 환율 실패가 이미 처리한 결과 조회를 막지 않게 한다.
- 수정: TradeCalendar/component/helper/CSS, InvestmentHistory/OrderTimeline/history contract, read-only activity router/order_history, 명세 집계와 환전 복구, PersonalWorkspace 유효성/정기매수 선택. README/테스트/격리 preview를 함께 갱신한다.
- 검증: 월/KST 경계·계정 격리·집계100건 초과·중복 요청·응답 유실·잘못된 개인 응답·통화 전환. 빌드/타입/관련 lint/회귀 검사, 360/390/768/1440 라이트·다크·날짜→기록 흐름. GitHub 원본→실제 fork sync→코더스 ready→운영 화면/health를 확인한다. 실제 로그인·푸시·대규모 부하는 별도 한계로 보고한다.
- Filled prompt/output: Extend StockPilot's existing investment history with a precise read-only monthly execution calendar, currency-separated actual totals and direct date-filtered records. Keep the existing design system, routes, account ownership, trading calculations and web/AIT separation. Fix confirmed long-history aggregation, uncertain retry and recurring budget selection defects. Reuse semantic controls, loading/error/empty states, safe responsive layout and visible focus. Output integrated production components and regression tests without fabricated prices or balances.

## 2026-10-23 · 웹 일상 투자 흐름 고도화

- 목적/근거: 검색 중 이전 결과를 선택할 수 있고 뒤로가기에서 주문 초안이 다른 종목으로 넘어갈 수 있다. 전체 종목의 다음 페이지 재시도는 첫 페이지로 돌아간다. 투자 점검은 KRW와 USD의 절대 금액을 비교/합산한다. 보유 주식 목록에는 검색·시장·수익률 정렬·상세 진입이 없다. 리스크 분석은 통신 오류를 숨기고 계속 로딩한다.
- 범위: 기존 웹 Next/React/FastAPI와 현재 색상·레이아웃·계좌·금융 주문 규칙을 보존한다. 앱인토스와 기존 LeagueRooms 변경은 대상 밖이다. 이번 요청은 구현/로컬 검증까지이며 새로운 커밋·푸시·배포는 하지 않는다.
- Resolved inputs: Topic=일상 모의투자 탐색과 내 자산; Offer=정확한 종목 선택과 통화별 자산 점검; Audience=한국어 초보 투자자; Primary action=검색한 종목 선택/보유 종목 찾기/실패한 조회 재시도; Deliverable=기존 웹 통합; Style=current StockPilot; Tone=current light/dark; Icons=기존 lucide; Proof=기존 실제 API 계약과 명시적 로컬 고정 자료; Motion=minimal.
- Composition contract: 홈 hero·시장 순위 배치 변경 없음. 기존 자산의 보유 주식 섹션에 검색/시장/수익률 정렬을 추가하고 행에서 종목 상세로 연결한다. 투자 점검은 같은 통화 안에서 비중을 계산하며 보호 범위는 원화·달러로 분리한다. 분석 화면은 현재 구성 안에 재조회·명시적 실패/빈 기록 상태를 추가한다.
- 시각: --ws-ink/muted/surface/soft/line/brand/up/down 재사용, Pretendard 유지. 제목18–22px, 입력16px, 행본문14–16px, 메타13px, 44px 조작 영역, 기존12–16px 반경과8/12/16/20px 간격. 모바일 필터2열+검색전체폭, 행은 회사/수량과 평가액/수익률 순으로 재배치한다.
- CTA: 보유 회사명→기존 종목 선택/상세 흐름, 조건 초기화→로컬 검색 조건, 다시 시도→실패한 읽기 요청만 재시도. 자동 주문 재전송 없음. 기록 없는 지표는 0 대신 대시로 유지한다.
- 상태/접근성: 로딩·빈 결과·서버 오류·세션 만료·지연·응답 역전 처리, 취소 가능한 조회와 제한시간, 버튼 포커스·표 레이블·비색상 손익 구분. 개인정보·주문은 테스트 서버에서만 생성한다.
- 추가 확인 범위: 계좌 명세 실패 시 임의의 초기 잔액을 실제 계좌처럼 표시하지 않는다. 가격 알림 평가를 푸시 설정과 분리하고 오래된50건이 뒤 사용자 알림을 막지 않도록 순환한다. 목표 가격은 저장 가능한 정밀도로 검증하고 정기매수 시각은 유효한 HH:mm만 허용한다. 환전/정기매수의 결과 미확정 요청은 원래 요청번호를 보존한다.
- 변경 경로: TradingTerminal/FullMarketCatalog, 신규 HoldingsPanel와 통화별 risk helper, PortfolioAnalytics와 응답 검증, 필요한 알림 검증 보완. README는 실제 완성 항목만 갱신한다.
- 검증: 통화 분리/보호 중복 상한/수량 정밀도, 검색 중 선택 차단/뒤로가기 초안 초기화, 더보기 실패 후 기존 행 유지, 분석 실패/재시도. 타입·빌드와 관련 회귀 테스트, 360/390/768/1440px 라이트·다크 실제 브라우저. 미확인 운영 인증/부하 시험은 별도로 밝힌다.
- Filled prompt: Preserve StockPilot's existing product composition and theme. Improve instrument selection safety, owner-facing holdings discovery, currency-separated risk reporting, and recoverable read-only requests. Reuse existing instrument navigation, API/auth contracts, typography, stock marks, and semantic controls. Do not invent market data, returns, ranks, financial outcomes, or a new brand. Output integrated working components and verified local flows without publishing this new iteration.

## 2026-10-22 · 웹 개인 투자 흐름 개선

- 대상은 Coders 웹뿐이다. 앱인토스, 기존 계좌·주문 계산, 사용자 LeagueRooms 변경은 보존한다. 사용자가 이번 변경의 배포를 명시적으로 요청했다.
- 근거: portfolio API는 최근 주문 30개로 제한되고 OrderTimeline은 회사명·통화 없이 코드/체결가를 표시한다. 관심종목은 시장/정렬만 있어 이름으로 찾기 어렵다.
- 목적/사용자: 초보 투자자가 자신의 실제 모의 기록을 찾고 복기한다. 기존 시세/시장 화면 디자인은 보존한다.
- 주요 행동: 조회하기 → 인증된 읽기 전용 기록 API, 20건 더 보기 → 커서 다음 페이지, 불러온 기록 CSV → 현재 조회한 기록의 로컬 파일 저장. 서버로 내보내지 않는다.
- Resolved inputs: Topic=개인 투자 기록; Offer=회사명·기간·시장으로 실제 모의 주문 조회; Audience=한국어 초보자; Primary user action=기록 조회; Deliverable=기존 웹 통합; Style direction=현재 StockPilot; Tonal key=기존 light/dark; Icon policy=lucide; Proof assets=실제 API/격리 테스트 데이터; Motion intensity=최소.
- Composition contract: 신규 hero 없음. 기존 shell→기록 제목/조작→기간·검색 필터→일자별 주문 목록. 관심종목 기존 stock row 재사용. 모바일 필터 1–2열, 목록은 회사/방향/수량/체결금액 우선, 부가정보는 펼치기. 중첩 카드 없음.
- 시각: 기존 --ws-ink/surface/soft/muted/line/brand/up/down 재사용. 밝은 canvas #F7F9FC, ink #172333; dark #0C111A/#F0F4FA. Pretendard 제목22px, 본문15–16px, 보조13px, tabular-nums. 간격8/12/16/20/24, 컨트롤44–48px, radius12. 초점2px brand outline.
- 날짜 기준은 서울, 매수·매도는 텍스트/색상을 함께 사용. 통화 합산 금지. 주문 접수/체결 구분, 미확정 금액은 대시. CSV는 불러온 건수만, 전체 기록처럼 표현하지 않는다.
- 검색 변경/세션 만료/요청 유실/잘못된 데이터/빈 목록을 처리한다. 요청 취소와 순서 검증으로 이전 검색이 새 조건을 덮어쓰지 않는다. 인증 API에 주문/DB 쓰기 없음.
- 수정 경로: InvestmentHistory, OrderTimeline, MarketWatchlist, TradingTerminal 연결, order-history lib/CSS, backend history route/helper/tests, README와 격리 fixture. 배포 설정/DB schema 유지.
- Filled prompt: Preserve StockPilot's current working market composition, brand and light/dark tokens. Implement a clear Korean order history with authenticated cursor pagination, company identity, explicit side/status/currency, date filters, safe local CSV export, and searchable watchlists. Reuse semantic controls and existing rows; no new hero, invented performance, prices, mascot, or brand change. Keep mobile tap targets, focus, empty/error/retry states and reduced motion. Output integrated source, isolated API/browser tests and screenshots before canonical→fork→Coders publication.
- 검증: 서버 계정 격리/동일 시각 커서/필터/경계 날짜, CSV 수식 방지, 타입·빌드·safety; 격리 브라우저360/390/768/1440에서 필터·더보기·테마·키보드·넘침; 배포 후 화면·health·인증 거부 확인. 운영 주문을 시험 생성하지 않는다.
- 운영 QA 추가: 768px 시장 홈의 좁은 자산 요약에서 2열 세부금액과 flex가 겹쳐 한글 라벨이 세로로 줄바꿈됐다. 기존 색상/금액 계산을 유지하고 시장 홈의 세부금액만 1열로 배치하며 긴 행은 항목 단위로 감싸도록 보완한다.
- 같은 태블릿 구간의 구형 CSS가 KOSPI 그래프를 숨기는 점을 확인했다. 최종 디자인의 ≤1023px 구간에서 그래프를 명시적으로 복원하고 설명 아래에 배치한다. ≤767px의 기존 간결한 좌우 배치는 유지한다.
- 1024px 경계의 지수 설명에서도 KOSPI 이름이 숫자에 밀려 세로로 꺾였다. 이름은 축소하지 않고 지수명/숫자 묶음이 항목 단위로 줄바꿈하도록 처리한다.

## Variant 1

### Resolved inputs
- Topic: StockPilot 첫 방문·소개·공유 경험 고도화, 2026-10-20.
- Offer: 실제 한국·미국 시세로 종목을 살펴보고 연습 자금으로 모의주문하며 투자 판단을 복기하는 기존 서비스.
- Audience: 주식이 처음인 모바일 방문자와 링크를 공유받은 예비 사용자.
- Primary user action: `종목 찾아보기`로 시장 검색에 진입하고, 필요한 경우 Google 로그인 후 기존 모의주문 이용.
- Deliverable: 기존 Next.js React 컴포넌트, 가이드 페이지, 공유 메타데이터, 정적 대표 이미지.
- Style direction: 현재 StockPilot의 밝은 블루·인디고 소비자 금융 제품 스타일 유지. 정보 위계와 읽기 경험 개선.
- Tonal key: Light 중심, 기존 Dark 토큰으로 동등하게 지원.
- Icon policy: 기존 lucide-react만 사용. 이모지·새 로고·장식용 주식 일러스트 없음.
- Proof assets: 실제 존재하는 검색·모의주문·자산·복기·리그 경로. 가짜 가격·리뷰·성과 없음.
- Motion intensity: Minimal. 버튼 160ms, 안내 단계 200ms. reduced-motion에서 제거.

### Audit and evidence
- `app/page.tsx`는 `TradingTerminal`을 렌더링한다. Next 16.2.2 static export, React 19.2.4.
- `TradingTerminal.tsx`가 신규 방문 700ms 뒤 안내 모달을 자동으로 연다. 홈은 유용한 시장 화면이므로 비차단 안내가 적합하다.
- 기존 `/guide`는 동일한 작은 카드 5개와 작은 본문으로 구성되어 첫 행동이 약하다. 운영 브라우저에서 직접 확인했다.
- `OnboardingGuide`는 API 이름, 상위 10개 등 낡거나 구현 중심의 설명을 포함한다. 닫기/포커스 순환도 보완한다.
- 기존 `--ws-*` 토큰과 Pretendard, lucide 아이콘을 재사용한다. 주문 규칙·원장·API는 변경하지 않는다.
- root metadata에 공유 이미지가 없고, 일부 public route가 홈 canonical을 상속한다. route별 metadata와 정적 PNG를 제공한다.

### Composition contract
- Hero archetype: asymmetrical.
- First-viewport structure: `/guide`에 브랜드·시장 복귀 헤더, 2줄의 투자 연습 메시지, 2개의 행동(종목 탐색·기초 학습), 실제 기능을 설명하는 세 단계 세로 타임라인. 모바일에서는 설명 다음 타임라인으로 읽힌다. 홈에는 80~120px의 비차단 첫 이용 안내만 배치하고 검색·지수·순위를 유지한다.
- Primary visual/proof artifact: 숫자·시세를 꾸며내지 않은 세 단계 투자 흐름. 01 종목 찾기 → 02 모의주문 → 03 기록과 복기.
- Interaction behavior: 홈 종목 찾기는 기존 검색으로 포커스, 안내는 수동 모달, `/guide` 링크는 기존 기능에 직접 연결. 공유는 Web Share 또는 클립보드, 실패하면 복사 가능한 주소 제공. 개인정보 포함 안 함.
- Reuse boundary: 토큰·아이콘·기존 financial component 재사용. 새 클래스는 `welcome-*`, `guide-*`, `site-share-*`로 한정한다.

### Visual system
- Light canvas `#F7F9FC`, surface `#FFFFFF`, ink `#172333`, muted `#637184`, border `#E4EAF1`.
- Brand text `#1F56C9`, solid `#2463EB`, tint `#EDF4FF`. Dark는 기존 `data-theme` 토큰을 재사용한다.
- 폰트 StockPilot Pretendard → Pretendard → system sans. 제목 40–56px desktop, 30–36px mobile, 본문 16px/1.75, 보조 14px/1.6. 금액 tabular-nums 유지.
- 간격 4/8/12/16/24/32/48/72px. 콘텐츠 최대 1180px, 모바일 가로 20px. 주요 컨트롤 48px. radius 12px control, 20px 독립 모듈.
- 타임라인은 연결선과 숫자로 순서를 전달한다. 임의의 상승 차트·수익률·현금은 표시하지 않는다.
- 페이지 위계는 제목→행동→사용 흐름→기능 탐색→FAQ. 독립 기능 탐색만 낮은 카드 군집을 사용한다.
- 모바일 실화면에서 기존 하단 화면 설정이 기능 카드를 가리는 것을 확인해 가이드의 테마 전환은 상단으로 옮긴다. 금액 숨김·목록 밀도는 이 설명 페이지에 필요하지 않아 가이드에서만 제외한다.
- 배경/전경을 같이 토큰화해 dark에서 흰 카드와 흰 글자 혼합을 방지한다.

### Content and routes
- 핵심 문구: `투자, 내 돈 없이 먼저 연습해요.` / 실제 시세로 한국·미국 주식을 살펴보고, 연습 자금으로 나만의 판단을 확인해 보세요.
- Primary CTA `종목 찾아보기` → `/#search-card`; secondary `주식 기초 배우기` → `/learn`.
- 흐름 링크: `/#search-card`, `/#holdings`, `/#decision-review`. 주문 시 로그인·최종 확인을 기존 경로에서 수행.
- 기능 탐색: `/compare`, `/league`, `/notifications`, `/account-tools`.
- FAQ: 로그인 범위, 연습 자금과 실제 돈, 시세 차이, 보유 종목 비공개. 별도 앱 출시 약속 제거.
- 계좌의 원화와 달러는 별도임을 유지한다. 홍보용 총자산 합산 수치 없음.

### Assets, accessibility, implementation
- 실제 자산: 기존 PretendardVariable.woff2와 lucide. 공유 PNG는 코드로 렌더링하는 1200×630 원본, 개인 데이터·주가 없음.
- 이미지 대체 설명: StockPilot, 실제 시세로 내 돈 없이 투자 연습. 대표 이미지는 정적 공개 자산.
- 모달 focus trap/복귀, Escape, 스크롤 잠금은 기존 `useDialogFocus` 재사용.
- 모바일 360/390, tablet 768, desktop 1440. 키보드/테마/줄바꿈/가로 넘침/CTA 실제 경로 검증.
- 유지: 계좌/주문/랭킹/공시 API, 개인정보, 기존 웹 디자인, private AIT, 사용자 LeagueRooms 변경.
- 수정: `app/guide/page.tsx`, `components/OnboardingGuide.tsx`, `TradingTerminal.tsx`, `ShareSiteButton.tsx`, `app/welcome.css`, `lib/site-metadata.ts`, 관련 public page metadata, `app/sitemap.ts`, `app/layout.tsx`, `public/social/`, `scripts/generate-social-image.mjs`, README.
- 빌드·타입·변경 파일 lint·기존 safety 검사 후 격리된 local fixture에서 확인한다. production write는 하지 않는다.
- 개발·로컬 검증 후 사용자가 `배포해줘`로 게시를 승인했다. 이번 웹 변경만 canonical upstream → 실제 fork 동기화 → 기존 Coders 재배포 → 운영 화면 검증 순서로 게시한다.

### Reference board
| Source | Platform | Observed | Adaptation |
| --- | --- | --- | --- |
| StockPilot live `/` and `/guide` | 실제 웹 브라우저 | 밝은 금융 목록, 블루/인디고, 기존 가이드의 작은 본문·반복 카드 | 브랜드 유지, 가이드만 강한 위계와 흐름 표현 |
| https://seed-design.io/foundations/color/color-role | 공식 DS 문서 | 전경·배경·경계와 brand/neutral/state 역할 분리 | 기존 역할 토큰 재사용, dark 전경과 배경 함께 관리 |
| https://nextjs.org/docs/app/api-reference/functions/generate-metadata | 공식 framework 문서 | route metadata 상속과 OG 정의 | canonical·OG를 public route별 명시 |

### Filled generation prompt
Create one high-concept page for StockPilot's beginner investing-simulation guide and its compact home entry.

## Inputs
- Topic: First visit, product explanation, and sharing for StockPilot.
- Offer: Explore actual Korean and US quotes, use existing simulated orders, and review decisions.
- Audience: Korean beginners arriving mostly on phones.
- Primary user action: Open the working instrument search.
- Deliverable: React components integrated into the existing Next.js static-export application.
- Style direction: Current StockPilot consumer-finance identity, precise editorial hierarchy, friendly practical controls.
- Tonal key: Light, with existing dark-theme semantic counterparts.
- Icon policy: Minimal lucide-react icons from the current product.
- Proof assets: Existing working routes and real feature descriptions only.
- Motion intensity: Minimal, with reduced-motion support.

## Objective
Create a memorable, readable guide with one dominant message and a coherent StockPilot visual world.
Choose a clear action-oriented composition specific to investing practice. Preserve the current market workspace rather than displacing it with a campaign.
Treat integration as a packaging constraint, not permission for generic composition.

## Internal concept choice
Use an asymmetric editorial hero, a single connected three-step practice flow, the existing blue brand, light tonal key, minimal motion and functional icons. The guide is the explanatory destination; the market home retains compact working content.

## Non-negotiables
Use a strong guide-first hierarchy, a two-line short Korean heading, one concise supporting paragraph and at most one primary plus one secondary hero action. Keep support highlights in one lower cluster. Never invent metrics, testimonials, quotes, proof UI or customer logos. Make all links functional.

## Composition
Lead with typography and a connected sequence of actual tasks. Navigation remains subordinate. The guide hero is not a floating card, fake chart or phone mockup. Use scale, spacing and alignment for hierarchy. Keep secondary features beneath the initial sequence. Do not overlap text or obscure content.

## Visual system
Reuse current StockPilot tokens, font, icon weight and brand mark. Let Korean financial reading determine the layout. Use brand text for selected emphasis, neutral surfaces for reading, and existing sign-based gain/loss semantics wherever inherited content appears. Avoid arbitrary color modules and stock art. Keep a deliberate page rhythm and legible labels.

## Background and tonal diversity
Use the existing light canvas and a subtle brand tint only where it clarifies progression. The dark theme has its own existing surfaces. Do not introduce a new product-wide palette or default to cinematic dark presentation.

## Proof and concept expression
The single topic-native artifact is a connected sequence of search, simulated order and review. No fabricated balances, charts, gains, market data, screenshots or activity. A visitor can follow each step to the actual existing product.

## Icons and symbolic language
Keep lucide-react icons secondary to text. Use the current chart brand icon. Do not add emojis, mascots, airplanes, floating coins, unrelated decorative symbols or a second icon system.

## Support cluster
One lower feature group links to real comparison, league, notification and account tools. It may use a quiet border/surface treatment. No nested cards. The FAQ and source explanations use normal document flow.

## Motion
Use brief nonblocking control feedback and a restrained step transition. No autoplay, parallax, count-up balances, pulsing prices or hijacked scroll. Respect prefers-reduced-motion.

## Accessibility and readability
Use semantic headings, labeled navigation and visible focus. Important controls are at least 44–48px. Keep Korean word boundaries with safe long-string wrapping. Mobile composition is single column; no page overflow. The help dialog traps focus, closes with Escape and restores its trigger. Shared addresses have clear status and a manual-copy recovery path.

## Anti-drift rules
Do not use a generic SaaS dashboard, decorative financial charts, unrelated gradients, fake proof, nested surfaces, tiny gray text, text collisions, or an oversized welcome that hides the market. Retain the recognizable existing application design.

## Output
Complete integrated React, CSS and static share assets, with minimal dependencies. Include screenshot evidence and meaningful checks, not an isolated concept.

## Final self-check
Check one dominant guide message, one visual world, factual proof, working routes, no unnecessary fragments, responsive reading, adequate contrast, no overlap, keyboard behavior and dark mode. Compare desktop and mobile visually and fix observed issues.

### Output target
- Path: `frontend/app/guide/page.tsx`, `frontend/components/TradingTerminal.tsx`, and the scoped supporting files listed above.
# 2026-10-25 · 증권 서비스형 탐색과 종목 상세

## 감사 결과와 범위

- 기존 Next.js 16.2.2 static export/React 19/FastAPI와 StockPilot 브랜드를 유지한다. 실거래·신용·대출·실계좌 기능은 추가하지 않는다. Apps in Toss와 기존 계좌 데이터/주문 규칙/사용자 LeagueRooms 변경은 범위 밖이다.
- `TradingTerminal.tsx`의 시장·관심·자산·기록/상세 화면과 기존 비교·공시·정기매수·환전은 이미 있다. 중복 서비스를 만들지 않는다.
- 근거: `StockTrendPanel.tsx`는 실제 OHLCV를 받지만 선과 종가/거래량 표만 제공하며 날짜 검사·조회 제한시간·재시도가 부족하다. 미국 전용 `quote-details` API는 웹에서 사용하지 않는다. 순위 목록은 `/compare`로 종목을 바로 전달하지 않으며 작은 화면에서 순위 지표가 숨겨진다.
- 이번 결과: 실제 미국 핵심 지표, 선/봉차트·거래량·선택일 OHLC, 순위에서 최대3종목 비교 연결, 시장 홈의 주요 기능 바로가기와 반응형 정보 위계. 새로운 데이터 공급자·DB 마이그레이션·실제 주문은 없다.

## 참고 보드와 관찰 한계

|원문/플랫폼|직접 확인한 내용|StockPilot 적용|
|---|---|---|
|https://stock.naver.com/ · 공개 웹 텍스트|국내/미국·글로벌/시장지표/뉴스/리서치/MY의 명확한 정보 구획, 최근 본·관심·보유 패널|기존 화면을 역할별로 연결하고 주요 기능 진입점 제공|
|https://www.tossinvest.com/ · 공개 웹 텍스트|홈/주식 골라보기/내 계좌, 시총·거래량·등락률 순위와 필터|일관된 순위 행, 작은 화면에서도 지표명과 수치 제공, 비교 동선|
|https://securities.miraeasset.com/ · 공식 공개 페이지|본문 추출 불가|확인하지 못한 UI·기능을 관찰했다고 주장하지 않음|
|StockPilot 운영·로컬 화면 · 직접 관찰|기존 인디고/뉴트럴 테마, 종목 상세·차트·시장 목록·하단 메뉴|기존 브랜드/컴포넌트와 실제 데이터 재사용|

네이버·토스 참고 사이트의 브라우저 열기 권한이 거부되어 해당 화면의 시각·간격·모션을 직접 관찰하지 못했다. 이를 우회해 캡처하지 않는다. 타사 자산·폰트·화면을 복제하지 않고 공개 구조와 실제 프로젝트에 근거해 설계한다.

## Variant 1 — StockPilot Brokerage Workspace

### Resolved inputs
- Topic: 실제 한국·미국 시세로 연습하는 StockPilot의 증권형 시장 탐색과 종목 분석.
- Offer: 종목 찾기→핵심 지표·OHLCV 확인→2~3종목 비교→기존 모의주문/관심/기록으로 이어지는 작업 흐름.
- Audience: 모바일 중심의 주식 초보자와 데스크톱에서 여러 종목을 살펴보는 기존 사용자.
- Primary user action: 시장 순위에서 종목 상세를 열어 근거를 확인하거나 비교할 종목2~3개를 고른다.
- Deliverable: 기존 React 제품에 통합된 반응형 웹 컴포넌트·CSS·검증 코드. 새로운 마케팅 랜딩은 만들지 않는다.
- Style direction: Clear Consumer Brokerage; 기존 인디고 브랜드, 안정적인 숫자 열, 읽기 쉬운 한국어, 공유 표면과 정돈된 도구 모음.
- Tonal key: 기존 다크 기본값과 사용자가 선택한 라이트 테마를 그대로 존중한다.
- Icon policy: 기존 lucide-react의 일관된 선형 아이콘만 사용한다.
- Proof assets: 기존 실제 순위/시세/history/quote-details API와 프로젝트의 허용된 종목 로고. 새 증거 이미지·가격·인기·수익률은 만들지 않는다.
- Motion intensity: Minimal; 선택·접기·재조회 피드백120~180ms, reduced-motion에서 제거. 가격 카운트업·자동 행 재정렬·상시 점멸은 없다.

### Composition contract
- Hero archetype: asymmetrical product workspace; 대형 캠페인 히어로 대신 간결한 시장 제목·세션 문맥과 실제 순위가 첫 화면을 이끈다.
- First-viewport structure: 기존 상단 탐색과 검색→시장 제목→간결한 기능 바로가기→시장/계좌 요약→순위 시작. 데스크톱은 기존 주 영역+관심 보조 영역, 모바일은 검색·시장 목록 우선 단일 열.
- Primary visual/proof artifact: 실제 종목 목록과 종목 상세의 OHLCV 차트. 장식용 대시보드·기기 목업·비행기 이미지를 만들지 않는다.
- Interaction behavior: 종목 행 상세 이동과 관심/비교 조작 분리; 비교는2~3개일 때 `/compare?items=...`로 실제 이동; 지표/차트 실패는 해당 영역에서 재조회, 주문 자동 재시도 없음.
- Reuse boundary: API·인증·금액 계산·기존 주문 창·비교 페이지·로고·테마 토큰 재사용. 새 도메인 컴포넌트는 독립된 스타일 범위를 가지며 전역 색상 덮어쓰기는 하지 않는다.

### 시각·반응형 기준

실제 `stockpilot-design.css`/`theme-contrast.css`의 최종 토큰을 우선한다. 밝은 배경#F7F9FC, 표면#FFFFFF, 글자#172333, 보조#637184, 선#E4EAF1, 브랜드#2463EB; 다크는 기존 토큰을 재사용한다. 상승/하락은 기존 빨강/파랑과 부호·문구로 구분하며 매수/매도·폼 오류와 혼동하지 않는다.

폰트는 기존 StockPilot Pretendard/시스템 대체, 금액 tabular-nums. 본문14~16px, 입력16px, 섹션20~22px, 큰 시세30~36px. 간격4/8/12/16/20/24/32, 일반 컨트롤12px 반경, 주요 표면16~18px. 작은 글씨로 문제를 숨기지 않는다.

360/390px: 조작44px 목표, 날짜·수치 줄바꿈 억제, 비교 트레이는 하단 네비/주문 버튼과 겹치지 않는 문서 흐름. 순위 지표는 별도 라벨 있는 보조 행으로 표시한다. 768px: 차트/주문 영역이 좁아지기 전에 단일 열. 1440px: 차트 주 영역과 기존 주문 패널 유지. min-width:0, keep-all, 긴 식별자 overflow-wrap 적용. 가로 넘침을 전역 숨김으로 해결하지 않는다.

### 내용·데이터 계약·상태

- 미국 핵심 지표는 `GET /api/trading/quote-details`의 일치하는 symbol/exchange/currency만 표시한다. PER/PBR·시총·52주 값 null은 `—`, 오류/자료없음/로딩을 구분한다. 한국52주 값을80일 자료로 추정하지 않는다. 새 공급자나 재배포 권한이 필요한 호가·틱·기관수급·컨센서스는 이번에 만들어내지 않는다.
- 차트는 `/api/features/history`의 실제 일별 자료를 날짜/가격/거래량 검증 후 사용한다. 유효하지 않은 OHLC는 봉을 그리지 않으며 종가가 확인된 자료는 선 모드로 안전하게 확인할 수 있다. 기간과 일봉 간격을 구분하고 현재 계좌 곡선으로 가짜 과거를 만들지 않는다. 키보드와 표 대체 제공, 터치 세로 스크롤 방해 금지.
- 비교 선택은 공개 종목 identity만 URL에 포함하며 개인 보유·잔고·메모를 포함하지 않는다. 시장 전환·더보기에도 선택 유지, 최대3개·중복 방지·선택 해제/초기화 제공. 비정상 API/타임아웃/이전 응답은 복구 가능하게 처리한다.
- 핵심 CTA: 종목 비교 `/compare`, 가격 알림 `/notifications`, 계좌 도구 `/account-tools`, 매매 기록 `/#decision-review`; 버튼처럼 보이는 장식·가짜 제휴/추천/공식 인가 표시는 없다.

### Filled generation prompt

Create one high-concept product page for StockPilot's real-market simulated-investing workspace.

Inputs: Topic is Korean and US stock discovery and evidence-based practice. Offer is a working progression from actual rankings to instrument fundamentals, OHLCV inspection, comparison and the existing simulated order flow. Audience is beginner mobile investors and returning desktop users. Primary action is inspect an instrument or select two to three instruments for comparison. Deliverable is integrated React components in the existing Next.js application. Style direction is Clear Consumer Brokerage. Tonal key follows the existing dark default and selectable light theme. Icon policy is minimal, existing Lucide only. Proof assets are the project's actual API responses and permitted instrument marks, never fabricated financial data. Motion intensity is minimal.

Objective: make the useful product content dominant, specific and action-oriented. Choose one clear solution; do not replace the working market with a marketing campaign. Internal concept is an asymmetrical product workspace with the stock list and price chart as the single proof artifact, existing indigo/neutral tokens as palette driver, consistent dark/light semantics, and feedback-only motion.

Non-negotiables: one concise first-viewport heading, useful market content visible quickly, at most one primary and one secondary promotional CTA if any. No invented users, prices, testimonials, popularity, integrations or screenshots. Existing accounts, APIs, routes, order calculations and financial correctness are mandatory. Product-native financial rows and focused analysis panels are justified; generic floating SaaS decorations and nested decorative cards are not.

Composition: preserve shell and search, improve access to existing tools, align identity/price/change/metric in rows, provide an accessible comparison selection tray, and make quote→chart→facts→deliberate simulated order the detail hierarchy. Keep personal context subordinate on mobile; retain meaningful two-region composition on desktop. Use typography, alignment, spacing and contrast before extra frames.

Visual system: reuse semantic StockPilot tokens, Pretendard fallbacks, tabular figures, existing logo and Lucide icons. Separate brand, gain/loss, action and error semantics. No proprietary company assets, company fonts, random colors, fake cockpit, coins or mascots. Background and surfaces should serve financial reading, not cinematic decoration.

Proof and concept: actual API values remain unmodified. Null is not zero, missing is not empty success, stale data keeps its timestamp. US fundamentals appear only for supported US instruments; actual daily OHLCV determines candlesticks and volume. Preserve gaps and the accessible table. No future data leakage or invented historical curve.

Support: group existing comparison, alerts, account tools and records in one compact service cluster, not repeated feature banners. Keep these controls subordinate to market discovery.

Motion: optional120~180ms state feedback only. No scroll hijacking, fake urgency, pulsing prices or count-up balances. Respect reduced motion and do not delay financial actions.

Accessibility and readability: semantic navigation, labels and table captions, keyboard focus, finite request states, inline retry, 44px important touch targets, clear price signs, useful long Korean wrapping, safe mobile navigation and order actions. No text overlap, one-syllable columns or hidden essential metrics.

Anti-drift: keep one coherent product language and actual working functionality. Do not collapse into generic dashboards or a recolor-only exercise. Do not add disconnected features, fake proof, floating panels or an unused second component library. Preserve existing private Apps in Toss source and unrelated user edits.

Output: integrated production-ready React/CSS/helpers/tests in the existing project, with minimal dependencies and responsive behavior. Final self-check covers desktop/mobile composition, actual data/error flows, keyboard/table alternatives, contrast, no overflow, working comparison URLs, no private values in links, and build/test results. Report unavailable visual-reference access and any new API licensing requirement honestly.

### Output target
- `frontend/components/TradingTerminal.tsx` integration and compact service access; new `BrokerServiceAccess.tsx`/scoped CSS.
- `frontend/components/StockTrendPanel.tsx`, chart helper/style/tests for actual OHLCV.
- New US detail component/helper/style/tests; backend contracts unchanged.
- `frontend/components/RankedMarketBrowser.tsx`, `StockRow.tsx`, scoped ranking/comparison styles/tests.
- Existing `layout.tsx`, `package.json`, README and QA notes only as needed.

### 실행·검증

기존 build/TypeScript/ESLint·안전성10종에 새 지표/차트/비교 회귀를 더한다. 운영 API는 읽기 전용으로 확인하고 쓰기는 격리 테스트만 한다. 360×800/390×844/768×1024/1440×900 양 테마의 실제 StockPilot 화면을 관찰한다. 참고 사이트 차단을 우회하지 않는다. 공개 전 민감값/기존 사용자 변경 제외를 재확인하며, 게시 권한이 확인된 범위에서만 upstream→fork→Coders→운영검증 순서로 진행한다.

# 2026-10-25 · 전체 페이지 안정성·컨테이너 레이아웃 감사

## 실제 문제·목적과 범위
- 사용자 제공 운영 스크린샷에서 관심종목 검색/시장/정렬/개수 표시가 좁은 사이드 패널에 맞지 않고, 종목명·가격 행도 어긋난다. `MarketWatchlist`가 전역 `.record-filters` flex 규칙을 사용하며, 공통 `StockRow`에 viewport 기반 grid 규칙과 오래된 sidebar 규칙이 중첩돼 있다.
- 기존 디자인·인디고 색상·다크 기본값·모의투자 계산·계좌·API는 유지한다. 새 기능을 늘리기보다 시장/관심/상세/주문/자산/기록과 비교·알림·계좌 도구·리그·학습·보조 페이지의 실제 오류를 수정한다. 사용자 `LeagueRooms.tsx` 변경과 artifacts는 건드리지 않는다.
- 이번 기준 자료는 사용자 스크린샷, 실제 컴포넌트/CSS/테스트, 열려 있는 운영 페이지다. 로컬 브라우저 접근을 막는 기존 저장 정책은 우회하지 않는다. 현재 운영 페이지를 읽고 조작하는 것은 가능하지만, 새 로컬 코드의 시각 검증 가능 여부는 별도로 보고한다.

## OpenUI resolved inputs · 1개 방향
- Topic: StockPilot 전 페이지의 안정적인 투자 탐색/기록.
- Offer: 기존 서비스의 필터·금액·상태·이동을 화면 너비에 맞게 정확하게 사용.
- Audience: 모바일 초보 사용자와 좁은 개인 패널을 병행하는 데스크톱 사용자.
- Primary user action: 회사명 검색 또는 필터로 종목을 찾고 실제 상세 화면을 연다.
- Deliverable: 기존 제품 전체 감사 및 실제 재사용 컴포넌트/스타일/동작 회귀 수정. 랜딩 추가 없음.
- Style direction: 기존 StockPilot 유지, container-aware clear consumer finance.
- Tonal key: 현재 다크/라이트 모두 읽기 쉬운 명료함.
- Icon policy: 기존 Lucide.
- Proof assets: 실제 사용자 스크린샷·운영 DOM·검증된 API 계약. 허구 가격/후기/성과 없음.
- Motion intensity: 기존 피드백만 유지, reduced-motion 존중.

## Composition contract와 시각 규칙
- Hero archetype: 기존 작업형 홈 유지. First viewport: 시장 문맥/자산 요약→검색·순위, 관심종목 보조 패널은 독립적인 container.
- Primary artifact: 실제 종목 행/계좌/기록. Interaction: 검색·시장·정렬·초기화·표시 개수를 각기 안정된 행에 놓고 폭에 따라 재배치. Reuse boundary: 폼과 종목 행의 의미 기반 class만 보완하고 기존 데이터/인증/주문 계약은 보존.
- 기존 `--ws-*` 의미 토큰, Pretendard, tabular 숫자, 본문14~16px, 입력16px, 44px 조작을 재사용. 인디고 브랜드·빨강 상승·파랑 하락 유지. 카드 padding16~20px, gap8/12/16px. 넘침 숨김/극소 글자로 해결하지 않는다.
- 좁은 컴포넌트는 검색 한 줄, 시장/정렬 다음 줄, 개수·초기화 별도 줄. 종목 행은 identity와 가격의 공간을 보장하고 필요 시 두 줄로 전환. viewport가 커도 sidebar는 compact 상태여야 한다.
- 페이지별 CTA는 기존 목적지/처리 함수를 그대로 유지한다. 숫자·통화·잔고·매수/매도·접수/체결 구분과 실패 복구 문구는 삭제하지 않는다.
- 운영 시각 감사에서 확인한 7~10px 보조 글자와 라이트 테마의 낮은 대비(예: 리그 설명 2.03:1)를 보완한다. 보조 글자는 최소12px, 설명13~14px, 밝은 중립 표면의 보조색#526174/강조#2855B5/따뜻한 강조#A84B12, 다크는 기존 `--ws-muted`/`--ws-brand`와 #EDBA82를 사용한다. 가격 상승/하락의 의미 색은 제외한다. 전용 관심 화면의 중복 탐색은 시장·전역 검색으로 유지하고 내 관심종목부터 배치한다.

## Filled master prompt / output target
Create one integrated repair of StockPilot's existing responsive product, not a new landing page. Topic: real-market simulated-investing discovery, assets and history. Offer: reliable controls and readable rows across narrow desktop panels and mobile screens. Audience: Korean beginner investors and returning desktop users. Primary action: search/filter an instrument and open its working detail. Deliverable: scoped React/CSS and regression tests in the current Next.js stack. Style: preserve StockPilot's current indigo/neutral identity, dark default and accessible light theme. Icons: existing Lucide only. Proof: actual screenshot, operating application DOM and existing API contracts. Motion: feedback only with reduced-motion support. Preserve accounts, data, routes and order rules. Fix layout at the actual component width, separate filter status/actions from fields, maintain readable numbers and long Korean names, and audit all existing destinations for functional errors, empty/loading/error states and navigation. Never fabricate data, hide critical content, overclaim testing or bypass blocked browser permissions. Output the real integrated fixes plus an evidence-based page checklist, build/tests and remaining validation limits.

## 실행·검증
- 실제 route inventory와 핵심 흐름별 검사표를 작성한다. 공통 관심종목/행/필터/개인 도구 및 확인된 요청 상태 버그를 먼저 해결한다.
- 격리된 컴포넌트 테스트로 검색·정렬·빈 결과·초기화·저장/삭제 분리·실패/오래된 응답 처리를 검증한다. 운영 쓰기/계좌 초기화는 하지 않는다.
- 기존 안전성 스크립트 전체, 변경 파일 lint, production build 수행. 운영은 360/390/768/1440px와 양 테마를 실제 관찰하고 새 코드의 미확인 시각 검증은 구분한다.
- 운영 직접 URL 재검증에서, 숨겨진 시장 레이아웃에 등록한 IntersectionObserver가 상세 전환 뒤 핵심 차트를 마운트하지 않는 경우를 확인했다. 차트·기업정보는 상세 화면 활성화 시 즉시 마운트하고, 나머지 보조 모듈의 지연 로드는 유지한다. 화면 디자인·시세 계산은 변경하지 않는다.

# 2026-10-27 · StockPilot consumer brokerage edition

실화면 1차 보완: 기존 모바일 규칙의 `display:none`/flex 충돌을 제거해 지수·자산 요약을 grid로 복원한다. 목록 필터는 이름이 명확한 native details로 접어 종목 접근을 앞당기며, 적용 중 상태를 별도로 표시한다. 작은 화면의 금액 범위·통화·자료 시각은 12px 수준으로 읽을 수 있게 유지한다.

## Variant 1

### 실제 감사와 보존 범위
- Next.js 16.2.2 static export / React19 / TypeScript / Pretendard / Lucide / 기존 CSS 토큰과 FastAPI 계약을 유지한다. 현재 홈은 안내·도구 바로가기·지수·자산·검색이 중첩돼 실제 종목이 늦게 보인다. 색만 바꾸지 않고 첫 화면의 읽기 순서를 다시 구성한다.
- 핵심 사용자: 한국·미국 주식을 처음 연습하거나 재방문해 관심종목과 계좌를 확인하는 모바일 사용자. 첫 행동은 실제 순위에서 종목을 찾고 상세 차트를 확인하는 것이다.
- 기존 계좌·주문 규칙·로그인·API·데이터·경로를 보존한다. 별도 앱인토스와 사용자의 LeagueRooms.tsx/artifacts 변경은 제외한다. 이번 작업의 GitHub 반영·기존 웹 재배포 및 로컬 브라우저 검증은 2026-10-27 사용자 답변으로 승인됐다.

### Compact reference board
|공식 출처 / 유형|직접 확인한 내용|적용 / 제외|
|---|---|---|
|https://seed-design.io/foundations/color/color-role / 디자인 시스템 웹 문서|브라우저에서 역할별 색 설명·명암 레이어·큰 제목과 읽기 흐름 확인|의미 기반 전경/표면/선 토큰; 로고·당근 색상은 복제하지 않음|
|https://tradingview.github.io/lightweight-charts/ / 라이브러리 문서·샘플|브라우저에서 일관된 차트 축·선·가격 라벨과 문서 예시 확인, 공식 v5.2 API 확인|Lightweight Charts의 확대·축소·이동·크로스헤어를 별도 확대 창에 사용; 기본 접근성 차트/표는 보존|
|https://github.com/tradingview/lightweight-charts / 오픈소스|공식 라이선스·NOTICE·필수 출처 안내 확인|패키지와 출처 표기를 함께 사용; 외부 위젯·외부 시세는 불러오지 않음|
|https://www.tossinvest.com/ / 소비자 증권 웹|공개 문서의 홈·종목 탐색·계좌 구조만 확인, 이번 실제 시각 관찰은 하지 않음|짧은 동선의 원칙만 참고, 화면·자산·전용 폰트 복제 없음|
|OpenBB 공식 GitHub / 공개 소스 검토|라이선스 조건을 확인|복사하지 않음. 복잡한 기관 터미널 구조를 소비자 화면에 이식하지 않음|

### Resolved inputs
- Topic: StockPilot, 실제 시세를 읽고 가상 자금으로 매매를 연습하는 소비자 증권 서비스.
- Offer: 시장 탐색, 한국·미국 순위, 가격·등락 조건 좁히기, 관심·비교, 읽기 쉬운 계좌·기록, 실제 기록을 사용하는 확대형 금융 차트.
- Audience: 모바일 초보 투자자 및 재방문 데스크톱 사용자.
- Primary user action: 시장 목록을 필터링하고 종목 상세를 연다.
- Deliverable: 기존 Next.js 제품 전체와 통합된 React/CSS, 새 목록 필터와 차트 탐색 창, 자동·브라우저 검증 및 승인된 웹 배포.
- Style direction: Quiet confidence, crisp consumer brokerage. 기존 인디고 정체성을 선명한 숫자·목록·섬세한 상태로 발전시킨다.
- Tonal key: 다크 기본값과 동등한 라이트 테마. 사진·마스코트·장식 코인 없음.
- Icon policy: 기존 Lucide 한 계열. 아이콘은 조작·탐색에만 사용한다.
- Proof assets: 실제 API와 계좌/순위 데이터. 디자인 검증용 자료는 명시된 로컬 fixture에서만 사용하며 운영에 포함하지 않는다.
- Motion intensity: Minimal. 140~200ms 조작 피드백, 시트는220ms 이하, reduced-motion 존중. 가격 count-up/리스트 무작위 이동 없음.

### Composition contract
- Hero archetype: asymmetrical, 단 마케팅 히어로가 아니라 작업형 시장 요약이다.
- First-viewport structure: 얇은 수평 탐색 → 간결한 오늘의 시장 제목 → 압축된 지수/계좌 문맥 → 주된 실제 순위 목록. 넓은 화면은 목록 약7:개인 문맥 약3. 좁은 화면은 지수·자산을 간결하게 접고 실제 종목 탐색을 우선한다. 반복 안내와 별도 기능 바는 하나의 작은 탐색 묶음으로 정리한다.
- Primary visual/proof artifact: 실제 KOSPI 흐름, 회사명/가격/등락률이 정렬된 종목 행, 데이터 범위가 명시된 목록 분포. 장식용 가짜 스파크라인을 만들지 않는다.
- Interaction behavior: 시장·거래소·순위는 서버 조회, 이름/가격/등락/관심 조건은 불러온 목록 내부 필터임을 명시한다. 필터 결과가0개면 초기화/더보기로 복구한다. 비교 선택은 독립 동작이며2~3종목만 기존 공개 비교 URL로 전달한다. 상세의 확대 창은 기존 검증된 일별 데이터만 사용하고 기본 주문/차트는 유지한다.
- Reuse boundary: 공통 토큰·종목 행·폼·섹션 제목·서비스 shell은 재사용한다. 데이터/금융 계산은 재작성하지 않는다. 새로운 광고·추천 AI·가입/결제 유도는 추가하지 않는다.

### Concrete visual system
- Canvas light #F6F7FB / dark #0B0D13; surface #FFFFFF / #141720; raised #F0F2F8 / #1C202C; text #182131 / #F2F4FA; secondary #58667A / #A7B1C3; border #E4E7EF / #2A3040.
- Brand solid #5262DB, light text #4053C4, dark text #B9C5FF, tint #EEF0FF / #242B49. Brand surface text white. Korean gains #CF3553 / #FF8194, losses #2763CE / #91B5FF; validation/success colors separately named. Measure actual contrast and retain signs/labels.
- Font: bundled StockPilot Pretendard, Pretendard, system sans-serif. Tabular numerals. Titles32/26px, section20/18px, row name15~16px, body14~16px, essential inputs16px, metadata12px. Weights450/600/700/800, line height1.4~1.6, Korean keep-all with safe long-token wrapping.
- Spacing4/8/12/16/20/24/32/40; gutters16 mobile,24 tablet,32 desktop; max working width1440px. Controls10~12px radius; panels18~22px; no nested rounded-card grids. Shadows only floating dialogs and restrained raised surfaces.
- Stock rows: market logo36px, unambiguous name/ticker column, tabular quote/change column, relevant metric, independent save/compare44px actions. Mobile keeps price and name and wraps long names without shrinking money.
- Chart enlargement: native modal top layer, labeled title/close, all-period/zoom controls, crosshair readings, red-up/blue-down both markets. Vertical page scrolling remains available; chart horizontal touch gestures and pinch are intentional. Empty/missing OHLC does not become fake candles. Canvas failure returns to the working basic chart and table.
- Shared surfaces: light/dark both use semantic roles; watchlists, assets, history, company/disclosure, league and service pages gain the same font/spacing/control finishing. Existing per-page meaningful layouts stay intact.

### Contents, paths and behavior
- `frontend/components/TradingTerminal.tsx`: compact market heading/overview and purposeful account actions, route/API/financial contracts unchanged.
- `frontend/components/RankedMarketBrowser.tsx`, new `MarketLens.tsx`, `lib/market-lens.ts`: real loaded-list distribution, name/price/movement/saved filters, result counts, reset and filtered paging state. No fabricated global popularity/breadth.
- `frontend/components/StockTrendPanel.tsx`, new `ChartExplorer.tsx` / `InteractiveChart.tsx`, `lib/chart-explorer.ts`: lazy expanded chart using approved open-source dependency, full keyboard alternatives and original basic SVG/table retained.
- `frontend/components/ServicePageShell.tsx`, common `StockRow` and new `frontend/app/product-workspace.css`: one visually coherent consumer product with modern responsive composition. Replace conflicting rules at the relevant layer rather than indiscriminate hiding/overflow clipping.
- `frontend/scripts/verify-product-edition.cjs`: deterministic helper and actual component regression tests; existing15 safety scripts remain required. README and third-party license/source record updated.
- Primary CTA: row `onSelect` → existing identity-bound detail. Secondary CTA: `rankingComparisonHref` → `/compare`. Account CTA `#holdings`, records `#decision-review`, extra services retain current routes. No unconnected buttons.

### Filled generation prompt
Create one high-concept integrated product page for StockPilot's real-market simulated-investing discovery.

Inputs: Topic is a Korean consumer brokerage learning product with real prices and virtual money. Offer is readable discovery, meaningful loaded-list filters, watchlists, comparisons and an expandable interactive financial chart. Audience is mobile-first beginner investors and returning desktop users. Primary user action is to browse or filter real instruments and open their detail. Deliverable is integrated React components and CSS in the current Next.js static-export application, with working behavior, tests and the authorized Coders web release. Style is crisp consumer brokerage with purposeful whitespace and typographic alignment. Tonal key is coherent dark-default and light themes. Icons are minimal existing Lucide. Proof assets are real product content, verified API contracts and isolated explicitly labeled local test fixtures only. Motion is minimal feedback, not animated money.

Objective: make StockPilot memorable through the craft of its actual financial interface. Keep one dominant topic-native market overview and one coherent visual world. The product is an actual securities-style workspace, so the unified list/quote/chart surface is the justified proof artifact; do not add a marketing dashboard mockup in front of the product.

Internal concept: asymmetrical working overview, actual market trace and stock list as single proof artifact, existing indigo brand, dark/light semantic surfaces, minimal continuity feedback and topic-native navigation icons. No additional alternative concepts are requested.

Non-negotiables: concise Korean titles and helper text; short task-specific CTAs; instruments visible in the first viewport; no fake prices, returns, users, reviews, company popularity, chart paths or integrations. Keep hierarchy through scale, alignment, spacing, restrained depth and meaningful state. No floating decorative panels, abstract aircraft/radar/coins, confetti or repeated banners. Financial correctness, privacy, existing accounts and order rules remain mandatory.

Composition: use a thin horizontal desktop shell and mobile bottom navigation. Compact market and asset context precedes a dominant stock list, with a secondary personal column on wide screens. Avoid a giant sidebar, full-screen welcome hero or a wall of equal cards. Preserve all supported feature access through a single lower discovery cluster. Do not hide essential data to fit the layout. The selected instruments, data timestamps and order identity remain coherent.

Visual system: use the concrete token palette and typography above. Match backgrounds, strokes and foregrounds by semantic role. Keep brand colors distinct from price movement and validation. No unreadable white small text on bright accents. Use original composition and licensed assets only. Depth is restrained and functional; typography and real content carry the page.

Proof and concept expression: a real KOSPI trace, expertly aligned stock rows and a clear expanded chart are the evidence. Never invent historical prices or rank metrics. Show absent values as unknown and provider failures as recoverable states. Explain loaded-list-only filter scope. Price precision and currency are retained.

Support cluster: group secondary learning, league, alerts and account tools once below the core work. Uniform low-emphasis styling, no duplication in the first viewport. All links lead to existing real destinations.

Motion: 140~200ms for control/selection feedback, up to220ms for modal entry. No scroll hijacking, constant pulsing, number count-ups or automatic rank shuffling. Reduced motion removes nonessential transitions. Feedback must never delay a trade action.

Accessibility and readability: use semantic lists, labels, pressed states, visible focus and focus restoration. Important touch targets44px. Use Korean wrapping and shrinkable grid children. Provide keyboard and textual alternatives to chart interaction. Modal cannot obscure its close action or trap users without Escape. Do not announce every quote tick. Test 320/360/390/430/768/1024/1440/1920 widths, both themes, enlarged text and active states.

Anti-drift rules: do not turn this into a generic SaaS landing page or institutional trading terminal. Do not replace existing APIs, authentication, account storage or financial math. No arbitrary library migration. New dependency must be justified by the chart interaction, pinned, licensed, dynamically loaded and cleaned up. Never weaken tests merely to get a green result.

Output and quality gate: implement real integrated files, run full safety/type/lint/build checks, then inspect actual desktop/mobile screenshots and correct composition, typography and state defects in three passes. Verify search → list filters → detail → expanded chart → close → order sheet → assets/history continuity without production account writes. Publish only through canonical upstream → actual fork sync → existing Coders deployment → ready and real production verification, as authorized. Report observed results, screenshots, dependency/license facts and remaining limitations without claiming zero possible errors.

### Output target
- Path: existing `frontend/app/page.tsx` and linked components; no replacement app or framework migration.
- First review:390×844 and1440×900, then320/360/430/768/1024/1920 edges, light/dark, keyboard/reduced-motion.
- Passes:1 composition and first content;2 typography/row/filter/theme;3 modal/keyboard/loading/error/responsive. Each pass produces actual code fixes when needed.

### 운영 360px 재검증 보완
- 첫 운영 배포의 실제 1억 원 자산 문자열이 360px에서 주문 가능 disclosure와 같은 행을 쓰면서 마지막 숫자만 줄바꿈되는 것을 확인했다. 기존 기능·폰트 크기·금융 계산은 유지한다.
- 389px 이하에서는 자산 금액과 disclosure를 각기 전체 행으로 배치한다. 금액은 한 줄을 유지하며, 극단적으로 긴 값은 해당 값 영역만 수평으로 읽을 수 있게 한다. 페이지 전체를 숨기거나 숫자를 생략·축소하지 않는다.
- 수정 경로는 `frontend/app/product-workspace.css`뿐이며, 실제 운영 320/360/390px의 금액 높이·한 줄 여부·글자 잘림·가로 넘침과 768/1440px를 재확인한다. 로컬 빌드·회귀 검사 후 upstream → fork → 기존 웹 재배포로 마무리한다.

## 2026-10-27 전체 종목 접근성·정확성 보완

- 목적/사용자: 처음 주식을 찾는 모바일 사용자와 전체 목록을 탐색하는 데스크톱 사용자. 기존 브로커리지 디자인·가상 계좌·주문 규칙은 유지한다.
- 근거: 운영 목록 API는 KR 3,962 / US 12,882건을 반환했지만 `FullMarketCatalog`가 순위 아래 접힌 영역에 숨어 있다. 기존 검색은 최대20건이고 페이지 점프가 없다. 공식 KIS 코스닥 마스터는 코스피와 다른 필드 길이를 쓰며, 영문 포함6자리 코드가 실제 파일에 있다. 기존 끝6자리 자르기는9자리 펀드 코드를 주식 코드처럼 취급할 수도 있어 교정한다.
- OpenUI resolved inputs: Topic=한국·미국 전체 종목 찾기, Offer=지원 거래소 전 종목의 페이지 탐색·검색·상세 연결, Audience=주식 초보자와 재방문자, Primary user action=종목 검색 후 상세 열기, Deliverable=기존 Next.js에 `/stocks` 통합, Style direction=기존 consumer brokerage 그대로, Tonal key=dark-default/light, Icon policy=기존 Lucide, Proof assets=실제 공식 마스터 및 격리된 테스트 자료, Motion intensity=낮음.
- Composition contract: hero archetype=작업형 제목·검색, first viewport=시장/거래소 필터와 실제 목록, proof artifact=전체 건수·해당 범위·정렬된 종목 행, interaction=20/50/100개 단위 페이지·직접 이동·URL 복원, reuse boundary=기존 토큰·폰트·로고·상세 URL 유지. 새로운 랜딩·마케팅 히어로는 만들지 않는다.
- 방향/토큰: 기존 `--ws-*` 색상, Pretendard, 26/32px 제목, 16px 입력·종목명, 12~14px 보조 정보, 44px 터치, 12px 컨트롤·20px 주요 표면, 4/8/12/16/24/32 간격. 작은 화면은 순위처럼 보이는 번호 대신 탐색 위치와 종목·거래소·상세 액션에 집중한다. 좁은 영역을 전역 overflow 숨김이나 숫자 축소로 해결하지 않는다.
- CTA: ‘전체 종목’→`/stocks`; 종목명/‘시세 보기’→기존 `/?view=detail&market=...&exchange=...&symbol=...`; ‘이전/다음/마지막/이동’은 읽기 전용 목록 조회. 가격은 수만 개 동시 요청하지 않고 기존 상세에서 실제 조회한다. 전체 건수와 검색 결과 수를 구분한다. 지원 밖 거래소·파생상품까지 모두 있다고 말하지 않는다.
- 상태: 중단 가능한 검색, 오래된 응답 무시, 목록 버전 변경409 시 첫 페이지 재조회, 실패 시 오류·재조회, 부분 자료 시 거래소별 상태 표시 및 전체 완전성 주장 금지. URL의 시장·거래소·검색·페이지 크기·페이지를 뒤로가기/새로고침에도 복원한다. 가격·주문 응답은 제조하지 않는다.
- 수정 경로: catalog parser와 읽기 전용 directory method/route, `/stocks` 페이지·client·helper·CSS, 홈/전체 메뉴/검색 바로가기, sitemap·README·회귀 검사. AIT 소스·계좌 DB·금융 계산 변경 없음. 라이브러리는 기존 기능으로 충분해 추가 설치하지 않는다.
- 검증: 공식 마스터 실제 파싱 전후 비교, 페이지 전체 순회·끝 페이지·한글/영문/티커 검색·거래소 필터·잘못된 입력·부분자료·snapshot 변경 테스트. 타입/린트/전체 safety/build 후 320/360/390/768/1440px 라이트/다크 실제 브라우저에서 검색→상세→뒤로가기 및 오류 복구. 실제 운영 계좌 쓰기는 하지 않는다.
- Filled master prompt/output: StockPilot의 현재 consumer brokerage 시각 언어 안에서 국내·미국 종목 전체 탐색을 한 화면에 완성한다. 실제 지원 범위와 자료 건수를 증거로 삼고 거대한 마케팅 카드 대신 읽기 쉬운 종목 행과 검색에 집중한다. 원본 모의주문·계좌·인증·통화·정확한 종목 ID를 유지한다. 기존 semantic colors·44px 조작·한국어 줄바꿈·reduced-motion을 따르며 모든 액션은 실제 읽기 API/기존 상세 URL에 연결한다. Output target=`frontend/app/stocks/page.tsx` 및 공통 진입점, backend 읽기 전용 API. 세 번의 검토는 구성→타입/간격/테마→상태/키보드/반응형 순으로 실제 결함을 고친다. 배포는 이번 변경에 대한 사용자 승인 후에만 한다.
