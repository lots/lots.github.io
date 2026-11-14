/*
 * GTP helpers shared by the MultiGo Neo renderer and the Node tests.
 *
 * Ported from my-Sabaki's `src/modules/analysis.js` and the coordinate/sync
 * logic of `src/modules/enginesyncer.js`, reduced to the parts MultiGo Neo
 * needs: GTP vertex conversion, kata-analyze / lz-analyze parsing, and the
 * command list that rebuilds a position on an engine.
 *
 * Pure logic only — usable from the renderer (window.EngineCore) and from Node
 * (require('./src/engine-core.js')).
 */
(function (root, factory) {
  'use strict';

  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.EngineCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const GTP_LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

  function parseGtpVertex(coord, width, height = width) {
    const text = String(coord ?? '').trim();
    if (!text) return null;
    if (text.toLowerCase() === 'pass') return [-1, -1];
    const match = /^([A-Za-z])(\d{1,2})$/.exec(text);
    if (!match) return null;
    const x = GTP_LETTERS.indexOf(match[1].toUpperCase());
    const row = Number(match[2]);
    if (x < 0 || x >= width || !Number.isInteger(row)) return null;
    const y = height - row;
    if (y < 0 || y >= height) return null;
    return [x, y];
  }

  function formatGtpVertex(x, y, width, height = width) {
    if (x < 0 || y < 0) return 'pass';
    if (x >= width || y >= height) return null;
    return `${GTP_LETTERS[x]}${height - y}`;
  }

  // KataGo's kata-analyze reports a float in [0,1]; the Leela-Zero dialect
  // reports an integer in ten-thousandths. Normalise both to a percentage.
  function normalizeWinrate(winrate, format) {
    const value = Number(winrate);
    if (!Number.isFinite(value)) return null;
    const isFloat = format == null ? String(winrate).includes('.') : format === 'float';
    const percent = isFloat ? value * 100 : value / 100;
    return Math.max(0, Math.min(100, percent));
  }

  // Parses one streamed analysis line, which may contain several `info ...`
  // segments (KataGo emits the best moves first). Returns an array of
  // {move, visits, winrate, scoreLead, pvs}. `move` and `pvs` are [x, y]
  // pairs; pvs[0] is the analysed move itself.
  function parseAnalysisLine(line, width, height = width, winrateFormat) {
    const text = String(line ?? '');
    const segments = text.split(/\s*info\s+/).slice(1);
    const variations = [];

    for (const raw of segments) {
      const segment = raw.trim();
      // The trailing tokens are the principal variation: coordinates or "pass".
      const pvMatch = segment.match(/(pass|[A-Za-z]\d+)(\s+(pass|[A-Za-z]\d+))*$/);
      if (!pvMatch) continue;

      const passIndex = pvMatch[0].indexOf('pass');
      const pvText = passIndex < 0 ? pvMatch[0] : pvMatch[0].slice(0, passIndex);
      const pv = pvText
        .split(/\s+/)
        .filter((token) => token.length >= 2)
        .map((token) => parseGtpVertex(token, width, height))
        .filter(Boolean);
      if (pv.length === 0) continue;

      const tokens = segment.slice(0, pvMatch.index).trim().split(/\s+/).filter(Boolean);
      tokens.push('pv');
      const fields = {};
      for (let index = 0; index + 1 < tokens.length; index += 2) {
        fields[tokens[index]] = tokens[index + 1];
      }

      if (fields.move == null || fields.winrate == null) continue;
      const move = parseGtpVertex(fields.move, width, height);
      if (!move) continue;

      const visits = Number(fields.visits);
      const scoreLead = fields.scoreLead != null
        ? Number(fields.scoreLead)
        : fields.scoreMean != null
          ? Number(fields.scoreMean)
          : null;

      variations.push({
        move,
        visits: Number.isFinite(visits) ? visits : 0,
        winrate: normalizeWinrate(fields.winrate, winrateFormat),
        scoreLead: Number.isFinite(scoreLead) ? scoreLead : null,
        pvs: pv,
      });
    }

    return variations;
  }

  // The first analysis command the engine advertises, in order of richness.
  function selectAnalysisCommand(commands) {
    const list = Array.isArray(commands) ? commands : [];
    for (const name of ['kata-analyze', 'lz-analyze', 'analyze']) {
      if (list.includes(name)) return name;
    }
    return null;
  }

  // Builds the GTP commands that rebuild `position` from scratch:
  //   boardsize, komi, clear_board, [handicap], setup stones, moves.
  //
  // position = {
  //   width, height, komi, handicap,
  //   handicapPoints: [[x, y], ...],
  //   setup: [{sign: 1|-1, x, y}, ...],
  //   moves: [{sign: 1|-1, x, y} | {sign, pass: true}, ...],
  // }
  function buildSyncCommands(position, { commands = [] } = {}) {
    const width = Number(position.width) || 19;
    const height = Number(position.height) || width;
    const known = new Set(Array.isArray(commands) ? commands : []);
    const result = [];

    if (width === height) {
      result.push({ name: 'boardsize', args: [String(width)] });
    } else {
      // KataGo and Sabaki accept `boardsize W H`; strict GTP engines reject it.
      result.push({ name: 'boardsize', args: [String(width), String(height)] });
    }
    if (position.komi != null && Number.isFinite(Number(position.komi))) {
      result.push({ name: 'komi', args: [String(position.komi)] });
    }
    result.push({ name: 'clear_board', args: [] });

    const setup = Array.isArray(position.setup) ? [...position.setup] : [];
    const handicapPoints = Array.isArray(position.handicapPoints)
      ? position.handicapPoints.filter(Boolean)
      : [];

    if (handicapPoints.length >= 2 && known.has('set_free_handicap')) {
      const coords = handicapPoints
        .map(([x, y]) => formatGtpVertex(x, y, width, height))
        .filter(Boolean);
      if (coords.length >= 2) {
        result.push({ name: 'set_free_handicap', args: coords });
      }
    } else if (
      Number(position.handicap) >= 2
      && handicapPoints.length === 0
      && known.has('fixed_handicap')
    ) {
      result.push({
        name: 'fixed_handicap',
        args: [String(Math.min(9, Math.round(Number(position.handicap))))],
      });
    } else {
      // No handicap command available: replay the stones, as Sabaki does.
      for (const [x, y] of handicapPoints) setup.unshift({ sign: 1, x, y });
    }

    for (const stone of setup) {
      const coord = formatGtpVertex(stone.x, stone.y, width, height);
      if (!coord) continue;
      result.push({
        name: 'play',
        args: [stone.sign > 0 ? 'B' : 'W', coord],
      });
    }

    for (const move of position.moves || []) {
      if (move == null || !move.sign) continue;
      const coord = move.pass ? 'pass' : formatGtpVertex(move.x, move.y, width, height);
      if (!coord) continue;
      result.push({
        name: 'play',
        args: [move.sign > 0 ? 'B' : 'W', coord],
      });
    }

    return result;
  }

  function parseGenmoveResult(content, width, height = width) {
    const text = String(content ?? '').trim();
    if (/^pass$/i.test(text)) return { type: 'pass' };
    if (/^resign$/i.test(text)) return { type: 'resign' };
    const point = parseGtpVertex(text, width, height);
    if (!point) return { type: 'invalid', text };
    return { type: 'move', x: point[0], y: point[1] };
  }

  return {
    GTP_LETTERS,
    parseGtpVertex,
    formatGtpVertex,
    normalizeWinrate,
    parseAnalysisLine,
    selectAnalysisCommand,
    buildSyncCommands,
    parseGenmoveResult,
  };
});
