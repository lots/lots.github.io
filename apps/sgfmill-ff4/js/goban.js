/**
 * Draw a go board as SVG, in the style a real board is shown on screen: warm
 * wood, dark grid, star points, coordinates, and stones with a highlight and a
 * shadow rather than plain circles.
 *
 * It is a pure function returning a string, so it can be tested without a
 * browser, and the drawing scales with the panel because the SVG carries a
 * viewBox instead of fixed pixels.
 */

const CELL = 24;          // units per line; the whole board scales from this
const MARGIN = 22;        // room for the coordinates

/** Column letters skip I, as SGF and GTP both do. */
export function columnLetter(col) {
  return col < 8 ? String.fromCharCode(65 + col)
                 : String.fromCharCode(66 + col);
}

/**
 * The star points for a board of this size.
 *
 * 19x19 has nine, 13x13 and 9x9 have the five of a real board (four corners
 * and the centre); smaller boards have none.
 */
export function starPoints(size) {
  if (size < 7) return [];
  const middle = (size - 1) / 2;
  if (size >= 13) {
    const edge = 3;
    const lines = [edge, middle, size - 1 - edge];
    const points = [];
    for (const row of lines) for (const col of lines) points.push([row, col]);
    return points;
  }
  const edge = 2;
  return [[edge, edge], [edge, size - 1 - edge],
          [size - 1 - edge, edge], [size - 1 - edge, size - 1 - edge],
          [middle, middle]];
}

function vertexName(row, col) {
  return columnLetter(col) + (row + 1);
}

function number(value) {
  // Two decimals is plenty at this scale, and keeps the markup readable.
  return Number(value.toFixed(2));
}

/**
 * Render a board.
 *
 * board    -- a Board from board.js
 * options  -- { lastMove: [row, col] or null }
 *
 * Returns an SVG document as a string.
 */
export function renderGoban(board, options = {}) {
  const size = board.size;
  const span = (size - 1) * CELL;
  const side = span + 2 * MARGIN;
  const x = (col) => MARGIN + col * CELL;
  const y = (row) => MARGIN + (size - 1 - row) * CELL;   // row 0 at the bottom
  const stoneRadius = CELL * 0.47;
  const fontSize = CELL * 0.46;

  const parts = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" class="goban" ` +
             `viewBox="0 0 ${side} ${side}" width="${side}" height="${side}" ` +
             `role="img" aria-label="Go board, ${size} by ${size}">`);

  // Everything that is drawn more than once lives in defs.
  parts.push(`<defs>
  <linearGradient id="wood" x1="0" y1="0" x2="0.35" y2="1">
    <stop offset="0" stop-color="#f2dcaa"/>
    <stop offset="0.45" stop-color="#e6c68a"/>
    <stop offset="1" stop-color="#cfa55f"/>
  </linearGradient>
  <radialGradient id="varnish" cx="0.32" cy="0.28" r="0.85">
    <stop offset="0" stop-color="#fff" stop-opacity="0.32"/>
    <stop offset="0.6" stop-color="#fff" stop-opacity="0"/>
    <stop offset="1" stop-color="#5c3d16" stop-opacity="0.22"/>
  </radialGradient>
  <radialGradient id="blackStone" cx="0.34" cy="0.28" r="0.75">
    <stop offset="0" stop-color="#8d939b"/>
    <stop offset="0.28" stop-color="#3a3d42"/>
    <stop offset="0.75" stop-color="#111214"/>
    <stop offset="1" stop-color="#040506"/>
  </radialGradient>
  <radialGradient id="whiteStone" cx="0.34" cy="0.28" r="0.78">
    <stop offset="0" stop-color="#ffffff"/>
    <stop offset="0.5" stop-color="#f6f4ee"/>
    <stop offset="1" stop-color="#c9c2b4"/>
  </radialGradient>
  <filter id="stoneShadow" x="-40%" y="-40%" width="180%" height="180%">
    <feDropShadow dx="0.7" dy="1" stdDeviation="0.9" flood-color="#3a2a12"
                  flood-opacity="0.5"/>
  </filter>
</defs>`);

  // The board itself: wood, a varnish sheen, and a frame.
  const inset = 1.2;
  parts.push(`<rect x="${inset}" y="${inset}" width="${side - 2 * inset}" ` +
             `height="${side - 2 * inset}" rx="4" fill="url(#wood)" ` +
             `stroke="#6b461c" stroke-width="2"/>`);
  parts.push(`<rect x="${inset}" y="${inset}" width="${side - 2 * inset}" ` +
             `height="${side - 2 * inset}" rx="4" fill="url(#varnish)"/>`);

  // Grid.
  const lines = [];
  for (let i = 0; i < size; i++) {
    const at = MARGIN + i * CELL;
    lines.push(`M${at} ${MARGIN}V${MARGIN + span}`);
    lines.push(`M${MARGIN} ${at}H${MARGIN + span}`);
  }
  parts.push(`<path d="${lines.join("")}" stroke="#4a3418" ` +
             `stroke-width="1" stroke-linecap="square" fill="none"/>`);

  // Star points, large enough to see: on a real board they are a sixth of a
  // line apart, and at this scale anything smaller disappears into the wood.
  const stars = starPoints(size).map(([row, col]) =>
    `<circle class="hoshi" cx="${number(x(col))}" cy="${number(y(row))}" ` +
    `r="${number(CELL * 0.115)}" fill="#2e200c"/>`);
  parts.push(`<g class="hoshi-points">${stars.join("")}</g>`);

  // Coordinates: numbers up the left, letters along the bottom.
  const labels = [];
  for (let row = 0; row < size; row++) {
    labels.push(`<text class="coord" x="${number(MARGIN * 0.45)}" ` +
                `y="${number(y(row) + fontSize * 0.35)}" ` +
                `text-anchor="middle">${row + 1}</text>`);
  }
  for (let col = 0; col < size; col++) {
    labels.push(`<text class="coord" x="${number(x(col))}" ` +
                `y="${number(side - MARGIN * 0.45)}" ` +
                `text-anchor="middle">${columnLetter(col)}</text>`);
  }
  parts.push(`<g class="coordinates" font-family="system-ui, sans-serif" ` +
             `font-size="${number(fontSize)}" fill="#6b4d24">` +
             `${labels.join("")}</g>`);

  // Stones.
  const stones = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const colour = board.board[row][col];
      if (!colour) continue;
      const cls = colour === "b" ? "black" : "white";
      stones.push(`<circle class="stone ${cls}" ` +
                  `data-vertex="${vertexName(row, col)}" ` +
                  `cx="${number(x(col))}" cy="${number(y(row))}" ` +
                  `r="${number(stoneRadius)}" fill="url(#${cls}Stone)" ` +
                  `filter="url(#stoneShadow)"/>`);
    }
  }
  parts.push(`<g class="stones">${stones.join("")}</g>`);

  // The last move gets a dot in the contrasting colour, as on a real board.
  if (options.lastMove) {
    const [row, col] = options.lastMove;
    const colour = board.board[row][col];
    const marker = colour === "b" ? "#f3f1ea" : "#1b1b1b";
    parts.push(`<circle class="last-move" cx="${number(x(col))}" ` +
               `cy="${number(y(row))}" r="${number(CELL * 0.14)}" ` +
               `fill="${marker}"/>`);
  }

  parts.push("</svg>");
  return parts.join("\n");
}
