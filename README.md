# StockPilot

> 한국·미국 주식의 실제 시세를 보며 연습하는 가상투자 서비스

[![Live Service](https://img.shields.io/badge/Live-stockpilot.coders.kr-4f6bed?style=for-the-badge)](https://stockpilot.coders.kr)
[![KIS Open API](https://img.shields.io/badge/Market%20Data-KIS%20Open%20API-22a06b?style=for-the-badge)](https://apiportal.koreainvestment.com/)

**운영 서비스:** [https://stockpilot.coders.kr](https://stockpilot.coders.kr)

StockPilot은 한국투자증권 KIS Open API의 국내 KRX·NXT 통합 시세와 미국 주식 시세를 사용해 실제 시장을 따라가면서, 서비스 내부의 가상 원화·달러 자산으로 매매를 연습할 수 있는 웹 서비스입니다. 실제 증권계좌로 주문을 보내거나 실제 돈을 사용하지 않습니다.

![StockPilot 메인 화면](docs/images/stockpilot-overview.jpg)

## 주요 기능

- **KRX·NXT 통합 시세**: KIS 통합 시장 코드 `UN`과 실시간 체결 `H0UNCNT0` 사용
- **국내·미국 주식 시세**: KIS Open API를 이용한 현재가와 등락률 표시
- **시장별 TOP 10**: 한국 주식과 미국 주식의 주요 종목을 한 화면에서 확인
- **전체 종목 검색**: 약 1.6만 개의 국내·미국 종목을 종목명, 종목코드, 티커로 검색
- **가상 매수·매도**: 검색한 종목을 선택해 실제 시세 기준으로 가상 주문
- **고급 모의주문**: 시장가·지정가·손절/돌파·조건부 지정가 주문 지원
- **모의 거래비용**: 체결 시 설정된 수수료와 국내 매도 비용을 가상잔고에 반영
- **이중 통화 자산**: 국내 주식은 KRW, 미국 주식은 USD 가상 예수금으로 분리 관리
- **포트폴리오**: 보유 수량, 평균 매입가, 평가금액과 주문 기록 저장
- **평가손익**: 국내·미국 보유 종목의 평가손익과 수익률 표시
- **지정가 주문 취소**: 아직 체결되지 않은 가상 지정가 주문 취소
- **NXT 세션 안내**: 프리·메인·애프터마켓의 현재 운영 상태와 시간 표시
- **공식 기업정보**: OpenDART의 회사 개요, 대표자, 설립일과 결산월 표시
- **핵심 재무·최근 공시**: 최근 정기보고서의 주요 재무지표와 최근 1년 공시 확인
- **Google 로그인**: 사용자별 가상자산과 거래 내역을 안전하게 분리
- **수익률 오픈 리그**: 기존 가상계좌 수익률로 다른 참여자와 순위 경쟁
- **초대형 시즌 리그**: 친구와 7~90일 비공개 리그를 만들고 참여 이후 수익률로 경쟁
- **프라이버시 순위표**: 닉네임·순위·수익률·순위 변화만 공개하고 종목·거래·잔고는 비공개
- **관심종목·가격 알림**: 최대 20개 관심종목과 20개 목표가격 알림 관리
- **투자 리포트**: 국내·미국 수익률, 체결 수, 실현손익, 승률, 모의 비용과 일별 추이 제공
- **투자 미션**: 첫 체결, 관심종목, 가격 알림, 계획 주문, 분산투자, 리그 참여 미션
- **종목 뉴스**: KIS 공식 국내 시황·공시 제목과 해외 종목 뉴스 제목 제공
- **과거 시세 연습**: 미래 가격을 숨긴 채 하루씩 진행하며 매매 결과를 확인하는 리플레이 모드
- **반응형 UI**: 모바일과 데스크톱에서 사용할 수 있는 간결한 금융 서비스 화면

### 원하는 종목 검색

TOP 10에 없는 종목도 검색해서 시세를 확인하고 가상으로 거래할 수 있습니다.

![StockPilot 종목 검색](docs/images/stockpilot-search.jpg)

### StockPilot 수익률 리그

[운영 서비스의 리그 화면](https://stockpilot.coders.kr/league)에서 기존 Google 계정과 가상투자 기록으로 바로 참여할 수 있습니다. 모든 계정은 동일한 `₩1억 + $10만`으로 시작하며, 환율 변화가 순위를 흔들지 않도록 한국 계좌 수익률과 미국 계좌 수익률을 50:50으로 합산합니다.

공개 순위 응답에는 닉네임, 순위, 누적 수익률, 전일 대비 순위 변화만 포함됩니다. 보유 종목, 매매 내역, 원화·달러 잔고, Google 실명·이메일은 공개하지 않습니다.

## 동작 방식

```text
사용자
  └─ Next.js 프론트엔드
       └─ FastAPI 백엔드
            ├─ KIS Open API: 국내·미국 종목 및 시세
            ├─ OpenDART: 국내 상장사 개요·재무·공시
            ├─ Google OAuth: 사용자 로그인
            └─ PostgreSQL: 가상 잔고·보유 종목·주문·리그 기록
```

KIS API는 **시세 조회에만** 사용합니다. 매수·매도 주문은 StockPilot 내부의 가상 원장에만 기록되며 한국투자증권으로 전송되지 않습니다. 따라서 증권계좌번호나 계좌 비밀번호가 필요하지 않습니다.

## 기술 스택

| 영역 | 기술 |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript |
| Backend | FastAPI, SQLAlchemy Async, Alembic |
| Database | PostgreSQL 16 |
| Authentication | Google OAuth 2.0, 서버 세션 쿠키 |
| Market Data | 한국투자증권 KIS Open API |
| Company Data | 금융감독원 OpenDART |
| Infrastructure | Docker, Docker Compose, coders.kr |

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
SIMULATION_FEE_RATE=0.00015
SIMULATION_KR_SELL_TAX_RATE=0.002
```

Google 로그인까지 로컬에서 확인하려면 Google Auth Platform의 승인된 리디렉션 URI에 아래 주소도 등록해야 합니다.

```text
http://localhost:3000/api/auth/google/callback
```

`AUTH_SESSION_SECRET`은 최소 32바이트 이상의 무작위 문자열을 사용하세요. API 키와 Secret은 절대 Git에 커밋하지 마세요.

### 2. 서비스 실행

```bash
docker compose up
```

- 웹: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:8000](http://localhost:8000)
- API 상태: [http://localhost:8000/api/health](http://localhost:8000/api/health)

## 주요 디렉터리

```text
backend/
  app/
    routes/auth.py        Google 로그인과 세션
    routes/league.py      수익률 계산·참여·프라이버시 순위 API
    routes/company.py     OpenDART 기업 개요·재무·공시 API
    routes/engagement.py  관심종목·가격 알림·리포트·미션 API
    routes/trading.py     시세·검색·가상 주문 API
    services/             KIS 연동과 종목 데이터 처리
  alembic/versions/       거래 관련 DB 마이그레이션

frontend/
  app/                    페이지와 전역 스타일
  components/
    LeagueBoard.tsx       수익률 리그 참여·순위 UI
    CompanyInsight.tsx    국내 상장사 기업정보·재무·공시 UI
    InvestorTools.tsx     관심종목·알림·리포트·미션 UI
    LeagueRooms.tsx       초대형 시즌 리그 UI
    PracticeLab.tsx       KIS 과거 시세 기반 리플레이 학습 UI
    TradingTerminal.tsx   시세·검색·주문·포트폴리오 UI

coders.yaml               coders.kr 배포 설정
compose.yaml              로컬 개발 환경
```

## 운영 환경 설정

배포 환경에는 다음 Secret이 필요합니다.

- `KIS_APP_KEY`
- `KIS_APP_SECRET`
- `DART_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AUTH_SESSION_SECRET`

운영 Google OAuth 리디렉션 URI:

```text
https://stockpilot.coders.kr/api/auth/google/callback
```

## 주의사항

- StockPilot은 모의투자 서비스이며 실제 주문을 전송하지 않습니다.
- 화면의 시세는 제공처의 정책, 장 운영 시간, 네트워크 상황에 따라 지연될 수 있습니다.
- 수수료와 세금은 실제 과세 판단이 아닌 모의투자용 설정값이며 운영 환경변수로 조정할 수 있습니다.
- 이 프로젝트와 화면의 정보는 투자 권유나 투자 자문이 아닙니다.
- 실서비스 운영 전에는 사용 중인 시세 API의 이용약관과 재배포 정책을 반드시 확인하세요.
