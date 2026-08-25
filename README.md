<div align="center">

<img src="frontend/app/icon.svg" width="72" alt="StockPilot 아이콘" />

# StockPilot

### 실제 시세로 배우고, 안전하게 거래하는 가상투자 플랫폼

KRX·NXT·미국주식 시세를 바탕으로 검색, 분석, 가상주문, 포트폴리오 관리와 투자 학습을 한 흐름으로 연결한 개인 프로젝트입니다.

<p>
  <a href="https://stockpilot.coders.kr"><img src="https://img.shields.io/badge/Live-stockpilot.coders.kr-4F6BED?style=for-the-badge&logo=googlechrome&logoColor=white" alt="운영 서비스" /></a>
  <a href="https://github.com/boclair98/stockpilot"><img src="https://img.shields.io/badge/GitHub-Source_Code-181717?style=for-the-badge&logo=github" alt="GitHub 저장소" /></a>
</p>

<p>
  <img src="https://img.shields.io/badge/Frontend-Next.js_16-111827?style=flat-square&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square&logo=fastapi" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Market_Data-KIS_Open_API-16A085?style=flat-square" alt="KIS Open API" />
  <img src="https://img.shields.io/badge/Trading-100%25_Virtual-F2A93B?style=flat-square" alt="가상투자" />
  <img src="https://img.shields.io/badge/Auth-Google_Only-4285F4?style=flat-square&logo=google&logoColor=white" alt="Google 로그인" />
</p>

</div>

> **주의:** StockPilot의 매수·매도는 서비스 내부 가상원장에서만 처리됩니다. 실제 증권계좌로 주문을 보내지 않으며, 계좌번호·계좌 비밀번호를 요구하지 않습니다.

## 프로젝트 소개

StockPilot은 주식을 처음 접하는 사용자가 실제 투자 서비스의 흐름을 안전하게 연습할 수 있도록 만든 모의투자 서비스입니다.

사용자는 Google 로그인 후 원화 `₩100,000,000`과 달러 `$100,000`의 가상자금을 받고, 실제 KIS 시세를 확인한 뒤 가상주문을 제출합니다. 체결 결과는 StockPilot의 PostgreSQL 원장에 기록되며, KOSPI 벤치마크·수익률 리그·투자일지·학습 미션으로 이어집니다.

### 사용 흐름

```text
Google 로그인
    ↓
실시간 시장 확인 · KOSPI 국면 확인
    ↓
종목 검색 · 차트 · 뉴스 · 기업공시 분석
    ↓
시장가/지정가/조건부 가상주문
    ↓
포트폴리오 · 체결 품질 · KOSPI 상대성과 확인
    ↓
투자일지 · 챌린지 · 수익률 리그로 복기와 성장
```

## 주요 기능

