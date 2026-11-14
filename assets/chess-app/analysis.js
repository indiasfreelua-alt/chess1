/**
 * analysis.js — Game Review (local analysis page)
 * Depends on: chess.js (window.Chess), board-ui.js (window.BoardUI)
 *
 * Features:
 *   - Load a saved game (localStorage) or paste a PGN/FEN
 *   - Sequential Stockfish evaluation of every position, gated on engine
 *     readiness (readyok) before the first query is sent
 *   - Move classification: Brilliant / Great / Best / Book / Excellent /
 *     Good / Inaccuracy / Mistake / Blunder (Brilliant is deliberately rare:
 *     engine-top + genuine non-forced sacrifice that still holds the eval)
 *   - Accuracy per side, eval graph, eval bar, guide arrows (blue = played
 *     move into the position, green = engine best from it)
 *   - Engine depth selector, live progress ("Analyzing… 12/34"),
 *     summary line with result + accuracies, opening detection
 *
 * All heuristics are implemented locally for this harness.
 */
(function (global) {
  'use strict';

  // Lite build for instant boot; movetime per position keeps review fast.
  const SF_PATH = '../assets/vendor/stockfish-19-lite-single.js';
  const SAVE_KEY = 'chess_saved_games';

  // Safety net per position: if bestmove never arrives, give up and move on.
  const EVAL_WATCHDOG_MS = 10000;

  // Small opening book for "Book" classification (common first moves)
  const BOOK = new Set([
    'e4', 'e5', 'd4', 'd5', 'Nf3', 'c5', 'c4', 'e6', 'Nc6', 'Nf6', 'g6', 'd6',
    'c6', 'g3', 'b6', 'Bf4', 'Bc4', 'Bb5', 'Bd3', 'Be2', 'Be7', 'Be3', 'Bg5',
    'O-O', 'd3', 'b3', 'f4', 'Nc3', 'Nd2', 'Na3', 'Nh3', 'a3', 'a6', 'b4', 'h3',
    'exd5', 'exd4', 'Nxd4', 'Nxe5', 'dxc5', 'cxd5', 'cxd4', 'Nxd5',
  ]);

  // Opening detection: first match whose move sequence is a prefix of the
  // game wins. Longest sequences first so specific lines beat generic ones.
  const OPENINGS = [
    ['e4 e5 Nf3 Nc6 Bb5', 'Ruy Lopez'],
    ['e4 e5 Nf3 Nc6 Bc4', 'Italian Game'],
    ['e4 e5 Nf3 Nc6 d6',  'Semi-Open Game'],
    ['e4 e5 Nf3 Nc6',     'Open Game'],
    ['e4 e5',             'Open Game'],
    ['d4 Nf6 c4 g6',      "King's Indian Defence"],
    ['d4 d5 c4',          "Queen's Gambit"],
    ['e4 c5',             'Sicilian Defence'],
    ['e4 e6',             'French Defence'],
    ['e4 c6',             'Caro-Kann Defence'],
    ['d4 d5',             'Closed Game'],
    ['d4 Nf6',            'Indian Defence'],
    ['c4',                'English Opening'],
    ['Nf3',               'Zukertort Opening'],
    ['d4',                "Queen's Pawn Game"],
    ['e4',                "King's Pawn Opening"],
  ];

  const CLASS_ORDER = ['brilliant', 'great', 'best', 'book', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
  const CLASS_META = {
    brilliant: { label: 'Brilliant', sym: '!!', color: '#26c2a3' },
    great:     { label: 'Great',     sym: '!',  color: '#5b8bd6' },
    best:      { label: 'Best',      sym: '\u2605', color: '#81b64c' },
    book:      { label: 'Book',      sym: '\u{1F4D6}', color: '#a3a3a3' },
    excellent: { label: 'Excellent', sym: '\u2713', color: '#95bb4a' },
    good:      { label: 'Good',      sym: '\u2713', color: '#96af8b' },
    inaccuracy:{ label: 'Inaccuracy',sym: '?!', color: '#f7c631' },
    mistake:   { label: 'Mistake',   sym: '?',  color: '#ffa459' },
    blunder:   { label: 'Blunder',   sym: '??', color: '#fa412d' },
  };

  // ── State ──────────────────────────────────────────────────────────────────
  let ui = null;
  let moves = [];        // array of SAN strings
  let positions = [];    // array of FENs, positions[0] = start, positions[i] = after move i
  let analysis = [];     // per position: { scoreWhite (cp, white POV), best: uci }
  let perMove = [];      // per move: { san, cls, cpl, acc, color }
  let currentPly = 0;
  let analyzing = false;
  let analyzeAbort = false;
  let gameResult = null; // { label } from saved game or PGN header
  let sideAccuracy = { w: null, b: null }; // last computed averages (for nameplates)

  const $ = function (id) { return document.getElementById(id); };

  // ── Win% / accuracy helpers ────────────────────────────────────────────────
  function winPercent(cp) {
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  }
  function moveAccuracy(winBefore, winAfter) {
    const drop = Math.max(0, Math.min(10, winBefore - winAfter));
    const acc = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
    return Math.max(0, Math.min(100, acc));
  }

  // ── Engine wrapper ─────────────────────────────────────────────────────────
  // The worker emits one UCI line per message. Readiness is exposed as a
  // promise resolved on the first "readyok", so callers never race the boot.
  const engine = {
    worker: null,
    ready: false,
    readyPromise: null,
    _readyResolve: null,
    pending: null,   // resolve fn for the in-flight eval
    _lastInfo: null, // most recent "info … pv …" line

    start() {
      this.stop();
      const w = new Worker(SF_PATH);
      this.worker = w;
      this.ready = false;
      this.pending = null;
      this._lastInfo = null;
      const self = this;
      this.readyPromise = new Promise(function (resolve) { self._readyResolve = resolve; });

      w.onmessage = function (evt) {
        const line = typeof evt.data === 'string' ? evt.data : '';
        if (!line) return;
        if (line === 'uciok') {
          w.postMessage('isready');
        } else if (line === 'readyok') {
          if (!self.ready) { self.ready = true; self._readyResolve(true); }
        } else if (line.indexOf('bestmove') === 0) {
          if (self.pending) { const p = self.pending; self.pending = null; p(self._collectResult(line)); }
        } else if (line.indexOf('info') === 0 && line.indexOf(' pv ') !== -1) {
          self._lastInfo = line;
        }
      };
      w.onerror = function () {
        if (!self.ready) self._readyResolve(false);
        if (self.pending) { const p = self.pending; self.pending = null; p(null); }
      };
      w.postMessage('uci');
    },

    stop() {
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.ready = false;
      if (this.pending) { const p = this.pending; this.pending = null; p(null); }
      if (this._readyResolve) { this._readyResolve(false); this._readyResolve = null; }
      this._lastInfo = null;
    },

    _collectResult(bestLine) {
      let score = null, best = null;
      const info = this._lastInfo || '';
      const sm = info.match(/score (cp|mate) (-?\d+)/);
      if (sm) {
        const type = sm[1], val = parseInt(sm[2], 10);
        if (type === 'cp') {
          score = val;
        } else if (val === 0) {
          score = 0; // "mate 0" = game already decided/terminal
        } else {
          // Mate in N → pseudo-cp near ±10000, sign = winning side
          const n = Math.min(Math.abs(val), 50);
          score = val > 0 ? 10000 - n * 100 : -(10000 - n * 100);
        }
      }
      const parts = bestLine.split(/\s+/);
      const bm = parts[1];
      if (bm && bm !== '(none)') best = bm;
      return { score: score, best: best };
    },

    evalPosition(fen, movetime) {
      const self = this;
      return this.readyPromise.then(function (ok) {
        if (!ok || !self.worker) return null;
        self._lastInfo = null;
        return new Promise(function (resolve) {
          let settled = false;
          const done = function (val) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (self.pending === settle) self.pending = null;
            resolve(val);
          };
          const settle = function (val) { done(val); };
          // Watchdog: never let one stuck position freeze the whole review.
          const timer = setTimeout(function () { done(null); }, EVAL_WATCHDOG_MS);
          self.pending = settle;
          self.worker.postMessage('position fen ' + fen);
          self.worker.postMessage('go movetime ' + movetime);
        });
      });
    },
  };

  // Convert engine score (side-to-move POV) to white POV
  function toWhitePov(score, fen) {
    if (score === null) return null;
    const whiteToMove = fen.split(' ')[1] === 'w';
    return whiteToMove ? score : -score;
  }

  // ── Opening detection ──────────────────────────────────────────────────────
  function detectOpening() {
    const seq = moves.join(' ');
    for (let i = 0; i < OPENINGS.length; i++) {
      if (seq === OPENINGS[i][0] || seq.indexOf(OPENINGS[i][0] + ' ') === 0) {
        return OPENINGS[i][1];
      }
    }
    return null;
  }

  function updateOpeningLabel() {
    const el = $('opening-name');
    const name = detectOpening();
    if (name) {
      el.textContent = 'Opening: ' + name;
      el.classList.remove('hidden');
    } else {
      el.textContent = '';
      el.classList.add('hidden');
    }
  }

  // ── Game loading ───────────────────────────────────────────────────────────
  function listSavedGames() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); } catch (e) { /* ignore */ }
    return Array.isArray(saved) ? saved : [];
  }

  function populateSavedGames() {
    const sel = $('game-select');
    sel.innerHTML = '<option value="">— Saved games —</option>';
    listSavedGames().forEach(function (g) {
      const opt = document.createElement('option');
      opt.value = g.id;
      const when = new Date(g.date).toLocaleString();
      opt.textContent = (g.bot ? g.bot.emoji + ' ' + g.bot.name : 'Game') + ' · ' + g.result + ' · ' + when;
      sel.appendChild(opt);
    });
  }

  function loadSavedGame(id) {
    const g = listSavedGames().find(function (x) { return x.id === id; });
    if (!g) return false;
    const chess = new Chess();
    try {
      if (g.pgn) {
        try { chess.loadPgn(g.pgn); } catch (e) { /* fall back to moves */ }
      }
      if (chess.history().length === 0 && g.moves) {
        g.moves.forEach(function (m) { chess.move(m); });
      }
    } catch (e) { return false; }
    if (chess.history().length === 0) return false;
    gameResult = { label: g.result || null, sub: g.resultSub || null };
    setGame(chess);
    $('load-status').textContent = 'Loaded: ' + (g.bot ? g.bot.name + ' ' + g.result : g.result);
    const sel = $('game-select');
    if (sel.value !== id) sel.value = id;
    return true;
  }

  // chess.js v1.x loadPgn()/load() THROW on failure and return undefined on
  // success — never trust a boolean return from them.
  function parseGameText(text) {
    const chess = new Chess();
    try {
      chess.loadPgn(text);
      if (chess.history().length > 0) return chess;
    } catch (e) { /* not a PGN */ }
    try {
      chess.load(text);
      return chess;
    } catch (e2) { /* not a FEN either */ }
    return null;
  }

  function loadPastedText() {
    const text = $('pgn-input').value.trim();
    if (!text) return;
    const chess = parseGameText(text);
    if (!chess || chess.history().length === 0) {
      $('load-status').textContent = 'Could not parse PGN/FEN.';
      return;
    }
    const rm = text.match(/\[Result\s+"([^"]+)"\]/);
    gameResult = { label: rm ? rm[1] : null, sub: null };
    setGame(chess);
    $('load-status').textContent = 'Loaded ' + chess.history().length + ' moves.';
  }

  function cancelAnalysis() {
    if (analyzing) analyzeAbort = true;
  }

  function setGame(chess) {
    cancelAnalysis();
    moves = chess.history();
    // Rebuild positions: start FEN then after each move
    const replay = new Chess();
    positions = [replay.fen()];
    moves.forEach(function (san) {
      replay.move(san);
      positions.push(replay.fen());
    });
    analysis = positions.map(function () { return null; });
    perMove = [];
    sideAccuracy = { w: null, b: null };
    currentPly = 0;
    $('btn-analyze').disabled = moves.length === 0;
    $('btn-analyze').textContent = 'Analyze';
    $('summary').classList.add('hidden');
    $('review-line').classList.add('hidden');
    $('progress-bar').style.width = '0%';
    $('progress-text').textContent = '';
    updateOpeningLabel();
    updatePlates();
    renderMoveList();
    buildGraph();
    navigate(0);
  }

  // ── Analysis pipeline ──────────────────────────────────────────────────────
  function getMovetime() {
    const v = parseInt($('depth-select').value, 10);
    return (v === 100 || v === 250 || v === 600) ? v : 250;
  }

  function setNavEnabled(enabled) {
    ['btn-first', 'btn-prev', 'btn-next', 'btn-last', 'btn-prev-sticky', 'btn-next-sticky']
      .forEach(function (id) { $(id).disabled = !enabled; });
  }

  function setProgress(done, total) {
    $('progress-bar').style.width = Math.round((done / total) * 100) + '%';
    $('progress-text').textContent = 'Analyzing\u2026 ' + done + '/' + total;
  }

  async function runAnalysis() {
    if (analyzing || moves.length === 0) return;
    analyzing = true;
    analyzeAbort = false;
    $('btn-analyze').disabled = true;
    $('btn-load-pgn').disabled = true;
    $('game-select').disabled = true;
    setNavEnabled(false);
    const movetime = getMovetime();
    const fens = positions.slice();               // snapshot: a game reload mid-run can't skew results
    const total = fens.length;
    const results = new Array(total).fill(null);
    setProgress(0, total);

    // Fresh engine worker; explicitly wait for readyok before querying.
    engine.start();
    const ready = await engine.readyPromise;

    if (ready && !analyzeAbort) {
      for (let idx = 0; idx < total; idx++) {
        if (analyzeAbort) break;
        const res = await engine.evalPosition(fens[idx], movetime);
        if (analyzeAbort) break;
        results[idx] = res
          ? { scoreWhite: toWhitePov(res.score, fens[idx]), best: res.best }
          : null;
        setProgress(idx + 1, total);
      }
    } else if (!analyzeAbort) {
      $('load-status').textContent = 'Engine failed to start — no review data.';
    }

    if (!analyzeAbort) analysis = results;
    finishAnalysis();
  }

  function finishAnalysis() {
    const aborted = analyzeAbort;
    analyzing = false;
    analyzeAbort = false;
    setNavEnabled(true);
    $('btn-analyze').disabled = moves.length === 0;
    $('btn-load-pgn').disabled = false;
    $('game-select').disabled = false;
    if (aborted) {
      $('progress-text').textContent = '';
      return;
    }
    $('btn-analyze').textContent = 'Re-analyze';
    setProgress(positions.length, positions.length);
    $('progress-text').textContent = 'Done \u00b7 ' + positions.length + ' positions';
    classifyAll();
    renderMoveList();
    buildGraph();
    buildSummary();
    navigate(currentPly); // refresh arrows/eval/graph highlight
  }

  // ══ Classification calibration ════════════════════════════════════════════
  // cp loss (cpl) = bestVal − playedVal, both from the mover's point of view.
  //   best       played move == engine top choice (SAN-normalized). Honest
  //              signal — never capped.
  //   great      cpl ≤ 10 (not the engine top) · excellent ≤ 25 · good ≤ 50 ·
  //              inaccuracy ≤ 100 · mistake ≤ 250 · blunder > 250.
  //   book       first 10 plies from the small opening set, but ONLY while
  //              the move costs < 150 cp; a "book" move losing ≥ 150 cp is
  //              reclassified by its cp loss.
  //   escalation win%-drop > 20 pts forces at least "mistake", > 30 pts
  //              forces "blunder" (worse wins) — catches shallow-eval noise
  //              the cp bands alone would understate.
  //   dead-equal when BOTH bestVal and playedVal sit within ±50 cp of zero
  //              nothing real is lost, so classification is capped at
  //              "inaccuracy" (a brilliant is exempt: an equalizing
  //              sacrifice can be the whole point of the move).
  //   brilliant  deliberately RARE — all four gates must pass:
  //                (a) played move is the engine's top choice,
  //                (b) genuine sacrifice: the opponent can actually WIN ≥ 2
  //                    pawns of material through a capture chain, with the
  //                    mover's recaptures counted (a defended capture or a
  //                    simple trade is NOT a sacrifice),
  //                (c) the eval still holds for the mover (playedVal ≥ −30),
  //                (d) the sacrifice was not the only legal move.
  //              A quiet opening must therefore produce ZERO brilliants.
  const MATE_ZONE = 5000;        // |eval| beyond this = mate-decided outcome
  const MATE_CLAMP = 9000;       // clamp for mixed mate/cp subtraction
  const BRILLIANT_MIN_VAL = -30; // sacrifice must not lose the eval (mover POV)
  const DEAD_EQUAL_BAND = 50;    // ±cp of zero = dead-equal position
  const BOOK_MAX_CPL = 150;      // book move costing ≥ this is not "book"
  const SAC_DEPTH = 4;           // plies of capture chain for the sac test
  const PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  function clampEval(v) {
    return Math.max(-MATE_CLAMP, Math.min(MATE_CLAMP, v));
  }

  // cp loss for the mover. Mate-encoded pseudo-cp (±(10000 − n·100)) is
  // clamped so a subtraction across the mate boundary can't explode.
  function moveCpl(bestVal, playedVal) {
    if (bestVal === null || playedVal === null) return 0;
    const bMate = Math.abs(bestVal) >= MATE_ZONE;
    const pMate = Math.abs(playedVal) >= MATE_ZONE;
    if (bMate && pMate) {
      // Mate-decided on both sides of the move: same outcome costs nothing,
      // a flipped outcome (winning → getting mated) is a hard blunder.
      return Math.sign(bestVal) === Math.sign(playedVal) ? 0 : 2000;
    }
    return Math.max(0, clampEval(bestVal) - clampEval(playedVal));
  }

  // Escalate cls to target ('mistake'|'blunder'); blunder always wins.
  function worseClass(cls, target) {
    return cls === 'blunder' ? 'blunder' : target;
  }

  function classifyAll() {
    perMove = [];
    for (let i = 0; i < moves.length; i++) {
      const fenBefore = positions[i];
      const moverIsWhite = fenBefore.split(' ')[1] === 'w';
      const before = analysis[i];
      const after = analysis[i + 1];

      // Best-move value from mover POV = engine score at position i
      const bestVal = before && before.scoreWhite !== null && before.scoreWhite !== undefined
        ? (moverIsWhite ? before.scoreWhite : -before.scoreWhite) : null;
      // Played-move value from mover POV = -(score after, opponent POV)
      const playedVal = after && after.scoreWhite !== null && after.scoreWhite !== undefined
        ? (moverIsWhite ? -after.scoreWhite : after.scoreWhite) : null;

      const cpl = moveCpl(bestVal, playedVal);

      const san = moves[i];
      const hasEval = bestVal !== null && playedVal !== null;
      const isBookMove = i < 10 && BOOK.has(san);
      const playedBest = !!(before && before.best &&
        playedBestMatches(before.best, positions[i], san));

      let cls = null;
      if (playedBest) cls = 'best';
      else if (!hasEval) cls = null; // engine data missing — no badge
      else if (isBookMove && cpl < BOOK_MAX_CPL) cls = 'book';
      else if (cpl <= 10) cls = 'great';
      else if (cpl <= 25) cls = 'excellent';
      else if (cpl <= 50) cls = 'good';
      else if (cpl <= 100) cls = 'inaccuracy';
      else if (cpl <= 250) cls = 'mistake';
      else cls = 'blunder';

      // Brilliant: see calibration notes above — all four gates must pass.
      if (playedBest && hasEval &&
          playedVal >= BRILLIANT_MIN_VAL &&
          isSacrifice(fenBefore, san)) {
        cls = 'brilliant';
      }

      // Win%-drop escalation (in addition to the cp bands, take the worse).
      if (hasEval) {
        const wpDrop = winPercent(bestVal) - winPercent(playedVal);
        if (wpDrop > 30) cls = worseClass(cls, 'blunder');
        else if (wpDrop > 20) cls = worseClass(cls, 'mistake');
      }

      // Dead-equal cap: near-zero either way ⇒ nothing worse than inaccuracy.
      if (hasEval && cls !== 'brilliant' &&
          Math.abs(bestVal) <= DEAD_EQUAL_BAND &&
          Math.abs(playedVal) <= DEAD_EQUAL_BAND &&
          (cls === 'mistake' || cls === 'blunder')) {
        cls = 'inaccuracy';
      }

      // Accuracy from win% perspective (only meaningful with engine data)
      let acc = null;
      if (hasEval) acc = moveAccuracy(winPercent(bestVal), winPercent(playedVal));

      perMove.push({ san: san, cls: cls, cpl: cpl, acc: acc, color: moverIsWhite ? 'w' : 'b' });
    }
  }

  function playedBestMatches(bestUci, fen, san) {
    // Verify engine best uci equals the played SAN by trying it
    try {
      const probe = new Chess(fen);
      const from = bestUci.slice(0, 2), to = bestUci.slice(2, 4);
      const promo = bestUci.length === 5 ? bestUci[4] : undefined;
      const mv = probe.move({ from: from, to: to, promotion: promo || 'q' });
      if (!mv) return false;
      return mv.san.replace(/[+#]/g, '') === san.replace(/[+#]/g, '');
    } catch (e) { return false; }
  }

  // Net material (in pawn units) the side to move can win with a chain of
  // captures, assuming the opponent recaptures — a miniature capture-only
  // search. Captures are optional, so the result never drops below zero.
  // Only invoked for engine-top matches, so the recursive cost is negligible.
  function captureNet(chess, depth) {
    if (depth <= 0) return 0;
    let best = 0;
    const caps = chess.moves({ verbose: true })
      .filter(function (m) { return m.captured; })
      .sort(function (a, b) { return PIECE_VAL[b.captured] - PIECE_VAL[a.captured]; });
    for (let i = 0; i < caps.length; i++) {
      const gain = PIECE_VAL[caps[i].captured];
      if (gain <= best) continue; // even a clean win can't beat current best
      chess.move(caps[i]);
      const recapture = captureNet(chess, depth - 1);
      chess.undo();
      if (gain - recapture > best) best = gain - recapture;
    }
    return best;
  }

  // A genuine sacrifice: after playing `san`, the opponent has a capture
  // chain that nets ≥ 2 pawns WITH the mover's recaptures counted (so a
  // defended capture or an even trade is NOT a sacrifice), and the move was
  // not the only legal option.
  function isSacrifice(fen, san) {
    try {
      const probe = new Chess(fen);
      if (probe.moves().length <= 1) return false; // (d) forced move
      const mv = probe.move(san);
      if (!mv) return false;
      return captureNet(probe, SAC_DEPTH) >= 2;    // (b) opponent can win ≥ 2 pawns
    } catch (e) { return false; }
  }

  // ── Navigation / board view ────────────────────────────────────────────────
  function navigate(ply) {
    currentPly = Math.max(0, Math.min(moves.length, ply));
    const replay = new Chess();
    for (let i = 0; i < currentPly; i++) replay.move(moves[i]);

    ui.setGame(replay);
    const last = currentPly > 0 ? replay.history({ verbose: true }).slice(-1)[0] : null;
    ui.setLastMove(last ? { from: last.from, to: last.to } : null);

    // Eval bar: evaluation of the CURRENT position (white POV)
    const cur = analysis[currentPly];
    const curCp = cur && cur.scoreWhite !== undefined && cur.scoreWhite !== null
      ? cur.scoreWhite : 20;
    ui.setEvalBar(curCp);

    // Guide arrows: blue = the move actually played into this position,
    // green = the engine's best move from here. On the start ply only the
    // green suggestion is drawn. Both stay visible when they coincide.
    const arrows = [];
    if (last) arrows.push({ from: last.from, to: last.to, color: 'blue' });
    if (cur && cur.best) {
      arrows.push({
        from: cur.best.slice(0, 2),
        to: cur.best.slice(2, 4),
        color: 'green',
      });
    }
    ui.setArrows(arrows);

    ui.refresh();
    highlightCurrentMove();
    markGraphPosition();
  }

  function highlightCurrentMove() {
    const curIdx = Math.floor((currentPly - 1) / 2);
    moveListEl.querySelectorAll('.am-row').forEach(function (row, idx) {
      row.classList.toggle('current', currentPly > 0 && idx === curIdx);
    });
    const cur = moveListEl.querySelector('.am-row.current');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  // ── Rendering panels ───────────────────────────────────────────────────────
  const moveListEl = $('move-list');

  function renderMoveList() {
    moveListEl.innerHTML = '';
    if (moves.length === 0) {
      moveListEl.innerHTML = '<div class="empty-hint">Load a game, then press <b>Analyze</b>.</div>';
      buildLegend();
      return;
    }
    for (let i = 0; i < moves.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'am-row';
      const no = document.createElement('span');
      no.className = 'am-no';
      no.textContent = (i / 2 + 1) + '.';
      row.appendChild(no);
      row.appendChild(moveCell(i));
      row.appendChild(moveCell(i + 1));
      row.addEventListener('click', (function (ply) {
        return function () { if (!analyzing) navigate(ply + 1); };
      })(i));
      moveListEl.appendChild(row);
    }
    buildLegend();
  }

  // ── Badge legend: color dot + label (+ count for this game) ────────────────
  function buildLegend() {
    const el = $('badge-legend');
    if (!el) return;
    const counts = {};
    perMove.forEach(function (pm) {
      if (pm.cls) counts[pm.cls] = (counts[pm.cls] || 0) + 1;
    });
    el.innerHTML = '';
    CLASS_ORDER.forEach(function (cls) {
      const meta = CLASS_META[cls];
      const item = document.createElement('span');
      item.className = 'lg-item';
      const dot = document.createElement('span');
      dot.className = 'lg-dot';
      dot.style.background = meta.color;
      item.appendChild(dot);
      item.appendChild(document.createTextNode(meta.label));
      if (perMove.length > 0) {
        const n = counts[cls] || 0;
        const cnt = document.createElement('span');
        cnt.className = 'lg-count' + (n ? '' : ' zero');
        cnt.textContent = String(n);
        item.appendChild(cnt);
      }
      el.appendChild(item);
    });
  }

  function moveCell(ply) {
    const cell = document.createElement('span');
    cell.className = 'am-san';
    if (ply >= moves.length) return cell;
    cell.textContent = moves[ply];
    const pm = perMove[ply];
    if (pm && pm.cls && CLASS_META[pm.cls]) {
      const meta = CLASS_META[pm.cls];
      const badge = document.createElement('span');
      badge.className = 'cls-badge';
      badge.style.color = meta.color;
      badge.title = meta.label + (pm.cpl ? ' (\u2212' + Math.round(pm.cpl) + 'cp)' : '');
      badge.textContent = meta.sym;
      cell.appendChild(badge);
      cell.classList.add('cls-' + pm.cls);
    }
    cell.addEventListener('click', function (evt) {
      evt.stopPropagation();
      if (!analyzing) navigate(ply + 1);
    });
    return cell;
  }

  function buildSummary() {
    const accs = { w: [], b: [] };
    const counts = { w: {}, b: {} };
    perMove.forEach(function (pm) {
      if (pm.acc !== null) accs[pm.color].push(pm.acc);
      if (pm.cls) counts[pm.color][pm.cls] = (counts[pm.color][pm.cls] || 0) + 1;
    });
    const avg = function (arr) {
      return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null;
    };

    sideAccuracy = { w: avg(accs.w), b: avg(accs.b) };

    $('summary').classList.remove('hidden');
    ['w', 'b'].forEach(function (c) {
      const acc = sideAccuracy[c];
      $('acc-' + c).textContent = acc === null ? '\u2014' : acc.toFixed(1) + '%';
      const chips = $('counts-' + c);
      chips.innerHTML = '';
      CLASS_ORDER.forEach(function (cls) {
        const n = counts[c][cls] || 0;
        if (!n) return;
        const chip = document.createElement('span');
        chip.className = 'cls-chip';
        chip.style.borderColor = CLASS_META[cls].color;
        chip.style.color = CLASS_META[cls].color;
        chip.textContent = n + ' ' + CLASS_META[cls].label;
        chips.appendChild(chip);
      });
    });

    // Summary line in the panel header: result + both accuracies
    const line = $('review-line');
    const parts = [];
    if (gameResult && gameResult.label) {
      parts.push(gameResult.label + (gameResult.sub ? ' (' + gameResult.sub + ')' : ''));
    }
    if (sideAccuracy.w !== null) parts.push('White ' + sideAccuracy.w.toFixed(1) + '%');
    if (sideAccuracy.b !== null) parts.push('Black ' + sideAccuracy.b.toFixed(1) + '%');
    if (parts.length) {
      line.textContent = parts.join(' \u00b7 ');
      line.classList.remove('hidden');
    } else {
      line.textContent = '';
      line.classList.add('hidden');
    }
    updatePlates();
  }

  // ── Nameplates (top = opposite of orientation; swap on flip) ───────────────
  function updatePlates() {
    const topIsWhite = ui.orientation === 'b';
    const sides = topIsWhite ? { top: 'w', bottom: 'b' } : { top: 'b', bottom: 'w' };
    $('plate-top-avatar').textContent = sides.top === 'w' ? '\u2654' : '\u265A';
    $('plate-bottom-avatar').textContent = sides.bottom === 'w' ? '\u2654' : '\u265A';
    $('plate-top-name').textContent = sides.top === 'w' ? 'White' : 'Black';
    $('plate-bottom-name').textContent = sides.bottom === 'w' ? 'White' : 'Black';
    const accTxt = function (side) {
      const a = sideAccuracy[side];
      return a === null ? '' : a.toFixed(1) + '% accuracy';
    };
    $('plate-top-acc').textContent = accTxt(sides.top);
    $('plate-bottom-acc').textContent = accTxt(sides.bottom);
  }

  // ── Eval graph ─────────────────────────────────────────────────────────────
  function buildGraph() {
    const graph = $('eval-graph');
    graph.innerHTML = '';
    if (moves.length === 0) return;

    positions.forEach(function (fen, ply) {
      const bar = document.createElement('div');
      bar.className = 'eg-col';
      const a = analysis[ply];
      const cp = a && a.scoreWhite !== null && a.scoreWhite !== undefined
        ? Math.max(-1500, Math.min(1500, a.scoreWhite)) : 0;
      const wp = winPercent(cp); // 0..100 white share
      bar.innerHTML =
        '<div class="eg-black" style="height:' + (100 - wp) + '%"></div>' +
        '<div class="eg-white" style="height:' + wp + '%"></div>';
      bar.title = graphTooltip(ply, cp);
      bar.addEventListener('click', (function (p) { return function () { if (!analyzing) navigate(p); }; })(ply));
      graph.appendChild(bar);
    });
    markGraphPosition();
  }

  function graphTooltip(ply, cp) {
    let label = 'Start';
    if (ply > 0) {
      const no = Math.ceil(ply / 2);
      label = no + '. ' + moves[ply - 1] + (ply % 2 === 0 ? '' : ' \u2026');
    }
    const sign = cp > 0 ? '+' : (cp < 0 ? '\u2212' : '');
    let tip = label + ' \u00b7 eval ' + sign + Math.abs(cp / 100).toFixed(1);
    const a = analysis[ply];
    if (a && a.best) tip += ' \u00b7 best: ' + a.best;
    return tip;
  }

  function markGraphPosition() {
    $('eval-graph').querySelectorAll('.eg-col').forEach(function (col, idx) {
      col.classList.toggle('current', idx === currentPly);
    });
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  ui = new BoardUI('board-mount', {
    orientation: 'w',
    evalBar: true,
    canPick: function () { return false; }, // viewer mode
    onUserMove: null,
  });
  ui.setGame(new Chess());
  ui.refresh();

  $('btn-analyze').addEventListener('click', runAnalysis);
  $('btn-load-pgn').addEventListener('click', loadPastedText);
  $('game-select').addEventListener('change', function () {
    if (this.value) loadSavedGame(this.value);
  });

  $('btn-first').addEventListener('click', function () { navigate(0); });
  $('btn-prev').addEventListener('click', function () { navigate(currentPly - 1); });
  $('btn-next').addEventListener('click', function () { navigate(currentPly + 1); });
  $('btn-last').addEventListener('click', function () { navigate(moves.length); });
  $('btn-flip').addEventListener('click', function () { ui.flip(); updatePlates(); });

  $('btn-prev-sticky').addEventListener('click', function () { navigate(currentPly - 1); });
  $('btn-next-sticky').addEventListener('click', function () { navigate(currentPly + 1); });

  document.addEventListener('keydown', function (evt) {
    const tag = evt.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
    if (analyzing) return; // nav is disabled while the engine scans
    if (evt.key === 'ArrowLeft') navigate(currentPly - 1);
    else if (evt.key === 'ArrowRight') navigate(currentPly + 1);
    else if (evt.key === 'Home') navigate(0);
    else if (evt.key === 'End') navigate(moves.length);
    else if (evt.key === 'f' || evt.key === 'F') { ui.flip(); updatePlates(); }
  });

  populateSavedGames();
  renderMoveList();
  updatePlates();

  // Auto-load ?game=<id> (play page links here for auto-review)
  const params = new URLSearchParams(window.location.search);
  const autoId = params.get('game');
  if (autoId) {
    if (loadSavedGame(autoId)) {
      runAnalysis(); // waits for engine readyok internally
    } else {
      $('load-status').textContent = 'Saved game not found: ' + autoId;
    }
  }
})(window);
