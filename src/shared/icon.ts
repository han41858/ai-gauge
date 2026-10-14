declare const __AI_GAUGE_ICON__: string;

// The build embeds the supplied 20px PNG, without a page request or public asset
// URL. Unbundled DOM unit tests have no image loader and can omit the decoration.
export const ICON_DATA_URL = typeof __AI_GAUGE_ICON__ === 'undefined' ? '' : __AI_GAUGE_ICON__;
