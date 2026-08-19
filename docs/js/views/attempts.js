import { icon } from '../icons.js';
import { buildHash } from '../router.js';
import { attemptsFor, certificationOf } from '../progression.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const pretty = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export function render(ctx) {
  const cert = ctx.engine.certByCode.get(ctx.params.code);
  if (!cert) return `<p class="empty">Unknown certification code “${esc(ctx.params.code)}”.</p>`;
  return `
    <nav class="crumbs"><a href="${buildHash(['cert', cert.code])}">${icon('arrowLeft', { size: 14 })} ${esc(cert.shortName)}</a></nav>
    <section class="page-head">
      <div>
        <h2>${icon('trophy', { size: 22 })} Exam attempts — ${esc(cert.shortName)}</h2>
        <p class="muted">Your record of sitting the real ${esc(cert.code)} exam. Log what happened and, if it went badly, which topics caught you out — those get weighted up in your practice quizzes.</p>
      </div>
    </section>
    <div id="attempts-root"><p class="empty">Loading…</p></div>
  `;
}

export function mount(ctx, root) {
  const cert = ctx.engine.certByCode.get(ctx.params.code);
  if (!cert) return;
  const host = root.querySelector('#attempts-root');
  const scope = ctx.engine.scopeFor(cert.code);

  let editing = null; // attempt id being edited, or 'new'
  let draftPitfalls = new Set();
  let pitfallFilter = '';

  async function load() {
    const all = await ctx.store.getAttempts();
    return { all, mine: attemptsFor(all, cert.code), certification: certificationOf(all, cert.code) };
  }

  /**
   * The search box is rendered once and never replaced; only the results and
   * chips below it redraw. Re-rendering the whole form on each keystroke would
   * wipe the date, result and score the user had already filled in — and would
   * steal focus from the box they are typing into.
   */
  function pitfallPicker() {
    return `<div class="pitfall-picker">
      <label class="field">
        <span>Topics that caught you out</span>
        <input type="text" id="pitfall-search" placeholder="Search services and concepts…" autocomplete="off">
      </label>
      <div id="pitfall-dynamic">${pitfallDynamic()}</div>
    </div>`;
  }

  function pitfallDynamic() {
    const q = pitfallFilter.trim().toLowerCase();
    const matches = q
      ? scope.filter((e) => e.name.toLowerCase().includes(q) || (e.tags || []).some((t) => t.includes(q)))
      : [];
    const chosen = [...draftPitfalls].map((id) => ctx.engine.entityById.get(id)).filter(Boolean);

    return `${q
      ? matches.length
        ? `<ul class="pitfall-results">${matches
            .slice(0, 8)
            .map(
              (e) => `<li>
                <button type="button" class="pitfall-add${draftPitfalls.has(e.id) ? ' chosen' : ''}" data-id="${esc(e.id)}">
                  ${draftPitfalls.has(e.id) ? icon('check', { size: 13 }) : icon('plus', { size: 13 })}
                  ${esc(e.name)}
                </button>
              </li>`
            )
            .join('')}</ul>`
        : '<p class="muted small">Nothing in this exam’s scope matches that.</p>'
      : ''}
    ${chosen.length
      ? `<ul class="pitfall-chips">${chosen
          .map(
            (e) => `<li><span class="pitfall-chip">${esc(e.name)}
              <button type="button" class="chip-x" data-remove="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">×</button>
            </span></li>`
          )
          .join('')}</ul>`
      : '<p class="muted small">None picked yet. These become weighted-up topics in your quizzes and appear under Weak spots.</p>'}`;
  }

  /** Redraws only the picker's results and chips, leaving the form untouched. */
  function refreshPitfalls() {
    const mount = host.querySelector('#pitfall-dynamic');
    if (!mount) return;
    mount.innerHTML = pitfallDynamic();
    wirePitfalls();
  }

  function wirePitfalls() {
    host.querySelectorAll('.pitfall-add').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.id;
        if (draftPitfalls.has(id)) draftPitfalls.delete(id);
        else draftPitfalls.add(id);
        refreshPitfalls();
      })
    );
    host.querySelectorAll('[data-remove]').forEach((b) =>
      b.addEventListener('click', () => {
        draftPitfalls.delete(b.dataset.remove);
        refreshPitfalls();
      })
    );
  }

  function form(existing) {
    const a = existing || {};
    return `<form class="attempt-form panel" id="attempt-form">
      <h3>${existing ? 'Edit attempt' : 'Log an attempt'}</h3>
      <div class="attempt-row">
        <label class="field">
          <span>Date sat</span>
          <input name="date" type="date" value="${esc(a.date || todayStr())}" max="${todayStr()}" required>
        </label>
        <fieldset class="field result-field">
          <legend>Result</legend>
          <label class="radio"><input type="radio" name="result" value="pass"${a.result !== 'fail' ? ' checked' : ''}> Passed</label>
          <label class="radio"><input type="radio" name="result" value="fail"${a.result === 'fail' ? ' checked' : ''}> Failed</label>
        </fieldset>
        <label class="field">
          <span>Scaled score <span class="muted">(optional)</span></span>
          <input name="score" type="number" min="100" max="1000" step="1" value="${a.score ?? ''}" placeholder="${cert.exam.passingScore} to pass">
        </label>
      </div>

      ${pitfallPicker()}

      <label class="field">
        <span>Notes <span class="muted">(optional)</span></span>
        <textarea name="notes" rows="3" placeholder="What surprised you? Question styles, timing, anything to remember next time.">${esc(a.notes || '')}</textarea>
      </label>

      <div class="quiz-actions">
        <button class="btn primary" type="submit">${existing ? 'Save changes' : 'Log attempt'}</button>
        <button class="btn" type="button" data-action="cancel">Cancel</button>
      </div>
    </form>`;
  }

  function attemptCard(a) {
    const passed = a.result === 'pass';
    const pitfalls = (a.pitfalls || []).map((id) => ctx.engine.entityById.get(id)).filter(Boolean);
    return `<li class="attempt-card ${passed ? 'pass' : 'fail'}">
      <header>
        <span class="attempt-verdict ${passed ? 'pass' : 'fail'}">
          ${icon(passed ? 'check' : 'warning', { size: 15 })} ${passed ? 'Passed' : 'Did not pass'}
        </span>
        <span class="attempt-date">${esc(pretty(a.date))}</span>
        ${a.score != null && a.score !== ''
          ? `<span class="attempt-score${a.score >= cert.exam.passingScore ? ' good' : ' bad'}">${a.score}<span> / ${cert.exam.scoreRange[1]}</span></span>`
          : ''}
      </header>
      ${pitfalls.length
        ? `<div class="attempt-pitfalls">
            <h4>Pitfalls</h4>
            <ul>${pitfalls.map((e) => `<li>${esc(e.name)}</li>`).join('')}</ul>
          </div>`
        : ''}
      ${a.notes ? `<p class="attempt-notes">${esc(a.notes)}</p>` : ''}
      <div class="attempt-actions">
        <button class="btn small" data-action="edit" data-id="${esc(a.id)}">${icon('edit', { size: 13 })} Edit</button>
        <button class="btn small ghost" data-action="delete" data-id="${esc(a.id)}">${icon('trash', { size: 13 })} Delete</button>
      </div>
    </li>`;
  }

  function certBanner(c) {
    if (!c) return '';
    const cls = c.expired ? 'expired' : c.expiringSoon ? 'soon' : 'valid';
    return `<section class="cert-banner ${cls}">
      ${icon(c.expired ? 'warning' : 'trophy', { size: 22 })}
      <div>
        <strong>${c.expired ? 'Certification expired' : 'Certified'}</strong>
        <p>Passed ${esc(pretty(c.attempt.date))}${c.expiresOn ? ` · ${c.expired ? 'expired' : 'valid until'} ${esc(pretty(c.expiresOn))}` : ''}${
          c.expiringSoon && !c.expired ? ` · <strong>${c.daysLeft} days left</strong>` : ''
        }</p>
        ${c.expiringSoon || c.expired
          ? '<p class="muted small">AWS certifications last three years. Recertify before the date above to stay current.</p>'
          : ''}
      </div>
    </section>`;
  }

  async function draw() {
    const { mine, certification } = await load();
    const passes = mine.filter((a) => a.result === 'pass').length;
    const fails = mine.length - passes;

    host.innerHTML = `
      ${certBanner(certification)}

      ${mine.length
        ? `<section class="attempt-summary">
            <div class="stat"><strong>${mine.length}</strong><span>attempt${mine.length === 1 ? '' : 's'}</span></div>
            <div class="stat"><strong>${passes}</strong><span>passed</span></div>
            <div class="stat"><strong>${fails}</strong><span>not passed</span></div>
            <div class="stat"><strong>${new Set(mine.flatMap((a) => a.pitfalls || [])).size}</strong><span>pitfall topics</span></div>
          </section>`
        : ''}

      ${editing === 'new' ? form(null) : ''}
      ${editing && editing !== 'new' ? form(mine.find((a) => a.id === editing)) : ''}

      ${editing
        ? ''
        : `<div class="quiz-actions"><button class="btn primary" data-action="new">${icon('plus', { size: 15 })} Log an attempt</button></div>`}

      ${mine.length
        ? `<ul class="attempt-list">${mine.map(attemptCard).join('')}</ul>`
        : editing
          ? ''
          : `<p class="empty">No attempts logged for ${esc(cert.code)} yet. Sat it already? Log it — a pass marks you certified on the roadmap, and pitfalls from a fail feed straight into your practice.</p>`}
    `;

    wire(mine);
  }

  function wire(mine) {
    host.querySelector('[data-action="new"]')?.addEventListener('click', () => {
      editing = 'new';
      draftPitfalls = new Set();
      pitfallFilter = '';
      draw();
    });

    host.querySelectorAll('[data-action="edit"]').forEach((b) =>
      b.addEventListener('click', () => {
        editing = b.dataset.id;
        draftPitfalls = new Set(mine.find((a) => a.id === editing)?.pitfalls || []);
        pitfallFilter = '';
        draw();
      })
    );

    host.querySelectorAll('[data-action="delete"]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!window.confirm('Delete this attempt? This cannot be undone.')) return;
        await ctx.store.removeAttempt(b.dataset.id);
        ctx.refresh();
      })
    );

    host.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
      editing = null;
      draw();
    });

    const search = host.querySelector('#pitfall-search');
    if (search) {
      search.value = pitfallFilter;
      search.addEventListener('input', (e) => {
        pitfallFilter = e.target.value;
        refreshPitfalls();
      });
      // Enter in the search box must not submit the whole attempt.
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') e.preventDefault();
      });
    }
    wirePitfalls();

    host.querySelector('#attempt-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const payload = {
        certCode: cert.code,
        date: f.date.value,
        result: f.result.value,
        score: f.score.value === '' ? null : Number(f.score.value),
        pitfalls: [...draftPitfalls],
        notes: f.notes.value.trim(),
      };
      if (editing === 'new') await ctx.store.addAttempt(payload);
      else await ctx.store.updateAttempt(editing, payload);
      editing = null;
      draftPitfalls = new Set();
      await ctx.publishSummary(true);
      ctx.refresh();
    });
  }

  draw();
}
