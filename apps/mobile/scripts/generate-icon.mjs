// Jellyfuse app icon — 1024x1024 fully opaque PNG.
//
// Apple's App Store icon must be a 1024x1024 square with no alpha channel:
// iOS applies its own rounded-corner mask at render time. We therefore paint
// the plate gradient, the spectrum cells, the glow, and the play triangle
// across the entire canvas without clipping to a rounded rect.
//
// Run: bun run assets:icon-generate
import { createCanvas } from "@napi-rs/canvas";
import { PNG } from "pngjs";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SIZE = 1024;
const PLATE_T = "#23272e";
const PLATE_M = "#1b1e24";
const PLATE_B = "#0e1014";
const PROFILE = [
  "#e06c75",
  "#d19a66",
  "#e5c07b",
  "#98c379",
  "#56b6c2",
  "#61afef",
  "#c678dd",
  "#be5046",
];
const GLOW = "#61afef";

const hexToRgb = (h) => {
  const v = h.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};
const lerp = (a, b, t) => {
  const A = hexToRgb(a),
    B = hexToRgb(b);
  return [
    Math.round(A[0] + (B[0] - A[0]) * t),
    Math.round(A[1] + (B[1] - A[1]) * t),
    Math.round(A[2] + (B[2] - A[2]) * t),
  ];
};
const sample = (stops, t) => {
  const n = stops.length - 1,
    x = t * n;
  const i = Math.min(Math.floor(x), n - 1);
  return lerp(stops[i], stops[i + 1], x - i);
};

function fillPlate(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, SIZE);
  g.addColorStop(0, PLATE_T);
  g.addColorStop(0.5, PLATE_M);
  g.addColorStop(1, PLATE_B);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

// Tall lens that bleeds past the top/bottom edges so cells reach edge to
// edge without pinching into points.
function pathTallLens(ctx, x, w) {
  const yT = -SIZE * 0.1,
    yB = SIZE * 1.1;
  ctx.beginPath();
  ctx.moveTo(x, yT);
  ctx.bezierCurveTo(x + w, yT + SIZE * 0.2, x + w, yB - SIZE * 0.2, x, yB);
  ctx.bezierCurveTo(x - w, yB - SIZE * 0.2, x - w, yT + SIZE * 0.2, x, yT);
  ctx.closePath();
}

// Equilateral play triangle, point right, with rounded vertices.
function pathPlay(ctx, cx, cy, R) {
  const a = [cx + R, cy];
  const b = [cx - R * Math.cos(Math.PI / 3), cy - R * Math.sin(Math.PI / 3)];
  const cc = [cx - R * Math.cos(Math.PI / 3), cy + R * Math.sin(Math.PI / 3)];
  const r = R * 0.14;
  ctx.beginPath();
  ctx.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  ctx.arcTo(a[0], a[1], (a[0] + cc[0]) / 2, (a[1] + cc[1]) / 2, r);
  ctx.arcTo(cc[0], cc[1], (b[0] + cc[0]) / 2, (b[1] + cc[1]) / 2, r);
  ctx.arcTo(b[0], b[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, r);
  ctx.closePath();
}

function drawPattern(ctx, intensity = 0.55) {
  const padding = SIZE * 0.02;
  const span = SIZE - padding * 2;
  const cells = 13;
  for (let i = 0; i < cells; i++) {
    const t = i / (cells - 1);
    const x = padding + span * t;
    const bell = 1 - (2 * t - 1) ** 2;
    const w = SIZE * (0.07 + 0.2 * bell);
    const [r, g, b] = sample(PROFILE, t);
    const alpha = (0.1 + 0.1 * bell) * intensity;
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    pathTallLens(ctx, x, w);
    ctx.fill();
  }
}

function drawGlow(ctx, cx, cy, R) {
  const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.9);
  halo.addColorStop(0, GLOW + "55");
  halo.addColorStop(0.5, GLOW + "20");
  halo.addColorStop(1, GLOW + "00");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.restore();

  const off = createCanvas(SIZE, SIZE);
  const oc = off.getContext("2d");
  oc.fillStyle = GLOW;
  pathPlay(oc, cx, cy, R * 1.4);
  oc.fill();
  const blurred = createCanvas(SIZE, SIZE);
  const bc = blurred.getContext("2d");
  bc.filter = "blur(60px)";
  bc.drawImage(off, 0, 0);

  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(blurred, 0, 0);
  ctx.restore();
}

const c = createCanvas(SIZE, SIZE);
// alpha:false produces an opaque RGB context — Apple rejects PNGs with an
// alpha channel, so we never want one in the encoded output.
const ctx = c.getContext("2d", { alpha: false });

// No clipPlate — we fill the entire 1024x1024 square so the resulting PNG
// is fully opaque. iOS will apply its own corner mask at render time.
fillPlate(ctx);
drawPattern(ctx);

const cx = SIZE / 2,
  cy = SIZE / 2;
const R = SIZE * 0.24;
drawGlow(ctx, cx, cy, R);

ctx.fillStyle = "#ffffff";
pathPlay(ctx, cx, cy, R);
ctx.fill();

// @napi-rs/canvas always encodes PNGs with an alpha channel (the canvas
// pixel buffer is RGBA internally even when alpha:false is set on the
// context). Apple rejects PNGs that carry an alpha channel, so we read the
// raw RGBA pixels and re-encode as a 3-channel RGB PNG via pngjs.
const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
const png = new PNG({ width: SIZE, height: SIZE });
png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../assets/images/icon.png");
writeFileSync(out, PNG.sync.write(png, { colorType: 2, inputColorType: 6, inputHasAlpha: true }));
console.log(`wrote ${out}  ${SIZE}x${SIZE}  RGB (no alpha)`);
