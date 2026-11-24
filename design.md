# StockPilot 디자인 기록

## 재검토 · 모바일 시장의 최근 종목 밀도와 시세 기준 글씨 (2026-11-22)

- **사용자/행동:** 모바일에서 시장을 열어 종목을 검색하거나 순위에서 고른다. 최근 본 종목은 빠른 재진입을 돕되 현재가·순위 첫 행보다 화면을 과하게 차지하면 안 된다. 계좌, 실제 주문 규칙, 시세 API, 앱인토스는 이번 범위에서 변경하지 않는다.
- **현행 근거:** 이번에 운영 `https://stockpilot.coders.kr/`의 PC 시장 화면을 이 인앱 브라우저에서 직접 열었다. 검색·순위는 주 영역, KOSPI·자산·관심종목은 보조 영역이며 최근 본 종목은 접힌 상태였다. 직전 배포의 실제 390px 캡처에서는 최근 6개가 펼쳐지면 세 줄로 감겨 목록 첫 행이 아래로 밀렸다. 소스 `discovery-redesign.css`에서 시세 표본 설명은 11px이다. 해당 모바일 캡처는 이번 세션에서 새로 캡처한 것이 아니라 직전 검증 산출물이다.
- **참고 관찰과 한계:** 2026-11-22 `https://ourworldindata.org/` PC 첫 화면을 실제 열었다. 검색과 주제 탐색의 구분만 보조 참고로 삼고 지도·히어로·수치 요약과 브랜드 표현은 제외한다. 이는 데이터 탐색 사이트이지 증권 제품은 아니다. Toss Securities와 Naver Finance 화면은 이번 브라우저 권한으로 열리지 않아 우회하지 않았다. `design.md`의 과거 기록은 이전 작업의 관찰이지 이번 직접 확인으로 간주하지 않는다.
- **선택:** 전체 색상·타이포 체계나 기능을 바꾸지 않고, 모바일에서 펼친 최근 종목을 내부 가로 스크롤 레일로 바꿔 전체 이름을 유지하면서 세로 공간을 줄인다. 접힌 제목에는 현재 항목 수를 표시한다. 키보드 사용자를 위해 레일을 명명된 스크롤 영역으로 만들고 포커스 표시를 유지한다. 시세 표본 글씨는 기존 토큰과 대비를 유지하며 12px로 올린다. PC에서는 기존 줄바꿈 목록을 보존한다.
- **수정 및 보존:** 화면 코드는 `frontend/components/TradingTerminal.tsx`, `frontend/app/discovery-redesign.css`만 변경하고, 사용자 안내를 맞추기 위해 README의 최근 종목 설명만 갱신한다. 검색·항목 선택·최근 기록 데이터, 로고·가격·시세 API, 계좌·주문 계산, 라이트/다크 토큰, 앱인토스 번들은 그대로 둔다.
- **수용 기준:** 빌드·타입·관련 회귀 검사를 통과한다. 실제 PC·모바일에서 최근 종목 접힘/펼침, 가로 레일의 포커스/스크롤, 긴 한국어 이름, 검색→종목 선택 흐름을 확인한다. 360/390/768/1440px에서 페이지 가로 넘침과 제목·고정 메뉴 겹침이 없어야 하며 라이트/다크 글자 대비를 확인한다. 직전 CAP 제공자 503은 이 UI 작업의 수정 대상이 아니며, 배포 검증 중 발생하면 목록 오류로 숨기지 않고 별도로 기록한다.

## 재검토 · 저장된 상태와 실패 상태를 포함한 시장 화면 (2026-11-22)

- 운영 배포 후 공개 시세·8개 화면 조건을 점검하던 중 기존 Google favicon 주소가 `t0`~`t3.gstatic.com/faviconV2`로 이동하면 이미지 CSP에 차단되는 것을 확인했다. 화면 구성·서버 API는 유지하고 웹 `img-src`에 실제 이미지 HTTPS 호스트 네 개만 추가한다. 스크립트·연결·프레임 정책을 넓히거나 플랫폼 통계 스크립트를 임의 허용하지 않는다. 기존 Nginx 1.27 실행 파일로 템플릿 문법을 확인한 뒤 운영에서 실제 이미지 로드·모바일/PC 두 테마·시세 조회를 재검증한다. 새 시각 방향이나 UI·DB 마이그레이션을 추가하지 않는다.
- 사용자가 제공한 운영 캡처는 최근 본 종목이 있을 때 검색 제목과 요약이 겹치며, 큰 제목·검색·필터 띠를 거친 뒤 하락률 조회 실패가 본문의 첫 내용이 되는 상태다. 이전 검증은 최근 본 종목이 없는 기본 상태 중심이어서 이 결함을 놓쳤다. 이번에는 공통 지침을 다시 읽고 프런트 구현과 독립 검토를 나눠 실제 상태를 재현한다.
- 기준은 기존 종목 검색 → 국내·미국 순위/전체 종목 → 상세 흐름이다. 같은 팔레트와 금융 정보는 유지하되 검색과 최근 종목을 정상 문서 흐름으로 분리하고, 중복 제목·조작 띠의 높이를 줄인다. 새 기능·라이브러리·브랜드 변경·시안 생성 자체는 목표가 아니다. 참고는 실제 공개 토스증권 PC 목록과 Npay 모바일 상세, 공통 선별 목록의 탐색·검색 구분을 이번에 다시 열어 본 근거로 정한다.
- 하락률 API는 공개 읽기 검사에서 실제 20개 응답을 받았지만 첫 요청에 17.85초가 걸렸다. 한 번의 성공으로 지연·503이 해결됐다고 보지 않는다. 첫 조회 실패/다음 페이지 실패/마지막으로 받은 행을 구분하고, 실패를 0개 목록이나 제공 끝으로 표현하지 않는다. 기존 API·페이지 스냅샷·시간 제한·계정/주문 규칙은 변경하지 않는다.
- 최근 종목 유무·펼침, 검색 결과·실패, CAP/DOWN/US 전환, 필터, 계정/브라우저 관심목록을 360/390/768/1280/1440px와 두 테마·글자 확대로 검증한다. 코드·화면·실제 API의 근거를 구분하고 기존 계좌·앱인토스·운영 배포는 변경하지 않는다.
- 이번 직접 열람: 토스증권 `https://www.tossinvest.com/` 1440×900은 상단 요약 일부 로딩과 안내 풍선이 있었으나 순위 행과 우측 관심목록은 확인했다. 목록의 숫자 열과 짧은 탐색 구분만 사용한다. Npay `https://m.stock.naver.com/domestic/stock/005930/total` 390×844는 KRX 쿼리로 이동했고 종목·가격·장 상태·차트가 보였다. Our World in Data 1440×900은 선별 목록의 주제 띠/검색 경계만 대조하고 지도·거대 소개 영역·색은 제외했다. 운영 계정·네이티브 앱·외부 주문은 확인하지 않았다.
- 교정 검토에서 최근 6종목을 펼치자 여전히 전폭 세로 행이 되는 두 번째 결함을 발견했다. `workspace.css`의 기존 `flex-direction: column`이 남은 원인이므로 소유 규칙에서 `row`를 명시했다. 최종 실제 산출물에서 PC 펼침 높이는 403→113px, 모바일 기본은 229px이었다. 항목·이름을 숨기거나 글씨를 줄이지 않았다. 모바일 글자 150%에서는 전체 이름을 읽을 수 있도록 420px까지 자연스럽게 늘어나게 하고 PC 높이 기준을 강제하지 않았다.
- 검증: 최종 격리 후보의 Next.js webpack 빌드·타입 검사·26개 정적 페이지 생성 성공, 같은 산출물의 검색→상세→주문 창→뒤로가기 6조건 통과. 안전 회귀와 순위 회귀 8검사, 두 테마의 시장·관심 8조건 및 상세·조회 복구 6조건도 수행했다. 독립 검토는 360/390/768/1280/1440px, 라이트/다크·compact·최근 항목 닫힘/펼침·긴 이름·실패/빈 결과·미국 통화·글자 확대의 최종 9조건을 통과했고 책임 담당도 최종 캡처를 직접 비교했다. 실제 운영 계좌·주문 쓰기 요청은 보내지 않았다.
- 한계: 확대 검사는 계산된 글자 크기·줄 높이를 1.5배 한 시험으로 실제 브라우저 확대·OS 설정·휴대폰 실기기 검증이 아니다. 시험 시세·계좌는 격리 fixture이며 운영 API를 대체하지 않는다. 공급 지연·503의 근본 해결, 실사용 성능·모든 화면의 무결점·운영 배포를 보장하는 결과로 확대하지 않는다. 격리 검증 과정에서는 운영 계좌와 앱인토스를 변경하지 않았다. 사용자 승인 후 GitHub 원본·실제 포크의 SHA 동기화, 기존 코더스 웹 배포와 공개 화면 검증은 별도 단계로 확인한다.

## StockPilot · 시장 탐색과 종목 상세 개편 (2026-11-22)

