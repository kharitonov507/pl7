import { createCanvas, loadImage } from '../reference-xibo/node_modules/@napi-rs/canvas/index.js';
import {readFileSync, writeFileSync} from 'node:fs';
const icon = await loadImage(readFileSync('reference-xibo/brand/logo-icon.svg'));
for (const size of [32,192,512]) {
  const canvas=createCanvas(size,size); canvas.getContext('2d').drawImage(icon,0,0,size,size);
  const png=canvas.toBuffer('image/png');
  if (size!==32) writeFileSync(`reference-xibo/brand/${size}x${size}.png`,png);
  else { const header=Buffer.alloc(22); header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=32;header[7]=32;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);writeFileSync('reference-xibo/brand/favicon.ico',Buffer.concat([header,png])); }
}
