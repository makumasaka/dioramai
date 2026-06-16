// One-off utility: decode a Radiance RGBE (.hdr) file, box-downsample it to a
// target width (~1k), and re-encode as new-format RLE RGBE. Used to produce the
// bundled default HDRI. Run with: node scripts/downsizeHdr.mjs <in.hdr> <out.hdr> [targetWidth]
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath, targetWidthArg] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node downsizeHdr.mjs <in.hdr> <out.hdr> [targetWidth]');
  process.exit(1);
}
const targetWidth = Number(targetWidthArg ?? 1024);

const buf = readFileSync(inPath);

// ── Parse ASCII header ────────────────────────────────────────────────────────
let pos = 0;
const readLine = () => {
  let line = '';
  while (pos < buf.length) {
    const ch = buf[pos++];
    if (ch === 0x0a) break;
    line += String.fromCharCode(ch);
  }
  return line;
};

const magic = readLine();
if (!magic.startsWith('#?')) throw new Error(`not a radiance file: ${magic}`);
let format = '';
for (;;) {
  const line = readLine();
  if (line === '') break; // blank line terminates header
  const m = /^FORMAT=(.*)$/.exec(line);
  if (m) format = m[1].trim();
}
if (format && !/rgbe/i.test(format)) {
  throw new Error(`unsupported FORMAT=${format} (only 32-bit_rle_rgbe)`);
}

const resLine = readLine();
const res = /^([+-][XY])\s+(\d+)\s+([+-][XY])\s+(\d+)\s*$/.exec(resLine);
if (!res) throw new Error(`unsupported resolution line: ${resLine}`);
// Expect standard "-Y height +X width".
const height = Number(res[2]);
const width = Number(res[4]);
if (res[1] !== '-Y' || res[3] !== '+X') {
  throw new Error(`unsupported orientation: ${resLine}`);
}

// ── Decode helpers ────────────────────────────────────────────────────────────
const rgbeToLinear = (r, g, b, e) => {
  if (e === 0) return [0, 0, 0];
  const f = Math.pow(2, e - 128) / 256;
  return [r * f, g * f, b * f];
};

const decodeScanline = (target) => {
  // target: Uint8Array length width*4 (RGBE)
  if (width < 8 || width > 0x7fff) {
    throw new Error('flat scanline decode not implemented for this width');
  }
  const b0 = buf[pos++];
  const b1 = buf[pos++];
  const b2 = buf[pos++];
  const b3 = buf[pos++];
  if (b0 !== 2 || b1 !== 2 || ((b2 << 8) | b3) !== width) {
    throw new Error('expected new-format RLE scanline (flat not supported)');
  }
  for (let c = 0; c < 4; c++) {
    let x = 0;
    while (x < width) {
      let count = buf[pos++];
      if (count > 128) {
        count -= 128;
        const val = buf[pos++];
        while (count-- > 0) target[x++ * 4 + c] = val;
      } else {
        while (count-- > 0) target[x++ * 4 + c] = buf[pos++];
      }
    }
  }
};

// ── Downsample (box filter, streaming over input rows) ───────────────────────
const factor = Math.max(1, Math.round(width / targetWidth));
const outW = Math.floor(width / factor);
const outH = Math.floor(height / factor);

const scan = new Uint8Array(width * 4);
const outBytes = Buffer.alloc(outW * outH * 4);

let outY = -1;
let sum = new Float64Array(outW * 3);
let cnt = new Uint32Array(outW);

const encodeRow = (rowIndex) => {
  const base = rowIndex * outW * 4;
  for (let ox = 0; ox < outW; ox++) {
    const n = cnt[ox] || 1;
    const r = sum[ox * 3] / n;
    const g = sum[ox * 3 + 1] / n;
    const b = sum[ox * 3 + 2] / n;
    const v = Math.max(r, g, b);
    if (v < 1e-32) {
      outBytes[base + ox * 4] = 0;
      outBytes[base + ox * 4 + 1] = 0;
      outBytes[base + ox * 4 + 2] = 0;
      outBytes[base + ox * 4 + 3] = 0;
      continue;
    }
    const e = Math.ceil(Math.log2(v));
    const scale = Math.pow(2, -e) * 256;
    outBytes[base + ox * 4] = Math.max(0, Math.min(255, Math.floor(r * scale)));
    outBytes[base + ox * 4 + 1] = Math.max(0, Math.min(255, Math.floor(g * scale)));
    outBytes[base + ox * 4 + 2] = Math.max(0, Math.min(255, Math.floor(b * scale)));
    outBytes[base + ox * 4 + 3] = e + 128;
  }
};

for (let y = 0; y < height; y++) {
  decodeScanline(scan);
  const targetRow = Math.floor(y / factor);
  if (targetRow >= outH) break;
  if (targetRow !== outY) {
    if (outY >= 0) encodeRow(outY);
    outY = targetRow;
    sum = new Float64Array(outW * 3);
    cnt = new Uint32Array(outW);
  }
  for (let x = 0; x < width; x++) {
    const ox = Math.floor(x / factor);
    if (ox >= outW) continue;
    const [lr, lg, lb] = rgbeToLinear(
      scan[x * 4],
      scan[x * 4 + 1],
      scan[x * 4 + 2],
      scan[x * 4 + 3],
    );
    sum[ox * 3] += lr;
    sum[ox * 3 + 1] += lg;
    sum[ox * 3 + 2] += lb;
    cnt[ox]++;
  }
}
if (outY >= 0 && outY < outH) encodeRow(outY);

// ── Encode output as new-format RLE (literal runs only) ──────────────────────
const headerStr = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${outH} +X ${outW}\n`;
const header = Buffer.from(headerStr, 'ascii');

const bodyChunks = [];
for (let y = 0; y < outH; y++) {
  const base = y * outW * 4;
  const sl = Buffer.alloc(4 + outW * 4 + outW); // generous upper bound
  let p = 0;
  sl[p++] = 2;
  sl[p++] = 2;
  sl[p++] = (outW >> 8) & 0xff;
  sl[p++] = outW & 0xff;
  for (let c = 0; c < 4; c++) {
    let x = 0;
    while (x < outW) {
      const run = Math.min(128, outW - x);
      sl[p++] = run; // <=128 ⇒ literal dump
      for (let i = 0; i < run; i++) sl[p++] = outBytes[base + (x + i) * 4 + c];
      x += run;
    }
  }
  bodyChunks.push(sl.subarray(0, p));
}

writeFileSync(outPath, Buffer.concat([header, ...bodyChunks]));
console.log(`wrote ${outPath}: ${outW}x${outH} (factor ${factor})`);