- **첫 행동:** 기존 사용자와 입문자가 국내·미국 종목을 찾고 현재가·전일 대비를 비교한 뒤 상세를 연다. 검색은 `#search-card`, 순위 행·관심 행은 기존 종목 선택 및 상세 URL을 사용한다. 보조 행동은 관심목록 확인·저장, 종목 비교, 가격 알림이다. 모의주문은 상세의 기존 진입점만 유지한다.
- **기준과 대안:** 현행의 PC 왼쪽 메뉴+시장+오른쪽 시세라는 3열 대신, 가로 내비게이션 아래 목록과 참고 정보 2열을 쓴다. 검색·순위·관심종목을 단일 API에 합치면 필터 범위와 오류·권한이 섞이므로 채택하지 않는다. 390×844 기준선에서는 첫 종목이 약 550px에 시작했다. 빈 비교 도우미와 중복 제목을 본문에서 줄이되, 활성 비교와 수정 가능한 검색 범위는 유지한다.
- **실제 화면:** [토스증권](https://www.tossinvest.com/) 공개 1440×900의 전역 메뉴, 목록 숫자 정렬과 관심 레일을 열어 확인했다. 동 URL 모바일은 데스크톱 폭이어서 반응형 참고에서 제외했다. [Npay 증권 모바일 삼성전자](https://m.stock.naver.com/domestic/stock/005930/total?domesticStockExchange=KRX) 390×844의 이름→가격→기준 시각→차트 위계를 보조로 사용한다. 독립 검토에서 [Our World in Data](https://ourworldindata.org/) 공개 홈의 탐색/검색 구분도 대조했다. 외부 로고·폰트·현금 주문·홍보·가격 데이터는 옮기지 않는다.
- **시각 방향:** 기존 Pretendard 계열, 라이트 `#fff/#121c2d`, 다크 `#121824/#edf2fa`, 인디고 강조와 수익/손실 토큰을 보존한다. 시장 상단은 검색과 시세 기준을 연결한 옅은 면, 목록은 선과 고정 숫자 정렬 중심이다. 제목 24–36px, 주요 숫자 15–40px; 간격 8/12/16/24px, 상단 14px·조작 8px 반경, 터치 조작 44px. 좁은 화면은 목록을 먼저, 보조 시세와 관심은 뒤에 놓으며 가로 앱 메뉴는 기존 하단 메뉴로 대체된다. 기존 로고·아이콘·차트만 사용한다.
- **상태와 계약:** 순위는 시장·거래소·정렬과 동일 스냅샷 페이지, 전체 검색은 별도 카탈로그다. 관심종목은 계정 확인/실패/명시적 비로그인 브라우저 저장을 서로 구분한다. 시세의 종목·거래소·통화·조회 시각과 이전값/재조회 경로, 주문 수량·잔고·멱등성 계약은 변경하지 않는다. Figma는 공개 라벨과 시안용 표본만 사용하며 운영 코드·계정 데이터는 보내지 않는다.
- **구현 및 게이트:** `TradingTerminal`, `RankedMarketBrowser`, `MarketWatchlist`, `discovery-redesign.css`에서 구성과 상태를 조정한다. 360/390/768/1440px 라이트/다크에서 검색→상세→뒤로가기, 관심 필터·재조회, 활성 비교, 시세/차트·주문 숨김/열기·포커스, 가로 넘침을 확인한다. 실제 사용자·실거래 데이터·앱인토스·배포는 범위 밖이다.
- **검토와 수정:** 비공개 Figma 개편 스케치의 390/1440 두 프레임에서 첫 행 밀도를 대조하고 100px 시안 행을 64px로 줄였다. 실제 구현은 가격·시총·비교 등 생략할 수 없는 정보를 별도로 배치했다. 계약 검토에서는 계정별 저장 상태와 검색·순위 범위를 분리했고, 화면 검토에서 발견한 관심종목 복귀와 768px의 높은 목록 시작점을 고쳤다. PC 시장·관심·상세·자산·기록은 같은 전역 메뉴를 사용한다.

## StockPilot · 관심종목을 먼저 보여주는 화면 (2026-11-22)

- 첫 행동은 저장한 종목의 가격을 훑고 상세로 돌아가거나, 시장에서 다른 종목을 찾는 것이다. 운영 `/#favorite-board-title`에서 계좌 조회를 차단한 390×844·1440×900 Chrome 관찰 결과, 주문용 잔고 안내가 관심종목보다 먼저 표시됐다. 저장 목록 자체의 오류와 재조회 동작은 카드 밖에 떨어져 있었다. 이 캡처는 의도적으로 계좌 접근을 차단한 재현이지 운영 장애가 아니다.
- [Npay 증권 삼성전자](https://stock.naver.com/domestic/stock/005930/price)의 공개 종목 헤더를 두 폭에서 열었다. 종목명·가격·변동값은 가깝게 표시하고 관심·알림은 독립 조작으로 뒀다. 이 위계만 기존 관심종목 행과 별 버튼에 이어가고, PC 레일·보조 시세·브랜드는 이식하지 않는다. 로그인 후 관심목록과 모바일 전용 앱은 미확인. 선별 목록의 번개장터 홈도 재열람을 시도했지만 캡처에 본문이 없어 시각 근거에서 제외한다.
- 현행 유지나 화면 전체 개편 대신, 관련 안내를 목록 안에 두고 관심 화면의 위쪽 주문 안내만 걷는다. 목록 헤더의 ‘종목 찾기’는 기존 `#search-card`로 이동한다. 실패 시 ‘다시 조회’는 기존 조회 동작만 호출하며, 읽어 둔 행은 유지한다. 저장 실패·계정 변경에서 이미 있던 서버 안내와 인증·저장 규칙은 변경하지 않는다.
- 기존 Pretendard·중립 면·인디고 포커스·행 구분선을 사용한다. 별도 색이나 모션 없이 44px 조작, 12/16px 간격, 길게 늘어나는 한국어 상태는 두 줄로 허용한다. 적용 대상은 `MarketWatchlist`, `TradingTerminal`, `watchlist-layout.css`다. 관심 화면과 시장의 좁은 사이드바에서 로딩·빈 목록·오류·재조회와 검색 복귀를 360/390/768/1440px, 라이트/다크에서 확인한다. 운영 반영은 별도 요청으로 남긴다.

## StockPilot · 자산 조회 상태를 숫자와 분리 (2026-11-22)

- 공통 점검 범위는 시장·전체 종목 검색·상세/주문·관심·내 자산·매매 기록이다. 기준선에서 첫 포트폴리오 조회를 차단하자 자산은 조회 실패, 같은 화면 아래 보유 목록은 “없어요”라고 표시했다. 서버의 `positionCoverageComplete: false` 응답으로 종목이 누락된 경우에도 현금만 포함한 수치를 전체 평가액으로 표시했다. 독립 계약 검토와 격리 브라우저에서 두 상태를 재현했다.
- 직접 확인: 2026-11-22, Chrome 390×844·1440×900의 [Wise 공개 환율계산기](https://wise.com/kr/currency-converter/)는 금액과 통화를 같은 행에 두고 기준을 가까이 표시한다. 시각 참고에 한정한다(외부 화면의 스크립트 오류 관찰, 송금 미실행). [Npay 증권 삼성전자](https://stock.naver.com/domestic/stock/005930/price)는 시세 값 가까이에 기준·단위를 표시했다. 상단과 시세 정보만 비교했다(차트 본문 로딩, 모바일 우측 레일). 브랜드 색·홍보 구도·패널은 가져오지 않는다.
- 선택: 전면 개편 대신 시장과 내 자산의 기존 카드/목록 구조를 보존하고 수신 범위와 다음 행동을 가까이 붙인다. 확인 전엔 로딩/실패, 명시적 비로그인, 이전 확인 자료, 일부 수신, 조회 성공 뒤 진짜 빈 상태를 구분한다. 일부 수신에서는 원화·달러 주문 가능 현금과 확인된 종목만 보여주며 총 평가액·통화별 평가손익을 확정하지 않는다.
- 화면: 기존 `--ws-surface`·`--ws-muted`·`--ws-line`·Pretendard 유지. 별도 경고 색을 만들지 않고 상태 제목과 설명, 기존 인디고 포커스, 44px ‘다시 확인’/‘잔고 다시 확인’으로 구분한다. ‘주식 둘러보기’는 실제 조회 성공 후 빈 목록에만 연결하고, 비로그인 상태에서는 기존 Google 로그인으로 안내한다. 홀딩스 헤더와 안내는 한 열로 읽고 날짜·통화·재조회가 360px에서 겹치지 않게 한다.
- 범위와 판정: `TradingTerminal`·`HoldingsPanel`의 표시와 포트폴리오 응답 검증을 유지보수한다. 계산·DB·API·앱인토스는 그대로. 격리 환경에서 첫 로딩/503→성공, 일부/빈 자료, 이전 목록+재조회 실패, 비로그인, 정상 KRW/USD 자산·매매 기록을 테스트한다. 운영은 승인되지 않은 계좌·쓰기 요청 없이 읽기 전용으로 확인한다.
- 운영에서 `/guide/`·`/practice/` 북마크가 실제 페이지 대신 홈의 정적 HTML을 받고 React 브라우저 오류가 나는 것도 재현했다. 기존 URL에 맞게 공개 웹의 정적 페이지 경로만 정규화하고 쿼리, API, 정적 자산 및 Next.js 빌드 설정은 보존한다. 같은 주소를 로컬 Nginx와 배포 후 브라우저에서 검증한다.

## StockPilot · 종목에서 모의주문으로 (2026-11-22)

- 대상과 결정: 종목을 찾은 초보자가 가격과 자료의 시점을 구별한 뒤 차트를 읽고 연습 여부를 결정한다. 기존 시세·부가 기능을 숨기지 않되, 긴 상세 상단과 동일 비중의 저장/알림 버튼을 정리한다. 전체 리뉴얼·새 차트·새 주문 상태보다 기존 화면을 읽는 순서가 먼저다.
- 주 참고: [Npay 증권 삼성전자](https://stock.naver.com/domestic/stock/005930/price), 1440·390px 공개 화면 직접 확인. PC의 이름·코드·가격·등락·기준 시각 그룹과 독립 차트 정렬을 채택한다. 모바일의 고정 우측 레일과 화면 아래로 밀리는 차트를 따르지 않는다. [토스증권 삼성전자](https://www.tossinvest.com/stocks/A005930/order)는 PC에서 오른쪽 주문 패널만 관찰했다. 차트 로딩·모바일 가림·로그인 제한이 있어 사용 흐름·금융 규칙의 검증 근거로 사용하지 않는다.
- 현행 390·1440px 공개 페이지에서 잔고 조회를 차단한 실패 상황을 함께 관찰했다. 모바일은 상단 경고 때문에 차트가 첫 화면 아래로 밀렸고, PC 다크 테마에서는 차트 로딩 배경이 흰색이었다. 실제 운영 장애라는 뜻은 아니다. 잔고 복구는 주문 패널에 두고 읽기와 제출을 분리한다.
- 정렬: 기존 상단과 좌측 내비게이션 유지 → 한 묶음의 종목명·가격·등락·기준 시각 → 일별 차트 → 기업/뉴스/복기. 모바일의 360px 첫 화면에는 가격과 차트의 조작이 함께 보이고, 하단의 기존 `모의주문` 버튼이 주문 시트를 연다. PC의 차트 옆에는 기존 모의 주문서가 보인다. 이름은 21–28px, 가격은 30–44px, 상태는 12–13px이며 기존 토큰의 중립 면·인디고 선택·의미 있는 상승/하락을 재사용한다.
- 표시 계약: 가격이 없으면 `—`, 조회 중과 실패는 중립 색 텍스트로 구분하고 실패 시 기존 `시세 다시 조회`를 사용한다. 기간·시세 시점·통화는 화면에 남긴다. 시세 소스, 차트 데이터, 관심/알림, URL·ID, 주문 계산·확인·포커스, 계좌·DB와 앱인토스는 유지한다.
- Stitch 공식 연결에서 새 모바일·PC 초안을 생성했다. 공개 종목명과 지침만 전달했다. 모바일 제안의 36px 보조 버튼·모션은 채택하지 않고 기존 44px 조작·저감 모션을 유지한다. 시안 코드·가격·차트는 서비스에 넣지 않으며, 시각 검증은 구현된 웹에서 한다.
- 통과 기준: 로컬 브라우저에서 360·390·768·1440px 및 라이트/다크의 헤더·차트와 페이지 넘침, KRW/USD 및 조회 실패/복구, 기존 주문 시트 및 Escape 복귀·매도 가능 수량을 확인한다. 운영은 인증·주문 없이 공개 종목 조회·스크린샷으로 점검한다. 작업 대상은 `TradingTerminal.tsx`, 상세 스타일인 `stitch-ledger.css`, QA와 지침·README다.
- 배포 후 읽기 전용 검증에서 계좌 조회를 막았을 때 최대 매수 수량이 기본 자금으로 표시되고 모바일 재조회 아이콘이 숨는 문제를 발견했다. 실패 상태에서는 매수 수량 바로가기를 표시하지 않고 재조회 아이콘·이름을 유지한다. 복구 후 수량 바로가기 표시까지 격리 환경에서 확인한다.

## StockPilot · 검색 중심 시장 화면 (2026-11-22)

### 누구를 위한 화면인가

모바일에서 처음 종목을 찾는 사용자와 PC에서 시세와 내 계좌를 함께 확인하는 재방문자의 시장 작업 화면이다. 현행은 KOSPI·계좌 카드가 검색 앞에 와 모바일에서 첫 종목을 선택하려면 스크롤해야 했다. PC에서도 상단 전체를 차지한 요약이 시세 행을 아래로 밀었다. 지수 우선은 시장 방향을 빠르게 확인하는 데 유리하지만 첫 종목 탐색을 늦춘다. 이번 변경에서는 검색과 목록을 한 작업 영역에 묶고, 요약을 옆이나 아래에서 그대로 확인하게 한다.

### 실제 운영 화면에서 가져온 기준

- 주 참고: [토스증권](https://www.tossinvest.com/), 2026-11-21~22, 비로그인 1440px 공개 웹. 상단의 짧은 탐색과 검색, 연속된 순위 제어, 탐색과 보조 요약의 분리를 확인했다. 이 환경에서 동적 종목은 로딩 상태였으므로 시세 행의 동작을 참고한 것으로 확대하지 않는다.
- 보조: [Npay 증권](https://stock.naver.com/), 같은 기간 390px 공개 웹. 상단 검색·시장 탭과 지수 카드에서 지수 값, 부호가 있는 등락률, 시장 상태의 위계를 확인했다. 좁은 화면에서 본문 폭을 줄인 고정 우측 영역은 가져오지 않는다. 두 사이트의 브랜드·로고·전용 서체·코드는 사용하지 않는다.

### StockPilot에서 구현하는 화면

- 첫 화면에는 회사명·종목코드·티커 검색과 ‘국내·미국·전체 종목’의 탐색을 둔다. 검색 결과나 순위표의 ‘상세 보기’가 기존 종목 상세를 여는 주 행동이다. 보조 행동 ‘내 자산 보기’는 기존 자산 영역을 연다. 장식용 히어로를 추가하지 않는다.
- 검색과 시세 행이 붙은 한 영역. 1100px 이상에는 KOSPI·내 모의투자 자산·관심종목을 우측에 둔다. 작은 화면에서는 이 순서를 목록 아래에 유지한다. 768px 이상 중간 폭에서는 두 요약을 나란히 배치한다. 기존 모바일 하단 메뉴와 PC 탐색은 유지한다. 시각 배치와 DOM 순서를 비교하고 작은 화면에서는 좌우 여백보다 숫자와 종목명 너비를 우선한다.
- StockPilot의 Pretendard와 시스템 산세리프, 16px 검색, 12–14px 보조 글자, 8/12/16/24px 공간을 이어 쓴다. 두 테마는 기존 `--ws-surface`, `--ws-line`, `--ws-muted`와 `--sp-radius-card`를 사용한다. 상태와 등락은 색 외에도 글자·부호로 구분한다. 인터랙션은 기존 포커스·로딩·오류·재시도를 사용하며 새로운 장식 애니메이션은 도입하지 않는다. 검색에는 기존 Lucide 아이콘을 보조 표기로 쓰고 입력의 접근 가능한 이름은 유지한다.
- `#search-card`·`#market-rankings`·`?browse=all`과 종목 상세 복귀, 정렬, 관심종목, 비교를 유지한다. 가격·잔고·시각에는 기존 API 값만 표시한다. 기존 주문 폼·계좌·API·DB와 별도 앱인토스에는 변경을 두지 않는다.
- 비교용 Figma 모바일·PC 초안은 공개 종목명만 사용하고 시세·잔고는 비웠다. 편집 가능한 텍스트와 종목 행 인스턴스를 확인했다. Figma에서 제공되는 Noto Sans KR은 비교 초안에만 쓰고 실제 웹의 Pretendard를 유지한다. Stitch 프로젝트에 접근할 수 없어 가져오지 않았고 Gemini 검토도 수행하지 않았다.

### 변경 범위와 통과 기준

`frontend/components/TradingTerminal.tsx`와 `frontend/app/stitch-market.css`에서 배치와 문구를 바꾼다. `frontend/components/MarketIndexChart.tsx`는 화면을 이동해도 같은 세션에서 최근 검증된 지수로 복귀하도록 한다. `frontend/scripts/verify-market-focus.mjs`에서 360×800, 390×844, 768×1024, 1440×900 및 다크·라이트의 첫 종목 접근, 가로 넘침, 키보드·검색 실패 후 재시도, 종목 상세·주문창·복귀와 새로 확인한 지수 유지를 확인한다. 독립 검토에서 지적한 기존 시장 앵커를 보존하고, 매도 가능 수량·주문 결과도 격리 자료로 재검증한다. 운영 환경에서는 공개 조회 경로만 확인하며 실제 사용자 계좌를 열거나 주문하지 않는다.

## StockPilot · 매도 가능 수량 (2026-11-21)

- 현행: 주문 입력 화면은 최근 주문·보호 기록만으로 가능 수량을 역산한다. 과거 대기 주문이 남았거나 보유 종목을 목록에 표시하지 못하면 실제 원장과 다른 숫자를 보여준다.
- 선택: 기존 인증 계좌 조회 한 번으로 현재 종목의 보유·대기 매도·보호 수량을 확인한다. 최근 기록 제한을 늘리는 방식은 같은 오류를 미루고, 별도 종목 조회는 화면과 원장의 조회 시점을 나눈다. 매매 기록의 범위, 실제 주문 검증과 계좌 데이터는 유지한다.
- 화면: 기존 주문서와 다크·라이트 토큰을 유지한다. 매도 가능 수량을 먼저, 보유·대기 매도·보호 설정을 다음 줄에 둔다. 확인 불가와 실제 0주를 구분한다. 확인 불가의 주 조작은 ‘다시 조회’, 가능할 때는 ‘가능 수량 채우기’다. 변화나 오류로 입력값을 덮어쓰지 않는다.
- 토스의 명시적 상태, 배민의 기존 토큰 재사용, 당근의 작은 화면 조작 기준을 적용한다. 좁으면 설명과 버튼을 줄바꿈하고, 버튼은 44px, 보조 문구는 13px 이상을 지향한다. 매매 실행을 연출하는 모션이나 외부 디자인 자산은 추가하지 않는다.
- 협업 기준: 프런트는 가능 수량·실제 0주·조회 불가의 정보 위계와 반응형을 검증한다. 백엔드는 해당 수량의 계약과 일관성, 통합·배포를 책임진다. 열어 둔 Figma에 참고할 시안이 없어 기존 화면과 격리 브라우저를 기준으로 검토했으며, 코드나 계좌 데이터는 외부 설계 도구에 보내지 않았다.
- 통과 조건: 30건보다 오래된 예약, 서로 다른 종목 식별자, 누락·불일치 응답에서 원장값과 표시가 일치한다. PC/모바일과 양 테마에서 읽고 조작할 수 있고, 재조회와 같은 키 주문 복구가 신규 주문을 자동으로 보내지 않는다.

## StockPilot · 판단에서 결과까지 (2026-11-21)

### Resolved inputs

- Topic: 로그인 없는 첫 투자 연습과 모의주문 결과의 정확성.
- Offer: 과거 시세로 판단을 연습하고, 실제 모의계좌 주문에서는 접수·체결·불확실을 분명히 구별한다.
- Audience: 처음 증권 UI를 접하는 모바일 사용자. 빠른 시장 탐색을 원하는 재방문자도 그대로 지원한다.
- Primary user action: 기존 시작 가이드에서 ‘로그인 없이 과거 시세로 연습’ → `/practice` → 현재 공개 날짜와 종가 확인 → 매수하거나 대기 → 다음 거래일 확인.
- Deliverable: 기존 Next.js 가이드·연습 화면과 주문 결과 컴포넌트, FastAPI 상태 계약 회귀 검증.
- Style direction: 시장의 기존 Stitch Obsidian 유지. 가이드는 읽는 화면, 리플레이는 판단하는 작업 화면. 불필요한 장식보다 현재 날짜·가격과 다음 행동에 집중.
- Tonal key: 기존 다크·라이트 표면을 사용. 본문 `--ws-ink`, 보조 `--ws-muted`, 경계 `--ws-line`, 행동은 기존 인디고; 접수 대기는 중립 토큰, 거절은 기존 오류 토큰. Pretendard와 기존 폰트 대체, 탭 숫자, 본문 14–16px·보조 13px, 8/12/16px 간격, 44px 이상 핵심 터치 영역.
- Icon policy: 기존 Lucide; 아이콘 단독으로 상태를 전달하지 않는다.
- Proof assets: 기존 과거 시세 차트, 날짜·가격 원자료, 구분된 테스트 응답. 추천 종목·가상 사용자 지표 없음.
- Motion intensity: 최소. 다음 날짜는 즉시 전환하고 장식용 모션은 추가하지 않는다; reduced motion 유지.

### Composition contract

- Hero archetype: 가이드의 비대칭 본문+세 단계 예고 유지. 시장 홈에는 새 히어나 요청을 추가하지 않는다.
- First viewport: 가이드는 연습과 시장 탐색의 두 선택. 리플레이는 이 화면에서만 진행된다는 안내 → 종목 선택 → 현재 공개 날짜와 종가. 좁은 화면은 시세→선택→다음 날 순서로 한 열, PC는 시장 자료와 판단 영역을 나란히 둔다.
- Primary visual/proof artifact: 현재 공개 구간까지의 실제 과거 종가 차트. 자료 오류나 공백은 실패/빈 상태로 제공하며 가짜 시세로 메우지 않는다.
- Interaction behavior: 가이드 주 CTA `/practice`, 보조 CTA `/#search-card`. 과거 연습의 매수·매도/다음 날은 기존 로컬 상태, 다음 날은 주문 없이도 진행. 실계좌가 아니라 모의계좌 주문은 기존 핸들러·키·서버를 사용하고 `TRIGGERED`는 ‘조건 충족 · 체결 대기’로 처리한다. 이 상태는 체결·자산 반영이 아니라 매매 기록으로 안내한다.
- Reuse boundary: 기존 가이드, 리플레이, 주문 UI와 모든 경로 사용. 시장 기본 화면·원장·계좌·로그인·수수료·API·앱인토스는 유지.
- Evidence and gate: [방향과 반대 의견](docs/product-direction-review.md). 가이드 링크/실패·빈·다음 날 흐름과 주문 응답·복구에서 `TRIGGERED`·`OPEN`·`FILLED`·미확인 응답을 분리한다. 360/390/768/1440에 반응형·키보드 확인을 시도하고 검증 못 한 환경을 별도로 남긴다. 운영 주문·운영 부하·무단 배포를 하지 않는다.

### Filled generation prompt

<details>
<summary>가이드·과거 시세 연습 구현 브리프</summary>

Create one high-concept page for StockPilot의 로그인 없는 첫 과거 시세 연습.

## Inputs
- Topic: StockPilot 시장과 이어지는 첫 투자 연습.
- Offer: 로그인 없이 과거 시세를 하루씩 확인하고, 이 화면에서만 가상 결정을 연습
- Audience: 증권 용어와 주문 절차가 낯선 StockPilot 방문자
- Primary user action: 가이드에서 과거 시세 연습을 열고, 관심 종목의 공개 날짜를 확인한 후 매수하거나 기다리고 다음 거래일을 열기
- Deliverable: 기존 Next.js 가이드와 연습 컴포넌트
- Style direction: 차트와 판단에 집중하는 현대적인 금융 워크스페이스
- Tonal key: 기존 Obsidian 다크 및 대응 라이트 테마
- Icon policy: 기존 Lucide로 탐색과 판단 상태만 보조
- Proof assets: 기존 과거 일별 시세와 재현 가능한 격리 QA; 장식용 숫자나 사진 없음
- Motion intensity: 최소; 테마의 기존 반응과 상태 변화만

## Objective
Design one premium, memorable page with a dominant hero and one coherent visual world derived from the topic itself.
The result should feel specific, intentional, and action-oriented when the concept calls for action, not like a generic startup or SaaS template.

Choose the strongest clear solution.
Do not collapse the concept into a simpler generic pattern just to make execution easier.

- Treat single-file execution as a packaging constraint, not a creative constraint.
Do not reduce conceptual ambition, visual specificity, interaction richness, or production quality merely because the deliverable is concise.

## Internal concept choice
Before composing, decide internally:
- one dominant hero archetype: centered / asymmetrical / immersive
- one dominant proof mode: none / embedded gesture / single artifact
- one palette driver derived from the topic
- one tonal key: light / mid / dark / topic-derived
- one motion role: none / minimal / ambient / interactive
- one icon approach: none / minimal / expressive / topic-native
- optionally one secondary accent only if it strengthens the main direction without creating a second visual world
Do not output this planning.

## Non-negotiables
- Use a strong hero-first composition.
- Headline: 3-12 words, max 3 lines.
- Supporting copy: 1-2 short sentences, concise and specific.
- CTAs are optional. If used, include at most 1 primary and 1 secondary CTA.
- If a clear next step is central to the offer or concept, include a CTA; otherwise CTA omission is allowed.
- CTA labels must be specific to the offer and action, not generic.
- Supporting highlights are optional. If used, show them only once in a single lower support cluster beneath the hero.
- Keep the hero dominant, focused, readable, and uncluttered.
- Proof is optional. Use it only if it clearly strengthens the concept.
- If no real proof assets are provided, do not invent metrics, testimonials, customer logos, screenshots, or fake UI proof.
- Prefer depth inside the hero, proof gesture, CTA behavior, support copy, or background logic rather than adding extra sections by default.

## Composition
- Choose the clearest structure for the topic; do not default to generic two-column marketing layouts.
- A top navigation bar is optional. When used, make it native to the chosen style direction and subordinate to the hero rather than a generic boxed header.
- The hero may be fully integrated rather than framed.
- The hero does not need to become a panel, dashboard, device mockup, rounded card, or floating showcase unless the topic genuinely demands that artifact.
- Build hierarchy through scale, contrast, spacing, alignment, depth, rhythm, and composition before using frames, dividers, or containers.
- Keep supporting content clearly subordinate to the hero.
- Do not interpret structural restraint as permission to flatten the concept into a generic minimal layout.
- Do not use text-on-text layering, typographic collisions, or overlapping live text as a compositional device.

## Visual system
- Build one coherent visual world derived from the topic itself.
- Let the topic drive palette, contrast, typography, spacing, geometry, motifs, materials, and motion.
- Even restrained palettes must feel intentional and specific, not generic premium-neutral.
- The background must actively contribute mood, depth, and topic logic.
- If the topic suggests a real system language, physical behavior, or interface grammar, show that directly instead of generic abstract-tech decoration.
- Treat headline typography as part of the concept, not neutral text.
- The headline may use topic-derived color, selective emphasis, multi-tone treatment, or gradient accents when they strengthen the concept and remain readable.
- Do not default the headline to neutral black, white, or near-white unless that is clearly the strongest topic-native choice.

## Background and tonal diversity
- Premium and atmospheric design may be light, mid-tone, or dark; do not default to dark.
- Choose the tonal key from the topic, offer, audience, and style direction rather than from generic cinematic or tech aesthetics.
- Contrast may come from hue, saturation, temperature, texture, density, or scale, not only darkness.

## Proof and concept expression
- Prefer the minimum visual evidence needed to make the idea feel specific, credible, and native to the topic.
- If the concept is strongest with typography, atmosphere, and one precise gesture, do that.
- If a stronger proof artifact is justified, use one legible, unified artifact rather than multiple fragmented panels.
- Proof may take the form of a signal, trace, contour, command line, path, specimen, structural mark, scene fragment, or other topic-native evidence.
- Typography itself may carry part of the concept or proof.
- When appropriate, use one precise typographic gesture—such as selective word emphasis, chromatic offset, gradient emphasis, distortion, signal breakup, or structural interruption—to make the concept feel more specific and alive.
- Prefer one strong typographic intervention over many scattered decorative effects.
- Avoid decorative pseudo-proof.
- Avoid turning simple ideas into framed showcases, dashboard fragments, floating panels, softened slabs, or generic marketing geometry.

## Icons and symbolic language
- Icons are optional.
- Use icons only when they improve scanability, recognition, navigation, proof clarity, or support-cluster legibility.
- Prefer topic-native icon logic over generic startup glyphs.
- Keep icon style consistent in stroke weight, geometry, corner logic, and detail level.
- Use icons primarily in clearly secondary roles unless a single topic-native symbol is central to the concept.
- Do not let icons compete with the hero headline, proof artifact, or CTA hierarchy.

## Support cluster
- If used, show supporting highlights only once, in a single lower cluster beneath the hero.
- Each highlight should be short, fast to scan, and clearly secondary.
- Supporting highlights may use concise icons or symbolic marks when helpful.
- Support-cluster elements may use subtle motion when it improves scanability, continuity, or atmosphere and remains clearly secondary.
- Card-like grouping is allowed only inside this lower support cluster.
- These modules may use at most one light surface treatment, such as a subtle stroke, tonal fill, or very soft shadow.
- Keep support modules uniform, non-nested, and visually subordinate.
- Do not use card-like structures in the hero, proof, CTA area, or elsewhere on the page.

## Motion
- Motion is optional.
- Use motion only when it supports hierarchy, continuity, feedback, atmosphere, or topic logic.
- Default to none, minimal, or ambient motion depending on what the concept actually needs.
- Motion may live in typography, background behavior, proof logic, support-cluster behavior, or interaction feedback.
- A single key word or short phrase may use subtle text-based motion such as glitch, flicker, jitter, scanline shift, chromatic split, text scramble, pulse, or reveal if it strengthens the concept.
- Keep motion controlled, readable, non-blocking, and subordinate to clarity.
- Avoid scrolljacking, attention-hijacking loops, and ornamental animation.
- Respect reduced-motion preferences.

## Accessibility and readability
- Preserve strong readability and clear hierarchy at all viewport sizes.
- Maintain sufficient contrast between text and background.
- Do not place essential text over busy imagery unless readability remains strong.
- Avoid cramped spacing, visual collisions, and weak focal hierarchy.
- Do not place badges, pills, annotations, stickers, or floating interface fragments over essential text.
- If the deliverable is code, use semantic HTML structure, visible focus states, keyboard-friendly interactions, and reduced-motion handling.
- When in doubt, preserve legibility over expressive overlap.

## Anti-drift rules
- Do not drift into bland corporate SaaS styling.
- Do not default to dashboard aesthetics, feature-grid thinking, boxed-section composition, or template-like modularity.
- Do not use disconnected motifs, random color choices, or interchangeable abstract-tech shapes.
- Do not use card-within-card composition, nested surfaces, floating panels, fake proof, or stock-looking UI.
- Keep one visual world, one dominant hero, and one clear structural logic.
- Do not allow text, labels, or interface elements to overlap, collide, or sit on top of one another.

## Output
Return only the final 기존 Next.js 가이드와 연습 컴포넌트.

If the deliverable is code:
- Output a complete production-ready file or component.
- Keep dependencies minimal unless explicitly requested.
- Make it responsive.
- Keep support highlights in one lower support cluster only when used.

## Final self-check
Before returning, verify that the result keeps:
- one dominant hero
- one coherent visual world
- no invented proof
- no cardification outside the lower support cluster
- no generic SaaS drift
- no unnecessary structural fragmentation
- no nested containment
- no floating sub-surfaces
- all text clearly legible and comfortably spaced

</details>

### Output target

- `frontend/app/guide/page.tsx`, `frontend/components/PracticeLab.tsx`, 기존 연습 CSS.
- 주문 결과: `frontend/lib/trading-validation.ts`, `frontend/components/TradingTerminal.tsx`, `frontend/components/OrderResult.tsx`, 기존 주문 상태 CSS 및 회귀 검사.

## StockPilot · 시세가 도착하는 첫 화면 (2026-11-21)

### Resolved inputs

- Topic: StockPilot 시장 홈의 시세 확인 → 종목 검색 → 모의투자 흐름.
- Offer: 국내·미국 시세 기록을 명시하고, 로그인 여부나 계좌 조회 상태를 오해하지 않게 한다.
- Audience: 출근길에 모바일로 종목을 빠르게 찾는 초보자와 PC에서 시세·자산을 함께 보는 사용자.
- Primary action: 종목명/티커를 찾아 상세를 열기. 시세 탭과 화면 아래 도구는 그대로 둔다.
- Deliverable: 기존 Next.js 작업 화면 1개와 호환 가능한 FastAPI bootstrap 보강.
- Style / tone: 현 StockPilot 인디고와 Obsidian 라이트·다크. 토스증권의 탐색·시세 위계, 당근 SEED의 상태 표시, 우아한형제들 토큰과 도메인 패턴의 분리를 참고하되 화면·로고·자산은 복제하지 않는다.
- Icons / proof / motion: 기존 Lucide만 사용. 실제 서버 기록과 계좌 응답이 근거. 움직임은 기존 포커스/버튼 피드백, reduced motion 존중.

### Composition contract

- Hero archetype: 마케팅 영역 없이 왼쪽 탐색/오른쪽 시장 대시보드의 비대칭 배치, 모바일에서는 단일 흐름.
- First viewport: 오늘의 시장 제목, 데이터 연결 상태와 국내·미국 시세 기록, 컴팩트 KOSPI/계좌 요약, 종목 검색·랭킹 첫 행. CSS와 DOM에서 검색이 종목 리스트보다 앞서 키보드 순서도 일치.
- Primary artifact: 기존 시세·KOSPI·종목 행. 연결 여부나 서버 응답 시각을 실시간 거래소 데이터로 표시하지 않는다.
- Interaction: 현재 계좌 요청 완료 전에는 실제 잔고처럼 숫자를 표시하지 않는다. 마지막 성공 데이터가 있으면 시각과 재시도 안내를 유지한다. 모의주문·보유·거래내역과 모든 URL은 그대로.
- Reuse boundary: 웹 거래 터미널의 market overview만 바꾼다. 앱인토스, 별도 프로젝트, 금융 계산·인증·데이터 영속화는 제외.

### Filled generation prompt and output

Refine the working StockPilot market page around a single clear first action: find a stock before placing a simulated order. Show a compact, text-labeled market feed state and individually verified Korean and US quote timestamp or unavailable state. Show an account loading placeholder instead of fabricated verified cash; keep a true prior response labeled on failure, with the existing retry. Group the existing KOSPI and account panels in one responsive rhythm. Put the actual search control before the rankings in DOM and visual flow, keep visible labels, use 44px targets and preserve the local Korean font and semantic Obsidian tokens including #121824/#edf2fa dark and #ffffff/#121c2d light, 24–30px title, 14–16px body and 12–13px metadata. Use no placeholder numerical claims, duplicate requests, new storage, logos or SDK. The additive bootstrap quoteSummary describes only the returned sample of instruments, not all market listings or exchange-tick latency. Output in frontend/components/TradingTerminal.tsx, frontend/app/stitch-workspace.css, existing market CSS where necessary, and backend/app/routes/trading.py with tests. Test 360/390/768/1440, dark/light, account/market states, browsing and the protected simulated trade flow before canonical → fork → Coders.

- 전체 종목 검색: 백엔드 마스터 다운로드의 거래소별 실패를 격리해 다른 거래소의 성공한 자료를 계속 제공한다. 결과 수 주변에 기존 자료 범위 상태를 표시하고, 일부 자료 미확인을 '등록 종목 없음'으로 단정하지 않는다. 자료 수신 시각은 실시간 시세가 아니다.

## 2026-11-21 · Stitch Obsidian 디자인을 기존 웹에 연결

### Resolved inputs

- Topic: StockPilot의 국내·미국 모의투자 웹 전체 핵심 여정.
- Offer: 실제 시세로 종목을 고르고, 가상 자금으로 모의주문한 뒤 보유 종목과 체결 기록을 확인하는 화면.
- Audience: 모바일에서 처음 투자 연습을 하거나 데스크톱에서 여러 시세를 비교하는 한국어 사용자.
- Primary user action: 시장의 검색·전체 종목 → 기존 종목 상세 → 모의주문.
- Deliverable: Google Stitch의 Obsidian Trading Terminal 보드를 기준으로 현재 Next.js UI를 재구현하는 단일 제품 디자인. ZIP·원본 코드 불포함.
- Style direction: 차트와 숫자가 중심인 증권 작업 화면, 얇은 구분선, 인디고 선택 상태, 폭에 맞는 밀도.
- Tonal key: 어두운 무채색과 인디고 기본, 기존 라이트 전환 유지.
- Icon policy: 기존 Lucide, 기업 마크와 폴백 유지.
- Proof assets: Stitch에서 확인한 일곱 화면의 시각 방향과 기존 서버 응답. 시안 속 샘플 가격·비율·수수료는 운영에 반영하지 않는다.
- Motion intensity: 기존의 짧은 조작 피드백만 유지하고 reduced-motion을 존중한다.

### Composition contract

- Hero archetype: 시장 목록을 중심으로 한 비대칭 작업 화면. 대형 홍보 영역은 두지 않는다.
- First viewport: 브랜드·계정·검색, 왼쪽의 주요 탐색 또는 모바일 하단 탭, 간결한 코스피·모의자산 요약, 종목 탐색과 첫 행. 관심종목은 넓은 화면의 보조 영역.
- Primary artifact: 시장의 실종목 행, 상세의 실제 시세·차트, 자산·기록의 통화별 수치. 그리거나 채워 넣은 수치는 표시하지 않는다.
- Interaction: 종목 탐색·전체목록·상세·모의주문은 기존 URL과 핸들러, 관심종목 저장·로그인은 기존 인증, 접수·체결·불확실·거절은 기존 주문 확인/복구를 사용한다.
- Reuse boundary: 공통 탐색과 색상·구분선만 공유한다. 주문, 관심, 보유, 기록의 상태와 데이터 모델은 바꾸지 않는다.

### Filled generation prompt

Build one production StockPilot web workspace from the visible Stitch Obsidian design, with market rows as the hero, charts as real evidence, and a consistent compact navigation hierarchy. Use dark surface #121824, canvas #0b1019, primary text #edf2fa, secondary #a5b2c6, line #273344 and accessible indigo #a5adff; use a complementary light surface #ffffff and canvas #f3f6fb. Keep the existing Korean system/sans fallback and use tabular financial digits, 22–30px page titles, 14–16px controls and 12–13px metadata. Use 8/12/16/24px spacing, restrained 8–14px radii, 44px mobile controls, logical keyboard order and non-color direction labels. On wide desktop use the secondary navigation rail to reduce top-header crowding; at smaller widths keep readable horizontal navigation or the existing mobile shell. On mobile keep details, sticky ticket, and menu safe areas, avoid clipped/remapped currency and respect reduced motion. Keep the explicit virtual-money environment. On detail, holdings and trade history use a coordinated table-and-panel visual rhythm; do not replace existing APIs, routes, financial math, permissions, quote freshness or order-state ownership. Use only real operational responses; no new integration or external scripts.

### Output target and verification

- Path: frontend/app/stitch-workspace.css and approved React layout/class integrations in TradingTerminal, MobileServiceNav and existing screen components when needed. No backend schema changes, existing account/Apps in Toss untouched.
- QA: compare 360/390/768/1440px, light/dark, colors and overflow; check search and direct detail, order confirmation and currency in an isolated fixture, assets/history and navigation. Run type/build/regressions, then canonical main → actual fork → existing Coders project → read-only production proof.

## 2026-11-21 · 핵심 투자 흐름과 선택 기능 구분

- Topic / Offer: 시장을 확인하고 종목을 찾아 모의주문한 뒤 내 자산·매매 기록을 확인하는 웹. 처음부터 모든 부가 도구를 펼쳐 보이지 않는다.
- Audience / Primary user action: 모바일 초보자와 기존 투자자. 시장의 ‘전체 종목’ → 기존 검색·상세·모의주문 경로. 관심종목·자산·기록은 여전히 상시 접근한다.
- Deliverable / Style / Tonal key: 기존 Next.js 시장 화면과 모바일 메뉴 한 가지. 현재 밝은/어두운 테마, Pretendard, 금융 부호·통화 표기, 기존 API·인증 유지.
- Icons / Proof / Motion: 현재 Lucide와 실제 시장·계좌 상태만 사용. 아이콘·가격 예시·일러스트를 추가하지 않고 모션은 최소화한다.
- Composition contract: 기존 비대칭 시장지수·자산 요약과 실종목 목록이 첫 화면이다. 관심 패널의 반복 홍보와 중복 학습 카드를 덜어내고, 주요 도구와 고객지원은 바로 열 수 있게, 학습·리그·커뮤니티 등은 목적별로 한 단계 뒤에 둔다. 모바일 전체 메뉴는 영구 탭에 없는 도구를 역할별로 제공한다. 모든 기존 URL은 보존한다.
- 구체 규칙: 기존 --ws-ink/surface/muted/line/brand 시맨틱 토큰과 양 테마 값 재사용, 섹션 제목 16–20px·본문 14–16px, 8/12/16px 간격, 조작 높이 최소 44px, 숫자·한국어 줄바꿈 및 보이는 키보드 포커스. 네이티브 펼치기/닫기로 별도 애니메이션 불필요. 주문·계좌 쓰기나 DB 변경 없음.
- Filled prompt / Output: Simplify the existing StockPilot market workspace around finding an instrument, placing a simulated order and reviewing holdings or records. Keep the actual index, stock rows, live states and current navigation dominant. Consolidate repeated promotional entry points and group optional destinations behind descriptive, keyboard-accessible controls. Preserve theme colors, URLs, compact mobile navigation, account data and all order semantics. Output integrated TradingTerminal, MobileServiceNav and scoped styles, regression coverage and README. Verify links, keyboard behavior, responsive widths and production; do not create a landing page or a new service.

## 2026-11-07 · 웹 출시 전 고도화와 배포 점검

- 목적/사용자: 국내·미국 모의투자 웹의 재방문 사용자. 기존 디자인·계좌·주문 규칙·앱인토스·별도 사용자 변경을 유지하고 Nov6 개선을 출시에 맞게 점검한다.
- Resolved inputs: Topic=개인 비교 기록 안전성과 출시 안정성; Offer=계정별 메모 분리·명확한 저장 상태·검증된 웹 릴리즈; Audience=모바일/PC 투자 연습 사용자; Primary user action=종목 비교와 메모 저장; Deliverable=기존 Next.js/FastAPI 웹; Style direction=현재 StockPilot; Tonal key=기존 dark/light; Icon policy=기존 Lucide; Proof assets=실제 소스와 격리 회귀; Motion intensity=minimal.
- Composition contract: 새 hero·시각 구조 개편 없음. 비교 검색→종목→차트→기록 구조를 유지한다. 계정 변경 뒤 이전 사용자의 메모나 저장 완료 안내가 남지 않게 하고 공개 종목/기간은 유지한다. 공유 링크에 개인 기록을 넣지 않는다.
- 시각 규칙: 기존 Pretendard, --ws-surface/ink/muted/line/brand 토큰, 입력16px·본문14–16px·보조13px, 간격8/12/16/24, 44px 조작과 reduced-motion 유지. 상태 안내는 실제 결과에만 연결하고 키보드 포커스를 보존한다.
- 범위: StockComparison·계정 저장 helper 및 관련 회귀를 우선 점검한다. 발견된 결함만 범위 내 보완하고 새로운 금융 상품·실거래·DB 초기화·유료 자원은 추가하지 않는다. API 계약·저장 데이터의 기존 호환 유지.
- 출시 전 재현 결함: 원화 가격 입력의 min=0.01/step=1 불일치를 min=1로 바로잡아 정수 금액 제출을 허용한다. 달러는0.01 기준을 유지한다. 비교 메모는 계정별로 분리하고 저장 API의 선택적 X-StockPilot-Owner 검증으로 오래된 탭의 메모가 새 로그인 계정에 저장되는 일을 차단한다. 기존 클라이언트의 헤더 없는 요청은 호환하며 주문 계산·금융 규칙은 바꾸지 않는다.
- 투자 도구의 별도 리포트도 시세가 없을 때 원가 참고값을 실제 수익률처럼 표시하지 않도록 보완한다. 기존 숫자 계산은 유지한 채 평가 완전성/원가 대체/종목 정보 누락 메타데이터를 추가하고, 불완전하면 현재 수익률·차트 확정 표시를 보류한다. 체결 기반 매매 통계는 유지하고 미제공 값은 만들지 않는다.
- 브라우저 재현: 빠른 검색의 입력 자동 포커스가 복귀할 버튼보다 먼저 적용되어 Escape 뒤 초점이 body로 갔다. 공통 포커스 훅에서 열기/닫기를 맡기고 원래 검색 버튼으로 되돌린다. 모양과 검색 계약은 그대로 둔다.
- 검증/배포: 사용자 `배포 및 고도화` 요청으로 이번 웹의 커밋·푸시·포크 동기화·기존 코더스 재배포는 승인됨. 재시도에서 브라우저 사용 가능을 확인했다. 전체 안전성·제품·백엔드·타입·린트·빌드 및 360/390/768/1440 light/dark 시각 검증 후 upstream→actual fork 동일 SHA→코더스 ready→운영 확인 순서를 따른다. 확인 전 배포 완료를 보고하지 않는다.
- Filled prompt/output: Harden the existing StockPilot comparison and review workflows for release while preserving its current responsive composition, typography, dark/light tokens, real data, account ownership and simulated-order calculations. Isolate private drafts and save acknowledgements by account; retain only public instrument/period navigation across sessions. Validate actual code in isolated regressions, then browser viewports and the authorized canonical-repository deployment pipeline. Do not invent data, hide unverified checks or modify the private Apps in Toss bundle. Output integrated existing components, targeted tests and accurate release documentation.

## 2026-11-06 · 2차 고도화: 비교 분석과 투자 기록 이어보기

### Resolved inputs
- Topic: StockPilot의 비교 분석·관심종목·투자 기록 연속성.
- Offer: 비교 링크의 종목/기간 보존, 날짜별 실제 종가 확인, 저장 중 메모 보호와 캘린더 복귀.
- Audience: 국내·미국 여러 종목을 살펴보고 자신의 투자 판단을 기록하는 초보/재방문 사용자.
- Primary user action: 비교할 종목을 고른 뒤 날짜별 가격 변화 확인; 기록을 수정·저장하고 이전 탐색으로 돌아오기.
- Deliverable: 기존 웹 컴포넌트와 작은 공통 helper 통합. 앱인토스·계좌·주문 규칙·사용자 LeagueRooms 변경은 제외.
- Style direction / Tonal key: 현 StockPilot 소비자 증권 스타일과 다크/라이트 동등 지원.
- Icon policy / Proof assets / Motion intensity: 기존 Lucide만, 실제 조회된 공통 날짜·종가·계정 기록만, minimal/reduced-motion. 새 라이브러리 없음.

### Composition contract and concrete visual system
- 새 hero나 화면 구조 개편은 하지 않는다. 현재 비교 검색→종목→차트→저장 순서를 유지한다. 비교 차트 아래 날짜 선택과 해당 날짜의 종가/기준일 대비 변화를 읽기 쉬운 행으로 배치한다. 선택 날짜는 차트 표시와 일치시키고 공통 데이터가 없는 날짜를 생성하지 않는다.
- 기존 Pretendard, --ws-canvas/surface/ink/muted/line/brand/up/down 토큰과 비교선 색상 유지. 제목20–24px, 본문14–16px, 입력16px, 보조13px, 간격8/12/16/24px, 44px 조작, 12–20px 기존 반경. 모바일 날짜 조작은 줄바꿈, 숫자 tabular-nums·통화 명시·회사명 keep-all·min-width:0.
- CTA: 날짜 이전/다음/선택→이미 조회한 비교 데이터만 확인; 비교 링크 복사→공개 종목 식별자와 선택 기간만; 조회 실패→실패 종목 재조회; 메모 저장→기존 개인 NOTE API/브라우저 저장, 저장 중 새 입력은 유지; 캘린더로 돌아가기→이전 월/날짜로 복귀.
- 비교 데이터 갱신이 입력·선택을 덮어쓰지 않아야 한다. URL 복구 실패를 종목 제외로 처리하지 않는다. 메모·계좌정보를 공유 링크에 넣지 않는다. 가격·수익·미제공 데이터는 만들지 않는다. 관심종목은 기존 저장·검색·상세 흐름과 권한을 유지한다.
- 공통 계정 저장 응답의 null/잘못된 항목·버전·중복 키를 화면에 넣지 않고 기존 유효 목록을 유지하며 재조회를 안내한다. 관심종목 첫 조회 중/실패는 빈 목록이나 브라우저 저장으로 오인시키지 않는다.

### Evidence, paths and validation
- 코드 근거: StockComparison이 공유 URL의 일부 종목 조회 실패 시 실패 종목을 버리고 URL을 축소한다. 선택 기간은 로컬 상태라 공유/저장 후 기본1개월로 돌아간다. SVG 비교 차트는 날짜별 값을 직접 읽을 방법이 없다. DecisionNotebook 저장 완료가 저장 중 입력한 다음 메모를 숨길 수 있다. TradeCalendar는 기록 목록으로 전환 후 이전 월 선택을 잃는다.
- 대상: StockComparison 및 comparison helpers, 새 ComparisonInspector, DecisionNotebook/InvestmentHistory/TradeCalendar, 필요한 관심목록 복구, scoped CSS·회귀 테스트·README. API/금융 계산 유지, 필요시 공개 비교 저장의 기간 필드만 기존 schema와 호환되게 추가한다.
- 추가 확인: InvestorTools는 최근5개 알림만 보여 주며 더 보기가 없고, 알림 화면을 한 번 연 뒤 미확인 수가 바뀔 때마다 전체 읽음 처리를 반복할 수 있다. 전체/진행중/도달/취소 상태 필터와 불러온 알림 전체 관리, 종목·시장 식별자, 명시적인 읽음 조작을 제공한다. 서버 목록은 진행중 알림이 과거 도달 알림에 가려지지 않게 범위를 명확히 하고 상한/페이지를 지킨다. 알림 읽음 외 새 계좌 쓰기·푸시 신청은 하지 않는다.
- 검사: 공유 URL 일부/전체 실패·기간/Back 복원·응답 경합·정확한 종목 연결, 차트 날짜 버튼/키보드/범위 변경/결측, 메모 저장 중 입력·로그인 변경, 캘린더 월 복귀, 관심종목 빈/실패 상태. 타입·린트·회귀·빌드 및 가능하면360/390/768/1440 light/dark 실제 브라우저. 현재 Work에서 브라우저가 비활성화되어 실화면은 미검증이며 우회하지 않는다. 이번 요청은 로컬 개선/검증이며 새 배포 권한을 추정하지 않는다.

### Filled generation prompt and output target
Enhance StockPilot's existing comparison and decision-review workflows without rebranding or adding unrelated product surfaces. Use actual instrument identities and daily closes to provide a keyboard- and touch-accessible date inspector within the established chart composition. Preserve symbols and period through share/save/restore, expose recoverable quote failures without silently deleting selections, retain note edits made during a save, and return calendar users to their chosen month. Keep existing Next.js/FastAPI, account ownership, order math, semantic dark/light colors, Pretendard, current financial sign conventions and minimal motion. No mock prices in production, new dependencies, copied assets or private data in public links. Output integrated files under frontend/components and frontend/lib, compatible tests/documentation and scoped styles. Keep earlier pending changes intact. Build and execute isolated tests; label unavailable real-browser validation and do not publish without explicit authorization.

## 2026-11-06 · 탐색 연속성과 조회 복구 고도화

- 목적/사용자: 국내·미국 종목을 찾고 비교하는 모바일 초보자와 재방문 사용자. 현재 웹 디자인·계좌·주문 계산·앱인토스는 유지한다.
- 코드 근거: 전체 종목에는 비교 선택이 없고, 검색 조건을 명시적으로 저장할 수 없다. CommandSearch의 무제한 조회와 IME/조회 중 Enter 선택, TradingTerminal의 일회성 프로필 조회, PersonalWorkspace의 부분 공시 실패 안내에 실제 재조회 조작이 없는 것을 확인했다. 기존 사용자 LeagueRooms 변경은 제외한다.
- OpenUI resolved inputs: Topic=StockPilot 종목 탐색과 개인 기록 복구; Offer=전체 종목 비교·명시적 검색 조건 저장·안전한 검색/재조회; Audience=한국어 모바일/PC 투자 연습 사용자; Primary user action=검색→비교/상세→동일 조건 복귀; Deliverable=현재 Next.js 웹에 통합된 한 방향; Style direction=기존 소비자 증권 UI; Tonal key=기존 dark/light; Icon policy=Lucide 재사용; Proof assets=실제 읽기 API 계약과 격리된 검증 fixture; Motion intensity=minimal.
- Composition contract: 신규 hero 없음. 기존 시장 요약과 목록을 유지하고 검색 아래에 필요할 때만 저장 조건을 배치한다. 목록의 독립 비교 버튼과 기존 비교 선택 상태를 연결한다. 성공/실패는 실제 응답으로만 표시하며 새로운 순위·가격을 만들지 않는다. 공개 검색 조건만 사용자 클릭으로 이 브라우저에 최대6개 저장하고 계좌·인증 정보는 저장하지 않는다. 다른 기기 동기화로 표현하지 않는다.
- 시각 규칙: 현재 Pretendard, --ws-surface/ink/muted/line/brand 토큰과 다크·라이트 값 재사용. 제목20–24px, 입력16px, 본문14–16px, 보조13px, 간격8/12/16/24px, 44px 조작, 기존12–20px 반경. 목록은 동일한 공유 표면을 유지하고 모바일에서는 가격/이름을 축소하지 않고 보조 조작을 재배치한다. keep-all/min-width:0/명시적 focus/reduced-motion 유지.
- 실제 동작: ‘조건 저장’→검증된 시장/거래소/검색어/표시 수를 localStorage에 명시적으로 저장; 저장 조건→첫 페이지를 기존 URL로 열기; ‘비교 추가’→기존 최대3종목 비교 상태와 /compare; ‘다시 시도’→실패한 읽기 요청만 실행. 삭제/용량 오류/저장소 접근 불가/빈 검색/부분 자료/인증 만료를 구별한다. 주문 자동 재시도·계좌 초기화·운영 데이터 쓰기는 없음.
- 구현 경로: StockDirectory/RankedMarketBrowser와 scoped CSS·검색 조건 helper, CommandSearch, TradingTerminal 프로필·시장 복귀 연결, PersonalWorkspace 공시 복구, 관련 회귀 검사·README. 금융 시세 부재 시 원가가 시세로 보이는 문제는 별도 정확성 점검 후 데이터 계약을 보존하는 범위만 반영한다.
- 검증: 한글 입력 확정/시간초과/검색 재개방/상세 왕복, 저장 조건 유효성·중복·6개 제한·저장소 실패, 비교 여러 페이지/시장, 프로필 실패 후 재조회·로그아웃, 공시 부분/전체 실패 후 복구. 타입·린트·전체 안전성·제품 테스트·빌드, 360×800/390×844/768×1024/1440×900 light/dark 및 키보드. 운영 계좌 쓰기·운영 부하 시험 없음. 이번 변경의 새 배포 승인이 확인되기 전에는 커밋·푸시·배포하지 않는다.
- Filled master prompt/output: Improve StockPilot's existing financial workspace with complete instrument discovery, explicitly saved local search presets, shared multi-instrument comparison and honest recoverable read states. Preserve the current Next.js framework, responsive composition, Pretendard and semantic light/dark tokens. Reuse the existing API contracts, account identity and URL navigation. Keep actions explicit, touch targets readable and keyboard focus visible. Never invent prices, silently save private data, change trading rules or touch the private Apps in Toss source. Produce integrated components, deterministic isolated tests and actual mobile/desktop screenshots. Review composition, typography and responsive/interaction states; fix observed defects. Output the existing frontend paths, not a new app or marketing page.

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

## 2026-11-23 · 시장 탐색 UI 재설계와 실제 Tailwind 적용

- 목적/첫 행동: 국내·미국 주식을 처음 찾는 사용자가 검색 → 시장/순위 선택 → 종목 상세 진입을 빠르게 끝낸다. 화면만 꾸미지 않고 기존 검색·순위·거래소 필터·새로고침·비교·관심종목 동작을 그대로 연결한다.
- 실제 화면 근거: 사용자 제공 운영 데스크톱 캡처에서 최근 종목/검색 및 순위 도구의 정렬·간격이 엉키고 빈 데이터 상태가 넓게 보이는 점을 확인했다. 로컬 격리 시안은 Playwright 캡처로 360×800, 390×844, 768×1024, 1440×900의 라이트·다크를 직접 확인했다. 캡처 경로: `%TEMP%\stockpilot-final-20261123\market-{360,390,768,1440}-{light,dark}.png`. 이 데이터는 `UPGRADE_FIXTURE=1` 격리 미리보기의 합성 자료이며 운영 시세/API 검증이 아니다.
- 참고 및 적용: [Toss Securities](https://www.tossinvest.com/)를 2026-11-23 다시 열어 공개 홈의 주요 탐색, 지수, 순위·필터·표 항목의 정보 위계를 텍스트로 확인했다. 해당 응답은 픽셀 캡처가 아니므로 Toss의 실제 글꼴·색·간격을 봤다고 주장하지 않는다. 사용자 운영 캡처와 StockPilot 실제 컴포넌트를 시각 근거로 삼고, 주식 탐색에 필요한 검색→시장→순위→거래소→목록 순서만 적용했다. 브랜드 자산·레이아웃 복제 없음.
- 선택/토큰: 기존 Pretendard·Lucide·화면 구조는 유지하고 시장 영역만 선명한 인디고 포커스, 중성 캔버스, 읽기 쉬운 종목 행으로 정리한다. 상승/하락은 한국 시장의 의미색을 유지하고 다크 모드에 별도 대비값을 준다. 검색은 목록 위, 국내/미국과 거래소 조작은 분리, 순위 탭은 넓은 화면 한 줄·모바일 가로 스크롤, 보조 지수/계좌/관심종목은 2열 작업 영역으로 배치한다. 좁은 화면은 거래소 선택값을 짧게 보여 주고 넓은 화면에는 ‘거래소’ 맥락 라벨을 노출한다.
- Tailwind: 이미 설치된 Tailwind CSS v4 및 PostCSS를 사용한다. 새 패키지는 설치하지 않는다. `theme.css`와 `utilities.css`만 불러와 전역 Preflight가 기존 앱을 초기화하지 않게 하고, 시장 전용 CSS에서 `@theme`, `@source`, `@apply`로 `min-w-0`, 테두리·반경·그림자 등 실제 유틸리티를 적용한다. 색·간격·반응형 배치는 기존 디자인 토큰을 보완하는 scoped CSS로 유지한다.
- 변경: `frontend/app/market-visual-refresh.css`, `frontend/app/layout.tsx`, `frontend/components/RankedMarketBrowser.tsx`, `frontend/scripts/verify-discovery-redesign.mjs`. UI markup/CSS와 캡처 검증만 변경했다. 인증·시세/API·DB·계좌·매매 계산·앱인토스는 변경하지 않는다. 다크/라이트 전환, 조회 오류·복구, 빈 상태, 터치/키보드 상호작용을 기존 구현대로 보존한다.
- 검증: Next production build·TypeScript·ESLint 통과. 격리 Playwright에서 320/360/390/430/768/1024/1440/1920px × 라이트/다크 16개 조합의 넘침·첫 목록 위치와 실제 캡처를 확인했고, 검색·비교·관심 등록 키보드 Enter·상세/복귀·필터·오류 후 재시도를 확인했다. 시장 탐색·응답·비교·전체 종목·통합 검색 관련 6개 회귀 스크립트 모두 통과. 합성 fixture에서 페이지 오류 0, 데이터 쓰기 0. 색 대비는 일반 표면 기준 주요 텍스트/브랜드/상승/하락 조합이 모두 4.5:1 이상이었다. Coders deployment API는 `ready`를 반환했고 공개 페이지 텍스트 조회도 성공했다. 다만 이 실행 환경의 직접 HTTP 요청은 시간 초과해 운영 CSS의 응답 및 운영 브라우저 시각 검증은 완료하지 못했다. 실제 운영 시세/API 검증도 아니다.
- 반론/한계: 범위는 ‘오늘의 시장’ 종목 탐색 첫 화면이지 전체 앱의 전면 재설계가 아니다. Toss 공개 웹 응답은 텍스트로만 확인했으며 실제 참조 화면의 픽셀을 비교하지 않았다. 따라서 Toss 스타일과 동일하거나 운영 장애가 없다고 말하지 않는다. 최종 게이트는 최종 빌드·회귀·diff·비밀정보 검사, upstream→fork→Coders 기존 프로젝트 절차와 실제 운영 확인이다.

## 2026-11-24 · 시장 화면 시안 검토 및 좁은 뷰포트 수정

- 목적/범위: 기존 StockPilot 시장 화면에서 검색→국가/순위/거래소 선택→종목 확인 흐름을 한눈에 읽히게 하고 모바일에서 거래소·새로고침 조작이 밀려나지 않게 한다. 기존 API·계좌·주문 규칙·앱인토스는 보존한다.
- ChatGPT 이미지 시안: `docs/design-assets/stockpilot-market-responsive-v1.png`는 모바일·데스크톱의 콘텐츠 위계를 검토하는 목업이다. 숫자/목록은 실제 시세가 아니며 제품 자산·데이터로 쓰지 않는다.
- Stitch 검토: 비공개 프로젝트 `5609013752496196202`에서 데스크톱 정제 화면 `dd54e01d183c4564b090f088835a4325` 및 모바일 정제 화면 `ac8495bdea394d22aeb5e183a4e41aa6`을 생성했다. 첫 생성본의 임의 페이지 수, 지연시간 문구, 잘못된 ‘업종’ 표기, 한국 선택 중 미국 종목을 검토에서 제거했다. 최종 PNG를 프로젝트 보드에 저장하는 단계는 별도 동의 응답을 기다리는 중이며, 생성 결과 자체와 보드의 저장 상태를 혼동하지 않는다. Gemini 3.8 Flash는 Stitch의 화면 정제에만 사용했다. 별도 Gemini 검토 및 Figma 파일 검토는 접근 가능한 대상 파일/연결이 없어 수행하지 않았다.
- 확인 화면과 선택: 실제 코드 `TradingTerminal.tsx`의 모바일 5개 메뉴, `RankedMarketBrowser.tsx`의 실제 검색·한국/미국·전체/시가총액/거래량/상승률/하락률·거래소·새로고침·20개 더 보기 동작을 대조했다. 가벼운 중성 표면/인디고 선택 상태와 종목 목록 위계를 참고하되 임의 수치·페이지 번호·데이터 출처·브랜드 자산은 반영하지 않는다.
- 구현: `frontend/app/market-visual-refresh.css`에서 데스크톱의 named grid area가 모바일 액션 내부 그리드에 상속되던 것을 초기화하고, 태블릿·모바일에 실제 “거래소” 라벨을 노출한다. 마크업·문구·색 토큰 외의 동작, API, 인증, DB, 계좌 계산 및 AIT 번들은 변경하지 않았다.
- 검증: 모든 CSS 변경 이후 Next production build를 다시 통과했다. 전체 `verify:safety` 스크립트는 최종 CSS-only 라벨 보완 전 통과했고, 그 보완 뒤 시장 내비게이션·응답·디렉터리·통합 탐색 4개 회귀 스크립트를 재실행해 통과했다. 격리 미리보기에서 320×800, 390×844, 1440×900을 라이트/다크로 렌더링했으며 768px도 좌표로 확인했다. 실제 DOM 측정에서 320/390px 거래소 라벨·선택·새로고침은 모두 화면 안에 있고 `document` 가로폭은 뷰포트와 일치했다. 768/1440px에도 가로 넘침이 없었다. 검증 자료는 `UPGRADE_FIXTURE=1` 격리 환경의 합성 데이터이며 운영 API/실계좌 결과가 아니다.
- 한계/다음 게이트: Stitch 화면은 Figma나 프로덕션 브라우저가 아니며, 스크린샷을 보드에 저장했는지는 승인 뒤 확인한다. Gemini를 별도 리뷰어로 사용했다고 주장하지 않는다. Coders 배포 전 마지막 빌드·회귀·diff/비밀정보 점검, upstream → fork → 배포 → 운영 URL 순서와 실운영 화면 확인이 남아 있다.

## 2026-11-24 · 시장 작업공간 디자인 방향 재검토

- 제품/사용자/첫 행동: 시장 화면은 한국·미국 종목을 검색하고, 실제 제공 중인 순위를 고른 뒤 상세를 여는 작업 공간이다. 종목 행을 빨리 찾는 것이 첫 성공이며, 장식적인 지수·자산 카드가 이를 밀어내면 안 된다.
- 확인된 근거와 제한: `RankedMarketBrowser.tsx`, `TradingTerminal.tsx`, market-scoped CSS와 기존 회귀 스크립트를 다시 읽었다. 운영 사이트 [https://stockpilot.coders.kr/](https://stockpilot.coders.kr/)의 공개 DOM은 서버 렌더링 첫 상태에서 순위/계좌/시세 확인 중으로 보였으며, 이 상태만으로 hydrated 런타임의 장애를 판정하지 않는다. 2026-11-23의 1440/390 격리 캡처(`%TEMP%\stockpilot-final-20261123\market-1440-dark.png`, `market-390-dark.png`)는 시각적 기준이지만 `UPGRADE_FIXTURE=1` 합성 자료다. NXT 메인 페이지는 직접 열람 403이므로 시각 레퍼런스로 쓰지 않고 검색 색인에서 확인 가능한 시장 구간/데이터 항목만 맥락으로 사용한다. Naver/Toss 페이지는 텍스트 구조만 관찰되었고 픽셀 캡처가 아니어서 색·폰트·간격을 보았다고 주장하지 않는다.
- 시안/협업 한계: 이번 재시도에서는 GPT 이미지 생성기로 세 장의 공개·비식별 시장 콘셉트를 반복 생성했고, 세 번째 구성을 방향 시안으로 선택했다. ChatGPT 웹 탭은 Codex 브라우저 제어에서 CDP 시간 초과로 열지 못했고 Gemini 대화는 수행하지 않았다. 따라서 웹 대화나 Gemini 검토 완료를 주장하지 않는다. 독립 시각/계약 점검은 내부 검토로 받았으며, 외부 전문가 승인으로 표현하지 않는다. 생성 이미지는 구현 근거의 하나일 뿐 실제 시세·레이아웃의 진실 원천이 아니다.
- 선택한 방향: 다크 기본/라이트 대응의 절제된 StockPilot 인디고, 종목 탐색과 실제 순위 목록 중심, 시세 표본과 국내/미국 기준 시각은 화면 상단에서 간결하게, 모바일 하단 다섯 메뉴는 기존 네비게이션만 사용한다. 중복 KPI 카드·임의 업데이트 문구·시안용 종목/숫자·NXT 브랜드/레이아웃 복제는 제외한다.
- 구현 결정: 1100px 이상 보조 레일에서 지수·모의 자산·관심종목 패널을 하나의 바깥 표면과 구분선으로 묶어, 각각 겹겹이 떠 있는 카드처럼 보이지 않게 했다. 768~1279px에서는 3열 컨테이너 규칙이 필터를 잘라내던 문제를 찾아 한 열 제목 행과 분리된 순위/거래소 행으로 바꿨다. 모바일은 기존 보조 레일 숨김/주요 탐색 순서를 보존하고 거래소·새로고침을 44px 이상, 보조 라벨을 읽을 수 있는 크기로 맞췄다. 실제 DOM/검색/선택/API 응답은 바꾸지 않았다.
- 적용 경계와 보존 계약: 이번 변경은 기존 시장 탐색 UI의 CSS에 한정한다. `--ws-*` 의미 토큰, Pretendard, 실제 API 응답/시점, 순위 스냅샷과 409/503 처리, 전체 종목 경로, 검색·비교·관심·상세 연결은 보존한다. 실계좌·주문 계산·인증·백엔드·DB·앱인토스 코드는 변경하거나 운영 계정으로 쓰기 요청을 하지 않는다.
- 검증 결과: Next.js 정적 production build 성공. 전체 `verify:safety` 체인 및 16개 뷰포트/테마 조합(320·360·390·430·768·1024·1440·1920 × 라이트/다크) 통과, 브라우저 콘솔/페이지 오류와 문서 가로 넘침 없음, 격리 자료 쓰기 0건. 768px 첫 캡처에서 탭이 잘리는 것을 발견해 수정하고 새 빌드에서 다시 육안 확인했다. 390px/1440px의 다크·라이트도 격리 Playwright 캡처로 재확인했다. 계좌/API 동작 회귀 테스트는 기존 28개 안전 스크립트 전체가 통과했다. 검증 자료는 `UPGRADE_FIXTURE=1` 합성 데이터라 실제 시세/계좌 검증은 아니다.
- 협업/한계: GPT 이미지 생성 도구의 공개·비식별 콘셉트 3개를 비교해 방향을 정했지만 ChatGPT 웹 대화는 접근 시간 초과, Gemini 대화는 미수행이다. 실제 웹 채팅과 외부 디자인 리뷰가 있었다고 주장하지 않는다. 운영 페이지의 공개 초기 HTML은 확인했으나 인증 후 hydration과 실운영 시세 화면은 브라우저에서 검증하지 못했다. 직접 픽셀 참고는 하지 못한 NXT는 정보 구조 맥락으로만 봤다.
- 배포 게이트: Coders 최신 문서를 재확인했다. GitHub upstream `boclair98/stockpilot`과 실제 fork `coders-kr/stockpilot`를 확인했다. 배포는 마지막 staged diff/secret 검사 후 upstream → fork 동기화 → 기존 프로젝트 배포 → 운영 URL 확인 순서로 진행한다.
