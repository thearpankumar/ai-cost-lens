import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";

const [, , svgPathArg, outPathArg] = process.argv;
const svg = readFileSync(svgPathArg);
const sizes = [16, 32, 48];

const pngBuffers = [];
for (const size of sizes) {
  const buf = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
  pngBuffers.push({ size, buf });
}

const numImages = pngBuffers.length;
const headerSize = 6;
const dirEntrySize = 16;
let offset = headerSize + dirEntrySize * numImages;

const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(numImages, 4);

const dirEntries = [];
const imageBuffers = [];
for (const { size, buf } of pngBuffers) {
  const entry = Buffer.alloc(dirEntrySize);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(buf.length, 8);
  entry.writeUInt32LE(offset, 12);
  dirEntries.push(entry);
  imageBuffers.push(buf);
  offset += buf.length;
}

const ico = Buffer.concat([header, ...dirEntries, ...imageBuffers]);
writeFileSync(outPathArg, ico);
console.log("Wrote", outPathArg, ico.length, "bytes");
