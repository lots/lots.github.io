// Adapted from my-Sabaki (MIT), src/modules/dim.js.
// SGF FF[4] DD is inherited; colours are stored in the private SBKDD companion.

import {
  parseCompressedVertices,
  parseVertex,
  stringifyVertex,
} from '@sabaki/sgf'
import { LINE_COLORS, normalizeLineColor } from './linecolor.js'

export const DIM_PAINT_DEFAULT = 1

export function toDimRange(v1, v2) {
  const [p1, p2] = [v1, v2].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  return [p1, p2].map(stringifyVertex).join(':')
}

export function normalizeDimValue(value) {
  if (value == null || value === '') return ''
  const [p1, p2] = String(value).split(':')
  if (p2 == null) return stringifyVertex(parseVertex(p1))
  return toDimRange(parseVertex(p1), parseVertex(p2))
}

export function parseDimColors(values = [], ranges = []) {
  const known = new Set(ranges)
  const colors = {}
  for (const value of values) {
    const [color, ...rest] = String(value).split(':')
    const normalized = normalizeLineColor(color)
    const range = normalizeDimValue(rest.join(':'))
    if (normalized == null || !known.has(range)) continue
    colors[range] = normalized
  }
  return colors
}

const vertexEquals = (a, b) => a[0] === b[0] && a[1] === b[1]

export function toDimEntries(ranges, colors = {}) {
  const byVertex = new Map()
  for (const range of ranges) {
    if (!range) continue
    for (const vertex of parseCompressedVertices(range)) {
      byVertex.set(vertex.join(','), {
        vertex,
        color: colors[range] ?? null,
      })
    }
  }
  return [...byVertex.values()]
}

export function findDimRangeAt(ranges, vertex) {
  for (let i = ranges.length - 1; i >= 0; i--) {
    if (parseCompressedVertices(ranges[i]).some((v) => vertexEquals(v, vertex))) {
      return i
    }
  }
  return -1
}

export function applyDimRectangle(ranges, colors, range, color) {
  let nextRanges = [...ranges]
  const nextColors = { ...colors }
  const exists = nextRanges.includes(range)

  if (exists && (nextColors[range] ?? null) === color) {
    nextRanges = nextRanges.filter((x) => x !== range)
    delete nextColors[range]
  } else if (exists) {
    if (color == null) delete nextColors[range]
    else nextColors[range] = color
  } else {
    nextRanges.push(range)
    if (color != null) nextColors[range] = color
  }

  return { ranges: nextRanges, colors: nextColors }
}

export function dimPaintValue(color) {
  const index = LINE_COLORS.indexOf(normalizeLineColor(color))
  return index === -1 ? DIM_PAINT_DEFAULT : DIM_PAINT_DEFAULT + index + 1
}

export function dimPaintColorName(value) {
  if (typeof value !== 'number' || value <= DIM_PAINT_DEFAULT) return null
  return LINE_COLORS[value - DIM_PAINT_DEFAULT - 1] ?? null
}