| 영역 | 기능 | 설명 |
|---|---|---|
| 시장 | KRX·NXT·미국주식 시세 | 국내 통합 거래소와 미국주식 주요 종목의 실시간 시세 제공 |
| 시장 | 전체 종목 검색 | TOP 10 외에도 한국 종목코드·종목명·미국 티커로 검색 후 바로 분석·주문 |
| 시장 | KOSPI 시장 나침반 | 5·20거래일 수익률과 변동성으로 상승장·박스권·하락장·변동성 확대를 표시 |
| 시장 | KOSPI 상대성과 | 로그인 후 내 모의투자 수익률과 KOSPI를 같은 기간으로 비교 |
| 분석 | 가격 차트 | 1주·1개월·3개월 일별 차트와 기간 수익률·고가·저가 표시 |
| 분석 | 뉴스·기업정보 | KIS 뉴스, OpenDART 기업개요·재무·공시 원문 연결 |
| 거래 | 4가지 가상주문 | 시장가, 지정가, 손절, 조건부 지정가 주문 지원 |
| 거래 | 현실형 가상체결 | 스프레드·주문 참여율·슬리피지를 반영해 체결가 계산 |
| 거래 | 안전한 매도 검증 | 미보유 종목, 보유 수량 초과, 대기 주문 중복 매도 차단 |
| 거래 | 익절·손절 보호주문 | 보유 수량에 목표가와 손절가를 설정하고 조건 충족 시 가상매도 |
| 자산 | 가상 포트폴리오 | 원화·달러 현금, 보유수량, 평균단가, 평가손익, 수익률 제공 |
| 자산 | 거래 명세서 | 모의 수수료·세금·체결 품질·주문 상태를 확인하고 CSV로 저장 |
| 성장 | 투자 리포트 | 실현손익, 승률, 최대낙폭, 변동성, 샤프비율, 슬리피지 분석 |
| 성장 | 투자일지·복기 | 거래 근거·목표수익률·손절기준을 작성하고 결과를 회고 |
| 성장 | 챌린지·학습센터 | 과거 차트 예측, 투자용어, 주문·위험관리 게임과 XP 기록 |
| 경쟁 | 수익률 리그 | 종목과 주문내역은 숨기고 닉네임·수익률·순위만 공개 |
| 경쟁 | 시즌·1:1 배틀 | 친구 초대코드로 기간형 리그와 개인 대결 진행 |
| 알림 | 목표가·브라우저 푸시 | 목표가 도달, 주문 상태와 주요 이벤트를 Firebase Web Push로 알림 |
| 커뮤니티 | 투자 라운지 | 보유자산을 공개하지 않고 투자 습관과 배움을 공유 |
| 운영 | 운영자 통제센터 | 모의거래 중지, 위험한도, 원장 대사, 감사 이벤트 확인 |

## 기술 스택

| 구분 | 기술 |
|---|---|
| Frontend | Next.js 16 App Router, React 19, TypeScript, CSS |
| Backend | Python 3.12, FastAPI, Pydantic, SQLAlchemy Async |
| Database | PostgreSQL 16, Alembic migration |
| Cache·Traffic | Redis, TTL 캐시, 분산 락, 요청 제한, single-flight |
| Authentication | Google OAuth 2.0, 서버 세션 쿠키 |
| Market Data | 한국투자증권 KIS Open API(WebSocket·REST) |
| Company Data | 금융감독원 OpenDART API |
| Push | Firebase Cloud Messaging(Web Push) |
| Deployment | Docker, Docker Compose, coders.kr 멀티서비스 배포 |
| Quality | Pytest, Ruff, ESLint, TypeScript, Next.js production build |

## 핵심 설계

### 1. 모의원장과 실시간 시세의 분리

KIS는 종목·시세·지수·뉴스 조회에만 사용합니다. 주문은 KIS 주문 API로 전송하지 않고 FastAPI가 PostgreSQL의 가상계좌·포지션·주문·감사 이벤트를 트랜잭션으로 기록합니다.

```text
KIS WebSocket/REST ──> Market Collector ──> Redis shared snapshot
                                      │
                                      ├──> 공개 시세·KOSPI API
                                      └──> 가상체결 엔진 ──> PostgreSQL 원장
```

### 2. KOSPI를 서비스 기준선으로 사용

KOSPI 지수는 단순 차트가 아니라 사용자의 투자 판단을 설명하는 기준선입니다.

- 최근 5·20거래일 시장 수익률 계산
- 일별 수익률 변동성 계산
- 상승장·박스권·하락장·변동성 확대 국면 분류
- 개인 포트폴리오와 같은 기간의 상대성과 계산
- 종목·수량·주문내역을 공개하지 않는 익명 비교

계산 로직은 `backend/app/services/benchmark.py`에 순수 함수로 분리해 API와 테스트에서 재사용합니다.

### 3. 체결 전 위험 통제

주문 접수 시점에 거래 모드, 장 운영 상태, 시세 지연, 주문금액, 일일 주문 수, 현금, 보유 수량과 중복 매도 가능 수량을 검증합니다. 실패한 주문도 거절 사유와 감사 이벤트를 남겨 재현 가능한 학습 기록으로 보존합니다.

### 4. 대규모 접속을 고려한 시장 데이터 처리

