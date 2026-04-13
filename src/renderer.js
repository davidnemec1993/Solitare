/**
 * Spider Solitaire – renderer / UI
 * renderer.js  (runs in Electron renderer context)
 */

/* ── State ───────────────────────────────────────────────── */

let game         = null;
let productImages = [];        // [{url, name}, …] from Mountfield
let timerInterval = null;

// Drag state
let drag = {
  active:    false,
  fromCol:   -1,
  fromIndex: -1,
  group:     [],
  ghosts:    [],          // clone elements following the mouse
  startX:    0,
  startY:    0
};

// Selection state (click-to-select alternative to drag)
let selection = { col: -1, index: -1 };

/* ── DOM refs ─────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const loadingOverlay   = $('loading-overlay');
const newGameDialog    = $('new-game-dialog');
const winDialog        = $('win-dialog');
const scoreEl          = $('score');
const movesEl          = $('moves');
const timerEl          = $('timer');
const foundationsCount = $('foundations-count');
const tableauEl        = $('tableau');
const foundPilesEl     = $('foundation-piles');
const stockPileEl      = $('stock-pile');
const stockCountEl     = $('stock-count');
const tooltip          = $('card-tooltip');

/* ── Boot ─────────────────────────────────────────────────── */

async function boot() {
  // Fetch Mountfield product images via IPC
  try {
    productImages = await window.mountfield.getImages();
  } catch {
    productImages = [];
  }

  hideEl(loadingOverlay);
  showDialog(newGameDialog);
  attachDialogListeners();
  attachToolbarListeners();
  attachKeyListeners();
}

/* ── New game ─────────────────────────────────────────────── */

function startGame(difficulty) {
  hideDialog(newGameDialog);

  game = new SpiderGame(difficulty);
  game.init();

  clearInterval(timerInterval);
  timerInterval = setInterval(updateTimer, 1000);

  clearSelection();
  renderAll();
}

/* ── Render ───────────────────────────────────────────────── */

let _tableauListenerAttached = false;

function renderAll() {
  renderStats();
  renderFoundations();
  renderTableau();
  renderStock();
}

function renderStats() {
  scoreEl.textContent          = game.score;
  movesEl.textContent          = game.moves;
  foundationsCount.textContent = `${game.foundations.length}/8`;
}

function updateTimer() {
  if (!game) return;
  const s = game.elapsedSeconds();
  timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderFoundations() {
  foundPilesEl.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const pile = document.createElement('div');
    pile.className = 'foundation-pile' + (i < game.foundations.length ? ' filled' : '');
    if (i < game.foundations.length) {
      const seq  = game.foundations[i];
      const topC = seq[0]; // King (highest) shown
      pile.innerHTML = buildCardHTML(topC, false);
    } else {
      pile.innerHTML = '<span>♠</span>';
    }
    foundPilesEl.appendChild(pile);
  }
}

function renderTableau() {
  tableauEl.innerHTML = '';

  // Dynamic card offset depending on number of cards in column
  for (let col = 0; col < 10; col++) {
    const colEl = document.createElement('div');
    colEl.className  = 'tableau-column';
    colEl.dataset.col = col;

    const placeholder = document.createElement('div');
    placeholder.className = 'column-placeholder';
    colEl.appendChild(placeholder);

    const column = game.tableau[col];
    const maxH   = tableauEl.clientHeight || 700;
    const offset = column.length <= 1
      ? 28
      : Math.min(28, Math.floor((maxH - 126) / Math.max(column.length - 1, 1)));

    column.forEach((card, idx) => {
      const el = createCardElement(card, col, idx);
      el.style.top = `${idx * offset}px`;
      el.style.zIndex = idx + 1;
      colEl.appendChild(el);
    });

    tableauEl.appendChild(colEl);
  }

  if (!_tableauListenerAttached) {
    attachDragListeners();
    _tableauListenerAttached = true;
  }
}

