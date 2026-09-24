const MUSIC_URL =
  'https://shotstack-assets.s3.amazonaws.com/music/unminus/ambition.mp3';
const SECONDS_PER_PHOTO = 3.2;
const MIN_LENGTH = 6;
const EFFECTS = ['zoomIn', 'slideUp', 'zoomOut', 'slideDown'];

const escapeHtml = value =>
  String(value).replace(
    /[&<>"']/g,
    character =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]
  );

// The specification card is an html5 asset. The vehicle data is written into
// the markup here, so the card can change shape per dealer without a template.
function specCard(vehicle, length) {
  const title = escapeHtml(`${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  const chips = [vehicle.odometer, vehicle.transmission, vehicle.fuel]
    .map(
      (text, index) =>
        `<span class="chip" id="chip${index}">${escapeHtml(text)}</span>`
    )
    .join('');

  return {
    asset: {
      type: 'html5',
      html: `<div class="card" id="card"><div class="title">${title}</div><div class="trim">${escapeHtml(vehicle.trim)}</div><div class="price">${escapeHtml(vehicle.price)}</div><div class="row">${chips}</div></div>`,
      css: 'html,body{margin:0;padding:0;width:960px;height:420px;overflow:hidden;background:transparent;font-family:system-ui,sans-serif}.card{box-sizing:border-box;width:960px;height:420px;padding:40px 48px;background:rgba(10,15,30,0.86);border-radius:32px;color:#fff;opacity:0;transform:translateY(24px)}.title{font-size:60px;font-weight:800;letter-spacing:-1px;line-height:1.05}.trim{margin-top:10px;font-size:34px;color:#cbd5e1}.price{margin-top:22px;font-size:72px;font-weight:800;color:#facc15;line-height:1}.row{display:flex;gap:14px;margin-top:26px}.chip{font-size:28px;padding:10px 20px;border-radius:999px;background:rgba(255,255,255,0.14);color:#e2e8f0;white-space:nowrap;opacity:0;transform:translateY(12px)}',
      js: "const tl=gsap.timeline();tl.to('#card',{opacity:1,y:0,duration:0.6,ease:'power3.out'},0).to(['#chip0','#chip1','#chip2'],{opacity:1,y:0,duration:0.6,ease:'power3.out',stagger:0.13},0.3);"
    },
    start: 0.5,
    length: length - 0.5,
    width: 960,
    height: 420,
    position: 'bottom',
    offset: { y: 0.05 }
  };
}

function dealerBadge(vehicle, length) {
  return {
    asset: {
      type: 'html5',
      html: `<div class="badge">${escapeHtml(vehicle.dealer)}</div>`,
      css: 'html,body{margin:0;padding:0;width:960px;height:110px;overflow:hidden;background:transparent;font-family:system-ui,sans-serif}.badge{box-sizing:border-box;display:inline-block;height:110px;line-height:110px;padding:0 44px;border-radius:55px;background:rgba(10,15,30,0.7);color:#fff;font-size:42px;font-weight:700}'
    },
    start: 0,
    length,
    width: 960,
    height: 110,
    position: 'top',
    offset: { y: -0.04 }
  };
}

// One clip per photo on a single track. "auto" starts each clip when the
// previous one ends, so the video is as long as the vehicle has photos.
function photoClips(photos, secondsPerPhoto) {
  return photos.map((src, index) => ({
    asset: { type: 'image', src },
    start: index === 0 ? 0 : 'auto',
    length: secondsPerPhoto,
    fit: 'crop',
    effect: EFFECTS[index % EFFECTS.length],
    transition: { in: 'fade' }
  }));
}

export function buildEdit(vehicle) {
  // A vehicle with one photo still gets a video long enough to read the card.
  const secondsPerPhoto = Math.max(
    SECONDS_PER_PHOTO,
    MIN_LENGTH / vehicle.photos.length
  );
  const length = secondsPerPhoto * vehicle.photos.length;

  return {
    timeline: {
      background: '#000000',
      tracks: [
        { clips: [specCard(vehicle, length)] },
        { clips: [dealerBadge(vehicle, length)] },
        { clips: photoClips(vehicle.photos, secondsPerPhoto) },
        {
          clips: [
            {
              asset: {
                type: 'audio',
                src: MUSIC_URL,
                volume: 0.3,
                effect: 'fadeOut'
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
