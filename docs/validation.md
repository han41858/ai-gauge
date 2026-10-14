# 구현 및 검증 결과

검증일: 2026-10-14 (Asia/Seoul). 초기화 티켓 검토 빌드 **202610142231**, Chrome 내부 버전 **2026.10.14.2231**. 별도 `feat/reset-ticket-display` 브랜치에서 개발하며 소스를 main에 직접 병합하지 않습니다.

## 초기화 티켓

| 영역 | 주요 파일 | 구현 |
| --- | --- | --- |
| 공개 계약 | docs/reset-tickets.md, provider-feasibility.md | Claude Tuner 공개 GET·응답 필드·공식 화면 링크 근거. 비공개 모듈/실제 fixture 접근 없음 |
| 수집·파서 | src/providers/reset-tickets.ts, tab-transport.ts, chatgpt.ts, claude.ts | ChatGPT 요약/상세·계정 재확인, Claude cedar query·기본 사용량 복구·조직 재확인. 추가 조회 3초 제한, 사용량과 독립 실패 |
| 저장·현재 유효성 | src/shared/types.ts, tickets.ts, src/storage/snapshots.ts, ticket-trust.ts | 선택적 티켓 캐시·종류/조건 보존, 만료 제거·미래 시작 분리, 안전한 합산, 브라우저 세션 검증 boolean |
| 갱신 | src/background/scheduler.ts, index.ts | 기존 갱신/중복 병합/백오프 재사용, 신뢰할 수 있는 같은 사용자 캐시만 실패 시 유지, 계정/문서 변경·인증/권한 문제 처리 |
| 표시 | src/shared/ticket-presentation.ts, src/content/usage-strip.ts, src/popup/render.ts, popup.css | 팝업 보유/사용 가능/만료, 표시줄 네이티브 링크, 현지 시각, 티켓 우선 숨김·키보드/접근성 설명 |
| 검증 | tests/provider-tickets.test.ts, ticket-cache.test.ts, ticket-ui.test.ts, 기존 회귀와 scripts/browser-fixture.mjs | 응답/실패/전환/만료/세션/반응형/공식 링크와 기존 세 서비스 회귀 |

- `npm run check`: **460개 테스트 통과**, 실패·취소·스킵 0. TypeScript strict, 개발 빌드, 산출물 권한·출처 검사 통과.
- 정상·0장·복수 종류·미래 시작·서로 다른 만료·수량만 있는 요약·손상/누락·사용 조건·401/403/429/네트워크/3초 제한을 합성 응답으로 검증했습니다. ChatGPT/Codex는 같은 스냅샷이며 Gemini에는 티켓이 생성되지 않습니다.
- 같은 브라우저 세션에서 1분마다 워커를 새로 만드는 9회 검사에서도 티켓 표시와 10분 수집 주기가 유지됩니다. 새 브라우저 세션에서 검증이 없으면 이전 티켓을 재확인하며, 동일 계정 증거 없는 실패에 이전 캐시를 재사용하지 않습니다.
- Chromium fixture도 동일 `202610142231` 빌드에서 통과했습니다. 넓은 화면의 30px/12px/20px 유지, 900px 이하에서 티켓 먼저 숨김, 320px 가로 넘침 없음, 네이티브 링크 Enter 활성화를 확인했습니다. 실제 15초 표시 시계가 추가 요청 없이 만료 티켓과 링크 속성을 제거하는 검사도 통과했습니다.
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

초기화 티켓 검토 ZIP `ai-gauge-202610142231.zip`을 로컬에 생성했습니다. GitHub 게시와 PR 생성은 아직 완료하지 않았습니다.

- 크기: 79,546 bytes
- SHA-256: f28632cca25ea01c02ab87bc35ec05e72ce932d28858c41b1a1ca167bd09ed42
- 루트 manifest와 실행 파일·로컬 PNG만 포함하며 docs/INSTALL/상위 폴더는 없습니다.
- 검토 소스는 별도 PR, 설치 ZIP은 기존 main/downloads에 게시할 예정입니다. 현재 환경의 GitHub 인증이 HTTP 401로 거부되어 게시를 보류했습니다. 소스를 main에 직접 병합하지 않습니다.

아래는 이전 요금제 표시 수정 배포본입니다.

[요금제 배지 수정 ZIP — 202610142207](https://github.com/han41858/ai-gauge/raw/refs/heads/main/downloads/ai-gauge-202610142207.zip)

- 크기: 70,467 bytes
- SHA-256: 62173b8a13e67822631ef8c3b873a7e6e3ba8a9f6a9f8cefc9505fe33fdae713
- 루트 manifest와 실행 파일·로컬 PNG만 포함하며 docs/INSTALL/상위 폴더는 없습니다.
- 원격 커밋 `d5375224`는 설치 ZIP 한 파일만 추가했습니다. 이 ZIP 게시 당시에는 소스를 갱신하지 않았으며, 이후 사용자 요청으로 해당 수정 소스·문서를 기존 PR #1에 포함합니다. GitHub 다운로드·원본 바이트/SHA-256 일치·ZIP 무결성을 확인했습니다.

아래는 기존 main 배포본입니다.

[설치 ZIP — 202610142100](https://github.com/han41858/ai-gauge/raw/refs/heads/main/downloads/ai-gauge-202610142100.zip)

- 크기: 67,330 bytes
- SHA-256: d47694ca4e3a3ec361dafe5e831c553ca58ec8a2d4133d8ffcc3f3de42322a57
- 루트 manifest·background/content/popup JS·popup HTML/CSS, assets의 16/32/48/128px PNG. docs/INSTALL/상위 폴더 없음.
- 원격 커밋 `0c8fb45`는 ZIP 한 파일만 추가한 배포 커밋입니다. 이후 사용자 요청에 따라 누적 소스·테스트·문서를 main에 통합했습니다. 설치 ZIP의 버전과 바이트는 유지합니다.
- GitHub 다운로드 HTTP 200, 원본 바이트·SHA-256 일치, ZIP 무결성·git diff 공백 검사 통과.

기존 설치 폴더를 새 ZIP 내용으로 교체하고 `chrome://extensions`에서 확장을 새로고침한 뒤 서비스 탭들도 새로고침합니다. 새 외부 배치와 여러 열린 탭의 자동 갱신 결과를 실제 서비스에서 확인해야 합니다.
