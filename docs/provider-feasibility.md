# 사용량 수집 가능성 및 검증 수준

조사일: 2026-10-14. 초기 조사 문서를 **구현 전에** 작성했으며 이후 사용자 수정 명세에 맞춰 OpenAI 데이터를 분리했습니다.

**2026-10-14 사용자가 자신의 Chrome에서 Work / Codex와 Claude 사용량 수집 성공을 확인했습니다.** 이 환경에는 사용자의 Chrome 프로필·세션이 없으므로 개발 에이전트가 실제 API 원문·초기화 시각·사이트 사용량과의 일치를 독립 검증하지는 못했습니다. 공개 코드의 계약, 사용자 확인, 합성 fixture 테스트, 개발 환경의 실측을 구분합니다. 합성 fixture는 실제 API 캡처가 아닙니다.

**최신 사용자 확인:** `202610141801`에서 사용자가 **ChatGPT 홈·채팅과 Claude 홈·채팅의 표시 위치가 정상**임을 확인했습니다. Claude 사용량·리셋 시각과 Work / Codex 사용량도 앞서 사용자 확인을 받았습니다. 반면 같은 빌드에서 Codex 홈·진행 중 작업의 표시줄은 나타나지 않았습니다. 사용자가 확인한 표시 성공과 개발 환경의 실제 API 원문·reset 대조는 별개입니다.

## 현재 플랜 사용량의 의미와 표시 정책

2026-10-14 사용자가 ChatGPT 설정의 다음 문구를 직접 확인해 전달했습니다.

> 플랜 사용 한도
>
> Codex, Work, 워크스페이스 에이전트, Excel용 ChatGPT에서 사용량 한도를 공유합니다. Chat 대화는 사용량에 포함되지 않습니다.

이 문구는 **사용자 계정의 설정 화면 확인**이며 이 환경에서 설정 화면이나 최신 도움말을 직접 읽은 결과는 아닙니다. 이 확인에 따라 플랜 한도와 일반 Chat 대화의 한도를 구분하되, 사용자의 요청으로 일반 ChatGPT 입력창에서도 확인된 플랜 사용량을 보여줍니다.

- 일반 ChatGPT와 Codex 입력창의 표시줄은 같은 `work_codex` 스냅샷을 읽습니다. 외곽선 없이 80×6px 진행 막대와 **`사용량: 15%`**, **`🕒 사용량 초기화: 10/16(금) 09:05, 2d 1h 남음`**을 간격으로 구분하여 표시하며, 두 묶음 사이의 쉼표는 없습니다. `used_percent: 15`는 현재 사용한 비율 15%입니다. 날짜·요일·시각은 브라우저 현지 시간, 남은 일·시간은 버림 계산입니다. 없는 수치·초기화는 확인 불가로 남기고, 만료·실패한 데이터를 현재 값이나 0% 막대로 표시하지 않습니다.
- 일반 채팅 화면에 보인다는 이유로 수집 결과를 `chatgpt` 사용량으로 바꾸거나 별도 성공 기록을 만들지 않습니다. 화면별 복사·중복 수집·합산도 없습니다.
- 공유 한도의 다른 사용처인 워크스페이스 에이전트와 Excel용 ChatGPT를 별도 수집 어댑터나 권한으로 추가하지 않습니다. 현재 수집은 기존 플랜 한도 응답 한 번으로 유지합니다.
- 일반 ChatGPT의 실험적 기능별 관찰을 꺼도 Work / Codex 수집이 켜져 있으면 일반 채팅 표시줄을 사용할 수 있습니다. 표시 여부는 화면별 `strips.chatgpt`와 `strips.work_codex` 설정을 따릅니다. 플랜 수집을 끄면 두 표시줄 모두 그 수치를 표시하지 않습니다.
- 일반 ChatGPT 모델별 사용량은 여전히 미검증입니다. 플랜 데이터가 표시되어도 일반 채팅 수집 검증이 완료된 것으로 보고하지 않습니다. 팝업에는 **ChatGPT·Claude** 제목의 두 카드만 표시하며 **ChatGPT 카드의 출처는 `work_codex` 플랜 데이터**입니다. 실험적인 일반 Chat 수집 카드는 제거했습니다. 내부의 관찰·저장 계약은 유지하며 플랜 한도로 그 스냅샷을 대체하지 않습니다.
- 대표 수치는 응답의 유효한 사용률 중 최댓값을 자동 선택합니다. 과거의 5h·7d 수동 선택은 무시하고 동률은 원래 순서를 유지합니다. 원본 기간·모델별 항목은 팝업에 각각 남기므로 최대 수치를 합계·전체 요금제 소진·모든 모델 차단으로 해석하지 않습니다. 한도가 없으면 새 기간이나 0%를 만들지 않습니다.
- 배지는 탭별 사이트를 기준으로 설정하며 일반 ChatGPT·Codex는 플랜 데이터, Claude는 Claude 데이터로 연결합니다. 무관한 탭이나 URL을 확인할 수 없는 탭에는 숫자를 표시하지 않습니다. 선택된 서비스가 오류·오래된 상태이면 다른 서비스의 정상 수치로 숨기지 않습니다.

