// Loaded BEFORE the chess.js CommonJS bundle. The bundle writes to `exports`,
// so we give it the two globals it expects.
window.exports = {};
window.module = { exports: window.exports };
