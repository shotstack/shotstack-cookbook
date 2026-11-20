// Builds the Shotstack template: the After Effects card (a Bodymovin export) in an html5 clip,
// over a footage clip, with a logo and music.
const fs = require('fs');
const path = require('path');

const MIN_FONT_SIZE = 24; // auto-shrink never goes below this size (px)

// Every text layer in the export, including the ones inside precompositions.
const textLayers = lottie =>
  [lottie.layers, ...(lottie.assets || []).map(asset => asset.layers)]
    .flat()
    .filter(layer => layer?.ty === 5);

// Text layers named in capitals (PRODUCT, PRICE) are the fields that change in each video.
function fieldNames(lottie) {
  const names = textLayers(lottie)
    .map(layer => layer.nm)
    .filter(name => /^[A-Z][A-Z0-9_]*$/.test(name));
  return [...new Set(names)];
}

// The sample text the designer typed in each field, used as the template's default merge values.
function sampleText(lottie) {
  const text = {};
  for (const layer of textLayers(lottie)) text[layer.nm] ??= layer.t.d.k[0].s.t;
  return text;
}

// The html5 clip that plays the card. Merge placeholders sit in hidden divs in the html;
// the script copies their text into the matching text layers before the animation starts.
function cardClip(lottie, fontDir) {
  const fields = fieldNames(lottie);
  const fonts = lottie.fonts?.list || [];
  if (!fonts.length) {
    throw new Error(
      'The export lists no font. Export it again from Bodymovin with Glyphs off.'
    );
  }
  // Each font comes from a file named after it in the export: Montserrat-Bold -> montserrat-bold.woff2.
  const faces = fonts.map(font => {
    const file = path.join(fontDir, `${font.fName.toLowerCase()}.woff2`);
    if (!fs.existsSync(file)) {
      throw new Error(
        `Can't find ${path.basename(file)}, the font file for ${font.fName}, next to the scripts.`
      );
    }
    return {
      family: font.fFamily,
      weight: /bold/i.test(font.fStyle) ? 700 : 400,
      data: fs.readFileSync(file).toString('base64')
    };
  });

  const html = ['<div id="card"></div>']
    .concat(
      fields.map(name => `<div hidden data-field="${name}">{{ ${name} }}</div>`)
    )
    .join('\n');

  const css = [
    ...faces.map(
      face =>
        `@font-face { font-family: '${face.family}'; font-weight: ${face.weight}; src: url(data:font/woff2;base64,${face.data}) format('woff2'); }`
    ),
    `html, body { margin: 0; width: ${lottie.w}px; height: ${lottie.h}px; overflow: hidden; background: transparent; }`,
    `#card { width: ${lottie.w}px; height: ${lottie.h}px; }`
  ].join('\n');

  const js = `
const animationData = ${JSON.stringify(lottie)};

// Put each field's value into the text layer with the same name.
const values = {};
document.querySelectorAll('[data-field]').forEach((el) => {
  values[el.dataset.field] = el.textContent.replace(/\\r?\\n/g, '\\r');
});
const layerLists = [animationData.layers].concat((animationData.assets || []).filter((a) => a.layers).map((a) => a.layers));
layerLists.forEach((layers) => layers.forEach((layer) => {
  if (layer.ty === 5 && values[layer.nm] !== undefined) {
    layer.t.d.k.forEach((keyframe) => { keyframe.s.t = values[layer.nm]; });
  }
}));

// Shrink text that doesn't fit its text box, down to ${MIN_FONT_SIZE}px.
function shrinkToFit(elements) {
  (elements || []).forEach((el) => {
    if (!el) return;
    if (el.data && el.data.ty === 5 && el.canResizeFont) {
      el.canResizeFont(true);
      el.setMinimumFontSize(${MIN_FONT_SIZE});
    }
    if (el.elements) shrinkToFit(el.elements);
  });
}

function start() {
  const anim = lottie.loadAnimation({
    container: document.getElementById('card'),
    renderer: 'svg',
    loop: false,
    autoplay: false,
    animationData: animationData,
  });
  if (anim.isLoaded) shrinkToFit(anim.renderer.elements);
  else anim.addEventListener('DOMLoaded', () => shrinkToFit(anim.renderer.elements));
}

// lottie-web lays text out from the font's measurements, so start once the fonts have loaded.
const fonts = ${JSON.stringify(faces.map(face => `${face.weight} 40px "${face.family}"`))};
Promise.all(fonts.map((font) => document.fonts.load(font))).then(start, start);`;

  for (const [field, value] of Object.entries({ css, js })) {
    if (value.length > 500000) {
      throw new Error(
        `The html5 ${field} is ${value.length} characters, over the limit of 500,000. Use a smaller font file or a simpler animation.`
      );
    }
  }

  return {
    asset: { type: 'html5', html, css, js },
    length: Math.round(((lottie.op - lottie.ip) / lottie.fr) * 1000) / 1000,
    width: lottie.w,
    height: lottie.h,
    position: 'bottomLeft',
    offset: { x: 0.04, y: 0.08 }
  };
}

// The full template: card on top, logo in the top-right corner, footage underneath, music on its own track.
function buildTemplate({ lottie, assets, fontDir = __dirname }) {
  const card = cardClip(lottie, fontDir);
  const cardStart = 0.5;
  const total = cardStart + card.length + 0.5;
  const defaults = sampleText(lottie);

  return {
    timeline: {
      tracks: [
        { clips: [{ ...card, start: cardStart }] },
        {
          clips: [
            {
              asset: { type: 'image', src: assets.logo },
              start: 0,
              length: total,
              fit: 'none',
              position: 'topRight',
              offset: { x: -0.03, y: -0.04 }
            }
          ]
        },
        {
          clips: [
            {
              asset: { type: 'video', src: assets.footage, volume: 0 },
              start: 0,
              length: total
            }
          ]
        },
        {
          clips: [
            {
              asset: {
                type: 'audio',
                src: assets.music,
                effect: 'fadeInFadeOut',
                volume: 0.6
              },
              start: 0,
              length: total
            }
          ]
        }
      ]
    },
    output: { format: 'mp4', size: { width: 1920, height: 1080 }, fps: 25 },
    merge: fieldNames(lottie).map(name => ({
      find: name,
      replace: defaults[name] || ''
    }))
  };
}

// Reads a Bodymovin export and checks it can become a template.
function readExport(file) {
  if (!fs.existsSync(file))
    throw new Error(`Can't find ${path.basename(file)}.`);
  let lottie;
  try {
    lottie = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(
      `${path.basename(file)} isn't valid JSON. Export it again from Bodymovin.`
    );
  }
  if (lottie.chars) {
    throw new Error(
      'This export has Glyphs on. Turn Glyphs off in Bodymovin and export again.'
    );
  }
  if (!fieldNames(lottie).length) {
    throw new Error(
      'No text layer is named in capitals (like PRODUCT), so nothing could change between videos. Rename the layers in After Effects and export again.'
    );
  }
  return lottie;
}

module.exports = { buildTemplate, fieldNames, readExport };
