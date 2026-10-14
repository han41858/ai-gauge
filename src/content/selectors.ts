import type { PageProvider } from '../shared/types';
import { GEMINI_INPUT, GEMINI_STOP, geminiBoundary } from './gemini';

const EDITABLE = '[contenteditable],textarea';
const COMPOSER = 'form[data-chatgpt-composer],form[data-type="unified-composer"],[data-testid="codex-composer"],[data-testid="composer"]';
const EXPLICIT_INPUT = `#prompt-textarea,${COMPOSER.split(',').flatMap(container => [`${container} textarea`, `${container} [contenteditable]`]).join(',')}`;
const OWN_UI = '#ai-gauge-usage-strip';
const EXCLUDED = `[hidden],[inert],[aria-hidden="true"],dialog,[role="dialog"],[role="search"],nav,[data-message-author-role],[data-testid="user-message"],[data-testid^="conversation-turn-"],${OWN_UI}`;
const SHELL = 'html,body,main,[role="main"],[role="application"],article,aside';
const UNRELATED_REGION = 'main,[role="main"],[role="application"],article,aside,nav,header,[role="search"],[data-message-author-role],[data-testid="user-message"],[data-testid^="conversation-turn-"]';
const STOP = 'button[data-testid="stop-button"],button[aria-label="Stop response" i],button[aria-label="응답 중지"]';
const CLAUDE_STOP = `${STOP},button[data-testid="stop-response-button"],button[aria-label="Stop generating" i],button[aria-label="Stop generation" i],button[aria-label="생성 중지"]`;

export const SELECTORS: Record<PageProvider, { input: string; stop: string }> = {
  chatgpt: { input: '#prompt-textarea', stop: STOP },
  codex: { input: EDITABLE, stop: STOP },
  claude: { input: EDITABLE, stop: CLAUDE_STOP },
  gemini: { input: GEMINI_INPUT, stop: GEMINI_STOP }
};

function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest(EXCLUDED)) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse'
      || style?.contentVisibility === 'hidden' || style?.opacity === '0') return false;
  }
  return true;
}

export function hasStreamingControl(doc: Document, provider: PageProvider): boolean {
  return [...doc.querySelectorAll<HTMLElement>(SELECTORS[provider].stop)].some(control =>
    visible(control) && (provider !== 'gemini' || (!control.closest('[contenteditable]') && geminiBoundary(control) !== null)));
}

function editingHost(element: Element): boolean {
  if (element.tagName === 'TEXTAREA') return true;
  const value = element.getAttribute('contenteditable')?.toLowerCase();
  return value === '' || value === 'true' || value === 'plaintext-only';
}

function onScreen(element: HTMLElement): boolean {
  const doc = element.ownerDocument, win = doc.defaultView;
  // Layoutless DOM implementations cannot answer geometry queries. In Chrome,
  // require an actual box so hidden resize mirrors cannot hide the real editor.
  if (!win || !doc.documentElement.getClientRects().length) return true;
  return [...element.getClientRects()].some(rect => rect.width > 1 && rect.height > 1
    && rect.bottom > 0 && rect.right > 0 && rect.top < win.innerHeight && rect.left < win.innerWidth);
}

function eligibleInput(input: HTMLElement): boolean {
  if (!editingHost(input) || !visible(input) || !onScreen(input) || input.matches(':disabled,[readonly],[aria-readonly="true"],[role="searchbox"]')) return false;
  // Nested editable nodes are part of one editor, not separate composer candidates.
  const editableParent = input.parentElement?.closest('[contenteditable]');
  return !editableParent || !editingHost(editableParent);
}

function inputsInside(element: HTMLElement): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>(EDITABLE)].filter(eligibleInput);
}

function shell(element: HTMLElement): boolean {
  return element.matches(SHELL) || !!element.closest(EXCLUDED);
}

function onlyEditor(element: HTMLElement, input: HTMLElement): boolean {
  const inputs = inputsInside(element);
  return inputs.length === 1 && inputs[0] === input;
}

function bounded(element: HTMLElement, input: HTMLElement): boolean {
  return !shell(element) && !element.querySelector(UNRELATED_REGION) && onlyEditor(element, input);
}

