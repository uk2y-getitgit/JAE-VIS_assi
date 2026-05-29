/**
 * create-calendar-icon.js
 * Run: node create-calendar-icon.js
 * Generates assets/icon.png and assets/icon.ico (calendar design)
 * No external dependencies — uses only Node.js built-ins
 */
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── PNG builder ────────────────────────────────────────────────
function makePNG(size, drawFn) {
  const rgba = new Uint8ClampedArray(size * size * 4);

  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    rgba[i] = r; rgba[i+1] = g; rgba[i+2] = b; rgba[i+3] = a;
  };

  const rect = (x1, y1, w, h, r, g, b, a = 255) => {
    for (let y = y1; y < y1+h; y++)
      for (let x = x1; x < x1+w; x++)
        set(x, y, r, g, b, a);
  };

  const circle = (cx, cy, rad, r, g, b, a = 255) => {
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++)
        if (dx*dx + dy*dy <= rad*rad) set(cx+dx, cy+dy, r, g, b, a);
  };

  const roundRect = (x1, y1, w, h, rad, r, g, b, a = 255) => {
    rect(x1+rad, y1, w-rad*2, h, r, g, b, a);
    rect(x1, y1+rad, w, h-rad*2, r, g, b, a);
    circle(x1+rad,   y1+rad,   rad, r, g, b, a);
    circle(x1+w-rad, y1+rad,   rad, r, g, b, a);
    circle(x1+rad,   y1+h-rad, rad, r, g, b, a);
    circle(x1+w-rad, y1+h-rad, rad, r, g, b, a);
  };

  drawFn({ set, rect, circle, roundRect, size });

  // CRC32
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c;
  }
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const t = Buffer.from(type);
    const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const l = Buffer.allocUnsafe(4); l.writeUInt32BE(d.length);
    const cc = Buffer.allocUnsafe(4); cc.writeUInt32BE(crc32(Buffer.concat([t, d])));
    return Buffer.concat([l, t, d, cc]);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = ihdr[11] = ihdr[12] = 0;

  const raw = Buffer.allocUnsafe(size * (1 + size * 4));
  let pos = 0;
  for (let y = 0; y < size; y++) {
    raw[pos++] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y*size+x)*4;
      raw[pos++] = rgba[i]; raw[pos++] = rgba[i+1];
      raw[pos++] = rgba[i+2]; raw[pos++] = rgba[i+3];
    }
  }

  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Calendar icon drawing ──────────────────────────────────────
function drawCalendar({ rect, roundRect, circle, size: S }) {
  const BG     = [255,255,255,0];    // transparent BG
  const BODY   = [255,255,255,255];  // white body
  const HDR    = [37, 99,235,255];   // #2563EB blue header
  const RING   = [30, 64,175,255];   // #1E40AF ring
  const LINE   = [203,213,225,255];  // #CBD5E1 grid lines
  const DAY    = [100,116,139,255];  // #64748B day dots
  const TODAY  = [239, 68, 68,255];  // #EF4444 today red
  const SHADOW = [148,163,184, 60];  // shadow

  const pad  = Math.round(S*0.07);
  const x0   = pad, y0 = Math.round(S*0.12);
  const w    = S - pad*2, h = S - y0 - pad;
  const rad  = Math.round(S*0.08);
  const hdrH = Math.round(h*0.28);

  // Shadow
  roundRect(x0+3, y0+4, w, h, rad, ...SHADOW);
  // Body
  roundRect(x0, y0, w, h, rad, ...BODY);
  // Header
  roundRect(x0, y0, w, hdrH+rad, rad, ...HDR);
  rect(x0, y0+hdrH, w, rad, ...HDR);

  // Header text mock (3 white bars)
  const lx = x0 + Math.round(w*0.18);
  const lw1 = Math.round(w*0.42), lw2 = Math.round(w*0.28);
  const ly1 = y0 + Math.round(hdrH*0.25), ly2 = y0 + Math.round(hdrH*0.55);
  const lh  = Math.max(2, Math.round(S*0.025));
  rect(lx, ly1, lw1, lh, 255,255,255,255);
  rect(lx, ly2, lw2, lh, 255,255,255,180);

  // Ring bolts
  const ry  = y0 - Math.round(S*0.02);
  const rr  = Math.round(S*0.045);
  const rx1 = x0 + Math.round(w*0.28);
  const rx2 = x0 + Math.round(w*0.72);
  circle(rx1, ry, rr,       ...RING);
  circle(rx2, ry, rr,       ...RING);
  circle(rx1, ry, Math.round(rr*0.45), 255,255,255,255);
  circle(rx2, ry, Math.round(rr*0.45), 255,255,255,255);

  // Grid
  const gx = x0 + Math.round(w*0.06);
  const gy = y0 + hdrH + Math.round(h*0.06);
  const gw = w - Math.round(w*0.12);
  const gh = h - hdrH - Math.round(h*0.14);
  const cols = 7, rows = 5;
  const cellW = Math.floor(gw/cols), cellH = Math.floor(gh/rows);
  const dotR  = Math.max(2, Math.round(Math.min(cellW,cellH)*0.22));

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = gx + col*cellW + Math.floor(cellW/2);
      const cy = gy + row*cellH + Math.floor(cellH/2);
      const isToday = (row === 1 && col === 3);
      if (isToday) {
        circle(cx, cy, dotR+Math.round(S*0.025), ...TODAY);
        circle(cx, cy, dotR, 255,255,255,255);
      } else {
        circle(cx, cy, dotR, ...DAY);
      }
    }
  }
}

// ── Generate multiple sizes & pack into ICO ────────────────────
function pngToIco(pngBuffers) {
  const count  = pngBuffers.length;
  const header = Buffer.allocUnsafe(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dirSize    = count * 16;
  const dataOffset = 6 + dirSize;
  const dirs   = [];
  const images = [];
  let offset   = dataOffset;

  for (const { size, buf } of pngBuffers) {
    const dir = Buffer.allocUnsafe(16);
    dir[0] = size >= 256 ? 0 : size;
    dir[1] = size >= 256 ? 0 : size;
    dir[2] = 0; dir[3] = 0;
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(buf.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirs.push(dir);
    images.push(buf);
    offset += buf.length;
  }

  return Buffer.concat([header, ...dirs, ...images]);
}

// ── Main ──────────────────────────────────────────────────────
const sizes = [256, 48, 32, 16];
const pngBuffers = sizes.map(size => ({
  size,
  buf: makePNG(size, drawCalendar),
}));

const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

fs.writeFileSync(path.join(assetsDir, 'icon.png'), pngBuffers[0].buf);
fs.writeFileSync(path.join(assetsDir, 'icon.ico'), pngToIco(pngBuffers));

console.log('✅ Calendar icon created:');
sizes.forEach((s, i) => console.log(`   ${s}x${s}: ${pngBuffers[i].buf.length} bytes`));
console.log('   assets/icon.png (256x256)');
console.log('   assets/icon.ico (multi-size: ' + sizes.join(', ') + ')');
