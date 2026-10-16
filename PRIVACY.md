# AI Gauge 개인정보 처리방침 / Privacy Policy

- 최종 수정일 / Last updated: 2026-10-16
- 적용 대상 / Product: AI Gauge Chrome extension
- 개발자 문의처 / Developer contact: **han41858@gmail.com**

## 한국어

### 1. 목적

AI Gauge는 사용자가 선택한 ChatGPT, Claude, Gemini 서비스의 사용량과 초기화 시각을 확인하고 Chrome 팝업, 툴바 및 해당 서비스의 입력창 근처에 표시하는 확장 프로그램입니다. 일부 서비스에서 확인할 수 있는 요금제와 초기화 티켓 정보도 보여줍니다.

### 2. 처리하는 정보

AI Gauge는 확장 기능 제공을 위해 다음 정보를 처리할 수 있습니다.

- 사용량 비율, 사용량 제한의 종류 및 초기화 시각
- 확인 가능한 현재 요금제 이름
- ChatGPT·Claude에서 확인 가능한 초기화 티켓 수량·종류·만료 시각·사용 조건
- 서비스별 활성화 및 표시 설정, 언어, 주의·경고 기준
- 수집 성공 시각, 오류 상태 및 자동 재시도에 필요한 운영 정보

정보는 사용자가 접근 권한을 허용한 서비스의 기존 로그인 세션을 통해 조회됩니다. 사용자가 서비스를 활성화하고 사이트 접근을 허용한 동안에는 해당 서비스 탭이 열려 있지 않아도 기존 로그인 세션으로 백그라운드 자동 조회를 시도할 수 있습니다. 이 과정에서 사용량·요금제·티켓 정보 및 조회에 필요한 인증·조직·정책 정보를 해당 서비스에서 읽기 전용으로 요청합니다. 서비스별로 활성화하거나 접근 권한을 철회할 수 있습니다.

### 3. 인증정보 및 콘텐츠

AI Gauge는 사용량 조회 요청에 필요한 인증·세션 정보를 해당 서비스로 요청하는 과정에서 일시적으로 이용할 수 있습니다. 쿠키 값이나 인증 토큰을 별도로 저장하거나 개발자 서버로 전송하지 않습니다.

AI Gauge는 대화 메시지, 입력 프롬프트, 답변 내용, 첨부파일 및 결제 수단을 수집하거나 저장하지 않습니다. 표시줄 배치, 배지 표시 및 사용량 갱신을 위해 지원 서비스의 현재 페이지 주소, 탭·창 활성화 상태, 화면 이동, 입력창 구조와 응답 생성 버튼의 표시 상태를 브라우저 안에서 일시적으로 확인합니다. 이를 방문·활동 이력으로 기록하거나 분석 서버로 전송하지 않으며, 전체 인터넷 방문 기록을 수집하지 않습니다.

조회 대상과 계정·조직 일치 여부를 확인하기 위해 서비스 응답의 계정·사용자·조직 식별자와 현재 계정 선택 상태를 메모리에서 일시 처리할 수 있습니다. 원본 식별자와 인증정보는 확장 저장소에 저장하지 않습니다. 티켓 데이터의 일치 여부 확인에 사용하는 임시 비교값은 서비스 워커 메모리에서만 유지합니다.

### 4. 저장 및 외부 전송

확인된 사용량과 설정, 마이그레이션 및 갱신 운영에 필요한 일부 상태는 `chrome.storage.local`에 저장됩니다. 초기화 티켓의 신뢰 확인을 위한 일부 불리언 상태는 `chrome.storage.session`에 보관됩니다. 여러 탭에서 같은 데이터를 표시하기 위해 사용하며, 개발자가 운영하는 서버로 동기화하거나 업로드하지 않습니다.

네트워크 요청은 사용자가 활성화한 ChatGPT(`chatgpt.com`), Claude(`claude.ai`), Gemini(`gemini.google.com`)의 사용량 및 관련 읽기 전용 정보 조회를 위해 해당 서비스에 전송됩니다. 해당 서비스가 요청 정보를 처리하는 방식은 각 서비스의 개인정보 처리방침에 따릅니다.

AI Gauge는 광고, 제삼자 분석 도구 또는 사용자 활동 추적을 운영하지 않으며, 사용자 데이터를 판매하지 않습니다.

### 5. 정보 보관과 삭제

설정 및 최근 수집 데이터는 확장 프로그램이 설치된 동안 브라우저 로컬에 보관될 수 있습니다. 저장된 사용량은 최신 수집 결과로 갱신되며 장기 사용 이력 데이터베이스를 만들지 않습니다. 서비스를 비활성화하거나 사이트 접근 권한을 철회하면 해당 서비스의 새 정보 조회를 중단하고 티켓 캐시의 신뢰 상태를 무효화합니다. 이 동작으로 모든 로컬 데이터가 삭제되지는 않으며 이전 사용량 스냅샷과 설정은 확장 프로그램을 제거하기 전까지 남을 수 있습니다. 만료된 티켓은 화면에 표시하지 않지만 만료 즉시 저장소의 모든 관련 기록이 물리적으로 삭제되는 것은 아닙니다.

