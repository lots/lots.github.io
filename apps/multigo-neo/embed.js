/* MultiGo Neo — zero-JavaScript embeddable SGF viewer.
 *
 * Host markup (no per-widget script):
 *   <div data-multigo
 *        data-sgf="(;FF[4]GM[1]SZ[9]...)"
 *        data-path="B1B2"
 *        data-theme="dark"
 *        data-coords
 *        data-variations></div>
 *
 * Include sabaki-bundle.js, path-spec.js and this file once; every
 * [data-multigo] element is initialised automatically.
 */
(function () {
  'use strict';

  const S = window.SabakiLibs;
  if (!S) {
    document.body.insertAdjacentHTML('beforeend', '<p>MultiGo Neo libraries failed to load.</p>');
    return;
  }

  const THEMES = ['classic', 'flat', 'dark', 'paper'];
  const DISPLAY_LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
  const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';
  const DEFAULTS = {
    surface: '#d7a760', line: 'rgba(38,22,5,.86)', lineWidth: 1,
    star: 'rgba(37,22,5,.8)', label: 'rgba(61,39,13,.8)',
    blackHi: '#6f6f6f', blackMid: '#292929', blackLow: '#000',
    whiteHi: '#fff', whiteMid: '#f2f2f2', whiteLow: '#c9c9c9', whiteEdge: 'rgba(0,0,0,.28)',
    variant: '#be0119', last: '#0165fc', backer: 'rgba(255,248,235,.82)', halo: 'rgba(255,255,255,.88)',
  };

  let nextId = 1;
  const getId = () => nextId++;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const instances = [];

  function readPalette(element) {
    const style = getComputedStyle(element);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    return {
      surface: read('--board-surface', DEFAULTS.surface),
      line: read('--board-line', DEFAULTS.line),
      lineWidth: Number.parseFloat(read('--board-line-width', '1')) || 1,
      star: read('--board-star', DEFAULTS.star),
      label: read('--board-label', DEFAULTS.label),
      blackHi: read('--stone-black-hi', DEFAULTS.blackHi),
      blackMid: read('--stone-black-mid', DEFAULTS.blackMid),
      blackLow: read('--stone-black-low', DEFAULTS.blackLow),
      whiteHi: read('--stone-white-hi', DEFAULTS.whiteHi),
      whiteMid: read('--stone-white-mid', DEFAULTS.whiteMid),
      whiteLow: read('--stone-white-low', DEFAULTS.whiteLow),
      whiteEdge: read('--stone-white-edge', DEFAULTS.whiteEdge),
      variant: read('--overlay-variant', DEFAULTS.variant),
      last: read('--overlay-last', DEFAULTS.last),
      backer: read('--overlay-backer', DEFAULTS.backer),
      halo: read('--overlay-halo', DEFAULTS.halo),
    };
  }

  function hashPoint(x, y) {
    let hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return (hash ^ (hash >>> 16)) >>> 0;
  }

  function rand01(seed, salt) {
    let value = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
    value = Math.imul(value ^ (value >>> 15), 0x85ebca6b) >>> 0;
    value ^= value >>> 13;
    return (value >>> 0) / 4294967296;
  }

  function starPoints(width, height) {
    if (width < 7 || height < 7) return [];
    const edgeX = width >= 13 ? 3 : 2;
    const edgeY = height >= 13 ? 3 : 2;
    const xs = [edgeX, width - 1 - edgeX];
    const ys = [edgeY, height - 1 - edgeY];
    const points = new Map();
    const add = (x, y) => {
      if (!Number.isInteger(x) || !Number.isInteger(y)) return;
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      points.set(`${x},${y}`, { x, y });
    };
    for (const x of xs) for (const y of ys) add(x, y);
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    if (Number.isInteger(cx) && Number.isInteger(cy)) add(cx, cy);
    if (width >= 19 || height >= 19) {
      if (Number.isInteger(cy)) for (const x of xs) add(x, cy);
      if (Number.isInteger(cx)) for (const y of ys) add(cx, y);
    }
    return [...points.values()];
  }

  function movePoint(node) {
    const value = (node?.data?.B || node?.data?.W)?.[0];
    if (!value) return null;
    const [x, y] = S.sgf.parseVertex(value);
    return x >= 0 && y >= 0 ? { x, y, sign: node.data.B ? 1 : -1 } : null;
  }

  function initWidget(element) {
    if (element.dataset.multigoReady) return;
    element.dataset.multigoReady = 'true';
    element.classList.add('multigo-widget');

    const theme = THEMES.includes(element.dataset.theme) ? element.dataset.theme : 'classic';
    element.classList.add(`theme-${theme}`);
    if (element.dataset.width) element.style.maxWidth = `${Number(element.dataset.width) || 620}px`;

    const size = Number(element.dataset.size) || 19;
    const fallbackSgf = `(;FF[4]GM[1]SZ[${clamp(size, 2, 52)}])`;
    const text = element.dataset.sgf || fallbackSgf;
    let roots;
    try {
      roots = S.sgf.parse(text, { getId });
    } catch (error) {
      element.textContent = `Invalid SGF: ${error.message}`;
      return;
    }
    if (!roots.length) { element.textContent = 'The SGF contains no games.'; return; }

    let tree;
    try {
      tree = new S.GameTree({ root: roots[0], getId, merger: S.nodeMerger });
    } catch (error) {
      element.textContent = `Could not build the game tree: ${error.message}`;
      return;
    }

    let nodeId = tree.root.id;
    if (element.dataset.path && window.MultiGoPath) {
      nodeId = window.MultiGoPath.resolve(element.dataset.path, tree, tree.root.id) ?? nodeId;
    }

    const stage = document.createElement('div');
    stage.className = 'multigo-stage';
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', element.dataset.label || 'Go board');
    stage.append(canvas);
    element.append(stage);

    const controls = element.dataset.controls !== 'false';
    let bar = null;
    let status = null;
    const buttons = {};
    if (controls) {
      bar = document.createElement('div');
      bar.className = 'multigo-bar';
      const makeButton = (label, title, action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.title = title;
        button.addEventListener('click', action);
        bar.append(button);
        return button;
      };
      buttons.first = makeButton('«', 'First move', () => goTo(tree.root.id));
      buttons.prev = makeButton('‹', 'Previous node', () => goToParent());
      buttons.next = makeButton('›', 'Next move', () => goToChild());
      buttons.last = makeButton('»', 'End of variation', () => goToEnd());
      const spacer = document.createElement('span');
      spacer.className = 'multigo-spacer';
      bar.append(spacer);
      status = document.createElement('span');
      status.className = 'multigo-status';
      bar.append(status);
      element.append(bar);
    }

    const coords = (() => {
      if (!element.hasAttribute('data-coords')) return null;
      const value = element.getAttribute('data-coords');
      if (value === 'false' || value === 'off') return null;
      return value === '1-1' ? '1-1' : 'A1';
    })();
    const showVariations = element.hasAttribute('data-variations')
      && element.getAttribute('data-variations') !== 'false';

    const context = canvas.getContext('2d');
    const view = { width: 0, height: 0, margin: 0, spacing: 0, dpr: 1, cols: 19, rows: 19 };
    let board = null;
    let hover = null;
    let frame = 0;
    let lastWidth = 0;

    function position(x, y) {
      return { x: view.margin + x * view.spacing, y: view.margin + y * view.spacing };
    }

    const colors = readPalette(element);

    function resize() {
      if (!board) return;
      const stageWidth = Math.max(140, stage.clientWidth || element.clientWidth || 320);
      if (stageWidth === lastWidth) return;
      lastWidth = stageWidth;
      const cols = board.width;
      const rows = board.height;
      const margin = Math.max(14, Math.round(stageWidth * 0.055));
      const spacing = Math.max(4, (stageWidth - margin * 2) / Math.max(1, cols - 1));
      const cssHeight = Math.max(80, Math.round((rows - 1) * spacing + margin * 2));
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      canvas.style.height = `${cssHeight}px`;
      const backingWidth = Math.round(stageWidth * dpr);
      const backingHeight = Math.round(cssHeight * dpr);
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      Object.assign(view, { width: stageWidth, height: cssHeight, margin, spacing, dpr, cols, rows });
      draw();
    }

    function scheduleDraw() {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; draw(); });
    }

    function drawStone(x, y, sign, radius, alpha = 1, detail = true) {
      
      const { x: px, y: py } = position(x, y);
      const seed = hashPoint(x, y);
      const ghost = alpha < 0.8;
      context.save();
      context.globalAlpha = alpha;
      context.shadowColor = ghost ? 'rgba(0,0,0,.12)' : 'rgba(0,0,0,.3)';
      context.shadowBlur = ghost ? Math.max(1, radius * 0.1) : Math.max(2, radius * 0.3);
      context.shadowOffsetY = ghost ? Math.max(0.5, radius * 0.03) : Math.max(1, radius * 0.08);
      context.beginPath();
      context.arc(px, py, radius, 0, Math.PI * 2);
      if (sign > 0) {
        const gradient = context.createRadialGradient(
          px - radius * (0.26 + rand01(seed, 1) * 0.14),
          py - radius * (0.3 + rand01(seed, 2) * 0.14),
          radius * 0.12, px, py, radius * 1.1,
        );
        gradient.addColorStop(0, colors.blackHi);
        gradient.addColorStop(0.36, colors.blackMid);
        gradient.addColorStop(1, colors.blackLow);
        context.fillStyle = gradient;
        context.fill();
      } else {
        const gradient = context.createRadialGradient(
          px - radius * 0.32, py - radius * 0.36, radius * 0.15,
          px, py, radius * 1.05,
        );
        gradient.addColorStop(0, colors.whiteHi);
        gradient.addColorStop(0.65, colors.whiteMid);
        gradient.addColorStop(1, colors.whiteLow);
        context.fillStyle = gradient;
        context.fill();
        context.shadowColor = 'transparent';
        context.lineWidth = Math.max(0.7, radius * 0.055);
        context.strokeStyle = colors.whiteEdge;
        context.stroke();
      }
      if (detail && alpha > 0.95 && radius > 8) {
        const flecks = 3 + (seed % 3);
        context.shadowColor = 'transparent';
        context.save();
        context.beginPath();
        context.arc(px, py, radius * 0.96, 0, Math.PI * 2);
        context.clip();
        for (let i = 0; i < flecks; i += 1) {
          const angle = rand01(seed, i * 3 + 3) * Math.PI * 2;
          const distance = radius * (0.16 + rand01(seed, i * 3 + 4) * 0.64);
          const dot = radius * (0.025 + rand01(seed, i * 3 + 5) * 0.04);
          context.fillStyle = sign > 0
            ? `rgba(200,205,210,${0.03 + rand01(seed, i + 9) * 0.04})`
            : `rgba(150,140,120,${0.035 + rand01(seed, i + 9) * 0.035})`;
          context.beginPath();
          context.arc(px + Math.cos(angle) * distance, py + Math.sin(angle) * distance, dot, 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
      }
      context.restore();
    }

    function drawBadge(x, y, letter, sign, radius) {
      const { x: px, y: py } = position(x, y);
      const black = sign > 0;
      const ink = black ? 'rgba(0, 0, 0, 0.62)' : 'rgba(255, 255, 255, 0.88)';
      const halo = black ? 'rgba(255, 255, 255, 0.95)' : 'rgba(0, 0, 0, 0.7)';
      context.save();
      context.font = `700 ${Math.max(10, Math.round(radius * 0.84))}px ${FONT}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineWidth = Math.max(2.2, radius * 0.18);
      context.strokeStyle = halo;
      context.strokeText(letter, px, py);
      context.fillStyle = ink;
      context.fillText(letter, px, py);
      context.restore();
    }

    function drawLastTriangle(x, y, color, radius) {
      const { x: px, y: py } = position(x, y);
      const offset = radius * 0.55;
      const size = Math.max(3.5, radius * 0.4);
      const cx = px + offset;
      const cy = py - offset;
      context.save();
      context.beginPath();
      context.moveTo(cx, cy - size * 0.8);
      context.lineTo(cx - size * 0.72, cy + size * 0.55);
      context.lineTo(cx + size * 0.72, cy + size * 0.55);
      context.closePath();
      context.fillStyle = color;
      context.fill();
      context.strokeStyle = colors.halo;
      context.lineWidth = 1;
      context.stroke();
      context.restore();
    }

    function draw() {
      if (!board || !view.width) return;
      
      const { cols, rows, spacing, margin } = view;
      context.clearRect(0, 0, view.width, view.height);
      context.strokeStyle = colors.line;
      context.lineWidth = colors.lineWidth;
      for (let i = 0; i < cols; i += 1) {
        const x = margin + i * spacing;
        context.beginPath();
        context.moveTo(x, margin);
        context.lineTo(x, margin + (rows - 1) * spacing);
        context.stroke();
      }
      for (let i = 0; i < rows; i += 1) {
        const y = margin + i * spacing;
        context.beginPath();
        context.moveTo(margin, y);
        context.lineTo(margin + (cols - 1) * spacing, y);
        context.stroke();
      }
      context.fillStyle = colors.star;
      for (const star of starPoints(cols, rows)) {
        const { x, y } = position(star.x, star.y);
        context.beginPath();
        context.arc(x, y, Math.max(1.6, spacing * 0.075), 0, Math.PI * 2);
        context.fill();
      }

      if (coords) {
        const fontSize = Math.max(8, Math.min(12, Math.round(view.width * 0.0155)));
        context.font = `500 ${fontSize}px ${FONT}`;
        context.fillStyle = colors.label;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        for (let x = 0; x < cols; x += 1) {
          const label = coords === '1-1' ? String(x + 1) : DISPLAY_LETTERS[x] || '?';
          context.fillText(label, margin + x * spacing, margin * 0.5);
          context.fillText(label, margin + x * spacing, margin + (rows - 1) * spacing + margin * 0.5);
        }
        for (let y = 0; y < rows; y += 1) {
          const label = coords === '1-1' ? String(y + 1) : String(rows - y);
          context.fillText(label, margin * 0.5, margin + y * spacing);
          context.fillText(label, margin + (cols - 1) * spacing + margin * 0.5, margin + y * spacing);
        }
      }

      const radius = spacing * 0.465;
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const sign = board.signMap[y]?.[x] ?? 0;
          if (sign) drawStone(x, y, sign, radius);
        }
      }

      const node = tree.get(nodeId);
      const last = movePoint(node);
      if (last) drawLastTriangle(last.x, last.y, colors.variant, radius);

      if (showVariations && node) {
        let index = 0;
        for (const child of node.children) {
          const point = movePoint(child);
          if (!point) continue;
          drawStone(point.x, point.y, point.sign, radius * 0.82, 0.3, false);
          drawBadge(point.x, point.y, String.fromCharCode(65 + (index % 26)), point.sign, radius);
          index += 1;
        }
      }

      if (hover && !board.get([hover.x, hover.y])) {
        drawStone(hover.x, hover.y, S.getPlayer(tree, nodeId), radius, 0.36, false);
      }
    }

    function goTo(id) {
      if (!tree.get(id) || id === nodeId) return;
      nodeId = id;
      board = S.getBoard(tree, nodeId);
      hover = null;
      draw();
      updateBar();
    }

    function goToParent() {
      const node = tree.get(nodeId);
      if (node?.parentId != null) goTo(node.parentId);
    }

    function goToChild() {
      const node = tree.get(nodeId);
      if (node?.children.length) goTo(node.children[0].id);
    }

    function goToEnd() {
      let node = tree.get(nodeId);
      while (node?.children.length) node = tree.get(node.children[0].id);
      if (node) goTo(node.id);
    }

    function updateBar() {
      if (!bar) return;
      const node = tree.get(nodeId);
      if (!node) return;
      buttons.first.disabled = node.parentId == null;
      buttons.prev.disabled = node.parentId == null;
      buttons.next.disabled = node.children.length === 0;
      buttons.last.disabled = node.children.length === 0;
      const turn = S.getPlayer(tree, nodeId) > 0 ? 'Black' : 'White';
      status.textContent = `Move ${S.getMoveNumber(tree, nodeId)} · ${turn} to play`;
    }

    function pointFromEvent(event) {
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const gx = Math.round((px - view.margin) / view.spacing);
      const gy = Math.round((py - view.margin) / view.spacing);
      if (gx < 0 || gy < 0 || gx >= view.cols || gy >= view.rows) return null;
      if (Math.abs(px - (view.margin + gx * view.spacing)) > view.spacing * 0.52) return null;
      if (Math.abs(py - (view.margin + gy * view.spacing)) > view.spacing * 0.52) return null;
      return { x: gx, y: gy };
    }

    canvas.addEventListener('pointermove', (event) => {
      const point = pointFromEvent(event);
      const same = (point && hover && point.x === hover.x && point.y === hover.y) || (!point && !hover);
      if (same) return;
      hover = point;
      scheduleDraw();
    });
    canvas.addEventListener('pointerleave', () => {
      if (!hover) return;
      hover = null;
      scheduleDraw();
    });
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const point = pointFromEvent(event);
      if (!point) return;
      event.preventDefault();
      const node = tree.get(nodeId);
      const child = node?.children.find((candidate) => {
        const move = movePoint(candidate);
        return move && move.x === point.x && move.y === point.y;
      });
      if (child) goTo(child.id);
    });
    canvas.addEventListener('wheel', (event) => {
      if (event.deltaY > 0) goToChild();
      else if (event.deltaY < 0) goToParent();
      event.preventDefault();
    }, { passive: false });
    canvas.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        goToParent();
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        goToChild();
      } else if (event.key === 'Home') {
        event.preventDefault();
        goTo(tree.root.id);
      } else if (event.key === 'End') {
        event.preventDefault();
        goToEnd();
      }
    });

    board = S.getBoard(tree, nodeId);
    updateBar();
    new ResizeObserver(() => resize()).observe(stage);
    resize();

    const instance = {
      element,
      tree,
      get nodeId() { return nodeId; },
      goTo,
      snapshot: () => ({
        nodeId,
        moveNumber: S.getMoveNumber(tree, nodeId),
        width: board.width,
        height: board.height,
        nodes: [...tree.listNodes()].length,
      }),
    };
    instances.push(instance);
    element.multigoWidget = instance;
  }

  function initAll(root = document) {
    for (const element of root.querySelectorAll('[data-multigo]:not([data-multigo-ready])')) initWidget(element);
  }

  window.MultiGoEmbed = { init: initWidget, initAll, instances };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initAll());
  else initAll();
}());

