# StockPilot

> 실제 한국·미국 주식 시세로 연습하는 웹 기반 가상투자 서비스

<p>
  <a href="https://stockpilot.coders.kr">
    <img src="https://img.shields.io/badge/운영_서비스-stockpilot.coders.kr-4f6bed?style=for-the-badge" alt="운영 서비스" />
  </a>
  <a href="https://apiportal.koreainvestment.com/">
    <img src="https://img.shields.io/badge/시세-KIS_Open_API-22a06b?style=for-the-badge" alt="KIS Open API" />
  </a>
  <img src="https://img.shields.io/badge/거래-100%25_가상투자-f2a93b?style=for-the-badge" alt="가상투자" />
</p>

**바로 사용하기:** [https://stockpilot.coders.kr](https://stockpilot.coders.kr)

StockPilot은 한국투자증권 KIS Open API의 국내 KRX·NXT 통합 시세와 미국 주식 시세를 이용하는 모의투자 서비스입니다. 사용자는 실제 시장 가격을 보며 국내·미국 종목을 검색하고, 서비스에서 지급한 가상 원화·달러 자산으로 매매를 연습할 수 있습니다.

실제 증권계좌로 주문을 전송하지 않으며 계좌번호나 계좌 비밀번호도 요구하지 않습니다.

<p align="center">
  <a href="https://stockpilot.coders.kr">
    <img src="docs/images/stockpilot-overview-hd.png" width="820" alt="StockPilot 메인 화면" />
  </a>
</p>

## 핵심 기능

| 영역 | 제공 기능 |
|---|---|
| 실시간 시장 | 국내 KRX·NXT 통합 시세, 미국 주식 시세, 시장 운영 상태 |
| 종목 탐색 | 한국·미국 TOP 10, 종목명·종목코드·티커 통합 검색 |
| 가상 매매 | 시장가, 지정가, 손절·돌파, 조건부 지정가, 미체결 주문 취소 |
| 주문 안전장치 | 보유·대기 주문 수량 검증, 초과 매도 차단, 전량 매도, 예수금 부족 안내 |
| 자산 관리 | KRW·USD 가상 예수금, 보유 종목, 평균 매입가, 평가손익 |
| 투자 분석 | 기간별 수익률, 실현손익, 승률, 체결 수, 모의 거래비용 |
| 수익률 리그 | 공개 리그, 초대형 시즌 리그, 순위와 순위 변화 |
| 기업 정보 | OpenDART 회사 개요, 핵심 재무지표, 최근 공시 |
| 학습 기능 | 과거 시세 리플레이, 투자 미션, 종목 뉴스 |
| 관심·알림 | 관심종목, 목표가격 알림, 읽지 않은 알림 배지 |
| 웹 푸시 | Firebase Cloud Messaging 기반 목표가 도달 브라우저 알림 |
| 사용자 | Google 로그인, 사용자별 가상자산·주문·리그 기록 분리 |

## 주요 화면과 사용 흐름

### 1. 실시간 주요 종목 확인

한국과 미국 시장의 주요 종목을 한 화면에서 확인합니다. 국내 시세는 KRX와 NXT를 합친 통합 시장 기준이며, 종목을 선택하면 현재가와 주문 화면이 함께 표시됩니다.

### 2. 원하는 종목 검색

TOP 10에 없는 종목도 종목명, 국내 종목코드 또는 미국 티커로 검색할 수 있습니다. 검색 결과에서 종목을 선택하면 동일한 가상 주문 기능을 사용할 수 있습니다.

<p align="center">
  <img src="docs/images/stockpilot-search.jpg" width="360" alt="StockPilot 전체 종목 검색 화면" />
</p>

### 3. 실제 시세 기반 가상 매매

- 국내 주식은 가상 원화 예수금으로 거래합니다.
- 미국 주식은 가상 달러 예수금으로 거래합니다.
- 시장가와 계획 주문을 지원하며 미체결 지정가 주문은 취소할 수 있습니다.
- 미보유 종목과 보유 수량을 넘는 매도는 주문 전에 차단합니다.
- 대기 중인 매도 주문 수량을 별도로 계산해 중복 매도를 방지합니다.
- 체결 시 모의 수수료와 국내 매도 비용을 가상 잔고에 반영합니다.
- 모든 거래는 StockPilot 내부 가상 원장에만 기록됩니다.

### 4. 포트폴리오와 투자 리포트

보유 수량, 평균 매입가, 현재 평가금액, 평가손익과 수익률을 확인할 수 있습니다. 투자 리포트에서는 국내·미국 수익률, 실현손익, 체결 수, 승률, 거래비용과 일별 추이를 제공합니다.

### 5. 수익률 리그

[수익률 리그](https://stockpilot.coders.kr/league)는 가상투자 결과로 다른 사용자와 경쟁하는 기능입니다.

- 모든 사용자는 동일한 `₩1억 + US$10만`으로 시작합니다.
- 한국 계좌와 미국 계좌 수익률을 50:50으로 합산합니다.
- 공개 순위에는 닉네임, 순위, 수익률과 순위 변화만 표시합니다.
- 보유 종목, 매매 내역, 잔고, Google 실명과 이메일은 공개하지 않습니다.
- 친구와 7~90일 동안 경쟁하는 초대형 비공개 시즌 리그를 만들 수 있습니다.

### 6. 관심종목과 목표가 푸시 알림

관심종목과 목표가격을 등록하면 목표가 도달 시 상단 알림 배지와 브라우저 푸시로 알려줍니다. 로그인 후 `나의 투자 도구 → 관심·알림 → 푸시 알림 켜기`에서 기기를 등록할 수 있습니다.

## 서비스 구조

```text
사용자 브라우저
  └─ Next.js 16 / React 19
       └─ FastAPI
            ├─ KIS Open API
            │    ├─ 국내 KRX·NXT 통합 시세
            │    └─ 미국 주식 시세·뉴스
            ├─ OpenDART
            │    └─ 기업 개요·재무·공시
            ├─ Google OAuth 2.0
            │    └─ 로그인·사용자 세션
            ├─ Firebase Cloud Messaging
            │    └─ 목표가 도달 웹 푸시
            └─ PostgreSQL
                 └─ 가상 잔고·보유 종목·주문·리그·알림
```

KIS Open API는 **종목과 시세 조회에만** 사용합니다. 사용자가 제출한 매수·매도 주문은 StockPilot의 PostgreSQL 가상 원장에 저장되며 한국투자증권으로 전송되지 않습니다.

## 기술 스택

| 영역 | 기술 |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript |
| Backend | Python, FastAPI, SQLAlchemy Async |
| Database | PostgreSQL 16, Alembic |
| Authentication | Google OAuth 2.0, 서버 세션 쿠키 |
| Market Data | 한국투자증권 KIS Open API |
| Company Data | 금융감독원 OpenDART |
| Push Notification | Firebase Cloud Messaging, Web Push |
| Infrastructure | Docker, Docker Compose, coders.kr |

## 주요 디렉터리

```text
backend/
  app/
    routes/
      auth.py             Google 로그인과 세션
      trading.py          시세·검색·가상 주문
      league.py           리그 참여·수익률·순위
      company.py          OpenDART 기업정보
      engagement.py       관심종목·알림·리포트·미션
    services/
      firebase_push.py    Firebase 푸시 발송
      price_alert_notifier.py
                          목표가 감시 작업
  alembic/versions/       데이터베이스 마이그레이션

frontend/
  app/                    페이지와 전역 스타일
  components/
    TradingTerminal.tsx   종목·검색·주문·포트폴리오
    LeagueBoard.tsx       공개 수익률 리그
    LeagueRooms.tsx       초대형 시즌 리그
    CompanyInsight.tsx    기업 개요·재무·공시
    InvestorTools.tsx     관심종목·알림·리포트·미션
    PracticeLab.tsx       과거 시세 리플레이
  public/
    firebase-messaging-sw.js
                          백그라운드 푸시 서비스 워커

compose.yaml              로컬 개발 환경
coders.yaml               coders.kr 배포 설정
```

## 로컬 실행

### 1. 환경 변수 준비

```bash
cp backend/.env.example backend/.env
```

`backend/.env`에 필요한 값을 입력합니다.

```dotenv
KIS_ENV=paper
KIS_APP_KEY=
KIS_APP_SECRET=
DART_API_KEY=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

AUTH_SESSION_SECRET=
AUTH_COOKIE_SECURE=false
FIREBASE_SERVICE_ACCOUNT_B64=

SIMULATION_FEE_RATE=0.00015
SIMULATION_KR_SELL_TAX_RATE=0.002
```

Google Auth Platform의 승인된 리디렉션 URI에도 다음 주소를 등록합니다.

```text
http://localhost:3000/api/auth/google/callback
```

`AUTH_SESSION_SECRET`은 최소 32바이트 이상의 무작위 문자열을 사용하세요. API Key, App Secret, 서비스 계정 JSON은 Git에 커밋하지 마세요.

### 2. 실행

```bash
docker compose up
```

- 웹: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:8000](http://localhost:8000)
- 상태 확인: [http://localhost:8000/api/health](http://localhost:8000/api/health)

## 운영 환경 Secret

배포 환경에는 다음 Secret이 필요합니다.

- `KIS_APP_KEY`
- `KIS_APP_SECRET`
- `DART_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AUTH_SESSION_SECRET`
- `FIREBASE_SERVICE_ACCOUNT_B64`

운영 Google OAuth 리디렉션 URI:

```text
https://stockpilot.coders.kr/api/auth/google/callback
```

## 주의사항

- StockPilot은 모의투자 서비스이며 실제 주식 주문을 전송하지 않습니다.
- 화면의 시세는 제공처 정책, 장 운영 시간과 네트워크 상태에 따라 지연될 수 있습니다.
- 수수료와 세금은 학습을 위한 모의 설정값이며 실제 과세 판단에 사용할 수 없습니다.
- 서비스의 정보는 투자 권유 또는 투자 자문이 아닙니다.
- 실제 서비스 운영 시 각 데이터 제공 API의 이용약관과 재배포 정책을 확인해야 합니다.