function renderStock() {
  const empty = game.stock.length === 0;
  stockCountEl.textContent = empty ? '' : `×${Math.floor(game.stock.length / 10)}`;
  stockPileEl.classList.toggle('empty', empty);
}

/* ── Card element creation ────────────────────────────────── */

function createCardElement(card, col, idx) {
  const el = document.createElement('div');
  el.className     = 'card ' + (card.faceUp ? 'face-up' : 'face-down');
  el.dataset.col   = col;
  el.dataset.idx   = idx;
  el.dataset.id    = card.id;

  if (card.faceUp) {
    if (RED_SUITS.has(card.suit)) el.classList.add('red-suit');
    el.innerHTML = buildCardHTML(card, true);
  }

  // Selection highlight
  if (selection.col === col && idx >= selection.index) {
    el.classList.add('selected');
  }

  return el;
}

function buildCardHTML(card, withImage) {
  const sym   = SUIT_SYMBOLS[card.suit];
  const val   = VALUES[card.value - 1];
  const imgUrl = productImages.length > 0
    ? productImages[(card.value - 1) % productImages.length].url
    : null;
  const imgName = imgUrl && productImages[(card.value - 1) % productImages.length]
    ? productImages[(card.value - 1) % productImages.length].name
    : '';

  const imgHTML = (withImage && imgUrl)
    ? `<div class="card-image" 
            style="background-image:url('${imgUrl}')"
            data-name="${escHtml(imgName)}"
            onload="this.classList.add('loaded')"></div>`
    : '';

  return `
    ${imgHTML}
    <div class="card-tl">${val}<span class="suit-sym">${sym}</span></div>
    <div class="card-center">${sym}</div>
    <div class="card-br">${val}<span class="suit-sym">${sym}</span></div>
  `;
}

function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Drag & Drop ──────────────────────────────────────────── */

function attachDragListeners() {
  tableauEl.addEventListener('mousedown', onTableauMouseDown, { passive: false });
}

function onTableauMouseDown(e) {
  if (e.button !== 0) return;

  const cardEl = e.target.closest('.card');
  if (!cardEl) return;

  const col   = +cardEl.dataset.col;
  const idx   = +cardEl.dataset.idx;
  const card  = game.tableau[col][idx];

  if (!card || !card.faceUp) return;
  e.preventDefault();

  // Check if it's a valid movable group
  const group = game.getMovableGroup(col, idx);
  if (!group) return;

  // Click-to-select mode: if a selection exists, try to complete the move
  if (selection.col !== -1 && (selection.col !== col || selection.index !== idx)) {
    if (tryPlaceSelection(col, idx)) return;
  }

  // Start drag
  drag.active    = true;
  drag.fromCol   = col;
  drag.fromIndex = idx;
  drag.group     = group;
  drag.startX    = e.clientX;
  drag.startY    = e.clientY;

  // Build ghost cards
  buildGhosts(cardEl, col, idx, e.clientX, e.clientY);

  // Highlight drop targets
  highlightDropTargets(group);

  clearSelection();

  document.addEventListener('mousemove', onMouseMove, { passive: false });
  document.addEventListener('mouseup',   onMouseUp);
}

function buildGhosts(originEl, col, idx, mx, my) {
  drag.ghosts.forEach(g => g.el.remove());
  drag.ghosts = [];

  const rect   = originEl.getBoundingClientRect();
  const column = game.tableau[col];

  for (let i = idx; i < column.length; i++) {
    const card = column[i];
    const origCard = tableauEl.querySelector(`.card[data-col="${col}"][data-idx="${i}"]`);
    if (!origCard) continue;

    const origRect = origCard.getBoundingClientRect();
    const ghost    = origCard.cloneNode(true);
    ghost.classList.add('dragging');
    ghost.style.position  = 'fixed';
    ghost.style.width     = `${origRect.width}px`;
    ghost.style.height    = `${origRect.height}px`;
    ghost.style.left      = `${origRect.left}px`;
    ghost.style.top       = `${origRect.top}px`;
    ghost.style.zIndex    = 1000 + i;
    ghost.style.pointerEvents = 'none';
    ghost.style.transition = 'none';
    document.body.appendChild(ghost);

    drag.ghosts.push({
      el:      ghost,
      offsetX: origRect.left - mx,
      offsetY: origRect.top  - my
    });
  }
}

