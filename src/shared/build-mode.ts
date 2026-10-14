declare const __AI_GAUGE_DEVELOPMENT__: boolean;

// Direct source/fixture execution defaults to development; packaged builds set
// this constant explicitly so release UI and content handlers omit diagnostics.
export const DEVELOPMENT = typeof __AI_GAUGE_DEVELOPMENT__ === 'undefined' || __AI_GAUGE_DEVELOPMENT__;
