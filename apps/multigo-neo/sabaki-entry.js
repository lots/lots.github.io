import GameTree from '@sabaki/immutable-gametree'
import Board from '@sabaki/go-board'
import * as sgf from '@sabaki/sgf'
import * as gametree from './vendor/gametree.js'
import * as linecolor from './vendor/linecolor.js'
import * as dim from './vendor/dim.js'

function createIdGenerator(start = 1) {
  let id = start
  return () => id++
}

// The exact Sabaki/my-Sabaki logic used by the classic renderer.
window.SabakiLibs = {
  GameTree,
  Board,
  sgf,
  createIdGenerator,
  ...gametree,
  ...linecolor,
  ...dim,
}
