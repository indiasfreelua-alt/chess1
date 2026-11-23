/**
 * play.js — Game controller for the Play-vs-Bots page.
 * Depends on: chess.js (window.Chess), board-ui.js (window.BoardUI), bots.js (window.Bots)
 *
 * Flow (matching the layout of modern chess sites, with original assets):
 *   sidebar + board preview + bot panel (categories -> select bot -> Play)
 *   -> color choice -> game view with Stockfish engine.
 * Finished games are auto-saved to localStorage for the Analysis page.
 */
(function (global) {
  'use strict';

  // Lite single-threaded build: 1.8MB wasm (instant load) — still far above
  // every bot rating in bots.js; the full 99MB build boots via the same MIME fix.
  const SF_PATH = '../assets/vendor/stockfish-19-lite-single.js';
  const SAVE_KEY = 'chess_saved_games';
  const INTRO_KEY = 'chess_bots_intro_seen';
  const TIME_KEY = 'chess_time_control';
  const CLOCK_TICK_MS = 100;

  // Time controls: code -> { initialSeconds, incrementSeconds } (Fischer increment).
  const TIME_CONTROLS = {
    'unlimited': null,
    '1+0':  { initial: 60,  increment: 0 },
    '3+0':  { initial: 180, increment: 0 },
    '3+2':  { initial: 180, increment: 2 },
    '5+0':  { initial: 300, increment: 0 },
    '5+3':  { initial: 300, increment: 3 },
    '10+0': { initial: 600, increment: 0 },
  };

  // ── DOM handles ────────────────────────────────────────────────────────────
  const $ = function (id) { return document.getElementById(id); };
  const selectView = $('select-view');
  const gameView = $('game-view');
  const botCats = $('bot-cats');
  const statusEl = $('status');
  const moveListEl = $('move-list');
  const thinkingEl = $('thinking');
  const resultModal = $('result-modal');
  const resultText = $('result-text');
  const resultSub = $('result-sub');

  // ── State ──────────────────────────────────────────────────────────────────
  let previewUi = null;   // idle board on the selection screen
  let ui = null;          // active game board
  let game = null;
  let engine = null;
  let engineReady = false;
  let bot = null;
  let playerColor = 'w';
  let gameOver = false;
  let pendingEngineReply = false;

  // ── Clock state ─────────────────────────────────────────────────────────────
  let clockTimer = null;   // setInterval handle (one per game)
  let clockState = null;   // { w, b, lastTick } — seconds remaining, real-time anchor
  let timeControl = null;  // active { initial, increment }, or null = unlimited

  // ── Engine worker ──────────────────────────────────────────────────────────
  function initEngine() {
    destroyEngine();
    try {
      engine = new Worker(SF_PATH);
    } catch (e) {
      console.warn('Stockfish worker failed to load:', e);
      engine = null;
      return;
    }
    engine.onmessage = function (evt) {
      const line = typeof evt === 'string' ? evt : evt.data;
      if (!line) return;
      if (line === 'uciok') {
        applyEnginePersonality();
        engine.postMessage('isready');
      } else if (line === 'readyok') {
        engineReady = true;
        maybeEngineTurn();
      } else if (line.indexOf('bestmove') === 0) {
        const mv = line.split(' ')[1];
        if (mv && mv !== '(none)') applyEngineMove(mv);
        pendingEngineReply = false;
        setThinking(false);
        maybeEngineTurn();
      }
    };
    engine.postMessage('uci');
  }

  function destroyEngine() {
    if (engine) { engine.terminate(); engine = null; }
    engineReady = false;
    pendingEngineReply = false;
  }

  function applyEnginePersonality() {
    const cfg = bot.engine;
    engine.postMessage('setoption name Skill Level value ' + cfg.skill);
    if (cfg.elo) {
      engine.postMessage('setoption name UCI_LimitStrength value true');
      engine.postMessage('setoption name UCI_Elo value ' + cfg.elo);
    } else {
      engine.postMessage('setoption name UCI_LimitStrength value false');
    }
  }

  function setThinking(on) {
    thinkingEl.classList.toggle('visible', on);
  }

  // ── Chess clock (Fischer timing, implemented here — chess.js has none) ─────
  function readTimeControl() {
    const code = $('time-select').value;
    return Object.prototype.hasOwnProperty.call(TIME_CONTROLS, code)
      ? TIME_CONTROLS[code] : null;
  }

  function initTimeSelect() {
    const sel = $('time-select');
    let saved = null;
    try { saved = localStorage.getItem(TIME_KEY); } catch (e) { /* ignore */ }
    if (saved && Object.prototype.hasOwnProperty.call(TIME_CONTROLS, saved)) {
      sel.value = saved;
    }
    sel.addEventListener('change', function () {
      try { localStorage.setItem(TIME_KEY, sel.value); } catch (e) { /* ignore */ }
    });
  }

  // m:ss, with tenths shown under 10 s (e.g. 0:09.4). Never negative.
  function formatClock(t) {
    if (t < 10) {
      const whole = Math.floor(t);
      const tenths = Math.floor((t - whole) * 10);
      return '0:0' + whole + '.' + tenths;
    }
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function clockChip(color) {
    return color === playerColor ? $('clock-you') : $('clock-bot');
  }

  function renderClocks() {
    ['w', 'b'].forEach(function (color) {
      const el = clockChip(color);
      if (!el) return;
      if (!clockState) {
        // Unlimited game — no clock chip at all
        el.textContent = '';
        el.classList.add('clock-unlimited');
        el.classList.remove('clock-low');
        return;
      }
      el.classList.remove('clock-unlimited');
      const t = clockState[color];
      el.textContent = formatClock(t);
      el.classList.toggle('clock-low', t < 10);
    });
  }

  function stopClock() {
    if (clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  }

  function startClock() {
    stopClock();
    timeControl = readTimeControl();
    if (!timeControl) { clockState = null; renderClocks(); return; }
    clockState = { w: timeControl.initial, b: timeControl.initial, lastTick: Date.now() };
    renderClocks();
    clockTimer = setInterval(tickClock, CLOCK_TICK_MS);
  }

  // The side to move burns real time from game start (white first).
  function tickClock() {
    if (!clockState || gameOver || !game) return;
    const now = Date.now();
    const side = game.turn();
    const elapsed = (now - clockState.lastTick) / 1000;
    clockState.lastTick = now;
    clockState[side] = Math.max(0, clockState[side] - elapsed);
    renderClocks();
    if (clockState[side] <= 0) flagFall(side);
  }

  // Fischer rule: after a side completes a move, credit its increment.
  function afterMoveCompleted(color) {
    if (!clockState || !timeControl) return;
    if (timeControl.increment > 0) clockState[color] += timeControl.increment;
    clockState.lastTick = Date.now(); // elapsed so far was charged to the mover
    renderClocks();
  }

  // True if `color` could still deliver mate: pawn, rook or queen, or 2+ minors.
  function hasMatingMaterial(color) {
    let minors = 0;
    const board = game.board();
    for (let r = 0; r < board.length; r++) {
      for (let f = 0; f < board[r].length; f++) {
        const sq = board[r][f];
        if (!sq || sq.color !== color) continue;
        if (sq.type === 'p' || sq.type === 'r' || sq.type === 'q') return true;
        if (sq.type === 'n' || sq.type === 'b') minors++;
      }
    }
    return minors >= 2;
  }

  function flagFall(loserColor) {
    if (gameOver) return;
    stopClock();
    const winner = loserColor === 'w' ? 'b' : 'w';
    if (hasMatingMaterial(winner)) {
      finishGame(loserColor === playerColor ? 'You lost' : 'You won!', 'on time');
    } else {
      finishGame('Draw', 'timeout vs insufficient material');
    }
  }

  function maybeEngineTurn() {
    if (gameOver || !game || game.isGameOver()) return;
    if (game.turn() === playerColor) return;
    if (!engineReady || pendingEngineReply) return;
    pendingEngineReply = true;
    setThinking(true);
    engine.postMessage('position fen ' + game.fen());
    engine.postMessage('go movetime ' + bot.engine.movetime);
  }

  function applyEngineMove(uci) {
    if (gameOver || !game) return;
    let move = null;
    // Weak bots may blunder: swap the engine choice for a random legal move.
    if (Math.random() < (bot.engine.blunder || 0)) {
      const legal = game.moves({ verbose: true });
      if (legal.length) {
        const pick = legal[Math.floor(Math.random() * legal.length)];
        move = game.move({ from: pick.from, to: pick.to, promotion: pick.promotion || 'q' });
      }
    }
    if (!move) {
      const from = uci.slice(0, 2), to = uci.slice(2, 4);
      const promo = uci.length === 5 ? uci[4] : 'q';
      move = game.move({ from: from, to: to, promotion: promo });
    }
    if (!move) return;
    if (global.SoundFx) global.SoundFx.playMove(move, game);
    ui.setLastMove({ from: move.from, to: move.to });
    ui.refresh();
    afterMoveCompleted(move.color);
    updateStatus();
    updateMoveList();
    maybeFinish();
  }

  // ── Bot panel (selection screen) ───────────────────────────────────────────
  function categoryLabel(catId) {
    const cat = global.Bots.CATEGORIES.find(function (c) { return c.id === catId; });
    return cat ? cat.label : 'Bot';
  }

  function buildBotPanel() {
    botCats.innerHTML = '';
    global.Bots.CATEGORIES.forEach(function (cat) {
      const bots = global.Bots.byCategory(cat.id);
      const row = document.createElement('div');
      row.className = 'cat-row';
      row.dataset.cat = cat.id;

      const avatars = document.createElement('div');
      avatars.className = 'cat-avatars';
      bots.forEach(function (b) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'cat-avatar';
        chip.dataset.bot = b.id;
        chip.title = b.name + ' (' + b.rating + ')';
        chip.textContent = b.emoji;
        chip.addEventListener('click', function () { selectBot(b.id); });
        avatars.appendChild(chip);
      });

      const meta = document.createElement('div');
      meta.className = 'cat-meta';
      const name = document.createElement('span');
      name.className = 'cat-name';
      name.textContent = cat.label;
      const sub = document.createElement('span');
      sub.className = 'cat-sub';
      sub.textContent = bots.map(function (b) { return b.rating; }).join(' · ');
      meta.appendChild(name);
      meta.appendChild(sub);

      const count = document.createElement('span');
      count.className = 'cat-count';
      count.textContent = bots.length + (bots.length === 1 ? ' bot' : ' bots');

      row.appendChild(avatars);
      row.appendChild(meta);
      row.appendChild(count);
      botCats.appendChild(row);
    });
    markSelectedChip();
  }

  function markSelectedChip() {
    botCats.querySelectorAll('.cat-avatar').forEach(function (chip) {
      chip.classList.toggle('selected', !!bot && chip.dataset.bot === bot.id);
    });
    botCats.querySelectorAll('.cat-row').forEach(function (row) {
      row.classList.toggle('has-selected', !!bot && row.dataset.cat === bot.cat);
    });
  }

  // Nameplate above the preview board — always mirrors the chosen opponent.
  function renderPreviewPlate() {
    if (!bot) return;
    $('plate-bot').innerHTML =
      '<span class="plate-avatar">' + bot.emoji + '</span>' +
      '<span class="plate-name">' + bot.name +
      ' <small>' + bot.rating + ' Elo</small></span>' +
      '<span class="plate-tag">' + categoryLabel(bot.cat) + '</span>';
  }

  function sideLabel() {
    const v = $('side-select').value;
    return v === 'w' ? 'White' : v === 'b' ? 'Black' : 'Random side';
  }

  function renderYouPlate() {
    $('plate-you').innerHTML =
      '<span class="plate-avatar">\u{1F9CD}</span>' +
      '<span class="plate-name">You <small>' + sideLabel() + '</small></span>' +
      '<span class="plate-tag plate-tag-quiet">ready</span>';
  }

  function selectBot(id) {
    bot = global.Bots.getBot(id);
    if (!bot) return;
    $('sb-avatar').textContent = bot.emoji;
    $('sb-name').textContent = bot.name;
    $('sb-rating').textContent = bot.rating + ' Elo';
    $('sb-cat').textContent = categoryLabel(bot.cat);
    $('sb-desc').textContent = bot.desc || '';
    const quip = $('bot-quip');
    quip.textContent = '“' + bot.quip + '”';
    quip.classList.remove('hidden');
    markSelectedChip();
    renderPreviewPlate();
  }

  // ── Screen switching ───────────────────────────────────────────────────────
  function showSelect() {
    gameView.classList.remove('active');
    selectView.classList.add('active');
  }

  function showGame() {
    selectView.classList.remove('active');
    gameView.classList.add('active');
  }

  // ── Game start ─────────────────────────────────────────────────────────────
  function startGame() {
    if (!bot) bot = global.Bots.BOTS[0];
    const choice = $('side-select').value;
    playerColor = choice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : choice;

    game = new Chess();
    gameOver = false;
    initEngine();

    ui = new BoardUI('board-mount-g', {
      orientation: playerColor,
      evalBar: true,
      canPick: function (sq, piece) {
        return !gameOver && !pendingEngineReply &&
               piece.color === playerColor && game.turn() === playerColor;
      },
      onUserMove: function (from, to, promo) {
        const move = game.move({ from: from, to: to, promotion: promo || 'q' });
        if (!move) return;
        if (global.SoundFx) global.SoundFx.playMove(move, game);
        ui.setLastMove({ from: move.from, to: move.to });
        ui.refresh();
        afterMoveCompleted(move.color);
        updateStatus();
        updateMoveList();
        maybeFinish();
        maybeEngineTurn();
      },
    });
    ui.setGame(game);
    ui.refresh();
    ui.setEvalBar(20);

    // Nameplates — player always at the bottom (board oriented to player)
    $('plate-bot-g').innerHTML =
      '<span class="plate-avatar">' + bot.emoji + '</span>' +
      '<span class="plate-name">' + bot.name + ' <small>' + bot.rating + '</small></span>' +
      '<span id="clock-bot" class="clock-chip"></span>';
    $('plate-you-g').innerHTML =
      '<span class="plate-avatar">\u{1F9CD}</span><span class="plate-name">You</span>' +
      '<span id="clock-you" class="clock-chip"></span>';
    $('game-panel-title').textContent = bot.name;
    $('game-panel-tag').textContent = categoryLabel(bot.cat);

    moveListEl.innerHTML = '';
    updateStatus();
    startClock();
    showGame();
  }

  function updateStatus() {
    let text;
    if (game.isCheckmate()) {
      text = (game.turn() === playerColor ? 'Checkmate — you lose' : 'Checkmate — you win!');
    } else if (game.isDraw()) {
      text = 'Draw';
    } else if (game.isStalemate()) {
      text = 'Stalemate';
    } else if (game.isCheck()) {
      text = (game.turn() === playerColor ? 'You are in check!' : bot.name + ' is in check');
    } else {
      text = game.turn() === playerColor ? 'Your move' : bot.name + ' is thinking…';
    }
    statusEl.textContent = text;
  }

  // Compact game facts under the status line (clock / side / ply / material).
  const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  function updateGameMeta() {
    const el = $('game-meta');
    if (!el || !game) return;
    const history = game.history({ verbose: true });
    let mine = 0, theirs = 0;
    history.forEach(function (m) {
      if (!m.captured) return;
      const v = PIECE_VALUE[m.captured] || 0;
      if (m.color === playerColor) mine += v; else theirs += v;
    });
    const diff = mine - theirs;
    const tc = $('time-select').value;
    const chips = [
      '<span class="meta-chip">' + (tc === 'unlimited' ? 'No clock' : tc) + '</span>',
      '<span class="meta-chip">You: ' + (playerColor === 'w' ? 'White' : 'Black') + '</span>',
      '<span class="meta-chip">Move ' + Math.max(1, Math.ceil(history.length / 2)) + '</span>',
      '<span class="meta-chip' + (diff > 0 ? ' pos' : diff < 0 ? ' neg' : '') + '">' +
        (diff === 0 ? 'Material even' : 'Material ' + (diff > 0 ? '+' : '−') + Math.abs(diff)) +
      '</span>',
    ];
    el.innerHTML = chips.join('');
  }

  function updateMoveList() {
    const history = game.history({ verbose: true });
    updateGameMeta();
    moveListEl.innerHTML = '';
    if (!history.length) {
      const empty = document.createElement('div');
      empty.className = 'move-empty';
      empty.textContent = 'Moves will appear here.';
      moveListEl.appendChild(empty);
      return;
    }
    for (let i = 0; i < history.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'mv-row';
      const no = document.createElement('span');
      no.className = 'mv-no';
      no.textContent = (i / 2 + 1) + '.';
      row.appendChild(no);
      const w = document.createElement('span');
      w.className = 'mv-san';
      w.textContent = history[i] ? history[i].san : '';
      row.appendChild(w);
      const bEl = document.createElement('span');
      bEl.className = 'mv-san';
      bEl.textContent = history[i + 1] ? history[i + 1].san : '';
      row.appendChild(bEl);
      moveListEl.appendChild(row);
    }
    moveListEl.scrollTop = moveListEl.scrollHeight;
  }

  // ── Game over / saving ─────────────────────────────────────────────────────
  function maybeFinish() {
    if (gameOver || !game.isGameOver()) return;
    let result, sub;
    if (game.isCheckmate()) {
      const loser = game.turn();
      result = loser === playerColor ? 'You lost' : 'You won!';
      sub = 'by checkmate';
    } else if (game.isStalemate()) {
      result = 'Draw'; sub = 'by stalemate';
    } else if (game.isThreefoldRepetition()) {
      result = 'Draw'; sub = 'by repetition';
    } else if (game.isInsufficientMaterial()) {
      result = 'Draw'; sub = 'insufficient material';
    } else {
      result = 'Draw'; sub = '50-move rule';
    }
    finishGame(result, sub);
  }

  // Single game-over path: stops the clock, saves and shows the result modal.
  function finishGame(result, sub) {
    gameOver = true;
    setThinking(false);
    stopClock();
    if (global.SoundFx) {
      global.SoundFx.play(result.indexOf('won') !== -1 ? 'win'
        : result.indexOf('lost') !== -1 ? 'lose' : 'draw');
    }

    const id = saveGame(result, sub);
    resultText.textContent = result;
    resultSub.textContent = sub;
    $('btn-analyze').onclick = function () {
      window.location.href = '../analysis/?game=' + id;
    };
    resultModal.classList.add('visible');
  }

  function saveGame(result, sub) {
    const id = 'g' + Date.now();
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); } catch (e) { /* ignore */ }
    saved.unshift({
      id: id,
      date: new Date().toISOString(),
      bot: bot ? { id: bot.id, name: bot.name, rating: bot.rating, emoji: bot.emoji } : null,
      playerColor: playerColor,
      pgn: game.pgn(),
      moves: game.history(),
      result: result,
      resultSub: sub,
    });
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved.slice(0, 50))); } catch (e) { /* ignore */ }
    return id;
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  $('btn-play').addEventListener('click', startGame);
  $('btn-new').addEventListener('click', function () {
    stopClock();
    destroyEngine();
    resultModal.classList.remove('visible');
    showSelect();
  });
  $('btn-resign').addEventListener('click', function () {
    if (gameOver) return;
    destroyEngine();
    finishGame('You lost', 'by resignation');
  });
  $('btn-flip').addEventListener('click', function () { ui && ui.flip(); });
  $('btn-rematch').addEventListener('click', function () {
    resultModal.classList.remove('visible');
    startGame();
  });
  $('btn-result-close').addEventListener('click', function () {
    stopClock();
    resultModal.classList.remove('visible');
  });
  $('btn-intro-x').addEventListener('click', function () {
    $('intro-modal').classList.remove('visible');
  });
  $('btn-intro-start').addEventListener('click', function () {
    try { localStorage.setItem(INTRO_KEY, '1'); } catch (e) { /* ignore */ }
    $('intro-modal').classList.remove('visible');
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  buildBotPanel();
  selectBot(global.Bots.BOTS[0].id);
  initTimeSelect();
  showSelect();

  // Lobby stat chips
  const ratings = global.Bots.BOTS.map(function (b) { return b.rating; });
  const minElo = Math.min.apply(null, ratings);
  const maxElo = Math.max.apply(null, ratings);
  $('lobby-bot-count').textContent = String(global.Bots.BOTS.length);
  $('panel-count').textContent = global.Bots.BOTS.length + ' bots';
  $('lobby-elo-range').textContent = minElo + '–' + maxElo;
  renderYouPlate();
  $('side-select').addEventListener('change', renderYouPlate);

  // Enter starts the game while the lobby is on screen
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (!selectView.classList.contains('active')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (resultModal.classList.contains('visible')) return;
    startGame();
  });

  // Idle preview board behind the selection panel
  previewUi = new BoardUI('board-mount', {
    orientation: 'w',
    canPick: function () { return false; },
  });
  previewUi.setGame(new Chess());
  previewUi.refresh();

  // Show intro modal on first visit
  let seen = false;
  try { seen = !!localStorage.getItem(INTRO_KEY); } catch (e) { /* ignore */ }
  if (!seen) $('intro-modal').classList.add('visible');
})(window);
