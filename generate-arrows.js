#!/usr/bin/env node
/**
 * generate-favicon-arrows-paths-stretch.js
 *
 * Default font: ./fonts/Roboto-Bold.ttf
 * Numbers and arrow are scaled/stretched to occupy most of vertical space.
 *
 * Usage:
 *   npm i opentype.js minimist
 *   # optional PNG:
 *   npm i sharp
 *   node generate-favicon-arrows-paths-stretch.js --outdir ./out --sizes 512
 *
 * Or supply --font ./fonts/Your-Bold.ttf
 *
 * Updated: Increased target height for numbers and arrow. Added logic to shift arrow or scale down if rotated projection goes outside bounds or overlaps left area.
 * Fixed: Changed some const to let where reassignments occur to avoid TypeError.
 * Updated: Changed arrow color to red to distinguish from text. Adjusted parameters to reduce overlap: increased rightAreaPct, increased minGap, reduced arrow size fractions.
 * Updated: Removed white background for transparency. Reduced rightAreaPct to minimize empty space on the right while keeping arrow visible.
 * Updated: Changed arrow positioning to right-aligned (arrowhead as far right as possible, body extending left).
 * Added: --dot option with values "with" or "without"; if not specified, generate both modes.
 * Updated: Adjusted layout to stretch numbers more horizontally by reducing rightAreaPct and hPadFrac; made digit spacing smaller by minimizing kerning in path generation.
 * Updated: Slightly increased spacing between digits; expanded arrow width by adjusting pads and fractions.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const argv = require('minimist')(process.argv.slice(2), {
  string: ['font', 'outdir', 'sizes', 'dot'],
  integer: ['concurrency'],
  default: {
    font: './fonts/Roboto-Bold.ttf',   // <--- default font
    outdir: './out',
    sizes: '512',
    dot: '',
    concurrency: Math.max(2, Math.min(16, Math.floor(os.cpus().length / 2) || 4))
  }
});

const FONT_PATH = argv.font;
const OUT_DIR = argv.outdir;
const DOT_MODE = argv.dot;
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const SIZES = String(argv.sizes).split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
if (SIZES.length === 0) SIZES.push(512);

const ORIENTATIONS = [
  { id: 'east', deg: 0 },
  { id: 'southeast', deg: 45 },
  { id: 'south', deg: 90 },
  { id: 'north', deg: -90 },
  { id: 'northeast', deg: -45 },
];

function toSafeFilename(val, withDot) {
  if (!withDot) {
    return 'val_' + val;
  } else {
    return `val_${val.toFixed(1).replace('.', '_')}`;
  }
}
function escapeXml(s) {
  return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":"&apos;",'"':'&quot;'}[c]));
}

// concurrency pool
async function asyncPool(poolLimit, array, iteratorFn) {
  const ret = [];
  const executing = new Set();
  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);
    if (executing.size >= poolLimit) await Promise.race(executing);
  }
  return Promise.all(ret);
}

// require dependencies
let opentype;
try { opentype = require('opentype.js'); } catch (e) { console.error('Install opentype.js: npm i opentype.js'); process.exit(1); }
let sharp = null;
try { sharp = require('sharp'); } catch (e) { /* optional */ }

// load font
let font;
try {
  font = opentype.loadSync(FONT_PATH);
} catch (err) {
  console.error('Failed to load font:', FONT_PATH, err.message || err);
  process.exit(1);
}

/**
 * Build SVG using outlined text path stretched to occupy most of vertical space.
 * Strategy:
 *  - generate glyph path at a large baseline size (1000)
 *  - compute bbox (W0,H0)
 *  - compute desired targetVisualHeight = height * 0.96 (very tall)
 *  - sY = targetVisualHeight / H0 (scale to match vertical target)
 *  - if scaled width (W0 * sY) > leftAreaWidth => compress horizontally: sX = leftAreaWidth / W0
 *    (this creates non-uniform scaling: stretched vertically, compressed horizontally)
 */
