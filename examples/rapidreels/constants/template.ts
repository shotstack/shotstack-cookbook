import { storyFonts, defaultStoryFont, StoryFont } from '@constants/fonts';

const imageTrackRight = {
  clips: [
    {
      fit: 'crop',
      scale: 1,
      length: 5,
      asset: {
        width: '768',
        height: '1280',
        type: 'text-to-image',
        prompt: '{{ image-prompt-2 }}'
      },
      start: 4,
      effect: 'zoomOut',
      transition: { in: 'fade', out: 'fade' }
    },
    {
      fit: 'crop',
      scale: 1,
      length: 5,
      asset: {
        width: '768',
        height: '1280',
        type: 'text-to-image',
        prompt: '{{ image-prompt-4 }}'
      },
      start: 12,
      effect: 'zoomOut',
      transition: { in: 'fade', out: 'fade' }
    },
    {
      fit: 'crop',
      scale: 1,
      length: 'end',
      asset: {
        width: '768',
        height: '1280',
        type: 'text-to-image',
        prompt: '{{ image-prompt-6 }}'
      },
      start: 20,
      effect: 'zoomOut',
      transition: { in: 'fade', out: 'fade' }
    }
  ]
};

const imageTrackLeft = {
  clips: [
    {
      fit: 'crop',
      scale: 1,
      length: 5,
      asset: {
        width: '768',
        height: '1280',
        type: 'text-to-image',
        prompt: '{{ image-prompt-1 }}'
      },
      start: 0,
      effect: 'zoomOut',
      transition: { in: 'fade', out: 'fade' }
    },
    {
      fit: 'crop',
      scale: 1,
      length: 5,
      asset: {
        width: '768',
        height: '1280',
        type: 'text-to-image',
        prompt: '{{ image-prompt-3 }}'
      },
      start: 8,
      effect: 'zoomOut',
      transition: { in: 'fade', out: 'fade' }
    },
    {
      fit: 'crop',
      scale: 1,
      length: 5,
      asset: {
        width: '768',
        height: '1280',
        type: 'text-to-image',
        prompt: '{{ image-prompt-5 }}'
      },
      start: 16,
      effect: 'zoomOut',
      transition: { in: 'fade', out: 'fade' }
    }
  ]
};

const audioTrack = {
  clips: [
    {
      length: 'auto',
      asset: {
        voice: '{{ voice }}',
        text: '{{ voiceover }}',
        type: 'text-to-speech'
      },
      start: 0,
      alias: 'voiceover'
    }
  ]
};

const headlineTrack = (fonts: StoryFont) => ({
  clips: [
    {
      asset: {
        type: 'rich-text',
        text: '{{ headline }}',
        font: {
          family: fonts.headline.family,
          size: 64,
          color: '#ffffff',
          weight: 800
        },
        stroke: { width: 6, color: '#000000', opacity: 1 },
        align: { horizontal: 'center', vertical: 'middle' }
      },
      start: 0.5,
      length: 4,
      width: 640,
      height: 220,
      fit: 'none',
      offset: { x: 0, y: 0.32 },
      transition: { in: 'fade', out: 'fade' }
    }
  ]
});

const captionTrack = (fonts: StoryFont) => ({
  clips: [
    {
      asset: {
        type: 'rich-caption',
        src: 'alias://voiceover',
        font: {
          family: fonts.caption.family,
          size: 56,
          color: '#ffffff',
          opacity: 1,
          weight: 700
        },
        animation: { style: 'pop' },
        border: { width: 0, color: '#000000', opacity: 1, radius: 18 },
        style: { textTransform: 'none' },
        padding: { top: 25, right: 0, bottom: 0, left: 0 },
        stroke: { width: 8, color: '#000000', opacity: 1 },
        active: {
          font: { color: fonts.captionActiveColor },
          stroke: { width: 8, color: '#000000', opacity: 1 }
        }
      },
      start: 0,
      length: 'end',
      width: 640,
      height: 160,
      fit: 'none',
      offset: { x: 0, y: -0.35 }
    }
  ]
});

export const buildTemplate = (storyType: string) => {
  const fonts = storyFonts[storyType] || defaultStoryFont;
  const fontUrls = [fonts.headline.url, fonts.caption.url].filter(
    (url, index, all) => all.indexOf(url) === index
  );

  return {
    timeline: {
      background: '#000000',
      fonts: fontUrls.map(src => ({ src })),
      tracks: [
        headlineTrack(fonts),
        captionTrack(fonts),
        imageTrackRight,
        imageTrackLeft,
        audioTrack
      ]
    },
    output: {
      format: 'mp4',
      fps: 25,
      size: { width: 720, height: 1280 }
    }
  };
};
