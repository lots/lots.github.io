// Adapted from my-Sabaki (MIT), src/modules/gametree.js.
// Board/markup extraction and game-info helpers for @sabaki/immutable-gametree.

import { fromDimensions } from '@sabaki/go-board'
import GameTree from '@sabaki/immutable-gametree'
import {
  stringifyVertex,
  parseVertex,
  parseCompressedVertices,
} from '@sabaki/sgf'
import { parseLineValue } from './linecolor.js'
import { normalizeDimValue, parseDimColors, toDimEntries } from './dim.js'

const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
let boardCache = {}

export function nodeMerger(node, data) {
  if (
    (data.B == null || node.data.B == null || data.B[0] !== node.data.B[0]) &&
    (data.W == null || node.data.W == null || data.W[0] !== node.data.W[0])
  ) {
    return null
  }
  return { ...data, ...node.data }
}

export function getRootProperty(tree, property, fallback = null) {
  let result = ''
  if (property in tree.root.data) result = tree.root.data[property][0]
  return result === '' ? fallback : result
}

export function getGameInfo(tree) {
  let komi = getRootProperty(tree, 'KM')
  if (komi != null && !isNaN(komi)) komi = +komi
  else komi = null

  let size = getRootProperty(tree, 'SZ')
  if (size == null) {
    size = [19, 19]
  } else {
    const parts = size.toString().split(':')
    size = [+parts[0], +parts[parts.length - 1]]
  }

  let handicap = getRootProperty(tree, 'HA', 0)
  handicap = Math.max(1, Math.min(9, Math.round(handicap)))
  if (handicap === 1) handicap = 0

  const playerNames = ['B', 'W'].map(
    (x) => getRootProperty(tree, `P${x}`) || getRootProperty(tree, `${x}T`),
  )
  const playerRanks = ['BR', 'WR'].map((x) => getRootProperty(tree, x))

  return {
    playerNames,
    playerRanks,
    blackName: playerNames[0],
    blackRank: playerRanks[0],
    whiteName: playerNames[1],
    whiteRank: playerRanks[1],
    gameName: getRootProperty(tree, 'GN'),
    eventName: getRootProperty(tree, 'EV'),
    gameComment: getRootProperty(tree, 'GC'),
    date: getRootProperty(tree, 'DT'),
    result: getRootProperty(tree, 'RE'),
    komi,
    handicap,
    size,
  }
}

export function setGameInfo(tree, data) {
  let newTree = tree.mutate((draft) => {
    if ('size' in data) {
      if (data.size) {
        let value = data.size.map((x) =>
          isNaN(x) || !x ? 19 : Math.min(25, Math.max(2, x)),
        )
        if (value[0] === value[1]) value = value[0].toString()
        else value = value.join(':')
        draft.updateProperty(draft.root.id, 'SZ', [value])
      } else {
        draft.removeProperty(draft.root.id, 'SZ')
      }
    }
  })

  return newTree.mutate((draft) => {
    const props = {
      blackName: 'PB',
      blackRank: 'BR',
      whiteName: 'PW',
      whiteRank: 'WR',
      gameName: 'GN',
      eventName: 'EV',
      gameComment: 'GC',
      date: 'DT',
      result: 'RE',
      komi: 'KM',
      handicap: 'HA',
    }

    for (const key in props) {
      if (!(key in data)) continue
      let value = data[key]

      if (value && value.toString() !== '') {
        if (key === 'komi') {
          if (isNaN(value)) value = 0
        } else if (key === 'handicap') {
          const board = getBoard(newTree, newTree.root.id)
          const stones = board.getHandicapPlacement(+value)
          value = stones.length
          if (value <= 1) {
            draft.removeProperty(draft.root.id, props[key])
            draft.removeProperty(draft.root.id, 'AB')
            continue
          }
          draft.updateProperty(draft.root.id, 'AB', stones.map(stringifyVertex))
        }
        draft.updateProperty(draft.root.id, props[key], [value.toString()])
      } else {
        draft.removeProperty(draft.root.id, props[key])
      }
    }
  })
}

export function getMatrixDict(tree) {
  const matrix = [...Array(tree.getHeight() + 1)].map(() => [])
  const dict = {}

  const inner = (node, xshift, yshift) => {
    const sequence = [...tree.getSequence(node.id)]
    let hasCollisions = true

    while (hasCollisions) {
      hasCollisions = false
      for (let y = 0; y <= sequence.length; y += 1) {
        if (xshift >= matrix[yshift + y].length - (y === sequence.length)) continue
        hasCollisions = true
        xshift += 1
        break
      }
    }

    for (let y = 0; y < sequence.length; y += 1) {
      matrix[yshift + y][xshift] = sequence[y].id
      dict[sequence[y].id] = [xshift, yshift + y]
    }

    const last = sequence[sequence.length - 1]
    for (let k = 0; k < last.children.length; k += 1) {
      inner(last.children[k], xshift + k, yshift + sequence.length)
    }

    return [matrix, dict]
  }

  return inner(tree.root, 0, 0)
}

export function getMatrixWidth(y, matrix) {
  const keys = [...Array(10)]
    .map((_, i) => i + y - 4)
    .filter((i) => i >= 0 && i < matrix.length)

  const padding = Math.min(
    ...keys.map((i) => {
      for (let j = 0; j < matrix[i].length; j += 1) {
        if (matrix[i][j] != null) return j
      }
      return 0
    }),
  )

  const width = Math.max(...keys.map((i) => matrix[i].length)) - padding
  return [width, padding]
}

