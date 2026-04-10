/**
 * Gera favicons e apple-touch-icon a partir de public/logo-dark.png.
 * Executar: node scripts/generate-favicon.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'public', 'logo-dark.png');
const publicDir = join(root, 'public');

async function pngSquare(size, background) {
  return sharp(src)
    .resize(size, size, {
      fit: 'contain',
      background,
    })
    .png()
    .toBuffer();
}

const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
const white = { r: 255, g: 255, b: 255, alpha: 1 };

const png16 = await pngSquare(16, transparent);
const png32 = await pngSquare(32, transparent);
const png48 = await pngSquare(48, transparent);

writeFileSync(join(publicDir, 'favicon-16x16.png'), png16);
writeFileSync(join(publicDir, 'favicon-32x32.png'), png32);

const apple = await sharp(src)
  .resize(180, 180, { fit: 'contain', background: white })
  .png()
  .toBuffer();
writeFileSync(join(publicDir, 'apple-touch-icon.png'), apple);

const icoBuffer = await pngToIco([png16, png32, png48]);
writeFileSync(join(publicDir, 'favicon.ico'), icoBuffer);

console.log('Favicons gerados em public/: favicon.ico, favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png');