KIS 수집기를 단일 수집기로 운영하고 Redis lease·공유 캐시·WebSocket fan-out을 사용합니다. 여러 브라우저가 같은 종목을 요청해도 외부 API 호출과 JSON 직렬화를 반복하지 않도록 구성했습니다.

## 도메인 구조

```text
app
├── routes
│   ├── trading.py       # 시세·검색·주문·포트폴리오·KOSPI
│   ├── growth.py        # 챌린지·투자일지·분석·KOSPI 벤치마크
│   ├── league.py        # 공개 리그·시즌방·1:1 배틀
│   ├── company.py       # OpenDART 기업·재무·공시
│   ├── engagement.py    # 목표가·리포트·관심종목·푸시
│   ├── auth.py          # Google OAuth 세션
│   └── operations.py    # 운영 통제·대사·감사
├── services
│   ├── kis_market.py    # KIS REST/WebSocket 수집 및 캐시
│   ├── benchmark.py     # KOSPI 수익률·시장 국면 계산
│   ├── execution_quality.py
│   ├── risk_engine.py
│   ├── portfolio_analytics.py
│   ├── protection_matcher.py
│   └── reconciliation.py
├── core
│   ├── database.py
│   ├── identity.py
│   ├── traffic.py
│   ├── security.py
│   └── order_integrity.py
└── models.py            # 사용자·가상원장·리그·알림·감사 모델
```

## 문서

| 문서 | 내용 |
|---|---|
| [증권사 도입 준비 기준](docs/BROKERAGE_READINESS.md) | 실제 금융권 수준으로 확장할 때 필요한 통제와 미충족 범위 |
| [금융권 연동 준비 목록](docs/INSTITUTIONAL_INTEGRATION.md) | 계약·API·접속자료·운영 협의 체크리스트 |
| [운영 런북](docs/OPERATIONS_RUNBOOK.md) | 배포 전 백업, migration, Redis, 장애 대응 절차 |
| [플랫폼 정책](PLATFORM.md) | coders.kr 인증, 요청 제한, 캐시, WebSocket 운영 기준 |
| [보안 정책](SECURITY.md) | 취약점 신고 및 Secret 관리 원칙 |

## 주요 API

| Method | Endpoint | 역할 | 인증 |
|---|---|---|:---:|
| `GET` | `/api/trading/bootstrap` | 첫 화면용 시세·장 상태·KOSPI 스냅샷 | 선택 |
| `GET` | `/api/trading/quotes` | 국내·미국 TOP 10 시세 | 없음 |
| `GET` | `/api/trading/search` | 전체 종목 검색 | 없음 |
| `GET` | `/api/trading/kospi` | KOSPI 현재값·30거래일 | 없음 |
| `GET` | `/api/growth/benchmark` | KOSPI 국면·5/20거래일 수익률·상대성과 | 선택 |
| `GET` | `/api/trading/portfolio` | 개인 가상잔고·포지션·주문 | 선택 |
| `POST` | `/api/trading/orders` | 가상주문 접수 및 체결 | 필요 |
| `GET` | `/api/trading/statement` | 개인 계좌 명세·거래 규칙 | 선택 |
| `GET` | `/api/features/history` | 종목 일별 차트 | 없음 |
| `GET` | `/api/features/news` | 종목 뉴스 | 없음 |
| `GET` | `/api/company/{symbol}` | 기업정보·재무·공시 | 없음 |
| `GET` | `/api/league/rankings` | 공개 수익률 리그 | 선택 |
| `GET` | `/api/growth/analytics` | 리스크·성과·체결품질 분석 | 필요 |
| `WS` | `/api/trading/ws` | 실시간 시세 스트림 | 없음 |

## 프로젝트 구조

