const TEMPLATE_V1 = process.env.SHOTSTACK_TEMPLATE_ID;

export const clients = {
  'meridian-realty': {
    name: 'Meridian Realty',
    templateId: TEMPLATE_V1,
    headline: 'Twelve new listings this week.',
    font: 'Montserrat',
    footage:
      'https://shotstack-ingest-api-v1-sources.s3.ap-southeast-2.amazonaws.com/35tqpmb0ya/zzz01m08-qxa25-864e6-zty3t-3sttne/source.mp4',
    music:
      'https://s3-ap-southeast-2.amazonaws.com/shotstack-assets/music/moment.mp3',
    brandMark:
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect x="10" y="10" width="100" height="100" rx="16" fill="#1b6ca8"/></svg>'
  },

  'driftwood-retreats': {
    name: 'Driftwood Retreats',
    templateId: TEMPLATE_V1,
    headline: 'Off-season rates end Sunday.',
    font: 'Open Sans',
    footage:
      'https://shotstack-ingest-api-v1-sources.s3.ap-southeast-2.amazonaws.com/35tqpmb0ya/zzz01m08-qxkz1-xz4yp-pfbj3-14r3s3/source.mp4',
    music:
      'https://s3-ap-southeast-2.amazonaws.com/shotstack-assets/music/spirit.mp3',
    brandMark:
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="50" fill="#c1701e"/></svg>'
  },

  'apex-skate': {
    name: 'Apex Skate Co.',
    templateId: TEMPLATE_V1,
    headline: 'New deck drop. Friday.',
    font: 'Permanent Marker',
    footage:
      'https://shotstack-ingest-api-v1-sources.s3.ap-southeast-2.amazonaws.com/35tqpmb0ya/zzz01m08-qy60n-yb4w2-ks55h-tej73h/source.mp4',
    music:
      'https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/music/unminus/lit.mp3',
    brandMark:
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><polygon points="60,10 110,105 10,105" fill="#b7f32b"/></svg>'
  }
};

/**
 * Aspect ratio variants.
 *
 * Explicit width/height rather than output.aspectRatio: numeric fields accept
 * "{{ PLACEHOLDER }}" strings, but aspectRatio is an enum and may reject one.
 */
export const variants = [
  { name: '16x9', width: 1920, height: 1080 },
  { name: '9x16', width: 1080, height: 1920 },
  { name: '1x1', width: 1080, height: 1080 }
];

/** Expand a client + variant into the merge array the render endpoint expects. */
export function mergeFieldsFor(client, variant) {
  return [
    { find: 'HEADLINE', replace: client.headline },
    { find: 'FONT', replace: client.font },
    { find: 'BRAND_MARK', replace: client.brandMark },
    { find: 'FOOTAGE', replace: client.footage },
    { find: 'MUSIC', replace: client.music },
    { find: 'WIDTH', replace: variant.width },
    { find: 'HEIGHT', replace: variant.height }
  ];
}
