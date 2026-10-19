# OpenUI Design Plan

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