```text
stockpilot
├── frontend
│   ├── app/                    # Next.js 라우트·페이지·반응형 스타일
│   ├── components/             # 시장·주문·성장·리그 UI
│   ├── lib/                    # API·Firebase·학습 콘텐츠 유틸리티
│   ├── Dockerfile
│   └── package.json
├── backend
│   ├── app/                    # FastAPI 애플리케이션
│   ├── alembic/                # DB migration
│   ├── tests/                  # 통합·보안·위험관리 테스트
│   ├── unit_tests/             # 외부 의존성 없는 도메인 테스트
│   ├── Dockerfile
│   └── pyproject.toml
├── docs/                       # 운영·금융권 연동·준비 문서
├── compose.yaml                # 로컬 PostgreSQL·Redis·API·Web
├── coders.yaml                # coders.kr 배포 정의
└── README.md
```

## 화면 미리보기

<table>
  <tr>
    <td align="center"><img src="docs/images/stockpilot-nxt-live.png" width="440" alt="StockPilot 시장 대시보드" /><br /><b>시장 대시보드</b></td>
    <td align="center"><img src="docs/images/stockpilot-kospi-live.png" width="300" alt="StockPilot KOSPI 차트" /><br /><b>KOSPI 기준선</b></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/stockpilot-search.jpg" width="300" alt="StockPilot 종목 검색" /><br /><b>전체 종목 검색</b></td>
    <td align="center"><img src="docs/images/stockpilot-overview-hd.png" width="440" alt="StockPilot 기능 개요" /><br /><b>서비스 흐름</b></td>
  </tr>
</table>

## 시작하기

### 요구사항

- Docker Desktop
- Git
- KIS Open API 키·시크릿(시세 연동 시)
- Google OAuth Client(로그인 연동 시)

### 로컬 실행

```bash
git clone https://github.com/boclair98/stockpilot.git
cd stockpilot
docker compose up --build
```

실행 후 다음 주소에서 확인합니다.

| 서비스 | 주소 |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:8000 |
| API health | http://localhost:8000/api/health |

### 환경변수

```bash
cp backend/.env.example backend/.env
```

운영 환경에서는 다음 값을 Secret으로 주입합니다.

```env
DATABASE_URL=postgresql+asyncpg://...
REDIS_URL=redis://...
KIS_APP_KEY=...
KIS_APP_SECRET=...
KIS_ENV=paper
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
DART_API_KEY=...
FIREBASE_SERVICE_ACCOUNT_B64=...
```

KIS는 시세 조회에만 사용하며, 실제 주문 API 자격증명은 이 프로젝트에 사용하지 않습니다.

## 테스트와 품질 게이트

```bash
# 백엔드
cd backend
uv run pytest -q
uv run ruff check app tests unit_tests

# 프런트엔드
cd frontend
pnpm lint
pnpm build
```

현재 KOSPI 벤치마크·시뮬레이션 규칙·주문 검증·보안·리그·성장 기능에 대한 자동 테스트를 포함합니다.

## 운영 서비스와 진행 상황

- 운영 URL: [https://stockpilot.coders.kr](https://stockpilot.coders.kr)
- 공개 저장소: [https://github.com/boclair98/stockpilot](https://github.com/boclair98/stockpilot)
- 배포 방식: `coders.yaml` 기반 web/api 분리 배포
- 현재 상태: KRX·NXT·미국주식 시세 기반 모의투자 서비스 운영 중

### 다음 개선 후보

- 종목 마스터와 기업 로고 데이터의 정기 업데이트 파이프라인
- 더 긴 기간의 KOSPI·포트폴리오 시계열 저장과 리밸런싱 분석
- 부하 테스트 결과에 따른 Redis·PostgreSQL 용량 조정
- 실제 금융권 도입 시 필요한 개인정보·감사·재해복구·규제 검토

## 책임 범위

StockPilot은 학습과 경험을 위한 가상투자 서비스입니다. 표시되는 시세는 데이터 제공자 정책과 네트워크 상황에 따라 지연될 수 있으며, 수익을 보장하지 않습니다. 실제 금융상품 매매나 투자자문 서비스로 사용하려면 별도의 법률·규제·보안·운영 검토가 필요합니다.

## License

개인 프로젝트입니다. 상업적 사용·재배포 전에는 저장소 관리자에게 문의해 주세요.

