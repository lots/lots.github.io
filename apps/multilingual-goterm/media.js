/* ============================================================
   GoMedia — image/GIF attachments and a dependency-free SGF
   board preview used by the manager, the printable dictionary
   and the editor.
   ============================================================ */
(function () {
  'use strict';

  var IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp);base64,/i;
  var MAX_IMAGE_CHARS = 3.2 * 1024 * 1024;
  var MAX_SGF_CHARS = 240 * 1024;
  var MAX_ITEMS = 12;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mediaId() {
    return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function normalizeMedia(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (item) {
      if (!item || typeof item !== 'object') return null;
      var type = item.type === 'sgf' ? 'sgf' : 'image';
      var data = String(item.data || '');
      if (type === 'image') {
        if (!IMAGE_RE.test(data) || data.length > MAX_IMAGE_CHARS) return null;
      } else if (!data.trim() || data.length > MAX_SGF_CHARS || data.indexOf('(') === -1) {
        return null;
      }
      return {
        id: String(item.id || mediaId()),
        type: type,
        name: String(item.name || '').trim().slice(0, 120),
        caption: String(item.caption || '').trim().slice(0, 240),
        data: data,
      };
    }).filter(Boolean).slice(0, MAX_ITEMS);
  }

  /* ---------------- SGF parsing ---------------- */

  function parseSgf(text) {
    var source = String(text || '');
    if (!source) return null;

    var size = 19;
    var sizeMatch = source.match(/SZ\s*\[\s*(\d{1,2})\s*\]/i);
    if (sizeMatch) {
      var parsedSize = Number(sizeMatch[1]);
      if (parsedSize >= 2 && parsedSize <= 52) size = parsedSize;
    }

    function coord(value) {
      if (!value || value.length < 2) return null;
      var letters = value.toLowerCase();
      var x = letters.charCodeAt(0) - 97;
      var y = letters.charCodeAt(1) - 97;
      if (x < 0 || y < 0 || x >= size || y >= size) return null;
      return { x: x, y: y };
    }

    var nodes = [];
    var position = 0;
    var length = source.length;

    function skipSpace() {
      while (position < length && /\s/.test(source[position])) position += 1;
    }

    function readValue() {
      if (source[position] !== '[') return '';
      position += 1;
      var out = '';
      while (position < length) {
        var character = source[position];
        position += 1;
        if (character === '\\') {
          out += source[position] || '';
          position += 1;
        } else if (character === ']') {
          break;
        } else {
          out += character;
        }
      }
      return out;
    }

    function readNode() {
      position += 1; // ';'
      var properties = {};
      while (position < length) {
        skipSpace();
        var start = position;
        while (position < length && /[A-Za-z]/.test(source[position])) position += 1;
        if (position === start) break;
        var identity = source.slice(start, position).toUpperCase();
        var values = [];
        while (true) {
          skipSpace();
          if (source[position] !== '[') break;
          values.push(readValue());
        }
        if (!properties[identity]) properties[identity] = [];
        properties[identity] = properties[identity].concat(values);
      }
      return properties;
    }

    function readSequence() {
      var sequence = [];
      while (position < length) {
        skipSpace();
        if (source[position] === ';') sequence.push(readNode());
        else break;
      }
      return sequence;
    }

    function readTree() {
      if (source[position] !== '(') return [];
      position += 1;
      var main = readSequence();
      var children = [];
      while (position < length) {
        skipSpace();
        if (source[position] === '(') children.push(readTree());
        else break;
      }
      skipSpace();
      if (source[position] === ')') position += 1;
      return children.length ? main.concat(children[0]) : main;
    }

    var start = source.indexOf('(');
    if (start !== -1) {
      try {
        position = start;
        nodes = readTree();
      } catch (error) {
        nodes = [];
      }
    }
    if (!nodes.length) {
      // Fallback for fragments or malformed files: take the visible moves.
      var movePattern = /;\s*([BW])\s*\[\s*([a-z]{2})\s*\]/gi;
      var match;
      while ((match = movePattern.exec(source))) {
        var node = {};
        node[match[1].toUpperCase()] = [match[2]];
        nodes.push(node);
      }
    }

    var board = [];
    for (var y = 0; y < size; y += 1) {
      board.push([]);
      for (var x = 0; x < size; x += 1) board[y].push(0);
    }

    function neighbors(x, y) {
      return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(function (point) {
        return point[0] >= 0 && point[1] >= 0 && point[0] < size && point[1] < size;
      });
    }

    function collectGroup(x, y) {
      var color = board[y][x];
      if (!color) return null;
      var seen = {};
      var stones = [];
      var liberties = {};
      var stack = [[x, y]];
      seen[x + ',' + y] = true;
      while (stack.length) {
        var point = stack.pop();
        stones.push(point);
        neighbors(point[0], point[1]).forEach(function (next) {
          var nx = next[0];
          var ny = next[1];
          if (board[ny][nx] === 0) liberties[nx + ',' + ny] = true;
          else if (board[ny][nx] === color && !seen[nx + ',' + ny]) {
            seen[nx + ',' + ny] = true;
            stack.push([nx, ny]);
          }
        });
      }
      return { stones: stones, liberties: Object.keys(liberties).length };
    }

    function removeGroup(group) {
      group.stones.forEach(function (point) { board[point[1]][point[0]] = 0; });
    }

    function place(x, y, color) {
      if (board[y][x]) return false;
      board[y][x] = color;
      var opponent = color === 1 ? 2 : 1;
      neighbors(x, y).forEach(function (point) {
        if (board[point[1]][point[0]] === opponent) {
          var group = collectGroup(point[0], point[1]);
          if (group && group.liberties === 0) removeGroup(group);
        }
      });
      var own = collectGroup(x, y);
      if (own && own.liberties === 0) {
        removeGroup(own);
        return false;
      }
      return true;
    }

    var moves = 0;
    var last = null;

    nodes.forEach(function (node) {
      var setupBlack = node.AB || [];
      var setupWhite = node.AW || [];
      setupBlack.forEach(function (value) {
        var point = coord(value);
        if (point) board[point.y][point.x] = 1;
      });
      setupWhite.forEach(function (value) {
        var point = coord(value);
        if (point) board[point.y][point.x] = 2;
      });
      if (node.B && node.B.length) {
        var black = coord(node.B[0]);
        if (black && place(black.x, black.y, 1)) { moves += 1; last = { x: black.x, y: black.y, color: 1 }; }
      }
      if (node.W && node.W.length) {
        var white = coord(node.W[0]);
        if (white && place(white.x, white.y, 2)) { moves += 1; last = { x: white.x, y: white.y, color: 2 }; }
      }
    });

    return { size: size, board: board, moves: moves, last: last };
  }

  function starPoints(size) {
    if (size === 19) return [[3, 3], [9, 3], [15, 3], [3, 9], [9, 9], [15, 9], [3, 15], [9, 15], [15, 15]];
    if (size === 13) return [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6], [3, 6], [9, 6], [6, 3], [6, 9]];
    if (size === 9) return [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]];
    return [];
  }

  function sgfBoardSvg(text, pixelSize, options) {
    var parsed = parseSgf(text);
    if (!parsed) return '';
    var size = parsed.size;
    var unit = 100 / (size + 1);
    var origin = unit;
    var span = unit * (size - 1);
    var radius = Math.max(1.1, unit * 0.47);
    var pixel = Number(pixelSize) || 0;
    var attrs = pixel ? ' width="' + pixel + '" height="' + pixel + '"' : '';
    var title = 'SGF diagram · ' + parsed.moves + ' moves';
    var parts = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"' + attrs +
        ' role="img" aria-label="' + esc(title) + '" class="sgf-board">',
      '<title>' + esc(title) + '</title>',
      '<rect x="0" y="0" width="100" height="100" rx="3" fill="#e7c98f"/>',
    ];

    for (var line = 0; line < size; line += 1) {
      var at = origin + line * unit;
      parts.push('<line x1="' + origin + '" y1="' + at + '" x2="' + (origin + span) + '" y2="' + at +
        '" stroke="#6b4b24" stroke-width="0.35" opacity="0.65"/>');
      parts.push('<line x1="' + at + '" y1="' + origin + '" x2="' + at + '" y2="' + (origin + span) +
        '" stroke="#6b4b24" stroke-width="0.35" opacity="0.65"/>');
    }

    starPoints(size).forEach(function (point) {
      parts.push('<circle cx="' + (origin + point[0] * unit) + '" cy="' + (origin + point[1] * unit) +
        '" r="0.8" fill="#4d3517" opacity="0.8"/>');
    });

    for (var y = 0; y < size; y += 1) {
      for (var x = 0; x < size; x += 1) {
        var color = parsed.board[y][x];
        if (!color) continue;
        parts.push('<circle cx="' + (origin + x * unit) + '" cy="' + (origin + y * unit) + '" r="' + radius +
          '" fill="' + (color === 1 ? '#1b1b1b' : '#fbf7ea') + '" stroke="' +
          (color === 1 ? '#000' : '#4a4132') + '" stroke-width="0.25"/>');
      }
    }

    if (parsed.last) {
      var lastColor = parsed.last.color === 1 ? '#f5e9c8' : '#1b1b1b';
      parts.push('<circle cx="' + (origin + parsed.last.x * unit) + '" cy="' + (origin + parsed.last.y * unit) +
        '" r="' + (radius * 0.28) + '" fill="' + lastColor + '"/>');
    }

    parts.push('</svg>');
    return parts.join('');
  }

  function mediaThumbHtml(media, pixelSize) {
    if (!media) return '';
    if (media.type === 'sgf') return sgfBoardSvg(media.data, pixelSize || 0);
    return '<img src="' + esc(media.data) + '" alt="' + esc(media.caption || media.name || 'diagram') +
      '" loading="lazy">';
  }

  function describeMedia(media) {
    if (!media) return '';
    if (media.type === 'sgf') {
      var parsed = parseSgf(media.data);
      return 'SGF · ' + (parsed ? parsed.moves : 0) + ' moves';
    }
    return 'Image · ' + (media.name || 'diagram');
  }

  window.GoMedia = {
    normalizeMedia: normalizeMedia,
    parseSgf: parseSgf,
    sgfBoardSvg: sgfBoardSvg,
    mediaThumbHtml: mediaThumbHtml,
    describeMedia: describeMedia,
    mediaId: mediaId,
  };
})();
