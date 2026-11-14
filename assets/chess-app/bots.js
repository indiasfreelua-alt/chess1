/**
 * bots.js — Bot roster for local Play-vs-Computer
 * Original bot characters for this test harness (not chess.com assets).
 *
 * Bots are grouped into difficulty categories like modern chess sites do:
 * new / beginner / intermediate / advanced / master.
 *
 * Each bot maps to Stockfish settings:
 *   - skill:   Stockfish "Skill Level" (0..20)
 *   - elo:     UCI_Elo when 1320..2850 (UCI_LimitStrength)
 *   - movetime: thinking time per move (ms)
 *   - blunder: probability per move of playing a random legal move instead
 */
(function (global) {
  'use strict';

  const BOTS = [
    {
      id: 'pinky', name: 'Pinky', emoji: '\u{1F425}', rating: 250, cat: 'new',
      quip: 'Is the horsey allowed to jump backwards?',
      desc: 'Just learned how the knight moves. Bless her heart.',
      engine: { skill: 0, elo: null, movetime: 80, blunder: 0.60 },
    },
    {
      id: 'rusty', name: 'Rusty', emoji: '\u{1F9F0}', rating: 480, cat: 'new',
      quip: 'I had a plan. I forgot it. Good luck!',
      desc: 'Knows a few openings, forgets them halfway through.',
      engine: { skill: 1, elo: null, movetime: 100, blunder: 0.42 },
    },
    {
      id: 'coach-ana', name: 'Coach Ana', emoji: '\u{1F469}\u200D\u{1F3EB}', rating: 750, cat: 'beginner',
      quip: 'Watch out — I punish loose pieces… slowly.',
      desc: 'Teaches beginners by letting them punish her mistakes.',
      engine: { skill: 3, elo: null, movetime: 120, blunder: 0.28 },
    },
    {
      id: 'prof-binary', name: 'Professor Binary', emoji: '\u{1F916}', rating: 1050, cat: 'beginner',
      quip: 'Calculating… 01101100… done. Your move.',
      desc: 'Calculates everything twice. Still drops pawns sometimes.',
      engine: { skill: 5, elo: null, movetime: 150, blunder: 0.15 },
    },
    {
      id: 'blitz-bandit', name: 'Blitz Bandit', emoji: '\u{1F3AF}', rating: 1350, cat: 'intermediate',
      quip: 'Your queen looks… takeable.',
      desc: 'Fast, greedy, and slightly reckless with his queen.',
      engine: { skill: 8, elo: 1350, movetime: 200, blunder: 0.08 },
    },
    {
      id: 'iron-wall', name: 'Iron Wall', emoji: '\u{1F9F1}', rating: 1650, cat: 'intermediate',
      quip: 'I do not attack. I accumulate.',
      desc: 'Solid positional play. Beat him by outmaneuvering, not tactics.',
      engine: { skill: 11, elo: 1650, movetime: 250, blunder: 0.04 },
    },
    {
      id: 'night-stalker', name: 'Night Stalker', emoji: '\u{1F987}', rating: 1950, cat: 'advanced',
      quip: 'Every fork starts with a quiet move.',
      desc: 'Lives for knight forks and trapped kings.',
      engine: { skill: 14, elo: 1950, movetime: 300, blunder: 0.02 },
    },
    {
      id: 'gm-vex', name: 'Grandmaster Vex', emoji: '\u{1F451}', rating: 2250, cat: 'advanced',
      quip: 'I have seen your plan. It has a flaw.',
      desc: 'Cold, precise, unforgiving. Grinds out endgames like a machine.',
      engine: { skill: 17, elo: 2250, movetime: 400, blunder: 0 },
    },
    {
      id: 'dragon-empress', name: 'Dragon Empress', emoji: '\u{1F409}', rating: 2500, cat: 'master',
      quip: 'Keep your king in the center. Please.',
      desc: 'Devours uncastled kings. Respect the dragon or lose in 20.',
      engine: { skill: 19, elo: 2500, movetime: 500, blunder: 0 },
    },
    {
      id: 'terminus', name: 'Terminus', emoji: '\u{1F480}', rating: 2820, cat: 'master',
      quip: 'The end of the line. Nice knowing you.',
      desc: 'Maximum strength. The end of the line for your Elo.',
      engine: { skill: 20, elo: null, movetime: 800, blunder: 0 },
    },
  ];

  const CATEGORIES = [
    { id: 'new',          label: 'New to Chess' },
    { id: 'beginner',     label: 'Beginner' },
    { id: 'intermediate', label: 'Intermediate' },
    { id: 'advanced',     label: 'Advanced' },
    { id: 'master',       label: 'Master' },
  ];

  function getBot(id) {
    return BOTS.find(function (b) { return b.id === id; }) || null;
  }

  function byCategory(catId) {
    return BOTS.filter(function (b) { return b.cat === catId; });
  }

  function randomBot() {
    return BOTS[Math.floor(Math.random() * BOTS.length)];
  }

  global.Bots = {
    BOTS: BOTS,
    CATEGORIES: CATEGORIES,
    getBot: getBot,
    byCategory: byCategory,
    randomBot: randomBot,
  };
})(window);