function claudeInnerAnchor(input: HTMLElement): HTMLElement | null {
  const surface = input.closest<HTMLElement>('div.bg-surface-3');
  if (!surface || !bounded(surface, input) || surface.closest('[contenteditable]')) return null;
  // Support both the class reported by the user and the usual Tailwind spelling.
  // Keep the new row inside the surface, but outside every editable descendant.
  for (let anchor = input.parentElement; anchor && anchor !== surface; anchor = anchor.parentElement) {
    if (!anchor.matches('div.relative.w-full.min-w-0,div.relative.w-full.mni-w-0')) continue;
    const parent = anchor.parentElement;
    if (!parent || !surface.contains(parent) || parent.closest('[contenteditable]')) continue;
    const style = parent.ownerDocument.defaultView?.getComputedStyle(parent);
    const row = (style?.display === 'flex' || style?.display === 'inline-flex')
      && !style.flexDirection.startsWith('column');
    if (row || style?.display === 'grid' || style?.display === 'inline-grid' || style?.display === 'contents') continue;
    if (bounded(anchor, input)) return anchor;
  }
  return null;
}

function composerBoundary(input: HTMLElement, provider: PageProvider): HTMLElement | null {
  if (provider === 'gemini') {
    const boundary = geminiBoundary(input);
    return boundary && bounded(boundary, input) ? boundary : null;
  }
  for (const declared of [input.closest<HTMLElement>(COMPOSER), input.closest<HTMLElement>('form'), input.closest<HTMLElement>('fieldset')]) {
    if (declared && bounded(declared, input)) return declared;
  }
  if (provider === 'chatgpt') return null;

  // Codex can use a Lexical editor without a form; Claude places its toolbar
  // beside the editor. Find a bounded ancestor containing both, never the editor.
  let branch = input;
  while (branch.parentElement) {
    const parent = branch.parentElement;
    if (!bounded(parent, input)) return null;
    const controls = [...parent.querySelectorAll<HTMLElement>('button,[role="button"],[role="toolbar"]')]
      .filter(control => !branch.contains(control) && visible(control));
    if (controls.length > 0) return parent;
    branch = parent;
  }
  return null;
}

function painted(style: CSSStyleDeclaration | undefined): boolean {
  if (!style) return false;
  const border = [style.borderTopWidth, style.borderBottomWidth, style.borderLeftWidth, style.borderRightWidth]
    .some(width => Number.parseFloat(width) > 0);
  const shadow = !!style.boxShadow && style.boxShadow !== 'none';
  const roundedBackground = Number.parseFloat(style.borderRadius) > 0
    && !!style.backgroundColor && !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor);
  return border || shadow || roundedBackground;
}

function compactWrapper(parent: HTMLElement, children: HTMLElement[], style: CSSStyleDeclaration | undefined): boolean {
  // A full-height centered page is not a composer shell, even if it currently
  // has only one child. Geometry distinguishes the two without reading text.
  if (!parent.ownerDocument.documentElement.getClientRects().length) return true;
  const parentRect = parent.getBoundingClientRect();
  const boxes = children.map(child => child.getBoundingClientRect()).filter(box => box.height > 0 && box.width > 0);
  if (!boxes.length || parentRect.height <= 0) return false;
  const contentHeight = Math.max(...boxes.map(box => box.bottom)) - Math.min(...boxes.map(box => box.top));
  const insets = [style?.paddingTop, style?.paddingBottom, style?.borderTopWidth, style?.borderBottomWidth]
    .reduce((sum, value) => sum + (Number.parseFloat(value ?? '') || 0), 0);
  return parentRect.height <= contentHeight + insets + 2;
}

