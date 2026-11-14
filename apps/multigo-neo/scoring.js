/* Territory and area scoring shared by the editor and the Node tests.
 *
 * The board is a `signMap` (row-major, [y][x], 1 = black, -1 = white, 0 = empty),
 * the same layout @sabaki/go-board produces. Scoring mirrors how MultiGo counts:
 * the player marks dead stones, dead stones are lifted off the board, and the
 * remaining empty regions are flood-filled. A region belongs to a colour when every
 * stone touching it has that colour; a region touching both colours (or none) is
 * dame.
 *
 *   Japanese: territory + prisoners (captures made plus dead stones) + komi,
 *             with shared/dame points not scored
 *   Chinese:  alive stones + territory + shared/2 -/+ komi/2 (captures are not counted;
 *             the displayed result halves the area difference to match MultiGo)
 *
 * Seki and life-and-death are the player's judgement: whatever is not marked dead
 * is treated as alive, exactly like pressing "count" in MultiGo.
 */
(function (root) {
  'use strict'

  const EMPTY = 0
  const BLACK = 1
  const WHITE = -1
  const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]]

  const round2 = (value) => Math.round(value * 100) / 100
  const key = (x, y) => `${x},${y}`

  function normaliseDead(dead) {
    const set = new Set()
    if (!dead) return set
    if (dead instanceof Set) {
      for (const entry of dead) {
        if (Array.isArray(entry)) set.add(key(entry[0], entry[1]))
        else set.add(String(entry))
      }
      return set
    }
    if (Array.isArray(dead)) {
      for (const entry of dead) {
        if (Array.isArray(entry)) set.add(key(entry[0], entry[1]))
        else if (typeof entry === 'string') set.add(entry)
      }
    }
    return set
  }

  function groupAt(signMap, x, y) {
    const rows = Array.isArray(signMap) ? signMap.length : 0
    const cols = rows ? signMap[0].length : 0
    if (x < 0 || y < 0 || x >= cols || y >= rows) return []
    const sign = signMap[y]?.[x] ?? 0
    if (!sign) return []
    const seen = new Set([key(x, y)])
    const points = []
    const queue = [[x, y]]
    while (queue.length) {
      const [cx, cy] = queue.pop()
      points.push([cx, cy])
      for (const [dx, dy] of DIRECTIONS) {
        const nx = cx + dx
        const ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
        if ((signMap[ny]?.[nx] ?? 0) !== sign) continue
        const id = key(nx, ny)
        if (seen.has(id)) continue
        seen.add(id)
        queue.push([nx, ny])
      }
    }
    return points
  }

  /**
   * @param {object} options
   * @param {number[][]} options.signMap board matrix, 1 black / -1 white / 0 empty
   * @param {Set<string>|Array} [options.dead] dead stones as "x,y" keys or [x,y] pairs
   * @param {'japanese'|'chinese'} [options.rules]
   * @param {number} [options.komi]
   * @param {number} [options.capturesBlack] stones captured by Black during the game
   * @param {number} [options.capturesWhite] stones captured by White during the game
   * @param {number} [options.handicap] handicap compensation added to White in area scoring
   */
  function compute(options = {}) {
    const signMap = Array.isArray(options.signMap) ? options.signMap : []
    const rows = signMap.length
    const cols = rows ? signMap[0].length : 0
    const rules = options.rules === 'chinese' ? 'chinese' : 'japanese'
    const komi = Number.isFinite(Number(options.komi)) ? Number(options.komi) : 0
    const handicap = Math.max(0, Number(options.handicap) || 0)
    const dead = normaliseDead(options.dead)

    const grid = signMap.map((row) => row.slice())
    let deadBlack = 0
    let deadWhite = 0
    for (const id of dead) {
      const [x, y] = id.split(',').map(Number)
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue
      const sign = grid[y][x]
      if (sign === BLACK) deadBlack += 1
      else if (sign === WHITE) deadWhite += 1
      else continue
      grid[y][x] = EMPTY
    }

    const ownership = Array.from({ length: rows }, () => new Array(cols).fill(0))
    const visited = Array.from({ length: rows }, () => new Array(cols).fill(false))
    let blackTerritory = 0
    let whiteTerritory = 0
    let dame = 0

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if (grid[y][x] !== EMPTY || visited[y][x]) continue
        const points = []
        const border = new Set()
        const queue = [[x, y]]
        visited[y][x] = true
        while (queue.length) {
          const [cx, cy] = queue.pop()
          points.push([cx, cy])
          for (const [dx, dy] of DIRECTIONS) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
            const sign = grid[ny][nx]
            if (sign === EMPTY) {
              if (!visited[ny][nx]) {
                visited[ny][nx] = true
                queue.push([nx, ny])
              }
            } else {
              border.add(sign)
            }
          }
        }
        let owner = 0
        if (border.size === 1) owner = border.has(BLACK) ? BLACK : WHITE
        if (owner === BLACK) {
          blackTerritory += points.length
          for (const [px, py] of points) ownership[py][px] = BLACK
        } else if (owner === WHITE) {
          whiteTerritory += points.length
          for (const [px, py] of points) ownership[py][px] = WHITE
        } else {
          dame += points.length
        }
      }
    }

    let blackStones = 0
    let whiteStones = 0
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if (grid[y][x] === BLACK) blackStones += 1
        else if (grid[y][x] === WHITE) whiteStones += 1
      }
    }

    const capturesBlack = Number(options.capturesBlack) || 0
    const capturesWhite = Number(options.capturesWhite) || 0
    const blackPrisoners = capturesBlack + deadWhite
    const whitePrisoners = capturesWhite + deadBlack
    const blackPoints = blackStones + blackTerritory
    const whitePoints = whiteStones + whiteTerritory

    // MultiGo's Chinese display splits shared points and komi between the
    // players; Japanese counts territory plus prisoners/dead stones and does
    // not use shared points at all.
    const blackScore = round2(rules === 'chinese'
      ? blackPoints + dame / 2 - komi / 2
      : blackTerritory + blackPrisoners)
    const whiteScore = round2(rules === 'chinese'
      ? whitePoints + dame / 2 + komi / 2
      : whiteTerritory + whitePrisoners + komi)
    const diff = round2(blackScore - whiteScore)
    // MultiGo's Chinese result display halves the area difference (the
    // reference shows B+6.25 for a 30.75–18.25 score). Japanese keeps the
    // normal territory difference.
    const resultDiff = rules === 'chinese' ? round2(diff / 2) : diff

    // Standard area scoring, matching Sabaki's Area tab: area is alive stones
    // plus controlled territory, komi and handicap go to White, and dame are
    // neutral. The area difference is not halved.
    const areaBlackScore = round2(blackPoints)
    const areaWhiteScore = round2(whitePoints + komi + handicap)
    const areaDiff = round2(areaBlackScore - areaWhiteScore)

    return {
      rules,
      komi,
      handicap,
      areaBlackScore,
      areaWhiteScore,
      areaDiff,
      areaResult: resultLabel(areaDiff),
      dead: [...dead],
      deadBlack,
      deadWhite,
      capturesBlack,
      capturesWhite,
      ownership,
      blackTerritory,
      whiteTerritory,
      dame,
      blackStones,
      whiteStones,
      blackPoints,
      whitePoints,
      blackPrisoners,
      whitePrisoners,
      blackScore,
      whiteScore,
      diff,
      resultDiff,
      leader: diff > 0 ? BLACK : diff < 0 ? WHITE : 0,
      result: resultLabel(resultDiff),
    }
  }

  function computeBoth(options = {}) {
    return {
      chinese: compute({ ...options, rules: 'chinese' }),
      japanese: compute({ ...options, rules: 'japanese' }),
    }
  }

  function formatPoints(value) {
    const rounded = round2(Number(value) || 0)
    if (Number.isInteger(rounded)) return String(rounded)
    if (Number.isInteger(rounded * 10)) return rounded.toFixed(1)
    return rounded.toFixed(2)
  }

  function resultLabel(diff) {
    const rounded = round2(Number(diff) || 0)
    if (rounded === 0) return 'Jigo'
    return rounded > 0 ? `B+${formatPoints(rounded)}` : `W+${formatPoints(-rounded)}`
  }

  function ownerMap(grid) {
    const rows = grid.length
    const cols = rows ? grid[0].length : 0
    const ownership = Array.from({ length: rows }, () => new Array(cols).fill(0))
    const visited = Array.from({ length: rows }, () => new Array(cols).fill(false))
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if (grid[y][x] !== EMPTY || visited[y][x]) continue
        const points = []
        const border = new Set()
        const queue = [[x, y]]
        visited[y][x] = true
        while (queue.length) {
          const [cx, cy] = queue.pop()
          points.push([cx, cy])
          for (const [dx, dy] of DIRECTIONS) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
            const sign = grid[ny][nx]
            if (sign === EMPTY) {
              if (!visited[ny][nx]) {
                visited[ny][nx] = true
                queue.push([nx, ny])
              }
            } else {
              border.add(sign)
            }
          }
        }
        const owner = border.size === 1 ? (border.has(BLACK) ? BLACK : WHITE) : 0
        for (const [px, py] of points) ownership[py][px] = owner
      }
    }
    return ownership
  }

  function chainEyes(signMap, points, sign) {
    const rows = signMap.length
    const cols = rows ? signMap[0].length : 0
    const chain = new Set(points.map(([x, y]) => key(x, y)))
    const seen = new Set()
    let eyes = 0
    for (const [px, py] of points) {
      for (const [dx, dy] of DIRECTIONS) {
        const sx = px + dx
        const sy = py + dy
        if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue
        if (signMap[sy][sx] !== EMPTY) continue
        const id = key(sx, sy)
        if (seen.has(id)) continue
        const queue = [[sx, sy]]
        seen.add(id)
        let enclosed = true
        let touchesChain = 0
        while (queue.length) {
          const [cx, cy] = queue.pop()
          for (const [ex, ey] of DIRECTIONS) {
            const nx = cx + ex
            const ny = cy + ey
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
            const neighbour = signMap[ny][nx]
            if (neighbour === EMPTY) {
              const next = key(nx, ny)
              if (!seen.has(next)) {
                seen.add(next)
                queue.push([nx, ny])
              }
            } else if (neighbour === sign && chain.has(key(nx, ny))) {
              touchesChain += 1
            } else {
              enclosed = false
            }
          }
        }
        if (enclosed && touchesChain > 0) eyes += 1
      }
    }
    return eyes
  }

  /**
   * Cheap dead-stone estimate for Play > Estimate: a chain with no eye whose
   * liberties all fall inside enemy territory once the chain is lifted is
   * treated as dead. Living shapes with at least one eye are left alone.
   */
  function estimateDead(signMap) {
    const rows = Array.isArray(signMap) ? signMap.length : 0
    const cols = rows ? signMap[0].length : 0
    const dead = new Set()
    const chains = []
    const seen = new Set()
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const sign = signMap[y][x]
        if (!sign || seen.has(key(x, y))) continue
        const points = groupAt(signMap, x, y)
        for (const [px, py] of points) seen.add(key(px, py))
        const liberties = []
        for (const [px, py] of points) {
          for (const [dx, dy] of DIRECTIONS) {
            const nx = px + dx
            const ny = py + dy
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
            if (signMap[ny][nx] === EMPTY) liberties.push([nx, ny])
          }
        }
        chains.push({ sign, points, liberties, eyes: chainEyes(signMap, points, sign) })
      }
    }

    for (let pass = 0; pass < 3; pass += 1) {
      let changed = false
      for (const chain of chains) {
        if (chain.eyes > 0) continue
        if (chain.points.every(([x, y]) => dead.has(key(x, y)))) continue
        if (!chain.liberties.length) continue
        const test = signMap.map((row) => row.slice())
        for (const id of dead) {
          const [x, y] = id.split(',').map(Number)
          test[y][x] = EMPTY
        }
        for (const [x, y] of chain.points) test[y][x] = EMPTY
        const ownership = ownerMap(test)

        // Removing the chain must not open the surrounding region to the board
        // edge; a wall that encloses a large area is not dead just because it
        // has no eye.
        const edgeCache = new Map()
        const escapesToEdge = (sx, sy) => {
          const id = key(sx, sy)
          if (edgeCache.has(id)) return edgeCache.get(id)
          const seenRegion = new Set([id])
          const queue = [[sx, sy]]
          let open = false
          while (queue.length) {
            const [cx, cy] = queue.pop()
            if (cx === 0 || cy === 0 || cx === cols - 1 || cy === rows - 1) {
              open = true
              break
            }
            for (const [dx, dy] of DIRECTIONS) {
              const nx = cx + dx
              const ny = cy + dy
              if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
              if (test[ny][nx] !== EMPTY) continue
              const next = key(nx, ny)
              if (seenRegion.has(next)) continue
              seenRegion.add(next)
              queue.push([nx, ny])
            }
          }
          edgeCache.set(id, open)
          return open
        }

        const trapped = chain.liberties.every(([x, y]) => ownership[y][x] === -chain.sign)
        const sealed = chain.liberties.every(([x, y]) => !escapesToEdge(x, y))
        if (!trapped || !sealed) continue
        for (const [x, y] of chain.points) {
          const id = key(x, y)
          if (!dead.has(id)) {
            dead.add(id)
            changed = true
          }
        }
      }
      if (!changed) break
    }
    return [...dead]
  }

  const api = {
    EMPTY,
    BLACK,
    WHITE,
    compute,
    computeBoth,
    groupAt,
    estimateDead,
    normaliseDead,
    formatPoints,
    resultLabel,
  }
  root.MultiGoScoring = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
}(typeof globalThis !== 'undefined' ? globalThis : this));
