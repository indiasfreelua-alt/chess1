/**
 * online.js — Play Online (peer-to-peer via PeerJS WebRTC data channels)
 *
 * Architecture notes:
 *  - Signaling uses PeerJS's free public broker (no API key). The room code
 *    maps to a deterministic peer id: 'lc-' + CODE. The host registers that
 *    id; the guest connects to it. Moves travel browser-to-browser over a
 *    WebRTC data channel — no game server involved.
 *  - Both sides keep their own chess.js instance and validate every received
 *    move. Ply-index mismatch triggers an automatic state resync.
 *  - Protocol messages: hello, start, move, sync-req, sync, resign, rematch, bye
 */
(function (global) {
  'use strict';

  const SAVE_KEY = 'chess_saved_games';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

  const $ = function (id) { return document.getElementById(id); };

  // ── State ──────────────────────────────────────────────────────────────────
  let peer = null;          // PeerJS peer
  let conn = null;          // active DataConnection
  let game = null;          // Chess instance
  let ui = null;            // BoardUI (game screen)
  let previewUi = null;     // idle board (lobby)
  let myColor = 'w';
  let isHost = false;
  let roomCode = '';
  let connected = false;
  let gameOver = false;
  let lastSyncPly = -1;     // last ply we know the opponent agrees on

  // ── Helpers ────────────────────────────────────────────────────────────────
  function makeCode() {
    let c = '';
    for (let i = 0; i < 6; i++) {
      c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return c;
  }

  function setStatus(text) { $('status').textContent = text; }
  function setConnState(text) {
    const el = $('conn-state');
    el.textContent = text || '';
    el.classList.toggle('visible', !!text);
  }
  function lobbyStatus(text) { $('room-status').textContent = text || ''; }

  function showLobby() {
    $('game-view').classList.remove('active');
    $('lobby-view').classList.add('active');
  }
  function showGame() {
    $('lobby-view').classList.remove('active');
    $('game-view').classList.add('active');
  }

  function cleanupConn() {
    if (conn) { try { conn.close(); } catch (e) { /* ignore */ } conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) { /* ignore */ } peer = null; }
    connected = false;
  }

  // ── Message protocol ───────────────────────────────────────────────────────
  function send(obj) {
    if (conn && conn.open) conn.send(obj);
  }

  function onMessage(data) {
    if (!data || typeof data !== 'object') return;
    switch (data.t) {
      case 'hello':
        // Host receives guest hello -> assign colors and start.
        if (isHost) {
          myColor = Math.random() < 0.5 ? 'w' : 'b';
          const oppColor = myColor === 'w' ? 'b' : 'w';
          send({ t: 'start', yourColor: oppColor, hostColor: myColor });
          beginGame(myColor);
        }
        break;

      case 'start':
        if (!isHost) beginGame(data.yourColor);
        break;

      case 'move':
        receiveMove(data);
        break;

      case 'sync-req':
        send({ t: 'sync', moves: game.history(), ply: game.history().length });
        break;

      case 'sync':
        applySync(data);
        break;

      case 'resign':
        finishGame('You won!', 'opponent resigned', true);
        break;

      case 'rematch':
        // Guest accepts host rematch instantly; host decides colors again.
        if (!isHost) {
          beginGameRematch();
        }
        break;

      case 'rematch-start':
        beginGameRematch(data.yourColor);
        break;

      case 'bye':
        setStatus('Opponent left the room');
        connected = false;
        break;
    }
  }

  function receiveMove(msg) {
    if (gameOver) return;
    const history = game.history();
    if (typeof msg.ply === 'number' && msg.ply !== history.length) {
      // Out of sync — request authoritative state from the other side.
      send({ t: 'sync-req' });
      return;
    }
    const mv = game.move({ from: msg.from, to: msg.to, promotion: msg.promo || 'q' });
    if (!mv) {
      send({ t: 'sync-req' });
      return;
    }
    lastSyncPly = game.history().length;
    ui.setLastMove({ from: mv.from, to: mv.to });
    ui.refresh();
    updateMoveList();
    updateStatus();
    maybeFinish();
  }

  function applySync(msg) {
    if (!Array.isArray(msg.moves)) return;
    const replay = new global.Chess();
    let ok = true;
    try {
      msg.moves.forEach(function (san) { if (!replay.move(san)) ok = false; });
    } catch (e) { ok = false; }
    if (!ok) return;
    game = replay;
    lastSyncPly = game.history().length;
    ui.setGame(game);
    const hist = game.history({ verbose: true });
    const last = hist.length ? hist[hist.length - 1] : null;
    ui.setLastMove(last ? { from: last.from, to: last.to } : null);
    ui.refresh();
    updateMoveList();
    updateStatus();
    maybeFinish();
  }

  // ── Game lifecycle ─────────────────────────────────────────────────────────
  function beginGame(color) {
    myColor = color;
    gameOver = false;
    lastSyncPly = 0;
    game = new global.Chess();
    buildGameBoard();
    updateStatus();
    updateMoveList();
    showGame();
  }

  function beginGameRematch(myNextColor) {
    if (typeof myNextColor !== 'string') {
      myNextColor = myColor === 'w' ? 'b' : 'w';
    }
    beginGame(myNextColor);
  }

  function buildGameBoard() {
    ui = new BoardUI('board-mount-g', {
      orientation: myColor,
      canPick: function (sq, piece) {
        return connected && !gameOver &&
               piece.color === myColor && game.turn() === myColor;
      },
      onUserMove: function (from, to, promo) {
        const mv = game.move({ from: from, to: to, promotion: promo || 'q' });
        if (!mv) return;
        send({ t: 'move', from: mv.from, to: mv.to, promo: mv.promotion, ply: game.history().length });
        ui.setLastMove({ from: mv.from, to: mv.to });
        ui.refresh();
        updateMoveList();
        updateStatus();
        maybeFinish();
      },
    });
    ui.setGame(game);
    ui.refresh();

    $('plate-opp').innerHTML =
      '<span class="plate-avatar">\u{1F465}</span><span>Friend <small>(' + (myColor === 'w' ? 'black' : 'white') + ')</small></span>';
    $('plate-me').innerHTML =
      '<span class="plate-avatar">\u{1F9CD}</span><span>You <small>(' + (myColor === 'w' ? 'white' : 'black') + ')</small></span>';
  }

  function updateStatus() {
    let text;
    if (!connected) {
      text = 'Opponent disconnected';
    } else if (game.isCheckmate()) {
      text = game.turn() === myColor ? 'Checkmate — you lose' : 'Checkmate — you win!';
    } else if (game.isDraw()) {
      text = 'Draw';
    } else if (game.isCheck()) {
      text = game.turn() === myColor ? 'You are in check!' : 'Opponent is in check';
    } else {
      text = game.turn() === myColor ? 'Your move' : 'Waiting for opponent…';
    }
    setStatus(text);
  }

  function updateMoveList() {
    const history = game.history({ verbose: true });
    const el = $('move-list');
    el.innerHTML = '';
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
      el.appendChild(row);
    }
    el.scrollTop = el.scrollHeight;
  }

  function maybeFinish() {
    if (gameOver || !game.isGameOver()) return;
    gameOver = true;
    let result, sub;
    if (game.isCheckmate()) {
      result = game.turn() === myColor ? 'You lost' : 'You won!';
      sub = 'by checkmate';
    } else if (game.isStalemate()) { result = 'Draw'; sub = 'by stalemate'; }
    else if (game.isThreefoldRepetition()) { result = 'Draw'; sub = 'by repetition'; }
    else if (game.isInsufficientMaterial()) { result = 'Draw'; sub = 'insufficient material'; }
    else { result = 'Draw'; sub = '50-move rule'; }
    finishGame(result, sub, false);
  }

  function finishGame(result, sub, fromOpponentAction) {
    gameOver = true;
    const id = saveGame(result, sub);
    $('result-text').textContent = result;
    $('result-sub').textContent = sub;
    $('btn-analyze').onclick = function () {
      window.location.href = '/analysis?game=' + id;
    };
    // Only the host may propose a rematch (single source of truth).
    $('btn-rematch').classList.toggle('hidden', !isHost || !connected);
    $('result-modal').classList.add('visible');
    if (fromOpponentAction) setConnState('');
  }

  function saveGame(result, sub) {
    const id = 'g' + Date.now();
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); } catch (e) { /* ignore */ }
    saved.unshift({
      id: id,
      date: new Date().toISOString(),
      bot: { id: 'online', name: 'Online friend', rating: null, emoji: '\u{1F465}' },
      playerColor: myColor,
      pgn: game.pgn(),
      moves: game.history(),
      result: result,
      resultSub: sub,
    });
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved.slice(0, 50))); } catch (e) { /* ignore */ }
    return id;
  }

  // ── Host / Join ────────────────────────────────────────────────────────────
  function hostRoom() {
    cleanupConn();
    roomCode = makeCode();
    isHost = true;
    lobbyStatus('Connecting to signaling…');
    $('room-panel').classList.add('hidden');

    peer = new global.Peer('lc-' + roomCode);
    peer.on('open', function () {
      $('room-code').textContent = roomCode;
      $('room-panel').classList.remove('hidden');
      $('waiting').style.display = 'flex';
      lobbyStatus('Room ready — share the code!');
    });
    peer.on('connection', function (c) {
      if (conn) { try { c.close(); } catch (e) { /* ignore */ } return; } // one opponent
      conn = c;
      wireConn();
    });
    peer.on('error', function (err) {
      if (err && err.type === 'unavailable-id') {
        hostRoom(); // code collision — pick another
      } else {
        lobbyStatus('Connection problem: ' + (err && err.type ? err.type : 'unknown'));
      }
    });
  }

  function joinRoom() {
    const code = ($('join-code').value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      lobbyStatus('Enter a 6-character code.');
      return;
    }
    cleanupConn();
    isHost = false;
    roomCode = code;
    lobbyStatus('Looking for room ' + code + '…');

    peer = new global.Peer();
    peer.on('open', function () {
      conn = peer.connect('lc-' + code, { reliable: true });
      wireConn();
      conn.on('error', function () {
        lobbyStatus('Could not reach room ' + code + '.');
      });
    });
    peer.on('error', function (err) {
      if (err && err.type === 'peer-unavailable') {
        lobbyStatus('Room ' + code + ' not found. Check the code.');
      } else {
        lobbyStatus('Connection problem: ' + (err && err.type ? err.type : 'unknown'));
      }
    });
  }

  function wireConn() {
    conn.on('open', function () {
      connected = true;
      lobbyStatus('Opponent connected!');
      if (isHost) {
        // Host waits for the guest hello before assigning colors.
        $('waiting').style.display = 'none';
      } else {
        send({ t: 'hello' });
      }
    });
    conn.on('data', onMessage);
    conn.on('close', function () {
      connected = false;
      if (!gameOver && game) {
        setStatus('Opponent disconnected');
        setConnState('disconnected');
      }
    });
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  $('btn-create').addEventListener('click', hostRoom);
  $('btn-join').addEventListener('click', joinRoom);
  $('join-code').addEventListener('keydown', function (evt) {
    if (evt.key === 'Enter') joinRoom();
  });
  $('join-code').addEventListener('input', function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  $('btn-copy').addEventListener('click', function () {
    const code = roomCode;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code);
    } else {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      ta.remove();
    }
    lobbyStatus('Code copied: ' + code);
  });
  $('btn-lobby').addEventListener('click', function () {
    send({ t: 'bye' });
    cleanupConn();
    showLobby();
  });
  $('btn-resign').addEventListener('click', function () {
    if (gameOver || !game) return;
    send({ t: 'resign' });
    finishGame('You lost', 'you resigned', false);
  });
  $('btn-flip').addEventListener('click', function () { ui && ui.flip(); });
  $('btn-rematch').addEventListener('click', function () {
    if (!isHost) return;
    const oppColor = myColor === 'w' ? 'b' : 'w';
    send({ t: 'rematch-start', yourColor: oppColor });
    beginGameRematch(myColor === 'w' ? 'b' : 'w');
  });
  $('btn-result-close').addEventListener('click', function () {
    $('result-modal').classList.remove('visible');
  });

  window.addEventListener('beforeunload', function () {
    send({ t: 'bye' });
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  showLobby();
  previewUi = new BoardUI('board-mount', {
    orientation: 'w',
    canPick: function () { return false; },
  });
  previewUi.setGame(new global.Chess());
  previewUi.refresh();
  $('plate-top').innerHTML =
    '<span class="plate-avatar">\u{1F464}</span><span>Friend <small>(will join by code)</small></span>';
  $('plate-bottom').innerHTML =
    '<span class="plate-avatar">\u{1F9CD}</span><span>You</span>';

  if (typeof global.Peer === 'undefined') {
    lobbyStatus('PeerJS failed to load — check your internet connection.');
  }
})(window);
