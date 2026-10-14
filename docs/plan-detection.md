# 현재 요금제 판별

2026-10-14 구현. 아래 계약은 공개 참고 코드·테스트에서 확인한 필드와 식별자입니다. AI Gauge의 실제 로그인 환경에서 세 서비스 요금제 표시를 직접 검증한 결과는 아닙니다. 사용량 수집의 기존 사용자 확인과 구분합니다.

## ChatGPT와 Codex

기존 `/backend-api/wham/usage`의 `plan_type`을 사용하며 추가 요청은 없습니다. Codex도 같은 ChatGPT 스냅샷을 사용합니다.

| 원본 식별자 | 표시 |
| --- | --- |
| free / go / plus | Free / Go / Plus |
| prolite / pro / promax | Pro 100 / Pro 200 / Pro 500 |
| team / business / enterprise | Team / Business / Enterprise |
| education / k12 | Education / Education (K-12) |

`pro`의 200 구분은 공개 참고의 wham 계약 설명에 근거합니다. 일반적인 `pro`라는 단어를 모든 응답에서 200으로 해석하는 규칙이 아닙니다. 미확인 식별자·다른 필드·손상 값은 표시하지 않습니다.

## Claude

이미 요청하는 `/api/organizations`의 동일 조직에서 `capabilities`, `rate_limit_tier`, `raven_type`만 추가로 정규화합니다. 사용량은 계속 그 조직의 `/usage`를 사용하며 결제·구독 상세 요청을 추가하지 않습니다.

| 근거 | 표시 |
| --- | --- |
| raven_type=enterprise, raven_enterprise capability, claude_enterprise tier | Enterprise |
| raven_type=team, raven capability, claude_team tier | Team |
| default_claude_max_5x / default_claude_max_20x tier | Max 5x / Max 20x |
| claude_max capability/tier, 세부 등급 불명확 | Max |
| claude_pro 또는 pro capability, claude_pro tier | Pro |
| 명시적 free capability | Free |

상업용 조직 근거를 개인 요금제 capability보다 우선합니다. `chat`만 있거나 `default_claude_ai`라는 값만 있으면 Free/Pro를 확정하지 않습니다. Max 문자열 일부가 비슷하다는 이유로 5x/20x를 추정하지 않습니다. 조직이 여러 개면 기존 모호성 처리를 유지합니다.

## Gemini

`jSf9Qc` 수집 성공 후 같은 페이지·토큰으로 `otAQ7b([])`를 한 번 요청합니다. endpoint와 `source-path=/usage`는 기존 RPC와 같고 타임아웃은 3초입니다. 별도 탭별 polling은 없으며 기존 제공자별 요청 병합·수집 간격을 따릅니다. API에서 받은 숫자 planId만으로 판별하지 않습니다.

| 확인된 정책 문자열 | 표시 |
| --- | --- |
| v3p2_free_policy / v3p2_basic_policy / basic_policy / brownfield_basic_policy | Free |
| v3p2_plus_policy / brownfield_paid_policy | AI Plus |
| v3p2_pro_policy / plus_policy | AI Pro |
| v3p2_ultra_policy / neon_policy | AI Ultra |
| v3p2_business_policy | Workspace |

`plus_policy`는 AI Pro입니다. 이름의 일부만으로 새로운 정책을 추정하지 않습니다. 빈 정책을 Workspace로 취급하지 않습니다. 알려진 정책들이 충돌하면 확인 불가입니다. 공개 참고가 고정된 배열 경로를 제공하지 않아 중첩 배열에서 정확히 일치하는 허용 문자열만 제한된 크기·깊이로 검사합니다. 원본 정책 응답·다른 문자열은 확장 저장소로 전달하지 않습니다.

정책 HTTP 401/403/429/5xx·네트워크·타임아웃·파싱 실패는 요금제만 확인 불가로 처리합니다. 이미 성공한 사용량은 보존합니다. 수집 중 페이지 주소나 bootstrap 토큰이 바뀌어도 요금제 연결을 폐기합니다. 추가 정책 API의 실환경 응답 구조와 Workspace 구분은 별도 검증 대상입니다.

## 저장·전환·실패

- 스냅샷에는 확인된 표시 이름과 확인 시각만 선택적으로 저장합니다. 알 수 없는 문자열·계정·이메일·조직 UUID·토큰·원본 정책·숫자 planId는 저장하지 않습니다.
- 정상 사용량 갱신 시 요금제도 새 결과로 교체합니다. 누락/실패하면 이전 요금제를 재사용하지 않습니다. 요금제 확인 실패는 사용량의 상태나 재시도 횟수를 실패로 바꾸지 않습니다.
- 요금제는 10분 후 숨깁니다. 사용량은 기존 정책대로 정상 캐시의 나이만으로 숨기지 않습니다.
- 탭 활성화·URL/로딩·창 복귀·지원 페이지의 초기/SPA 맥락 신호에서 해당 제공자 요금제를 비웁니다. 다른 제공자의 요금제와 사용량은 유지합니다. 재시도 기한 때문에 즉시 조회할 수 없으면 다음 허용 alarm에서 한 번 재확인합니다.
- 전환 전 수집의 늦은 응답은 요금제를 다시 채우지 못합니다. 계정 식별자를 저장하지 않으므로 관찰 가능한 맥락 변화가 없는 계정 전환은 즉시 판별할 수 없으며 다음 수집 또는 유효 기간으로 제한합니다. 여러 계정의 별도 요금제 보관·합산 기능은 없습니다.

## 공개 근거와 라이선스

- [Claude Tuner 9b94ac3](https://github.com/chaehyun2/claudetuner/tree/9b94ac3c412732d88cc5a570f0dfe0603d1fc71c): `bg/parse-chatgpt.js`, `bg/gemini-plan-labels.js`, `bg/parse-gemini.js`, `bg/collect-gemini.js`, `bg/drift-obs.js`. [MIT License](https://github.com/chaehyun2/claudetuner/blob/9b94ac3c412732d88cc5a570f0dfe0603d1fc71c/LICENSE), Copyright (c) 2025–2026 Claude Tuner Contributors.
- Claude 공개 과거 `af0a04f^:bg/plan.js`의 조직 capability/raven 판별 계약을 참고했습니다. 최신 비공개 vendor 구현을 가져오지 않았습니다.
- [CodexBar 052ded4](https://github.com/steipete/CodexBar/tree/052ded4136dd3e2daa39edb59d33236fcb9c6be6): `Tests/CodexBarTests/ClaudePlanResolverTests.swift`, `ClaudeUsageTests.swift`의 정확한 Max tier fixture. [MIT License](https://github.com/steipete/CodexBar/blob/052ded4136dd3e2daa39edb59d33236fcb9c6be6/LICENSE), Copyright (c) 2026 Peter Steinberger.

프로토콜 필드·식별자 사실을 참고해 TypeScript로 독립 구현했으며 외부 함수나 파일을 복사하지 않았습니다. 향후 코드를 재사용하면 해당 라이선스 전문과 저작권 고지를 함께 유지해야 합니다.
