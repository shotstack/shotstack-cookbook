// Updates the saved template after the designer re-exports the card from After Effects.
// The new export must keep the same field layer names, so the render script and data still match.
// Usage: node update-template.js [export.json]   (defaults to product-card-v2.json)
const fs = require('fs');
const path = require('path');
const { EDIT_API, api, readStep } = require('./shotstack');
const { buildTemplate, fieldNames, readExport } = require('./build-template');

async function main() {
  const exportFile = path.join(
    __dirname,
    process.argv[2] || 'product-card-v2.json'
  );
  const lottie = readExport(exportFile);
  const assets = JSON.parse(readStep('assets.json', 'setup-assets.js'));
  const id = readStep('template-id.txt', 'create-template.js').trim();

  // Check the new export still has every field the current template uses.
  const { response: current } = await api('GET', `${EDIT_API}/templates/${id}`);
  const oldFields = (current?.template?.merge || []).map(m => m.find);
  const missing = oldFields.filter(name => !fieldNames(lottie).includes(name));
  if (missing.length) {
    throw new Error(
      `The new export is missing ${missing.join(', ')}. Ask the designer to keep those layer names.`
    );
  }

  const template = buildTemplate({ lottie, assets });
  await api('PUT', `${EDIT_API}/templates/${id}`, {
    name: 'Product card',
    template
  });
  // Written only after the API has the new design, because render-videos.js resumes from it.
  fs.writeFileSync(
    path.join(__dirname, 'template.json'),
    JSON.stringify(template, null, 2)
  );
  console.log(`Template ${id} updated from ${path.basename(exportFile)}.`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
