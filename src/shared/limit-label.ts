import type { Provider, UsageLimit } from './types';
import { t } from './i18n';

/** Translate app-owned labels at presentation time, including existing Korean caches. */
export function localizedLimitLabel(limit: UsageLimit, provider?: Provider): string {
  const label = provider === 'chatgpt'
    ? limit.label.replace(/^(?:ChatGPT\s*·\s*|Work\s*\/\s*Codex\s*공유\s*(?:[·:–—-]\s*)?)/, '').trim()
    : limit.label;
  return label.split(' · ').map(part => {
    const period = /^(\d+(?:\.\d+)?)(시간|일)$/.exec(part);
    if (period) {
      const value = period[1]!, unit = period[2] === '일' ? 'days' : 'hours';
      return t(`limit_${unit}_${Number(value) === 1 ? 'one' : 'other'}`, value);
    }
    if (part === '기본 제한') return t('limit_primary');
    if (part === '추가 제한') return t('limit_additional');
    if (part === '주간') return t('limit_weekly');
    if (part === 'Work / Codex 공유') return t('limit_legacy_shared');
    return part;
  }).join(' · ') || t('format_usage_name');
}