function buildSvgWithTextPath(valueText, rotationDeg, width = 512, height = 512) {
  // Layout config — larger right strip to give arrow room
  const rightAreaPct = 0.30;   // reduced further to stretch text more
  const hPadFrac = 0.02;       // reduced to give more horizontal space
  const leftMargin = Math.max(6, Math.round(width * hPadFrac));
  const rightAreaWidth = Math.round(width * rightAreaPct);
  const leftAreaWidth = width - rightAreaWidth - Math.round(leftMargin * 1.0); // reduced multiplier
  const cy = height / 2;

  // Target vertical occupancy for glyphs
  const targetVisualHeight = Math.round(height * 0.96); // increased for bigger height
  const probeSize = 1000;

  // Build composite path with slightly increased spacing between digits
  let currentX = 0;
  const charPaths = [];
  let totalBbox = {x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity};
  for (let i = 0; i < valueText.length; i++) {
    const char = valueText[i];
    const glyph = font.charToGlyph(char);
    const charPath = glyph.getPath(currentX, 0, probeSize);
    charPaths.push(charPath);
    const charBbox = charPath.getBoundingBox();
    totalBbox.x1 = Math.min(totalBbox.x1, charBbox.x1);
    totalBbox.y1 = Math.min(totalBbox.y1, charBbox.y1);
    totalBbox.x2 = Math.max(totalBbox.x2, charBbox.x2);
    totalBbox.y2 = Math.max(totalBbox.y2, charBbox.y2);

    // Advance by bounding width plus a tad extra spacing
    currentX += (charBbox.x2 - charBbox.x1) + probeSize * 0.05; // tad bigger spacing

    // Minimal kerning if applicable (set to 0 for control)
    if (i < valueText.length - 1) {
      const nextGlyph = font.charToGlyph(valueText[i + 1]);
      const kerning = font.getKerningValue(glyph, nextGlyph) * probeSize / font.unitsPerEm;
      currentX += kerning * 0; // keep at 0
    }
  }

  const W0 = totalBbox.x2 - totalBbox.x1 || probeSize * valueText.length * 0.5;
  const H0 = totalBbox.y2 - totalBbox.y1 || probeSize * 0.6;

  // Vertical scale to hit visual height, horizontal scale to fill width (stretch if possible)
  const sY = targetVisualHeight / H0;
  const maxTextWidth = Math.max(8, leftAreaWidth - Math.round(leftMargin * 0.6));
  const sX = maxTextWidth / W0; // always stretch/compress to fill available width

  // Combine paths for d
  let d = '';
  for (const p of charPaths) {
    d += (p.toPathData ? p.toPathData(3) : p.toSVG()) + ' ';
  }

  // Compute scaled text width (actual used width)
  const scaledTextWidth = W0 * sX;

  // Compute transforms so the text's left sits at leftMargin and it's vertically centered
  const bboxMidY = (totalBbox.y1 + totalBbox.y2) / 2;
  const tx = (leftMargin - totalBbox.x1 * sX);
  const ty = (cy - bboxMidY * sY);

  // --- Arrow layout (big but non-overlapping) ---
  const rightAreaStartX = width - rightAreaWidth;
  const arrowPadX = Math.max(6, Math.round(rightAreaWidth * 0.02)); // reduced for more width
  const arrowPadY = Math.max(4, Math.round(height * 0.01));         // reduced for bigger height
  let arrowY = cy;
  const arrowAvailableHeight = Math.max(12, height - arrowPadY * 2);

  // Arrow sizing relative to available height (decreased slightly to reduce overlap)
  let headSize = Math.max(10, Math.round(arrowAvailableHeight * 0.35));   // decreased ~35%
  let strokeWidth = Math.max(6, Math.round(arrowAvailableHeight * 0.16)); // slightly increased

  // Ensure arrow starts to the right of the text + gap
  const minGap = Math.max(6, Math.round(width * 0.02)); // increased to reduce overlap
  const textRightEdge = leftMargin + scaledTextWidth;
  const safeLeft = Math.round(textRightEdge + minGap);
  const defaultArrowStart = rightAreaStartX + arrowPadX;
  const arrowEndLimitX = width - arrowPadX - 4; // reduced margin

  // Right-aligned positioning: start from right end
  let x2 = arrowEndLimitX;
  let arrowLength = Math.max(12, Math.round(rightAreaWidth * 0.96)); // increased for more width
  let x1 = x2 - arrowLength;
  if (x1 < safeLeft) {
    x1 = safeLeft;
    arrowLength = x2 - x1;
  }
  let x2_clamped = x2;
  if (arrowLength < headSize + 6) {
    const minLength = headSize + 6;
    if (arrowLength < minLength) {
      // Scale down head and stroke to fit
      const scale = arrowLength / minLength;
      headSize *= scale;
      strokeWidth *= scale;
    }
  }
  let arrowCenterX = Math.round((x1 + x2_clamped) / 2);

  // Define relative points for projection (relative to center)
  let halfL = (x2_clamped - x1) / 2;
  let relPoints = [
    [-halfL, -strokeWidth / 2], [-halfL, strokeWidth / 2],  // line bottom/top
    [halfL, -strokeWidth / 2], [halfL, strokeWidth / 2],
    [halfL, -headSize], [halfL + headSize, 0], [halfL, headSize]  // head points
  ];

  const theta = rotationDeg * Math.PI / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // Compute projected relative x and y
  let minRx = Infinity, maxRx = -Infinity, minRy = Infinity, maxRy = -Infinity;
  relPoints.forEach(([rx, ry]) => {
    const rxp = rx * cos - ry * sin;
    const ryp = rx * sin + ry * cos;
    minRx = Math.min(minRx, rxp);
    maxRx = Math.max(maxRx, rxp);
    minRy = Math.min(minRy, ryp);
    maxRy = Math.max(maxRy, ryp);
  });

  // Current projected bounds
  let currentMinX = arrowCenterX + minRx;
  let currentMaxX = arrowCenterX + maxRx;
  let currentMinY = arrowY + minRy;
  let currentMaxY = arrowY + maxRy;

  // Adjust for x: prevent overlap and cutoff
  const safeRight = width;
  let shiftX = 0;
  if (currentMinX < safeLeft) {
    shiftX = safeLeft - currentMinX;
  } else if (currentMaxX > safeRight) {
    shiftX = safeRight - currentMaxX;
  }

  // Apply shift if possible; if shift would violate the other side, scale instead
  const projectedWidth = maxRx - minRx;
  const availableX = safeRight - safeLeft;
  let scaleFactor = 1;
  if (shiftX !== 0) {
    const newMinX = currentMinX + shiftX;
    const newMaxX = currentMaxX + shiftX;
    if (newMinX < safeLeft || newMaxX > safeRight) {
      // Cannot shift without violating, so scale
      scaleFactor = Math.min(scaleFactor, availableX / projectedWidth);
    } else {
      // Safe to shift
      arrowCenterX += shiftX;
      x1 += shiftX;
      x2_clamped += shiftX;
      currentMinX += shiftX;
      currentMaxX += shiftX;
    }
  }

  // Adjust for y similarly
  const safeTop = 0;
  const safeBottom = height;
  let shiftY = 0;
  if (currentMinY < safeTop) {
    shiftY = safeTop - currentMinY;
  } else if (currentMaxY > safeBottom) {
    shiftY = safeBottom - currentMaxY;
  }

  const projectedHeight = maxRy - minRy;
  const availableY = safeBottom - safeTop;
  if (shiftY !== 0) {
    const newMinY = currentMinY + shiftY;
    const newMaxY = currentMaxY + shiftY;
    if (newMinY < safeTop || newMaxY > safeBottom) {
      // Scale
      scaleFactor = Math.min(scaleFactor, availableY / projectedHeight);
    } else {
      // Shift
      arrowY += shiftY;
      currentMinY += shiftY;
      currentMaxY += shiftY;
    }
  }

  // If scaleFactor < 1, apply scaling to arrow dimensions and recompute positions
  if (scaleFactor < 1) {
    headSize *= scaleFactor;
    strokeWidth *= scaleFactor;
    arrowLength *= scaleFactor;
    halfL = arrowLength / 2;
    x1 = arrowCenterX - halfL;
    x2_clamped = arrowCenterX + halfL;

    // Recompute relPoints with scaled dimensions
    relPoints = [
      [-halfL, -strokeWidth / 2], [-halfL, strokeWidth / 2],
      [halfL, -strokeWidth / 2], [halfL, strokeWidth / 2],
      [halfL, -headSize], [halfL + headSize, 0], [halfL, headSize]
    ];

    // Recompute projections to confirm, but since scaled, it should fit
  }

  const headP1 = `${x2_clamped},${arrowY - headSize}`;
  const headP2 = `${x2_clamped + headSize},${arrowY}`;
  const headP3 = `${x2_clamped},${arrowY + headSize}`;

  // Build SVG
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">

  <!-- Text outlines (scaled non-uniformly to prioritize vertical occupancy) -->
  <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${sX.toFixed(6)} ${sY.toFixed(6)})">
    <path d="${d}" fill="black" stroke="none" />
  </g>

  <!-- Prominent arrow confined to right area and to the right of the text -->
  <g transform="rotate(${rotationDeg} ${arrowCenterX} ${arrowY})"
     stroke="red" stroke-linecap="round" stroke-linejoin="round" fill="red">
    <line x1="${x1}" y1="${arrowY}" x2="${x2_clamped}" y2="${arrowY}" stroke-width="${strokeWidth}" />
    <polygon points="${headP1} ${headP2} ${headP3}" />
  </g>