function onMouseMove(e) {
  if (!drag.active) return;
  e.preventDefault();
  drag.ghosts.forEach(g => {
    g.el.style.left = `${e.clientX + g.offsetX}px`;
    g.el.style.top  = `${e.clientY + g.offsetY}px`;
  });
  showDropHighlight(e.clientX, e.clientY);
}

function onMouseUp(e) {
  if (!drag.active) return;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup',   onMouseUp);

  // Find drop target column
  const toCol = findTargetColumn(e.clientX, e.clientY);

  drag.ghosts.forEach(g => g.el.remove());
  drag.ghosts = [];
  drag.active = false;

  clearDropHighlights();

  if (toCol !== null && toCol !== drag.fromCol) {
    executeMove(drag.fromCol, drag.fromIndex, toCol);
    return;
  }

  // No valid drop – use click-select
  if (selection.col === drag.fromCol && selection.index === drag.fromIndex) {
    clearSelection();
  } else {
    setSelection(drag.fromCol, drag.fromIndex);
  }
}

function findTargetColumn(mx, my) {
  const cols = tableauEl.querySelectorAll('.tableau-column');
  for (const colEl of cols) {
    const rect = colEl.getBoundingClientRect();
    if (mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom) {
      const col   = +colEl.dataset.col;
      const group = drag.group;
      if (group && game.canPlace(group, col)) return col;
      return null;
    }
  }
  return null;
}

function highlightDropTargets(group) {
  for (let col = 0; col < 10; col++) {
    if (col === drag.fromCol) continue;
    if (game.canPlace(group, col)) {
      const colEl = tableauEl.querySelector(`.tableau-column[data-col="${col}"]`);
      if (colEl) colEl.querySelector('.column-placeholder')?.classList.add('drop-target');
    }
  }
}

function showDropHighlight(mx, my) {
  clearDropHighlights();
  if (drag.group) highlightDropTargets(drag.group);
}

function clearDropHighlights() {
  tableauEl.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
}

/* ── Click-to-select ──────────────────────────────────────── */

function setSelection(col, idx) {
  selection = { col, index: idx };
  renderAll();
}

function clearSelection() {
  selection = { col: -1, index: -1 };
}

function tryPlaceSelection(targetCol, _targetIdx) {
  // If something selected, try to move it onto targetCol
  if (selection.col === -1) return false;
  const group = game.getMovableGroup(selection.col, selection.index);
  if (!group) { clearSelection(); return false; }
  if (!game.canPlace(group, targetCol)) return false;

  executeMove(selection.col, selection.index, targetCol);
  return true;
}

/* ── Execute a move ───────────────────────────────────────── */

function executeMove(fromCol, fromIndex, toCol) {
  clearSelection();
  const completedCols = game.moveCards(fromCol, fromIndex, toCol);
  renderAll();
  handleCompletedSequences(completedCols);

  if (game.isWon()) {
    clearInterval(timerInterval);
    setTimeout(showWinDialog, 600);
  }
}

function handleCompletedSequences(completedCols) {
  // Brief visual flash on foundation label when a sequence completes
  if (completedCols.length > 0) {
    foundPilesEl.style.outline = '3px solid gold';
    setTimeout(() => { foundPilesEl.style.outline = ''; }, 600);
  }
}

/* ── Stock ────────────────────────────────────────────────── */

stockPileEl.addEventListener('click', () => {
  if (!game) return;
  clearSelection();
  if (!game.dealFromStock()) {
    if (game.stock.length === 0) return;
    // Flash error: empty column exists
    stockPileEl.style.outline = '3px solid #e74c3c';
    setTimeout(() => { stockPileEl.style.outline = ''; }, 500);
    return;
  }
  renderAll();
  if (game.isWon()) { clearInterval(timerInterval); setTimeout(showWinDialog, 600); }
});

