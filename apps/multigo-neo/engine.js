/* MultiGo Neo — GTP engine panel and controller.
 *
 * Ported from my-Sabaki's engine stack: the engine list, attach/detach, board
 * synchronisation, genmove, kata-analyze / lz-analyze parsing and the GTP
 * console. The protocol itself lives in electron/gtp.js; the pure helpers are
 * in src/engine-core.js, which is also what scripts/test-gtp.js exercises.
 */
(() => {
  'use strict';

  const S = window.SabakiLibs;
  const core = window.EngineCore;
  const desktop = window.figdesk ?? null;

  const state = {
    engines: [],
    selectedId: null,
    session: null,
    analysisEnabled: true,
    analysis: null,
    analysisActive: false,
    analysisSign: 1,
    analysisCommandId: 0,
    position: null,
    lastSignature: '',
    syncToken: 0,
    syncing: false,
    pendingSync: false,
    consoleLines: [],
    draftEngines: [],
    initialized: false,
    syncTimer: null,
    configPath: null,
    attaching: false,
    engineColor: 'off',
    autoBusy: false,
    autoTimer: null,
    generating: false,
  };

  let deps = null;
  const els = {};
  let rafId = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function errorMessage(error) {
    const text = String(error?.message ?? error ?? 'Unknown engine error.');
    return text.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
  }

  function idForEngine() {
    return `eng-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function basename(value) {
    return String(value || '').split(/[\\/]/).pop() || '';
  }

  function sanitizeEngines(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((engine) => engine && typeof engine === 'object')
      .map((engine) => {
        const path = String(engine.path ?? '').trim();
        return {
          id: typeof engine.id === 'string' && engine.id ? engine.id : idForEngine(),
          name: String(engine.name ?? '').trim(),
          path,
          file: typeof engine.file === 'string' && engine.file ? engine.file : path,
          original: typeof engine.original === 'string' && engine.original ? engine.original : path,
          args: String(engine.args ?? ''),
          commands: String(engine.commands ?? ''),
          cwd: typeof engine.cwd === 'string' ? engine.cwd : '',
        };
      })
      .filter((engine) => engine.path);
  }

  async function loadConfig({ quiet = false } = {}) {
    if (!desktop?.engineConfig) return false;
    try {
      const config = await desktop.engineConfig.load();
      state.configPath = config.path;
      state.engines = sanitizeEngines(config.engines).map((engine) => ({
        ...engine,
        original: engine.path,
      }));
      if (!state.engines.some((engine) => engine.id === state.selectedId)) {
        state.selectedId = state.engines[0]?.id ?? null;
      }
      const settings = deps.getSettings();
      settings.engines = state.engines;
      settings.selectedEngineId = state.selectedId;
      deps.saveSettings();
      refreshSelect();
      refreshPanel();
      if (!quiet) {
        deps.log(`Loaded ${state.engines.length} engine${state.engines.length === 1 ? '' : 's'} from ${config.path}.`);
      }
      return true;
    } catch (error) {
      if (!quiet) deps.log(`Could not read the engine configuration: ${errorMessage(error)}`, 'error');
      return false;
    }
  }

  function selectedEngine() {
    return state.engines.find((engine) => engine.id === state.selectedId) ?? null;
  }

  function engineLabel(engine) {
    return engine.name || basename(engine.path) || 'Unnamed engine';
  }

  function engineColorSign() {
    return state.engineColor === 'B' ? 1 : state.engineColor === 'W' ? -1 : 0;
  }

  function engineColorName() {
    return state.engineColor === 'B' ? 'Black' : state.engineColor === 'W' ? 'White' : 'Off';
  }

  // Position ------------------------------------------------------------

  function expandVertices(values) {
    const result = [];
    for (const value of values ?? []) {
      try {
        for (const vertex of S.sgf.parseCompressedVertices(value)) {
          if (Array.isArray(vertex) && vertex.length >= 2) result.push(vertex);
        }
      } catch { /* ignore malformed SGF */ }
    }
    return result;
  }

  function collectPosition() {
    const tree = deps.getTree();
    const id = deps.getNodeId();
    if (!tree || id == null) return null;
    const info = S.getGameInfo(tree);
    const width = info.size?.[0] || 19;
    const height = info.size?.[1] || width;
    const path = S.getPath(tree, id);
    const handicap = info.handicap || 0;
    const moves = [];
    const setup = [];
    let handicapPoints = [];

    path.forEach((node, index) => {
      const ab = expandVertices(node.data.AB);
      const aw = expandVertices(node.data.AW);
      if (index === 0 && handicap >= 2 && ab.length >= 2) {
        handicapPoints = ab;
      } else {
        for (const [x, y] of ab) setup.push({ sign: 1, x, y });
        for (const [x, y] of aw) setup.push({ sign: -1, x, y });
      }

      for (const prop of ['B', 'W']) {
        const values = node.data[prop];
        if (!values) continue;
        const sign = prop === 'B' ? 1 : -1;
        for (const value of values) {
          if (value === '' || (value === 'tt' && width <= 19 && height <= 19)) {
            moves.push({ sign, pass: true });
            continue;
          }
          for (const [x, y] of expandVertices([value])) {
            moves.push({ sign, x, y });
          }
        }
      }
    });

    return {
      width,
      height,
      komi: info.komi ?? deps.getSettings().defaultKomi ?? 0,
      handicap,
      handicapPoints,
      setup,
      moves,
      toMove: S.getPlayer(tree, id),
    };
  }

  function positionSignature(position) {
    if (!position) return '';
    return JSON.stringify(position);
  }

  // Sending -------------------------------------------------------------

  async function sendTo(session, command, options = {}) {
    if (!session || state.session !== session) {
      throw new Error('That engine is no longer attached.');
    }
    if (!options.stream) state.analysis = null;
    const response = await desktop.engine.send({
      engineId: session.id,
      command,
      options,
    });
    if (!response || response.ok !== true) {
      throw new Error(response?.content || `${command.name} failed.`);
    }
    return response;
  }

  function send(command, options = {}) {
    return sendTo(state.session, command, options);
  }

  function appendConsole(text) {
    state.consoleLines.push(String(text));
    if (state.consoleLines.length > 400) {
      state.consoleLines.splice(0, state.consoleLines.length - 400);
    }
    if (els.consoleLog) {
      els.consoleLog.textContent = state.consoleLines.join('\n');
      els.consoleLog.scrollTop = els.consoleLog.scrollHeight;
    }
  }

  async function handshake(session) {
    // Slow starters such as Pachi load their network/book before answering, so
    // the handshake gets a longer budget than ordinary commands.
    const reply = await sendTo(session, { name: 'name' }, { timeout: 60000 });
    session.name = reply.content.trim() || session.def.name || 'GTP engine';
    let version = '';
    try {
      version = (await sendTo(session, { name: 'version' }, { timeout: 60000 })).content.trim();
    } catch { /* version is optional */ }
    session.version = version;

    const list = await sendTo(session, { name: 'list_commands' }, { timeout: 60000 });
    session.commands = list.content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    session.analysisCommand = core.selectAnalysisCommand(session.commands);
    session.hasGenmove = session.commands.includes('genmove');

    appendConsole(`attached: ${session.name}${version ? ` ${version}` : ''}`);
    appendConsole(`${session.commands.length} GTP commands${session.analysisCommand ? `, ${session.analysisCommand} available` : ', no analysis command'}`);

    const initial = String(session.def.commands ?? '')
      .split(';')
      .map((command) => command.trim())
      .filter(Boolean);
    for (const text of initial) {
      const [commandName, ...commandArgs] = text.split(/\s+/);
      try {
        await sendTo(session, { name: commandName, args: commandArgs }, { timeout: 15000 });
        appendConsole(`>> ${text}`);
      } catch (error) {
        deps.log(`Initial GTP command "${text}" failed: ${errorMessage(error)}`, 'warn');
      }
    }
  }

  async function attach() {
    if (state.session) {
      await detach();
      return;
    }
    if (state.attaching) return;
    const engine = selectedEngine();
    if (!engine) {
      openManageDialog();
      return;
    }
    if (!desktop?.engine) {
      deps.log('GTP engines are only available in the desktop app.', 'warn');
      return;
    }

    state.attaching = true;
    state.syncToken += 1;
    if (state.syncTimer) {
      clearTimeout(state.syncTimer);
      state.syncTimer = null;
    }
    const session = {
      id: idForEngine(),
      def: engine,
      name: engine.name || basename(engine.path),
      version: '',
      commands: [],
      analysisCommand: null,
      hasGenmove: false,
      ready: false,
    };
    state.session = session;
    state.analysis = null;
    state.analysisActive = false;
    state.pendingSync = false;
    state.lastSignature = '';
    state.position = null;
    refreshPanel();
    updateMenu();
    deps.log(`Starting ${engineLabel(engine)}…`);

    try {
      await desktop.engine.start({
        engineId: session.id,
        path: engine.path,
        args: engine.args,
        cwd: engine.cwd || undefined,
      });
      await handshake(session);
      if (state.session !== session) return;
      session.ready = true;
      deps.log(`Attached ${session.name}${session.version ? ` ${session.version}` : ''}.`);
      if (!session.hasGenmove) deps.log('This engine does not advertise genmove; moves may not work.', 'warn');
      await syncPosition({ force: true });
      scheduleAutoMove('attach');
    } catch (error) {
      const message = errorMessage(error);
      deps.log(`Could not attach the engine: ${message}`, 'error');
      try { await desktop.engine.stop(session.id); } catch { /* already gone */ }
      if (state.session === session) {
        state.session = null;
        state.analysis = null;
        state.position = null;
      }
    } finally {
      state.attaching = false;
      refreshPanel();
      updateMenu();
    }
  }

  async function detach() {
    const session = state.session;
    if (!session) return;
    state.syncToken += 1;
    state.pendingSync = false;
    if (state.syncTimer) {
      clearTimeout(state.syncTimer);
      state.syncTimer = null;
    }
    if (state.autoTimer) {
      clearTimeout(state.autoTimer);
      state.autoTimer = null;
    }
    state.autoBusy = false;
    closeConsole();
    session.ready = false;
    state.session = null;
    state.analysis = null;
    state.analysisActive = false;
    state.position = null;
    state.lastSignature = '';
    refreshPanel();
    updateMenu();
    scheduleBoardDraw();
    try {
      await desktop.engine.stop(session.id);
      deps.log(`Detached ${session.name}.`);
    } catch (error) {
      deps.log(`Could not stop the engine cleanly: ${errorMessage(error)}`, 'warn');
    }
  }

  // Sync ----------------------------------------------------------------

  async function syncPosition({ force = false, analyze = true } = {}) {
    const session = state.session;
    if (!session || !session.ready) return false;
    if (state.syncing) {
      state.pendingSync = true;
      return false;
    }
    const position = collectPosition();
    if (!position) return false;
    const signature = positionSignature(position);
    if (!force && signature === state.lastSignature) return true;

    state.syncing = true;
    const token = ++state.syncToken;
    state.analysis = null;
    state.analysisActive = false;
    state.analysisCommandId = 0;
    refreshPanel();
    scheduleBoardDraw();

    try {
      if (position.width > 25 || position.height > 25) {
        throw new Error('GTP engines support at most a 25×25 board.');
      }
      const commands = core.buildSyncCommands(position, {
        commands: session.commands,
      });
      for (const command of commands) {
        if (token !== state.syncToken || state.session !== session) return false;
        await sendTo(session, command, { timeout: 20000 });
      }
      if (token !== state.syncToken || state.session !== session) return false;
      state.position = position;
      state.lastSignature = signature;
      state.synced = true;
      if (state.analysisEnabled && session.analysisCommand && analyze) {
        await startAnalysis(session, position);
      }
      return true;
    } catch (error) {
      const message = errorMessage(error);
      deps.log(`Engine sync failed: ${message}`, 'error');
      appendConsole(`sync failed: ${message}`);
      // Do not retry until the position changes again.
      if (state.session === session) state.lastSignature = signature;
      return false;
    } finally {
      state.syncing = false;
      refreshPanel();
      if (state.pendingSync && state.session === session) {
        state.pendingSync = false;
        syncPosition();
      } else {
        state.pendingSync = false;
      }
    }
  }

  async function startAnalysis(session, position = state.position) {
    if (!session || state.session !== session || !session.analysisCommand) return false;
    const current = position ?? collectPosition();
    if (!current) return false;
    const color = current.toMove > 0 ? 'B' : 'W';
    const commandName = session.analysisCommand;
    state.analysisActive = true;
    try {
      await sendTo(session, { name: commandName, args: [color, '50'] }, { stream: true, timeout: 15000 });
      state.analysisSign = current.toMove;
      return true;
    } catch (error) {
      state.analysisActive = false;
      deps.log(`Analysis is not available: ${errorMessage(error)}`, 'warn');
      return false;
    }
  }

  async function stopAnalysis() {
    state.analysis = null;
    state.analysisActive = false;
    refreshPanel();
    scheduleBoardDraw();
    // Any command interrupts a streaming analysis. protocol_version is the one
    // command every GTP engine is required to understand, so it doubles as a
    // safe abort when the engine has no `stop`.
    if (state.session) {
      try { await send({ name: 'protocol_version' }, { timeout: 3000 }); } catch { /* optional */ }
    }
  }

  function handleAnalysisLine(line) {
    if (!state.session || !state.analysisEnabled || !state.analysisActive) return;
    const position = state.position;
    if (!position) return;
    const format = state.session.analysisCommand?.startsWith('kata') ? 'float' : 'integer';
    const variations = core.parseAnalysisLine(
      line,
      position.width,
      position.height,
      format,
    );
    if (!variations.length) return;
    variations.sort((a, b) => b.visits - a.visits);
    const bestWinrate = Math.max(...variations.map(({ winrate }) => winrate ?? 0));
    const leads = variations
      .map(({ scoreLead }) => scoreLead)
      .filter((value) => Number.isFinite(value));
    state.analysis = {
      sign: position.toMove,
      variations,
      winrate: bestWinrate,
      scoreLead: leads.length ? Math.max(...leads) : null,
    };
    refreshPanel();
    scheduleBoardDraw();
  }

  // Drawing -------------------------------------------------------------

  function scheduleBoardDraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      deps.scheduleBoardDraw();
    });
  }

  function drawOverlay(context, pointFor, stoneRadius) {
    if (!state.analysis || !state.session) return;
    const position = state.position;
    if (!position) return;
    const variations = state.analysis.variations
      .filter((variation) => variation.move && variation.move[0] >= 0 && variation.move[0] < position.width && variation.move[1] >= 0 && variation.move[1] < position.height)
      .slice(0, 6);
    if (!variations.length) return;

    const best = variations[0];
    const maxWin = Math.max(1, ...variations.map(({ winrate }) => winrate ?? 0));

    variations.forEach((variation, index) => {
      if (deps.isOccupied && deps.isOccupied(variation.move[0], variation.move[1])) return;
      const point = pointFor(variation.move[0], variation.move[1]);
      if (!point) return;
      const winrate = variation.winrate ?? 0;
      const quality = Math.max(0, Math.min(1, winrate / maxWin));
      const radius = stoneRadius * (index === 0 ? 0.96 : 0.82);
      context.save();
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(47, 111, 237, ${0.16 + quality * 0.3})`;
      context.fill();
      context.lineWidth = index === 0 ? 2.2 : 1.1;
      context.strokeStyle = index === 0
        ? 'rgba(20, 60, 190, .95)'
        : 'rgba(20, 60, 190, .45)';
      context.stroke();

      if (variation.visits >= 10 && radius > 7) {
        const label = String(Math.round(winrate));
        context.fillStyle = quality > 0.55 ? '#fff' : '#0b2a6b';
        context.font = `700 ${Math.max(9, Math.round(stoneRadius * 0.56))}px ${getComputedStyle(document.body).fontFamily}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(label, point.x, point.y);
      }
      context.restore();
    });

    // Ring the engine's current best move.
    if (!deps.isOccupied || !deps.isOccupied(best.move[0], best.move[1])) {
      const bestPoint = pointFor(best.move[0], best.move[1]);
      if (bestPoint) {
        context.save();
        context.beginPath();
        context.arc(bestPoint.x, bestPoint.y, stoneRadius * 1.02, 0, Math.PI * 2);
        context.strokeStyle = 'rgba(20, 60, 190, .9)';
        context.lineWidth = 2;
        context.stroke();
        context.restore();
      }
    }
  }

  // Panel ---------------------------------------------------------------

  function refreshSelect() {
    if (!els.select) return;
    const previous = state.selectedId;
    els.select.textContent = '';
    if (!state.engines.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No engines configured';
      els.select.append(option);
      els.select.disabled = true;
      return;
    }
    els.select.disabled = Boolean(state.session);
    for (const engine of state.engines) {
      const option = document.createElement('option');
      option.value = engine.id;
      option.textContent = engineLabel(engine);
      els.select.append(option);
    }
    if (!state.engines.some((engine) => engine.id === state.selectedId)) {
      state.selectedId = state.engines[0].id;
    }
    els.select.value = state.selectedId ?? previous ?? '';
  }

  function refreshPanel() {
    if (!els.status) return;
    const session = state.session;

    if (els.select) els.select.disabled = Boolean(session) || state.engines.length === 0;
    if (els.attach) {
      els.attach.textContent = session ? 'Detach' : 'Attach';
      els.attach.disabled = false;
    }
    if (els.genmove) els.genmove.disabled = !session || !session.hasGenmove || state.syncing;
    if (els.consoleOpen) els.consoleOpen.disabled = !session;
    if (els.analysis) {
      els.analysis.disabled = !session || !session.analysisCommand;
      els.analysis.checked = Boolean(session && state.analysisEnabled && session.analysisCommand);
    }
    if (els.color) els.color.value = state.engineColor;

    if (!session) {
      els.status.textContent = state.engines.length
        ? 'No engine attached.'
        : 'No engines configured. Use Manage… to add GNU Go or KataGo.';
      els.status.classList.remove('is-attached');
    } else if (!session.ready) {
      els.status.textContent = `${session.name} · starting…`;
      els.status.classList.add('is-attached');
    } else {
      const capabilities = session.analysisCommand
        ? `${session.analysisCommand}`
        : 'no analysis command';
      const auto = state.engineColor === 'off' ? '' : ` · engine ${engineColorName()}`;
      els.status.textContent = `${session.name}${session.version ? ` ${session.version}` : ''} · ${session.commands.length} commands · ${capabilities}${auto}`;
      els.status.classList.add('is-attached');
    }

    const analysis = state.analysis;
    const showAnalysis = Boolean(session && analysis && analysis.variations.length);
    if (els.eval) els.eval.hidden = !showAnalysis;
    if (showAnalysis) {
      const percent = Math.max(0, Math.min(100, analysis.winrate ?? 0));
      const side = analysis.sign > 0 ? 'B' : 'W';
      els.winrate.textContent = `${side} ${percent.toFixed(1)}%`;
      els.score.textContent = analysis.scoreLead == null
        ? ''
        : `${side} ${analysis.scoreLead >= 0 ? '+' : ''}${analysis.scoreLead.toFixed(1)}`;
      els.barFill.style.width = `${percent}%`;
      els.barFill.classList.toggle('is-white', analysis.sign < 0);
      renderVariations(analysis);
    }

    if (els.note) {
      if (!desktop?.engine) {
        els.note.textContent = 'GTP engines are only available in the desktop app.';
      } else if (!session) {
        els.note.textContent = 'Attach GNU Go (gnugo --mode gtp) or KataGo (katago gtp -model …) to play and analyse.';
      } else if (!session.analysisCommand) {
        els.note.textContent = 'This engine does not support kata-analyze or lz-analyze, so the win-rate overlay is unavailable. GNU Go is playable but not an analysis engine.';
      } else {
        els.note.textContent = '';
      }
    }
    updateMenu();
  }

  function renderVariations(analysis) {
    if (!els.moves) return;
    els.moves.textContent = '';
    for (const variation of analysis.variations.slice(0, 6)) {
      if (!variation.move || variation.move[0] < 0) continue;
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'engine-move';
      button.dataset.x = variation.move[0];
      button.dataset.y = variation.move[1];
      const coord = deps.coordLabel(variation.move[0], variation.move[1]);
      const percent = (variation.winrate ?? 0).toFixed(1);
      const visits = variation.visits >= 1000
        ? `${(variation.visits / 1000).toFixed(1)}k`
        : String(variation.visits);
      button.textContent = `${coord} · ${percent}% · ${visits}`;
      if (variation.scoreLead != null) {
        button.textContent += ` · ${variation.scoreLead >= 0 ? '+' : ''}${variation.scoreLead.toFixed(1)}`;
      }
      item.append(button);
      els.moves.append(item);
    }
  }

  async function playAnalysedMove(x, y) {
    if (!state.analysis || !state.position) return;
    if (state.analysis.sign !== state.position.toMove) {
      deps.log('The analysis belongs to a different position.', 'warn');
      return;
    }
    deps.playMove(x, y);
  }

  // Menus / dialogs -----------------------------------------------------

  function updateMenu() {
    const label = document.getElementById('engine-menu-attach-label');
    if (label) label.textContent = state.session ? 'Detach Engine' : 'Attach Engine';
    const item = document.getElementById('engine-menu-analysis');
    if (item) {
      item.setAttribute(
        'aria-checked',
        String(Boolean(state.session && state.analysisEnabled && state.session.analysisCommand)),
      );
    }
  }

  function toggleAnalysis() {
    if (!state.session) {
      deps.log('Attach an engine before enabling analysis.', 'warn');
      return;
    }
    if (!state.session.analysisCommand) {
      deps.log('This engine has no analyze command.', 'warn');
      return;
    }
    state.analysisEnabled = !state.analysisEnabled;
    deps.getSettings().engineAnalysis = state.analysisEnabled;
    deps.saveSettings();
    if (state.analysisEnabled) {
      syncPosition({ force: true });
      deps.log('Analysis on.');
    } else {
      stopAnalysis();
      deps.log('Analysis off.');
    }
    refreshPanel();
    updateMenu();
  }

  async function generateMove({ auto = false } = {}) {
    if (state.generating) return;
    const session = state.session;
    if (!session) {
      deps.log('Attach an engine first.', 'warn');
      return;
    }
    if (!session.ready) {
      deps.log('The engine is still starting.', 'warn');
      return;
    }
    if (!session.hasGenmove) {
      deps.log('This engine does not support genmove.', 'warn');
      return;
    }
    // Wait for any in-flight position rebuild (bounded, as a safety net).
    for (let attempt = 0; state.syncing && attempt < 600; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (state.session !== session) return;
    // Make sure the engine is looking at the position on screen, even if the
    // debounced sync after the last move has not fired yet.
    if (positionSignature(collectPosition()) !== state.lastSignature) {
      const synced = await syncPosition({ analyze: false });
      if (!synced || state.session !== session) return;
    }
    const position = collectPosition();
    if (!position) return;
    const requestNodeId = deps.getNodeId();
    const requestColor = position.toMove;
    const color = requestColor > 0 ? 'B' : 'W';
    deps.log(`Asking ${session.name} for ${color === 'B' ? 'Black' : 'White'}…`);
    state.generating = true;
    try {
      const response = await sendTo(
        session,
        { name: 'genmove', args: [color] },
        { timeout: 180000 },
      );
      if (state.session !== session || deps.getNodeId() !== requestNodeId) {
        deps.log('The board changed while the engine was thinking; its move was discarded.', 'warn');
        return;
      }
      if (auto && engineColorSign() !== requestColor) return;
      const result = core.parseGenmoveResult(response.content, position.width, position.height);
      if (result.type === 'move') {
        const played = deps.playMove(result.x, result.y);
        if (played) {
          deps.log(`${session.name} plays ${deps.coordLabel(result.x, result.y)}.`);
        }
      } else if (result.type === 'pass') {
        const played = deps.playPass();
        if (played) deps.log(`${session.name} passes.`);
      } else if (result.type === 'resign') {
        deps.log(`${session.name} resigns.`, 'warn');
      } else {
        deps.log(`Unexpected engine move: ${response.content}`, 'warn');
      }
    } catch (error) {
      deps.log(`Engine move failed: ${errorMessage(error)}`, 'error');
    } finally {
      state.generating = false;
    }
  }

  // Automatic play -------------------------------------------------------

  function scheduleAutoMove(reason) {
    if (!state.initialized) return;
    if (!engineColorSign()) return;
    if (!state.session || !state.session.ready) return;
    if (deps.isReadOnly?.() || deps.isEditMode?.()) return;
    if (state.autoBusy || state.generating) return;
    if (state.autoTimer) clearTimeout(state.autoTimer);
    state.autoTimer = setTimeout(() => {
      state.autoTimer = null;
      maybeAutoMove(reason);
    }, 120);
  }

  async function maybeAutoMove(reason) {
    if (!state.initialized || state.attaching || state.autoBusy) return;
    const session = state.session;
    const sign = engineColorSign();
    if (!session || !session.ready || !sign) return;
    if (deps.isReadOnly?.() || deps.isEditMode?.()) return;
    if (state.syncing) {
      scheduleAutoMove(reason);
      return;
    }
    const node = deps.getCurrentNode?.();
    if (!node || node.children.length) return;
    let position = collectPosition();
    if (!position || position.toMove !== sign) return;
    if (reason === 'new-game' && position.moves.length > 0) return;

    state.autoBusy = true;
    try {
      if (positionSignature(position) !== state.lastSignature) {
        const synced = await syncPosition({ analyze: false });
        if (!synced || state.session !== session) return;
      }
      position = collectPosition();
      const leaf = deps.getCurrentNode?.();
      if (!position || position.toMove !== sign || !leaf || leaf.children.length) return;
      deps.log(`Engine plays ${engineColorName()} — moving now.`);
      await generateMove({ auto: true });
    } finally {
      state.autoBusy = false;
    }
  }

  function onMovePlayed(sign) {
    if (!state.initialized) return;
    const color = engineColorSign();
    if (!color || sign === color) return;
    scheduleAutoMove('human-move');
  }

  function onGameStarted() {
    scheduleAutoMove('new-game');
  }

  function setEngineColor(value) {
    const next = ['off', 'B', 'W'].includes(value) ? value : 'off';
    state.engineColor = next;
    deps.getSettings().engineColor = next;
    deps.saveSettings();
    if (els.color) els.color.value = next;
    refreshPanel();
    deps.log(next === 'off'
      ? 'Engine plays manually.'
      : `Engine plays ${engineColorName()} automatically.`);
    if (next !== 'off') scheduleAutoMove('color');
  }

  function splitCommandLine(text) {
    const parts = [];
    const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      parts.push(match[1] ?? match[2] ?? match[3]);
    }
    return parts;
  }

  async function submitConsole(event) {
    event.preventDefault();
    if (!state.session) return;
    const text = els.consoleInput.value.trim();
    if (!text) return;
    const [name, ...args] = splitCommandLine(text);
    els.consoleInput.value = '';
    appendConsole(`>> ${text}`);
    try {
      const response = await send({ name, args }, { timeout: 60000 });
      appendConsole(`=${response.content}`);
    } catch (error) {
      appendConsole(`? ${errorMessage(error)}`);
    }
  }

  function openConsole() {
    if (!state.session) return;
    if (els.consolePanel) els.consolePanel.hidden = false;
    els.consoleLog.textContent = state.consoleLines.join('\n');
    els.consoleLog.scrollTop = els.consoleLog.scrollHeight;
    els.consoleInput.focus();
  }

  function closeConsole() {
    if (els.consolePanel) els.consolePanel.hidden = true;
  }

  async function openManageDialog() {
    if (!desktop?.engine) {
      deps.log('GTP engines are only available in the desktop app.', 'warn');
      return;
    }
    await loadConfig({ quiet: true });
    state.draftEngines = state.engines.map((engine) => ({ ...engine }));
    if (!state.draftEngines.length) {
      state.draftEngines.push({
        id: idForEngine(),
        name: '',
        path: '',
        file: '',
        original: '',
        args: '',
        commands: '',
      });
    }
    renderEngineRows();
    if (els.configPath) {
      els.configPath.textContent = state.configPath
        ? `Configuration file: ${state.configPath}`
        : 'No configuration file is available.';
      els.configPath.title = state.configPath ?? '';
    }
    els.error.hidden = true;
    els.dialog.showModal();
  }

  function renderEngineRows() {
    els.rows.textContent = '';
    state.draftEngines.forEach((engine) => {
      const row = document.createElement('div');
      row.className = 'engine-row-item';
      row.dataset.engineId = engine.id;
      row.dataset.file = engine.file ?? '';
      row.dataset.commands = engine.commands ?? '';
      row.dataset.original = engine.original ?? engine.path ?? '';

      const name = document.createElement('input');
      name.className = 'engine-name';
      name.placeholder = 'Name (e.g. GNU Go)';
      name.value = engine.name;

      const path = document.createElement('input');
      path.className = 'engine-path';
      path.placeholder = 'Engine executable or .cmd shim';
      path.value = engine.path;

      const browse = document.createElement('button');
      browse.type = 'button';
      browse.className = 'btn engine-browse';
      browse.textContent = '…';
      browse.title = 'Choose the engine executable';

      const args = document.createElement('input');
      args.className = 'engine-args';
      args.placeholder = 'Arguments (e.g. --mode gtp)';
      args.value = engine.args;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-button engine-remove';
      remove.textContent = '×';
      remove.title = 'Remove this engine';

      row.append(name, path, browse, args, remove);
      els.rows.append(row);
    });
  }

  function readEngineRows() {
    const rows = [...els.rows.querySelectorAll('.engine-row-item')];
    return rows.map((row) => ({
      id: row.dataset.engineId,
      name: row.querySelector('.engine-name').value.trim(),
      path: row.querySelector('.engine-path').value.trim(),
      file: row.dataset.file ?? '',
      original: row.dataset.original ?? '',
      args: row.querySelector('.engine-args').value,
      commands: row.dataset.commands ?? '',
    }));
  }

  async function saveEngines() {
    const rows = readEngineRows();
    const engines = sanitizeEngines(rows);
    const nonEmpty = rows.filter(
      (row) => row.name || row.path || row.args.trim(),
    );
    if (nonEmpty.length > 0 && engines.length === 0) {
      els.error.textContent = 'Each engine needs an executable path.';
      els.error.hidden = false;
      return;
    }
    try {
      const result = await desktop.engineConfig.save(engines);
      state.engines = sanitizeEngines(result.engines).map((engine) => ({
        ...engine,
        original: engine.path,
      }));
      state.configPath = result.path;
      if (!state.engines.some((engine) => engine.id === state.selectedId)) {
        state.selectedId = state.engines[0]?.id ?? null;
      }
      deps.getSettings().engines = state.engines;
      deps.getSettings().selectedEngineId = state.selectedId;
      deps.saveSettings();
      refreshSelect();
      refreshPanel();
      els.dialog.close();
      deps.log(`Saved ${state.engines.length} engine${state.engines.length === 1 ? '' : 's'} to ${result.path}.`);
    } catch (error) {
      els.error.textContent = errorMessage(error);
      els.error.hidden = false;
    }
  }

  // Event wiring --------------------------------------------------------

  function handleEngineEvent(event) {
    if (!event || !state.session || event.engineId !== state.session.id) return;
    switch (event.type) {
      case 'line':
        handleAnalysisLine(event.line);
        break;
      case 'command':
        if (event.name !== 'kata-analyze' && event.name !== 'lz-analyze' && event.name !== 'analyze') {
          appendConsole(`>> ${event.name}${event.args?.length ? ` ${event.args.join(' ')}` : ''}`);
        }
        break;
      case 'stderr':
        appendConsole(`! ${event.message}`);
        break;
      case 'exit':
        deps.log(event.message || 'The engine exited.', 'warn');
        appendConsole(`! ${event.message || 'engine exited'}`);
        closeConsole();
        state.session = null;
        state.analysis = null;
        state.position = null;
        refreshPanel();
        updateMenu();
        scheduleBoardDraw();
        break;
      case 'error':
        deps.log(event.message || 'Engine error.', 'error');
        appendConsole(`! ${event.message || 'engine error'}`);
        break;
      default:
        break;
    }
  }

  function init(options) {
    if (state.initialized) return;
    deps = options;
    const settings = deps.getSettings();
    state.engines = sanitizeEngines(settings.engines);
    state.selectedId = settings.selectedEngineId && state.engines.some((engine) => engine.id === settings.selectedEngineId)
      ? settings.selectedEngineId
      : (state.engines[0]?.id ?? null);
    state.analysisEnabled = settings.engineAnalysis === true;
    state.engineColor = ['off', 'B', 'W'].includes(settings.engineColor) ? settings.engineColor : 'off';

    els.select = $('engine-select');
    els.attach = $('engine-attach');
    els.manage = $('engine-manage');
    els.status = $('engine-status');
    els.genmove = $('engine-genmove');
    els.analysis = $('engine-analysis');
    els.color = $('engine-color');
    els.consoleOpen = $('engine-console-open');
    els.consolePanel = $('engine-console-panel');
    els.consoleClose = $('engine-console-close');
    els.eval = $('engine-eval');
    els.winrate = $('engine-winrate');
    els.score = $('engine-score');
    els.barFill = $('engine-bar-fill');
    els.moves = $('engine-moves');
    els.note = $('engine-note');
    els.consoleLog = $('engine-console-log');
    els.consoleInput = $('engine-console-input');
    els.consoleForm = $('engine-console-form');
    els.dialog = $('engines-dialog');
    els.rows = $('engine-rows');
    els.add = $('engine-add');
    els.reload = $('engine-reload');
    els.save = $('engines-save');
    els.error = $('engines-error');
    els.configPath = $('engine-config-path');

    if (desktop?.engine?.onEvent) desktop.engine.onEvent(handleEngineEvent);

    els.select?.addEventListener('change', () => {
      state.selectedId = els.select.value;
      deps.getSettings().selectedEngineId = state.selectedId;
      deps.saveSettings();
    });
    els.attach?.addEventListener('click', () => attach());
    els.manage?.addEventListener('click', openManageDialog);
    els.genmove?.addEventListener('click', () => generateMove());
    els.analysis?.addEventListener('change', () => {
      if (els.analysis.checked === state.analysisEnabled) return;
      toggleAnalysis();
    });
    els.color?.addEventListener('change', () => setEngineColor(els.color.value));
    els.consoleOpen?.addEventListener('click', openConsole);
    els.consoleClose?.addEventListener('click', closeConsole);
    els.consoleForm?.addEventListener('submit', submitConsole);
    els.moves?.addEventListener('click', (event) => {
      const button = event.target.closest('.engine-move');
      if (!button) return;
      playAnalysedMove(Number(button.dataset.x), Number(button.dataset.y));
    });

    els.add?.addEventListener('click', () => {
      state.draftEngines = readEngineRows();
      state.draftEngines.push({
        id: idForEngine(),
        name: '',
        path: '',
        file: '',
        original: '',
        args: '',
        commands: '',
      });
      renderEngineRows();
    });
    els.reload?.addEventListener('click', async () => {
      const loaded = await loadConfig();
      if (!loaded) return;
      state.draftEngines = state.engines.map((engine) => ({ ...engine }));
      if (!state.draftEngines.length) {
        state.draftEngines.push({
          id: idForEngine(),
          name: '',
          path: '',
          file: '',
          original: '',
          args: '',
          commands: '',
        });
      }
      renderEngineRows();
      els.error.hidden = true;
    });
    els.save?.addEventListener('click', saveEngines);
    els.rows?.addEventListener('click', async (event) => {
      const browse = event.target.closest('.engine-browse');
      const remove = event.target.closest('.engine-remove');
      if (browse) {
        const row = browse.closest('.engine-row-item');
        const pathInput = row.querySelector('.engine-path');
        try {
          const result = await desktop.engine.choosePath();
          if (result && !result.canceled && result.filePath) {
            pathInput.value = result.filePath;
            const nameInput = row.querySelector('.engine-name');
            if (!nameInput.value.trim()) {
              nameInput.value = basename(result.filePath).replace(/\.(exe|bat|cmd)$/i, '');
            }
          }
        } catch (error) {
          els.error.textContent = errorMessage(error);
          els.error.hidden = false;
        }
      } else if (remove) {
        state.draftEngines = readEngineRows().filter(
          (engine) => engine.id !== remove.closest('.engine-row-item').dataset.engineId,
        );
        renderEngineRows();
      }
    });

    state.initialized = true;
    refreshSelect();
    refreshPanel();
    updateMenu();
    if (desktop?.engineConfig) loadConfig({ quiet: true });
  }

  function onPositionChanged() {
    if (!state.initialized || state.attaching) return;
    const session = state.session;
    if (!session || !session.ready) return;
    const position = collectPosition();
    if (!position) return;
    const signature = positionSignature(position);
    if (signature === state.lastSignature) return;
    // Drop the previous position's evaluation immediately; the debounce below
    // rebuilds the engine and starts a fresh analysis.
    if (state.analysis || state.analysisActive) {
      state.analysis = null;
      state.analysisActive = false;
      refreshPanel();
      scheduleBoardDraw();
    }
    if (state.syncTimer) clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(() => {
      state.syncTimer = null;
      syncPosition();
    }, 250);
  }

  window.MultiGoEngine = {
    init,
    onPositionChanged,
    onMovePlayed,
    onGameStarted,
    drawOverlay,
    refreshPanel,
    manageEngines: openManageDialog,
    openConsole,
    closeConsole,
    toggleAttach: attach,
    generateMove,
    toggleAnalysis,
    setEngineColor,
    attached: () => Boolean(state.session),
    setTabVisible: () => refreshPanel(),
  };
})();
