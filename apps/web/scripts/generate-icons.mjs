// Placeholder app icons -- solid background + a simple "T" glyph, generated
// as raw PNGs with zlib so no image library dependency is needed. Swap for
// real designed icons before shipping; this just satisfies the PWA
// manifest/Capacitor asset requirements so the app is installable now.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(fileURLToPath(new URL("..", import.meta.url)), "static", "icons");
mkdirSync(outDir, { recursive: true });

const BG = [232, 99, 90]; // --color-primary (coral) -- icons sit on coral, not page cream
const FG = [255, 255, 255];

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Simple blocky "T" glyph as a set of filled rectangles, in a 10x10 grid,
// scaled to the icon size at render time.
const T_CELLS = new Set();
for (let x = 1; x <= 8; x++) T_CELLS.add(`${x},1`);
for (let x = 1; x <= 8; x++) T_CELLS.add(`${x},2`);
for (let y = 2; y <= 8; y++) T_CELLS.add(`4,${y}`);
for (let y = 2; y <= 8; y++) T_CELLS.add(`5,${y}`);

function isForeground(x, y, size, maskable) {
  const pad = maskable ? size * 0.2 : size * 0.15; // maskable needs a safe-zone margin
  const inner = size - pad * 2;
  if (x < pad || y < pad || x >= size - pad || y >= size - pad) return false;
  const gx = Math.floor(((x - pad) / inner) * 10);
  const gy = Math.floor(((y - pad) / inner) * 10);
  return T_CELLS.has(`${gx},${gy}`);
}

function generatePng(size, maskable = false) {
  const rowBytes = size * 3 + 1;
  const raw = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = isForeground(x, y, size, maskable) ? FG : BG;
      const off = y * rowBytes + 1 + x * 3;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(join(outDir, "icon-192.png"), generatePng(192));
writeFileSync(join(outDir, "icon-512.png"), generatePng(512));
writeFileSync(join(outDir, "icon-maskable-512.png"), generatePng(512, true));
console.log("wrote placeholder icons to", outDir);
