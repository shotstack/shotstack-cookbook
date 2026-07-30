// Per-story font and accent palette, used by the rich-text headline and the
// rich-caption track.
//
// The render engine ships a small built-in font set (Montserrat, Open Sans,
// Roboto and friends, all weight 400). These display faces are not in it, so
// each is loaded from a URL via timeline.fonts.
//
// The `family` value is the URL filename without the .ttf extension. Shotstack
// looks the loaded font up by basename, so if the two drift apart the font
// silently fails to apply. Never hand-edit these URLs: Google rotates the
// version segment and the hash, so a reconstructed URL 404s.

export type StoryFont = {
  headline: { url: string; family: string };
  caption: { url: string; family: string };
  captionActiveColor: string;
};

export const storyFonts: Record<string, StoryFont> = {
  'Scary Story': {
    headline: {
      url: 'https://fonts.gstatic.com/s/creepster/v13/AlZy_zVUqJz4yMrniH4hdXf4XB0Tow.ttf',
      family: 'AlZy_zVUqJz4yMrniH4hdXf4XB0Tow'
    },
    caption: {
      url: 'https://fonts.gstatic.com/s/bangers/v25/FeVQS0BTqb0h60ACL5la2bxii28.ttf',
      family: 'FeVQS0BTqb0h60ACL5la2bxii28'
    },
    captionActiveColor: '#ff3030'
  },
  'Bedtime Story': {
    headline: {
      url: 'https://fonts.gstatic.com/s/kalam/v18/YA9dr0Wd4kDdMuhWMibDszkB.ttf',
      family: 'YA9dr0Wd4kDdMuhWMibDszkB'
    },
    caption: {
      url: 'https://fonts.gstatic.com/s/kalam/v18/YA9dr0Wd4kDdMuhWMibDszkB.ttf',
      family: 'YA9dr0Wd4kDdMuhWMibDszkB'
    },
    captionActiveColor: '#ffd166'
  },
  Adventure: {
    headline: {
      url: 'https://fonts.gstatic.com/s/bangers/v25/FeVQS0BTqb0h60ACL5la2bxii28.ttf',
      family: 'FeVQS0BTqb0h60ACL5la2bxii28'
    },
    caption: {
      url: 'https://fonts.gstatic.com/s/bangers/v25/FeVQS0BTqb0h60ACL5la2bxii28.ttf',
      family: 'FeVQS0BTqb0h60ACL5la2bxii28'
    },
    captionActiveColor: '#6375ff'
  }
};

export const defaultStoryFont = storyFonts.Adventure;