/* ── Toolbar ──────────────────────────────────────────────── */

function attachToolbarListeners() {
  $('btn-undo').addEventListener('click', () => {
    if (!game) return;
    if (game.undo()) { clearSelection(); renderAll(); }
  });

  $('btn-hint').addEventListener('click', showHint);

  $('btn-new-game').addEventListener('click', () => {
    clearInterval(timerInterval);
    showDialog(newGameDialog);
  });
}

function attachDialogListeners() {
  newGameDialog.querySelectorAll('[data-suits]').forEach(btn => {
    btn.addEventListener('click', () => {
      const suits = +btn.dataset.suits;
      startGame(suits);
    });
  });

  $('win-new-game').addEventListener('click', () => {
    hideDialog(winDialog);
    showDialog(newGameDialog);
  });
}

function attachKeyListeners() {
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (game) { game.undo(); clearSelection(); renderAll(); }
    }
    if (e.key === 'Escape') clearSelection();
    if (e.key === 'h' || e.key === 'H') showHint();
  });
}

/* ── Hint ─────────────────────────────────────────────────── */

function showHint() {
  if (!game) return;
  clearHintHighlights();
  const hint = game.findHint();
  if (!hint) return;

  if (hint.stockDeal) {
    stockPileEl.style.outline = '3px solid #00e5ff';
    setTimeout(() => { stockPileEl.style.outline = ''; }, 1500);
    return;
  }

  // Highlight source card(s) and target column
  const srcEl = tableauEl.querySelector(`.card[data-col="${hint.fromCol}"][data-idx="${hint.fromIndex}"]`);
  if (srcEl) {
    srcEl.classList.add('hint-highlight');
    setTimeout(() => srcEl.classList.remove('hint-highlight'), 1500);
  }

  const tgtColEl = tableauEl.querySelector(`.tableau-column[data-col="${hint.toCol}"]`);
  if (tgtColEl) {
    const ph = tgtColEl.querySelector('.column-placeholder');
    if (ph) {
      ph.classList.add('drop-target');
      setTimeout(() => ph.classList.remove('drop-target'), 1500);
    }
  }
}

function clearHintHighlights() {
  tableauEl.querySelectorAll('.hint-highlight').forEach(el => el.classList.remove('hint-highlight'));
  clearDropHighlights();
}

/* ── Win dialog ───────────────────────────────────────────── */

function showWinDialog() {
  const s = game.elapsedSeconds();
  const timeStr = `${Math.floor(s / 60)}m ${s % 60}s`;
  $('win-score-text').textContent = `Final score: ${game.score}  |  Moves: ${game.moves}`;
  $('win-time-text').textContent  = `Time: ${timeStr}`;
  showDialog(winDialog);
}

/* ── Tooltip ──────────────────────────────────────────────── */

tableauEl.addEventListener('mouseover', e => {
  const imgEl = e.target.closest('.card-image');
  if (!imgEl || !imgEl.dataset.name) { tooltip.classList.add('hidden'); return; }
  tooltip.textContent = imgEl.dataset.name;
  tooltip.classList.remove('hidden');
});

tableauEl.addEventListener('mousemove', e => {
  if (tooltip.classList.contains('hidden')) return;
  tooltip.style.left = `${e.clientX + 14}px`;
  tooltip.style.top  = `${e.clientY - 28}px`;
});

tableauEl.addEventListener('mouseout', () => tooltip.classList.add('hidden'));

/* ── Helpers ──────────────────────────────────────────────── */

function showDialog(el) { el.classList.remove('hidden'); }
function hideDialog(el) { el.classList.add('hidden'); }
function hideEl(el)     { el.style.display = 'none'; }

/* ── Start ─────────────────────────────────────────────────── */

boot();
