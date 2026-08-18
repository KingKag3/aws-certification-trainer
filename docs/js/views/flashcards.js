import { icon } from '../icons.js';
import { buildHash } from '../router.js';
import { recordAnswer } from '../store.js';
import { beginnerBlock, gotchaBlock } from '../learn.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function render(ctx) {
  const cert = ctx.engine.certByCode.get(ctx.params.code);
  if (!cert) return `<p class="empty">Unknown certification code “${esc(ctx.params.code)}”.</p>`;
  return `
    <nav class="crumbs"><a href="${buildHash(['cert', cert.code])}">${icon('arrowLeft', { size: 14 })} ${esc(cert.shortName)}</a></nav>
    <div id="cards-root"></div>
  `;
}

export function mount(ctx, root) {
  const cert = ctx.engine.certByCode.get(ctx.params.code);
  if (!cert) return;
  const host = root.querySelector('#cards-root');
  const categories = ctx.engine.categories;

  const all = ctx.engine.scopeFor(cert.code);
  const present = [...new Set(all.map((e) => e.category))].sort((a, b) =>
    (categories[a]?.label || a).localeCompare(categories[b]?.label || b)
  );

  const state = {
    filter: ctx.query.cat || 'all',
    order: shuffle(all.map((_, i) => i)),
    pos: 0,
    flipped: false,
  };

  function deck() {
    const filtered = state.filter === 'all' ? all : all.filter((e) => e.category === state.filter);
    return state.order.map((i) => all[i]).filter((e) => filtered.includes(e));
  }

  function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function draw() {
    const cards = deck();
    if (!cards.length) {
      host.innerHTML = '<p class="empty">No cards in that category for this certification.</p>';
      return;
    }
    state.pos = Math.max(0, Math.min(state.pos, cards.length - 1));
    const e = cards[state.pos];
    const cat = categories[e.category] || { label: e.category, icon: 'book' };
    const seen = ctx.progressByCert[cert.code].entities?.[e.id];

    host.innerHTML = `
      <header class="cards-head">
        <div>
          <h2>${icon('cards', { size: 20 })} Flashcards</h2>
          <p class="muted small">${esc(cert.name)} · ${cards.length} card${cards.length === 1 ? '' : 's'} in this deck</p>
        </div>
        <div class="cards-controls">
          <label class="sr-only" for="cat">Filter by category</label>
          <select id="cat">
            <option value="all"${state.filter === 'all' ? ' selected' : ''}>All categories (${all.length})</option>
            ${present
              .map((c) => {
                const n = all.filter((x) => x.category === c).length;
                return `<option value="${esc(c)}"${state.filter === c ? ' selected' : ''}>${esc(categories[c]?.label || c)} (${n})</option>`;
              })
              .join('')}
          </select>
          <button class="btn small" data-action="shuffle">${icon('refresh', { size: 14 })} Shuffle</button>
        </div>
      </header>

      <div class="card-counter">${state.pos + 1} / ${cards.length}${seen ? ` · seen ${seen.seen}×, missed ${seen.missed}×` : ''}</div>

      <div class="flashcard ${state.flipped ? 'flipped' : ''}" tabindex="0" role="button"
           aria-label="Flashcard, press Enter or Space to flip">
        <div class="flash-inner">
          <div class="flash-face front" style="--cat:${esc(cat.color || 'var(--accent)')}">
            <span class="flash-cat">${icon(cat.icon || 'book', { size: 15 })} ${esc(cat.label)}</span>
            <h3>${esc(e.name)}</h3>
            <p class="flash-hint">Tap or press Space to reveal</p>
          </div>
          <div class="flash-face back">
            ${beginnerBlock(e)}
            <hr class="flash-divider">
            <p class="flash-purpose">${esc(cap(e.name + ' ' + e.purpose))}.</p>
            ${e.useCases?.length
              ? `<div class="flash-block"><h4>Typical use</h4><ul>${e.useCases.map((u) => `<li>${esc(cap(u))}</li>`).join('')}</ul></div>`
              : ''}
            ${gotchaBlock(e)}
          </div>
        </div>
      </div>

      <div class="card-actions">
        <button class="btn" data-action="prev" ${state.pos === 0 ? 'disabled' : ''}>${icon('arrowLeft', { size: 15 })} Back</button>
        <button class="btn ghost" data-action="review" title="Adds this topic to your weak spots for ${esc(cert.code)}">
          ${icon('flame', { size: 15 })} Mark for review
        </button>
        <button class="btn primary" data-action="next">Next ${icon('arrowRight', { size: 15 })}</button>
      </div>
      <p class="muted small centred">Keyboard: ← → to move, Space to flip.</p>
    `;

    host.querySelector('#cat').addEventListener('change', (ev) => {
      state.filter = ev.target.value;
      state.pos = 0;
      state.flipped = false;
      draw();
    });
    host.querySelector('[data-action="shuffle"]').addEventListener('click', () => {
      state.order = shuffle(state.order);
      state.pos = 0;
      state.flipped = false;
      draw();
    });
    host.querySelector('[data-action="prev"]').addEventListener('click', () => move(-1));
    host.querySelector('[data-action="next"]').addEventListener('click', () => move(1));
    host.querySelector('[data-action="review"]').addEventListener('click', () => markReview(e));
    const card = host.querySelector('.flashcard');
    card.addEventListener('click', flip);
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        flip();
      }
    });
  }

  function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function flip() {
    state.flipped = !state.flipped;
    host.querySelector('.flashcard')?.classList.toggle('flipped', state.flipped);
  }

  function move(delta) {
    const cards = deck();
    state.pos = (state.pos + delta + cards.length) % cards.length;
    state.flipped = false;
    draw();
  }

  /** Marking for review records a miss, so the weak-spots quiz picks it up. */
  async function markReview(entity) {
    const domain = ctx.engine.domainFor(cert.code, entity, Math.random);
    const current = await ctx.store.getCert(cert.code);
    await ctx.store.setCert(
      cert.code,
      recordAnswer(current, { entityId: entity.id, domainId: domain.id, correct: false })
    );
    ctx.progressByCert[cert.code] = await ctx.store.getCert(cert.code);
    move(1);
  }

  const onKey = (ev) => {
    if (ev.target.matches('input, select, textarea')) return;
    if (ev.key === 'ArrowRight') { ev.preventDefault(); move(1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); move(-1); }
    else if (ev.key === ' ') { ev.preventDefault(); flip(); }
  };
  window.addEventListener('keydown', onKey);
  ctx.onCleanup(() => window.removeEventListener('keydown', onKey));

  draw();
}
