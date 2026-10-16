# 초기화 티켓 조회

## 근거와 검증 범위

2026-10-14 기준 Claude Tuner 공개 코드 `9b94ac3c412732d88cc5a570f0dfe0603d1fc71c`의 읽기 전용 수집·파싱 계약을 조사했습니다. 로그인한 ChatGPT·Claude 계정의 API를 이 개발 환경에서 직접 호출하지 않았습니다. 참고 코드 주석이 인용하는 실제 응답 fixture와 내부 문서는 공개 저장소에 없으므로, 공개 구현에서 확인한 구조와 AI Gauge의 합성 테스트를 실제 응답 검증으로 표현하지 않습니다.

| 서비스 | 조회 | 공개 구현에서 확인한 필드 |
| --- | --- | --- |
| ChatGPT 요약 | `GET /backend-api/wham/usage` | `rate_limit_reset_credits.available_count`, `applicable_available_count` |
| ChatGPT 상세 | `GET /backend-api/wham/rate-limit-reset-credits` | `available_count`, `credits[]`의 `reset_type`, `status`, `is_supported_by_plan`, `granted_at`, `expires_at` |
| Claude | `GET /api/organizations/{orgId}/usage?cedar_ember=1` | `cedar_ember.eligible`, `grants[]`, `next_grant_id`, `cooldown_until`; grant의 `resets_left`, `starts_at`, `ends_at`, `clears`, `usable_now`, `use_requires_limit`, `blocking` |

ChatGPT의 `applicable_available_count`는 제공자가 응답한 적용 가능 수량입니다. 티켓 종류별로 임의 분배하거나 어느 제한을 해제할 수 있다고 추정하지 않습니다. 개별 상세 티켓은 한 장이며 `codex_rate_limits`, `codex_five_hour`, `codex_weekly`만 알려진 초기화 종류로 해석합니다. `*_shadow`나 알 수 없는 종류는 유효 티켓으로 광고하지 않습니다. `status`가 `available`이 아니거나 현재 플랜에서 지원되지 않는 항목은 제외합니다.

ChatGPT 요약에는 종류와 만료 시각이 없습니다. 상세가 확인되지 않은 수량은 팝업에서 개수만 표시할 수 있으며 입력창에서는 숨깁니다. 상세의 수량이 요약을 설명하는지 검사하며, 상세 조회 뒤 사용량을 다시 읽어 계정이 바뀌지 않았는지 확인합니다. 수량이 같다는 이유만으로 같은 계정이라고 간주하지 않습니다.

Claude는 `resets_left`를 보유 수량으로 읽고 `clears`에서 종류를 구분합니다. 시작 시각이 미래인 티켓은 보유량에 포함하지만 사용 가능 수량에서는 제외합니다. `usable_now`, 차단 여부, 다음 사용 대상으로 지정되었는지, 쿨다운을 함께 보존합니다. 사용 제한에 도달해야 쓸 수 있는 티켓을 AI Gauge가 사용 가능하다고 추정하지 않습니다. 참고 공개 파서는 명시적 `ends_at: null`을 웹앱과 같이 제외하므로 이를 무기한 티켓으로 바꾸지 않습니다. 필드 누락·손상은 미확인이며 0장이 아닙니다.

## 구현 원칙

