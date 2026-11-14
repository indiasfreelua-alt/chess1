/**
 * trainer.js — Chess tactics trainer and puzzle engine
 * Loads chess.js from /node_modules/chess.js/dist/cjs/chess.js
 *
 * Exports:
 *   PUZZLES: Array of 10 tactical puzzles {id, title, theme, rating, fen, solution, description}
 *   validateMove(move): Validates player move against solution
 *   getHint(): Returns the SAN of the move the player is expected to play now
 *   getHintMove(): Returns {from, to, san} of the expected player move (probed on a clone)
 *   loadPuzzle(idOrIndex): Loads a puzzle into the engine
 *   getCurrentPuzzle(): Returns active puzzle object
 *   getGame(): Returns live Chess instance
 *   getScore(): Returns { solvedCount, total, solvedIds }
 *   resetScore(): Resets solved score
 *   nextPuzzle(): Advances to next puzzle
 *   prevPuzzle(): Goes to previous puzzle
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Node.js environment
    let ChessClass;
    try {
      const cjs = require('../../node_modules/chess.js/dist/cjs/chess.js');
      ChessClass = cjs.Chess || cjs;
    } catch (e1) {
      try {
        const cjs2 = require('../node_modules/chess.js/dist/cjs/chess.js');
        ChessClass = cjs2.Chess || cjs2;
      } catch (e2) {
        try {
          const cjs3 = require('./node_modules/chess.js/dist/cjs/chess.js');
          ChessClass = cjs3.Chess || cjs3;
        } catch (e3) {
          const cjs4 = require('chess.js');
          ChessClass = cjs4.Chess || cjs4;
        }
      }
    }
    module.exports = factory(ChessClass);
  } else {
    // Browser environment
    const ChessClass = root.Chess;
    const trainerModule = factory(ChessClass);
    root.Trainer = trainerModule;
    // Also expose requested globals directly on root/window
    root.PUZZLES = trainerModule.PUZZLES;
    root.validateMove = trainerModule.validateMove;
    root.getHint = trainerModule.getHint;
    root.getHintMove = trainerModule.getHintMove;
    root.loadPuzzle = trainerModule.loadPuzzle;
    root.getCurrentPuzzle = trainerModule.getCurrentPuzzle;
    root.getGame = trainerModule.getGame;
    root.getScore = trainerModule.getScore;
    root.resetScore = trainerModule.resetScore;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Chess) {
  'use strict';

  if (!Chess) {
    console.error('Chess.js library not found. Make sure chess.js is loaded before trainer.js');
  }

  // ── 10 Hardcoded Tactical Puzzles ──────────────────────────────────────────
  const PUZZLES = [
    {
      id: 1,
      title: 'Back Rank Checkmate',
      theme: 'mate-in-1',
      rating: 450,
      fen: '6k1/5ppp/8/8/8/8/8/1R4K1 w - - 0 1',
      solution: ['Rb8#'],
      description: 'White to move. Deliver checkmate on the back rank in one move.'
    },
    {
      id: 2,
      title: 'Queen Battery Strike',
      theme: 'mate-in-1',
      rating: 550,
      fen: 'r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 4',
      solution: ['Qxf7#'],
      description: 'White to move. Exploit Black\'s undefended f7 square for immediate checkmate.'
    },
    {
      id: 3,
      title: 'Queen & Knight Coordination',
      theme: 'mate-in-1',
      rating: 650,
      fen: '6k1/5ppp/7Q/5N2/8/8/8/6K1 w - - 0 1',
      solution: ['Qxg7#'],
      description: 'White to move. Coordinate Queen and Knight to deliver checkmate on g7.'
    },
    {
      id: 4,
      title: 'Queen Sacrifice on the Back Rank',
      theme: 'mate-in-2',
      rating: 900,
      fen: '1r4k1/5ppp/8/8/4Q3/8/5PPP/4R1K1 w - - 0 1',
      solution: ['Qe8+', 'Rxe8', 'Rxe8#'],
      description: 'White to move. Deflect Black\'s defending rook to force back-rank mate in two moves.'
    },
    {
      id: 5,
      title: "Anastasia's Mate",
      theme: 'mate-in-2',
      rating: 1100,
      fen: '5r1k/1p2Nppp/8/7Q/8/5R2/5PPP/6K1 w - - 0 1',
      solution: ['Qxh7+', 'Kxh7', 'Rh3#'],
      description: 'White to move. Sacrifice the Queen to lock Black\'s King into Anastasia\'s mate.'
    },
    {
      id: 6,
      title: 'Royal Knight Fork',
      theme: 'fork',
      rating: 1050,
      fen: '6k1/5ppp/2N5/3q4/8/8/5PPP/6K1 w - - 0 1',
      solution: ['Ne7+', 'Kh8', 'Nxd5'],
      description: 'White to move. Fork King and Queen to win decisive material.'
    },
    {
      id: 7,
      title: 'Knight Fork on King & Rook',
      theme: 'fork',
      rating: 950,
      fen: 'r3k3/pp1ppppp/8/3N4/8/8/PPP1PPPP/R3K3 w Qq - 0 1',
      solution: ['Nc7+', 'Kd8', 'Nxa8'],
      description: 'White to move. Leap the Knight to c7 forking the King and the corner Rook.'
    },
    {
      id: 8,
      title: 'Pawn Fork on Minor Pieces',
      theme: 'fork',
      rating: 1250,
      fen: 'r3k2r/ppp2ppp/2n1b3/8/3P4/8/PPP2PPP/R1B1K1NR w KQkq - 0 1',
      solution: ['d5', 'Bf5', 'dxc6'],
      description: 'White to move. Push the d-pawn to fork the Knight on c6 and Bishop on e6.'
    },
    {
      id: 9,
      title: 'Absolute Pin on Queen',
      theme: 'pin',
      rating: 1150,
      fen: '4k3/4qppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
      solution: ['Re1', 'Kd8', 'Rxe7'],
      description: 'White to move. Pin Black\'s Queen to their King along the open e-file.'
    },
    {
      id: 10,
      title: 'Exploiting the Pinned Knight',
      theme: 'pin',
      rating: 1350,
      fen: 'r2qkbnr/ppp1pppp/2np4/1B6/3P4/5N2/PPP2PPP/RNBQK2R w KQkq - 0 1',
      solution: ['d5', 'a6', 'dxc6'],
      description: 'White to move. Attack the pinned Knight on c6 with your pawn to win the piece.'
    }
  ];

  // ── Engine State ───────────────────────────────────────────────────────────
  let game = null;
  let currentPuzzleIndex = 0;
  let currentStep = 0; // step within current puzzle solution
  const solvedSet = new Set();

  // Load saved score from localStorage if available
  if (typeof localStorage !== 'undefined') {
    try {
      const saved = localStorage.getItem('chess_trainer_solved');
      if (saved) {
        const ids = JSON.parse(saved);
        if (Array.isArray(ids)) {
          ids.forEach(id => solvedSet.add(id));
        }
      }
    } catch (e) {
      console.warn('Could not read localStorage for trainer score', e);
    }
  }

  function saveScore() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('chess_trainer_solved', JSON.stringify(Array.from(solvedSet)));
      } catch (e) {
        console.warn('Could not save trainer score to localStorage', e);
      }
    }
  }

  function loadPuzzle(idOrIndex) {
    if (typeof idOrIndex === 'number' && idOrIndex >= 0 && idOrIndex < PUZZLES.length) {
      currentPuzzleIndex = idOrIndex;
    } else {
      const foundIdx = PUZZLES.findIndex(p => p.id === idOrIndex);
      if (foundIdx !== -1) {
        currentPuzzleIndex = foundIdx;
      } else {
        currentPuzzleIndex = 0;
      }
    }

    const puzzle = PUZZLES[currentPuzzleIndex];
    currentStep = 0;
    if (Chess) {
      game = new Chess(puzzle.fen);
    }
    return puzzle;
  }

  function getCurrentPuzzle() {
    return PUZZLES[currentPuzzleIndex];
  }

  function getGame() {
    if (!game && Chess) {
      loadPuzzle(currentPuzzleIndex);
    }
    return game;
  }

  function getScore() {
    return {
      solvedCount: solvedSet.size,
      total: PUZZLES.length,
      solvedIds: Array.from(solvedSet)
    };
  }

  function resetScore() {
    solvedSet.clear();
    saveScore();
    return getScore();
  }

  function getHint() {
    const puzzle = getCurrentPuzzle();
    if (!puzzle || !puzzle.solution || puzzle.solution.length === 0) {
      return '';
    }
    // SAN of the move the player is expected to play RIGHT NOW
    // (falls back to the first move for a freshly loaded puzzle)
    if (currentStep >= puzzle.solution.length) return '';
    return puzzle.solution[currentStep];
  }

  /**
   * Computes the {from, to, san} of the move the player is expected to play next,
   * by probing the solution move on a cloned position — the live game is untouched.
   * @returns {{from: string, to: string, san: string}|null} null when no hint applies
   */
  function getHintMove() {
    const puzzle = getCurrentPuzzle();
    if (!Chess || !game || !puzzle || !Array.isArray(puzzle.solution)) return null;
    if (currentStep >= puzzle.solution.length) return null;

    let probe = null;
    try {
      probe = new Chess(game.fen());
    } catch (e) {
      return null;
    }

    let mv = null;
    try {
      mv = probe.move(puzzle.solution[currentStep], { strict: false });
    } catch (e) {
      mv = null;
    }
    if (!mv) return null;
    return { from: mv.from, to: mv.to, san: mv.san };
  }

  function nextPuzzle() {
    const nextIdx = (currentPuzzleIndex + 1) % PUZZLES.length;
    return loadPuzzle(nextIdx);
  }

  function prevPuzzle() {
    const prevIdx = (currentPuzzleIndex - 1 + PUZZLES.length) % PUZZLES.length;
    return loadPuzzle(prevIdx);
  }

  /**
   * Helper to normalize move strings for comparison (handles SAN vs LAN vs checks #/+)
   */
  function movesMatch(playedMoveObj, expectedMoveStr) {
    if (!playedMoveObj) return false;
    const cleanPlayedSan = (playedMoveObj.san || '').replace(/[+#]/g, '');
    const cleanExpectedSan = (expectedMoveStr || '').replace(/[+#]/g, '');

    if (playedMoveObj.san === expectedMoveStr) return true;
    if (cleanPlayedSan === cleanExpectedSan) return true;
    if (playedMoveObj.lan === expectedMoveStr) return true;
    if ((playedMoveObj.from + playedMoveObj.to) === expectedMoveStr) return true;

    return false;
  }

  /**
   * Validates user move against the solution sequence.
   * @param {string|object} move - e.g. {from: 'b1', to: 'b8', promotion: 'q'} or 'Rb8#'
   * @returns {object} { correct: boolean, done: boolean, message: string, move?: object, opponentMove?: object }
   */
  function validateMove(move) {
    if (!game) {
      loadPuzzle(currentPuzzleIndex);
    }
    const puzzle = getCurrentPuzzle();
    if (!puzzle) {
      return { correct: false, done: false, message: 'No active puzzle' };
    }

    if (currentStep >= puzzle.solution.length) {
      return { correct: true, done: true, legal: true, message: 'Puzzle already solved!' };
    }

    const expectedMoveStr = puzzle.solution[currentStep];

    // Attempt to make move on live board
    let moveRes = null;
    try {
      moveRes = game.move(move);
    } catch (e) {
      return { correct: false, done: false, legal: false, message: 'Illegal move: ' + e.message };
    }

    if (!moveRes) {
      return { correct: false, done: false, legal: false, message: 'Illegal chess move' };
    }

    // Check if move matches solution step
    if (!movesMatch(moveRes, expectedMoveStr)) {
      // Revert move
      game.undo();
      return {
        correct: false,
        done: false,
        legal: true,
        message: 'Incorrect move. Try again!'
      };
    }

    // Move was correct! Advance step
    currentStep++;

    // Check if puzzle is fully solved
    if (currentStep >= puzzle.solution.length) {
      solvedSet.add(puzzle.id);
      saveScore();
      return {
        correct: true,
        done: true,
        legal: true,
        move: moveRes,
        score: getScore(),
        message: 'Puzzle Solved! Excellent tactical vision!'
      };
    }

    // Opponent response move (for multi-step puzzles like mate-in-2 or fork follow-up)
    const opponentExpectedMoveStr = puzzle.solution[currentStep];
    let opponentMoveRes = null;
    try {
      opponentMoveRes = game.move(opponentExpectedMoveStr);
      currentStep++;
    } catch (e) {
      console.warn('Opponent reply failed:', e);
    }

    // Check if opponent move finished the sequence
    const isNowDone = currentStep >= puzzle.solution.length;
    if (isNowDone) {
      solvedSet.add(puzzle.id);
      saveScore();
    }

    return {
      correct: true,
      done: isNowDone,
      legal: true,
      move: moveRes,
      opponentMove: opponentMoveRes,
      score: getScore(),
      message: isNowDone
        ? 'Puzzle Solved! Great sequence!'
        : 'Good move! Find the finishing blow...'
    };
  }

  // Initialize first puzzle
  loadPuzzle(0);

  return {
    PUZZLES,
    validateMove,
    getHint,
    getHintMove,
    loadPuzzle,
    getCurrentPuzzle,
    getGame,
    getScore,
    resetScore,
    nextPuzzle,
    prevPuzzle
  };
});