### 이번에 직접 읽은 공식 공개 소스

OpenAI의 [`openai/codex` 커밋 `95273b84fbff40f9df7d71d50f1ca52c6489b25d`](https://github.com/openai/codex/commit/95273b84fbff40f9df7d71d50f1ca52c6489b25d)을 확인했습니다. 작성 시각은 `2026-10-14T07:57:45Z`, 커밋 시각은 `2026-10-14T08:05:19Z`이며, 한국 시각으로 커밋은 **2026-10-14 17:05:19**입니다. 이 시각은 코드의 커밋 시각이며 요금 정책의 갱신 시각이 아닙니다.

| 직접 읽은 공식 근거 | 확인 범위 |
| --- | --- |
| [`client/rate_limit_resets.rs`](https://github.com/openai/codex/blob/95273b84fbff40f9df7d71d50f1ca52c6489b25d/codex-rs/backend-client/src/client/rate_limit_resets.rs#L124-L128) | 같은 함수가 API 종류에 따라 `/api/codex/usage` 또는 `/wham/usage`를 선택합니다. ChatGPT 도메인의 경로라는 이유만으로 일반 Chat 모델별 사용량은 아닙니다. |
| [`client.rs`](https://github.com/openai/codex/blob/95273b84fbff40f9df7d71d50f1ca52c6489b25d/codex-rs/backend-client/src/client.rs#L615-L650) | 기본 `payload.rate_limit`은 `limit_id: "codex"`로 정규화하고, 추가 한도는 `metered_feature`와 `limit_name`을 별도로 유지합니다. |
| [`protocol.rs`](https://github.com/openai/codex/blob/95273b84fbff40f9df7d71d50f1ca52c6489b25d/codex-rs/protocol/src/protocol.rs#L2517-L2533) | `used_percent` 주석은 “Percentage (0-100) of the window that has been consumed.”, `resets_at`은 “Unix timestamp (seconds since epoch) when the window resets.”입니다. 사용 비율과 초기화 시각의 단위를 확인했습니다. |

공식 소스는 위 응답 의미의 근거이며, 일반 Chat의 모든 한도나 Work·Excel 등 각 제품의 최신 요금 정책까지 입증하지는 않습니다. [Codex 플랜 공식 도움말](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)은 이번에도 프록시가 CONNECT 403으로 차단하여 읽지 못했고 우회하지 않았습니다. 공유 사용처와 Chat 제외는 위 사용자 확인 문구를 근거로 기록합니다.

### 표시 위치와 검증 한계

사용자가 제시한 구조에 맞춰 Claude는 `div.bg-surface-3` 안의 `div.relative.w-full.min-w-0` 또는 전달받은 철자 `mni-w-0` 래퍼 뒤에 표시줄을 넣습니다. 편집 가능한 영역 안에는 삽입하지 않습니다. Codex는 클래스 토큰이 `ComposerLayoutFooter-`로 시작하는 footer의 **마지막 자식**으로 넣으며, 동적으로 바뀌는 클래스 접미사는 고정하지 않습니다. 맞는 구조가 없으면 기존의 안전한 입력창 탐색을 사용합니다.

사용자는 `202610141801`의 ChatGPT·Claude 위치는 확인했지만 Codex에서는 계속 표시되지 않는다고 보고했습니다. 실제로 `/codex/cloud`를 열면 `https://chatgpt.com/`로 이동하며, 전달받은 진단은 `contentReady: true`, `provider: "chatgpt"`, `targetFound: false`, `stripCount: 0`이었습니다. 스크립트가 없는 상태와 구분하여, 이번 수정은 **허용된 ChatGPT 호스트의 명시적인 `ComposerLayoutFooter-` 구조**가 있으면 URL이 `/`여도 화면 맥락을 Codex로 판별합니다. 도메인·프로토콜·메시지 권한 검증을 완화하지 않습니다.

새 판별 로직과 문구·외곽선 변경은 합성 DOM 및 브라우저 fixture로 검증하며 **이번 수정 후 실제 Codex 홈·진행 중 작업 화면은 아직 미검증**입니다. 사용자 확인을 최신 코드의 실제 화면 검증으로 확대하지 않습니다. 팝업의 로컬 진단은 현재 활성 사이트의 입력 요소·iframe·표시줄 개수, 대상 탐색 성공 및 표시줄 가시성 같은 제한된 수치·불리언을 제공하며 원본 DOM·클래스명·텍스트·URL·계정 정보를 반환하지 않습니다.

팝업은 520px 폭을 유지하며 ChatGPT·Claude 제목과 간단한 관리 버튼을 표시합니다. 실험 카드·카드별 상세·항목 선택·정상 수집 시각·다음 갱신 시각·반복 성공 안내는 제거하고 오류·미수집·오래된 데이터 안내는 유지합니다. 설정은 일반 ChatGPT·Codex·Claude의 입력창 표시 체크박스 세 개뿐입니다. 이는 표시 정리이며 새 사용량 API나 일반 Chat 모델별 수집 검증의 추가가 아닙니다. 앱 아이콘은 사용자 제공 `assets/logo.png`를 크기별로 줄여 사용하고 입력창에는 `assets/logo-20x20.png`를 그대로 사용합니다.

기본 개발 빌드에서는 로컬 진단을 유지하고 `build:release`의 `--release` 빌드에서는 진단 UI와 핸들러를 비활성화합니다. 설치 ZIP은 `manifest.json`이 루트에 있는 실행 파일 7개와 16/32/48/128px 로컬 앱 아이콘을 포함하며 문서·INSTALL·상위 폴더는 넣지 않습니다. `npm run package`는 현재 검증한 dist를 다시 빌드하지 않고 그대로 묶습니다. 배포마다 새 브랜치를 만들지 않으며, 접근 가능한 GitHub Releases 또는 기존 `main`의 `downloads/`에 검증한 ZIP만 게시합니다. 같은 ZIP 재제공에는 재빌드·재패키징 없이 원본 파일을 사용합니다. ZIP 끌어 설치는 실측하지 못했으므로 성공을 단정하지 않으며, 실패하면 압축을 풀어 manifest가 있는 루트 폴더를 로드합니다.

개발 빌드의 표시 버전은 빌드 시작 시각을 **한국 시간 `YYYYMMDDHHmm`**으로 생성합니다. Chrome 내부 `version`은 같은 시각을 앞자리 0 없는 `YYYY.M.D.HHmm`으로 표현합니다. 아래의 0.1.1·0.1.3 표기는 과거 조사·배포를 가리키며 이후 개발 버전을 수동 증가시키지 않습니다.

## 0.1.3 재조사와 미확보 항목

[CodexBar 후속 조사](https://github.com/steipete/CodexBar/issues/3436#issuecomment-5649161130)와 [Codex 클라이언트 조사](https://github.com/openai/codex/issues/42531#issuecomment-5669704907)를 다시 확인했습니다. 일반 ChatGPT의 정상 사용 도중 정확한 잔여량·초기화 시각을 지속적으로 반환하는 계약을 확보하지 못했습니다. init의 문맥 없는 probe가 빈 응답을 반환한 사실만으로 모든 계정에서 영구적으로 불가능하다고 단정하지도 않습니다. 대화 개수·로컬 요청 횟수·Work / Codex 수치를 일반 ChatGPT 사용량으로 바꾸지 않습니다.

0.1.3은 “새로고침 후 응답을 기다리라”는 성공을 기대하게 하는 안내를 제거합니다. 정상 init JSON 객체에서 한도 필드가 누락되거나 null이면 표시할 한도가 없는 상태로, 잘못된 객체나 필드 타입은 응답 오류로 처리합니다. 빈 관찰로 새로운 정상 수집 시각을 만들지 않습니다. 새 endpoint·추가 네트워크 요청은 도입하지 않았고, 실제 계정 응답·reset 대조는 미실시입니다.

## 서비스별 결론

| 대상 | 조사에서 확인한 내용 | 현재 구현 | 실제 계정 검증 |
| --- | --- | --- | --- |
| ChatGPT 일반 채팅 | 공개 응답 예시의 `limits_progress`에 기능별 `feature_name`, `remaining`, `reset_after`가 있음. **모든 모델의 사용률/잔여 메시지를 지속적으로 제공하는 계약은 미확인** | 0.1.1에서 추가한 init JSON 제한적 관찰은 내부의 별도 데이터로 유지하며 실험 카드는 팝업에서 제거. 일반 채팅 입력창은 `work_codex` 플랜 한도를 표시하며 이를 일반 Chat 사용량으로 저장하지 않음 | 미실시. 실제 페이지가 해당 필드를 반환하는지·계정별 모델 범위·초기화 일치 확인 필요 |
| Work / Codex 공유 풀 | 공개 코드에 `/api/auth/session` → GET `/backend-api/wham/usage`; 공식 Codex 코드에서 기본 한도·사용 비율·Unix 초 초기화 단위 확인. 공유 사용처와 Chat 제외는 사용자 설정 문구 확인 | 단일 `work_codex` 어댑터·저장 키·카드. 열린 `chatgpt.com` 탭의 MAIN world에서 GET, 허용 필드만 반환. 일반 채팅과 Codex 입력창에서 같은 스냅샷 표시. 중복 수집·합산 없음 | **사용자 수집 성공 확인**. 원문 응답·계정별 차이·reset 일치의 개발 환경 독립 검증은 미실시 |
| Claude | GET `/api/organizations` 및 GET `/api/organizations/{uuid}/usage`; `five_hour`, `seven_day`, `seven_day_*`의 `utilization`, `resets_at`; `limits[]`의 모델별 percent | 열린 탭의 동일 출처 GET. 복수 조직은 임의 선택 없이 `ambiguous_account`. 제공된 항목만 정규화 | **사용자 사용량·리셋 시각 및 `202610141801` 홈·채팅 위치 확인**. 원문 응답·요금제/조직 차이·reset 일치의 개발 환경 독립 검증은 미실시 |
| Gemini | `jSf9Qc` 사용량 RPC와 `otAQ7b` 정책 RPC의 이름 및 일부 배열 파서는 공개. 요청 URL 생성·RPC envelope 디코딩은 비공개 `vendor-ai/gemini-batch.js`에 의존 | **v1.0 제외**. 카드·설정·권한·어댑터·런타임 파서 없음 | 미실시. 안전한 독립 RPC 계약 확보 안 됨 |

## OpenAI 데이터 분리와 미확인 항목

- 사용자 설정 화면의 공유 범위는 Codex·Work·워크스페이스 에이전트·Excel용 ChatGPT이며 **Chat 대화는 제외**입니다. 기존 사용자 수정 명세의 공유 크레딧 및 Pro $100/$200/$500의 5시간 제한 부재는 이번 환경에서 최신 공식 도움말이나 실제 API로 독립 검증하지 않았습니다.
- 구현에는 요금제 가격·모델 이름으로 제한을 생성/억제하는 분기가 없습니다. 서버가 7일 창만 주면 7일만, 다른 창을 주면 그 길이대로 표시합니다. 항목이 없으면 5시간 행을 생성하지 않습니다.
- `/wham/usage`를 ChatGPT 일반 채팅 모델별 사용률로 취급하지 않습니다. 공식 Codex 클라이언트도 기본 풀을 `codex`로 정규화합니다. 일반 채팅 화면에도 표시하지만 데이터 출처와 의미는 플랜 한도 그대로입니다.
- 기본 제한과 `additional_rate_limits`는 별도 원본 항목으로 표시하고 서로 더하지 않습니다. 두 제품을 각각 호출해 중복 집계하는 경로가 없습니다.
- **공유 크레딧 잔액 계약은 아직 검증되지 않았습니다.** `credits_would_enable`은 잔액이 아니며, `rate_limit_reset_credits`는 초기화 패스라서 사용 크레딧 풀과 섞지 않습니다. 잔액·과금·credit→percent 환산은 구현하지 않았고 0으로 표시하지 않습니다.
- 일반 ChatGPT는 아래의 공개 근거가 있는 기능별 잔여 수치만 제한적으로 관찰합니다. 모델별 총량·사용률·항상 표시되는 잔여 메시지 수는 확보하지 못했으며 완전한 모델별 수집으로 보고하지 않습니다.

## 0.1.1 일반 ChatGPT 추가 조사와 구현 경계

조사일: 2026-10-14. 다음 근거를 확인한 뒤 제한적 관찰기·파서를 구현합니다. 아래 게시물은 제삼자의 공개 관찰이며 이 환경에서 실제 계정 응답을 재현했다는 뜻이 아닙니다.

| 공개 근거 | 확인 내용 | 적용 범위 |
| --- | --- | --- |
| [CodexBar #3436 원문 및 후속 조사](https://github.com/steipete/CodexBar/issues/3436) | `POST /backend-api/conversation/init`에서 소진 시 `blocked_features`, `model_limits`, 한도와 reset 정보가 보고됨. 초기화 후·사용 도중에는 비어 있고 일반적인 잔여 카운터가 없었다는 관찰. 후속 조사는 대화 이력의 assistant-final 수가 실제 차감과 일치하지 않음을 확인 | 정상 페이지의 init 응답만 관찰. 빈 배열을 한도 무제한이나 0%로 해석하지 않음. 대화 이력 재구성·요금제별 고정 카운트는 사용하지 않음 |
| [OpenAI Codex #42531의 클라이언트 조사](https://github.com/openai/codex/issues/42531#issuecomment-5669704907) | init 메타데이터가 `limits_progress`를 포함하고 `feature_name: reason`의 `remaining`을 읽는 클라이언트 동작이 보고됨 | 기능명이 모델명과 같다는 추정 없음. `reason`을 특정 모델 하나의 한도로 변환하지 않음 |
| [Proxyman #1323의 공개 응답 예시](https://github.com/ProxymanApp/Proxyman/issues/1323#issuecomment-2943501314) | 메타데이터 예시에 `limits_progress: [{feature_name: "deep_research", remaining: 25, reset_after: "2025-07-05T06:44:10.212026+00:00"}]`가 있음 | 세 필드의 이름·타입·타임존 의미만 사용. 예시의 25나 날짜는 제품 상수로 사용하지 않음. 예시는 SSE에서 나온 것이지만 구현은 대화/SSE 본문을 읽지 않음 |
| [ChatGPT Model Usage Monitor](https://github.com/tizee-tampermonkey-scripts/tampermonkey-chatgpt-model-usage-monitor), [Usage Limit Tracker](https://github.com/andyli0123/chatgpt-usage-limit-tracker), [Model Meter](https://github.com/pfz14/chatgpt-model-meter) | 앞의 두 프로젝트는 로컬 요청 카운트·고정/사용자 설정 한도를 사용. 마지막 프로젝트의 사용량 게이지는 Work / Codex endpoint 사용 | 일반 채팅의 정확한 서버 사용량 근거로 채택하지 않음 |

관찰기는 승인된 `https://chatgpt.com` 탭에서만 설치합니다. 페이지가 **이미 보내는** 정확한 `/backend-api/conversation/init` 요청의 JSON 응답에서 `limits_progress`의 허용 필드만 추립니다. 새 요청·메시지 전송·세션 토큰 조회·요청 body/headers 읽기·대화 목록/상세/SSE 조회는 하지 않습니다. 원본 응답을 저장하거나 확장에 반환하지 않습니다. 페이지 내부의 버전 있는 캐시에는 관찰 시각과 정제된 한도만 남기며, 확장 측에서 다시 검증합니다. 정상적으로 관찰한 빈 배열은 이전 한도 캐시를 지웁니다. 캐시를 다시 읽었다고 최신 수집으로 표시하지 않습니다.

`remaining`은 서버가 제공한 유한한 음이 아닌 정수만 받아 **잔여 수치**로 정규화합니다. 총량·단위는 응답에 없으므로 `percent`와 `unit`는 항상 `null`이며, 임의로 메시지 수나 크레딧으로 해석하지 않습니다. 현재 팝업에서는 이 실험 카드를 표시하지 않습니다. `reset_after`는 이름과 달리 공개 예시에서 타임존 있는 절대 시각 문자열이며, 숫자·타임존 없는 문자열을 임의 환산하지 않습니다. `blocked_features`와 `model_limits`는 정확한 중첩 구조·의미가 충분히 확인되지 않아 파싱하지 않습니다. 누락/빈 한도·새 구조는 확인 불가로 남깁니다.

이 구현은 **ChatGPT의 모든 모델 사용량을 수집했다는 의미가 아닙니다.** 사용자 계정에서 해당 init 필드가 실제 반환되는지 확인이 필요하며, 모델별 수집·정확한 reset 대조는 여전히 미검증입니다. 기존 설정으로 관찰기가 켜진 경우 새 버전 설치 후 일반 ChatGPT 탭을 새로고침하면 다음 자연스러운 init 응답을 관찰할 수 있으나, 기능별 수치가 없으면 내부 스냅샷은 확인 불가로 남습니다. 현재 팝업의 플랜 카드나 입력창 수치로 이 상태를 대체하지 않습니다.

## 출처와 비공개 모듈 / 백엔드 구분

참고 저장소: [chaehyun2/claudetuner](https://github.com/chaehyun2/claudetuner), 조사 커밋 `9b94ac3c412732d88cc5a570f0dfe0603d1fc71c`.

| 공개 파일 | 확인한 사실 | AI Gauge 선택 |
| --- | --- | --- |
| `README.md` Manual install | 비공개 `vendor-ai/` 누락으로 공개 clone 그대로는 service worker import 실패 | 포크·소스 복사 없이 새 MV3/TypeScript 구현 |
| `bg/api-chatgpt.js`, `bg/parse-chatgpt.js` | session bearer를 MAIN world 안에서 사용하는 경로와 window 파서 공개; 사이트 상수·쿠키 판별은 비공개 | 쿠키 추출 fallback 없음. 고정 읽기 전용 함수의 일시적 bearer만 사용. 일반 채팅으로 오인하지 않음 |
| `bg/api.js`, `bg/parse-claude.js`, `bg/claude-usage-path.js` | 동일 출처 GET 및 사용량 shape 공개; 조직 선택·사이트 상수는 비공개 | 단일 조직만 사용. 추가 reset-pass flag·CDN remote flags 사용 안 함 |
| `bg/api-gemini.js`, `bg/parse-gemini.js`, `bg/collect-gemini.js` | AT token 이용, RPC 이름·배열 shape 공개; URL/프레이밍은 비공개 | 제외. 전체 HTML에서 토큰 찾기 fallback도 채택하지 않음 |
| `bg/collect*.js`, `bg/storage.js` | `/api/snapshots`, 계정 연결·팀 분석·이력·추천/동기화 서버 기능 존재 | 전부 범위 밖. 로컬 사용량 GET·정규화·배지·표시줄 자체에 별도 백엔드는 필수가 아님 |

라이선스는 MIT, Copyright (c) 2025-2026 Claude Tuner Contributors. 원본 코드·파일은 재사용하지 않았고 공개 요청/응답 계약만 조사해 독립 작성했습니다. 향후 코드 재사용 시 MIT 원문과 저작권 고지를 유지해야 합니다.

## 인증·CORS·MV3·프라이버시

- 필수 권한: `storage`, `alarms`, `scripting`. optional 호스트: `https://chatgpt.com/*`, `https://claude.ai/*`.
- ChatGPT·Work / Codex는 호스트 권한 하나를 공유하되 수집 켜기·스냅샷은 분리합니다. 일반 채팅과 Codex의 표시줄은 화면별 설정을 따르며 같은 `work_codex` 플랜 데이터를 참조합니다.
- Work / Codex·Claude는 승인된 호스트의 열린 탭에서 고정된 MAIN-world 함수로 동일 출처 GET을 실행합니다. 일반 ChatGPT는 페이지 자체의 init 응답을 수동적으로 관찰합니다. extension-origin cross-origin fetch/CORS에 의존하지 않습니다. 실제 사이트 CSP·SameSite·보호장치와의 호환은 서비스별로 구분해 확인해야 합니다.
- ChatGPT session bearer는 함수 내부에서 Authorization에만 일시적으로 사용하며 반환·영구 저장·로그하지 않습니다. Claude 조직 UUID도 함수 내부에만 있고 브라우저가 기존 세션 쿠키를 자동 포함합니다.
- `cookies`, `tabs`, `webRequest`, 전체 사이트 권한, 쿠키 헤더 직접 구성, 임의 URL/메서드 요청은 없습니다.
- MAIN world는 페이지가 영향을 줄 수 있는 신뢰 경계입니다. 반환을 허용된 필드로 축소하고 확장 측 파서로 재검증합니다. 원본 session/계정/이메일/응답 body·예외 텍스트는 저장하거나 로그하지 않습니다.
- 수집 가능한 탭이 없으면 `open_tab`, 탭에 코드를 실행하지 못하면 `tab_access_failed`로 구분합니다. 마지막 활성 창의 허용된 서비스 탭을 우선 사용하고 실패 후 다른 계정 탭을 순회하지 않습니다. 403이면 접근 거부를 기록하고 우회하지 않습니다.
- content script는 입력 요소·중지 버튼·사용자가 지정한 래퍼/footer의 존재와 레이아웃을 검사합니다. 진단은 구조의 개수·탐색 성공·가시성만 반환하고 입력/대화 텍스트·첨부·이력·원본 DOM은 읽어 반환하지 않습니다.

## 실패 상태 검증

아래는 합성 응답·Chrome API mock 테스트이며 실제 계정 상황 재현이 아닙니다.

| 조건 | 상태와 대응 |
| --- | --- |
| 선택 호스트 권한 없음 | permission_required; 네트워크 없음 |
| 401 / session bearer 없음 | signed_out; 자동 재요청 중단, 로그인 후 수동 갱신. 로그아웃과 세션 만료를 401만으로 구분 불가 |
| 403 | error/access_denied; 인증 실패로 단정하지 않고 우회 없음 |
| 429 | rate_limited; Retry-After 및 지수 백오프. 수동 요청도 대기 준수 |
| fetch 실패 / timeout / 5xx | error; 백오프, 마지막 정상 값·시각 보존 |
| 구조 변경 / 비유효 데이터 | invalid_response 또는 해당 필드 null. 없는 사용률을 0으로 생성하지 않음 |
| 일반 ChatGPT 한도 미관찰 / 정상 응답에 한도 없음 | error/chatgpt_usage_pending 또는 chatgpt_quota_absent; `chatgpt` 스냅샷을 플랜 수치로 대체하거나 새로운 정상 수집 기록을 만들지 않음. 일반 채팅 표시줄은 별도로 `work_codex` 스냅샷을 참조 |
| Claude 복수 조직 | ambiguous_account; 임의 조직·계정 선택 없음 |

## 외부 문서·정책 한계

Chrome 공식 network/scripting/permissions 문서를 읽으려 했으나 egress proxy가 `developer.chrome.com`에 CONNECT 403을 반환했습니다. OpenAI/Anthropic/Google 약관 URL도 이 환경에서 읽지 못했습니다. 최신 약관이나 스토어 심사를 검토 완료했다고 주장하지 않습니다. 내부 웹 API는 비공식이며 계약이 예고 없이 바뀔 수 있습니다. 자동 조회와 MAIN-world 삽입의 약관 허용, 최소 권한/개인정보 고지의 Chrome Web Store 적합성을 공개 배포 전에 별도 검토해야 합니다.

확인할 공식 문서: [Chrome network](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions), [OpenAI terms](https://openai.com/policies/terms-of-use/), [Anthropic terms](https://www.anthropic.com/legal/consumer-terms), [Google terms](https://policies.google.com/terms), [Chrome Web Store user data](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

이 환경의 Chromium에서는 실제 확장 로딩이 **관리자 정책으로 비활성화**되어 있습니다. `Extensions.loadUnpacked`가 해당 오류를 반환했고 제한을 우회하지 않았습니다. 합성 UI 검증은 설치·권한·로그인 검증과 구분합니다. 실행 결과와 실사용 체크리스트는 [validation.md](validation.md)에 정리합니다.
