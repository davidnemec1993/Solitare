/**
 * Spider Solitaire – game logic
 * game.js  (runs in Electron renderer context)
 */

const SUITS   = ['spades', 'hearts', 'diamonds', 'clubs'];
const VALUES  = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_SYMBOLS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const RED_SUITS    = new Set(['hearts', 'diamonds']);

let _cardIdCounter = 0;

function makeCard(suit, value) {
  return { id: ++_cardIdCounter, suit, value, faceUp: false };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Returns an array of 104 cards for the given difficulty.
 * difficulty 1 → 8 sets of spades
 * difficulty 2 → 4 sets each of spades + hearts
 * difficulty 4 → 2 sets of all four suits
 */
function buildDeck(difficulty) {
  const suitSets = [];
  if (difficulty === 1) {
    for (let i = 0; i < 8; i++) suitSets.push('spades');
  } else if (difficulty === 2) {
    for (let i = 0; i < 4; i++) { suitSets.push('spades'); suitSets.push('hearts'); }
  } else {
    for (let i = 0; i < 2; i++) SUITS.forEach(s => suitSets.push(s));
  }

  const cards = [];
  suitSets.forEach(suit => {
    for (let v = 1; v <= 13; v++) cards.push(makeCard(suit, v));
  });
  return shuffle(cards);
}

class SpiderGame {
  constructor(difficulty = 1) {
    this.difficulty = difficulty;
    this.tableau    = [];   // Array(10) of card arrays
    this.stock      = [];   // remaining cards
    this.foundations = [];  // completed A-K sequences (up to 8)
    this.score      = 500;
    this.moves      = 0;
    this.startTime  = Date.now();
    this.history    = [];   // undo stack (snapshots)
    this.gameOver   = false;
  }

  init() {
    _cardIdCounter = 0;
    this.tableau     = Array.from({ length: 10 }, () => []);
    this.foundations = [];
    this.score       = 500;
    this.moves       = 0;
    this.startTime   = Date.now();
    this.history     = [];
    this.gameOver    = false;

    const deck = buildDeck(this.difficulty);

    // Deal: first 4 columns → 6 cards each; last 6 → 5 cards each (total 54)
    let idx = 0;
    for (let col = 0; col < 10; col++) {
      const count = col < 4 ? 6 : 5;
      for (let i = 0; i < count; i++) {
        const card = deck[idx++];
        card.faceUp = (i === count - 1);
        this.tableau[col].push(card);
      }
    }

    // Remaining 50 cards go to stock
    this.stock = deck.slice(idx);
  }

  // ── Snapshot for undo ──────────────────────────────────────

  _snapshot() {
    return {
      tableau:     this.tableau.map(col => col.map(c => ({ ...c }))),
      stock:       this.stock.map(c => ({ ...c })),
      foundations: this.foundations.map(seq => seq.map(c => ({ ...c }))),
      score:       this.score,
      moves:       this.moves
    };
  }

  _restore(snap) {
    this.tableau     = snap.tableau.map(col => col.map(c => ({ ...c })));
    this.stock       = snap.stock.map(c => ({ ...c }));
    this.foundations = snap.foundations.map(seq => seq.map(c => ({ ...c })));
    this.score       = snap.score;
    this.moves       = snap.moves;
  }

  // ── Move validation ────────────────────────────────────────

  /**
   * Returns the group of cards starting at fromIndex in column col,
   * or null if the group can't be moved (face-down, not a valid sequence).
   * A single face-up card can always be picked up.
   * A group must be a same-suit descending run.
   */
  getMovableGroup(col, fromIndex) {
    const column = this.tableau[col];
    if (fromIndex < 0 || fromIndex >= column.length) return null;
    if (!column[fromIndex].faceUp) return null;

    const group = column.slice(fromIndex);

    for (let i = 1; i < group.length; i++) {
      if (!group[i].faceUp)                         return null;
      if (group[i].suit  !== group[i - 1].suit)     return null;
      if (group[i].value !== group[i - 1].value - 1) return null;
    }
    return group;
  }

  /**
   * Can the top card of 'group' be placed on top of column toCol?
   * Rule: the target's top card must be exactly one value higher than
   * the card being placed (suit doesn't matter for placement).
   * Empty column accepts any single card or group.
   */
  canPlace(group, toCol) {
    const target = this.tableau[toCol];
    if (target.length === 0) return true;
    const topCard = target[target.length - 1];
    if (!topCard.faceUp) return false;
    return topCard.value === group[0].value + 1;
  }

  // ── Execution ─────────────────────────────────────────────

  moveCards(fromCol, fromIndex, toCol) {
    this.history.push(this._snapshot());
    if (this.history.length > 50) this.history.shift();

    const group = this.tableau[fromCol].splice(fromIndex);

    // Flip newly exposed card
    const from = this.tableau[fromCol];
    if (from.length > 0 && !from[from.length - 1].faceUp) {
      from[from.length - 1].faceUp = true;
    }

    this.tableau[toCol].push(...group);
    this.moves++;
    this.score = Math.max(0, this.score - 1);

    return this._checkAndRemoveSequences();
  }

  // Returns array of column indices where a sequence was removed
  _checkAndRemoveSequences() {
    const completed = [];
    for (let col = 0; col < 10; col++) {
      const column = this.tableau[col];
      if (column.length < 13) continue;

      const top13 = column.slice(-13);
      if (this._isCompleteSequence(top13)) {
        this.foundations.push([...top13]);
        this.tableau[col] = column.slice(0, -13);

        // Flip newly exposed card
        if (this.tableau[col].length > 0) {
          const top = this.tableau[col][this.tableau[col].length - 1];
          if (!top.faceUp) top.faceUp = true;
        }

        this.score += 100;
        completed.push(col);
        col--; // re-check same column (unlikely but possible in edge cases)
      }
    }
    return completed;
  }

  _isCompleteSequence(cards) {
    if (cards.length !== 13) return false;
    const suit = cards[0].suit;
    for (let i = 0; i < 13; i++) {
      if (cards[i].suit  !== suit)      return false;
      if (cards[i].value !== 13 - i)    return false; // K…A  (13 down to 1)
    }
    return true;
  }

  dealFromStock() {
    if (this.stock.length < 10) return false;
    // Spider rules: can't deal if any column is empty
    if (this.tableau.some(col => col.length === 0)) return false;

    this.history.push(this._snapshot());
    if (this.history.length > 50) this.history.shift();

    for (let col = 0; col < 10; col++) {
      const card = this.stock.pop();
      card.faceUp = true;
      this.tableau[col].push(card);
    }

    this._checkAndRemoveSequences();
    this.moves++;
    this.score = Math.max(0, this.score - 1);
    return true;
  }

  undo() {
    if (this.history.length === 0) return false;
    this._restore(this.history.pop());
    this.score = Math.max(0, this.score - 5);
    return true;
  }

  isWon() {
    return this.foundations.length === 8;
  }

  elapsedSeconds() {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  // ── Hint ──────────────────────────────────────────────────

  /**
   * Returns { fromCol, fromIndex, toCol } for the best available move,
   * or null if none found.
   */
  findHint() {
    // Prefer moves that extend a same-suit run
    for (let fromCol = 0; fromCol < 10; fromCol++) {
      const col = this.tableau[fromCol];
      if (col.length === 0) continue;

      for (let fromIndex = col.length - 1; fromIndex >= 0; fromIndex--) {
        const group = this.getMovableGroup(fromCol, fromIndex);
        if (!group) continue;

        for (let toCol = 0; toCol < 10; toCol++) {
          if (toCol === fromCol) continue;
          if (!this.canPlace(group, toCol)) continue;

          const target = this.tableau[toCol];
          if (target.length === 0) continue; // skip empty columns for hints (not top priority)

          // Prefer same-suit placements
          const topTarget = target[target.length - 1];
          if (topTarget.suit === group[0].suit) {
            return { fromCol, fromIndex, toCol };
          }
        }
      }
    }

    // Any valid move
    for (let fromCol = 0; fromCol < 10; fromCol++) {
      const col = this.tableau[fromCol];
      if (col.length === 0) continue;
      for (let fromIndex = col.length - 1; fromIndex >= 0; fromIndex--) {
        const group = this.getMovableGroup(fromCol, fromIndex);
        if (!group) continue;
        for (let toCol = 0; toCol < 10; toCol++) {
          if (toCol === fromCol) continue;
          if (this.canPlace(group, toCol)) {
            return { fromCol, fromIndex, toCol };
          }
        }
      }
    }

    // Deal from stock
    if (this.stock.length >= 10 && !this.tableau.some(c => c.length === 0)) {
      return { stockDeal: true };
    }

    return null;
  }
}

// Export for renderer
window.SpiderGame       = SpiderGame;
window.SUIT_SYMBOLS     = SUIT_SYMBOLS;
window.RED_SUITS        = RED_SUITS;
window.VALUES           = VALUES;
