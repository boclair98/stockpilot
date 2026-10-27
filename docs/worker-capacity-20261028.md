# 워커 관측과 격리 성능 시험 준비

2026-10-28. 기존 계좌·주문 금액 계산·앱인토스 소스/번들을 변경하지 않습니다. 사용자의 별도 승인을 받아 GitHub 원본·포크 반영 후 기존 웹에 배포합니다. 유료 서버 생성·운영 부하 시험은 포함하지 않습니다.

## 운영 상태를 나누어 보기

읽기 전용 감사 당시 운영 배포는 `ready`였으나, 빌드 기록의 worker `WORKING`은 갱신되지 않은 과거 값이었습니다. 런타임에는 프로세스 기동 기록과 반복된 `/` 404 탐침, KIS 연결 종료 기록이 있었습니다. API의 DB/Redis 준비 응답만으로 모든 워커 작업이 정상이라고 결론 내리지 않았습니다. 작업별 성공 시각이 없었던 관측 공백을 다음과 같이 보완합니다.

| 신호 | 의미 | 보증하지 않는 것 |
|---|---|---|
| worker `/`, `/health/live` | HTTP 프로세스 생존, DB 조회 없음 | 점검 완료·시세 최신성 |
| `/health/ready` | DB SELECT 1·공유 캐시 준비 | 개별 작업 완료·푸시 수신 |
| `worker:heartbeat` | 최근 응답한 워커와 세 점검 task의 실행 상태 | 전체 replica 수·모든 인스턴스 건강 |
| `worker:job:*` | 기존 분산 lease 소유자가 실제 점검을 시작/완료/실패/중단한 기록 | 개별 주문 체결·알림 도착 |
| `/api/operations/workers` | 위 기록을 운영자에게만 제공, `no-store` | 시장 수집기 전부의 정상 동작 인증 |

워커 heartbeat는 10초 간격/45초 TTL, 작업 기록은 600초 TTL입니다. 완료된 점검이 150초 넘게 지연되면 지연으로 구분하며, pulse가 없으면 정상 대신 미확인입니다. 실행 중 점검은 90초 제한이고 오류 종류만 기록합니다. 실패·취소는 성공 시각으로 기록하지 않습니다. 보호주문 점검에도 동일 제한을 적용하며 기존 DB 트랜잭션·분산 잠금을 유지합니다. 관측 읽기/쓰기 실패는 업무 예외로 바꾸지 않습니다.

여러 worker가 있으면 마지막 응답 워커와 전역 lease 점검 기록을 봅니다. 인스턴스별 registry, KIS WebSocket 성공/재연결 지표, 외부 푸시 도착 확인은 아직 별도입니다. Redis가 없는 다중 프로세스 환경에서는 API가 worker의 메모리 기록을 볼 수 없어 미확인일 수 있습니다. 새로운 API 키는 필요하지 않으며 기존 `REDIS_URL`, `OPERATOR_EMAILS`를 사용합니다. 개인 이메일 허용 목록은 공개 문서에 적지 않습니다.

## 첫 단계 PostgreSQL/Redis 시험 구성

`compose.capacity.yaml`은 프로젝트 이름·DB·Redis namespace·network가 별도입니다. runtime network는 `internal: true`, API만 `127.0.0.1:8288`로 게시합니다. 운영 `.env`를 주입하지 않고 인증서·개인 키·실제 시세 API 키를 차단합니다. 시험 전용 Dockerfile/진입 스크립트는 운영 Dockerfile과 별개이며 운영 build context에서도 제외합니다.

| 변수 | 값의 의미 | 운영 사용 |
|---|---|---|
| `STOCKPILOT_CAPACITY_FIXTURE` | `1`일 때만 격리 진입 허용 | 금지 |
| `DATABASE_URL` | Compose 내부 폐기 가능한 `stockpilot_load` DB | 운영 DB 연결 금지 |
| `REDIS_URL` | 시험 Redis DB 15 | 운영 Redis 연결 금지 |
| k6 `BASE_URL` | 내부 `api:8000` 또는 지정된 loopback 시험 origin | 운영 origin 거부 |

루트에서 Docker Engine/Compose가 준비된 **시험 전용** PC/서버에서 실행합니다. Docker 라이선스·회사 정책에 맞는 설치 환경을 선택하세요. 처음 image/build 다운로드에는 네트워크가 필요하나 실행 컨테이너의 외부 접속은 허용하지 않습니다.

```powershell
docker compose -f compose.capacity.yaml config --quiet
docker compose -f compose.capacity.yaml build
docker compose -f compose.capacity.yaml up -d db cache migrate api worker
docker compose -f compose.capacity.yaml ps
docker compose -f compose.capacity.yaml logs --tail 50 migrate api worker
docker compose -f compose.capacity.yaml --profile test run --rm generator
docker compose -f compose.capacity.yaml down
```

API readiness를 통과한 뒤 부하 생성기가 실행됩니다. 진입 manifest도 확인해 격리 대상이 아니면 중단합니다. migration은 새 시험 DB에만 적용합니다. `down`은 시험 volume을 삭제하지 않습니다. 운영 manifest·계좌 DB·앱인토스는 이 명령의 대상이 아닙니다.

