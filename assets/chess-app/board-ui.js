/**
 * board-ui.js — Reusable chess board renderer
 * Renders an 8x8 board from a chess.js instance. Used by play, analysis and
 * puzzle pages. Original implementation for the local REA test harness.
 *
 * Usage:
 *   const ui = new BoardUI(containerEl, {
 *     orientation: 'w',                 // 'w' | 'b'
 *     onUserMove: (from, to) => {},     // called after user picks a target
 *     canPick: (sq, piece) => true,     // whether a square may be selected
 *   });
 *   ui.setGame(chessInstance);
 *   ui.refresh();
 *
 * Extras:
 *   ui.setLastMove({from, to} | null)   — highlight last move
 *   ui.setArrows([{from, to, color}])   — SVG arrows overlay ('green'|'blue'|'red')
 *   ui.setEvalBar(cp | null)            — vertical eval bar (centipawns, white POV)
 *   ui.flip() / ui.setOrientation(o)
 *   ui.clearSelection()
 *   BoardUI.showPromotion(color, cb)    — shared promotion dialog (cb receives 'q'|'r'|'b'|'n')
 */
(function (global) {
  'use strict';

  const GLYPHS = {
    // Both colors use the filled glyphs; CSS classes (fill + text-stroke)
    // distinguish white/black, giving solid, high-contrast pieces.
    wK: '\u265A', wQ: '\u265B', wR: '\u265C', wB: '\u265D', wN: '\u265E', wP: '\u265F',
    bK: '\u265A', bQ: '\u265B', bR: '\u265C', bB: '\u265D', bN: '\u265E', bP: '\u265F',
  };

  const ARROW_COLORS = { green: '#81b64c', blue: '#5c9bd6', red: '#d35f5c' };

  // Shared promotion dialog (singleton)
  let promoEl = null;
  let promoCb = null;

  function ensurePromotionDialog() {
    if (promoEl) return;
    promoEl = document.createElement('div');
    promoEl.className = 'cb-promo-overlay';
    promoEl.innerHTML =
      '<div class="cb-promo-box">' +
      '<h3>Promote pawn to…</h3>' +
      '<div class="cb-promo-row">' +
      ['q', 'r', 'b', 'n'].map(function (p) {
        const glyph = GLYPHS['w' + p.toUpperCase()];
        return '<button class="cb-promo-btn" data-piece="' + p + '">' + glyph + '</button>';
      }).join('') +
      '</div></div>';
    promoEl.addEventListener('click', function (evt) {
      const btn = evt.target.closest('.cb-promo-btn');
      if (btn) {
        promoEl.classList.remove('visible');
        if (promoCb) promoCb(btn.dataset.piece);
        promoCb = null;
      } else if (evt.target === promoEl) {
        promoEl.classList.remove('visible');
        if (promoCb) promoCb(null);
        promoCb = null;
      }
    });
    document.body.appendChild(promoEl);
  }

  class BoardUI {
    constructor(container, opts) {
      opts = opts || {};
      this.container = (typeof container === 'string')
        ? document.getElementById(container) : container;
      if (!this.container) throw new Error('BoardUI: container not found');

      this.orientation = opts.orientation || 'w';
      this.onUserMove = opts.onUserMove || null;
      this.canPick = opts.canPick || function () { return true; };

      this.game = null;
      this.selected = null;
      this.legalTargets = [];
      this.lastMove = null;
      this.arrows = [];
      this.evalCp = null;          // centipawns, white POV; null hides bar
      this.showEvalBar = !!opts.evalBar;
      this.dragSrc = null;

      this._build();
    }

    _build() {
      this.container.classList.add('cb-container');
      this.container.innerHTML = '';

      const wrap = document.createElement('div');
      wrap.className = 'cb-frame';

      // Optional eval bar
      if (this.showEvalBar) {
        this.evalBarEl = document.createElement('div');
        this.evalBarEl.className = 'cb-evalbar';
        this.evalBarEl.innerHTML = '<div class="cb-evalbar-white"></div><span class="cb-evalbar-num"></span>';
        wrap.appendChild(this.evalBarEl);
      }

      this.boardEl = document.createElement('div');
      this.boardEl.className = 'cb-board';

      this.arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.arrowSvg.setAttribute('class', 'cb-arrows');
      this.arrowSvg.setAttribute('viewBox', '0 0 100 100');
      this.arrowSvg.setAttribute('preserveAspectRatio', 'none');
      this.boardEl.appendChild(this.arrowSvg);

      wrap.appendChild(this.boardEl);
      this.container.appendChild(wrap);
    }

    setGame(chess) { this.game = chess; }

    setOrientation(o) { this.orientation = o; this.refresh(); }
    flip() { this.setOrientation(this.orientation === 'w' ? 'b' : 'w'); }

    setLastMove(move) { this.lastMove = move; this.refresh(); }

    setArrows(arrows) {
      this.arrows = arrows || [];
      this._renderArrows();
    }

    setEvalBar(cp) { this.evalCp = cp; this._renderEvalBar(); }

    clearSelection() {
      this.selected = null;
      this.legalTargets = [];
      this.refresh();
    }

    _squareName(r, f) {
      // r,f are visual row/col (0 = top). Convert to algebraic per orientation.
      const row = this.orientation === 'w' ? r : 7 - r;
      const col = this.orientation === 'w' ? f : 7 - f;
      const file = String.fromCharCode(97 + col);
      const rank = 8 - row;
      return file + rank;
    }

    _centerOf(sq) {
      // SVG-space center (0..100) for an algebraic square, per orientation
      let col = sq.charCodeAt(0) - 97;
      let row = 8 - parseInt(sq[1], 10);
      if (this.orientation === 'b') { col = 7 - col; row = 7 - row; }
      return { x: (col + 0.5) * 12.5, y: (row + 0.5) * 12.5 };
    }

    refresh() {
      const board = this.game ? this.game.board() : null;
      this.boardEl.querySelectorAll('.cb-square, .cb-piece').forEach(function (n) { n.remove(); });

      const lastFrom = this.lastMove ? this.lastMove.from : null;
      const lastTo = this.lastMove ? this.lastMove.to : null;
      const targets = new Set(this.legalTargets);
      const inCheck = this.game && this.game.isCheck();
      const isMate = this.game && this.game.isCheckmate();
      const turnColor = this.game ? this.game.turn() : null;

      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const sq = this._squareName(r, f);
          const piece = board ? board[8 - parseInt(sq[1], 10)][sq.charCodeAt(0) - 97] : null;

          const cell = document.createElement('div');
          cell.className = 'cb-square ' + ((r + f) % 2 === 0 ? 'light' : 'dark');
          cell.dataset.sq = sq;

          if (sq === this.selected) cell.classList.add('selected');
          if (sq === lastFrom) cell.classList.add('last-from');
          if (sq === lastTo) cell.classList.add('last-to');
          if (targets.has(sq)) {
            cell.classList.add('legal');
            if (piece) cell.classList.add('capture');
          }

          let pieceSpan = null;
          if (piece) {
            pieceSpan = document.createElement('span');
            pieceSpan.className = 'cb-piece ' + (piece.color === 'w' ? 'white' : 'black');
            pieceSpan.textContent = GLYPHS[piece.color + piece.type.toUpperCase()];
            pieceSpan.dataset.sq = sq;
            if (piece.type === 'k' && piece.color === turnColor && inCheck) {
              cell.classList.add('check');
              if (isMate) {
                cell.classList.add('checkmate');
                pieceSpan.classList.add('cb-king-mated');
              }
            }
            cell.appendChild(pieceSpan);
          }

          cell.addEventListener('click', this._onSquareClick.bind(this));
          cell.addEventListener('dragover', function (e) { e.preventDefault(); });
          cell.addEventListener('drop', this._onDrop.bind(this));
          this.boardEl.appendChild(cell);

          if (pieceSpan) {
            pieceSpan.draggable = this.canPick(sq, piece);
            if (pieceSpan.draggable) {
              pieceSpan.addEventListener('dragstart', this._onDragStart.bind(this));
            }
          }
        }
      }
      this._renderArrows();
      this._renderEvalBar();
    }

    _onDragStart(evt) {
      const sq = evt.target.dataset.sq;
      const piece = this.game ? this.game.get(sq) : null;
      if (!piece || !this.canPick(sq, piece)) { evt.preventDefault(); return; }
      this.dragSrc = sq;
      this._select(sq);
    }

    _onDrop(evt) {
      evt.preventDefault();
      const to = evt.currentTarget.dataset.sq;
      if (this.dragSrc && to) this._attemptMove(this.dragSrc, to);
      this.dragSrc = null;
    }

    _onSquareClick(evt) {
      const sq = evt.currentTarget.dataset.sq;
      const piece = this.game ? this.game.get(sq) : null;

      if (this.selected) {
        if (sq === this.selected) { this.clearSelection(); return; }
        if (this.legalTargets.indexOf(sq) !== -1) {
          this._attemptMove(this.selected, sq);
          return;
        }
      }

      if (piece && this.canPick(sq, piece)) {
        this._select(sq);
      } else {
        this.clearSelection();
      }
    }

    _select(sq) {
      this.selected = sq;
      this.legalTargets = this.game
        ? this.game.moves({ square: sq, verbose: true }).map(function (m) { return m.to; })
        : [];
      this.refresh();
    }

    _attemptMove(from, to) {
      const piece = this.game ? this.game.get(from) : null;
      const isPromo = piece && piece.type === 'p' &&
        ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));

      if (isPromo) {
        ensurePromotionDialog();
        promoEl.classList.add('visible');
        promoCb = (function (picked) {
          if (picked && this.onUserMove) this.onUserMove(from, to, picked);
          this.clearSelection();
        }).bind(this);
        return;
      }

      this.clearSelection();
      if (this.onUserMove) this.onUserMove(from, to, undefined);
    }

    _renderArrows() {
      const svg = this.arrowSvg;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      this.arrows.forEach(function (a) {
        const c1 = this._centerOf(a.from);
        const c2 = this._centerOf(a.to);
        const dx = c2.x - c1.x, dy = c2.y - c1.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len, uy = dy / len;
        const startPad = 2.2, endTrim = 3.6;   // keep clear of piece centers
        const sx = c1.x + ux * startPad, sy = c1.y + uy * startPad;
        const ex = c2.x - ux * endTrim, ey = c2.y - uy * endTrim;
        const color = ARROW_COLORS[a.color] || a.color || ARROW_COLORS.green;

        // Clear arrowhead: wide triangle, shaft stops at the head base so the
        // round line cap can never blunt the tip.
        const headLen = 4.6, headW = 3.0;
        const shaftEndX = ex - ux * (headLen * 0.8);
        const shaftEndY = ey - uy * (headLen * 0.8);

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'cb-arrow');

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', sx); line.setAttribute('y1', sy);
        line.setAttribute('x2', shaftEndX); line.setAttribute('y2', shaftEndY);
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', '2.2');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('opacity', '0.85');
        g.appendChild(line);

        const bx = ex - ux * headLen, by = ey - uy * headLen;
        const px = -uy, py = ux;
        const pts = [
          [ex, ey],
          [bx + px * headW, by + py * headW],
          [bx - px * headW, by - py * headW],
        ].map(function (p) { return p.join(','); }).join(' ');
        const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        head.setAttribute('points', pts);
        head.setAttribute('fill', color);
        head.setAttribute('opacity', '0.85');
        g.appendChild(head);

        svg.appendChild(g);
      }, this);
    }

    _renderEvalBar() {
      if (!this.evalBarEl) return;
      const numEl = this.evalBarEl.querySelector('.cb-evalbar-num');
      const whiteEl = this.evalBarEl.querySelector('.cb-evalbar-white');
      if (this.evalCp === null || this.evalCp === undefined) {
        whiteEl.style.height = '50%';
        numEl.textContent = '';
        return;
      }
      // Logistic win% (common evaluation heuristic)
      const wp = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * this.evalCp)) - 1);
      whiteEl.style.height = Math.max(2, Math.min(98, wp)) + '%';
      if (Math.abs(this.evalCp) >= 9000) {
        const mateIn = Math.round((10000 - Math.abs(this.evalCp)) / 100);
        numEl.textContent = (this.evalCp > 0 ? '+M' : '-M') + Math.max(1, mateIn);
      } else {
        const pawns = this.evalCp / 100;
        numEl.textContent = (pawns > 0 ? '+' : '') + pawns.toFixed(1);
      }
    }
  }

  BoardUI.renderResultStats = function (container, game, myColor) {
    if (!container || !game) return;
    container.textContent = '';
    const vals = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    const history = game.history({ verbose: true });
    let myCaps = 0, oppCaps = 0, myChecks = 0, oppChecks = 0;
    history.forEach(function (m) {
      const mine = m.color === myColor;
      if (m.captured) { if (mine) myCaps++; else oppCaps++; }
      if (m.san && (m.san.indexOf('+') !== -1 || m.san.indexOf('#') !== -1)) {
        if (mine) myChecks++; else oppChecks++;
      }
    });
    let myMat = 0, oppMat = 0;
    game.board().forEach(function (row) {
      row.forEach(function (sq) {
        if (!sq || !vals[sq.type]) return;
        if (sq.color === myColor) myMat += vals[sq.type]; else oppMat += vals[sq.type];
      });
    });
    const diff = myMat - oppMat;
    const movesCount = Math.ceil(history.length / 2);

    const grid = document.createElement('div');
    grid.className = 'rs-grid';
    [
      ['Moves', String(movesCount)],
      ['Captures', myCaps + ' / ' + oppCaps],
      ['Checks', myChecks + ' / ' + oppChecks],
      ['Material', diff === 0 ? 'Even' : (diff > 0 ? '+' : '−') + Math.abs(diff)],
    ].forEach(function (pair) {
      const card = document.createElement('div');
      card.className = 'rs-item';
      const lbl = document.createElement('span');
      lbl.className = 'rs-lbl';
      lbl.textContent = pair[0];
      const val = document.createElement('span');
      val.className = 'rs-val';
      val.textContent = pair[1];
      card.appendChild(lbl);
      card.appendChild(val);
      grid.appendChild(card);
    });
    container.appendChild(grid);

    const note = document.createElement('p');
    note.className = 'rs-note';
    const matTxt = diff === 0 ? 'material even' : (diff > 0 ? '+' + diff + ' material ahead' : '−' + Math.abs(diff) + ' material behind');
    note.textContent = movesCount + ' moves · ' + matTxt + ' · Open Analyze game for move-by-move grading.';
    container.appendChild(note);
  };

  global.BoardUI = BoardUI;
})(window);
