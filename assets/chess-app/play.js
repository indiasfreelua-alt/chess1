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
    ui.setLastMove({ from: move.from, to: move.to });
    ui.refresh();
    updateStatus();
    updateMoveList();
    maybeFinish();
  }

  // ── Bot panel (selection screen) ───────────────────────────────────────────
  function buildBotPanel() {
    botCats.innerHTML = '';
    global.Bots.CATEGORIES.forEach(function (cat) {
      const bots = global.Bots.byCategory(cat.id);
      const row = document.createElement('div');
      row.className = 'cat-row';

      const avatars = document.createElement('div');
      avatars.className = 'cat-avatars';
      bots.forEach(function (b) {
        const chip = document.createElement('button');
        chip.className = 'cat-avatar';
        chip.dataset.bot = b.id;
        chip.title = b.name + ' (' + b.rating + ')';
        chip.textContent = b.emoji;
        chip.addEventListener('click', function () { selectBot(b.id); });
        avatars.appendChild(chip);
      });

      const name = document.createElement('span');
      name.className = 'cat-name';
      name.textContent = cat.label;

      const count = document.createElement('span');
      count.className = 'cat-count';
      count.textContent = bots.length + (bots.length === 1 ? ' bot' : ' bots');

      row.appendChild(avatars);
      row.appendChild(name);
      row.appendChild(count);
      botCats.appendChild(row);
    });
    markSelectedChip();
  }

  function markSelectedChip() {
    botCats.querySelectorAll('.cat-avatar').forEach(function (chip) {
      chip.classList.toggle('selected', !!bot && chip.dataset.bot === bot.id);
    });
  }

  function selectBot(id) {
    bot = global.Bots.getBot(id);
    if (!bot) return;
    $('sb-avatar').textContent = bot.emoji;
    $('sb-name').textContent = bot.name;
    $('sb-rating').textContent = bot.rating;
    const quip = $('bot-quip');
    quip.textContent = '“' + bot.quip + '”';
    quip.classList.remove('hidden');
    markSelectedChip();
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
        ui.setLastMove({ from: move.from, to: move.to });
        ui.refresh();
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
      '<span>' + bot.name + ' <small>(' + bot.rating + ')</small></span>';
    $('plate-you-g').innerHTML =
      '<span class="plate-avatar">\u{1F9CD}</span><span>You</span>';

    moveListEl.innerHTML = '';
    updateStatus();
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

  function updateMoveList() {
    const history = game.history({ verbose: true });
    moveListEl.innerHTML = '';
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
    gameOver = true;
    setThinking(false);

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
    destroyEngine();
    resultModal.classList.remove('visible');
    showSelect();
  });
  $('btn-resign').addEventListener('click', function () {
    if (gameOver) return;
    gameOver = true;
    setThinking(false);
    destroyEngine();
    const id = saveGame('You lost', 'by resignation');
    resultText.textContent = 'You lost';
    resultSub.textContent = 'by resignation';
    $('btn-analyze').onclick = function () {
      window.location.href = '../analysis/?game=' + id;
    };
    resultModal.classList.add('visible');
  });
  $('btn-flip').addEventListener('click', function () { ui && ui.flip(); });
  $('btn-rematch').addEventListener('click', function () {
    resultModal.classList.remove('visible');
    startGame();
  });
  $('btn-result-close').addEventListener('click', function () {
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
  showSelect();

  // Idle preview board behind the selection panel
  previewUi = new BoardUI('board-mount', {
    orientation: 'w',
    canPick: function () { return false; },
  });
  previewUi.setGame(new Chess());
  previewUi.setLastMove({ from: 'e2', to: 'e4' });
  previewUi.refresh();
  $('plate-bot').innerHTML =
    '<span class="plate-avatar">\u{1F916}</span><span>Play Bots <small>(preview)</small></span>';
  $('plate-you').innerHTML =
    '<span class="plate-avatar">\u{1F9CD}</span><span>You</span>';

  // Show intro modal on first visit
  let seen = false;
  try { seen = !!localStorage.getItem(INTRO_KEY); } catch (e) { /* ignore */ }
  if (!seen) $('intro-modal').classList.add('visible');
})(window);
