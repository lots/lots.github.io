// Adapted from my-Sabaki (MIT), src/modules/linecolor.js.
// Colours the Line and Arrow edit tools can paint with. The colour is an
// optional third field in AR/LN, e.g. `aa:bb:red`.

export const LINE_COLORS = ['black', 'white', 'red', 'yellow', 'blue', 'green']

export function normalizeLineColor(value) {
  if (typeof value !== 'string') return null
  const color = value.trim().toLowerCase()
  return LINE_COLORS.includes(color) ? color : null
}

export function parseLineValue(value) {
  const parts = String(value).split(':')
  return {
    points: [parts[0], parts[1]],
    color: normalizeLineColor(parts[2]),
  }
}

export function formatLineValue(p1, p2, color) {
  const normalized = normalizeLineColor(color)
  return normalized == null ? `${p1}:${p2}` : `${p1}:${p2}:${normalized}`
}
