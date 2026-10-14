// Initial structural candidates from public reference material; the current
// authenticated Gemini DOM still needs a live check. Unknown layouts stay hidden.
export const GEMINI_COMPOSER = 'input-area-v2,.input-area';
export const GEMINI_INPUT = GEMINI_COMPOSER.split(',').flatMap(scope => [
  `${scope} rich-textarea [contenteditable]`, `${scope} textarea`
]).join(',');
export const GEMINI_STOP = 'button[data-test-id="stop-button"],button[aria-label="Stop response" i],button[aria-label="Stop generating" i],button[aria-label="응답 중지"],button[aria-label="생성 중지"]';
const MESSAGES = 'user-query,model-response,message-content';

export function geminiBoundary(input: HTMLElement): HTMLElement | null {
  const boundary = input.closest<HTMLElement>(GEMINI_COMPOSER);
  return boundary && !boundary.closest(`[contenteditable],${MESSAGES}`) && !boundary.querySelector(MESSAGES)
    ? boundary : null;
}
