// Each reviewed area is enabled explicitly; the default remains six voice tools.
export const areas = { inference: () => import('./inference-area.mjs'), media: () => import('./media-area.mjs') };
