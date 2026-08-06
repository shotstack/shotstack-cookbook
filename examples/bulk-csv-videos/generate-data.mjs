import { writeFile } from 'node:fs/promises';

const imageUrls = [
  'https://shotstack-assets.s3.amazonaws.com/images/slideshow1.jpeg',
  'https://shotstack-assets.s3.amazonaws.com/images/slideshow2.jpeg',
  'https://shotstack-assets.s3.amazonaws.com/images/slideshow3.jpeg',
  'https://shotstack-assets.s3.amazonaws.com/images/slideshow4.jpeg',
  'https://shotstack-assets.s3.amazonaws.com/images/slideshow5.jpeg',
  'https://shotstack-assets.s3.amazonaws.com/images/slideshow6.jpeg',
  'https://shotstack-assets.s3.amazonaws.com/images/slideshow7.jpeg',
];

const headlines = [
  'New this week',
  'Made for everyday use',
  'A customer favorite',
  'Limited release',
  'Built to last',
];

const brandColors = ['#0f766e', '#1d4ed8', '#7c3aed', '#be123c', '#b45309'];

const preflightRows = [
  {
    row_id: 'product-001',
    product_name: 'Limited Edition Travel Backpack - XL Pro',
    headline: 'Longest approved headline checks wrapping before launch',
    price: 'From $199',
    image_url: imageUrls[0],
    brand_color: brandColors[0],
  },
  {
    row_id: 'product-002',
    product_name: 'Mug',
    headline: 'New',
    price: '$9.00',
    image_url: imageUrls[1],
    brand_color: brandColors[1],
  },
  {
    row_id: 'product-003',
    product_name: 'Café "Voyager", Édition',
    headline: 'Built for Nairobi, Montréal, and everywhere between',
    price: 'From $49',
    image_url: imageUrls[2],
    brand_color: brandColors[2],
  },
];

const csvEscape = (value) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const rows = Array.from({ length: 100 }, (_, index) => {
  const number = index + 1;

  if (index < preflightRows.length) {
    return preflightRows[index];
  }

  return {
    row_id: `product-${String(number).padStart(3, '0')}`,
    product_name: `Demo Product ${String(number).padStart(3, '0')}`,
    headline: headlines[index % headlines.length],
    price: `$${29 + ((number * 7) % 170)}.00`,
    image_url: imageUrls[index % imageUrls.length],
    brand_color: brandColors[index % brandColors.length],
  };
});

const columns = [
  'row_id',
  'product_name',
  'headline',
  'price',
  'image_url',
  'brand_color',
];

const csv = [
  columns.join(','),
  ...rows.map((row) =>
    columns.map((column) => csvEscape(row[column])).join(','),
  ),
].join('\n');

await writeFile('products.csv', `${csv}\n`, 'utf8');
console.log(`Created products.csv with ${rows.length} rows.`);
