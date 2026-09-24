const MUSIC_URL =
  'https://shotstack-assets.s3.amazonaws.com/music/unminus/lit.mp3';
const CLIP_SECONDS = 10;

// Each goal becomes one trimmed clip of the full match recording. "auto"
// starts each clip when the previous one ends, so the goals join in one
// render with no intermediate files. fit "crop" fills the vertical frame
// from the center of the landscape footage.
function goalClips(match) {
  return match.goals.map((goal, index) => ({
    asset: { type: 'video', src: match.source, trim: goal.at, volume: 0.6 },
    start: index === 0 ? 0 : 'auto',
    length: CLIP_SECONDS,
    fit: 'crop'
  }));
}

export function buildEdit(match) {
  return {
    timeline: {
      background: '#000000',
      tracks: [
        { clips: goalClips(match) },
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