시나리오는 `/api/health/ready`의 HTTP·PostgreSQL SELECT 1 및 Redis 기동 상태를 검증합니다. 25→50→100→200→400 목표 RPS, 각 단계 ramp 15초/hold 15초, 최대 VU 200입니다. p95<500ms·HTTP 오류<1%·본문 확인>99%·생성기 누락 0을 문턱으로 삼고 실패 시 중지합니다. **세션·주문·취소·실제 Redis 명령 지연·WebSocket 부하 및 금융 원장 경합을 검증하는 시나리오는 아닙니다.** 같은 PC에서 실행하면 생성기 경합도 함께 측정됩니다. 이 수치를 실사용자 수로 환산하지 마세요.

현재 컨테이너 구성은 정적 구조/격리 조건과 진입 가드를 검사했지만 Docker가 없어 image pull/build·마이그레이션·실제 네트워크 격리·부하 실행은 미검증입니다. 첫 기동 시 위 명령의 결과를 먼저 확인해야 합니다.

## 대규모 시험에 사용자가 준비할 것

1. **목표와 예산:** 4만 명/일인지 동시 접속인지, 동시 WebSocket 수, 평소/최대 요청 비율, 시험 시간 및 비용 상한. 지금은 단계별 한계 측정을 우선합니다.
2. **운영과 분리된 서버:** Docker 실행이 가능한 Linux 시험 서버, PostgreSQL/Redis 전용 인스턴스와 초기 사양, CPU/RAM·replica·DB pool 수. 시작 검증용으로 API/worker/DB/Redis 합계 8GB RAM 정도와 별도 생성기를 고려하되 수용량 보증 사양이 아닙니다.
3. **별도 생성기와 계측:** API와 다른 호스트, CPU·메모리·DB lock/pool 대기·query p95·Redis latency·API p95/p99·429/5xx·누락된 요청을 수집할 수 있는 접근 권한. 운영 token·DB dump·실제 사용자 cookie는 보내지 않습니다.
4. **시험 데이터·부하 모델:** 합성 사용자/계좌만 사용하고 실제 시세·공시는 결정적인 시험 upstream으로 대체합니다. 조회/관심/주문/취소/WS 비율과 중단 기준을 확정한 뒤 해당 시나리오를 추가해야 합니다. 실제 증권·SEC API에 대량 호출하지 않습니다.
5. **Coders 확인:** worker 상시 가동·replica 자원/스케일과 시험 전용 서비스 허용 범위를 플랫폼에 확인합니다. 공개 API 문서에 없는 자원 설정 필드를 임의로 추가하지 않습니다. 생성/비용 동의 후 별도 staging에서 수행합니다.

순서는 첫 단계 연결 시험 → 합성 시세 읽기/검색 → 인증 사용자·주문/취소 경합과 원장 불변식 → WS 연결 → Redis/제공자 장애 → 최소 30분 지속 부하·복구입니다. 도구의 첫 단계만 준비됐다고 이 전체가 통과한 것은 아닙니다. 유료 API 키를 추가 발급할 단계는 아니고 **격리 실행 환경과 시험 범위**가 먼저 필요합니다.

## UI와 출처

현재 StockPilot의 Pretendard·색상·라이트/다크 토큰을 유지하고 공시는 한 표면의 정렬된 행으로 단순화합니다. 미국 제출은 실제 응답의 최대 8건이며 원문 링크와 서식 식별자를 유지합니다. 금융 금액·시세·데이터 권한은 바꾸지 않습니다.

이번 참조 자료: [네이버 증권 공개 웹](https://stock.naver.com/)의 검색/분류 구조(문자 자료), [Toss 증권 공개 웹](https://www.tossinvest.com/)의 목록 정보 구조(문자 자료). Toss 실제 화면은 브라우저 접근 권한 차단으로 이번에 시각 검증하지 못했습니다. 화면·로고·고유 폰트·소스를 복제했다고 주장하지 않습니다. 운영 재확인 버튼은 기존 [Base UI MIT 라이선스](https://github.com/mui/base-ui/blob/master/LICENSE) 컴포넌트를 재사용하며 새 경쟁사 자산을 내려받지 않았습니다.

검증: backend `pytest unit_tests -q -p no:cacheprovider` 261개 통과(Firebase 기존 deprecation warning 3개), 변경 파일 Ruff·ESLint, Next.js 정적 빌드/TypeScript, `verify:safety` 15종과 종목 목록 검사 8개 통과. 워커 권한/시간 초과/취소/손상 기록과 부하 진입 가드 신규 21개, 실제 프론트 컴포넌트 신규 회귀 3개를 포함합니다. Docker 이미지 `grafana/k6:2.3.0` 태그의 레지스트리 존재는 확인했으나 컨테이너 실행을 확인한 것은 아닙니다.

로컬 브라우저에서는 합성 자료임을 표시한 fixture로 워커 정상/미확인/실패/손상 응답/403 및 503 재조회 복구, 공시 8행과 밝은/어두운 배경을 확인했습니다. 화면 검사에서 발견한 워커 하단 설정 버튼의 기록 가림은 상단 배치로 수정하고 공시 링크 hover 대비를 보완했습니다. 360/390/768/1440px에서 가로 넘침을 검사합니다. 브라우저 검증·로컬 테스트는 운영 부하·실기기 앱 테스트와 구분합니다.
