import english from '../../_locales/en/messages.json';
import korean from '../../_locales/ko/messages.json';
import type { LanguagePreference } from './types';

export type MessageKey = keyof typeof english;
export type UILanguage = 'en' | 'ko';
const api = globalThis.chrome?.i18n;
let preference: LanguagePreference = 'system';

export function setLanguagePreference(language: LanguagePreference): void {
  preference = language === 'en' || language === 'ko' ? language : 'system';
}

export function languageForUI(language: string): UILanguage {
  return /^ko(?:-|$)/i.test(language) ? 'ko' : 'en';
}
export function uiLanguage(): UILanguage {
  return preference === 'system' ? languageForUI(api?.getUILanguage() ?? 'en') : preference;
}
export function t(key: MessageKey, substitutions: string | string[] = []): string {
  const values = typeof substitutions === 'string' ? [substitutions] : substitutions;
  const translated = preference === 'system' ? api?.getMessage(key, values) : '';
  if (translated) return translated;
  const message = (uiLanguage() === 'ko' ? korean[key] : english[key])?.message ?? english[key].message;
  return message.replace(/\$(\d+)/g, (_, index: string) => values[Number(index) - 1] ?? '');
}

/** Translate extension-owned text only; messages are never interpreted as HTML. */
export function localizeDocument(doc: Document): void {
  doc.documentElement.lang = uiLanguage();
  for (const node of doc.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset.i18n;
    if (key && Object.hasOwn(english, key)) node.textContent = t(key as MessageKey);
  }
  for (const attribute of ['aria-label', 'title', 'placeholder']) {
    for (const node of doc.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)) {
      const key = node.getAttribute(`data-i18n-${attribute}`);
      if (key && Object.hasOwn(english, key)) node.setAttribute(attribute, t(key as MessageKey));
    }
  }
}
