const MUSIC_URL =
  'https://shotstack-assets.s3.amazonaws.com/music/unminus/happy.mp3';
const SECONDS_PER_ITEM = 3.5;
const END_CARD_SECONDS = 2;
const WIDTH = 1080;
const HEIGHT = 1920;

// One clip per item in the client's media library, images and videos mixed.
// "auto" starts each clip when the previous one ends, so a client with three
// items gets a shorter video than a client with five. Video clips play
// without their own sound, under the music.
function mediaClips(client) {
  return client.media.map((item, index) => ({
    asset:
      item.type === 'video'
        ? { type: 'video', src: item.src, volume: 0 }
        : { type: 'image', src: item.src },
    start: index === 0 ? 0 : 'auto',
    length: SECONDS_PER_ITEM,
    fit: 'crop',
    effect: item.type === 'image' ? 'zoomInSlow' : undefined
  }));
}

export function buildEdit(client) {
  const endStart = client.media.length * SECONDS_PER_ITEM;
  const background = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}"><rect width="${WIDTH}" height="${HEIGHT}" fill="${client.brandColor}"/></svg>`;

  return {
    timeline: {
      background: '#000000',
      tracks: [
        {
          clips: [
            {
              asset: { type: 'svg', src: client.brandMark },
              start: endStart,
              length: END_CARD_SECONDS,
              width: 240,
              height: 240,
              fit: 'contain',
              transition: { in: 'fade' }
            }
          ]
        },
        {
          clips: [
            ...mediaClips(client),
            {
              asset: { type: 'svg', src: background },
              start: 'auto',
              length: END_CARD_SECONDS,
              transition: { in: 'fade' }
            }
          ]
        },
        {
          clips: [
            {
              asset: {
                type: 'audio',
                src: MUSIC_URL,
                volume: 0.5,
                effect: 'fadeOut'
              },
              start: 0,
              length: 'end'
            }
          ]
        }
      ]
    },
    output: { format: 'mp4', size: { width: WIDTH, height: HEIGHT } }
  };
}