Chrome에서 AI Gauge 확장 프로그램을 제거하면 해당 확장 프로그램의 로컬 저장 데이터도 브라우저의 확장 제거 정책에 따라 삭제됩니다. 개별 서비스의 접근 권한은 Chrome 확장 관리 화면에서 변경하거나 철회할 수 있습니다.

### 6. Chrome 권한

- `storage`: 설정·최근 사용량·운영상태 보관
- `alarms`: 정기 수집 및 재시도
- `scripting`: 사용자가 허용한 서비스 화면에서 사용량 조회와 표시줄 삽입
- 선택적 사이트 접근 권한: 사용자가 선택한 ChatGPT, Claude, Gemini 사이트에만 접근

AI Gauge는 모든 웹사이트에 접근하는 권한이나 브라우저 쿠키를 직접 읽는 `cookies` 권한을 요청하지 않습니다.

### 7. 이용 목적 제한

AI Gauge에서 접근한 데이터는 위에서 설명한 사용량 조회·표시와 해당 기능을 안전하게 운영하는 데에만 사용합니다. 개인 맞춤 광고, 데이터 판매, 신용 평가 등 다른 목적으로 사용하지 않습니다. 개발자가 사용자의 개별 사용량을 원격에서 열람하는 기능은 제공하지 않습니다.

### 8. 변경 및 문의

본 방침이 변경되면 공개된 개인정보 처리방침을 업데이트합니다. 개인정보 처리와 관련한 문의는 **han41858@gmail.com**으로 보내실 수 있습니다.

AI Gauge는 OpenAI, Anthropic 또는 Google의 공식 제품이 아니며 이들 회사와 제휴하거나 보증받지 않았습니다.

---

## English

### 1. Purpose

AI Gauge is a Chrome extension that displays usage limits and reset times for ChatGPT, Claude, and Gemini services enabled by the user. Where available, it also displays plan names and usage-reset ticket information.

### 2. Information processed

To provide its features, AI Gauge may process usage percentages, limit types, reset times, available plan names, reset-ticket counts and expiration details for supported services, extension preferences, and collection status or retry metadata.

The extension retrieves this information using the user's existing signed-in browser session for sites the user has permitted. While a service is enabled and site access is permitted, AI Gauge may refresh its data in the background using the existing signed-in session even when no tab for that service is open. These read-only requests retrieve usage, plan, and ticket information, along with authentication, organization, or policy information needed for those queries, from the relevant service. Users can enable individual services and revoke site access.

### 3. Authentication and content

Authentication or session data may be used transiently to send requests to the relevant AI service. AI Gauge does not separately store cookie values or authentication tokens or send them to a developer-operated server.

AI Gauge does not collect or store conversation messages, prompts, responses, attachments, or payment methods. To place its display, update badges, and refresh usage, it transiently checks supported pages’ current URLs, tab and window activation, navigation, input-area structure, and the presence of response-generation controls. It does not record these signals as a browsing or activity history or send them to an analytics server, and it does not collect complete browsing history.

Account, user, or organization identifiers returned by a service, along with the current account-selection context, may be processed transiently in memory to select the correct data and check account or organization consistency. Raw identifiers and credentials are not saved in extension storage. Temporary values used to check ticket-data consistency are kept only in service-worker memory.

### 4. Storage and data sharing

Normalized usage information, preferences, migration state, and limited operational state are stored in `chrome.storage.local` and shared between the user's browser tabs. Some boolean ticket-trust state is kept in `chrome.storage.session`. They are not uploaded or synchronized to a developer-operated backend.

Requests for usage and related read-only information are made to the enabled service's own domains: `chatgpt.com`, `claude.ai`, and `gemini.google.com`. Those providers process requests under their own privacy policies.

AI Gauge contains no advertising, third-party analytics, or behavioral tracking, and does not sell user data.

### 5. Retention and deletion

Preferences and the latest collected state may be retained locally while the extension is installed. Usage snapshots are updated with newer results; AI Gauge does not maintain a long-term usage history database. Disabling a service or revoking its site permission stops new collection for that service and invalidates ticket-cache trust. This does not erase all local data; preferences and previously collected usage may remain until the extension is removed. Expired tickets are excluded from display but related stored records are not guaranteed to be physically removed immediately upon expiration.

Removing the extension through Chrome removes its extension-local data according to Chrome's extension removal behavior. Site permissions can be changed or revoked in Chrome's extension management settings.

### 6. Permissions

- `storage`: save preferences and recent usage state
- `alarms`: schedule collection and retries
- `scripting`: collect and display information on explicitly permitted AI service pages
- Optional site permissions: access only supported sites selected by the user

AI Gauge does not request access to all websites or the `cookies` permission to read browser cookie values directly.

### 7. Limited use

Data accessed by AI Gauge is used solely to provide and safely operate the disclosed usage-monitoring features. It is not used for personalized advertising, sale, credit evaluation, or unrelated purposes. The developer cannot remotely view an individual's local usage data through the extension.

### 8. Changes and contact

This policy will be updated if data practices change. For privacy-related inquiries, contact **han41858@gmail.com**.

AI Gauge is independent and is not affiliated with, endorsed by, or an official product of OpenAI, Anthropic, or Google.
