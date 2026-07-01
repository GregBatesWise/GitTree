/**
 * Generates build/icon.ico (and build/icon.png) from build/icon.svg.
 * Run once after cloning, or whenever you change the SVG:
 *   npm run build:icon
 */
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const buildDir = resolve(root, 'build');

mkdirSync(buildDir, { recursive: true });

const svgBuffer = readFileSync(resolve(buildDir, 'icon.svg'));

// Render the SVG at each ICO size
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = await Promise.all(
  sizes.map((size) =>
    sharp(svgBuffer, { density: 300 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
  )
);

// Save the largest size as a standalone PNG (useful for Linux / other platforms)
writeFileSync(resolve(buildDir, 'icon.png'), pngBuffers[pngBuffers.length - 1]);

// Build the multi-size ICO
const icoBuffer = await pngToIco(pngBuffers);
writeFileSync(resolve(buildDir, 'icon.ico'), icoBuffer);

console.log('Icon written to build/icon.ico and build/icon.png');
