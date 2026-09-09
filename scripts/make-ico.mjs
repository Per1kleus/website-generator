#!/usr/bin/env node
/**
 * Builds a Windows .ico from the app's SVG mark.
 *
 * sharp cannot write ICO, and pulling in an image-conversion dependency for
 * one build artefact is not worth it. Since Vista, an ICO entry may be a whole
 * PNG, so the container is a header plus one directory entry per size.
 */
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const SIZES = [16, 32, 48, 64, 128, 256];
const svg = readFileSync("public/icons/icon.svg");

const images = await Promise.all(
  SIZES.map((size) => sharp(svg).resize(size, size).png({ compressionLevel: 9 }).toBuffer()),
);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);

let offset = 6 + images.length * 16;
const entries = [];
for (const [i, png] of images.entries()) {
  const size = SIZES[i];
  const entry = Buffer.alloc(16);
  // 256 is stored as 0 — the field is a single byte.
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2); // palette size
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  entries.push(entry);
}

writeFileSync(
  "desktop/tauri/src-tauri/icons/icon.ico",
  Buffer.concat([header, ...entries, ...images]),
);
console.log(`icon.ico written (${SIZES.join(", ")})`);
