<div align="center">

<img src="assets/logo.png" alt="AI Gauge" width="120" />

# AI Gauge

**AI 사용량을 한눈에**

ChatGPT, Claude, Gemini의 사용량과 초기화 시간을 한곳에서 확인하는 Chrome 확장 프로그램입니다.

팝업 설정에서 `시스템 기본 언어`, `영어`, `한국어`를 선택할 수 있습니다. 기본값은 Chrome UI 언어가 한국어이면 한국어, 그 외에는 영어입니다. 체크박스와 언어 선택은 변경 즉시 저장되어 열린 화면에도 반영되며 날짜와 시각은 현지 시간대를 유지합니다.

광고와 별도 서버 없이 브라우저에서 동작합니다.

</div>

[정식 빌드 ZIP 다운로드 — 202610161146](https://github.com/han41858/ai-gauge/raw/refs/heads/main/downloads/ai-gauge-202610161146.zip) · [개발 빌드 ZIP — 202610191728](https://github.com/han41858/ai-gauge/raw/refs/heads/main/downloads/ai-gauge-202610191728.zip) · [설치 방법](docs/installation.md)

ChatGPT와 Codex는 동일한 플랜 사용량을 표시합니다. ChatGPT·Claude·Gemini의 실제 사용량 수집 성공은 사용자가 확인했습니다. 세부 검증 범위는 [검증 결과](docs/validation.md)를 참고하세요.

첫 실행에는 사용할 서비스를 체크박스로 골라 권한을 한 번에 승인합니다. 팝업은 600px 기본 폭에서 사용량과 초기화를 가로로 묶어 스크롤을 줄입니다. 서비스 탭이 없을 때에도 기존 로그인 쿠키로 조회를 시도하며, 결과는 열린 탭과 같은 로컬 캐시를 사용합니다. 탭 없는 수집의 실제 로그인 호환성은 추가 확인이 필요합니다. [동작과 제한](docs/background-collection.md)을 참고하세요.

팝업의 서비스명 옆에 확인된 현재 요금제만 표시하며 확인할 수 없는 경우에는 배지를 숨깁니다. 판별 근거와 실사용 확인이 필요한 범위는 [요금제 판별](docs/plan-detection.md)에 정리했습니다.

입력창 표시줄의 20px SVG 게이지는 숫자·진행 막대와 같은 사용률을 표시합니다. 설정에서 주의·경고 시작 사용률을 정하며 기본값은 70%·90%입니다. 동작 줄이기 설정을 지원하고, 확인할 수 없는 사용률은 중립 상태로 표시합니다.

ChatGPT·Claude의 확인된 초기화 티켓은 팝업과 충분히 넓은 입력창 표시줄에 표시합니다. 티켓 링크는 공식 사용량 관리 화면을 열며 확장 프로그램에서 티켓을 소비하지 않습니다. 수량·사용 조건·계정 확인과 실사용 검증 한계는 [초기화 티켓 조회](docs/reset-tickets.md)를 참고하세요.

[설치와 사용](docs/installation.md) · [명세](AI_GAUGE_SPEC.md) · [검증 결과](docs/validation.md) · [수집 가능성](docs/provider-feasibility.md) · [권한과 개인정보](docs/permissions.md)
