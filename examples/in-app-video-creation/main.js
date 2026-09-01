/**
 * Three ways to let a user make the same video:
 *
 *   1. Embedded editor: the Studio SDK, user composes freely
 *   2. Form-to-video:   a template plus merge fields, no editor
 *   3. Headless:        no UI at all, the app assembles the edit
 *
 * All three end at the same render proxy and the same gallery.
 *
 * The Shotstack API key never appears here. Renders go through /api/render on
 * our own server, which holds the key. A key in browser code exposes your
 * entire render budget to anyone who opens devtools.
 */

import {
  Edit,
  Canvas,
  Controls,
  Timeline,
  UIController
} from '@shotstack/shotstack-studio';

const DRAFT_KEY = 'demo:draft';

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const tabs = document.querySelectorAll('.tab');
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      document.getElementById(`panel-${t.dataset.panel}`).hidden = !selected;
    });
  });
});

// ---------------------------------------------------------------------------
// Option 1: embedded editor
// ---------------------------------------------------------------------------

const editorStatus = document.getElementById('editor-status');
let edit;

async function mountEditor() {
  // promo.json holds real asset URLs, not merge-field placeholders. The editor
  // renders what it loads, so a "{{ FOOTAGE }}" string here would be treated as
  // a URL and fail. Placeholders belong in the template used by the form path.
  const saved = localStorage.getItem(DRAFT_KEY);
  const template = saved
    ? JSON.parse(saved)
    : await (await fetch('/promo.json')).json();

  edit = new Edit(template);
  const canvas = new Canvas(edit);

  // mergeFields: true adds a Merge Fields panel (off by default). The SDK also
  // resolves a merge array client-side, so an edit carrying one previews the
  // replaced text rather than the raw placeholder.
  // selectionHandles: false would make this look-but-don't-touch.
  const ui = UIController.create(edit, canvas, { mergeFields: true });

  await canvas.load();
  await edit.load();

  const timeline = new Timeline(
    edit,
    document.querySelector('[data-shotstack-timeline]')
  );
  await timeline.load();

  const controls = new Controls(edit);
  await controls.load();

  // The SDK persists nothing on its own. A saved getEdit() snapshot is a draft.
  // In a real app this is a debounced POST keyed by user; localStorage only
  // survives on one device.
  edit.events.on('edit:changed', () => {
    editorStatus.textContent = `${edit.totalDuration.toFixed(1)}s · draft saved`;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(edit.getEdit()));
  });

  return { edit, canvas, ui, timeline, controls };
}

try {
  await mountEditor();
} catch (err) {
  // The SDK renders through WebGL and throws WebGLUnsupportedError where it
  // isn't available. Locked-down and virtualized browsers land here.
  editorStatus.textContent =
    "The editor can't run in this browser. Use the Quick form tab instead.";
  console.error(err);
}

document
  .getElementById('render-from-editor')
  .addEventListener('click', async e => {
    if (!edit) return;
    await run(e.target, editorStatus, () =>
      // getEdit() returns the same JSON shape the render API accepts.
      submitRender({ edit: edit.getEdit() })
    );
  });

// Discarding a draft is the other half of saving one. Without this the editor
// loads whatever you last touched, forever, with no way back to the template.
document.getElementById('reset-draft').addEventListener('click', () => {
  localStorage.removeItem(DRAFT_KEY);
  location.reload();
});

// ---------------------------------------------------------------------------
// Option 3: form to video
// ---------------------------------------------------------------------------

const formStatus = document.getElementById('form-status');

document.getElementById('quick-form').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));

  await run(e.target.querySelector('button'), formStatus, () =>
    submitRender({
      merge: [
        { find: 'HEADLINE', replace: data.headline },
        { find: 'FONT', replace: data.font },
        { find: 'FOOTAGE', replace: data.footage }
      ]
    })
  );
});

// ---------------------------------------------------------------------------
// Option 2: headless
// ---------------------------------------------------------------------------

const headlessStatus = document.getElementById('headless-status');

document
  .getElementById('render-headless')
  .addEventListener('click', async e => {
    // No editor, no form. The app already knows what the video should say.
    const listing = {
      headline: '12 new listings this week.',
      footageUrl:
        'https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/footage/city-timelapse.mp4'
    };

    await run(e.target, headlessStatus, () =>
      submitRender({
        edit: {
          timeline: {
            background: '#000000',
            tracks: [
              {
                // tracks[0] is the TOP layer: text first, background last.
                clips: [
                  {
                    asset: {
                      type: 'rich-text',
                      text: listing.headline,
                      font: {
                        family: 'Montserrat',
                        size: 48,
                        weight: 700,
                        color: '#ffffff'
                      },
                      stroke: { width: 3, color: '#000000' },
                      align: { horizontal: 'center', vertical: 'middle' }
                    },
                    start: 0.5,
                    length: 4.5,
                    width: 1000,
                    height: 260
                  }
                ]
              },
              {
                clips: [
                  {
                    asset: { type: 'video', src: listing.footageUrl },
                    start: 0,
                    length: 5,
                    // crop fills the frame and preserves aspect ratio.
                    // cover would STRETCH the footage, not the CSS meaning.
                    fit: 'crop'
                  }
                ]
              }
            ]
          },
          output: { format: 'mp4', size: { width: 1280, height: 720 } }
        }
      })
    );
  });

// ---------------------------------------------------------------------------
// Shared: submit, poll, display
// ---------------------------------------------------------------------------

async function run(button, statusEl, submit) {
  button.disabled = true;
  statusEl.textContent = 'Submitting…';

  try {
    const renderId = await submit();
    await pollAndShow(renderId, statusEl);
  } catch (err) {
    statusEl.textContent = `Failed: ${err.message}`;
  } finally {
    button.disabled = false;
  }
}

async function submitRender(payload) {
  const res = await fetch('/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body.id;
}

/**
 * Polling is fine for one user watching a spinner. Anything server-side or at
 * volume should use the callback webhook; see server.js.
 */
async function pollAndShow(renderId, statusEl) {
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(r => setTimeout(r, 3000));

    const res = await fetch(`/api/render/${renderId}`);
    const { status, url, error } = await res.json();

    statusEl.textContent = `${status}…`;

    if (status === 'done') {
      statusEl.textContent = 'Done.';
      addToGallery(url);
      return url;
    }

    if (status === 'failed') throw new Error(error ?? 'render failed');
  }

  throw new Error('timed out');
}

function addToGallery(url) {
  const video = document.createElement('video');
  video.src = url;
  video.controls = true;
  document.getElementById('gallery').prepend(video);
}
