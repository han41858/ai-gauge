# 구현 및 검증 결과

검증일: 2026-10-14 (Asia/Seoul). 최종 개발 빌드 **202610142031**, Chrome 내부 버전 **2026.10.14.2031**.

## 사용자 응답으로 재현한 Gemini 프레임 오류 수정

- 사용자 확인: `202610142022`에서도 `gemini_frame_invalid`였으며 HTTP 200 JSON의 전체 응답을 제공했습니다. 선언 길이 207/25는 JSON 205/23자에 앞뒤 LF를 포함합니다.
- `src/providers/gemini-transport.ts`: 길이에 포함된 마지막 LF를 이미 읽은 뒤 추가 공백을 요구하던 조건을 제거했습니다. 다음 프레임의 길이 표식은 계속 검증합니다. 마지막 완전한 JSON에서 종료 LF 한 개만 생략된 경우를 제한적으로 허용합니다.
- `tests/fixtures/gemini-batchexecute-observed-redacted.txt`: 실제 제공 응답의 사용량·프레임 구조·길이를 유지하고 사용량과 무관한 메타데이터 식별 문자열만 같은 길이의 0으로 대체했습니다.
- `tests/gemini-transport.test.ts`: 회귀 5개를 추가했습니다. 동일 fixture의 마지막 LF 유무 모두 기존 HEAD는 `gemini_frame_invalid`, 수정 함수는 두 사용량 창을 반환하는 것을 Chrome120 변환·직렬화 VM에서 재현했습니다.
- 제공 응답 해석: 주간 **0.04305%**, 초기화 **2026-10-20T05:05:27.343Z**; 5시간 **1%**, 초기화 **2026-10-14T13:05:27.343Z**. 메타데이터와 단위 미확인 잔여 수는 반환하지 않습니다.
- 인접 LF/CRLF 프레임, 두 길이 관례, XSSI, EOF, 후속 내부 제한 오류 우선, 후행 쓰레기·중복·잘린 JSON 거절을 검사했습니다. 코드·권한·UI 범위 확대 없이 명세와 수집 근거를 갱신했습니다.
- 실제 전송에 마지막 LF가 없었는지 채팅 복사에서 사라졌는지는 미확인입니다. 로컬 응답 재현 통과 후 사용자가 수정본의 실환경 수집 성공을 확인했습니다. 입력창별 배치와 웹앱 수치·초기화 시각의 세부 대조는 별도 확인 대상입니다.

## 이번 변경

