import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const publicDirectory = resolve('public');
const source = resolve(publicDirectory, 'favicon.svg');
const manifestPath = resolve(publicDirectory, 'site.webmanifest');
const defaultBrandColor = '#ffbe00';

let localSettings = {};

try {
  ({ default: localSettings = {} } = await import('../LocalSettings.js'));
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

const brandColor = localSettings?.branding?.topbarBackgroundColor ?? defaultBrandColor;

if (typeof brandColor !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(brandColor)) {
  throw new Error('LocalSettings.js: „branding.topbarBackgroundColor“ musí být platná hexadecimální barva.');
}

const originalSvg = await readFile(source, 'utf8');

if (!originalSvg.includes('fill="#ffbe00"')) {
  throw new Error('V public/favicon.svg nebyla nalezena výchozí barva loga.');
}

const faviconSvg = originalSvg.replace('fill="#ffbe00"', `fill="${brandColor}"`);
const iconSource = Buffer.from(faviconSvg);

const icons = [
  { filename: 'favicon-16x16.png', size: 16 },
  { filename: 'favicon-32x32.png', size: 32 },
  { filename: 'apple-touch-icon.png', size: 180, background: brandColor },
  { filename: 'icon-192x192.png', size: 192 },
  { filename: 'icon-512x512.png', size: 512 }
];

function icoFromPng(png, size) {
  const header = Buffer.alloc(22);

  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // ICO image type
  header.writeUInt16LE(1, 4); // Number of images
  header.writeUInt8(size === 256 ? 0 : size, 6);
  header.writeUInt8(size === 256 ? 0 : size, 7);
  header.writeUInt8(0, 8); // Palette colors
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10); // Color planes
  header.writeUInt16LE(32, 12); // Bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);

  return Buffer.concat([header, png]);
}

await Promise.all(
  icons.map(({ filename, size, background }) => {
    let image = sharp(iconSource).resize(size, size);

    if (background) {
      image = image.flatten({ background });
    }

    return image.png().toFile(resolve(publicDirectory, filename));
  })
);

const faviconPng = await sharp(iconSource).resize(32, 32).png().toBuffer();
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

manifest.background_color = brandColor;
manifest.theme_color = brandColor;

await Promise.all([
  writeFile(resolve(publicDirectory, 'favicon-generated.svg'), faviconSvg),
  writeFile(resolve(publicDirectory, 'favicon.ico'), icoFromPng(faviconPng, 32)),
  writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
]);

console.log(`Generated favicon assets using branding.topbarBackgroundColor (${brandColor}).`);
