import { readFileSync } from 'node:fs';

const catalogs = Object.fromEntries(['en', 'ko'].map(language => [language,
  JSON.parse(readFileSync(new URL(`../_locales/${language}/messages.json`, import.meta.url), 'utf8'))]));

// Also serialized into isolated browser/VM realms; keep its dependencies in the arguments.
function catalogApi(messages, initialLanguage) {
  let language = initialLanguage;
  return {
    getUILanguage: () => language,
    setUILanguage(value) { language = value; },
    getMessage(key, substitutions = []) {
      if (key === '@@ui_locale') return language;
      const locale = /^ko(?:-|$)/i.test(language) ? 'ko' : 'en';
      const entry = messages[locale][key] ?? messages.en[key];
      if (!entry) return '';
      const values = Array.isArray(substitutions) ? substitutions : [substitutions];
      const placeholders = Object.fromEntries(Object.entries(entry.placeholders ?? {}).map(([name, value]) => [name.toLowerCase(), value.content]));
      const replace = text => text.replace(/\$(\d+)/g, (_, index) => values[Number(index) - 1] ?? '');
      return entry.message.replace(/\$\$|\$([a-z0-9_]+)\$|\$(\d+)/gi, (match, name, index) => {
        if (match === '$$') return '$';
        if (index) return values[Number(index) - 1] ?? '';
        return placeholders[name.toLowerCase()] === undefined ? match : replace(placeholders[name.toLowerCase()]);
      });
    }
  };
}

export function createI18n(language = 'ko') { return catalogApi(catalogs, language); }
export function i18nFixtureSource(language = 'ko') {
  return `(${catalogApi.toString()})(${JSON.stringify(catalogs)}, ${JSON.stringify(language)})`;
}
