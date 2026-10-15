import { createI18n } from '../../scripts/i18n-fixture.mjs';

// Existing regression fixtures assert Korean copy; language-specific tests override this API.
globalThis.chrome ??= {};
globalThis.chrome.i18n = createI18n();
