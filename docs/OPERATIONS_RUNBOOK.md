# StockPilot 운영 런북

실제 거래가 아닌 모의투자 서비스라도 사용자 자산·로그인·순위 데이터가
쌓이므로, 배포 전에 아래 운영 기준을 적용합니다.

## 배포 전 체크

- `DATABASE_URL`, `REDIS_URL`, `AUTH_SESSION_SECRET`는 플랫폼 시크릿으로만
  주입합니다. 저장소와 이미지에 값을 넣지 않습니다.
- production의 `RUN_MIGRATIONS_ON_BOOT`는 `false`로 유지합니다. 새 revision을
  배포할 때는 API rollout 전에 one-shot 컨테이너(또는 안전한 운영 셸)에서
  `uv run alembic upgrade head`를 한 번 실행하고, 완료 후 API·worker를
  재배포합니다. 개발 환경에서만 `true`를 임시로 사용할 수 있습니다.
- `worker` 서비스는 시세 수집·목표가 알림·보호주문 매처를 담당합니다. API
  replica에는 `RUN_BACKGROUND_WORKERS=false`를 적용해 요청 처리와 장시간
  polling이 서로 자원을 빼앗지 않게 합니다. Redis lease가 worker 중복 실행을
  방지하므로 worker replica를 늘리기 전 Redis 상태를 먼저 확인합니다.
- `ENABLE_API_DOCS=false`를 유지합니다. 내부 점검이 필요할 때만 일시적으로
  켜고, 외부에 `/api/docs`를 공개한 채 운영하지 않습니다.
- Redis는 시세 수집 리더 선출, 백그라운드 알림·보호주문 단일 실행, 전역 요청
  제한 및 캐시에 사용됩니다. Redis가 지속적으로 장애인 상태면 다중 replica
  운영을 중지하고 복구 후 트래픽을 다시 엽니다.

## 확장 규칙

- API replica를 늘려도 KIS WebSocket 수집기는 `market:collector` lease를
  가진 한 인스턴스만 실행합니다. 나머지 인스턴스는 Redis snapshot을 읽습니다.
- `/api/trading/ws`는 사용자/IP별 동시 연결 슬롯을 사용합니다. `1013`으로
  거절된 클라이언트는 지수 백오프로 재시도하고, 탭이 백그라운드가 되면 소켓을
  닫아 불필요한 연결을 유지하지 않습니다.
- 목표가 알림과 익절·손절 보호주문 매처도 각각 전역 lease를 사용합니다. lease
  TTL보다 오래 걸리는 작업이 반복되면 `poll_once` 배치 크기와 외부 API 지연을
  먼저 점검합니다.
- `KIS_REST_CALLS_PER_SECOND`는 KIS 계약 한도 이하로 설정합니다. 기본값 1은
  안전한 보수값이며, 상향 시 KIS 응답코드·429 비율을 함께 모니터링합니다.
- 배포 시 Alembic `0012_scale_hot_paths`가 주문·알림·보호주문 복합 인덱스를
  추가합니다. 대량 데이터베이스에서는 migration 전 백업과 인덱스 생성 시간을
  확인하고, 완료 후 `GET /api/health/ready`가 정상인지 검증합니다.
- `MAX_REQUEST_BODY_BYTES`(기본 64KB)는 현재 JSON 명령 계약에 맞춘 보호 한도입니다.
  파일 업로드 같은 기능을 추가할 때는 전역 한도를 무작정 키우지 말고 별도
  업로드 경로와 저장소 정책을 설계합니다.
- `MARKET_DATA_REQUEST_TIMEOUT_SECONDS`(기본 8초)는 KIS REST 지연이 API worker를
  붙잡지 않도록 하는 상한입니다. 503 비율이 높아지면 값을 무작정 늘리기보다
  KIS 응답·rate limit·WebSocket 연결 상태를 먼저 점검합니다.
- `/api/trading/quote`가 503을 반환하면 `Retry-After: 5`를 따릅니다. 클라이언트가
  즉시 무한 재시도하지 않도록 지수 백오프를 적용하고, 오래된 시세를 주문가로
  사용하지 않습니다.

## 데이터 보호 및 복구

- PostgreSQL은 최소 일 1회 백업, 가능하면 PITR(시점 복구)을 켭니다.
- 백업 복구 리허설을 월 1회 수행하고, `users`, `trading_accounts`,
  `trade_orders`, `positions`, `league_entries`의 복구 여부를 확인합니다.
- 운영 로그에는 access token, OAuth code, Firebase service account, KIS 키,
  세션 쿠키 원문을 남기지 않습니다. 유출이 의심되면 해당 시크릿을 즉시
  폐기·재발급하고 세션 시크릿을 교체합니다.

## 장애 대응 순서

1. `/api/health`로 API·DB·Redis 상태와 request id를 확인합니다.
2. `/api/health/traffic`은 operator 계정으로만 조회해 rate-limit/cache 상태를
   확인합니다.
3. KIS 장애 시 모의 주문을 일시 중지하고 Redis snapshot·마지막 시세 시각을
   기준으로 사용자에게 지연 상태를 표시합니다. 오래된 시세로 체결하지
   않습니다.
4. 배포 직후 migration 오류가 나면 새 replica를 늘리지 말고 one-shot migration
   로그와 advisory lock 보유 세션을 확인합니다. API/worker가 `503`이면
   `/api/health/ready`와 worker의 `/health/ready`를 각각 확인합니다.

## 부하 테스트 권장 시나리오

- 읽기 트래픽 100~300 RPS에서 `/api/trading/bootstrap`, `/api/trading/quotes`
  의 p95와 Redis hit rate를 측정합니다.
- 동일 계정으로 동시에 주문·보호주문·알림을 발생시켜 중복 체결/음수 잔고가
  없는지 확인합니다.
- KIS REST/WebSocket을 강제로 지연·끊김 처리해 stale quote 차단과 자동 재연결을
  검증합니다.
- WebSocket 동시 연결을 사용자/IP별 한도 이상으로 열어 `1013` 거절과 브라우저
  backoff가 동작하는지 확인합니다. 탭을 숨겼다가 다시 열었을 때 연결이 한 개로
  수렴해야 합니다.


