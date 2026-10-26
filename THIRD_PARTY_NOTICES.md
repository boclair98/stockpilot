# 추가 차트 구성요소의 오픈소스 안내

StockPilot 웹의 선택적 확대 차트에 다음 라이브러리를 사용합니다. 기존 의존성의 각 라이선스는 해당 패키지의 고지를 따릅니다. 타사 증권 서비스의 화면·브랜드·독점 폰트·시세 데이터를 복사하지 않습니다.

| 라이브러리 | 버전 | 라이선스 | 원문 / 배포 고지 |
| --- | --- | --- | --- |
| [TradingView Lightweight Charts™](https://github.com/tradingview/lightweight-charts) | 5.2.1 | Apache-2.0 | [NOTICE와 LICENSE](frontend/public/licenses/lightweight-charts.txt) |
| [fancy-canvas](https://github.com/tradingview/fancy-canvas) | 2.1.0 | MIT | [저작권·허가문](frontend/public/licenses/fancy-canvas.txt) |

Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/

확대 차트는 TradingView 고지 로고와 `Charts by TradingView` 링크를 유지합니다. StockPilot의 기존 서버가 제공한 일별 시세를 표시하며 TradingView 시세나 위젯 서비스를 사용하는 것은 아닙니다. 라이브러리는 확대 화면을 열 때 지연 로드합니다. 기본 SVG 차트와 데이터 표는 별도로 유지합니다.

디자인 연구는 SEED의 공개 색상 역할 문서와 Lightweight Charts의 공식 예제를 참고했습니다. TossInvest 공개 페이지의 정보 구조는 텍스트로 확인했으며, 로그인된 토스증권 제품이나 네이티브 앱을 시각 검증했다고 주장하지 않습니다. 공개 문서의 설계 원칙을 참고한 것이며 타사 자산을 재배포하지 않습니다.