export function getBoard(tree, id) {
  const treePositions = []
  let board = null

  for (const node of tree.listNodesVertically(id, -1, {})) {
    if (boardCache[node.id] != null && node.id !== id) {
      board = boardCache[node.id]
      break
    }
    treePositions.unshift(node.id)
  }

  if (!board) {
    let size = [19, 19]
    if (tree.root.data.SZ != null) {
      const value = tree.root.data.SZ[0]
      if (value.includes(':')) size = value.split(':')
      else size = [value, value]
      size = size.map((x) => (isNaN(x) ? 19 : +x))
    }
    board = fromDimensions(...size)
  }

  const inner = (currentTree, nodeId, baseboard) => {
    const node = currentTree.get(nodeId)
    if (node == null) return null
    const parent = node.parentId != null ? currentTree.get(node.parentId) : null

    let vertex = null
    let nextBoard = null
    const moveProps = { B: 1, W: -1 }

    for (const prop in moveProps) {
      if (node.data[prop] == null) continue
      vertex = parseVertex(node.data[prop][0])
      nextBoard = baseboard.makeMove(moveProps[prop], vertex)
      nextBoard.currentVertex = vertex
      break
    }

    if (!nextBoard) nextBoard = baseboard.clone()

    const setupProps = { AW: -1, AE: 0, AB: 1 }
    for (const prop in setupProps) {
      if (node.data[prop] == null) continue
      for (const value of node.data[prop]) {
        for (const setupVertex of parseCompressedVertices(value)) {
          if (!nextBoard.has(setupVertex)) continue
          nextBoard.set(setupVertex, setupProps[prop])
        }
      }
    }

    let dimmedRanges
    let dimmedColors
    if (node.data.DD != null) {
      dimmedRanges = node.data.DD.map(normalizeDimValue).filter((x) => x !== '')
      dimmedColors = parseDimColors(node.data.SBKDD, dimmedRanges)
    } else {
      dimmedRanges = baseboard.dimmedRanges || []
      dimmedColors = baseboard.dimmedColors || {}
    }

    Object.assign(nextBoard, {
      markers: nextBoard.signMap.map((row) => row.map(() => null)),
      lines: [],
      dimmedRanges,
      dimmedColors,
      dimmed: toDimEntries(dimmedRanges, dimmedColors),
      childrenInfo: [],
      siblingsInfo: [],
    })

    if (vertex != null && nextBoard.has(vertex)) {
      const [x, y] = vertex
      nextBoard.markers[y][x] = { type: 'point' }
    }

    const markerProps = { CR: 'circle', MA: 'cross', SQ: 'square', TR: 'triangle' }
    for (const prop in markerProps) {
      if (node.data[prop] == null) continue
      for (const value of node.data[prop]) {
        for (const [x, y] of parseCompressedVertices(value)) {
          if (nextBoard.markers[y] == null) continue
          nextBoard.markers[y][x] = { type: markerProps[prop] }
        }
      }
    }

    if (node.data.LB != null) {
      for (const composed of node.data.LB) {
        const sep = composed.indexOf(':')
        const point = composed.slice(0, sep)
        const label = composed.slice(sep + 1)
        const [x, y] = parseVertex(point)
        if (nextBoard.markers[y] == null) continue
        nextBoard.markers[y][x] = { type: 'label', label }
      }
    }

    if (node.data.L != null) {
      for (let i = 0; i < node.data.L.length; i += 1) {
        const point = node.data.L[i]
        const label = alpha[i]
        if (label == null) return
        const [x, y] = parseVertex(point)
        if (nextBoard.markers[y] == null) continue
        nextBoard.markers[y][x] = { type: 'label', label }
      }
    }

    for (const type of ['AR', 'LN']) {
      if (node.data[type] == null) continue
      for (const composed of node.data[type]) {
        const { points, color } = parseLineValue(composed)
        const [v1, v2] = points.map(parseVertex)
        nextBoard.lines.push({
          v1,
          v2,
          type: type === 'AR' ? 'arrow' : 'line',
          color,
        })
      }
    }

    const addInfo = (child, list) => {
      let v
      let sign
      if (child.data.B != null) {
        v = parseVertex(child.data.B[0])
        sign = 1
      } else if (child.data.W != null) {
        v = parseVertex(child.data.W[0])
        sign = -1
      } else {
        return
      }
      if (!nextBoard.has(v)) return

      let type = null
      if (child.data.BM != null) type = 'bad'
      else if (child.data.DO != null) type = 'doubtful'
      else if (child.data.IT != null) type = 'interesting'
      else if (child.data.TE != null) type = 'good'
      list[v] = { sign, type }
    }

    for (const child of node.children) addInfo(child, nextBoard.childrenInfo)
    if (parent != null) {
      for (const sibling of parent.children) {
        addInfo(sibling, nextBoard.siblingsInfo)
      }
    }

    boardCache[nodeId] = nextBoard
    return nextBoard
  }

  for (const nodeId of treePositions) {
    board = inner(tree, nodeId, board)
  }

  return board
}

export function clearBoardCache() {
  boardCache = {}
}

export function getPlayer(tree, id) {
  let node = tree.get(id)
  while (node != null) {
    if (node.data.PL != null) return node.data.PL[0] === 'W' ? -1 : 1
    if (node.data.B != null) return -1
    if (node.data.W != null) return 1
    if (node.parentId == null) break
    node = tree.get(node.parentId)
  }
  return 1
}

export function getMoveNumber(tree, id) {
  let count = 0
  let node = tree.get(id)
  while (node != null) {
    if (node.data.B != null || node.data.W != null) count += 1
    if (node.parentId == null) break
    node = tree.get(node.parentId)
  }
  return count
}

export function getPath(tree, id) {
  const path = []
  let node = tree.get(id)
  while (node != null) {
    path.unshift(node)
    if (node.parentId == null) break
    node = tree.get(node.parentId)
  }
  return path
}

export { GameTree }
