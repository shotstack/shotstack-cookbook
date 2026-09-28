const MUSIC_URL =
  'https://shotstack-assets.s3.amazonaws.com/music/unminus/lit.mp3';
const CLIP_SECONDS = 10;

// Each goal becomes one trimmed clip of the full match recording. "auto"
// starts each clip when the previous one ends, so the goals join in one
// render with no intermediate files.
function goalClips(match, options) {
  return match.goals.map((goal, index) => ({
    asset: {
      type: 'video',
      src: match.source,
      trim: goal.at,
      volume: options.volume
    },
    start: index === 0 ? 0 : 'auto',
    length: CLIP_SECONDS,
    ...options.clip
  }));
}

// The landscape footage keeps its full frame in the middle of the vertical
// video. A blurred copy of the same clip fills the space above and below, so
// the footage is not cropped or enlarged.
export function buildEdit(match) {
  return {
    timeline: {
      background: '#000000',
      tracks: [
        { clips: goalClips(match, { volume: 0.6, clip: { fit: 'contain' } }) },
        {
          clips: goalClips(match, {
            volume: 0,
            clip: { fit: 'crop', filter: 'blur', opacity: 0.6 }
          })
        },
        {
          clips: [
            {
              asset: {
                type: 'audio',
                src: MUSIC_URL,
                volume: 0.35,
                effect: 'fadeInFadeOut'
              },
              start: 0,
              length: 'end'
            }
          ]
        }
      ]
    },
    output: { format: 'mp4', size: { width: 1080, height: 1920 } }
  };
}
