/**
 * sounds.js — Original synthesized chess sound effects (Web Audio API).
 *
 * All sounds are generated at runtime — no audio files, no sampled assets.
 * The palette mimics the classic warm wooden-piece feel: a soft "tock" for
 * moves, a deeper double thud for captures, a two-note alert for checks,
 * and short motifs for game results.
 *
 * API (window.SoundFx):
 *   play(name)               name: move|capture|check|castle|promote|win|lose|draw|illegal
 *   playMove(moveObj, pos)   convenience: derives the right sound from a
 *                            chess.js verbose move + the position AFTER the move
 *   toggle() / setMuted(b) / isMuted()
 *
 * A small sidebar button (#sound-toggle, optional per page) is wired
 * automatically. The last played sound is exposed as
 * document.documentElement.dataset.sfxLast for diagnostics.
 */
(function (global) {
  'use strict';

  let ctx = null;
  let master = null;
  let muted = false;
  try { muted = localStorage.getItem('chess_sound_muted') === '1'; } catch (e) { /* ignore */ }

  // Shared noise buffer (for the wooden click transient)
  let noiseBuf = null;
  function getNoiseBuffer(c) {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(c.sampleRate * 0.12);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function ensureCtx() {
    if (muted) return null;
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.85; // louder output
      // Clip guard: overlapping layers (capture/castle double-thuds) get
      // gently compressed instead of distorting at high gain.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -8;
      comp.knee.value = 6;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.12;
      master.connect(comp);
      comp.connect(ctx.destination);
      // Autoplay policy: resume on the first user gesture
      const resume = function () {
        if (ctx && ctx.state === 'suspended') ctx.resume();
        global.removeEventListener('pointerdown', resume);
        global.removeEventListener('keydown', resume);
      };
      global.addEventListener('pointerdown', resume);
      global.addEventListener('keydown', resume);
    }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
    return ctx;
  }

  // ── Synthesis primitives ───────────────────────────────────────────────────

  /** Warm wooden tap: decaying body tone + band-passed noise click. */
  function tock(c, opts) {
    const o = opts || {};
    const freq = o.freq || 175;
    const dur = o.dur || 0.085;
    const gain = o.gain || 0.5;
    const noiseAmt = o.noise === undefined ? 0.4 : o.noise;
    const delay = o.delay || 0;
    const t = c.currentTime + delay;

    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.72), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.03);

    if (noiseAmt > 0) {
      const src = c.createBufferSource();
      src.buffer = getNoiseBuffer(c);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq * 6.5;
      bp.Q.value = 1.1;
      const ng = c.createGain();
      ng.gain.setValueAtTime(gain * noiseAmt, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.55);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(master);
      src.start(t);
      src.stop(t + dur * 0.7);
    }
  }

  /** Soft musical note (sine + gentle triangle blend). */
  function note(c, freq, startDelay, dur, gain) {
    const t = c.currentTime + startDelay;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.32, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(master);

    const o1 = c.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = freq;
    o1.connect(g);
    o1.start(t);
    o1.stop(t + dur + 0.03);

    const o2 = c.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq;
    const g2 = c.createGain();
    g2.gain.value = 0.35;
    o2.connect(g2);
    g2.connect(g);
    o2.start(t);
    o2.stop(t + dur + 0.03);
  }

  /** Low quiet buzz for illegal attempts. */
  function buzz(c) {
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(95, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    o.connect(lp);
    lp.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.16);
  }

  // ── Sound bank ─────────────────────────────────────────────────────────────

  function render(name) {
    const c = ensureCtx();
    if (!c) return;

    switch (name) {
      case 'move':
        tock(c, { freq: 175, dur: 0.08, gain: 0.5, noise: 0.42 });
        break;

      case 'capture':
        // deeper double thud — piece lifted onto a captured piece
        tock(c, { freq: 120, dur: 0.1, gain: 0.62, noise: 0.5 });
        tock(c, { freq: 150, dur: 0.07, gain: 0.28, noise: 0.3, delay: 0.045 });
        break;

      case 'castle':
        tock(c, { freq: 180, dur: 0.07, gain: 0.42, noise: 0.38 });
        tock(c, { freq: 165, dur: 0.075, gain: 0.46, noise: 0.4, delay: 0.095 });
        break;

      case 'promote':
        note(c, 523.25, 0, 0.16, 0.28);
        note(c, 659.25, 0.07, 0.16, 0.28);
        note(c, 783.99, 0.14, 0.2, 0.3);
        note(c, 1046.5, 0.21, 0.28, 0.3);
        break;

      case 'check':
        note(c, 880, 0, 0.09, 0.3);
        note(c, 1174.66, 0.085, 0.14, 0.3);
        break;

      case 'win':
        note(c, 523.25, 0, 0.2, 0.3);
        note(c, 659.25, 0.11, 0.2, 0.3);
        note(c, 783.99, 0.22, 0.4, 0.32);
        break;

      case 'lose':
        note(c, 392, 0, 0.22, 0.3);
        note(c, 329.63, 0.13, 0.22, 0.3);
        note(c, 261.63, 0.26, 0.42, 0.32);
        break;

      case 'draw':
        note(c, 440, 0, 0.18, 0.28);
        note(c, 440, 0.16, 0.3, 0.28);
        break;

      case 'illegal':
        buzz(c);
        break;

      default:
        return;
    }
    try { document.documentElement.dataset.sfxLast = name; } catch (e) { /* ignore */ }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function play(name) { render(name); }

  /**
   * Derive the right sound from a chess.js verbose move.
   * `posAfter` = the Chess instance AFTER the move (for mate/check detection).
   * Result sounds (win/lose/draw) are NOT played here — the game controller
   * plays those once the game actually ends.
   */
  function playMove(move, posAfter) {
    if (!move) return;
    const flags = move.flags || '';
    if (posAfter && typeof posAfter.isCheckmate === 'function' && posAfter.isCheckmate()) {
      // Mate move: a capture-loud tock; the result motif follows separately
      render(flags.indexOf('c') !== -1 ? 'capture' : 'move');
      return;
    }
    if (posAfter && typeof posAfter.isCheck === 'function' && posAfter.isCheck()) {
      render('check');
      return;
    }
    if (flags.indexOf('p') !== -1) { render('promote'); return; }
    if (flags.indexOf('k') !== -1 || flags.indexOf('q') !== -1) { render('castle'); return; }
    if (flags.indexOf('c') !== -1 || flags.indexOf('e') !== -1) { render('capture'); return; }
    render('move');
  }

  function isMuted() { return muted; }

  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem('chess_sound_muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
    syncToggleUI();
  }

  function toggle() { setMuted(!muted); }

  // ── Sidebar toggle wiring (optional .sound-toggle button) ──────────────────
  function speakerIcon(off) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 9.5v5h3.2L12 18.5v-13L7.2 9.5H4z"/>' +
      (off
        ? '<path d="m16 9.5 4.5 5"/><path d="m20.5 9.5-4.5 5"/>'
        : '<path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M17.8 6.7a7.4 7.4 0 0 1 0 10.6"/>') +
      '</svg>';
  }

  function syncToggleUI() {
    const btns = document.querySelectorAll('.sound-toggle');
    btns.forEach(function (b) {
      b.classList.toggle('muted', muted);
      b.innerHTML = '<span class="side-ico">' + speakerIcon(muted) + '</span>' +
                    '<span>' + (muted ? 'Sound off' : 'Sound on') + '</span>';
      b.title = muted ? 'Enable sound' : 'Mute sound';
    });
  }

  function wireToggles() {
    document.querySelectorAll('.sound-toggle').forEach(function (b) {
      if (b.dataset.wired) return;
      b.dataset.wired = '1';
      b.addEventListener('click', function () { toggle(); });
    });
    syncToggleUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireToggles);
  } else {
    wireToggles();
  }

  global.SoundFx = {
    play: play,
    playMove: playMove,
    toggle: toggle,
    setMuted: setMuted,
    isMuted: isMuted,
    _wire: wireToggles,
  };
})(window);
