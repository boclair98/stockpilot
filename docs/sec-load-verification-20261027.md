# SEC 미국 공시 · 격리 부하 시험 (2026-10-27)

## 범위와 상태

코더스 웹의 미국 종목 상세 → 공시 API → SEC 제출 이력 흐름을 보완합니다. 화면·인증·계좌·주문 규칙·DB 스키마·앱인토스 번들은 변경하지 않습니다.

- 사용자 승인된 운영 연락처를 `SEC_USER_AGENT`로 코더스 서버 비밀 설정에 저장했습니다. 실제 값은 이 문서에 기록하지 않습니다.
- 로컬 서비스에서 실제 SEC 응답으로 `AAPL`(Apple), `MSFT`(Microsoft), `BRK/B`(Berkshire)를 조회해 각각 8건의 제출 이력과 실제 기업 CIK를 확인했습니다. 확인 시각은 2026-10-27 11:05 UTC입니다.
- 최초 로컬 시험 후, 2026-10-27 사용자가 미국 공시 보완의 GitHub 반영·코더스 웹 재배포를 승인했습니다. **비밀 설정 저장만으로 현재 실행 중인 서버에 적용된 것은 아닙니다.** upstream→실제 fork 동기화→기존 프로젝트 배포→`ready`→운영 API·브라우저 순서로 확인하며, 해당 배포의 식별자·커밋·화면 증거는 별도 완료 보고에 기록합니다.
- 사용자는 우선 로컬 시험·재현 도구 준비까지 선택했습니다. 별도 시험 서버를 만들거나 비용을 지출하지 않았으며 운영 서버에 대량 요청을 보내지 않았습니다.

## 공시 보호 장치

| 조건 | 처리 |
|---|---|
| 같은 기업 동시 조회 | CIK 공유 캐시·조회 lease·프로세스 내 single-flight |
| 캐시 만료 | 종목 목록 24시간, 기업 제출 이력 15분, 공유 자료 앞단 캐시 최대 30초 |
| 많은 서로 다른 기업 조회 | 전체 replica의 SEC 요청 시작을 500ms 간격으로 제한; 제한 대기는 3초 이내 |
| Redis 설정 후 장애 | 외부 요청의 프로세스별 우회 금지; 유효한 기존 캐시만 사용 가능 |
| SEC 403/429 | 최소 60초 + `Retry-After` delta/HTTP-date 준수, 해당 요청 재시도 없음 |
| 긴 작업/대기 | 캐시 작업별 최대 12초, 공유 cache lease 30초, HTTP timeout 8초 |
| 알 수 없는 티커 | 없는 기업으로 표시; 임의 기업·공시 생성 안 함; 잠금·캐시 무한 증가 방지 |
| 종류주 별칭 | SEC 목록에 존재하는 `BRK-B`로 기업만 해석하고 응답의 `BRK/B`는 보존 |
| 손상된 SEC 행 | CIK·accession·제출일·문서 경로 검증, 경로 인코딩, 정정 제출 포함 |
| 미설정/오류 | `no-store`, 오류 재조회 안내와 `Retry-After`; 실패를 정상 빈 공시로 캐시하지 않음 |

SEC가 제공한 회사별 최근 제출 중 8-K/10-K/10-Q/20-F/40-F/6-K와 정정 제출을 최대 8건 표시합니다. 전체 과거 문서 보관함·미국 재무제표 수치 확장을 구현했다는 의미가 아닙니다.

## 자동 회귀와 장애 시험

최종 로컬 실행: backend 단위 회귀 **240개 통과**, 변경 파일 Ruff 통과, Python 컴파일 검사 통과. 기존 Firebase 어댑터의 SDK deprecation warning 3건은 남아 있으며 이번 공시 경로의 오류가 아닙니다. fixture가 실제 KIS·DART·OAuth·Firebase·토스 개인 키 설정을 사용하지 않는 것도 별도 확인했습니다. `backend/.dockerignore`는 시크릿 파일·로컬 DB·테스트·부하 fixture를 운영 이미지에서 제외합니다.

운영 DB를 초기화할 수 있는 `backend/tests/conftest.py` 기반 테스트는 이 작업에서 실행하지 않습니다. 아래는 외부 네트워크/DB 없이 실행하는 `unit_tests`입니다.

```powershell
cd backend
.venv/Scripts/python.exe -m pytest unit_tests -q -p no:cacheprovider
.venv/Scripts/python.exe -m ruff check app/core/traffic.py app/routes/company.py app/services/sec_company.py scripts/load_capacity.py scripts/load_fixture.py scripts/load_smoke.py unit_tests/test_sec_company.py unit_tests/test_load_capacity.py
```

공시 신규 시험: 미설정 시 외부 호출 없음, 동시 200건이 directory 1회 + issuer 1회로 합쳐짐, 미확인 티커 2,000개에서 map 증가 없음, cache 256개 상한, 잘못된 기업 CIK 차단, 429 후 호출 중단, Redis 미연결 시 fail-closed, 공유 조정기 대역을 사용하는 4개 서비스의 동일 CIK 조회 합치기, HTTP-date 대기, 응답 캐시 정책.

공유 Redis 경로의 자동 시험은 메모리 조정기 대역을 사용합니다. **실제 Redis Lua·네트워크 장애·PostgreSQL 동시성 검증을 대신하지 않습니다.**

## 로컬 네트워크 부하 시험

