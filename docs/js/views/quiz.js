import { icon } from '../icons.js';
import { buildHash } from '../router.js';
import { recordAnswer, recordProfileAnswer } from '../store.js';
import { weakEntities } from '../progression.js';
import { domainBars } from '../charts.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function render(ctx) {
  const cert = ctx.engine.certByCode.get(ctx.params.code);
  if (!cert) return `<p class="empty">Unknown certification code “${esc(ctx.params.code)}”.</p>`;
  return `
    <nav class="crumbs"><a href="${buildHash(['cert', cert.code])}">${icon('arrowLeft', { size: 14 })} ${esc(cert.shortName)}</a></nav>
    <div id="quiz-root" class="quiz-root"><p class="empty">Building your quiz…</p></div>
  `;
}

export function mount(ctx, root) {
  const cert = ctx.engine.certByCode.get(ctx.params.code);
  if (!cert) return;
  const host = root.querySelector('#quiz-root');
  const query = ctx.query;
  const count = Math.max(1, Math.min(50, Number(query.n) || 10));
  const domainId = query.domain || null;
  const mode = query.mode || (domainId ? 'domain' : 'full');

  const progress = ctx.progressByCert[cert.code];
  const entityIds = mode === 'weak' ? weakEntities(progress, ctx.engine, 60).map((w) => w.id) : null;

  const quiz = ctx.engine.generateQuiz({
    certCode: cert.code,
    count,
    domainId,
    entityIds,
    stats: progress.entities || {},
  });

  if (!quiz.questions.length) {
    host.innerHTML = `<p class="empty">Not enough material to build that quiz yet. Try a full quiz for ${esc(cert.code)}.</p>`;
    return;
  }

  const session = {
    index: 0,
    answered: [],
    locked: false,
  };

  const domainName = domainId ? cert.domains.find((d) => d.id === domainId)?.name : null;
  const modeLabel =
    mode === 'weak' ? 'Weak spots' : mode === 'domain' ? `Domain drill · ${domainName}` : 'Quiz';

  function draw() {
    if (session.index >= quiz.questions.length) return drawResults();
    const q = quiz.questions[session.index];
    const answer = session.answered[session.index];

    host.innerHTML = `
      <header class="quiz-head">
        <div>
          <span class="pill">${esc(cert.code)}</span>
          <span class="pill">${esc(modeLabel)}</span>
        </div>
        <div class="quiz-count">${session.index + 1} <span>/ ${quiz.questions.length}</span></div>
      </header>
      <div class="quiz-progress"><i style="width:${(session.index / quiz.questions.length) * 100}%"></i></div>

      <article class="question-card" data-state="${answer ? 'answered' : 'open'}">
        <p class="q-domain">D${q.domainNumber} · ${esc(q.domainName)} <span class="q-kind">${esc(q.kindLabel)}</span></p>
        <h2 class="q-stem">${esc(q.stem)}</h2>
        <ul class="options" role="listbox">
          ${q.options
            .map((o, i) => {
              let cls = '';
              if (answer) {
                if (i === q.correctIndex) cls = 'correct';
                else if (i === answer.chosen) cls = 'wrong';
                else cls = 'dimmed';
              }
              return `<li>
                <button class="option ${cls}" data-i="${i}" ${answer ? 'disabled' : ''}>
                  <span class="opt-key">${String.fromCharCode(65 + i)}</span>
                  <span class="opt-text">${esc(o.text)}</span>
                  <span class="opt-mark">${answer && i === q.correctIndex ? icon('check', { size: 16 }) : ''}</span>
                </button>
              </li>`;
            })
            .join('')}
        </ul>
        ${answer
          ? `<div class="feedback ${answer.correct ? 'good' : 'bad'}">
              <strong>${answer.correct ? 'Correct' : 'Not quite'}</strong>
              <p>${esc(q.explanation)}</p>
            </div>
            <div class="quiz-actions">
              <button class="btn primary" data-action="next">
                ${session.index === quiz.questions.length - 1 ? 'See results' : 'Next question'} ${icon('arrowRight', { size: 15 })}
              </button>
            </div>`
          : '<p class="muted small hint">Pick the best answer. You will get an explanation either way.</p>'}
      </article>
    `;

    host.querySelectorAll('.option').forEach((btn) => {
      btn.addEventListener('click', () => choose(Number(btn.dataset.i)));
    });
    host.querySelector('[data-action="next"]')?.addEventListener('click', () => {
      session.index++;
      draw();
    });
  }

  async function choose(i) {
    if (session.answered[session.index] || session.locked) return;
    session.locked = true;
    const q = quiz.questions[session.index];
    const correct = i === q.correctIndex;
    session.answered[session.index] = { chosen: i, correct };

    // Persist immediately so a half-finished session still counts.
    const current = await ctx.store.getCert(cert.code);
    await ctx.store.setCert(
      cert.code,
      recordAnswer(current, { entityId: q.entityId, domainId: q.domainId, correct })
    );
    const profile = await ctx.store.getProfile();
    await ctx.store.setProfile(recordProfileAnswer(profile, { correct }));

    session.locked = false;
    draw();
  }

  function drawResults() {
    const correct = session.answered.filter((a) => a?.correct).length;
    const total = quiz.questions.length;
    const pct = Math.round((correct / total) * 100);

    const perDomain = {};
    quiz.questions.forEach((q, i) => {
      const d = (perDomain[q.domainId] ||= {
        id: q.domainId,
        number: q.domainNumber,
        name: q.domainName,
        weight: cert.domains.find((x) => x.id === q.domainId)?.weight ?? 0,
        answered: 0,
        correct: 0,
      });
      d.answered++;
      if (session.answered[i]?.correct) d.correct++;
    });
    const domains = Object.values(perDomain)
      .map((d) => ({ ...d, accuracy: Math.round((d.correct / d.answered) * 100), thin: false }))
      .sort((a, b) => a.number - b.number);

    const missed = quiz.questions
      .map((q, i) => ({ q, a: session.answered[i] }))
      .filter((x) => x.a && !x.a.correct);

    host.innerHTML = `
      <section class="results">
        <div class="results-score ${pct >= 85 ? 'good' : pct >= 65 ? 'ok' : 'poor'}">
          <strong>${pct}<span>%</span></strong>
          <p>${correct} of ${total} correct</p>
        </div>
        <h2>Set complete</h2>
        <p class="muted">This set’s breakdown. Your overall readiness for ${esc(cert.code)} is on the certification dashboard.</p>
        ${domainBars(domains)}

        ${missed.length
          ? `<details class="review" open>
              <summary>Review ${missed.length} missed question${missed.length === 1 ? '' : 's'}</summary>
              <ol class="review-list">${missed
                .map(
                  ({ q, a }) => `<li>
                    <p class="rq">${esc(q.stem)}</p>
                    <p class="ra bad">Your answer: ${esc(q.options[a.chosen].text)}</p>
                    <p class="ra good">Correct: ${esc(q.options[q.correctIndex].text)}</p>
                    <p class="rex">${esc(q.explanation)}</p>
                  </li>`
                )
                .join('')}</ol>
            </details>`
          : '<p class="all-correct">Every question correct in this set.</p>'}

        <div class="quiz-actions">
          <button class="btn primary" data-action="again">${icon('refresh', { size: 15 })} Another set</button>
          <a class="btn" href="${buildHash(['cert', cert.code])}">Back to dashboard</a>
          ${missed.length ? `<a class="btn ghost" href="${buildHash(['cert', cert.code, 'quiz'], { mode: 'weak', n: 10 })}">Drill weak spots</a>` : ''}
        </div>
      </section>
    `;

    host.querySelector('[data-action="again"]')?.addEventListener('click', () => {
      ctx.refresh();
    });
  }

  // Keyboard: 1-5 to answer, Enter/Space to advance.
  const onKey = (e) => {
    if (e.target.matches('input, textarea')) return;
    const q = quiz.questions[session.index];
    if (!q) return;
    const n = Number(e.key);
    if (n >= 1 && n <= q.options.length && !session.answered[session.index]) {
      e.preventDefault();
      choose(n - 1);
    } else if ((e.key === 'Enter' || e.key === ' ') && session.answered[session.index]) {
      e.preventDefault();
      session.index++;
      draw();
    }
  };
  window.addEventListener('keydown', onKey);
  ctx.onCleanup(() => window.removeEventListener('keydown', onKey));

  draw();
}
