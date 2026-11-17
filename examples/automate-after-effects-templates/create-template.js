// Saves the card, footage, logo and music as a Shotstack template.
// Usage: node create-template.js [export.json]   (defaults to product-card.json)
const fs = require('fs');
const path = require('path');
const { EDIT_API, api, readStep } = require('./shotstack');
const { buildTemplate, fieldNames, readExport } = require('./build-template');

async function main() {
  const lottie = readExport(
    path.join(__dirname, process.argv[2] || 'product-card.json')
  );
  const assets = JSON.parse(
    readStep(__dirname, 'assets.json', 'setup-assets.js')
  );

  const template = buildTemplate({
    lottie,
    fontFile: path.join(__dirname, 'montserrat-bold.woff2'),
    assets
  });
  fs.writeFileSync(
    path.join(__dirname, 'template.json'),
    JSON.stringify(template, null, 2)
  );

  const { response } = await api('POST', `${EDIT_API}/templates`, {
    name: 'Product card',
    template
  });
  if (!response?.id)
    throw new Error('The API saved the template but returned no id.');
  fs.writeFileSync(path.join(__dirname, 'template-id.txt'), response.id);
  console.log(`Fields: ${fieldNames(lottie).join(', ')}`);
  console.log(
    `Template saved: ${response.id} (also in template-id.txt and template.json)`
  );
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