function outsideLayout(boundary: HTMLElement, input: HTMLElement): HTMLElement | null {
  let anchor = boundary;
  while (anchor.parentElement) {
    const parent = anchor.parentElement;
    if (parent.closest('[contenteditable]')) return null;
    const style = parent.ownerDocument.defaultView?.getComputedStyle(parent);
    const isRow = (style?.display === 'flex' || style?.display === 'inline-flex')
      && !style.flexDirection.startsWith('column');
    const grid = style?.display === 'grid' || style?.display === 'inline-grid';
    const constrained = isRow || grid
      || ['hidden', 'clip'].includes(style?.overflowY ?? '') || ['hidden', 'clip'].includes(style?.overflow ?? '');
    const contents = style?.display === 'contents';
    if (shell(parent) || !onlyEditor(parent, input) || parent.querySelector(UNRELATED_REGION)) {
      return constrained || contents ? null : anchor;
    }
    const children = [...parent.children].filter((child): child is HTMLElement =>
      !child.matches(OWN_UI) && visible(child as HTMLElement));
    const singlePaintedWrapper = children.length === 1 && children[0] === anchor && painted(style);
    if (contents || ((constrained || singlePaintedWrapper) && children.length <= 4 && compactWrapper(parent, children, style))) {
      anchor = parent;
      continue;
    }
    // Ordinary one-child wrappers are layout, not evidence of a larger composer.
    // Staying at the nearest safe row also makes helper visibility irrelevant.
    return constrained ? null : anchor;
  }
  return null;
}

export interface ComposerTarget { input: HTMLElement | null; anchor: HTMLElement; placement?: 'after' | 'append' }

function codexFooters(doc: Document): HTMLElement[] {
  const prefix = 'ComposerLayoutFooter-';
  return [...doc.querySelectorAll<HTMLElement>('div[class*="ComposerLayoutFooter-"]')]
    .filter(footer => [...footer.classList].some(token => token.startsWith(prefix) && token.length > prefix.length)
      && visible(footer) && onScreen(footer) && !footer.closest('[contenteditable]')
      && !footer.querySelector(UNRELATED_REGION));
}

export function hasCodexFooter(doc: Document): boolean {
  return codexFooters(doc).length > 0;
}

function codexFooterTargets(doc: Document): ComposerTarget[] {
  const footers = codexFooters(doc);
  return footers.map(anchor => {
    // The footer and editor can be siblings. Associate through their nearest
    // unambiguous layout without requiring the editor to be inside the footer.
    let input: HTMLElement | null = null;
    for (let scope: HTMLElement | null = anchor; scope && !scope.matches('html,body'); scope = scope.parentElement) {
      if (scope.closest(EXCLUDED) || scope.querySelector(UNRELATED_REGION)) break;
      if (footers.filter(footer => scope.contains(footer)).length !== 1) break;
      const inputs = inputsInside(scope);
      if (inputs.length === 1) { input = inputs[0]!; break; }
      if (inputs.length > 1) break;
    }
    return { input, anchor, placement: 'append' };
  });
}

function preferredCodexFooter(targets: ComposerTarget[], doc: Document): ComposerTarget | null {
  if (targets.length === 1) return targets[0]!;
  const focused = targets.filter(({ input, anchor }) => anchor.contains(doc.activeElement)
    || input === doc.activeElement || !!input?.contains(doc.activeElement));
  if (focused.length === 1) return focused[0]!;
  const associated = targets.filter(({ input }) => input !== null);
  return associated.length === 1 ? associated[0]! : null;
}

export function findComposerTarget(doc: Document, provider: PageProvider): ComposerTarget | null {
  if (provider === 'codex') {
    const footers = codexFooterTargets(doc);
    if (footers.length) return preferredCodexFooter(footers, doc);
  }
  const selector = provider === 'chatgpt' ? EXPLICIT_INPUT : SELECTORS[provider].input;
  const targets: ComposerTarget[] = [];
  for (const input of doc.querySelectorAll<HTMLElement>(selector)) {
    if (!eligibleInput(input)) continue;
    const inner = provider === 'claude' ? claudeInnerAnchor(input) : null;
    const boundary = composerBoundary(input, provider);
    const anchor = inner ?? (boundary && outsideLayout(boundary, input));
    if (anchor) targets.push({ input, anchor });
  }
  if (targets.length === 1) return targets[0]!;
  const focused = targets.filter(({ input }) => input === doc.activeElement || !!input?.contains(doc.activeElement));
  if (focused.length === 1) return focused[0]!;
  const explicit = targets.filter(({ input }) => input?.matches(EXPLICIT_INPUT));
  return explicit.length === 1 ? explicit[0]! : null;
}

export function findComposer(doc: Document, provider: PageProvider): HTMLElement | null {
  return findComposerTarget(doc, provider)?.anchor ?? null;
}
