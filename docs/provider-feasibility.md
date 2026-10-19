# 사용량 수집 가능성 및 검증 수준

조사일: 2026-10-14. 초기 조사와 Gemini 사전 게이트를 **각 구현 전에** 기록했으며 현재 명세 v1.2에 맞춰 갱신했습니다. 제공자는 `chatgpt | claude | gemini` 세 개입니다. Codex는 별도 제공자·사용량 풀이 아니라 ChatGPT 데이터를 사용하는 표시 위치입니다. 일반 ChatGPT 모델별 한도 수집을 검증했다는 의미는 아닙니다.

## 서비스별 결론

| 제공자 | 사용량 출처와 현재 구현 | 실제 계정 검증 |
| --- | --- | --- |
| ChatGPT | `/api/auth/session` → GET `/backend-api/wham/usage`. 열린 탭 MAIN world를 우선하고 탭이 없을 때 같은 수집기를 워커에서 실행. 일반 ChatGPT와 Codex는 하나의 플랜 스냅샷 사용 | 사용자가 이전 빌드의 플랜 사용량 수집을 확인. 새 탭 없는 요청, 개발 환경의 API 원문·계정별 reset 대조는 미실시 |
| Claude | GET `/api/organizations` → GET `/api/organizations/{uuid}/usage?cedar_ember=1`. 열린 탭 우선, 탭이 없으면 워커 조회. 기존 사용량 파서를 재사용하고 복수 조직은 `ambiguous_account` | 사용자가 기존 사용량·리셋 시각과 홈/채팅 표시를 확인. 새 탭 없는 요청, 원문·요금제/조직별 대조는 미실시 |
| Gemini | `jSf9Qc` 읽기 전용 RPC와 선택적 `otAQ7b` 정책 조회. 열린 탭 우선, 탭이 없으면 `/app` bootstrap 후 같은 RPC·파서 사용. 비공개 vendor·대화 이력·계정 조회 없음 | 202610142031 안내 후 사용자 실환경 수집 성공 확인. 새 탭 없는 요청, 웹앱 초기화 일치·입력창별 DOM은 별도 확인 필요 |

각 서비스의 정상 값, 미확인 값, 수집 실패, 신뢰할 수 없는 이전 수집값을 구분합니다. 정상 캐시의 시간 경과만으로 경고하지 않습니다. 실제로 받은 창만 표시하며 별도 백엔드 없이 브라우저 로컬에서 수집·저장·표시합니다.

현재 요금제도 팝업에서 별도로 표시합니다. ChatGPT·Claude는 기존 응답의 메타데이터, Gemini는 선택적 `otAQ7b` 정책 RPC를 사용합니다. 정책 조회 실패는 정상 사용량에 영향을 주지 않습니다. 공개 계약과 합성 fixture를 기준으로 구현했으며 실제 계정 요금제 표시는 별도 검증 대상입니다. 근거·식별자·계정 전환 처리의 한계는 [plan-detection.md](plan-detection.md)를 참고하세요.

## v1.2 Gemini 독립 수집 사전 검증

2026-10-14 명세 v1.2에 사용자가 제공한 **Gemini 웹앱의 실제 Network 관찰**이 추가되어 이전의 v1.0 제외 결정을 갱신합니다. 확인된 호출은 `POST https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=jSf9Qc&source-path=%2Fusage&rt=c`, RPC 파라미터는 `[]`입니다. `wrb.fr` 내부 JSON은 다음과 같습니다. 이는 사용자 제공 관찰이며 개발 환경에서 독립 호출에 성공했다는 뜻은 아닙니다.

```json
[1,[[12096,0,2,[[1792472727,343404000]]],[600,0,1,[[1791983127,343263000]]]],false,[[true]]]
```

