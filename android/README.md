# StockPilot Android 출시 가이드

StockPilot은 웹과 안드로이드에서 같은 기능을 유지하기 위해 **Trusted Web Activity(TWA)** 방식으로 패키징합니다. 일반 WebView와 달리 Chrome의 최신 웹 런타임, Google 로그인 세션, 서비스 워커를 그대로 사용하며 앱과 웹의 소유 관계는 Digital Asset Links로 검증합니다.

## 고정 값

| 항목 | 값 |
| --- | --- |
| 앱 이름 | StockPilot |
| Android package ID | `kr.coders.stockpilot` |
| 운영 origin | `https://stockpilot.coders.kr` |
| Web Manifest | `https://stockpilot.coders.kr/manifest.webmanifest` |
| 시작 경로 | `/?source=twa` |

## 1. Android 프로젝트 생성

Node.js가 설치된 환경에서 공식 Bubblewrap CLI를 사용합니다.

```bash
npm install --global @bubblewrap/cli
bubblewrap init --manifest=https://stockpilot.coders.kr/manifest.webmanifest
```

초기화 질문에는 위 표의 package ID와 운영 origin을 사용합니다. 서명 키(`.jks`)와 비밀번호는 Git에 올리지 말고 비밀번호 관리자와 별도 백업 저장소에 보관합니다.

```bash
bubblewrap build
```

Google Play에는 생성된 Android App Bundle(`.aab`)을 업로드합니다. 실제 기기 사전 확인은 USB 디버깅을 켠 기기에서 `bubblewrap install`로 수행할 수 있습니다.

## 2. 전체화면 검증 연결

Play Console의 **앱 무결성 → 앱 서명 키 인증서**에서 SHA-256 지문을 복사합니다. `assetlinks.template.json`의 자리표시자를 실제 지문으로 바꾼 후 아래 경로에만 배치합니다.

```text
frontend/public/.well-known/assetlinks.json
```

배포 후 `https://stockpilot.coders.kr/.well-known/assetlinks.json`이 인증 없이 JSON으로 열려야 합니다.

Play App Signing의 앱 서명 지문과 로컬 설치용 업로드 키 지문이 다를 수 있습니다. 둘 다 테스트하려면 `sha256_cert_fingerprints` 배열에 두 지문을 넣습니다. 실제 지문을 받기 전에는 잘못된 소유 관계를 공개하지 않기 위해 `assetlinks.json`을 배포하지 않습니다.

## 3. Google 로그인 확인

Google Cloud OAuth 클라이언트의 승인된 리디렉션 URI에 다음 주소를 유지합니다.

```text
https://stockpilot.coders.kr/api/auth/google/callback
```

앱에서 로그인 → Google 계정 선택 → StockPilot 복귀 → 새로고침 후에도 로그인 유지 순서로 실제 기기에서 점검합니다.

## 4. Play Console 제출 전 체크

- 개인정보처리방침: `https://stockpilot.coders.kr/privacy`
- 이용약관: `https://stockpilot.coders.kr/terms`
- “실거래가 아닌 가상투자·교육 서비스” 문구가 스토어 설명과 앱 화면에 모두 표시되는지 확인
- 360×800, 390×844, 태블릿, 회전 화면에서 잘림과 가로 스크롤 확인
- 네트워크 끊김, 서버 오류, Google 로그인 취소, 중복 주문 탭, 보유 수량 초과 매도 확인
- 앱 아이콘, 알림 아이콘, 스플래시 화면, 알림 권한 요청 시점을 실제 기기에서 확인
- 내부 테스트 트랙에서 최소 한 차례 설치·업데이트·삭제 후 재설치 확인

## 아직 사용자 작업이 필요한 항목

앱 서명 키와 Play Console 앱 서명 SHA-256 지문은 계정 소유자만 만들거나 확인할 수 있습니다. 이 값이 준비되면 Digital Asset Links 배포와 TWA 전체화면 검증을 마칠 수 있습니다.
