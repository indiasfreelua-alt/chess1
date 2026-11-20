// puzzles-page.js — controller for the Puzzle Trainer page.
(function () {
  'use strict';

  const T = window.Trainer;
  const $ = function (id) { return document.getElementById(id); };

  // ── DOM handles ─────────────────────────────────────────────────────────
  const statusEl = $('pz-status');
  const messageEl = $('pz-message');
  const plateEl = $('plate-top');
  const listEl = $('pz-list');
  const successEl = $('pz-success');

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Feedback helpers ────────────────────────────────────────────────────
  function say(text, kind) {
    messageEl.textContent = text || '';
    messageEl.classList.remove('ok', 'err');
    if (kind) messageEl.classList.add(kind);
  }

  function clearFeedback() {
    say('');
    successEl.classList.remove('visible');
  }

  // ── Auto-advance handling ───────────────────────────────────────────────
  let advanceTimer = null;

  function cancelAutoAdvance() {
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
  }

  function nextUnsolvedIndex(fromIdx) {
    const n = T.PUZZLES.length;
    for (let i = 1; i <= n; i++) {
      const idx = (fromIdx + i) % n;
      if (T.getScore().solvedIds.indexOf(T.PUZZLES[idx].id) === -1) return idx;
    }
    return -1;
  }

  // ── Board ───────────────────────────────────────────────────────────────
  const ui = new BoardUI('board-mount', {
    orientation: 'w',
    canPick: function (sq, piece) {
      return piece.color === T.getGame().turn();
    },
    onUserMove: onUserMove,
  });

  function flashWrong(from, to) {
    [from, to].forEach(function (sq) {
      const cell = document.querySelector('div[data-sq="' + sq + '"]');
      if (!cell) return;
      cell.classList.remove('wrong-flash');
      void cell.offsetWidth; // restart the animation if it is already applied
      cell.classList.add('wrong-flash');
      setTimeout(function () { cell.classList.remove('wrong-flash'); }, 520);
    });
  }

  // ── Move flow ───────────────────────────────────────────────────────────
  function onUserMove(from, to, promo) {
    cancelAutoAdvance();
    ui.setArrows([]);
    const res = T.validateMove({ from: from, to: to, promotion: promo || 'q' });

    if (!res.legal) {
      say(res.message || 'Illegal move', 'err');
      ui.refresh();
      return;
    }

    if (res.correct) {
      if (res.move) ui.setLastMove({ from: res.move.from, to: res.move.to });
      ui.refresh();
      if (res.opponentMove) {
        const om = res.opponentMove;
        setTimeout(function () {
          ui.setLastMove({ from: om.from, to: om.to });
        }, 420);
      }
      if (res.done && res.move) {
        onSolved(res);
      } else {
        say(res.message || 'Good move — keep going!', 'ok');
      }
    } else {
      // Wrong move: trainer already reverted it — flash the squares red.
      ui.refresh();
      flashWrong(from, to);
      say(res.message || 'Incorrect — try again', 'err');
    }

    renderMeta();
    renderProgress();
    renderList();
  }

  function onSolved(res) {
    const p = T.getCurrentPuzzle();
    const score = T.getScore();
    const allDone = score.solvedCount >= score.total;

    $('pz-success-title').textContent = 'Puzzle solved!';
    $('pz-success-sub').textContent = allDone
      ? 'All ' + score.total + ' puzzles complete — outstanding!'
      : '"' + p.title + '" done — next one coming up…';
    successEl.classList.add('visible');
    say(res.message || 'Puzzle solved!', 'ok');
    statusEl.textContent = '✔ Solved — ' + p.title;

    cancelAutoAdvance();
    if (!allDone) {
      advanceTimer = setTimeout(function () {
        advanceTimer = null;
        const curIdx = T.PUZZLES.indexOf(T.getCurrentPuzzle());
        const nextIdx = nextUnsolvedIndex(curIdx);
        if (nextIdx !== -1) {
          T.loadPuzzle(nextIdx);
          renderAll(true);
        }
      }, 1600);
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────────
  function renderStatus() {
    const p = T.getCurrentPuzzle();
    const turn = (p.fen.split(' ')[1] === 'b') ? 'Black' : 'White';
    statusEl.textContent = turn + ' to move — ' + p.title;
  }

  function renderPlate() {
    const p = T.getCurrentPuzzle();
    plateEl.innerHTML =
      '<span class="plate-avatar">🧩</span><span>' + escapeHtml(p.title) +
      ' <small>· ' + escapeHtml(p.theme) + ' · rating ' + p.rating + '</small></span>';
  }

  function renderMeta() {
    const p = T.getCurrentPuzzle();
    const idx = T.PUZZLES.indexOf(p);
    $('pz-theme').textContent = p.theme;
    $('pz-rating').textContent = '★ ' + p.rating;
    $('pz-counter').textContent = 'Puzzle ' + (idx + 1) + ' / ' + T.PUZZLES.length;
    $('pz-desc').textContent = p.description || '';
  }

  function renderProgress() {
    const score = T.getScore();
    $('pz-score').textContent = score.solvedCount;
    $('pz-total').textContent = score.total;
    $('pz-progress-count').textContent = score.solvedCount + ' / ' + score.total + ' solved';
    const pct = score.total ? Math.round((100 * score.solvedCount) / score.total) : 0;
    $('pz-progress-fill').style.width = pct + '%';
  }

  function renderList() {
    listEl.innerHTML = '';
    const solved = new Set(T.getScore().solvedIds);
    const curIdx = T.PUZZLES.indexOf(T.getCurrentPuzzle());

    T.PUZZLES.forEach(function (p, idx) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pz-item' +
        (solved.has(p.id) ? ' solved' : '') +
        (idx === curIdx ? ' active' : '');

      const check = document.createElement('span');
      check.className = 'pz-i-check';
      check.textContent = solved.has(p.id) ? '✓' : '';

      const num = document.createElement('span');
      num.className = 'pz-i-num';
      num.textContent = (idx + 1);

      const name = document.createElement('span');
      name.className = 'pz-i-name';
      name.textContent = p.title;
      name.title = p.description || p.title;

      const theme = document.createElement('span');
      theme.className = 'pz-i-theme';
      theme.textContent = p.theme;

      const rating = document.createElement('span');
      rating.className = 'pz-i-rating';
      rating.textContent = p.rating;

      btn.appendChild(check);
      btn.appendChild(num);
      btn.appendChild(name);
      btn.appendChild(theme);
      btn.appendChild(rating);

      btn.addEventListener('click', function () {
        cancelAutoAdvance();
        T.loadPuzzle(idx);
        renderAll(true);
      });

      listEl.appendChild(btn);
    });
  }

  function renderAll(fresh) {
    cancelAutoAdvance();
    ui.setGame(T.getGame());

    const p = T.getCurrentPuzzle();
    const turn = (p.fen.split(' ')[1] === 'b') ? 'b' : 'w';
    ui.setOrientation(turn);

    if (fresh) {
      ui.setLastMove(null);
      ui.setArrows([]);
      clearFeedback();
    }

    ui.refresh();
    renderStatus();
    renderPlate();
    renderMeta();
    renderProgress();
    renderList();
  }

  // ── Actions ─────────────────────────────────────────────────────────────
  function showHint() {
    cancelAutoAdvance();
    successEl.classList.remove('visible');
    const mv = T.getHintMove();
    const san = T.getHint();
    if (mv) {
      ui.setArrows([{ from: mv.from, to: mv.to, color: 'green' }]);
      say('Hint: try ' + (san || mv.san));
    } else {
      say('No hint available', 'err');
    }
  }

  function retry() {
    cancelAutoAdvance();
    T.loadPuzzle(T.PUZZLES.indexOf(T.getCurrentPuzzle()));
    renderAll(true);
    say('Puzzle reset — try again.');
  }

  $('btn-hint').addEventListener('click', showHint);
  $('btn-retry').addEventListener('click', retry);
  $('btn-prev').addEventListener('click', function () {
    cancelAutoAdvance();
    T.prevPuzzle();
    renderAll(true);
  });
  $('btn-next').addEventListener('click', function () {
    cancelAutoAdvance();
    T.nextPuzzle();
    renderAll(true);
  });
  $('btn-reset-score').addEventListener('click', function () {
    cancelAutoAdvance();
    T.resetScore();
    renderAll(true);
    say('Score reset — fresh start!');
  });

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        cancelAutoAdvance();
        T.nextPuzzle();
        renderAll(true);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        cancelAutoAdvance();
        T.prevPuzzle();
        renderAll(true);
        break;
      case 'h':
      case 'H':
        showHint();
        break;
      case 'r':
      case 'R':
        retry();
        break;
    }
  });

  // ── Init ────────────────────────────────────────────────────────────────
  renderAll(true);
})();
