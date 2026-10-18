// The home-screen icons, drawn in code.
//
// Why not just commit four PNGs: because then the icon is a binary nobody can
// review, resizing it needs a tool nobody has installed, and the four files
// drift apart the first time one is edited. Here the design is ~30 lines of
// geometry and every size is rendered from it, so they cannot disagree.
//
// Why no image library: the project has one devDependency and a 144-line build,
// and that is most of why it is still pleasant to work on. A PNG is a signature,
// three chunks and a CRC, and node's zlib does the only hard part. The whole
// encoder below is shorter than the install instructions for an image library.

import zlib from 'node:zlib';

// --- PNG container.

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** One PNG chunk: length, type, data, CRC of type+data. */
function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

/** RGBA pixel buffer (width*height*4) to a PNG file. */
function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // truecolour with alpha
  // bytes 10-12 stay zero: deflate, the only defined filter method, no interlace.

  // Each scanline is prefixed with its filter byte. Filter 0 (none) costs a few
  // hundred bytes on an icon this flat and saves implementing the other four.
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const from = y * width * 4;
    rgba.copy(raw, y * (width * 4 + 1) + 1, from, from + width * 4);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- A rasteriser with exactly the primitives this one icon needs.
//
// Everything is in a unit square, so one description renders at every size.
// Coverage is sampled on a 4x4 grid per pixel: flat colour over a curve needs
// antialiasing or it looks broken at 192px, and 16 samples is enough for shapes
// with no thin diagonals.

const SAMPLES = 4;

const disc = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** A rectangle with rounded ends, which is also how every bar here is drawn. */
const roundRect = (x0, y0, x1, y1, r) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const qx = Math.min(Math.max(x, x0 + r), x1 - r);
  const qy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - qx) ** 2 + (y - qy) ** 2 <= r * r;
};

const union = (...shapes) => (x, y) => shapes.some((s) => s(x, y));
const below = (cy, shape) => (x, y) => y >= cy && shape(x, y);

/** Scale a shape about the centre of the square, for the maskable safe zone. */
const scaled = (s, shape) => (x, y) => shape((x - 0.5) / s + 0.5, (y - 0.5) / s + 0.5);

const hex = (h) => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
];

/** Render layers of [shape, colour] into an RGBA buffer. */
function render(size, layers) {
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SAMPLES);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px * SAMPLES + sx + 0.5) * step;
          const y = (py * SAMPLES + sy + 0.5) * step;
          // Later layers paint over earlier ones, so the last hit wins.
          for (let i = layers.length - 1; i >= 0; i--) {
            if (layers[i][0](x, y)) {
              const [cr, cg, cb] = layers[i][1];
              r += cr; g += cg; b += cb; a += 255;
              break;
            }
          }
        }
      }
      const n = SAMPLES * SAMPLES;
      const o = (py * size + px) * 4;
      // Premultiplied averages divided back out, so a half-covered edge pixel
      // keeps the colour it is covered by instead of fading towards black.
      rgba[o] = a ? Math.round(r / (a / 255)) : 0;
      rgba[o + 1] = a ? Math.round(g / (a / 255)) : 0;
      rgba[o + 2] = a ? Math.round(b / (a / 255)) : 0;
      rgba[o + 3] = Math.round(a / n);
    }
  }
  return rgba;
}

// --- The mark: a bowl with steam rising off it.
//
// Chosen because it survives being 40 px wide on a home screen next to WhatsApp.
// Anything with a fork, a plate rim or lettering turns to mush at that size; a
// filled bowl and three bars do not. Axis-aligned on purpose -- no rotation means
// no thin diagonals, which is where a 16-sample rasteriser would show its seams.

const INK = hex('#06281a'); // --accent-ink
const PAINT = hex('#6ee7a8'); // --accent

const BOWL = union(
  below(0.60, disc(0.5, 0.60, 0.265)), // the bowl itself, a lower half-disc
  roundRect(0.205, 0.558, 0.795, 0.612, 0.027), // the rim, overhanging both sides
);

const STEAM = union(
  roundRect(0.368, 0.300, 0.422, 0.470, 0.027),
  roundRect(0.473, 0.255, 0.527, 0.470, 0.027), // the middle one rises higher
  roundRect(0.578, 0.300, 0.632, 0.470, 0.027),
);

const GLYPH = union(BOWL, STEAM);

/**
 * One icon.
 *
 * `maskable` fills the whole square and shrinks the mark into the middle 60%,
 * because Android will crop the icon to whatever shape the launcher uses and
 * only guarantees the inner 80% circle survives. The ordinary icons keep their
 * own rounded square, since nothing is going to round it for them.
 */
export function icon(size, { maskable = false, square = false } = {}) {
  const plate = maskable || square
    ? () => true
    : roundRect(0, 0, 1, 1, 0.22);
  const mark = maskable ? scaled(0.6, GLYPH) : GLYPH;
  return encodePNG(size, size, render(size, [[plate, PAINT], [mark, INK]]));
}

/**
 * Every icon file the app ships, and what the manifest should say about each.
 * `manifest: false` is the Safari one, which is linked from the HTML instead
 * because Safari does not read the manifest at all.
 */
export const ICONS = [
  { file: 'icon-192.png', size: 192, purpose: 'any' },
  { file: 'icon-512.png', size: 512, purpose: 'any' },
  { file: 'maskable-512.png', size: 512, purpose: 'maskable', opts: { maskable: true } },
  { file: 'apple-touch-icon.png', size: 180, manifest: false, opts: { square: true } },
];
