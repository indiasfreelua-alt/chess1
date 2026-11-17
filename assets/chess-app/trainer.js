/**
 * trainer.js — Chess tactics trainer and puzzle engine
 * Loads chess.js from /node_modules/chess.js/dist/cjs/chess.js
 *
 * Exports:
 *   PUZZLES: Array of 100 tactical puzzles {id, title, theme, rating, fen, solution, description}
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

  // ── 100 Hardcoded Tactical Puzzles ──────────────────────────────────────────
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
      title: 'Anastasia\'s Mate',
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
      rating: 1150,
      fen: '6k1/5ppp/2N5/3q4/8/8/5PPP/6K1 w - - 0 1',
      solution: ['Ne7+', 'Kh8', 'Nxd5'],
      description: 'White to move. Fork King and Queen to win decisive material.'
    },
    {
      id: 7,
      title: 'Knight Fork on King & Rook',
      theme: 'fork',
      rating: 1200,
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
      rating: 1300,
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
    },
    {
      id: 11,
      title: 'Corner Squeeze',
      theme: 'mate-in-1',
      rating: 1400,
      fen: '6k1/5ppp/8/8/8/8/2Q3PP/6K1 w - - 0 1',
      solution: ['Qc8#'],
      description: 'White to move. The back rank is undefended — deliver mate in one.'
    },
    {
      id: 12,
      title: 'Last Rank Ladder',
      theme: 'mate-in-1',
      rating: 1410,
      fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
      solution: ['Rd8#'],
      description: 'White to move. Slide the rook to the eighth rank for immediate mate.'
    },
    {
      id: 13,
      title: 'Smothered Knight',
      theme: 'smothered-mate',
      rating: 1420,
      fen: '6rk/6pp/8/4N3/8/8/6PP/6K1 w - - 0 1',
      solution: ['Nf7#'],
      description: 'White to move. The king suffocates behind its own pieces — mate in one.'
    },
    {
      id: 14,
      title: 'Guarded Nest',
      theme: 'mate-in-1',
      rating: 1430,
      fen: '7k/8/8/5N2/8/8/6Q1/6K1 w - - 0 1',
      solution: ['Qg7#'],
      description: 'White to move. The knight guards g7 - finish with the queen in one move.'
    },
    {
      id: 15,
      title: 'Knight\'s Kiss',
      theme: 'mate-in-1',
      rating: 1440,
      fen: '5k2/8/5K2/8/8/8/8/7Q w - - 0 1',
      solution: ['Qh8#'],
      description: 'White to move. Your king covers every escape — mate in one.'
    },
    {
      id: 16,
      title: 'Pawn Power',
      theme: 'mate-in-1',
      rating: 1450,
      fen: '7k/7p/5KP1/8/2B5/8/8/8 w - - 0 1',
      solution: ['g7#'],
      description: 'White to move. The king guards the promotion square - mate with the pawn.'
    },
    {
      id: 17,
      title: 'Rook Rails',
      theme: 'mate-in-1',
      rating: 1460,
      fen: '7k/6pp/8/8/8/8/6PP/5R1K w - - 0 1',
      solution: ['Rf8#'],
      description: 'White to move. Bring the rook to the back rank for mate in one.'
    },
    {
      id: 18,
      title: 'Royal Fork',
      theme: 'fork',
      rating: 1470,
      fen: '4k3/8/8/1N1q4/8/8/8/6K1 w - - 0 1',
      solution: ['Nc7+', 'Kd7', 'Nxd5'],
      description: 'White to move. Fork the king and queen to win decisive material.'
    },
    {
      id: 19,
      title: 'Tower Theft',
      theme: 'fork',
      rating: 1480,
      fen: 'r3k3/8/4N3/8/8/8/8/6K1 w - - 0 1',
      solution: ['Nc7+', 'Kd7', 'Nxa8'],
      description: 'White to move. Fork king and rook — then take the tower.'
    },
    {
      id: 20,
      title: 'Lockdown',
      theme: 'pin',
      rating: 1490,
      fen: '4k3/p5pp/2n5/1B6/3P4/8/5PPP/6K1 w - - 0 1',
      solution: ['d5', 'h6', 'dxc6'],
      description: 'White to move. The knight is pinned — attack it with your pawn.'
    },
    {
      id: 21,
      title: 'Skewer Pull',
      theme: 'skewer',
      rating: 1500,
      fen: '6kr/8/8/8/8/8/8/4R1K1 w - - 0 1',
      solution: ['Re8+', 'Kg7', 'Rxh8'],
      description: 'White to move. Check the king to skewer the rook behind it.'
    },
    {
      id: 22,
      title: 'Decoy on the Eighth',
      theme: 'mate-in-2',
      rating: 1510,
      fen: '5rk1/5ppp/8/Q7/8/8/6PP/3R2K1 w - - 0 1',
      solution: ['Rd8', 'Rxd8', 'Qxd8#'],
      description: 'White to move. Offer the rook to decoy the defender — mate in two.'
    },
    {
      id: 23,
      title: 'Mirror Decoy',
      theme: 'mate-in-2',
      rating: 1520,
      fen: '2r3k1/5ppp/8/8/Q7/8/6PP/4R1K1 w - - 0 1',
      solution: ['Re8+', 'Rxe8', 'Qxe8#'],
      description: 'White to move. Force the defender to take — then recapture with mate.'
    },
    {
      id: 24,
      title: 'Two Rooks Ladder',
      theme: 'mate-in-2',
      rating: 1530,
      fen: '6k1/6pp/8/3PP2P/8/8/1R6/R5K1 w - - 0 1',
      solution: ['Ra8+', 'Kf7', 'Rb7#'],
      description: 'White to move. A ladder mate with both rooks — mate in two.'
    },
    {
      id: 25,
      title: 'Queen\'s Walk',
      theme: 'mate-in-1',
      rating: 1540,
      fen: 'k7/8/1K6/8/8/8/7Q/8 w - - 0 1',
      solution: ['Qh8#'],
      description: 'White to move. A quiet king cover, then the queen delivers mate on the back rank.'
    },
    {
      id: 26,
      title: 'Side Squeeze',
      theme: 'mate-in-1',
      rating: 1550,
      fen: '7k/6pp/8/8/8/8/5PPP/1Q4K1 w - - 0 1',
      solution: ['Qb8#'],
      description: 'White to move. The long diagonal shot ends it — mate in one.'
    },
    {
      id: 27,
      title: 'Corner Queen',
      theme: 'mate-in-1',
      rating: 1560,
      fen: 'k7/7R/8/8/8/8/8/K5Q1 w - - 0 1',
      solution: ['Qa7#'],
      description: 'White to move. The rook supports the queen on the rim — mate in one.'
    },
    {
      id: 28,
      title: 'Knight Watch',
      theme: 'mate-in-1',
      rating: 1570,
      fen: '7k/8/5N2/8/8/8/8/K5Q1 w - - 0 1',
      solution: ['Qg8#'],
      description: 'White to move. The knight makes g8 safe — mate in one.'
    },
    {
      id: 29,
      title: 'Back-Rank Bomb',
      theme: 'mate-in-2',
      rating: 1580,
      fen: 'r5k1/5ppp/8/Q7/8/8/6PP/3R2K1 w - - 0 1',
      solution: ['Rd8+', 'Rxd8', 'Qxd8#'],
      description: 'White to move. Deflect the checker with the rook — mate in two.'
    },
    {
      id: 30,
      title: 'Board Squeeze',
      theme: 'mate-in-2',
      rating: 1590,
      fen: '7k/8/8/8/8/8/1R6/R5K1 w - - 0 1',
      solution: ['Rb7', 'Kg8', 'Ra8#'],
      description: 'White to move. Squeeze the lone king with the two-rook ladder.'
    },
    {
      id: 31,
      title: 'Twin Duty',
      theme: 'fork',
      rating: 1600,
      fen: '3k1r2/8/8/8/5N2/8/8/6K1 w - - 0 1',
      solution: ['Ne6+', 'Kc8', 'Nxf8'],
      description: 'White to move. Fork the king and rook, then collect.'
    },
    {
      id: 32,
      title: 'Queen Snatch',
      theme: 'fork',
      rating: 1610,
      fen: '4k3/8/N7/3q4/8/8/8/6K1 w - - 0 1',
      solution: ['Nc7+', 'Kd7', 'Nxd5'],
      description: 'White to move. The knight jumps into a royal fork.'
    },
    {
      id: 33,
      title: 'Diagonal Skewer',
      theme: 'skewer',
      rating: 1620,
      fen: '7q/6k1/8/8/8/4B3/8/6K1 w - - 0 1',
      solution: ['Bd4+', 'Kf8', 'Bxh8'],
      description: 'White to move. Check along the diagonal — the queen waits behind.'
    },
    {
      id: 34,
      title: 'Royal Road',
      theme: 'skewer',
      rating: 1630,
      fen: '3r4/3k4/8/8/8/8/8/R5K1 w - - 0 1',
      solution: ['Rd1+', 'Kc7', 'Rxd8'],
      description: 'White to move. Push the king off the file and take the rook.'
    },
    {
      id: 35,
      title: 'Unmasked Battery',
      theme: 'discovered-attack',
      rating: 1640,
      fen: '3q2k1/8/8/3N4/8/8/8/3R2K1 w - - 0 1',
      solution: ['Ne7+', 'Kh8', 'Rxd8'],
      description: 'White to move. Move the knight with check — the rook strikes behind.'
    },
    {
      id: 36,
      title: 'Double Check Door',
      theme: 'discovered-attack',
      rating: 1650,
      fen: '3k3q/8/8/4N3/8/8/1B6/6K1 w - - 0 1',
      solution: ['Nc6+', 'Ke8', 'Bxh8'],
      description: 'White to move. Check with the knight and open the bishop\'s long diagonal.'
    },
    {
      id: 37,
      title: 'Heavy Pinning',
      theme: 'pin',
      rating: 1660,
      fen: '4k3/p2b2pp/8/1B6/8/5N2/5PPP/6K1 w - - 0 1',
      solution: ['Ne5', 'h6', 'Nxd7'],
      description: 'White to move. The bishop holds the pin — attack with the knight.'
    },
    {
      id: 38,
      title: 'Piercing Line',
      theme: 'skewer',
      rating: 1670,
      fen: '8/3r4/3k4/8/8/1Q6/8/6K1 w - - 0 1',
      solution: ['Qd3+', 'Ke5', 'Qxd7'],
      description: 'White to move. Skewer the king to the rook with the queen.'
    },
    {
      id: 39,
      title: 'Rook Pin Payback',
      theme: 'pin',
      rating: 1680,
      fen: '3k4/p2n2pp/8/4P3/8/8/6PP/3R2K1 w - - 0 1',
      solution: ['e6', 'h6', 'exd7'],
      description: 'White to move. The knight is pinned to the king — advance the pawn.'
    },
    {
      id: 40,
      title: 'Knight\'s Treasury',
      theme: 'fork',
      rating: 1690,
      fen: '7k/8/8/4q1N1/8/8/8/6K1 w - - 0 1',
      solution: ['Nf7+', 'Kg8', 'Nxe5'],
      description: 'White to move. A check first, the queen behind it.'
    },
    {
      id: 41,
      title: 'Double Duty',
      theme: 'fork',
      rating: 1700,
      fen: '4k3/3q4/8/3N4/8/8/8/6K1 w - - 0 1',
      solution: ['Nf6+', 'Kd8', 'Nxd7'],
      description: 'White to move. The knight forks king and queen from f7.'
    },
    {
      id: 42,
      title: 'Enfile Signal',
      theme: 'skewer',
      rating: 1710,
      fen: '8/8/2r5/2k5/8/8/8/Q5K1 w - - 0 1',
      solution: ['Qc1+', 'Kd4', 'Qxc6'],
      description: 'White to move. Check on the file to win the rook behind.'
    },
    {
      id: 43,
      title: 'Rook\'s Ascent',
      theme: 'mate-in-1',
      rating: 1720,
      fen: '8/4N1pk/8/8/8/3R4/8/6K1 w - - 0 1',
      solution: ['Rh3#'],
      description: 'White to move. The knight covers the escapes — swing the rook home.'
    },
    {
      id: 44,
      title: 'Born a Queen',
      theme: 'promotion',
      rating: 1730,
      fen: '8/5KPk/8/8/8/8/8/8 w - - 0 1',
      solution: ['g8=Q+', 'Kh6', 'Qg6#'],
      description: 'White to move. Promote with check and polish the mate.'
    },
    {
      id: 45,
      title: 'Frozen Queen',
      theme: 'pin',
      rating: 1740,
      fen: '4k3/4q2p/8/8/8/8/8/2B1R1K1 w - - 0 1',
      solution: ['Bg5', 'h6', 'Bxe7'],
      description: 'White to move. The queen is pinned to the king — attack it twice.'
    },
    {
      id: 46,
      title: 'Triple Threat',
      theme: 'fork',
      rating: 1750,
      fen: 'r1k5/3b4/8/3N4/8/8/8/6K1 w - - 0 1',
      solution: ['Nb6+', 'Kd8', 'Nxa8'],
      description: 'White to move. One check, two loose pieces.'
    },
    {
      id: 47,
      title: 'Thunder From Behind',
      theme: 'discovered-attack',
      rating: 1760,
      fen: '7k/7p/8/4N3/2B5/8/1B6/7K w - - 0 1',
      solution: ['Ng6#'],
      description: 'White to move. Double check: the knight and the bishop land together.'
    },
    {
      id: 48,
      title: 'Marionette Queen',
      theme: 'mate-in-2',
      rating: 1770,
      fen: '6k1/5ppp/5q2/Q7/8/8/6PP/3R2K1 w - - 0 1',
      solution: ['Rd8', 'Qxd8', 'Qxd8#'],
      description: 'White to move. Force the queen to take — then mate with yours.'
    },
    {
      id: 49,
      title: 'Corners and Knights',
      theme: 'fork',
      rating: 1780,
      fen: '2r3k1/8/8/5N2/8/8/8/6K1 w - - 0 1',
      solution: ['Ne7+', 'Kh8', 'Nxc8'],
      description: 'White to move. Check on the rim, then plunder the corner rook.'
    },
    {
      id: 50,
      title: 'Enfilade',
      theme: 'skewer',
      rating: 1790,
      fen: '8/8/4kq2/8/8/8/8/2R3K1 w - - 0 1',
      solution: ['Rc6+', 'Kd5', 'Rxf6'],
      description: 'White to move. Skewer the king against the queen on the rank.'
    },
    {
      id: 51,
      title: 'Knight\'s Toll',
      theme: 'fork',
      rating: 1810,
      fen: '4q3/1p1k4/8/7N/p4P1P/8/8/1K6 w - - 0 1',
      solution: ['Nf6+', 'Kd8', 'Nxe8'],
      description: 'White to move. Fork the king and queen with the knight, then collect the queen.'
    },
    {
      id: 52,
      title: 'Rook\'s Needle',
      theme: 'skewer',
      rating: 1830,
      fen: '8/8/8/1R6/8/8/3K2k1/6q1 w - - 0 1',
      solution: ['Rg5+', 'Kh2', 'Rxg1'],
      description: 'White to move. Skewer the king against the queen, then take it.'
    },
    {
      id: 53,
      title: 'Queen\'s Double Duty',
      theme: 'double-attack',
      rating: 1850,
      fen: '8/6k1/8/5Q2/b7/2r5/8/4K3 w - - 0 1',
      solution: ['Qe5+', 'Kh6', 'Qxc3'],
      description: 'White to move. Check the king and hit a second target with the same move.'
    },
    {
      id: 54,
      title: 'Bishop\'s Blade',
      theme: 'skewer',
      rating: 1870,
      fen: '8/7p/B3k3/6p1/4P1q1/8/2P5/4K3 w - - 0 1',
      solution: ['Bc8+', 'Kf6', 'Bxg4'],
      description: 'White to move. Skewer the king on the diagonal and take the queen behind it.'
    },
    {
      id: 55,
      title: 'Unmasked Battery',
      theme: 'discovered-attack',
      rating: 1890,
      fen: '6r1/8/2k1NK2/2p5/6p1/6P1/B7/8 w - - 0 1',
      solution: ['Nd4+', 'Kb7', 'Bxg8'],
      description: 'White to move. Step the knight away with check - the battery behind it opens fire.'
    },
    {
      id: 56,
      title: 'Twin Royalty',
      theme: 'fork',
      rating: 1910,
      fen: '8/8/2N1k3/1q6/4P3/8/P7/6K1 w - - 0 1',
      solution: ['Nd4+', 'Kd6', 'Nxb5+'],
      description: 'White to move. One knight jump attacks both royal targets - take the bigger one.'
    },
    {
      id: 57,
      title: 'Skewer on the Sixth',
      theme: 'skewer',
      rating: 1930,
      fen: '8/6R1/1q1k4/2p5/6p1/8/3K2P1/8 w - - 0 1',
      solution: ['Rg6+', 'Kd7', 'Rxb6'],
      description: 'White to move. The rook checks and lines up the queen behind the king.'
    },
    {
      id: 58,
      title: 'Two Fires',
      theme: 'double-attack',
      rating: 1950,
      fen: '2k5/6n1/3r4/4p3/8/5Q2/K7/8 w - - 0 1',
      solution: ['Qf8+', 'Kb7', 'Qxd6'],
      description: 'White to move. One queen move lights two fires - take the loose piece.'
    },
    {
      id: 59,
      title: 'Diagonal Duet',
      theme: 'skewer',
      rating: 1970,
      fen: '1q6/8/3k3p/8/8/4B3/8/3K4 w - - 0 1',
      solution: ['Bf4+', 'Kd5', 'Bxb8'],
      description: 'White to move. Check on the diagonal, then take the piece behind the king.'
    },
    {
      id: 60,
      title: 'Open the Curtain',
      theme: 'discovered-attack',
      rating: 1990,
      fen: '8/8/1k1p4/6r1/4KN2/8/8/2B5 w - - 0 1',
      solution: ['Nd5+', 'Kc6', 'Bxg5'],
      description: 'White to move. Move the knight with tempo and unveil the line behind it.'
    },
    {
      id: 61,
      title: 'Silver Fork',
      theme: 'fork',
      rating: 2010,
      fen: '3N4/q7/8/p7/1k2PP2/8/7K/8 w - - 0 1',
      solution: ['Nc6+', 'Kc5', 'Nxa7'],
      description: 'White to move. The knight lands with check and hits the queen behind it.'
    },
    {
      id: 62,
      title: 'File of Ruin',
      theme: 'skewer',
      rating: 2030,
      fen: '8/8/3R4/6kq/8/8/6P1/4K3 w - - 0 1',
      solution: ['Rd5+', 'Kf6', 'Rxh5'],
      description: 'White to move. Skewer along the file and collect the queen.'
    },
    {
      id: 63,
      title: 'Queen\'s Choice',
      theme: 'double-attack',
      rating: 2050,
      fen: '6r1/8/5r2/8/1Q6/7k/1K6/8 w - - 0 1',
      solution: ['Qc3+', 'Kg4', 'Qxf6'],
      description: 'White to move. Check first, then choose the bigger prize.'
    },
    {
      id: 64,
      title: 'Slanted Skewer',
      theme: 'skewer',
      rating: 2070,
      fen: '8/3p2B1/8/8/3p4/2P1k3/3q4/K7 w - - 0 1',
      solution: ['Bh6+', 'Kf3', 'Bxd2'],
      description: 'White to move. A bishop check lines up a second target.'
    },
    {
      id: 65,
      title: 'The Unseen Line',
      theme: 'discovered-attack',
      rating: 2090,
      fen: '8/3q3p/1K6/1p6/8/5Pk1/3N4/3R4 w - - 0 1',
      solution: ['Ne4+', 'Kf4', 'Rxd7'],
      description: 'White to move. The knight has been shielding your attacker - time to move it.'
    },
    {
      id: 66,
      title: 'The Long Jump',
      theme: 'fork',
      rating: 2110,
      fen: '8/2k5/5p2/2p5/3q4/N7/7K/8 w - - 0 1',
      solution: ['Nb5+', 'Kb8', 'Nxd4'],
      description: 'White to move. A long knight hop forks king and queen.'
    },
    {
      id: 67,
      title: 'Rank and Ruin',
      theme: 'skewer',
      rating: 2130,
      fen: '8/5kq1/8/8/2R5/8/2K5/8 w - - 0 1',
      solution: ['Rc7+', 'Kf8', 'Rxg7'],
      description: 'White to move. A rook check exposes the queen on the same line.'
    },
    {
      id: 68,
      title: 'The Heavy Fork',
      theme: 'double-attack',
      rating: 2150,
      fen: '8/r7/5r2/2k5/6Q1/6K1/8/8 w - - 0 1',
      solution: ['Qg5+', 'Kd4', 'Qxf6+'],
      description: 'White to move. The queen forks king and rook.'
    },
    {
      id: 69,
      title: 'The Long Diagonal',
      theme: 'skewer',
      rating: 2170,
      fen: '8/8/8/8/3BP2q/6k1/8/4K3 w - - 0 1',
      solution: ['Bf2+', 'Kf3', 'Bxh4'],
      description: 'White to move. Use the long diagonal to skewer king and queen.'
    },
    {
      id: 70,
      title: 'Revealed Volley',
      theme: 'discovered-attack',
      rating: 2190,
      fen: '8/4q3/1B6/6p1/3N4/PK2k3/7P/8 w - - 0 1',
      solution: ['Nc6+', 'Qc5', 'Bxc5+'],
      description: 'White to move. A knight check reveals a second attacker.'
    },
    {
      id: 71,
      title: 'Forked Lightning',
      theme: 'fork',
      rating: 2210,
      fen: '5q2/8/5k2/6N1/8/8/8/4K3 w - - 0 1',
      solution: ['Nh7+', 'Kf7', 'Nxf8'],
      description: 'White to move. Fork the king and queen and pocket the queen.'
    },
    {
      id: 72,
      title: 'The Long Pin',
      theme: 'skewer',
      rating: 2230,
      fen: '2k1q3/8/8/8/R7/8/K5P1/8 w - - 0 1',
      solution: ['Ra8+', 'Kd7', 'Rxe8'],
      description: 'White to move. Skewer the king and take the piece behind it.'
    },
    {
      id: 73,
      title: 'Queen\'s Net',
      theme: 'double-attack',
      rating: 2250,
      fen: '8/1k6/8/4Q3/1br5/8/4K3/8 w - - 0 1',
      solution: ['Qd5+', 'Kc8', 'Qxc4+'],
      description: 'White to move. Check and trap a loose piece in the same net.'
    },
    {
      id: 74,
      title: 'Bishop\'s Shadow',
      theme: 'skewer',
      rating: 2270,
      fen: '8/4B3/8/2p5/3k4/2qP4/8/1K6 w - - 0 1',
      solution: ['Bf6+', 'Ke3', 'Bxc3'],
      description: 'White to move. Check, then take the queen hiding behind the king.'
    },
    {
      id: 75,
      title: 'Hidden Battery',
      theme: 'discovered-attack',
      rating: 2290,
      fen: '8/8/8/8/1k6/q1N4R/8/1K6 w - - 0 1',
      solution: ['Na2+', 'Kc4', 'Rxa3'],
      description: 'White to move. Unmask the piece behind the knight and win material.'
    },
    {
      id: 76,
      title: 'Knight\'s Dividend',
      theme: 'fork',
      rating: 2310,
      fen: '8/8/2p5/3q4/8/8/6k1/3NK3 w - - 0 1',
      solution: ['Ne3+', 'Kh3', 'Nxd5'],
      description: 'White to move. Check and attack at the same time, then cash in.'
    },
    {
      id: 77,
      title: 'Skewer Serenade',
      theme: 'skewer',
      rating: 2330,
      fen: '1q6/1k6/8/R7/7p/1P4P1/8/6K1 w - - 0 1',
      solution: ['Rb5+', 'Ka7', 'Rxb8'],
      description: 'White to move. Check first, collect after.'
    },
    {
      id: 78,
      title: 'Double Vision',
      theme: 'double-attack',
      rating: 2350,
      fen: '8/8/r7/2k5/5Q2/3r4/8/4K3 w - - 0 1',
      solution: ['Qf5+', 'Kb6', 'Qxd3'],
      description: 'White to move. The queen sees two targets at once.'
    },
    {
      id: 79,
      title: 'Cleric\'s Needle',
      theme: 'skewer',
      rating: 2370,
      fen: '5B2/8/8/8/4P3/4k3/3q2PK/8 w - - 0 1',
      solution: ['Bh6+', 'Kd4', 'Bxd2'],
      description: 'White to move. Skewer with the bishop and win the queen.'
    },
    {
      id: 80,
      title: 'The Curtain Falls',
      theme: 'discovered-attack',
      rating: 2390,
      fen: '8/1r3p2/8/1p6/p2K4/1k3N2/6B1/8 w - - 0 1',
      solution: ['Nd2+', 'Ka2', 'Bxb7'],
      description: 'White to move. Move the knight and let the hidden attacker through.'
    },
    {
      id: 81,
      title: 'Two-Way Street',
      theme: 'fork',
      rating: 2410,
      fen: '8/q7/3N4/8/8/k7/8/5K2 w - - 0 1',
      solution: ['Nb5+', 'Kb4', 'Nxa7'],
      description: 'White to move. The knight covers two targets; the queen cannot escape both.'
    },
    {
      id: 82,
      title: 'Rook\'s Thread',
      theme: 'skewer',
      rating: 2430,
      fen: '8/8/8/2R5/8/P7/4kqP1/7K w - - 0 1',
      solution: ['Rc2+', 'Kd3', 'Rxf2'],
      description: 'White to move. Thread the rook through the king to the queen.'
    },
    {
      id: 83,
      title: 'Queen\'s Dividend',
      theme: 'double-attack',
      rating: 2450,
      fen: '3k4/3r4/8/8/6K1/2r5/7Q/8 w - - 0 1',
      solution: ['Qh8+', 'Ke7', 'Qxc3'],
      description: 'White to move. A checking move pays out in material.'
    },
    {
      id: 84,
      title: 'Crooked Line',
      theme: 'skewer',
      rating: 2470,
      fen: '8/6p1/3q1p2/4k3/1P5P/8/8/4K1B1 w - - 0 1',
      solution: ['Bh2+', 'Ke4', 'Bxd6'],
      description: 'White to move. The diagonal does the work - check and collect.'
    },
    {
      id: 85,
      title: 'Clearing the Path',
      theme: 'discovered-attack',
      rating: 2490,
      fen: '8/8/5k1q/8/8/8/P5KN/7R w - - 0 1',
      solution: ['Ng4+', 'Kg5', 'Rxh6'],
      description: 'White to move. Clear the line with check, then take the target.'
    },
    {
      id: 86,
      title: 'Galloping Fork',
      theme: 'fork',
      rating: 2510,
      fen: '7k/8/2pp4/4q1N1/8/8/8/5K2 w - - 0 1',
      solution: ['Nf7+', 'Kg8', 'Nxe5'],
      description: 'White to move. Ride the knight into a royal fork.'
    },
    {
      id: 87,
      title: 'Threading the King',
      theme: 'skewer',
      rating: 2530,
      fen: '8/8/qk6/3R4/3P4/8/8/2K5 w - - 0 1',
      solution: ['Rd6+', 'Kc7', 'Rxa6'],
      description: 'White to move. Skewer the king against the loose queen.'
    },
    {
      id: 88,
      title: 'Twin Targets',
      theme: 'double-attack',
      rating: 2550,
      fen: '8/7n/r7/8/k7/8/8/4Q2K w - - 0 1',
      solution: ['Qh4+', 'Kb5', 'Qxh7'],
      description: 'White to move. Check the king and grab the undefended piece.'
    },
    {
      id: 89,
      title: 'Bishop\'s Verdict',
      theme: 'skewer',
      rating: 2570,
      fen: '1q6/8/3k4/8/8/1P2B3/K7/8 w - - 0 1',
      solution: ['Bf4+', 'Kd5', 'Bxb8'],
      description: 'White to move. Skewer the king against the queen on the diagonal.'
    },
    {
      id: 90,
      title: 'Discovered Thunder',
      theme: 'discovered-attack',
      rating: 2590,
      fen: '5q2/2p5/4K2p/2N5/2P5/B5k1/4P3/8 w - - 0 1',
      solution: ['Ne4+', 'Kg2', 'Bxf8'],
      description: 'White to move. Discovered check and a loose piece to collect.'
    },
    {
      id: 91,
      title: 'Knight\'s Ambush',
      theme: 'fork',
      rating: 2610,
      fen: '8/8/6k1/5q2/5P2/8/6N1/2K5 w - - 0 1',
      solution: ['Nh4+', 'Kh7', 'Nxf5'],
      description: 'White to move. A quiet-looking knight jump wins the queen.'
    },
    {
      id: 92,
      title: 'Split the Court',
      theme: 'fork',
      rating: 2630,
      fen: '3N4/8/2p5/k1q5/8/8/1P6/7K w - - 0 1',
      solution: ['Nb7+', 'Kb4', 'Nxc5'],
      description: 'White to move. Fork the king and queen to split Black\'s position.'
    },
    {
      id: 93,
      title: 'The Queen\'s Toll',
      theme: 'double-attack',
      rating: 2650,
      fen: '5r2/8/k7/8/4n2K/8/7Q/8 w - - 0 1',
      solution: ['Qe2+', 'Ka5', 'Qxe4'],
      description: 'White to move. Check, then collect the toll.'
    },
    {
      id: 94,
      title: 'Fork at First Light',
      theme: 'fork',
      rating: 2670,
      fen: '8/2q1N3/8/8/8/2k3P1/8/5K2 w - - 0 1',
      solution: ['Nd5+', 'Kd3', 'Nxc7'],
      description: 'White to move. The knight forks king and queen in one move.'
    },
    {
      id: 95,
      title: 'The Reveal',
      theme: 'discovered-attack',
      rating: 2690,
      fen: '8/8/2q5/3p4/5k2/2N5/PP5K/2R5 w - - 0 1',
      solution: ['Ne2+', 'Kf3', 'Rxc6'],
      description: 'White to move. The knight move reveals the real threat.'
    },
    {
      id: 96,
      title: 'Knight\'s Reckoning',
      theme: 'fork',
      rating: 2710,
      fen: '2N5/4p3/2k5/1q6/7P/8/8/7K w - - 0 1',
      solution: ['Na7+', 'Kc7', 'Nxb5+'],
      description: 'White to move. Check the king and hit the queen with the same jump.'
    },
    {
      id: 97,
      title: 'Double Trouble',
      theme: 'fork',
      rating: 2730,
      fen: '8/2p5/8/8/5Pq1/8/7K/3k1N2 w - - 0 1',
      solution: ['Ne3+', 'Kc1', 'Nxg4'],
      description: 'White to move. Two targets, one knight move.'
    },
    {
      id: 98,
      title: 'Queen\'s Reckoning',
      theme: 'double-attack',
      rating: 2750,
      fen: '8/4k3/1r5n/8/3K4/8/Q7/8 w - - 0 1',
      solution: ['Qa7+', 'Ke8', 'Qxb6'],
      description: 'White to move. A queen check wins a piece on the far side.'
    },
    {
      id: 99,
      title: 'The Knight\'s Ledger',
      theme: 'fork',
      rating: 2770,
      fen: '1k1q4/4N3/2p5/8/8/8/8/1K6 w - - 0 1',
      solution: ['Nxc6+', 'Kc7', 'Nxd8'],
      description: 'White to move. Balance the books with a royal fork.'
    },
    {
      id: 100,
      title: 'Unveiled Attack',
      theme: 'discovered-attack',
      rating: 2790,
      fen: '8/8/8/1k4K1/q3N2R/2P5/P7/8 w - - 0 1',
      solution: ['Nd6+', 'Kb6', 'Rxa4'],
      description: 'White to move. Unveil the attack with tempo and win a piece.'
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
