// Loaded AFTER the chess.js CommonJS bundle: hoist its export to window.Chess
// and remove the shim globals so nothing else can latch onto them.
(function () {
  'use strict';
  var mod = window.module;

  if (mod && mod.exports && typeof mod.exports.Chess !== 'undefined') {
    window.Chess = mod.exports.Chess;
  } else if (window.exports && typeof window.exports.Chess !== 'undefined') {
    window.Chess = window.exports.Chess;
  } else if (typeof window.Chess === 'undefined' && mod && typeof mod.exports === 'function') {
    window.Chess = mod.exports;
  }

  try { delete window.module; } catch (e) { window.module = undefined; }
  try { delete window.exports; } catch (e) { window.exports = undefined; }
})();
