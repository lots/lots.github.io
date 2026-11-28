/*
 * Go rules and SGF support for MultiGo Neo.
 *
 * Pure logic only — usable from the renderer (window.GoEngine) and from Node
 * (require('./src/go-engine.js')) for tests.
 */
(function (root, factory) {
  'use strict';

  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.GoEngine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const SIZES = [9, 13, 19];
  const LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
  const COLOR_NAMES = { [BLACK]: 'Black', [WHITE]: 'White', [EMPTY]: 'Empty' };

  function other(color) {
    return color === BLACK ? WHITE : BLACK;
  }

  function colorName(color) {
    return COLOR_NAMES[color] || 'Empty';
  }

  function createBoard(size) {
    if (!Number.isInteger(size) || size < 2 || size > 25) {
      throw new Error('Board size must be an integer between 2 and 25.');
    }
    return new Uint8Array(size * size);
  }

  function cloneBoard(board) {
    return new Uint8Array(board);
  }

  function isOnBoard(size, x, y) {
    return x >= 0 && y >= 0 && x < size && y < size;
  }

  function pointIndex(size, x, y) {
    return y * size + x;
  }

  function coordinateLabel(x, y, size) {
    if (!isOnBoard(size, x, y)) return '?';
    return `${LETTERS[x]}${size - y}`;
  }

  function encodeSgfPoint(x, y) {
    return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
  }

  function decodeSgfPoint(value, size) {
    if (typeof value !== 'string' || value.length !== 2 || value.includes(':')) return null;
    const x = value.charCodeAt(0) - 97;
    const y = value.charCodeAt(1) - 97;
    if (!isOnBoard(size, x, y)) return null;
    return { x, y };
  }

  function starPoints(size) {
    if (size < 7) return [];
    const edge = size >= 13 ? 3 : 2;
    const middle = (size - 1) / 2;
    const edges = [edge, size - 1 - edge];
    const points = [];
    const seen = new Set();

    const add = (x, y) => {
      const key = `${x},${y}`;
      if (seen.has(key)) return;
      seen.add(key);
      points.push({ x, y });
    };

    for (const x of edges) {
      for (const y of edges) add(x, y);
    }
    if (Number.isInteger(middle)) add(middle, middle);
    if (size >= 19) {
      for (const x of edges) add(x, middle);
      for (const y of edges) add(middle, y);
    }
    return points;
  }

  function analyzeGroup(board, size, startX, startY) {
    const start = pointIndex(size, startX, startY);
    const color = board[start];
    if (!color) {
      return { color: EMPTY, stones: [], liberties: [] };
    }

    const stones = [];
    const liberties = [];
    const seen = new Uint8Array(board.length);
    const libertySeen = new Uint8Array(board.length);
    const stack = [start];
    seen[start] = 1;

    while (stack.length) {
      const index = stack.pop();
      stones.push(index);
      const x = index % size;
      const y = Math.floor(index / size);

      const neighbours = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];

      for (const [nx, ny] of neighbours) {
        if (!isOnBoard(size, nx, ny)) continue;
        const next = pointIndex(size, nx, ny);
        if (board[next] === EMPTY) {
          if (!libertySeen[next]) {
            libertySeen[next] = 1;
            liberties.push(next);
          }
        } else if (board[next] === color && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }

    return { color, stones, liberties };
  }

  function boardToPoints(board, size, indices) {
    return indices.map((index) => ({
      x: index % size,
      y: Math.floor(index / size),
    }));
  }

  /**
   * Attempt a move. Returns { ok: false, error } for illegal moves, otherwise
   * the resulting board, captured stones, and a ko candidate. The caller can
   * confirm the ko candidate against the position two plies back (full ko),
   * or use it directly for simple-ko behaviour.
   */
  function tryMove(board, size, x, y, color, koPoint) {
    if (color !== BLACK && color !== WHITE) {
      return { ok: false, error: 'Invalid stone colour.' };
    }
    if (!isOnBoard(size, x, y)) {
      return { ok: false, error: 'That point is outside the board.' };
    }

    const index = pointIndex(size, x, y);
    if (board[index] !== EMPTY) {
      return { ok: false, error: 'That point is already occupied.' };
    }
    if (koPoint && koPoint.x === x && koPoint.y === y) {
      return { ok: false, error: 'Ko: that recapture is not allowed yet.' };
    }

    const next = cloneBoard(board);
    next[index] = color;

    const opponent = other(color);
    const captured = [];
    const removed = new Uint8Array(next.length);

    const neighbours = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];

    for (const [nx, ny] of neighbours) {
      if (!isOnBoard(size, nx, ny)) continue;
      const neighbourIndex = pointIndex(size, nx, ny);
      if (next[neighbourIndex] !== opponent || removed[neighbourIndex]) continue;

      const group = analyzeGroup(next, size, nx, ny);
      if (group.liberties.length > 0) continue;

      const points = boardToPoints(next, size, group.stones);
      for (const point of points) {
        const capturedIndex = pointIndex(size, point.x, point.y);
        removed[capturedIndex] = 1;
        next[capturedIndex] = EMPTY;
        captured.push({ x: point.x, y: point.y, color: opponent });
      }
    }

    const ownGroup = analyzeGroup(next, size, x, y);
    if (ownGroup.liberties.length === 0) {
      return { ok: false, error: 'Suicide is not allowed.' };
    }

    let ko = null;
    if (captured.length === 1) {
      ko = { x: captured[0].x, y: captured[0].y };
    }

    return { ok: true, board: next, captured, ko };
  }

  function boardsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function escapeSgfValue(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\]/g, '\\]');
  }

  function sgfProperty(identifier, value) {
    return `${identifier}[${escapeSgfValue(value)}]`;
  }

  function firstProperty(props, identifier) {
    const values = props[identifier];
    return values && values.length ? values[0] : undefined;
  }

  function parseSgf(text) {
    if (typeof text !== 'string' || !text.includes('(')) {
      throw new Error('This does not look like an SGF file.');
    }

    const warnings = [];
    let position = 0;
    const length = text.length;

    const skipWhitespace = () => {
      while (position < length && /\s/.test(text[position])) position += 1;
    };

    const fail = (message) => {
      throw new Error(`${message} (character ${position}).`);
    };

    const expect = (character) => {
      if (text[position] !== character) fail(`Expected "${character}"`);
      position += 1;
    };

    const readValue = () => {
      expect('[');
      let value = '';
      while (position < length) {
        const character = text[position];
        position += 1;
        if (character === '\\') {
          if (position < length) {
            const escaped = text[position];
            position += 1;
            if (escaped !== '\n') value += escaped;
          }
        } else if (character === ']') {
          return value;
        } else {
          value += character;
        }
      }
      fail('Unterminated property value');
      return value;
    };

    const readNode = () => {
      expect(';');
      skipWhitespace();
      const props = {};

      while (position < length && text[position] >= 'A' && text[position] <= 'Z') {
        let identifier = '';
        while (position < length && text[position] >= 'A' && text[position] <= 'Z') {
          identifier += text[position];
          position += 1;
        }
        skipWhitespace();
        if (text[position] !== '[') fail(`Property ${identifier} has no value`);
        const values = [];
        while (position < length && text[position] === '[') {
          values.push(readValue());
          skipWhitespace();
        }
        props[identifier] = values;
      }

      return { props, children: [] };
    };

    const readTree = () => {
      expect('(');
      skipWhitespace();

      const chain = [];
      while (position < length && text[position] === ';') {
        const node = readNode();
        if (chain.length) chain[chain.length - 1].children.push(node);
        chain.push(node);
        skipWhitespace();
      }

      while (position < length && text[position] === '(') {
        const variation = readTree();
        if (variation && chain.length) {
          chain[chain.length - 1].children.push(variation);
        }
        skipWhitespace();
      }

      expect(')');
      return chain[0] || null;
    };

    skipWhitespace();
    if (text[position] !== '(') fail('Expected an SGF game tree');
    const rootNode = readTree();
    skipWhitespace();
    if (position < length) {
      warnings.push('Only the first game in the SGF collection was loaded.');
    }
    if (!rootNode) {
      throw new Error('The SGF file contains no nodes.');
    }

    const gameLine = [];
    let node = rootNode;
    let variationCount = 0;
    while (node) {
      gameLine.push(node);
      if (node.children.length > 1) variationCount += node.children.length - 1;
      node = node.children[0] || null;
    }

    const rootProps = rootNode.props;
    const gameProperty = firstProperty(rootProps, 'GM');
    if (gameProperty !== undefined && gameProperty !== '1') {
      warnings.push(`GM[${gameProperty}] is not Go; the file was still loaded.`);
    }

    let size = 19;
    const sizeProperty = firstProperty(rootProps, 'SZ');
    if (sizeProperty !== undefined) {
      const parsed = Number.parseInt(String(sizeProperty).split(':')[0], 10);
      if (Number.isInteger(parsed) && parsed >= 2 && parsed <= 25) {
        size = parsed;
      } else {
        warnings.push(`Unsupported board size "${sizeProperty}"; using 19×19.`);
      }
    }

    let board = createBoard(size);

    const applySetupPoints = (identifier, color) => {
      const values = rootProps[identifier] || [];
      for (const value of values) {
        if (String(value).includes(':')) {
          warnings.push('Compressed setup points (aa:cc) are not supported and were skipped.');
          continue;
        }
        const point = decodeSgfPoint(value, size);
        if (!point) {
          warnings.push(`Setup point "${value}" is invalid and was skipped.`);
          continue;
        }
        board[pointIndex(size, point.x, point.y)] = color;
      }
    };

    applySetupPoints('AB', BLACK);
    applySetupPoints('AW', WHITE);
    applySetupPoints('AE', EMPTY);

    const setupBoard = cloneBoard(board);
    const placeProperty = firstProperty(rootProps, 'PL');
    let turn = placeProperty === 'W' ? WHITE : BLACK;

    const info = {
      black: firstProperty(rootProps, 'PB') || '',
      blackRank: firstProperty(rootProps, 'BR') || '',
      white: firstProperty(rootProps, 'PW') || '',
      whiteRank: firstProperty(rootProps, 'WR') || '',
      result: firstProperty(rootProps, 'RE') || '',
      komi: firstProperty(rootProps, 'KM') || '6.5',
      handicap: firstProperty(rootProps, 'HA') || '0',
      rules: firstProperty(rootProps, 'RU') || 'Japanese',
      date: firstProperty(rootProps, 'DT') || '',
      event: firstProperty(rootProps, 'EV') || '',
      place: firstProperty(rootProps, 'PC') || '',
      comment: firstProperty(rootProps, 'C') || '',
    };

    const moves = [];
    const positions = [cloneBoard(board)];
    let ko = null;

    for (const gameNode of gameLine) {
      if (gameNode !== rootNode) {
        for (const identifier of ['AB', 'AW', 'AE']) {
          if (gameNode.props[identifier]) {
            warnings.push('Setup properties after the root node were ignored.');
            break;
          }
        }
      }

      const blackValue = firstProperty(gameNode.props, 'B');
      const whiteValue = firstProperty(gameNode.props, 'W');
      let color = EMPTY;
      let value;
      if (blackValue !== undefined) {
        color = BLACK;
        value = blackValue;
      } else if (whiteValue !== undefined) {
        color = WHITE;
        value = whiteValue;
      } else {
        continue;
      }

      if (color !== turn) {
        warnings.push(`Move ${moves.length + 1} is ${colorName(color)} but the previous move ended ${colorName(turn)}'s turn.`);
      }

      const move = {
        color,
        pass: false,
        x: null,
        y: null,
        comment: firstProperty(gameNode.props, 'C') || '',
      };

      const isPass = value === '' || (value === 'tt' && size <= 19);
      if (isPass) {
        move.pass = true;
        moves.push(move);
        turn = other(color);
        ko = null;
        positions.push(cloneBoard(board));
        continue;
      }

      const point = decodeSgfPoint(value, size);
      if (!point) {
        warnings.push(`Move ${moves.length + 1} has the invalid point "${value}" and the rest of the game was skipped.`);
        break;
      }

      const result = tryMove(board, size, point.x, point.y, color, ko);
      if (!result.ok) {
        warnings.push(
          `Move ${moves.length + 1} (${colorName(color)} ${coordinateLabel(point.x, point.y, size)}) ` +
          `is illegal: ${result.error} The rest of the game was skipped.`,
        );
        break;
      }

      let nextKo = null;
      if (result.captured.length === 1) {
        const twoPliesBack = positions[positions.length - 2];
        if (twoPliesBack && boardsEqual(result.board, twoPliesBack)) {
          nextKo = result.ko;
        }
      }

      board = result.board;
      ko = nextKo;
      turn = other(color);
      move.x = point.x;
      move.y = point.y;
      moves.push(move);
      positions.push(cloneBoard(board));
    }

    if (variationCount > 0) {
      warnings.push(
        `The SGF contains ${variationCount} variation${variationCount === 1 ? '' : 's'}; ` +
        'only the main line was loaded.',
      );
    }

    return {
      size,
      setupBoard,
      rootTurn: placeProperty === 'W' ? WHITE : BLACK,
      info,
      moves,
      warnings,
    };
  }

  function writeSgf(game) {
    const size = game.size;
    const info = game.info || {};
    const root = [];

    const add = (identifier, value) => {
      if (value === undefined || value === null || value === '') return;
      root.push(sgfProperty(identifier, value));
    };

    add('GM', '1');
    add('FF', '4');
    add('CA', 'UTF-8');
    add('AP', 'MultiGo Neo:1.0');
    add('SZ', size);
    add('PB', info.black);
    add('BR', info.blackRank);
    add('PW', info.white);
    add('WR', info.whiteRank);
    add('RE', info.result);
    add('KM', info.komi);
    if (info.handicap !== undefined && info.handicap !== null && String(info.handicap) !== '0') {
      add('HA', info.handicap);
    }
    add('RU', info.rules);
    add('DT', info.date);
    add('EV', info.event);
    add('PC', info.place);
    add('C', info.comment);

    const blackPoints = [];
    const whitePoints = [];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const color = game.setupBoard[pointIndex(size, x, y)];
        if (color === BLACK) blackPoints.push(`[${encodeSgfPoint(x, y)}]`);
        else if (color === WHITE) whitePoints.push(`[${encodeSgfPoint(x, y)}]`);
      }
    }
    if (blackPoints.length) root.push(`AB${blackPoints.join('')}`);
    if (whitePoints.length) root.push(`AW${whitePoints.join('')}`);
    if (game.rootTurn === WHITE) root.push(sgfProperty('PL', 'W'));

    const moveNodes = game.moves.map((move) => {
      const color = move.color === 'B' || move.color === BLACK ? 'B' : 'W';
      const point = move.pass ? '' : encodeSgfPoint(move.x, move.y);
      let result = `;${color}[${point}]`;
      if (move.comment) result += sgfProperty('C', move.comment);
      return result;
    }).join('');

    return `(;${root.join('')}${moveNodes})`;
  }

  return {
    EMPTY,
    BLACK,
    WHITE,
    SIZES,
    LETTERS,
    other,
    colorName,
    createBoard,
    cloneBoard,
    isOnBoard,
    pointIndex,
    coordinateLabel,
    encodeSgfPoint,
    decodeSgfPoint,
    starPoints,
    analyzeGroup,
    tryMove,
    boardsEqual,
    parseSgf,
    writeSgf,
    escapeSgfValue,
  };
});