</svg>`;
  return svg;
}

// write svg and optional png
async function writeFiles(svg, baseOutPathNoExt, size) {
  const svgPath = `${baseOutPathNoExt}_${size}.svg`;
  fs.writeFileSync(svgPath, svg, 'utf8');

  if (!sharp) return { svg: svgPath, png: null };

  const pngPath = `${baseOutPathNoExt}_${size}.png`;
  const svgBuffer = Buffer.from(svg, 'utf8');
  await sharp(svgBuffer).resize(size, size, { fit: 'cover' }).png({ compressionLevel: 9 }).toFile(pngPath);
  return { svg: svgPath, png: pngPath };
}

async function createOne(valueStr, orientation, size, withDot) {
  const filenameBase = `${toSafeFilename(Number(valueStr), withDot)}_${orientation.id}`;
  const outBase = path.join(OUT_DIR, filenameBase);
  const svg = buildSvgWithTextPath(valueStr, orientation.deg, size, size);
  await writeFiles(svg, outBase, size);
}

(async () => {
  console.log(`Font: ${FONT_PATH}`);
  if (!sharp) console.log('Note: sharp not loaded — SVGs only. Install sharp to also get PNGs.');

  const modes = DOT_MODE ? [DOT_MODE === 'with'] : [true, false];
  let totalTasks = 0;
  for (const withDot of modes) {
    const start = withDot ? 0.0 : 0;
    const end = withDot ? 22.2 : 600;
    const step = withDot ? 0.1 : 1;
    const numCount = Math.round((end - start) / step) + 1;
    totalTasks += numCount * ORIENTATIONS.length * SIZES.length;
  }
  console.log(`Generating ${totalTasks} files`);

  const tasks = [];
  for (const withDot of modes) {
    const start = withDot ? 0.0 : 0;
    const end = withDot ? 22.2 : 600;
    const step = withDot ? 0.1 : 1;
    const numCount = Math.round((end - start) / step) + 1;
    for (let i = 0; i < numCount; i++) {
      const val = withDot ? Math.round((start + i * step) * 10) / 10 : (start + i * step);
      const valueStr = val.toFixed(withDot ? 1 : 0);
      for (const orient of ORIENTATIONS) for (const size of SIZES) tasks.push({ valueStr, orient, size, withDot });
    }
  }

  let completed = 0;
  await asyncPool(argv.concurrency, tasks, async (task) => {
    await createOne(task.valueStr, task.orient, task.size, task.withDot);
    completed++;
    if (completed % 50 === 0 || completed === tasks.length) console.log(`Progress: ${completed}/${tasks.length}`);
  });

  console.log('Done.');
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});