| 직접 확인한 공개 자료 | 확인 범위와 채택 여부 |
| --- | --- |
| [Claude Tuner `api-gemini.js`](https://github.com/chaehyun2/claudetuner/blob/9b94ac3c412732d88cc5a570f0dfe0603d1fc71c/bg/api-gemini.js), [`parse-gemini.js`](https://github.com/chaehyun2/claudetuner/blob/9b94ac3c412732d88cc5a570f0dfe0603d1fc71c/bg/parse-gemini.js), [`collect-gemini.js`](https://github.com/chaehyun2/claudetuner/blob/9b94ac3c412732d88cc5a570f0dfe0603d1fc71c/bg/collect-gemini.js) | 커밋 시각 `2026-10-12T17:10:33+09:00`. MAIN world의 `WIZ_global_data.SNlM0e`, `/app` bootstrap, `f.req`의 중첩 JSON 문자열, `jSf9Qc`와 창 배열 계약을 확인했습니다. 원본은 URL/프레임 처리에 비공개 vendor를 사용하지만 AI Gauge는 그 모듈을 가져오지 않습니다. AI Gauge의 bootstrap은 실제 script의 JSON으로 범위를 제한하며 HTML 임의 위치의 토큰 검색·계정 정보 조회·서버 전송 경로를 채택하지 않습니다. |
| [`gemini-usage` 내부 API 문서](https://github.com/EricAndrechek/gemini-usage/blob/ed68b31576fd4511b41b9413a079b38867ed61f1/_docs/GEMINI_API_INTERNALS.md) | 커밋 시각 `2026-04-08T07:17:48-04:00`, 문서 관찰 시점은 2026년 4월입니다. 공개 endpoint, form 필드, 선택적 XSSI와 UTF-16 코드 단위 길이 프레임·중첩 JSON 형식만 참고합니다. 이 문서는 `jSf9Qc`를 설명하지 않으며 대화 이력 집계·고정 모델 한도·쿠키 추출 방식은 채택하지 않습니다. “quota API 없음”이라는 당시 설명을 10월의 사용자 관찰보다 최신 근거로 취급하지 않습니다. |

구현 계약은 `[remaining, utilizationRatio, windowType, [[resetSeconds, resetNanos]]]`입니다. 실제로 받은 type 1은 5시간, type 2는 7일로 표시하고 `utilizationRatio`의 유한한 0~1 값만 백분율로 변환합니다. 초기화는 Unix 초와 선택적 나노초를 UTC로 정규화합니다. 알려진 창의 비율·초기화가 모두 누락/null이면 항목은 유지하되 두 값 모두 확인 불가이며 0%로 바꾸지 않습니다. 제공된 잘못된 타입·범위, 중복 창은 오류입니다. `remaining`의 단위, plan ID, 기타 상태의 의미는 미확인이므로 사용량 메시지 수·요금제·무제한 상태를 추정하지 않습니다. 없는 창을 만들거나 서로 합산하지 않습니다.

현재 요청 경로: 승인된 `https://gemini.google.com/*` 탭의 MAIN world를 우선 사용하며 고정된 절대 HTTPS URL로 요청하여 문서의 base URL이 바뀌어도 요청 대상이 달라지지 않게 합니다. 페이지의 CSRF 토큰은 해당 수집 함수에서 요청에만 일시적으로 사용하고 저장·로그하지 않습니다. 페이지 토큰을 구하지 못하거나 요청이 실패하면 다른 계정이나 워커 경로로 전환하지 않습니다. 서비스 탭이 아예 없는 경우에만 공개 bootstrap 계약에 따라 고정 `/app`의 실제 script에서 `WIZ_global_data.SNlM0e`를 읽고 기존 RPC를 호출합니다. 이는 대화 이력·쿠키 직접 조회·원격 코드 실행을 포함하지 않으며 [background-collection.md](background-collection.md)에 범위와 실계정 미검증을 기록합니다.

RPC에는 `source-path=/usage`, `redirect: error`, 15초 수집 제한과 1MiB 스트림 읽기 상한을 적용하며 조기 종료에도 요청을 중단합니다. 응답 프레임을 검증하고 사용량 필드와 확인된 요금제만 정규화하여 반환합니다. HTTP 401·403·429·네트워크 오류를 구분하고 실패 응답 원문·예외 문자열을 넘기지 않습니다. 알려진 RPC 내부 제한 코드 1037/1060은 rate-limited로, 해석되지 않은 내부 상태는 unsupported로 처리합니다. RPC의 HTTP 200 HTML은 성공 사용량이나 확정된 로그아웃으로 간주하지 않고 응답 형식 오류로 처리합니다. 별도 백엔드나 비공개 모듈은 필요하지 않습니다.

여러 Google 계정의 RPC 대상 선택은 확인되지 않았습니다. `/u/1` 또는 `authuser=1` 등 명시적으로 기본 계정이 아닌 경로·쿼리는 다른 계정을 잘못 조회하지 않도록 요청 전에 unsupported로 종료합니다. 경로 `/u/0`과 쿼리 `authuser=0`은 기본 계정 경로로 허용하되 **실제 계정별 일치는 미검증**입니다. 경로와 쿼리가 충돌하거나 여러 `authuser` 값 중 기본값이 아닌 값이 있어도 요청하지 않습니다.

**검증 범위:** 사용자가 제공한 실제 관찰 문자열은 `tests/fixtures/gemini-observed.json`에 그대로 보존했습니다. `gemini-batchexecute.txt`의 외부 프레임은 그 내부 문자열을 감싼 **합성 fixture**이며 실계정 원문 전체 캡처가 아닙니다. 파서·전송·진단 경계 테스트 **27개 통과**: 진짜 0/미확인 구분, 초·나노초와 UTC 날짜 경계, 길이 프레임·다른 RPC·손상·중복·잘못된 비율/시각, HTTP 401/403/429, 로그인 HTML, 토큰 부재, 비기본 계정 차단, RPC 내부 오류, timeout·응답 크기 제한을 확인했습니다. `chrome120` 대상 변환 함수만 빈 VM으로 직렬화하여 외부 closure 없이 실행되는지도 검증했습니다. 빌드 `202610142031` 안내 후 사용자가 실제 사용량 수집 성공을 확인했습니다. 이 개발 환경에는 로그인한 Gemini 세션이 없어 직접 로그인 호출을 실행하지 않았으며, 다른 계정·세션 상태와 웹앱 수치·초기화 시각의 세부 대조는 미검증입니다. 입력창의 `rich-textarea .ql-editor`, `input-area-v2`, `.input-area` 후보 역시 공개 참고 소스가 가정한 구조이며 실서비스 DOM 검증이 아닙니다. 비공식 API의 지속성이나 Chrome Web Store 적합성도 확정하지 않습니다. Gemini 수집 성공은 이번 사용자 확인에 근거하며 이전 ChatGPT·Claude 확인에서 유추한 결과가 아닙니다.

### HTTP 200 형식 오류 보완

사용자는 빌드 `202610142007`의 Gemini `invalid_response`와 Network의 HTTP 200, `application/json; charset=utf-8`, 위와 동일한 RPC URL을 확인했습니다. 이 시점에는 실패한 응답 본문이 없었습니다. 이후 `202610142022`의 `gemini_frame_invalid`와 전체 응답을 제공하여 아래의 프레임 경계 실패를 확인했습니다.

공개 [`gemini-usage/gemini/parse.go`](https://github.com/EricAndrechek/gemini-usage/blob/ed68b31576fd4511b41b9413a079b38867ed61f1/gemini/parse.go)의 프레임 시작점은 길이 숫자 직후로, 구분 줄바꿈을 길이에 포함합니다. 같은 파일과 Claude Tuner의 공개 파서는 줄별 JSON도 처리합니다. 기존 AI Gauge가 이 두 형식을 거절하는 것을 동일한 내부 사용량 fixture로 재현했습니다. 새 파서는 줄바꿈 포함·제외 길이와 완전한 줄별 JSON을 지원하며, 모든 프레임을 검증하고 잘못된 줄이나 뒷부분을 버리지 않습니다. 이는 **공개 계약 기반 합성 재현·수정**이며 사용자 실패 원문을 직접 재현한 결과가 아닙니다.

진단 `errorCode`는 MIME 거부 `gemini_response_type`, 본문 읽기/크기/인코딩 `gemini_response_read`, 외부 프레임 `gemini_frame_invalid`, 대상 RPC 없음 `gemini_rpc_missing`, 중복 RPC/중첩 JSON `gemini_rpc_invalid`, 사용량 필드 `gemini_quota_invalid`로 구분합니다. 화면 오류 문구는 기존과 같고 원문·토큰·URL·동적 MIME은 추가 저장하지 않습니다. 기존 백오프와 429 제한은 유지합니다.

### 사용자 응답으로 확인한 프레임 경계 결함

후속 실제 응답은 XSSI 뒤에 `207\n<205자 JSON>\n25\n<23자 JSON>`이 오는 형식입니다. 첫 JSON은 `wrb.fr`·`di`·`af.httprm`, 마지막은 `e` 레코드입니다. 선언 길이에는 JSON 앞뒤 LF가 모두 들어 있어 첫 프레임을 정확히 읽으면 다음 위치는 숫자 `25`입니다. 기존 파서는 그 위치에도 공백이 있어야 한다고 잘못 요구하여 정상 응답을 거절했습니다. 이 불필요한 조건을 제거하고 다음 반복에서 길이 표식을 검증합니다. 공개 [Gemini-API StreamingFrameParser](https://github.com/HanaokaYuzu/Gemini-API/blob/1ad0d4a93e505e77c79769d78ef2997641f973c8/src/gemini_webapi/utils/parsing.py)도 별도 공백 없는 인접 프레임을 처리합니다.

제공된 본문에는 주간 비율 `4.305E-4`(0.04305%), 5시간 비율 `0.01`(1%)와 기존 계약의 초기화 시각이 있습니다. `tests/fixtures/gemini-batchexecute-observed-redacted.txt`는 사용자가 제공한 전체 프레임을 기반으로 하되, 사용량과 무관한 `af.httprm` 식별 문자열을 같은 길이의 0으로 대체합니다. 그 메타데이터를 반환·저장·사용량 해석에 사용하지 않습니다.

채팅으로 전달된 본문에는 마지막 LF가 없습니다. 실제 전송에서도 생략됐는지 복사 과정에서 사라졌는지는 미확인입니다. 이를 위해 마지막 프레임에서 길이가 정확히 한 글자 부족하고 남은 JSON이 완전하게 파싱되는 경우에만 종료 LF 생략을 허용합니다. 두 글자 이상 길이 차이·잘린 JSON·잘못된 중간 프레임·후행 쓰레기·중복 RPC는 계속 거부합니다. 제공 응답의 로컬 파싱 재현과 수정 후 실계정 수집 성공은 구분합니다.

**후속 실사용 확인:** 2026-10-14 빌드 `202610142031` 안내 후 사용자가 “Gemini도 성공했어”라고 확인했습니다. Gemini의 실제 사용량 수집 성공은 사용자 검증 완료로 기록합니다. 개발 환경의 독립 로그인 실행이나 입력창별 배치·초기화 시각 대조·다른 계정 상태 검증을 의미하지는 않습니다.

라이선스: Claude Tuner는 MIT, Copyright (c) 2025-2026 Claude Tuner Contributors이고 `gemini-usage`는 MIT, Copyright (c) 2026 Eric Andrechek입니다. 공개 요청·응답 계약을 참고하여 독립 작성하며 원본 코드·파일은 복사하지 않습니다.

## ChatGPT 플랜 한도의 의미

2026-10-14 사용자가 설정에서 직접 확인한 문구입니다.

> 플랜 사용 한도
>
> Codex, Work, 워크스페이스 에이전트, Excel용 ChatGPT에서 사용량 한도를 공유합니다. Chat 대화는 사용량에 포함되지 않습니다.

이는 사용자 계정의 설정 확인이며 이 환경에서 해당 화면을 직접 읽은 결과는 아닙니다. 사용자의 최신 요청에 따라 제품의 제공자 명칭과 저장 키를 **ChatGPT** 하나로 정리했지만, 수집하는 수치의 의미는 여전히 위 플랜 한도입니다. 일반 채팅 화면에 표시한다고 일반 채팅 모델별 사용률로 바꾸지 않습니다.

- ChatGPT와 Codex는 하나의 `chatgpt` 어댑터·스냅샷·팝업 카드를 공유합니다. 화면별 수집·복사·중복 집계·합산이 없습니다.
- 이전 버전의 `work_codex` 설정·공유 풀 스냅샷을 새 ChatGPT 데이터로 이전합니다. 실험용 일반 ChatGPT 관찰 데이터는 새 플랜 데이터로 승격하지 않습니다. 실험 관찰기·캐시·별도 수집 경로는 제거했습니다.
- `used_percent: 15`는 15% 사용입니다. 요금제 가격·모델명으로 5시간 창을 생성하거나 억제하지 않고 실제 응답의 창 길이와 reset만 표시합니다.
- 기본 제한과 `additional_rate_limits`는 별도 원본 항목으로 유지합니다. 공유 사용처인 Work·워크스페이스 에이전트·Excel용 ChatGPT를 별도 수집 대상으로 만들지 않습니다.
- 일반 ChatGPT 모델별 정확한 잔여량·전체 한도와 공유 크레딧 잔액 계약은 여전히 미검증입니다. `credits_would_enable` 등을 잔액이나 사용률로 환산하지 않습니다. 과거 요청의 Pro 가격별 5시간 제한 부재도 실제 API나 최신 공식 도움말로 독립 검증하지 않았습니다.

### 직접 읽은 공식 공개 소스

OpenAI의 [`openai/codex` 커밋 `95273b84fbff40f9df7d71d50f1ca52c6489b25d`](https://github.com/openai/codex/commit/95273b84fbff40f9df7d71d50f1ca52c6489b25d)을 확인했습니다. 작성 시각은 `2026-10-14T07:57:45Z`, 커밋 시각은 `2026-10-14T08:05:19Z`이며, 한국 시각으로 커밋은 **2026-10-14 17:05:19**입니다. 이 시각은 코드의 커밋 시각이며 요금 정책의 갱신 시각이 아닙니다.

| 직접 읽은 공식 근거 | 확인 범위 |
| --- | --- |
| [`client/rate_limit_resets.rs`](https://github.com/openai/codex/blob/95273b84fbff40f9df7d71d50f1ca52c6489b25d/codex-rs/backend-client/src/client/rate_limit_resets.rs#L124-L128) | 같은 함수가 API 종류에 따라 `/api/codex/usage` 또는 `/wham/usage`를 선택합니다. ChatGPT 도메인의 경로라는 이유만으로 일반 Chat 모델별 사용량은 아닙니다. |
| [`client.rs`](https://github.com/openai/codex/blob/95273b84fbff40f9df7d71d50f1ca52c6489b25d/codex-rs/backend-client/src/client.rs#L615-L650) | 기본 `payload.rate_limit`은 `limit_id: "codex"`로 정규화하고, 추가 한도는 `metered_feature`와 `limit_name`을 별도로 유지합니다. |
| [`protocol.rs`](https://github.com/openai/codex/blob/95273b84fbff40f9df7d71d50f1ca52c6489b25d/codex-rs/protocol/src/protocol.rs#L2517-L2533) | `used_percent` 주석은 “Percentage (0-100) of the window that has been consumed.”, `resets_at`은 “Unix timestamp (seconds since epoch) when the window resets.”입니다. 사용 비율과 초기화 시각의 단위를 확인했습니다. |

공식 소스는 위 응답 의미의 근거이며, 일반 Chat의 모든 한도나 Work·Excel 등 각 제품의 최신 요금 정책까지 입증하지는 않습니다. [Codex 플랜 공식 도움말](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)은 이번에도 프록시가 CONNECT 403으로 차단하여 읽지 못했고 우회하지 않았습니다. 공유 사용처와 Chat 제외는 위 사용자 확인 문구를 근거로 기록합니다.

### 일반 채팅 모델별 한도 조사 이력

[CodexBar #3436](https://github.com/steipete/CodexBar/issues/3436), [OpenAI Codex #42531](https://github.com/openai/codex/issues/42531#issuecomment-5669704907), [Proxyman #1323](https://github.com/ProxymanApp/Proxyman/issues/1323#issuecomment-2943501314)에서 `conversation/init`의 `limits_progress`, 기능별 잔여 수치·reset 예시를 확인했습니다. 정상 사용 도중 모든 모델의 정확한 사용률을 지속적으로 반환하는 계약은 확보하지 못했습니다. 대화 개수·로컬 요청 횟수·고정 모델 한도는 서버 사용량으로 채택하지 않았습니다.

이 조사는 과거 제한적 관찰기의 근거였으며 **현재 구현은 해당 관찰기를 제거**했습니다. 일반 ChatGPT 모델별 수집을 완료했다고 보고하지 않고, ChatGPT와 Codex에 동일한 플랜 수치를 표시합니다. 모델별 수집이 영구적으로 불가능하다고 단정하지도 않습니다.

## 표시와 저장 정책

- 팝업은 ChatGPT·Claude·Gemini 세 카드를 구분하고 Codex 카드를 중복 생성하지 않습니다. 미수집·신뢰할 수 없는 값에는 짧은 상태를 표시하고 필수 관리 버튼을 유지합니다. 정상 캐시의 시간 경과만으로 경고하지 않습니다.
- 입력창 위치는 일반 ChatGPT·Codex·Claude·Gemini 네 곳입니다. 표시 설정도 네 화면을 구분하되 ChatGPT와 Codex는 동일한 ChatGPT 데이터 소스를 사용합니다.
- 공통 표시줄은 높이 30px, 글자 12px, 기존 20px 로고를 사용합니다. 사용률·현지 초기화 시각·남은 시간을 표시하며 없는 값을 추정하지 않습니다. 유효한 실제 사용률에만 진행 막대를 표시합니다.
- 툴바 사용량 표시는 기존 최대 사용률을 유지합니다. 입력창은 기본 공통 버킷에서 소진 한도 우선(미확인 초기화 우선, 그다음 가장 늦은 초기화), 미소진 시 가장 빠른 초기화, 시각이 모두 없으면 최대 사용률을 선택합니다. 동률은 원본 순서입니다. ChatGPT의 `shared:*`만 공통으로 사용하고 `product:*` 추가 기능과 Claude의 `model` 항목은 제외합니다. 원본 항목은 팝업에 모두 남깁니다. API에는 모든 작업의 적용 관계나 현재 모델의 범위 정보가 없으므로 대표값으로 서비스 전체의 사용 가능 여부를 확정하지 않습니다. ChatGPT 수치는 여전히 일반 Chat 대화가 아닌 공유 플랜 한도입니다.
- 툴바 사용량 표시는 탭별 표시 소스를 사용합니다. ChatGPT·Codex는 ChatGPT, Claude와 Gemini는 해당 데이터이며 무관한 탭이나 URL을 확인할 수 없는 탭에는 숫자를 표시하지 않습니다.
- 기본 개발 빌드의 로컬 진단은 구조 개수·탐색 성공·표시 여부 같은 제한된 수치와 불리언만 반환합니다. 배포용 빌드에서는 진단 UI·요청 처리를 비활성화합니다.

### 입력창 대표 한도의 적용 범위

2026-10-19 기존 파서·fixture·저장 계약을 재검토했습니다. 새로운 로그인 API 호출이나 추가 수집은 하지 않았습니다.

| 제공자 | 대표값 후보의 기존 계약 | 제외 범위와 확인 한계 |
| --- | --- | --- |
| ChatGPT / Codex | `rate_limit`의 `shared:primary_window`·`shared:secondary_window`, category `product` | `additional_rate_limits`도 `product`이므로 category만으로 공통 여부를 정하지 않습니다. `product:*`는 대표값에서 제외합니다. 기본 버킷도 일반 Chat 대화 전체의 한도라는 의미는 아닙니다. |
| Claude | `five_hour`·`seven_day`를 파서가 category `window`로 구분 | `seven_day_*` 등 category `model`인 개별 한도를 제외합니다. 현재 입력창의 선택 모델과 제한의 적용 관계를 새로 추정하지 않습니다. |
| Gemini | 관찰된 `jSf9Qc`의 type 1·2를 파서가 category `window`로 구분 | 관찰 응답에 모델·기능별 적용 관계가 없습니다. 두 창 밖의 범위를 만들거나 전체 기능의 사용 가능 여부로 확대하지 않습니다. |

선택 함수는 이미 정규화된 후보만 비교합니다. 표시 전에 실행하는 기존 캐시 신뢰성 판단은 전체 스냅샷을 대상으로 하므로, 대표값에서 제외한 모델·기능 한도라도 초기화가 경과하면 새 수집까지 기존 `초기화 후 확인 중` 상태를 유지합니다. 범위별 캐시 무효화로 바꾸지 않습니다.

### 실제 표시 위치 확인 범위

사용자는 이전 빌드에서 **ChatGPT 홈·채팅과 Claude 홈·채팅 위치가 정상**이라고 확인했습니다. `/codex/cloud`가 `https://chatgpt.com/`로 이동하는 화면은 허용된 호스트의 명시적인 `ComposerLayoutFooter-` 구조로 맥락을 보완합니다. ChatGPT와 Codex에 공통으로 존재할 수 있는 Body/Root 클래스만으로 Codex라고 판정하지 않습니다.

최신 사용자 요청에 따라 ChatGPT는 `ComposerLayoutBody-` 클래스 토큰의 div 뒤, Codex는 `ComposerLayoutRoot-` div 뒤, Claude는 `div[data-cds="ChatComposerChin"]` 뒤로 옮겼습니다. 클래스 접미사는 고정하지 않고 대상의 바로 다음 형제로 삽입합니다. Gemini 위치는 유지했습니다. 새 위치·반복 삽입 방지·입력 기능 보존은 합성 DOM/Chromium에서 검증하며 **최신 실제 서비스의 각 화면 배치는 재확인 대상**입니다.

## 비공개 모듈·백엔드·라이선스 구분

참고 저장소 [Claude Tuner](https://github.com/chaehyun2/claudetuner)의 조사 커밋은 `9b94ac3c412732d88cc5a570f0dfe0603d1fc71c`입니다.

| 공개 파일 | 참고 범위 | 채택하지 않은 기능 |
| --- | --- | --- |
| `bg/api-chatgpt.js`, `bg/parse-chatgpt.js` | 페이지 세션 bearer와 사용량 창 계약 | 쿠키 추출·일반 채팅 사용량 추정 |
| `bg/api.js`, `bg/parse-claude.js`, `bg/claude-usage-path.js` | 조직별 사용량 GET·응답 shape·읽기 전용 초기화 티켓 계약 | 임의 조직 선택·티켓 소비·원격 flag |
| `bg/api-gemini.js`, `bg/parse-gemini.js`, `bg/collect-gemini.js` | 공개 토큰 위치·`/app` bootstrap·RPC 요청·창 배열 계약 | 비공개 `vendor-ai/gemini-batch.js`·HTML 임의 위치 토큰 검색·계정/요금제 추정 |
| `bg/collect*.js`, `bg/storage.js` | 원본에 별도 서버 기능이 있음을 확인 | `/api/snapshots`, 계정 연결·팀 분석·이력·추천·동기화·원격 분석 |

이 기능들은 로컬 사용량 조회에 필요한 의존성이 아닙니다. AI Gauge는 원본 전체를 포크하거나 원본 코드·파일을 복사하지 않고 공개 계약을 참고해 TypeScript로 독립 작성했습니다. 참고 프로젝트들의 MIT 저작권은 위에 기록했으며 향후 코드를 실제 재사용하면 MIT 원문과 저작권 고지를 포함해야 합니다.

## 인증·CORS·MV3·프라이버시

- 필수 권한은 `storage`, `alarms`, `scripting`; 선택 호스트는 `https://chatgpt.com/*`, `https://claude.ai/*`, `https://gemini.google.com/*`입니다.
- 승인된 열린 서비스 탭의 MAIN world를 우선 사용합니다. 해당 서비스 탭이 0개이면 기존 호스트 권한과 `credentials: include`를 사용하는 워커 요청을 수행합니다. ChatGPT·Claude는 기존 GET을, Gemini는 `/app` GET 후 기존 읽기 전용 RPC POST를 재사용합니다. 워커 경로의 실제 SameSite·쿠키·서비스 보호 정책 호환은 실계정 검증이 필요하며 Chrome 호스트 권한만으로 성공을 보장하지 않습니다.
- ChatGPT bearer, Gemini CSRF 토큰, Claude 조직 UUID는 수집 함수 안에서 해당 요청에만 일시적으로 쓰고 정규화 결과·UI에 반환하거나 저장·로그하지 않습니다. 쿠키는 브라우저가 포함하며 직접 추출하거나 헤더를 구성하지 않습니다. Gemini bootstrap HTML도 저장하지 않습니다.
- `cookies`, `tabs`, `webRequest`, 전체 사이트 권한, 임의 URL/메서드 요청, 대화·프롬프트·첨부·이력 조회가 없습니다.
- 수집 결과는 허용한 usage 필드로 축소하고 공통 파서에서 재검증합니다. 원본 응답·session·계정·이메일·예외 문자열을 기록하지 않습니다.
- 정지·폐기된 서비스 탭만 있으면 `open_tab`, 선택한 탭에서 실행할 수 없으면 `tab_access_failed`입니다. 이때 기본 쿠키 계정으로 바꾸지 않습니다. 마지막 활성 창의 해당 서비스 탭을 우선하며 오류 후 다른 계정 탭을 순회하지 않습니다. 탭이 실제로 없는 경우의 워커 요청에서도 실패를 0%로 만들지 않습니다.
- Content script는 편집기·중지 버튼·래퍼의 존재와 레이아웃만 검사합니다. 진단에 텍스트·원본 DOM·URL·계정 정보를 반환하지 않습니다.

## 실패 상태 검증

아래는 합성 응답·Chrome API mock 검증이며 실제 계정 장애 재현이 아닙니다.

| 조건 | 상태와 대응 |
| --- | --- |
| 선택 호스트 권한 없음 | permission_required; 요청하지 않음 |
| 401 / ChatGPT bearer 없음 | signed_out; 자동 재시도 중단. 로그아웃과 세션 만료는 401만으로 구분 불가 |
| 403 | error/access_denied; 인증 실패로 단정하거나 우회하지 않음 |
| 429 / Gemini의 알려진 내부 제한 코드 | rate_limited; Retry-After와 백오프 준수 |
| fetch 실패 / timeout / 5xx | 오류·백오프·이전 값 보존. 유효하고 초기화 전인 캐시는 첫 실패에 유지하며 연속 실패 시 짧은 안내 |
| 정상 캐시의 10분 경과 | 경고 없이 기존 값 유지, 공유 워커에서 자동 갱신 |
| 실제 초기화 시각 경과 | reset_pending; 새 결과까지 현재 수치를 숨기며 0%나 다음 시각을 추정하지 않음 |
| 손상·중복·비유효 응답 | invalid_response 또는 위 Gemini 고정 단계 코드; 없는 값은 null로 유지하고 0을 만들지 않음 |
| Gemini 페이지 token 없음 / 비기본 계정 / 해석되지 않은 RPC 상태 | unsupported; 요청 우회나 계정 fallback 없음 |
| Gemini 워커 bootstrap token 확인 불가 / 정지·폐기된 탭만 존재 | open_tab; 로그인한 서비스 탭 확인 안내. 다른 계정으로 대체하지 않음 |
| Gemini HTTP 200 HTML Content-Type | gemini_response_type; 정상 사용량·확정된 로그아웃으로 해석하지 않음 |
| Claude 복수 조직 | ambiguous_account; 임의 조직 선택 없음 |

## 외부 문서와 실사용 검증 한계

Chrome 공식 network/scripting/permissions 문서는 환경의 egress proxy에서 CONNECT 403으로 차단됐고 우회하지 않았습니다. OpenAI·Anthropic·Google 약관도 이 환경에서 읽지 못했습니다. 최신 약관이나 Chrome Web Store 심사를 검토 완료했다고 주장하지 않습니다. 내부 API는 비공식이며 예고 없이 변경될 수 있습니다.

확인할 공식 문서: [Chrome network](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions), [OpenAI terms](https://openai.com/policies/terms-of-use/), [Anthropic terms](https://www.anthropic.com/legal/consumer-terms), [Google terms](https://policies.google.com/terms), [Chrome Web Store user data](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

이 환경의 Chromium에서는 실제 확장 로딩이 관리자 정책으로 비활성화되어 `Extensions.loadUnpacked`가 실패했습니다. 로그인한 사용자의 프로필·세션도 없습니다. 합성 테스트·사용자 제공 관찰·개발 환경 실측을 구분하며 사용자가 확인한 수집 성공을 개발 환경의 직접 실측이나 모든 설치·권한·화면 수치 대조 완료로 확대하지 않습니다. 최신 실행 결과와 실사용 확인 항목은 [validation.md](validation.md), 빌드·설치 방법은 [README](../README.md)를 참고하세요.

## 초기화 티켓: 공개 계약 확인, 실제 로그인 호출 미검증

ChatGPT의 `rate_limit_reset_credits` 요약·상세 GET과 Claude의 `usage?cedar_ember=1`에 대해 Claude Tuner 공개 파서/수집 코드에서 응답 구조를 확인했습니다. 공개 트리에는 주석이 인용한 실제 fixture가 없어 직접 관찰 응답이라고 주장하지 않습니다. API 구조·알 수 없는 필드·계정/조직 일치·조회 전용 제약은 [reset-tickets.md](reset-tickets.md)에 기록합니다. Gemini 티켓 API는 확인되지 않아 수집·표시에서 제외합니다.
