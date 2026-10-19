# 구현 및 검증 결과

## 2026-10-16 정식 빌드 — 202610161146

main의 다국어 구현을 `npm run build:release`로 빌드했습니다. 게시 중 추가된 `PRIVACY.md`를 그대로 보존했으며 실행 소스가 검증 기준과 같음을 확인했습니다. 사용자가 정한 배포 규칙에 따라 개발용 `202610160117`과 정식 배포용 `202610161146` ZIP을 각각 한 개씩 유지합니다.

- 정식 빌드의 MV3·권한·외부 목적지·영어/한국어 카탈로그 정적 감사를 통과했습니다. 실제 축소된 팝업·content 파일을 합성 DOM과 Chrome API로 실행해 카드 3개·표시줄 정상, 진단 UI 없음, 진단 요청 응답 0을 확인했습니다. 실제 로그인 세션·네이티브 Chrome 설치 검증은 별도입니다.
- 정식 ZIP은 **88,697 bytes**, SHA-256 `714fd22dfa7a6871ef34918d64da82251bbc834b9cbb9d156ece25a64ade82a6`입니다. 루트 manifest와 런타임 파일 12개로 구성하며 docs·INSTALL·상위 폴더가 없습니다. 모든 파일이 검증한 dist와 바이트 단위로 일치하고 GitHub 다운로드 HTTP 200 및 원본 바이트 일치도 확인했습니다.
- 개발용 ZIP은 이전에 검증한 원본 바이트와 버전을 그대로 사용합니다. README에서 두 빌드를 구분하고 이후 교체는 같은 종류의 이전 ZIP에만 적용합니다.

## 2026-10-16 언어 선택과 설정 자동 저장 — 202610160117

영어·한국어 UI에 `시스템 기본 언어 / 영어 / 한국어` 선택을 추가하고 설정 저장 버튼을 제거했습니다. 검증한 설치 ZIP은 `main/downloads`에 게시되어 있으며 소스·명세 변경은 `feat/english-korean-ui` 브랜치에서 검토합니다.

- `Settings.language`의 `system`·`en`·`ko`만 저장하며 이전 설정의 누락·손상 값은 `system`으로 복구합니다. 시스템 기본은 Chrome UI 언어가 한국어이면 한국어, 나머지는 영어입니다. 수동 선택은 확장에 포함된 두 카탈로그를 사용하며 각 카탈로그에는 112개 메시지가 있습니다.
- 체크박스·언어 선택은 변경 즉시, 임계치는 입력 완료 또는 Enter 때 검증 후 저장합니다. 저장 중 연속 변경을 반영하고 실패 시 입력 초안을 유지합니다. 잘못된 임계치는 저장하지 않으며 다른 설정은 마지막 유효 임계치와 함께 저장할 수 있습니다. 자동 검증은 포커스를 강제로 옮기지 않아 Tab으로 다음 칸에 이동하여 잘못된 값을 고칠 수 있습니다. 수정 중인 필드만 보존하므로 다른 창에서 변경한 언어·미편집 필드를 이전 값으로 덮어쓰지 않습니다.
- 기존 설정 저장·탭 알림을 재사용하여 팝업·열린 표시줄·배지 제목·오류·접근성 문구에 반영합니다. 설정 변경은 사용량 API를 호출하지 않으며 수집·스냅샷·요금제·티켓·캐시·권한·추가 의존성·타이머를 변경하지 않습니다. 언어 변경만으로 표시줄 노드나 동적 게이지를 다시 만들지 않습니다.

주요 변경 파일:

| 구분 | 파일 |
| --- | --- |
| 설정·저장·계약 | `src/shared/{types,contracts}.ts`, `src/storage/settings.ts`, `src/background/index.ts` |
| 언어 적용·자동 저장 UI | `src/shared/{i18n,errors}.ts`, `src/popup/{index,render}.ts`, `src/popup/popup.{html,css}`, `src/content/usage-strip.ts`, `src/background/badge.ts`, `_locales/{en,ko}/messages.json` |
| 검증 | `tests/{popup-language,gauge-settings,popup-compact,activation,contracts-ui,storage-migration,i18n,i18n-presentation}.test.ts`, `scripts/browser-fixture.mjs`, `scripts/browser-fixture/{fixture-data,popup-checks,i18n-checks,preference-checks}.mjs` |
| 문서 | `AGENTS.md`, `AI_GAUGE_SPEC.md`, `README.md`, `docs/{installation,validation}.md` |

검증 결과:

- `npm run check`: **551개 통과**, 실패·취소·스킵 0. 타입 검사·개발 빌드·MV3 감사 통과. 정식 빌드와 두 카탈로그를 포함한 ZIP 검사도 통과했습니다.
- 언어 선택·시스템 복귀·팝업 재열기·워커 재시작·이전 설정 마이그레이션, 열린 화면의 문구·접근성 갱신, 저장 실패·빠른 연속 변경·잘못된 숫자 초안과 독립 설정 저장, 외부 변경 덮어쓰기 방지를 검증했습니다. 설정 변경으로 추가 수집이나 스냅샷 변경이 생기지 않았습니다.
- 같은 **202610160117** 빌드의 `node scripts/browser-fixture.mjs` 통과. 실제 Chromium 키 입력으로 잘못된 임계치 입력 후 Tab 이동·다음 값 수정·자동 저장과 Enter 저장을 확인했습니다. 영어·한국어·시스템 복귀, 기존 표시줄 노드·게이지 유지, 600/390/320px 넘침 없음, 세 서비스·Codex·사용량·요금제·티켓·권한·76회 표시줄 안정성 회귀를 통과했습니다. 영어 팝업 스크린샷도 확인했습니다.
- [개발 빌드 ZIP 202610160117](https://github.com/han41858/ai-gauge/raw/refs/heads/main/downloads/ai-gauge-202610160117.zip): **101,382 bytes**, SHA-256 `bbb99298f9a913ef56d681f9c9a9b2bc236f026b0e645edbff90a9edd80fc673`. GitHub HTTP 200과 원본 바이트 일치를 확인했습니다. 루트 manifest·실행 파일·아이콘·두 카탈로그 총 12개이며 docs·INSTALL·상위 폴더는 없습니다. 진단 UI가 있는 개발용 산출물입니다.
- **미검증:** 네이티브 Chrome 확장 설치 후 언어 선택·시스템 언어 변경 동작, 로그인한 실제 서비스의 표시줄 전환. Chromium 검증은 합성 DOM과 모의 Chrome API를 사용했으며 실계정 API 검증을 대신하지 않습니다.

## 2026-10-16 영어·한국어 UI — 202610160042 (로컬)

main `1421336`의 입력창 상대 시간 변경을 기준으로 최초 다국어 UI를 검증한 기록입니다. 이후 추가한 언어 선택·자동 저장과 최신 설치 파일의 검증 결과는 위 절을 참고합니다.

- Chrome UI 언어가 `ko`/`ko-KR`이면 한국어, 나머지는 영어입니다. 영어 기본 Manifest와 `_locales/en/messages.json`·`ko/messages.json`의 109개 메시지를 사용합니다. 페이지 언어·navigator 언어·계정·서비스 설정을 언어 판단에 사용하지 않습니다.
- 입력창은 영어 `🕒 Resets in 4 hours`, `🎫 Ticket expires in 2 days`와 한국어의 기존 콜론 형식을 제공합니다. 가장 큰 단위 내림·영어 단복수·`in less than a minute`·초기화 경과·티켓 전환 정책을 유지합니다.
- 팝업·온보딩·설정·진단·오류·배지 제목·접근성·확장 설명을 번역합니다. 팝업의 정확한 날짜·시각·개별 티켓 만료와 수량을 유지하고 현지 요일만 언어에 맞춥니다. 기존 캐시의 앱 생성 기간 이름은 화면에서 번역하며 원본 데이터·요금제·모델 이름은 보존합니다. 미확인 요금제의 내부 반환값만 `null`로 바꿔 번역 문자열을 조건 판단에 사용하지 않습니다.
- 수집 API·자동 갱신·캐시·권한·저장 형식·동적 게이지·진행 막대·배치·추가 의존성은 변경하지 않았습니다. 언어 설정이나 원격 번역·언어 정보 저장/전송을 추가하지 않았습니다. 기존 15초 타이머와 30px/12px/20px 규격을 유지합니다.

주요 변경 파일:

| 구분 | 파일 |
| --- | --- |
| 카탈로그·공통 표현 | `_locales/{en,ko}/messages.json`, `src/shared/{i18n,limit-label,format,errors,ticket-presentation,plan}.ts` |
| UI | `src/popup/{index,render,diagnostics}.ts`, `src/popup/popup.html`, `src/content/usage-strip.ts`, `src/background/badge.ts` |
| 빌드·패키징 | `manifest.json`, `scripts/{build,package,audit-build}.mjs`, `tsconfig.json` |
| 검증 | `tests/i18n.test.ts`, `tests/i18n-presentation.test.ts`, `tests/{distribution,plan-cache}.test.ts`, `tests/helpers/{bundle.ts,i18n-loader.mjs}`, `scripts/i18n-fixture.mjs`, `scripts/browser-fixture.mjs`, `scripts/browser-fixture/i18n-checks.mjs`, `package.json` |
| 문서 | `AI_GAUGE_SPEC.md`, `AGENTS.md`, `README.md`, `docs/{installation,reset-tickets,validation}.md` |

검증 결과:

- `npm run check`: **540개 통과**, 실패·취소·스킵 0. 타입 검사·개발 빌드·MV3 산출물 검사 통과. 배포 테스트에서 정식 빌드와 카탈로그가 포함된 ZIP도 검증했습니다.
- 기존 한국어 회귀 테스트는 실제 카탈로그를 사용하는 모의 Chrome i18n API로 실행합니다. 별도 VM에서 영어·한국어·다른 언어의 fallback, 시간 경계·단복수, 티켓·요금제·모델명 보존, 기존 데이터 무변경, 영어 기본 대체 및 안전한 치환·DOM 삽입을 검증했습니다.
- 같은 **202610160042** 빌드의 `node scripts/browser-fixture.mjs` 통과. Chromium 합성 DOM에서 `en`·`ko-KR`·`fr`·`ja` 문맥별 팝업·온보딩·설정·표시줄을 검증했고, 영어 팝업·표시줄의 600/390/320px 가로 넘침 없음과 기존 규격을 확인했습니다. ChatGPT/Codex 공유·Claude/Gemini·티켓 자동 만료·권한·게이지·76회 안정성 검사도 통과했습니다. 영어 팝업 스크린샷을 직접 확인했습니다.
- 로컬 ZIP `/workspace/artifacts/ai-gauge-202610160042.zip`: **93,405 bytes**, SHA-256 `b2587a39f09ba9d2d275bb8fa866dd8cf010144c2032f4b439e6b0a57b166e95`. 루트 manifest·실행 파일·아이콘·두 번역 카탈로그 총 12개이며 검증한 dist와 바이트가 같습니다. docs·INSTALL·상위 폴더는 없습니다.
- **미검증:** 실제 확장 설치에서 Chrome 기본 i18n의 로케일 선택·치환, Chrome UI 언어 변경 후 재시작, 로그인한 각 서비스 화면의 새 문구·공식 관리 링크. Chromium 검증은 실제 번역 카탈로그와 모의 `chrome.i18n`을 사용했으며 네이티브 확장 설치·실계정 API 검증을 대신하지 않습니다.

## 2026-10-15 입력창 초기화·티켓 만료 한국어 상대 시간 — 202610151456

최신 main `ee6a3bb`를 기준으로 입력창 표시만 변경했습니다. `🕒 초기화: 4시간 후`, `🎫 티켓 만료: 2일 후`처럼 공통 포맷터로 가장 큰 단위 하나를 내림합니다. 1분 미만은 `1분 미만`이며, 초기화 경과 상태는 기존 정책을 유지합니다.

- 입력창 티켓은 기존 선택 로직에서 만료가 확인된 유효 티켓의 가장 빠른 만료 하나만 사용합니다. 수량·다른 날짜는 툴팁과 접근성 설명에도 넣지 않습니다. 만료 미확인·수집 실패·정보 불확실·모두 만료 상태는 숨기며 공식 관리 링크와 키보드 접근성은 유지합니다.
- 팝업의 정확한 초기화 날짜·시각, 개별 티켓 만료·수량·상세 정보는 유지합니다. ChatGPT 티켓 상세 조회 첫 실패의 캐시와 팝업 유예 정책도 유지하되 입력창 티켓은 첫 실패부터 숨깁니다. 사용량 초기화만 경과한 경우에는 유효 티켓을 유지하고, 실패가 `reset_pending`에 가려진 경우에는 실패 횟수로 차단합니다.
- 수집·캐시·정규화·요금제·의존성·타이머를 변경하지 않았습니다. 기존 15초 표시 타이머로 다음 유효 티켓으로 전환하고 모두 만료되면 숨깁니다. ChatGPT/Codex 공유 데이터, Gemini 티켓 제외, 30px/12px/20px 규격·막대·동적 게이지·좁은 화면 우선 숨김도 유지합니다.

변경 파일:

| 구분 | 파일 |
| --- | --- |
| 구현 | `src/shared/format.ts`, `src/shared/ticket-presentation.ts`, `src/content/usage-strip.ts` |
| 단위·통합 테스트 | `tests/usage-label.test.ts`, `tests/ticket-ui.test.ts`, `tests/content-clock.test.ts`, `tests/contracts-ui.test.ts`, `tests/shared-plan-display.test.ts`, `tests/usage-strip-progress.test.ts` |
| 브라우저 fixture | `scripts/browser-fixture.mjs`, `scripts/browser-fixture/chatgpt-checks.mjs`, `codex-checks.mjs`, `claude-checks.mjs`, `gemini-checks.mjs` |
| 문서 | `AI_GAUGE_SPEC.md`, `AGENTS.md`, `docs/installation.md`, `docs/reset-tickets.md`, `docs/validation.md` |

검증 결과:

- `npm run check`: **530개 통과**, 실패·취소·스킵 0. 타입 검사·개발 빌드·MV3 산출물 검사 통과. 요청한 7개 시간 예시와 단위 경계 ±1ms, 잘못된 시간, 일·시간·분 내림, 실제 0%·미확인·초기화 경과 및 팝업 날짜 유지 검증을 포함합니다.
- 티켓 1개·복수·가장 빠른 만료·30초·모두 만료·만료 미확인·손상·실패·인증/계정 불확실·공식 링크·ChatGPT/Codex 공유·Gemini 제외를 검증했습니다. 기존 15초 타이머가 링크와 진행 막대 노드를 유지하며 다음 만료로 전환하고 추가 요청이나 원본 데이터 변경을 하지 않는지도 확인했습니다.
- 같은 **202610151456** 빌드로 `node scripts/browser-fixture.mjs` 통과. 실제 Chromium의 합성 DOM에서 한국어 표기, 티켓 자동 전환·실패 시 숨김, 키보드 링크 활성화, 좁은 화면, 네 입력창 위치·중복 방지, 76회 안정성 검사, 팝업·게이지·요금제·권한·저장 갱신 회귀를 확인했습니다. 생성된 표시줄·팝업 스크린샷도 확인했습니다.
- 설치 ZIP은 루트 manifest를 포함한 실행 파일 10개이며 검증한 dist와 바이트가 모두 일치합니다. **84,019 bytes**, SHA-256 `a4d566015873fc99719baa9515a1644c2c977cdf22a9e310ad7ead21947ab8b3`입니다. 설치 파일은 기존 배포 규칙에 따라 최신 한 개를 유지하며, 소스·문서는 별도 브랜치의 PR로 제출하고 main에 병합하지 않습니다.
- GitHub 설치 링크의 HTTP 200과 다운로드 바이트 일치를 확인했습니다. main/downloads에는 `ai-gauge-202610151456.zip` 한 개만 남겼고 README 설치 링크를 갱신했습니다. 이 별도 배포 변경은 소스 PR에 중복 포함하지 않습니다.
- 실제 로그인 Chrome 세션·API 호출은 이번 작업에서 검증하지 않았습니다. 실제 ChatGPT/Codex·Claude·Gemini 화면에서 상대 시간과 좁은 화면 배치, ChatGPT/Claude의 실티켓 만료 전환 및 공식 관리 링크의 로그인 후 도달 화면은 추가 확인이 필요합니다.

## 2026-10-15 1분 미만 표기 수정 — 202610151429

- 입력창에서 60초 미만의 양수 잔여 시간을 `1분 미만`으로 표기합니다. 기존 `1m 미만` 출력과 문서의 `한 분 미만` 표현을 바로잡았습니다. 다른 단위와 시간 계산·갱신 정책은 동일합니다.
- 기존 경계값 테스트의 기대 문구를 수정했고 `npm run check` **523개 통과**, 타입·빌드·MV3 산출물 검사 통과입니다. 이번 문자열 수정에는 Chromium fixture를 다시 실행하지 않았으며 실제 로그인 화면 확인은 미검증입니다.
- 설치 ZIP은 루트 manifest를 포함한 실행 파일 10개이고 dist와 모든 바이트가 같습니다. **84,417 bytes**, SHA-256 `c2cdf5c616c3250b40521c132c91638b484fb1174fd53e69b20080437792b436`입니다. 검증한 수정 소스·명세·테스트를 함께 반영하며, 이미 게시된 설치 ZIP·README 링크는 유지합니다.

## 2026-10-15 입력창 초기화 시간 간소화 — 202610151417

- 입력창 공통 표시줄은 `🕒 사용량 초기화: 4d`처럼 가장 큰 시간 단위 하나만 표시하며 작은 단위는 버립니다. 하루 미만은 `13h`, 한 시간 미만은 `25m`, 1분 미만의 양수 잔여 시간은 `1m 미만`입니다. 초 단위는 표시하지 않습니다. 팝업은 정확한 현지 날짜·요일·시각과 남은 일·시간을 유지합니다.
- `src/shared/format.ts`의 시각 검증·남은 시간 계산을 공유하며 `src/content/usage-label.ts`만 간결한 형식을 선택합니다. 수집·공유 캐시·15초 표시 타이머·초기화 경과·티켓 만료 날짜·30px 표시줄 규격은 유지합니다. 명세·개발 지침·설치 안내를 갱신했습니다.
- `npm run check`: **523개 통과**, 실패·취소·스킵 0. TypeScript 7, 개발 빌드 및 MV3 산출물 검사 통과. 기존 테스트를 수정해 일·시간·분 전환 경계의 직전/정확/직후, 1분 미만·시간대 불변·초기화 경과와 팝업 현지 시각 유지를 검증했습니다.
- 동일 **202610151417** 빌드의 Chromium fixture 통과. 한 시간 미만의 입력창 표시는 분 단위로 확인했고 팝업의 정확한 날짜·시각은 유지됩니다. 기존 시간 단위를 기대하던 fixture를 새 규칙에 맞췄으며 ChatGPT/Codex 공유·Claude/Gemini·게이지·티켓·권한·초기화 타이머·좁은 화면 회귀도 통과했습니다. 합성 DOM·Chrome API mock 검사이며 실제 로그인 화면에서의 새 문구는 미검증입니다.
- 설치 ZIP은 루트 manifest를 포함한 실행 파일 10개이고 검증한 dist와 모든 바이트가 같습니다. 크기 **84,409 bytes**, SHA-256 `a5edc2094ba731e6e831b10d2895a3706f4f87a8c12dab6ca4cb1e8fe27f3379`입니다. 이 변경에는 검증한 소스·명세·회귀 테스트를 함께 포함합니다.
- GitHub 다운로드 HTTP 200과 파일 바이트 일치를 확인했습니다. main의 downloads에는 최종 `202610151417` ZIP 한 개만 남겼고 README 설치 링크도 해당 파일로 맞췄습니다. 이미 게시한 설치 파일·링크는 PR에서 중복 변경하거나 재배포하지 않습니다.

## 2026-10-15 개발 의존성 최신화

TypeScript 7.0.2, esbuild 0.28.2, jsdom 30.1.2, tsx 4.23.15, @types/chrome 0.3.5, @types/jsdom 30.0.0, @types/node 24.19.2로 올렸습니다. 확장 실행 코드는 바꾸지 않았습니다. TypeScript 7의 DOM 타입에서 `HTMLElement.hidden`이 `boolean | "until-found"`로 넓어져 테스트 한 줄의 비교를 명시했습니다. jsdom 30의 Node 요구 사항을 `package.json`의 `engines`와 설치 문서에 적었습니다. `@types/node`는 실행 환경 메이저에 맞춰 24.x를 유지했습니다.

- `npm ci` 후 `npm run check`: **523개 통과**, TypeScript 7 타입 검사·개발 빌드·산출물 검사 통과. 릴리스 빌드와 `npm audit`(취약점 0) 확인. 번들 크기 변화는 수십 바이트입니다.
- 작업 환경 Node.js 22.22.0은 jsdom 30의 요구 범위보다 낮아 설치 경고가 있었으나 테스트는 통과했습니다. Chromium fixture는 작업 환경에 Chromium이 없어 실행하지 못했습니다.

## 2026-10-15 탭 실행 실패 시 마지막 사용량 유지 — 202610151145

GitHub main `82ce69c`의 변경을 가져와 SVG 자산 직접 사용, 이벤트 중복 처리 감소, 설정 정리·0~100 소수 임계치 지원을 유지한 상태에서 수정했습니다.

- `src/storage/snapshots.ts`: 반복 `tab_access_failed`에도 유효하고 초기화 전인 마지막 사용량을 팝업·탭별 배지·입력창에 표시합니다. 저장된 오류·실패 횟수·재시도 기한은 그대로이며 정상 수집으로 기록하지 않습니다.
- `src/background/scheduler.ts`, `src/shared/types.ts`: 명확한 인증·권한·조직 오류에서 선택적 `usageInvalidated`를 보존해 뒤이은 탭 실행 실패가 구계정 값을 정상값으로 복원하지 못하게 합니다. 이전 버전의 오류 스냅샷도 처리하며 새 수집 성공 시 해제합니다. 요금제·티켓의 별도 신뢰성 규칙은 유지합니다.
- `src/shared/format.ts`, `errors.ts`: 탭 실행 실패만으로 사이트 접근 설정 문제를 단정하지 않습니다. 유효 캐시가 없는 경우는 수치를 만들지 않고 `사용량 다시 확인 중`으로 안내합니다. 실제 권한 부족·로그인 문제·초기화 경과와 연속 네트워크/서버 실패는 기존 처리를 유지합니다.
- `AI_GAUGE_SPEC.md`, `AGENTS.md`, `docs/installation.md`: 현재 캐시 정책과 최신 설치 ZIP 한 개만 보관하는 규칙을 반영했습니다. 다운로드 파일 정리는 과거 Git 이력을 삭제하는 작업이 아닙니다.

검증 결과:

- 수정 전 회귀 테스트로 캐시 표시·오해를 주는 문구 문제 2건을 재현했습니다.
- `npm run check`: **523개 통과**, 실패·취소·스킵 0. TypeScript, 개발 빌드 및 MV3 권한·출처·산출물 검사 통과. 전체 검사 중 예전 문구를 기대하던 진단 UI 테스트도 새 안내에 맞춰 갱신했습니다.
- 같은 **202610151145** 빌드의 Chromium fixture 통과. 반복 탭 실패 시 기존 숫자·막대·게이지·초기화 텍스트 유지, 게이지 재애니메이션 없음, 정상 복구 후 동일 DOM에 새 값 반영을 확인했습니다. 최신 main에서 분리한 브라우저 fixture도 실행했으며 기존 세 서비스·ChatGPT/Codex 공유·티켓·요금제·권한·600px 팝업·30px 표시줄·76회 안정성 검사를 통과했습니다.
- 추가 테스트 파일: `tests/cache-reliability.test.ts`, `popup-compact.test.ts`, `popup-diagnostics.test.ts`, `usage-strip-progress.test.ts`, `scripts/browser-fixture/claude-checks.mjs`. 저장 왕복·재시작에 필요한 상태 보존, 실제 권한 부족, 무캐시·실제 0·초기화 경과·인증 문제 후 복원 방지를 포함합니다.
- 설치 ZIP은 루트 manifest를 포함한 실행 파일 10개이고 검증한 dist와 모든 바이트가 같습니다. 크기 **84,198 bytes**, SHA-256 `d14e2af52a0345ce2f6425cb8faa830aed2cc832008cdf204c064724ef068a6c`입니다.
- GitHub 다운로드 HTTP 200, 내려받은 파일과 원본 ZIP의 바이트 일치를 확인했습니다. `2eedcf3`에서 새 ZIP을 게시하고 `46a7acd`에서 이전 ZIP을 제거해 main의 downloads에는 최신 파일 한 개만 남았습니다. 이후 사용자의 README 링크 갱신 승인에 따라 `9305862`에서 설치 링크 한 줄을 최신 ZIP으로 바꿨으며 다운로드를 다시 검증했습니다. 원격 변경은 ZIP 두 경로와 README 설치 링크뿐입니다.
- 검증은 합성 DOM·Chrome API mock 기반입니다. 실제 로그인 세션에서의 탭 실행 거부와 자동 복구는 직접 검증하지 못했습니다. 수정 소스·명세·회귀 테스트는 main 대상 PR에 포함하며, 이미 게시된 ZIP과 README 링크는 중복 변경하지 않습니다. 실제 로그인 환경에서 마지막 데이터 유지·자동 재시도 후 복구·초기화 경과 표시를 추가 확인해야 합니다.

## 2026-10-15 이벤트 경로 최적화·게이지 자산 단일화·설정 정리

코드 점검 제안에 따른 PR입니다. 사용자 화면의 동작은 유지하고 반복 작업과 중복 정의를 줄였습니다. 새 설치 ZIP은 만들지 않았습니다.

| 변경 | 내용 |
| --- | --- |
| 워커 게시 경로 | 읽기용 view가 바뀐 경우에만 전체 배지와 탭 무효화 신호를 보냅니다. 탭 이동·활성화·창 복귀는 해당 탭 배지만 갱신하고, 배지는 탭별로 마지막 값과 같으면 action API를 호출하지 않습니다. 권한 추가·철회와 초기화는 강제로 게시합니다. |
| 저장소 변경 신호 | 탭과 팝업은 `settings:v2`·스냅샷 키의 local 변경만 반영합니다. 팝업의 변경 후 재읽기는 새 `read` 메시지를 사용해 수집을 시작하지 않습니다. 팝업을 열 때의 `view`는 기존대로 기한이 된 서비스만 갱신합니다. |
| 게이지 | `usage-gauge.ts`가 `assets/gauge-*.svg`를 번들 텍스트로 읽어 사용합니다. 자산 ID에는 게이지별 접두어를 붙입니다. 사용하지 않는 `assets/logo-20x20.png`를 삭제했습니다. |
| 설정 | 임계치는 0~100 범위의 숫자(소수 허용)이며 `checkUsageThresholds`가 범위·순서 원인과 대상 필드를 반환합니다. 사용하지 않던 `defaultProvider`·`selectedLimit`·`followTab`과 `strips`·`settings` 메시지를 제거했습니다. 이전 저장값의 퇴역 키는 읽을 때 무시되고 다음 저장 때 사라집니다. |
| 파일 분리 | `scripts/browser-fixture.mjs`를 하네스와 `scripts/browser-fixture/` 아래 팝업·Codex·Claude·ChatGPT·Gemini·게이지 체크 모듈로 나눴습니다. 페이지 주입용 `collectInPage`는 `providers/openai-claude-transport.ts`로 옮기고 `tab-transport.ts`에는 워커 쪽 탭 선택·결과 해석만 남겼습니다. 콘텐츠 스크립트의 요청 직렬화·재시도·응답 완료 감지는 `content/view-requests.ts`, 변경 감지 필터는 `content/mutations.ts`로 분리했습니다. 동작은 바꾸지 않았고 200자를 넘던 코드 줄을 정리했습니다(CSS·선택자 상수 제외). |
| 기타 | `readView` 저장소 읽기 1회 통합, ChatGPT/Claude JSON 응답 1 MiB 상한, 날짜 형식·Gemini 오류 문구·fetch 헬퍼 중복 제거, Gemini 정책 목록 일치 테스트, 릴리스 빌드 minify, 이전 설치 ZIP 정리(과거 링크는 커밋 고정 링크로 변경). |

- `npm run check`: **516개 통과**, 실패·취소·스킵 0. TypeScript, 개발 빌드, 산출물 검사 통과. 릴리스 빌드(`--release`)도 확인했습니다. 분리한 fixture 모듈은 구문 검사와 TypeScript `checkJs`로 미정의 이름이 없음을 확인했습니다.
- Chromium fixture(`npm run test:browser:fixture`, `test:browser:extension`)는 작업 환경에 Chromium이 없어 **실행하지 못했습니다.** 게이지 SVG 구성과 저장소 변경 신호 형식이 바뀌었으므로 병합 전 로컬 실행이 필요합니다. 실제 로그인한 서비스 화면에서도 미검증입니다.

## 2026-10-15 main 통합 — 동적 게이지와 표시 개선

사용자의 명시적 main 반영 요청에 따라 동적 SVG 게이지·임계치 설정, 티켓 만료 날짜·단일 수량 생략, 서비스별 체크박스 색상과 관련 명세·지침·테스트를 함께 통합합니다. README 설치 링크는 검증된 `202610151051` ZIP으로 갱신합니다. PR은 생성하지 않습니다.

원격 main의 추가 변경은 같은 설치 ZIP 한 파일뿐이며 실행 코드의 충돌이나 추가 수정이 없습니다. 아래 **508개 테스트·Chromium 통과** 결과를 유지하고, 통합 시 ZIP의 10개 파일이 검증한 dist와 모두 동일하며 SHA-256도 일치함을 다시 확인했습니다. 문서 정리만 추가했으므로 새 빌드·ZIP 재배포는 하지 않습니다. 실제 로그인한 서비스 화면의 검증 범위는 아래 기록대로 구분합니다.

## 2026-10-15 입력창 동적 게이지 — 202610151051

GitHub main `5f4d51d`의 실제 구현·명세·지침과 제공된 `gauge-background.svg`, `gauge-needle.svg`를 확인하고 `feat/dynamic-usage-gauge` 로컬 브랜치에서 개발했습니다. 이전 티켓 날짜·체크박스 색상 수정을 보존했습니다. ZIP 게시 당시에는 PR 생성·소스 푸시·main 병합을 하지 않았으며, 이후 사용자 요청에 따른 main 통합에 이 소스와 문서를 포함합니다.

| 변경 파일 | 구현 |
| --- | --- |
| src/content/usage-gauge.ts, usage-strip.ts | 제공 SVG 도형을 공통 인라인 컴포넌트로 구성. 표시줄의 기존 `usageParts.percent` 재사용, 20px 게이지·30px 줄·12px 글자와 숫자/막대/티켓 유지 |
| src/storage/settings.ts, shared/contracts.ts, background/index.ts | 기존 warning/danger 저장 필드 재사용. 1~99 정수·주의 < 경고 검증, 손상된 저장 쌍은 70/90 복구, 팝업 전용 부분 설정 메시지와 직렬 저장·탭 전파 |
| src/popup/index.ts, popup.html, popup.css | 주의·경고 시작 사용률 입력, 한국어 오류·접근성·저장 실패/저장 중 추가 입력 보존. 기존 브랜드 로고·서비스별 체크박스 색상 유지 |
| scripts/build.mjs, audit-build.mjs, src/shared/icon.ts(삭제) | 표시줄용 PNG 내장 경로를 제거하고 번들 내 SVG를 사용. 앱 아이콘·팝업 로고·원본 SVG 자산은 유지, SVG 네임스페이스를 네트워크 출처와 구분 |
| tests/usage-gauge.test.ts, gauge-settings.test.ts, usage-strip-progress.test.ts, activation.test.ts, popup-compact.test.ts, distribution.test.ts | 방향·임계 경계·미확인·동일값 안정성·설정 검증/경쟁·전파·기존 회귀 |
| scripts/browser-fixture.mjs, gauge-browser-checks.mjs | 실제 Chromium SVG 좌표·전환·reduced-motion·서비스별 대표값·설정 저장·레이아웃 검사 |
| AI_GAUGE_SPEC.md, AGENTS.md, docs/installation.md | 게이지 전용 임계치 설정과 동적 표시를 현재 구현에 맞춰 명시. 배지 임계치 색상 변경은 계속 제공하지 않음 |

- `npm run check`: **508개 통과**, 실패·취소·스킵 0. TypeScript, 개발 빌드, 권한·출처·산출물 검사 통과. 테스트에 포함된 정식 빌드·ZIP 검사도 통과했습니다.
- 동일 **202610151051** 빌드의 Chromium fixture 통과. SVG의 실제 화면 변환 행렬로 0/50/100% 방향과 `(32,46)` 회전축을 확인했고 배경은 회전하지 않습니다. 실제 중간 각도 및 500ms 바늘·300ms 원호 전환, 70/90 경계, 사용자 지정 40/60, 설정만 변경할 때 바늘 유지, 동일 값 반복 시 애니메이션/속성 변경 없음, reduced-motion의 즉시 변경을 확인했습니다.
- 첫 표시와 미확인→확인 전환은 가상의 시작 수치 없이 즉시 정확한 각도를 표시합니다. 미확인은 회색 원호와 숨긴 바늘이며 숫자는 기존 안내를 유지합니다. 일시적 첫 수집 실패에는 유효 캐시를 유지하고 연속 실패·로그인 문제·초기화 경과에는 기존 정책대로 숫자와 바늘을 숨깁니다.
- ChatGPT/Codex의 같은 데이터, Claude/Gemini의 기존 대표값과 게이지 일치, 20px 크기, 밝은/어두운 화면, 좁은 화면, 중복 방지·SPA/입력창 재생성 안정성, 사용량·요금제·초기화 티켓·권한 회귀를 확인했습니다. 잘못된 입력은 저장하지 않으며 활성화·권한 철회와 겹친 설정 저장도 해당 상태를 덮어쓰지 않습니다. 열린 지원 탭에 변경 신호가 전파되는 워커 테스트를 통과했습니다.
- 브라우저 fixture의 예전 “임계치는 내부값 70으로 유지” 검사는 새 사용자 설정 요구에 맞게 갱신한 뒤 통과했습니다. 검사 환경은 합성 DOM·Chrome API mock이며 **실제 로그인한 네 서비스 화면에서는 미검증**입니다. 설치 후 실제 사용량 변화·OS 동작 줄이기·여러 열린 탭의 설정 반영을 추가 확인해야 합니다.

## 2026-10-15 서비스별 체크박스 색상 — 202610151029

- 첫 실행의 서비스 선택 3개와 설정의 표시 체크박스 4개에 기존 배지·제목 점과 같은 대표색을 적용했습니다. ChatGPT·Codex `#0D8669`, Claude `#B16046`, Gemini `#3569C8`이며 CSS만 변경했습니다. 네이티브 체크박스·라벨·포커스·권한 및 설정 동작은 유지합니다.
- `npm run check` **492개 통과**, 타입·빌드·산출물 검사 통과. 동일 **202610151029** 빌드의 기존 Chromium fixture 전체 회귀를 통과했습니다. 임시 화면 캡처로 밝은/어두운 테마의 초기 설정·표시 설정을 확인했으며 7개 체크박스의 계산된 색상이 일치하고 `appearance: auto`를 유지합니다.
- 이번 검증은 합성 DOM·Chrome API mock 기반입니다. 실제 Chrome 설치 후 화면 확인은 남아 있으며 해당 배포 당시에는 원격에 설치 ZIP만 게시했습니다. 이전 티켓 만료 표시 수정도 포함합니다.

## 2026-10-15 티켓 만료 표시 — 202610151017

- 팝업의 만료가 확인된 단일 티켓에서 `1개 ·`를 생략했습니다. 총 보유량과 실제 복수 장 grant의 수량은 유지하며 수집·집계는 변경하지 않습니다.
- 팝업과 입력창의 티켓 만료 날짜를 브라우저 현지 시간의 `M/D(요일) HH:mm 만료`로 맞췄습니다. 명세·설치·티켓 문서를 갱신했습니다.
- `npm run check` **492개 통과**, 실패·취소·스킵 0. 타입·개발 빌드·산출물 검사 통과. 동일 **202610151017** 빌드의 Chromium fixture에서 개별 만료의 요일·단일 수량 생략·접근성 이름·만료 자동 제외·좁은 화면과 기존 세 서비스 회귀를 확인했습니다. 6개 한도와 4개 티켓을 표시하는 팝업 높이는 500px이며 표시줄 30px 규격을 유지합니다.
- 검증은 합성 DOM·Chrome API mock 기반이며 실제 로그인 세션 검증은 아닙니다. 사용자 설치 후의 실제 화면 확인은 남아 있습니다. 해당 배포 당시 원격에는 기존 main/downloads에 설치 ZIP만 게시했고 소스·문서는 로컬에 보관했습니다. 이후 사용자의 main 반영 요청에 따라 함께 통합합니다.

## 2026-10-15 팝업 제목 링크 — 202610150101

- 팝업의 `새로고침`과 별도 `사이트 열기`를 제거했습니다. ChatGPT·Claude·Gemini 제목은 기존 색상·크기·굵기·밑줄 없는 모양을 유지하며 포인터 커서와 네이티브 링크로 공식 홈을 새 탭에 엽니다. Tab·Enter 및 기존 키보드 포커스 표시를 지원합니다.
- 팝업의 수동 갱신 콜백만 제거했습니다. 기존 자동 수집·팝업 열기 갱신·최소 간격·백오프와 내부 메시지 계약은 유지합니다. 켜기·끄기·권한 철회, 티켓 링크, 기간 순서와 수치는 유지합니다.
- `npm run check` **492개 통과**, 실패·취소·스킵 0. 타입·개발 빌드·산출물 검사 통과. 동일 **202610150101** 빌드의 Chromium fixture에서 제목의 기존 스타일·포인터·공식 URL·새 탭 속성과 세 링크의 실제 Enter 활성화를 확인했습니다. 외부 이동은 fixture에서 막았으며 실제 로그인 화면 검증은 아닙니다.
- 명세·설치·백그라운드 수집 안내를 갱신했습니다. ZIP 게시 당시 로컬에 보관한 소스·테스트·문서를 이후 사용자의 main 병합 요청에 따라 함께 반영합니다. README의 설치 링크도 `202610150101`으로 갱신합니다.
- main 통합 시 원격의 추가 변경은 동일 설치 ZIP 한 파일뿐입니다. 최종 검토에서 내부 `ERROR_TEXT`의 로그인·서비스 탭 안내도 수동 갱신 대신 팝업 다시 열기로 맞췄습니다. 현재 화면은 별도 상태 포맷터를 사용하므로 이 두 문자열 수정으로 표시 동작은 바뀌지 않습니다.
- 최종 통합 검토 빌드 **202610150108**에서 `npm run check` **492개**와 타입·빌드·산출물 검사를 다시 통과했습니다. 배포본 `202610150101`과 파일별로 비교해 위 내부 문자열 두 곳과 manifest 빌드 시각 외에는 모두 같음을 확인했습니다. 기존 Chromium 화면 검증 결과를 유지하며 설치 ZIP은 재배포하지 않습니다.

## 2026-10-15 팝업 기간 순서 — 202610150036

- 세 서비스 팝업은 확인된 기간이 짧은 순서(5시간 → 7일)로 표시합니다. 같은 기간은 원래 순서를 유지하며 미확인 기간은 뒤에 둡니다. 기존 캐시에도 적용되며 원본 스냅샷·배지·입력창의 최댓값 선택은 변경하지 않습니다.
- `npm run check` **492개 통과**, 타입·빌드·산출물 검사 통과. 기존 UI fixture의 잘못된 기간 값을 수정한 뒤 팝업 검사 **12개**를 다시 통과했습니다.
- 동일 **202610150036** 빌드의 Chromium fixture 통과. 주간→5시간 원본 입력을 5시간→주간으로 표시하면서 각각의 사용률·초기화·진행 막대와 기존 표시줄 동작을 유지합니다. 실제 로그인 API를 새로 검증한 결과는 아닙니다.
- 명세에 팝업 정렬 기준을 반영했습니다. ZIP 게시 당시 로컬에 보관했던 소스·테스트·문서는 이후 사용자의 명시적 요청에 따라 main에 통합합니다. README의 설치 링크도 `202610150036`으로 갱신합니다.
- 통합 시 원격 main의 추가 변경은 같은 설치 ZIP 한 파일뿐입니다. 실행 코드와 fixture가 이미 검증한 상태에서 바뀌지 않아 위 테스트 결과를 유지하고, ZIP과 dist의 모든 파일이 같은지 다시 확인했습니다. 새 빌드나 ZIP 재배포는 하지 않습니다.

## 2026-10-15 main 통합 검증

사용자의 main 병합 요청에 따라 초기화 티켓·티켓별 만료 표시, 첫 실행 일괄 권한 승인, 600px 압축 팝업, 탭 없는 백그라운드 수집과 관련 문서를 함께 통합합니다. 기존 main의 소스·로고·설치 ZIP 이력을 보존하며 새 PR은 만들지 않습니다.

- 추가로 보고된 팝업의 `ChatGPT · 7일` 중복 표시는 제목을 유지하고 한도 이름의 `ChatGPT ·`만 생략해 수정했습니다. 기존 캐시 접두사 처리·추가 모델 이름·원본 스냅샷은 유지합니다. 단순화되어 있던 UI fixture를 실제 파서의 이름 형태로 맞췄습니다.
- 통합 상태의 `npm run check`: **492개 테스트 통과**, 실패·취소·스킵 0. TypeScript strict, 개발 빌드 및 산출물 권한·출처 검사 통과.
- 동일 **202610150007** 빌드의 Chromium fixture 통과. ChatGPT 카드 제목과 `7일` 한도 이름을 분리하여 확인했고, 600px 압축 팝업·좁은 화면·일괄 권한·티켓·기존 표시줄 회귀도 통과했습니다. 합성 DOM·Chrome API 검사이며 실제 로그인 API 검증이 아닙니다.
- 명세 갱신일과 사용자 팝업 가독성 확인을 반영했습니다. 최초 권한 승인 창, 탭 없는 조회의 쿠키·서비스 정책 호환성, 초기화 티켓의 실계정 응답은 미검증으로 유지합니다.
- 설치 ZIP은 검증한 dist와 10개 파일의 바이트가 모두 같고 압축 무결성을 확인했습니다. 이전 ZIP은 덮어쓰지 않습니다.

## 이전 202610142353 배포 검증

배포 검증일: 2026-10-14 (Asia/Seoul). 일괄 권한 설정·압축 팝업·탭 없는 수집 빌드 **202610142353**, Chrome 내부 버전 **2026.10.14.2353**. 해당 ZIP을 게시할 당시 수정 소스는 로컬 `feat/reset-ticket-display`에 남겼으며 PR 생성·기존 PR 수정·소스 푸시는 수행하지 않았습니다.

## 일괄 권한 설정·압축 팝업·탭 없는 수집

| 영역 | 주요 파일 | 구현 |
| --- | --- | --- |
| 최초 설정 | src/popup/index.ts, popup.html, src/shared/contracts.ts, src/background/index.ts | 세 서비스 체크박스, 선택한 호스트의 권한을 한 번에 요청하고 승인된 서비스만 활성화. 팝업 종료에도 워커가 활성화를 마무리하며 기존 설정 보존 |
| 압축 배치 | src/popup/render.ts, popup.css | 기본 폭 600px, 서비스 제목·요금제·버튼 및 사용률·진행 막대·초기화를 가로 배치. 티켓별 수량·만료는 각각 유지하며 좁은 화면에서 줄바꿈 |
| 탭 없는 수집 | src/providers/tab-transport.ts, gemini-bootstrap.ts, gemini-transport.ts | 서비스 탭이 실제로 0개일 때만 기존 쿠키로 워커 수집. 열린 탭 우선, 정지 탭·탭 오류에서 다른 계정으로 재시도하지 않음 |
| Gemini bootstrap | src/providers/gemini-bootstrap.ts | 고정 /app HTML의 실행 가능한 script JSON에서 요청 토큰만 메모리로 추출. 4MiB 읽기 상한·공유 15초 기한·정책 맥락 재확인 3초, 원격 코드 실행·인증정보 저장 없음 |
| 검증·문서 | tests/activation.test.ts, worker-collection.test.ts, 기존 제공자 테스트, scripts/browser-fixture.mjs, docs/background-collection.md | 승인 취소·선택적 활성화·중복 처리, 전송 및 인증 실패, bootstrap 경계, 기존 기능 회귀와 실제 로그인 검증 한계 |

- `npm run check`: **492개 테스트 통과**, 실패·취소·스킵 0. TypeScript strict, 빌드, 산출물 권한·출처 검사 통과.
- 동일 **202610142353** 빌드의 Chromium fixture 통과. 세 카드에 **한도 6개·티켓 4개**를 표시한 기본 600px 팝업의 전체 높이는 **500px**입니다. 서비스 조작 버튼과 제목의 같은 줄 배치, 390/320px 가로 넘침 방지, 밝은/어두운 테마를 확인했습니다. 제한·티켓이 더 많거나 설정을 펼치면 필요한 세로 스크롤은 남습니다.
- 사용자는 `202610142353` 설치 후 팝업이 훨씬 잘 보인다고 확인했습니다. 이 확인은 팝업 가독성에 관한 것이며 최초 권한 승인과 탭 없는 실계정 수집의 검증으로 확대하지 않습니다.
- 첫 실행의 세 체크박스 기본 선택, 일부 선택 후 정확히 한 번의 호스트 권한 요청, 선택한 서비스만 활성화, 취소·빈 선택·팝업 종료·실제 권한 없는 메시지 거부를 검증했습니다. 기존 카드별 켜기·끄기·철회와 저장 설정을 유지합니다.
- ChatGPT·Claude·Gemini 워커 경로는 합성 HTTP 응답으로 검증했습니다. 로그인 만료·권한 부족·429·네트워크 실패, Claude 복수 조직, Gemini bootstrap의 비실행 영역·잘린 스트림·크기·시간 제한을 확인했습니다. 선택적 요금제 확인 실패에는 수집된 사용량을 유지합니다.
- 기존 ChatGPT/Codex 동일 데이터, 티켓별 만료·15초 자동 제외·공식 링크 키보드 접근, 입력창 30px/12px/20px 규격, 로컬 공유 캐시·자동 갱신·서비스 워커 재시작과 76회 표시줄 안정성 회귀를 통과했습니다.
- 새 Chrome 권한·숨은 탭·쿠키 API·인증정보 저장·원격 분석·백엔드를 추가하지 않았습니다. 명세·개발 지침·설치·권한·수집 가능성 문서를 실제 변경에 맞췄습니다.

**탭 없는 수집은 실제 로그인 Chrome에서 미검증입니다.** 이 환경의 Chromium 검사는 합성 DOM·Chrome API mock을 사용하며 실제 unpacked 설치도 관리자 정책상 사용할 수 없습니다. 각 서비스에 로그인한 뒤 서비스 탭을 모두 닫고 사용량 갱신을 확인해야 합니다. 확장 출처의 쿠키·SameSite·서비스 보호 정책 때문에 실제로는 탭이 필요할 수 있습니다. Gemini는 기본 Google 쿠키 계정만 사용하며, bootstrap 토큰 재확인은 모든 계정 전환의 신원 보증이 아닙니다. 자세한 조건은 [background-collection.md](background-collection.md)를 참고하세요.

## 이전 초기화 티켓 검증 — 202610142258

| 영역 | 주요 파일 | 구현 |
| --- | --- | --- |
| 공개 계약 | docs/reset-tickets.md, provider-feasibility.md | Claude Tuner 공개 GET·응답 필드·공식 화면 링크 근거. 비공개 모듈/실제 fixture 접근 없음 |
| 수집·파서 | src/providers/reset-tickets.ts, tab-transport.ts, chatgpt.ts, claude.ts | ChatGPT 요약/상세·계정 재확인, Claude cedar query·기본 사용량 복구·조직 재확인. 추가 조회 3초 제한, 사용량과 독립 실패 |
| 저장·현재 유효성 | src/shared/types.ts, tickets.ts, src/storage/snapshots.ts, ticket-trust.ts | 선택적 티켓 캐시·종류/조건 보존, 만료 제거·미래 시작 분리, 안전한 합산, 브라우저 세션 검증 boolean |
| 갱신 | src/background/scheduler.ts, index.ts | 기존 갱신/중복 병합/백오프 재사용, 신뢰할 수 있는 같은 사용자 캐시만 실패 시 유지, 계정/문서 변경·인증/권한 문제 처리 |
| 표시 | src/shared/ticket-presentation.ts, src/content/usage-strip.ts, src/popup/render.ts, popup.css | 팝업 총 보유량·티켓별 수량/만료, 표시줄 네이티브 링크, 현지 시각, 티켓 우선 숨김·키보드/접근성 설명 |
| 검증 | tests/provider-tickets.test.ts, ticket-cache.test.ts, ticket-ui.test.ts, 기존 회귀와 scripts/browser-fixture.mjs | 응답/실패/전환/만료/세션/반응형/공식 링크와 기존 세 서비스 회귀 |

- `npm run check`: **460개 테스트 통과**, 실패·취소·스킵 0. TypeScript strict, 개발 빌드, 산출물 권한·출처 검사 통과.
- 정상·0장·복수 종류·미래 시작·서로 다른 만료·수량만 있는 요약·손상/누락·사용 조건·401/403/429/네트워크/3초 제한을 합성 응답으로 검증했습니다. ChatGPT/Codex는 같은 스냅샷이며 Gemini에는 티켓이 생성되지 않습니다.
- 같은 브라우저 세션에서 1분마다 워커를 새로 만드는 9회 검사에서도 티켓 표시와 10분 수집 주기가 유지됩니다. 새 브라우저 세션에서 검증이 없으면 이전 티켓을 재확인하며, 동일 계정 증거 없는 실패에 이전 캐시를 재사용하지 않습니다.
- 팝업의 `지금 사용 가능` 문구와 접근성 이름을 제거하고 각 티켓의 수량·만료를 별도 행으로 표시했습니다. 같은 grant의 복수 장수, 서로 다른 만료, 만료 후 해당 행 제거, 만료 미확인 시 개수만 표시하는 회귀를 확인했습니다. 입력창은 가장 빠른 만료 시각으로 요약합니다.
- Chromium fixture도 동일 `202610142258` 빌드에서 통과했습니다. 넓은 화면의 30px/12px/20px 유지, 900px 이하에서 티켓 먼저 숨김, 320px 가로 넘침 없음, 네이티브 링크 Enter 활성화를 확인했습니다. 실제 15초 표시 시계가 추가 요청 없이 만료 티켓과 링크 속성을 제거하는 검사도 통과했습니다.
- 원본 티켓/계정/조직 ID·인증정보·원본 응답은 저장하지 않습니다. 세션 저장소는 서비스별 검증 여부 boolean만 담고 동일 계정 비교값은 워커 메모리에만 있습니다.

**실제 로그인 API 응답은 미검증입니다.** 공개 참고 저장소에는 주석이 인용하는 실제 응답 fixture가 없으며 이번 테스트는 공개 계약에 맞춘 합성 응답입니다. 보유량·적용 가능 수량·만료 시각의 웹앱 대조, 실제 계정/조직 전환과 공식 링크의 로그인 후 도달 화면은 실사용 확인이 필요합니다. Claude 조직만으로 현재 사용자를 확정할 수 없어 티켓 조회 실패 때 이전 티켓은 숨기지만 사용량은 유지합니다. 문서/인증 이벤트 없는 계정 변경은 다음 수집까지 즉시 감지하지 못합니다. 상세 제약은 [reset-tickets.md](reset-tickets.md)를 참고하세요.

## 이전 요금제 배지 검증

| 영역 | 주요 파일 | 변경 |
| --- | --- | --- |
| ChatGPT·Claude | src/providers/openai-claude-plan.ts, tab-transport.ts, chatgpt.ts, claude.ts | 기존 plan_type·조직 메타데이터만 추가로 정규화. 확인된 값만 판별하며 사용량 요청 수 유지 |
| Gemini | src/providers/gemini-plan.ts, gemini-transport.ts, gemini.ts | 사용량 성공 뒤 선택적 otAQ7b 정책 RPC, 3초 제한·실패 격리·정확한 정책 매핑, planId 단독 판별 금지 |
| 저장·수명 | src/shared/plan.ts, types.ts, contracts.ts, src/storage/snapshots.ts, src/background/scheduler.ts, index.ts, src/content/index.ts | 선택적 요금제 필드, 10분 유효 기간, 문서 재로드/실패 시 이전 요금제 제거, 단순 탭·창·SPA 이동 중 유지, 늦은 응답 차단, 재시도 기한 이후 한 번 재확인 |
| 팝업 | src/popup/render.ts, popup.css | 서비스 제목 옆 확인된 요금제 배지만 표시, 미확인 배지 숨김. 기존 사용량·버튼·입력창·툴바 유지 |
| 검증 | tests/provider-plan.test.ts, gemini-plan.test.ts, plan-cache.test.ts, plan-context.test.ts, popup-plan.test.ts 및 기존 회귀, scripts/browser-fixture.mjs | 식별자·누락·손상·구독 변경·전환 경쟁·재시작·정책 실패·레이아웃 회귀 |

`npm run check` **414개 테스트·타입 검사·빌드·산출물 검사 통과**, 실패/취소/스킵 0입니다. Chromium fixture도 동일 `202610142207` 빌드에서 통과했습니다. 밝은/어두운 팝업, 요금제 배지 크기·갱신·미확인 시 DOM 제거, 정책 실패 시 사용량 유지, 기존 520/390/320px 폭·30px 표시줄·76회 화면 변경 안정성을 확인했습니다. 원본 fixture와 합성 응답을 구분하며 실제 로그인 세션을 사용하지 않았습니다.

실계정의 각 요금제·구독 변경·계정 전환과 `otAQ7b` 정책 매칭은 **추가 검증 대상**입니다. 문서 재로드 없이 이루어지는 계정 전환은 즉시 감지할 수 없으며 다음 수집 또는 10분 유효 기간으로 제한합니다. 판별 근거와 한계는 [plan-detection.md](plan-detection.md)를 참고하세요.

사용자는 이전 `202610142125` 빌드에서 세 서비스 요금제가 모두 `확인 불가`라고 보고했습니다. 공통 lifecycle 테스트에서 탭 활성화·초기 Content Script 연결·창 복귀·SPA 이동이 성공한 요금제를 지우고, 쿨다운 동안 복구하지 못하거나 진행 중 정상 응답을 버리는 문제를 수정 전 재현했습니다(관련 테스트 5개 실패). 수정 후 일반 이벤트는 캐시를 보존하고 실제 문서 loading만 보수적으로 무효화합니다. 유효한 기존 요금제는 일반 갱신 진행 중에도 유지하되 원 확인 시각·10분 TTL을 연장하지 않습니다. 알 수 없는 요금제 배지를 숨기는 팝업 회귀 테스트도 수정 전 실패·수정 후 통과를 확인했습니다. 제공자별 식별자 매핑은 추측해서 확대하지 않았습니다. 사용자는 `202610142207` 설치 후 문제 해결을 확인했습니다. 이 확인은 보고된 표시 문제의 해결 범위이며 모든 요금제 등급·구독 변경·계정 전환의 검증으로 확대하지 않습니다.

## 기존 입력창 배치와 공유 캐시

| 영역 | 주요 파일 | 구현 내용 |
| --- | --- | --- |
| 입력창 외부 배치 | src/content/selectors.ts, usage-strip.ts, index.ts | ChatGPT의 ComposerLayoutBody-, Codex의 ComposerLayoutRoot-, Claude의 data-cds=ChatComposerChin 요소 바로 뒤로 이동. 무작위 접미사·SPA 교체·동일 표시줄 유지·모호한 후보 처리. Gemini 위치 유지 |
| 공유 캐시 | src/storage/snapshots.ts | 정상 캐시의 나이만으로 stale 처리하지 않음. 첫 네트워크/서버 실패는 유효 캐시 유지. 실제 오류·실패 횟수·재시도 시각은 저장소에 보존 |
| 자동 갱신 | src/background/index.ts, scheduler.ts | 정상 수집 간격 10분, 1분 alarm으로 갱신/재시도/초기화 기한 검사. 시작 시 캐시 먼저 공유 후 기한이 된 제공자 수집. 제공자별 중복 병합과 백오프 유지 |
| 신뢰성 표시 | src/shared/format.ts, errors.ts, types.ts, src/popup/render.ts | 연속 실패·로그인/권한 문제·응답 손상·초기화 경과에 짧은 상태. 팝업은 이전 값을 명시하고 표시줄·배지는 현재 수치로 표시하지 않음 |
| 표시 시계 | src/content/index.ts | 15초마다 남은 시간/초기화 경과 재평가. 탭별 API 호출 없음. 권한 철회 시 interval과 겹친 DOM debounce 정리 |
| 문서 | AI_GAUGE_SPEC.md, AGENTS.md, docs/installation.md, provider-feasibility.md | 현재 배치·캐시 신뢰성·공유 갱신 정책과 사용자 확인 범위 반영 |

ChatGPT와 Codex는 계속 같은 플랜 스냅샷을 사용합니다. 새 Provider·수집 API·권한·사용자 설정·백엔드·원격 분석은 추가하지 않았습니다. 표시줄의 30px 높이, 12px 글자, 20px 로고와 기존 진행 막대를 유지합니다.

## 이전 202610142100 검증 기록

| 검사 | 결과 |
| --- | --- |
| npm run check | 통과: TypeScript strict, **374개 테스트**, 개발 빌드, 산출물 권한·목적지 검사. 실패/취소/스킵 0 |
| Chromium fixture | **202610142100** 빌드 통과. 세 카드·네 표시 설정·밝은/어두운 테마·520/390/320px 팝업, 세 외부 배치·30px 높이·76회 시간 간격 안정성·Gemini 위치 보존 |
| 실제 15초 표시 시계 | DOM/저장소/메시지 변화 없이 초기화 시각 경과 후 이전 수치 제거·짧은 상태·동일 progress 노드 유지·추가 runtime 요청 0을 Chromium에서 확인 |
| 캐시 신뢰성 | 실제 0/null 구분, 나이만 지난 캐시, 첫/연속 실패·정상 복구, 인증/권한/429 우선, 초기화 경계와 복수 창, 손상 시각, 순수성·멱등성·원본 저장 상태 보존 |
| 서비스 워커·공유 | 실제 번들을 VM의 Chrome API mock으로 실행. 시작·alarm·여러 탭 요청 병합, 비활성 ChatGPT/Codex 탭에 같은 값 공유, 탭 전환 없는 주기 갱신, 최신/만료 캐시의 워커 재시작, 기존 alarm 이전 |
| 표시 시계·정리 | 조용한 두 탭의 15초 재렌더링에서 추가 수집 없음. 저장소 갱신으로 같은 DOM에 새 수치 반영. 권한 철회·타이머 중첩 정리 |
| 외부 배치 | 세 사용자 제공 요소의 직접 다음 형제, 무작위 클래스 토큰·유사 클래스 배제·속성 변경, hydration/교체/중복 방지, 기존 입력·버튼 보존 |
| 기존 회귀 | ChatGPT/Codex 동일 데이터, Claude·Gemini 파서/전송/진단, 권한 승인·철회, 저장 이전, 배지 서비스색, 팝업·진행 막대·보안 메시지 계약 |
| 정식 빌드·ZIP 테스트 | 진단 UI/응답 제외, 루트 manifest와 런타임 6개+로컬 PNG 4개, 버전/바이트/무결성/기존 파일 덮어쓰기 거부 |

Node.js 24.19.0 / npm 11.9.0 / Chromium 154.0.8037.57. 브라우저 fixture는 합성 페이지·Chrome API mock·localhost 출처 치환을 사용합니다. 로그인한 계정/API 검증이 아닙니다.

## main 통합 검증

2026-10-14 사용자 요청에 따라 누적 구현·테스트·문서를 기존 main의 README·로고·설치 ZIP 이력과 통합했습니다. 명세·개발 지침의 소스 반영 보류 문구를 정리하고, 권한 문서의 Gemini 사용자 확인 상태와 1분 기한 검사·10분 수집 설명을 맞췄습니다. 서버 동기화가 없다는 설명은 로컬 탭 간 결과 공유와 구분했습니다.

통합 후 `npm run check`를 다시 실행하여 **374개 테스트**, 타입 검사, 빌드 및 산출물 검사를 통과했습니다. 검사용 빌드 `202610142110`의 실행 파일·아이콘은 배포 ZIP `202610142100`과 바이트가 같으며 manifest의 빌드 시각 버전만 다릅니다. 실행 코드가 같으므로 앞서 통과한 Chromium fixture 결과를 유지하며 이번 문서 정리로 새 ZIP을 배포하지 않았습니다. 원격에 있던 ZIP과 사용자 로고는 변경하지 않았습니다.

## 실사용 검증 범위

사용자는 OpenAI 플랜 및 Claude 수집·초기화 시각, 이전 ChatGPT·Claude 홈/채팅 배치, 팝업·아이콘·서비스별 배지 색상을 확인했습니다. Gemini 프레임 오류 수정 빌드 `202610142031` 안내 후 “오.. Gemini도 성공했어.”라고 보고하여 세 서비스 수집 성공을 사용자 확인으로 기록했습니다.

Gemini 전송 파서는 사용자가 제공한 HTTP 200 JSON 응답으로 재현했습니다. 길이 207/25가 앞뒤 LF를 포함하는 프레임과 최종 LF 생략을 처리하고, 손상된 JSON·중간 프레임은 거부합니다. fixture의 사용량은 주간 **0.04305%**, 5시간 **1%**, 초기화는 각각 **2026-10-20T05:05:27.343Z**, **2026-10-14T13:05:27.343Z**입니다. 사용량과 무관한 메타데이터 식별 문자열만 같은 길이로 비식별 처리했습니다. 이번 변경에서는 Gemini 수집·파싱과 위치를 바꾸지 않았습니다.

이 환경에는 로그인한 사용자 Chrome 세션이 없고 unpacked 확장 로딩도 관리자 정책으로 차단됩니다. 다음은 **실사용 재확인 대상**입니다.

- ChatGPT 홈/채팅, Codex 홈/진행 작업, Claude 홈/채팅의 새 입력창 외부 위치와 좁은 화면 배치
- 실제 열린 여러 탭에서 자동 갱신 결과 공유와 장시간 비활성·브라우저 절전 후 복귀
- 실제 서비스의 초기화 경계·일시 장애·연속 실패·로그인 만료에서 상태와 복구
- Gemini 웹앱과 사용률·초기화 시각의 세부 대조, 다른 계정·페이지 전환·응답 완료 구조
- 실제 Chrome 업그레이드·권한 승인 창·서비스 워커 재시작·툴바 표시

사용자 수집 성공을 개발 환경의 직접 로그인 검증이나 모든 페이지·계정 상태 확인으로 확대하지 않습니다. 비기본 Google 계정의 RPC 대상 선택은 여전히 미지원이며 인증·사이트 보호장치를 우회하지 않습니다.

## 설치 결과물

[동적 게이지 ZIP — 202610151051](https://github.com/han41858/ai-gauge/raw/refs/heads/main/downloads/ai-gauge-202610151051.zip)

- 크기: 83,307 bytes
- SHA-256: 60e5d484ab44a2466b051f8a2203e37f67222ea78861ed01252f47fb29ee80f1
- 검증한 dist와 ZIP의 10개 파일이 모두 동일하며 루트 manifest·런타임·앱 아이콘만 포함합니다. 인라인 SVG는 content 번들에 포함되어 별도 이미지 요청이 없습니다.
- 원격 커밋 `a4447755`는 설치 ZIP 한 파일만 추가했습니다. 다운로드 HTTP 200, 원본 바이트 일치와 압축 무결성을 확인했습니다. 해당 ZIP 게시 당시에는 소스 푸시·PR 생성·main 병합을 하지 않았습니다.

아래는 이전 서비스별 체크박스 색상 배포본입니다.

[서비스별 체크박스 색상 ZIP — 202610151029](https://github.com/han41858/ai-gauge/raw/83a1b00342a18a09ab5653cf44f4b0d0f83fe545/downloads/ai-gauge-202610151029.zip)

- 크기: 82,584 bytes
- SHA-256: 78b19902165212d7cf40da02875b157e75368a544af6fb31c75f33a85febbbb9
- 검사한 dist와 ZIP의 10개 파일이 모두 동일하며 루트 manifest·런타임·아이콘만 포함합니다.
- 원격 커밋 `cfd302bb`은 설치 ZIP 한 파일만 추가했습니다. 다운로드 HTTP 200, 원본 바이트 일치와 압축 무결성을 확인했습니다.

아래는 이전 티켓 만료 표시 수정 배포본입니다.

[티켓 만료 표시 수정 ZIP — 202610151017](https://github.com/han41858/ai-gauge/raw/83a1b00342a18a09ab5653cf44f4b0d0f83fe545/downloads/ai-gauge-202610151017.zip)

- 크기: 82,531 bytes
- SHA-256: db02b81fa4f712d6aa74ca5957c7abb9b72aaee92ced0655063e13b6b59c1aeb
- 검사한 dist와 ZIP의 10개 파일이 모두 동일하며 루트 manifest·런타임·아이콘만 포함합니다.
- 원격 커밋 `f5b550a7`은 설치 ZIP 한 파일만 추가했습니다. 다운로드 HTTP 200, 원본 바이트 일치와 압축 무결성을 확인했습니다.

아래는 이전 팝업 제목 링크 배포본입니다.

[팝업 제목 링크 ZIP — 202610150101](https://github.com/han41858/ai-gauge/raw/83a1b00342a18a09ab5653cf44f4b0d0f83fe545/downloads/ai-gauge-202610150101.zip)

- 크기: 82,505 bytes
- SHA-256: a2f538cf8ba4d7d0d8d498e3d194b21d5356f6698f8e1c56acce90b24d91a185
- 검사한 dist와 ZIP의 10개 파일이 모두 동일하며 루트 manifest·런타임·아이콘만 포함합니다.
- 원격 커밋 `2425c488`은 설치 ZIP 한 파일만 추가했습니다. 다운로드 HTTP 200, 원본 바이트 일치와 압축 무결성을 확인했습니다.

아래는 이전 팝업 기간 순서 수정 배포본입니다.

[팝업 기간 순서 수정 ZIP — 202610150036](https://github.com/han41858/ai-gauge/raw/83a1b00342a18a09ab5653cf44f4b0d0f83fe545/downloads/ai-gauge-202610150036.zip)

- 크기: 82,563 bytes
- SHA-256: f3a996a12522259668b6a6e7c7ec6c6b7cf271be321d01094bc1f10f9c77b799
- 검사한 dist와 ZIP의 10개 파일이 모두 동일하며 루트 manifest·런타임·아이콘만 포함합니다.
- 원격 커밋 `6053fa5d`는 설치 ZIP 한 파일만 추가했습니다. 다운로드 HTTP 200, 원본 바이트 일치와 압축 무결성을 확인했습니다.

아래는 이전 main 통합 배포본입니다.

[main 통합·ChatGPT 중복 문구 수정 ZIP — 202610150007](https://github.com/han41858/ai-gauge/raw/83a1b00342a18a09ab5653cf44f4b0d0f83fe545/downloads/ai-gauge-202610150007.zip)

- 크기: 82,525 bytes
- SHA-256: 6c56937c3bb238d6f7b3920160152021bb807a939aef28fdf649cfed31d13354
- 통합 후 492개 검사와 Chromium fixture를 통과한 동일 빌드입니다. 루트 manifest와 런타임·로컬 PNG 총 10개 파일만 포함하며 docs/INSTALL/상위 폴더는 없습니다.

아래는 이전 일괄 권한·압축 팝업 배포본입니다.

[일괄 권한·압축 팝업·탭 없는 수집 ZIP — 202610142353](https://github.com/han41858/ai-gauge/raw/83a1b00342a18a09ab5653cf44f4b0d0f83fe545/downloads/ai-gauge-202610142353.zip)

- 크기: 82,511 bytes
- SHA-256: 0bddea985e99010a991934bda3ca65688353b9626e4ed446e3d92f3fe4d8c65b
- 위 492개 검사와 Chromium fixture를 통과한 동일 빌드입니다. 루트 manifest와 런타임·로컬 PNG 총 10개 파일만 포함하며 docs/INSTALL/상위 폴더는 없습니다.
- 원격 커밋 `33599cbc`는 기존 main/downloads에 설치 ZIP 한 파일만 추가했습니다. 다운로드 HTTP 200, 원본 바이트·SHA-256 일치와 ZIP 무결성을 확인했습니다. 해당 ZIP 게시 시점에는 소스·문서 푸시와 PR 생성·수정을 수행하지 않았습니다.

아래는 이전 초기화 티켓 검토 배포본입니다.

[초기화 티켓 검토 ZIP — 202610142258](https://github.com/han41858/ai-gauge/raw/83a1b00342a18a09ab5653cf44f4b0d0f83fe545/downloads/ai-gauge-202610142258.zip)

- 크기: 79,647 bytes
- SHA-256: b9fe74efbc46cc680ba657fa1b9f9d8348a8be71d36531a9068faa15014c9815
- 루트 manifest와 실행 파일·로컬 PNG만 포함하며 docs/INSTALL/상위 폴더는 없습니다.
- 원격 커밋 `02ab459a`는 기존 main/downloads에 설치 ZIP 한 파일만 추가했습니다. GitHub 다운로드 HTTP 200, 원본 바이트·SHA-256 일치와 ZIP 무결성을 확인했습니다. 이 기록은 당시 배포 검증이며 이후 작업의 PR 생성·수정 승인을 의미하지 않습니다.

아래는 이전 요금제 표시 수정 배포본입니다.

[요금제 배지 수정 ZIP — 202610142207](https://github.com/han41858/ai-gauge/raw/83a1b00342a18a09ab5653cf44f4b0d0f83fe545/downloads/ai-gauge-202610142207.zip)

- 크기: 70,467 bytes
- SHA-256: 62173b8a13e67822631ef8c3b873a7e6e3ba8a9f6a9f8cefc9505fe33fdae713
- 루트 manifest와 실행 파일·로컬 PNG만 포함하며 docs/INSTALL/상위 폴더는 없습니다.
- 원격 커밋 `d5375224`는 설치 ZIP 한 파일만 추가했습니다. 이 ZIP 게시 당시에는 소스를 갱신하지 않았으며, 이후 사용자 요청으로 해당 수정 소스·문서를 기존 PR #1에 포함합니다. GitHub 다운로드·원본 바이트/SHA-256 일치·ZIP 무결성을 확인했습니다.

아래는 기존 main 배포본입니다.

[설치 ZIP — 202610142100](https://github.com/han41858/ai-gauge/raw/83a1b00342a18a09ab5653cf44f4b0d0f83fe545/downloads/ai-gauge-202610142100.zip)

- 크기: 67,330 bytes
- SHA-256: d47694ca4e3a3ec361dafe5e831c553ca58ec8a2d4133d8ffcc3f3de42322a57
- 루트 manifest·background/content/popup JS·popup HTML/CSS, assets의 16/32/48/128px PNG. docs/INSTALL/상위 폴더 없음.
- 원격 커밋 `0c8fb45`는 ZIP 한 파일만 추가한 배포 커밋입니다. 이후 사용자 요청에 따라 누적 소스·테스트·문서를 main에 통합했습니다. 설치 ZIP의 버전과 바이트는 유지합니다.
- GitHub 다운로드 HTTP 200, 원본 바이트·SHA-256 일치, ZIP 무결성·git diff 공백 검사 통과.

기존 설치 폴더를 새 ZIP 내용으로 교체하고 `chrome://extensions`에서 확장을 새로고침한 뒤 열린 서비스 탭들도 새로고침합니다. 기존 활성화 상태는 유지됩니다. 최초 선택 화면은 모든 서비스가 꺼져 있고 호스트 권한도 없는 상태에서 표시됩니다. 탭 없는 수집은 로그인 후 해당 서비스 탭을 모두 닫고 자동 수집을 기다리거나 팝업을 다시 열어 확인합니다. 최소 60초 간격과 오류 재시도 대기는 유지됩니다.

## 2026-10-19 입력창 대표 한도 선택

- `main`의 `634fd01`을 기준으로 별도 브랜치에서 구현했습니다. 기존 `highestUsageLimit`은 배지에 유지하고 입력창만 `composerUsageLimit`으로 분리했습니다.
- Node v24.19.0 / npm 11.9.0과 기존 lockfile 의존성을 사용했습니다. 이번 수정에서 의존성을 추가하거나 갱신하지 않았습니다.
- `npm run check`: 타입 검사, **559개 테스트 통과 / 실패·취소·스킵 0**, 개발 빌드 `202610191723`, MV3 정적 산출물 검사 통과.
- `npm run test:browser:fixture`: Chromium 합성 팝업·네 입력창·한국어/영어 상대 시간·설정 전파·진행 막대·동적 SVG 게이지·감소된 동작·캐시/권한 회귀 통과. Gemini는 높은 주간 사용률 대신 먼저 초기화되는 0% 창을 표시하고 같은 창의 후속 수치 갱신을 반영함을 확인했습니다.
- 요청한 여섯 조합, 0/100% 경계, 초기화 동률의 응답 순서, 소진 한도의 미확인 초기화 우선, 미소진 시각 전부 미확인의 최대 사용률, null/비유효 수치, ChatGPT 추가 기능 및 Claude 모델 한도 제외, 제공자 독립성과 무효화 캐시를 검증했습니다. 숫자·막대·바늘 각도·임계치 색상·상대 시간이 동일 항목을 사용함을 DOM에서 검증했습니다.
- 세 제공자의 fixture→파서→선택 함수 계약, 서로 다른 시간대 표기의 동일 초기화 시각, 네 입력창 동시 표시와 ChatGPT/Codex 공유 갱신·무효화, 무효화 뒤 탭 실행 실패의 수치 복원 차단도 검증했습니다. 선택에서 제외된 모델·기능 한도의 초기화가 경과해도 전체 스냅샷을 확인 중으로 전환하는 기존 정책을 유지합니다.
- 기존 fixture의 임의 ChatGPT ID/category는 실제 파서의 `shared:*`/`product` 계약으로 수정했습니다. 모델·기능 전용 한도를 공통 값으로 대체하는 fallback은 두지 않습니다. 팝업은 모든 한도, 배지는 기존 최대 사용률을 유지합니다.
- 실제 로그인 응답이나 최신 서비스 화면을 직접 검증한 결과는 아닙니다. 일반 ChatGPT 대화 전체 한도와 모든 모델·기능의 적용 관계는 API 계약으로 확인되지 않았으며 임의 추정하지 않았습니다. 기존 초기화 경과·캐시 무효화 정책은 유지했습니다.
