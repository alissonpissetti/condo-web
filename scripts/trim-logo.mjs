/**
 * Gera public/logo-top.png a partir de public/logo-big.png:
 * compõe transparência em branco e remove margens claras (trim).
 *
 * Executar após alterar a logo: `npm run assets:trim-logo`
 */
import sharp from 'sharp';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const input = join(root, 'public', 'logo-big.png');
const output = join(root, 'public', 'logo-top.png');

const meta = await sharp(input).metadata();
const info = await sharp(input)
  .flatten({ background: '#ffffff' })
  .trim({ background: '#ffffff', threshold: 15 })
  .png()
  .toFile(output);

console.log(
  JSON.stringify(
    {
      before: { width: meta.width, height: meta.height },
      after: { width: info.width, height: info.height },
      wrote: 'public/logo-top.png',
    },
    null,
    2,
  ),
);
