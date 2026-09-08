// Rasterises the source SVG into the PNG sizes the manifest advertises.
// Run with: node scripts/gen-icons.mjs
import sharp from "sharp";
import { readFileSync } from "node:fs";

const svg = readFileSync("public/icons/icon.svg");

await sharp(svg).resize(192, 192).png().toFile("public/icons/icon-192.png");
await sharp(svg).resize(512, 512).png().toFile("public/icons/icon-512.png");

// Maskable icons need the artwork inside the safe zone (80% of the canvas),
// so pad it and fill the bleed with the brand colour.
await sharp(svg)
  .resize(410, 410)
  .extend({
    top: 51, bottom: 51, left: 51, right: 51,
    background: { r: 0x43, g: 0x38, b: 0xca, alpha: 1 },
  })
  .png()
  .toFile("public/icons/maskable-512.png");

console.log("icons written");