- 기존 사용량 자동 갱신·수동 갱신·중복 요청 병합·백오프를 공유합니다. 탭별 티켓 타이머나 별도 백엔드가 없습니다.
- 추가 상세 조회·계정/조직 확인은 읽기 전용이며 실패를 사용량과 분리합니다. 티켓 소비·초기화·결제 API는 구현하지 않습니다.
- 정규화한 종류·수량·시각·사용 조건만 선택적으로 스냅샷에 보관합니다. 티켓 ID·조직 UUID·계정 ID·원본 응답·토큰은 저장하지 않습니다.
- ChatGPT 계정과 사용자를 확인하는 비교값은 서비스 워커 수명에만 유효한 무작위 salt를 사용하며 메모리 안에서만 비교합니다. 사용자 식별 근거가 없으면 이전 캐시를 실패 응답에 재사용하지 않습니다. Claude 조직 목록은 Team 내 현재 사용자를 확정할 수 없어 오류 후 이전 티켓 재사용의 증거로 사용하지 않습니다. 정상 새 응답의 티켓은 조직 재확인 후 표시하며, 티켓 조회 실패 때는 사용량을 유지하고 티켓만 숨깁니다. 이 계정 비교값은 저장소·팝업·입력창 메시지로 전달하지 않습니다. 같은 브라우저 세션의 검증 완료 여부만 `chrome.storage.session`의 boolean으로 보관해 워커 재시작마다 정상 티켓이 사라지거나 갱신 주기가 짧아지는 것을 방지합니다. 이 값은 계정 증거가 아니며 오류 캐시 재사용에는 별도의 메모리 내 동일 계정 증거가 필요합니다. 브라우저 재시작으로 세션 검증이 사라졌으면 정상 수집 기한을 지키면서 재확인하고 기존 사용량 캐시는 유지합니다.
- 현재 시각으로 만료된 티켓을 제외합니다. 팝업은 총 보유량 아래 각 티켓의 만료를 각각 표시하고 공간이 부족하면 줄바꿈합니다. 만료가 확인된 단일 티켓은 `1개`를 생략하고, 같은 grant에 묶인 여러 장은 수량을 앞에 유지하며 서로 다른 만료를 합치지 않습니다. 팝업 만료 날짜는 브라우저 현지 시간의 `M/D(요일) HH:mm 만료` 형식입니다. `지금 사용 가능` 문구는 표시하지 않지만 사용 가능 수량·조건은 내부 데이터로 보존합니다. 만료로 적용 가능 수량을 더 이상 확정할 수 없으면 임의로 빼거나 0으로 만들지 않습니다.
- 입력창은 만료가 확인된 유효 티켓 중 가장 빠른 만료 하나만 `🎫 티켓 만료: 2일 후`처럼 표시합니다. 초기화와 공통 상대 시간 포맷터로 가장 큰 단위 하나를 내림하여 `N일 후`·`N시간 후`·`N분 후`·`1분 미만`을 사용합니다. 수량·다른 티켓 만료일시는 텍스트·툴팁·접근성 설명에 넣지 않으며 만료가 확인되지 않은 티켓은 입력창에 표시하지 않습니다. API 조회 실패나 정보 불확실 상태에서도 숨기고, 기존 15초 표시줄 갱신으로 다음 유효 만료로 전환하거나 모두 만료되면 숨깁니다. 추가 요청·타이머·정규화 변경은 없습니다.
- 첫 ChatGPT 상세 조회 실패에서 동일 사용자 증거가 있을 때 보존하는 정상 캐시와 팝업 표시는 기존 규칙을 따릅니다. 입력창에서는 이 첫 실패부터 티켓 만료를 숨기며, 이 표시 규칙은 사용량·팝업·저장된 티켓 정보를 바꾸지 않습니다.
- 유효 보유량이 양수일 때만 표시합니다. 티켓 정보가 없거나 0장이면 해당 영역을 숨깁니다. Gemini는 수집·표시 대상에서 제외합니다. ChatGPT와 Codex는 같은 티켓 데이터를 사용합니다.
- Chrome UI 언어가 한국어이면 한국어, 그 외에는 영어로 표시합니다. 영어 입력창은 `🎫 Ticket expires in 2 days`처럼 문장형 상대 시간을 사용하며 팝업은 개별 정확한 만료·수량·조건을 번역합니다. 현지 시간대·보유량 계산·캐시는 언어와 독립적입니다.

구현 후 자동 테스트·합성 브라우저 검증 결과와 실사용 확인 범위는 [validation.md](validation.md)에 기록합니다.

문서 로딩·권한·인증·수집 결과의 계정 변경 신호 없이 이루어지는 세션 전환은 즉시 감지할 수 없습니다. 다음 정상 수집의 새 응답으로 교체하고, 확인 가능한 계정·조직 불일치에서는 이전 캐시를 버립니다. 여러 계정의 티켓을 보관하거나 합산하지 않습니다.

## 공식 관리 화면

- ChatGPT/Codex: <https://chatgpt.com/settings/usage?tab=overview>
- Claude: <https://claude.ai/new#settings/usage>

네이티브 링크로 새 탭을 열며 키보드로 접근할 수 있습니다. 서비스에서 제공한 임의 URL을 링크로 사용하지 않습니다. 실제 서비스의 리다이렉트·로그인 후 화면 도달은 실사용 확인 대상입니다.

## 공개 참고와 라이선스

- [parse-chatgpt.js](https://github.com/chaehyun2/claudetuner/blob/9b94ac3c412732d88cc5a570f0dfe0603d1fc71c/bg/parse-chatgpt.js#L608): 요약·상세 계약과 종류 판별
- [collect-chatgpt.js](https://github.com/chaehyun2/claudetuner/blob/9b94ac3c412732d88cc5a570f0dfe0603d1fc71c/bg/collect-chatgpt.js#L180): 상세와 계정 일치 확인
- [parse-claude.js](https://github.com/chaehyun2/claudetuner/blob/9b94ac3c412732d88cc5a570f0dfe0603d1fc71c/bg/parse-claude.js#L204): grants·사용 조건
- [claude-usage-path.js](https://github.com/chaehyun2/claudetuner/blob/9b94ac3c412732d88cc5a570f0dfe0603d1fc71c/bg/claude-usage-path.js): 읽기 전용 query
- [reset-pass-model.js](https://github.com/chaehyun2/claudetuner/blob/9b94ac3c412732d88cc5a570f0dfe0603d1fc71c/bg/reset-pass-model.js#L44): 공식 관리 화면

MIT, Copyright (c) 2025–2026 Claude Tuner Contributors. 프로토콜 필드와 계약을 참고하여 독립적으로 TypeScript를 구현하며 외부 함수·파일과 비공개 모듈을 복사하지 않습니다.