실제 FastAPI 미국 공시 router + SEC 파서/프로세스 캐시를 사용합니다. SEC upstream은 명시적인 합성 자료이며 PostgreSQL·Redis·로그인·주문·WebSocket·프런트/CDN은 포함하지 않습니다. 시험 서버는 loopback에만 bind하고 쓰기/국내 DART 경로는 차단합니다. 운영 앱에는 fixture route를 등록하지 않습니다.

환경: Windows 11, Python 3.12.14, httpx 0.28.1, Uvicorn 0.54.0, 논리 CPU 16개, RAM 약 16GB. 생성기와 API가 같은 PC에서 별도 프로세스로 실행됩니다. API worker 1개, 3개 기업 캐시 warm 상태, 최대 in-flight 100개, 단계당 15초입니다. 짧은 lab 시험으로 장시간 안정성을 인증하지 않습니다.

터미널 1:

```powershell
cd backend
$env:STOCKPILOT_LOAD_FIXTURE='1'
.venv/Scripts/python.exe scripts/load_fixture.py
```

터미널 2:

```powershell
cd backend
.venv/Scripts/python.exe scripts/load_capacity.py --rates 25,50,100,200,400 --seconds 15 --concurrency 100 --output ../artifacts/load-sec-local.json
```

`load_smoke.py`는 동일한 플래그의 안전 실행기로 교체했습니다. 과거 운영 URL/총 요청 수/병렬 수 positional 명령은 더 이상 사용하지 않습니다. HTTP 클라이언트의 자동 재시도·리디렉션·프록시 환경변수 사용은 끕니다. 목표 스케줄에 늦거나 slot이 가득 차면 무한 큐를 만들지 않고 생성기 누락으로 집계합니다.

| 목표 RPS | 예정/실제 완료 | 생성기 누락 | 실제 완료 RPS | p95 | p99 | HTTP 실패 | 판정 |
|---:|---:|---:|---:|---:|---:|---:|---|
| 25 | 375 / 375 | 0 | 25.02 | 25.41ms | 28.23ms | 0 | 통과 |
| 50 | 750 / 750 | 0 | 49.96 | 56.36ms | 66.90ms | 0 | 통과 |
| 100 | 1,500 / 780 | 720 | 51.62 | 228.85ms | 337.47ms | 0 | 목표량 생성 실패, 중단 |

총 1,905건의 실제 요청은 모두 HTTP 200과 기업 식별·본문 검증을 통과했습니다. 그러나 100 RPS 단계에서 720건은 생성되지 않았으므로 **전체 계획 통과가 아니며 200·400 RPS 단계는 실행하지 않았습니다.** 이 결과는 서버가 최대 50 RPS라는 의미도 아닙니다. Windows 동일 호스트 생성기/실행 환경의 목표 미달을 분리해서 재측정해야 합니다. 합격 기준은 p95 ≤500ms, 오류 ≤1%, 생성기 누락 0이며 실패 단계에서 상향을 중지합니다. 응답 오류가 50건 이상 표본에서 5%를 넘으면 단계 도중에도 중지합니다.

시험 전후 합성 upstream 횟수는 동일한 4회(directory 1 + issuer 3), cache 4개, 남은 잠금 0개였습니다. 실제 SEC·KIS에는 **0건의 부하 요청**을 보냈습니다. 앞의 실제 SEC 연결 probe는 소량의 별도 기능 검증입니다.

원본 JSON은 로컬 `work/stockpilot-design-20261027/load-sec-local-20261027.json`에 보관했습니다. 생성 보고서는 저장소에 커밋하지 않습니다.

## 실제 서비스 수용량 시험에 추가로 필요한 것

1. 운영과 분리된 시험 origin, API replica 수·CPU/RAM, PostgreSQL/Redis 사양과 pool/연결 상한, 시험 가능한 시간·비용 상한.
2. 별도 생성기 호스트(Linux 권장)와 새 합성 사용자/계좌. 운영 DB·로그인 cookie·시크릿 복사 금지. 모든 시세/SEC/KIS는 시험 대역으로 고정하고 실제 외부 API 접속을 차단.
3. 검색·시세·관심·로그인·개인자산·주문/취소·WebSocket의 실제 이용 비율 및 think time. 방문자 4만 명/일과 동시 사용자 4만 명은 다른 목표이며 RPS로 임의 치환하지 않음.
4. CPU·메모리·DB pool 대기·query p95·lock wait·Redis hit/latency·API p95/p99·429/5xx·원장 불변식 계측. 일시 중단 기준과 마지막 정상 배포/복구 기준을 시험 전에 합의.
5. 25→50→100→200→400 RPS 읽기, 동시 연결·주문 경합, Redis/시세 지연 장애, 최소 30분 soak와 복구를 각각 측정. 지금 도구의 합성 공시 읽기 시나리오만으로 이 목록이 검증된 것은 아님.

별도 유료 API 키가 필요한 단계는 아닙니다. 서버 자원/시험 범위가 정해지기 전 실제 대규모 수용량은 **미확인**으로 유지합니다.

## 공식 근거

- [SEC 공개 API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces): submissions 조회에는 인증/API 키 불필요, 서버에서 연결.
- [SEC Developer Resources](https://www.sec.gov/about/developer-resources): 여러 머신을 합친 10 requests/sec 이하, 필요한 자료만 요청.
- [SEC Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data): 식별 가능한 User-Agent와 연락처, 티커 목록 범위와 접근 지침.
- [Coders 현재 API 안내](https://coders.kr/llms.txt): 프로젝트 비밀 환경변수 등록 후 재배포, ready 확인 후 운영 검증.