| 영역 | 주요 파일 | 구현 내용 |
| --- | --- | --- |
| Gemini 수집 | src/providers/gemini.ts, gemini-parser.ts, gemini-transport.ts | jSf9Qc 동일 출처 RPC, 제한된 페이지 내부 토큰 사용, XSSI·길이 프레임·wrb.fr·중첩 JSON, 5시간/주간 비율·초기화 검증 |
| 공통 수집·저장 | src/shared/types.ts, display-policy.ts, contracts.ts, src/storage/settings.ts, snapshots.ts, src/background/index.ts, content-registration.ts, scheduler.ts | Provider 세 개와 표시 위치 네 개 분리, 기존 공유 플랜 설정·스냅샷 일회성 이전, Gemini 독립 권한·백오프·재시작 복구 |
| UI | src/popup/*, src/background/badge.ts, src/content/* | Gemini 세 번째 카드·네 번째 표시 토글·탭별 파랑 배지, 공통 30px/12px/20px 표시줄, 기존 테마·최대 사용률 정책 유지 |
| 빌드 | manifest.json, scripts/build.mjs, audit-build.mjs, package.mjs | Gemini 선택 호스트 하나 추가, 폐기 관찰기 번들 제외, 로컬 런타임 6개+아이콘 4개 ZIP |
| 문서 | AI_GAUGE_SPEC.md, AGENTS.md, README.md, docs/installation.md, permissions.md, provider-feasibility.md | 실제 구현 기준 정리, 폐기 설정 삭제, Gemini 개발·미검증 상태와 배포 범위 명시 |
| 검증 | tests/gemini-*.test.ts, tests/storage-migration.test.ts 및 기존 회귀, scripts/browser-fixture.mjs | RPC·오류·마이그레이션·표시·권한·Chrome API mock 회귀 |

ChatGPT 일반 채팅과 Codex는 기존 플랜 수집 결과 하나를 사용합니다. 일반 채팅 모델별 사용률이나 별도 Codex 수집을 추가하지 않았습니다. 과거 실험 관찰기는 제거하고 기존 등록·열린 탭 정리만 호환 처리합니다.

Gemini의 remaining은 단위가 불명확하므로 표시·저장 결과에 메시지 수로 넣지 않습니다. 확인된 비율과 초기화 시각만 사용하며 누락된 값은 null로 유지합니다.

## 문서 정리

- 배지 대상 선택, 사용률 임계치 색상 전환, 수집 시각·갱신 주기 사용자 설정을 요구사항에서 제거했습니다.
- 현재 팝업·탭별 자동 배지·서비스 대표색·자동 최대 사용률·공통 표시 문구로 명세를 맞췄습니다.
- 내부 수집/재시도 시각과 고정 10분 갱신은 동작을 위해 유지하며 사용자 설정과 구분했습니다. 저장 호환용 과거 설정 필드도 UI 기능으로 설명하지 않습니다.
- 사용자 확인, 합성 fixture 통과, 개발 환경의 직접 로그인 검증 미실시를 구분하고 폐기된 계획을 정리했습니다.
- 원격 main의 최신 README에 추가된 로고·간결한 소개를 보존하고 자세한 설치·사용 안내는 로컬 docs/installation.md로 분리했습니다.
- 코드·문서 원격 반영과 PR 생성은 최신 사용자 지시에 따라 보류합니다. 승인된 설치 ZIP만 기존 main/downloads에 게시합니다.

## 자동 검사 결과

| 검사 | 결과 |
| --- | --- |
| npm run check | 통과: TypeScript strict, **329개 테스트**, 개발 빌드, 산출물 권한·목적지 검사. 실패/취소/스킵 0 |
| node scripts/browser-fixture.mjs | 이전 **202610142007** 빌드 통과. 세 카드·네 표시 토글, 밝은/어두운 테마, 520/390/320px 팝업, 30px 표시줄, 64회 시간 간격 DOM 변경에서 안정성. 이번 전송 파서 수정에서는 재실행하지 않았으며 UI 회귀는 전체 자동 테스트로 검사 |
| Gemini 파서·전송·진단 | **27개 통과**. 실제 응답 기반·메타데이터 비식별 fixture와 합성 fixture 구분. 실제 0/null, 5시간/주간, 초·나노초/UTC, 인접 프레임·종료 LF, 줄별 JSON, 누락·손상·중복·잘못된 비율·RPC 내부 오류·401/403/429·timeout·1MiB 상한·고정 진단 코드 |
| Gemini 권한·수명 | 승인 후 팝업 종료에도 활성화, 거부, 진행 중 비활성/철회, Retry-After의 새 워커 복원, 중복 갱신 병합 |
| 저장 이전 | 기존 work_codex의 정상 값·꺼짐 상태·ChatGPT/Codex 표시 설정 보존, Claude 캐시 유지, Gemini 기본 off. 실험 ChatGPT 데이터는 읽거나 승격하지 않음 |
| 표시 회귀 | ChatGPT/Codex 동일 데이터, Claude 기존 위치·진행 막대 17→17.25→63, Gemini 같은 막대 42→42.25→63·중복 방지·기존 입력 불변·권한 철회 |
| 전송 경계 | Chrome120 변환 함수를 빈 VM에 직렬화하여 closure 없이 실행. 세 서비스 모두 고정 절대 URL을 사용해 외부 document base가 요청 대상을 바꾸지 못함 |
| 정식 빌드·ZIP | 테스트에서 진단 UI/응답 제외, 루트 manifest와 런타임 6개+로컬 PNG 4개, 버전/바이트/무결성/기존 파일 덮어쓰기 거부 검사 |
| git diff --check | 통과 |

Node.js 24.19.0 / npm 11.9.0 / Chromium 154.0.8037.57. 브라우저 fixture는 합성 페이지·Chrome API mock·localhost 출처 치환을 사용합니다. 로그인한 계정/API 검증이 아닙니다.

## 실사용 검증 범위

사용자는 이전 빌드에서 OpenAI 플랜 및 Claude 수집·리셋 시각, ChatGPT·Claude 홈/채팅 표시, 최근 팝업·아이콘·서비스 배경색을 확인했습니다. 저장 마이그레이션과 세부 계정 상태는 자동 테스트 결과와 구분합니다.

**2026-10-14 사용자 확인:** 빌드 `202610142031` 안내 후 “오.. Gemini도 성공했어.”라고 보고했습니다. 이전 프레임 오류 수정 후 Gemini 실환경 사용량 수집 성공으로 기록합니다. 개발 환경에서 로그인 세션을 직접 실행한 결과는 아니며, 모든 페이지 배치·수치 대조·계정 상태까지 확인한 것으로 확대하지 않습니다. 이 확인 반영은 문서만 수정했으며 재빌드·새 ZIP 배포는 하지 않았습니다.

이 환경에는 로그인한 사용자 Chrome 세션이 없으며 unpacked 확장 로딩도 관리자 정책으로 차단되었습니다. 다음은 **미검증**입니다.

- Gemini 웹앱과 표시 사용량·초기화 시각의 세부 대조
- Gemini의 다른 계정·세션 만료·페이지 전환·입력창/응답 완료 버튼 구조
- 실제 Chrome 업그레이드·권한 승인 창·서비스 워커 재시작·세 사이트 툴바 표시
- 최신 Codex 홈/진행 작업의 실제 표시 위치

Gemini는 토큰을 안전하게 구할 수 없으면 unsupported입니다. 여러 Google 계정의 RPC 대상 선택 계약이 확인되지 않아 /u/1 또는 authuser=1 같은 비기본 계정 경로는 요청하지 않습니다. /u/0·authuser=0도 실제 계정 일치는 추가 검증해야 합니다. HTML 로그인 페이지를 정상 사용량으로 해석하지 않고 보호장치를 우회하지 않습니다.

## 설치 결과물

[설치 ZIP](https://github.com/han41858/ai-gauge/raw/refs/heads/main/downloads/ai-gauge-202610142031.zip)

- 크기: 66,362 bytes
- SHA-256: 4a4e51309382dd68e8a8aa5f05fd101a9640496882f052d57f5277c6904fe04d
- 구성: 루트 manifest·background/content/popup JS·popup HTML/CSS, assets의 16/32/48/128px PNG. docs/INSTALL/상위 폴더 없음.
- 원격 커밋 `9ea82ca`는 ZIP 한 파일만 추가했습니다. 기존 README·명세·로고와 다른 파일을 보존했습니다. GitHub 다운로드 HTTP 200, 원본 바이트·SHA-256 일치, ZIP 무결성 검사를 통과했습니다. 소스·문서 개발 브랜치는 푸시하지 않았고 PR은 생성하지 않았습니다.

설치 후 확장과 사이트 탭을 새로고침하고 Gemini 카드에서 권한을 승인합니다. 기본 Google 계정의 Gemini에서 갱신한 뒤 사이트 사용량 화면과 비율·초기화를 대조하고, 홈/대화 입력창 위치·갱신·로그아웃 상태를 확인해야 합니다.

기존 실패의 재시도 대기 시간이 업데이트 후에도 유지됩니다. 바로 갱신되지 않으면 진단의 `nextAttemptAt` 이후 새로고침하고 `checkedAt`이 갱신됐는지 확인합니다. 새 코드로도 실패하면 고정된 `errorCode`만으로 파싱 단계를 구분할 수 있습니다. 응답 원문이나 인증정보는 진단에 포함하지 않습니다.
