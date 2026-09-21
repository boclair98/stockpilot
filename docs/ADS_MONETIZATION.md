# StockPilot 광고 수익화 설정

StockPilot은 현재 웹앱을 Android Trusted Web Activity(TWA)에서도 사용하는 구조입니다. 따라서 첫 광고 릴리스는 웹 콘텐츠와 TWA 화면에 공통으로 표시할 수 있는 **반응형 Google AdSense 슬롯**으로 구성했습니다. 실제 Android 네이티브 AdMob 배너를 별도 화면에 띄우려면 TWA 대신 네이티브/하이브리드 Android 셸로 전환하는 추가 작업이 필요합니다.

## 광고 위치

- 홈 시장 브리핑 아래: `home`
- 종목 뉴스·기업정보 아래: `market-news`
- 성장 허브 분석 시작 전: `growth`
- 수익률 리그와 규칙 사이: `league`

주문 티켓, 로그인, 알림 설정, 커뮤니티 글 작성 화면에는 광고를 넣지 않습니다. 광고를 너무 가까이 배치하면 실수 클릭이 발생할 수 있으므로 Google의 [배너 배치 지침](https://support.google.com/admob/answer/6128877?hl=en)을 따릅니다.

## 사용자가 해야 할 일

1. [Google AdSense](https://www.google.com/adsense/)에서 사이트를 추가하고 사이트 검토를 신청합니다.
2. 사이트 검토가 완료되면 게시자 ID(`ca-pub-...`)와 광고 단위 4개의 슬롯 ID를 만듭니다.
3. Coders.kr 운영 환경에 다음 공개 환경변수를 등록합니다.

```env
NEXT_PUBLIC_ADSENSE_CLIENT=ca-pub-xxxxxxxxxxxxxxxx
NEXT_PUBLIC_ADSENSE_HOME_SLOT=xxxxxxxxxx
NEXT_PUBLIC_ADSENSE_NEWS_SLOT=xxxxxxxxxx
NEXT_PUBLIC_ADSENSE_GROWTH_SLOT=xxxxxxxxxx
NEXT_PUBLIC_ADSENSE_LEAGUE_SLOT=xxxxxxxxxx
```

값을 비워 둔 배포에서는 광고 영역 자체가 렌더링되지 않습니다. 따라서 검토 전 사이트 화면이 깨지지 않습니다.

## Android AdMob을 원하는 경우

AdMob 앱 ID와 광고 단위 ID는 계정 소유자인 운영자가 발급해야 합니다. ID를 코드에 하드코딩하지 않고 별도 Secret/빌드 변수로 주입해야 하며, 개발 중에는 반드시 Google 테스트 광고를 사용합니다. AdMob 신규 앱은 앱 소유권 확인(`app-ads.txt`)과 앱 준비성 검토 후 광고가 정상적으로 노출됩니다.

```text
AdMob App ID: ca-app-pub-...~...
Banner Ad Unit ID: ca-app-pub-.../...
Publisher ID: pub-...
```

현재 TWA는 Chrome Custom Tab이 화면을 소유하므로 네이티브 `AdView`를 웹 화면 위에 바로 덧씌울 수 없습니다. 네이티브 AdMob을 꼭 사용해야 하면 Android 셸을 Capacitor 또는 커스텀 Activity로 전환하고 Google 로그인·Digital Asset Links를 실기기에서 다시 검증해야 합니다. 웹 광고로 먼저 수익화를 검증한 뒤 트래픽이 확인되면 이 전환을 권장합니다.

## 운영 체크리스트

- 개발 중에는 테스트 광고만 사용하고 본인 광고를 클릭하지 않습니다.
- 광고는 주문·로그인·입력 버튼 옆에 배치하지 않습니다.
- 개인정보처리방침에 광고·쿠키·관심기반 광고 사용 여부를 반영합니다.
- EEA/영국/스위스 이용자가 생기면 Google 동의 관리 플랫폼(UMP) 흐름을 추가합니다.
- `app-ads.txt` 또는 `ads.txt`는 AdMob/AdSense에서 안내한 도메인 루트에 게시합니다.
- 광고 수익은 방문자 수, 세션 길이, 국가, 광고 수요에 따라 달라지며 보장되지 않습니다.
