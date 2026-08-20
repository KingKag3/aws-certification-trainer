import { icon } from '../icons.js';
import { buildHash } from '../router.js';
import { recordAnswer, recordProfileAnswer } from '../store.js';
import { domainBars } from '../charts.js';
import { pitfallIds, statsWithPitfalls } from '../progression.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const clock = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return (h ? `${h}:` : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(r).padStart(2, '0');
};

/**
 * AWS reports a scaled score from 100 to 1000 and does not publish how raw
 * answers map onto it, so this is an honest linear estimate rather than a
 * claim. The raw percentage is shown first because it is the number we
 * actually know.
 */
function scaledEstimate(pct) {
  return Math.round(100 + (pct / 100) * 900);
}

export function render(ctx) {
  const cert = ctx.engine.certByCode.get(ctx.params.code);
  if (!cert) return `<p class="empty">Unknown certification code “${esc(ctx.params.code)}”.</p>`;
  return `
    <nav class="crumbs"><a href="${buildHash(['cert', cert.code])}">${icon('arrowLeft', { size: 14 })} ${esc(cert.shortName)}</a></nav>
    <div id="mock-root"><p class="empty">Preparing…</p></div>
  `;
}

export function mount(ctx, root) {
  const cert = ctx.engine.certByCode.get(ctx.params.code);
  if (!cert) return;
  const host = root.querySelector('#mock-root');

  const total = cert.exam.questions || 65;
  const minutes = cert.exam.minutes || 130;

  let phase = 'brief'; // brief -> sitting -> results
  let quiz = null;
  let answers = [];
  let flags = new Set();
  let index = 0;
  let endsAt = 0;
  let ticker = null;
  let result = null;

  ctx.onCleanup(() => clearInterval(ticker));

  /* ---------------- brief ---------------- */

  function drawBrief() {
    const priorMocks = ctx.mocks?.filter((m) => m.certCode === cert.code) || [];
    host.innerHTML = `
      <section class="page-head">
        <div>
          <h2>${icon('target', { size: 22 })} Mock exam — ${esc(cert.shortName)}</h2>
          <p class="muted">A full-length sitting under exam conditions. No feedback until you submit, and the clock does not stop.</p>
        </div>
      </section>

      <section class="panel mock-brief">
        <dl class="exam-facts">
          <div><dt>Questions</dt><dd>${total}</dd></div>
          <div><dt>Time limit</dt><dd>${minutes} min</dd></div>
          <div><dt>Pass mark</dt><dd>${cert.exam.passingScore}<span> of ${cert.exam.scoreRange[1]}</span></dd></div>
          <div><dt>Per question</dt><dd>${(minutes * 60 / total).toFixed(0)}s<span> average</span></dd></div>
          <div><dt>Scenario bank</dt><dd>${cert.scenarioCount ?? 0}<span> authored</span></dd></div>
        </dl>
        <p class="muted small">A sitting uses every authored scenario available for this exam and fills the rest with generated questions, so the more of the bank there is, the closer a mock sits to the real thing.</p>

        <h3>How this differs from a quiz</h3>
        <ul class="mock-rules">
          <li>${icon('warning', { size: 14 })} You will <strong>not</strong> see whether an answer was right until the end.</li>
          <li>${icon('warning', { size: 14 })} The timer runs down and <strong>submits automatically</strong> when it reaches zero.</li>
          <li>${icon('check', { size: 14 })} You can move freely between questions and flag any for review.</li>
          <li>${icon('check', { size: 14 })} Every answer still counts toward your readiness and weak spots.</li>
        </ul>

        <p class="notice">${icon('warning', { size: 15 })} The scaled score at the end is an <strong>estimate</strong>. AWS does not publish how raw answers map to its 100–1000 scale, so treat the raw percentage as the real signal.</p>

        <div class="quiz-actions">
          <button class="btn primary lg" data-action="start">${icon('play', { size: 16 })} Start ${minutes}-minute exam</button>
          <a class="btn" href="${buildHash(['cert', cert.code])}">Not now</a>
        </div>
      </section>

      ${priorMocks.length
        ? `<section class="panel">
            <h3>Previous sittings</h3>
            <ul class="mock-history">${priorMocks
              .map(
                (m) => `<li class="${m.passed ? 'pass' : 'fail'}">
                  <span class="mock-verdict">${m.passed ? 'Pass' : 'Below pass'}</span>
                  <strong>${m.scaled}</strong>
                  <span class="muted small">${m.correct}/${m.total} · ${m.rawPct}% · ${new Date(m.takenAt).toLocaleDateString()}</span>
                </li>`
              )
              .join('')}</ul>
          </section>`
        : ''}
    `;
    host.querySelector('[data-action="start"]').addEventListener('click', start);
  }

  /* ---------------- sitting ---------------- */

  function start() {
    const progress = ctx.progressByCert[cert.code];
    const pitfalls = pitfallIds(ctx.attempts || [], cert.code);
    quiz = ctx.engine.generateQuiz({
      certCode: cert.code,
      count: total,
      stats: statsWithPitfalls(progress.entities, pitfalls),
      scenarioShare: 1, // use every authored scenario available before filling
    });
    if (!quiz.questions.length) {
      host.innerHTML = '<p class="empty">Could not build a mock for this certification yet.</p>';
      return;
    }
    answers = new Array(quiz.questions.length).fill(null);
    flags = new Set();
    index = 0;
    endsAt = Date.now() + minutes * 60000;
    phase = 'sitting';
    ticker = setInterval(tick, 1000);
    drawSitting();
  }

  function tick() {
    const left = (endsAt - Date.now()) / 1000;
    const el = host.querySelector('#mock-clock');
    if (el) {
      el.textContent = clock(left);
      el.classList.toggle('urgent', left <= 300);
      el.classList.toggle('critical', left <= 60);
    }
    if (left <= 0) {
      clearInterval(ticker);
      finish(true);
    }
  }

  function drawSitting() {
    const q = quiz.questions[index];
    const answered = answers.filter((a) => a !== null).length;

    host.innerHTML = `
      <header class="mock-bar">
        <div class="mock-bar-left">
          <span class="pill">${esc(cert.code)}</span>
          <span class="pill">Mock exam</span>
        </div>
        <div id="mock-clock" class="mock-clock">${clock((endsAt - Date.now()) / 1000)}</div>
        <div class="mock-bar-right">
          <span class="muted small">${answered}/${quiz.questions.length} answered</span>
          <button class="btn small" data-action="submit">Submit</button>
        </div>
      </header>

      <div class="quiz-progress"><i style="width:${(answered / quiz.questions.length) * 100}%"></i></div>

      <article class="question-card ${q.kind === 'scenario-bank' ? 'scenario' : ''}">
        <p class="q-domain">Question ${index + 1} of ${quiz.questions.length}
          <span class="q-kind">D${q.domainNumber} · ${esc(q.domainName)}</span>
        </p>
        ${q.situation
          ? `<p class="q-situation">${esc(q.situation)}</p><h2 class="q-stem">${esc(q.question)}</h2>`
          : `<h2 class="q-stem">${esc(q.stem)}</h2>`}
        <ul class="options">
          ${q.options
            .map(
              (o, i) => `<li>
                <button class="option ${answers[index] === i ? 'chosen' : ''}" data-i="${i}">
                  <span class="opt-key">${String.fromCharCode(65 + i)}</span>
                  <span class="opt-text">${esc(o.text)}</span>
                </button>
              </li>`
            )
            .join('')}
        </ul>
        <div class="quiz-actions">
          <button class="btn" data-action="prev" ${index === 0 ? 'disabled' : ''}>${icon('arrowLeft', { size: 15 })} Previous</button>
          <button class="btn ${flags.has(index) ? 'primary' : 'ghost'}" data-action="flag">
            ${icon('flame', { size: 15 })} ${flags.has(index) ? 'Flagged' : 'Flag for review'}
          </button>
          <button class="btn primary" data-action="next" ${index === quiz.questions.length - 1 ? 'disabled' : ''}>Next ${icon('arrowRight', { size: 15 })}</button>
        </div>
      </article>

      <section class="mock-nav">
        <h3>Navigator</h3>
        <div class="mock-grid">
          ${quiz.questions
            .map(
              (_, i) => `<button class="mock-cell${i === index ? ' current' : ''}${answers[i] !== null ? ' answered' : ''}${flags.has(i) ? ' flagged' : ''}"
                data-goto="${i}" aria-label="Question ${i + 1}">${i + 1}</button>`
            )
            .join('')}
        </div>
        <p class="muted small">Filled = answered · outlined orange = flagged for review</p>
      </section>
    `;

    host.querySelectorAll('.option').forEach((b) =>
      b.addEventListener('click', () => {
        answers[index] = Number(b.dataset.i);
        if (index < quiz.questions.length - 1) index++;
        drawSitting();
      })
    );
    host.querySelector('[data-action="prev"]')?.addEventListener('click', () => { index--; drawSitting(); });
    host.querySelector('[data-action="next"]')?.addEventListener('click', () => { index++; drawSitting(); });
    host.querySelector('[data-action="flag"]').addEventListener('click', () => {
      flags.has(index) ? flags.delete(index) : flags.add(index);
      drawSitting();
    });
    host.querySelector('[data-action="submit"]').addEventListener('click', () => {
      const unanswered = answers.filter((a) => a === null).length;
      const msg = unanswered
        ? `${unanswered} question${unanswered === 1 ? '' : 's'} still unanswered. Submit anyway?`
        : 'Submit your exam?';
      if (window.confirm(msg)) finish(false);
    });
    host.querySelectorAll('[data-goto]').forEach((b) =>
      b.addEventListener('click', () => { index = Number(b.dataset.goto); drawSitting(); })
    );
  }

  /* ---------------- results ---------------- */

  async function finish(timedOut) {
    clearInterval(ticker);
    phase = 'results';

    const perDomain = {};
    let correct = 0;
    let progress = await ctx.store.getCert(cert.code);
    let profile = await ctx.store.getProfile();

    quiz.questions.forEach((q, i) => {
      const chosen = answers[i];
      const ok = chosen === q.correctIndex;
      if (ok) correct++;

      const d = (perDomain[q.domainId] ||= {
        id: q.domainId, number: q.domainNumber, name: q.domainName,
        weight: cert.domains.find((x) => x.id === q.domainId)?.weight ?? 0,
        answered: 0, correct: 0,
      });
      d.answered++;
      if (ok) d.correct++;

      // Unanswered questions are scored as incorrect, as on the real exam, but
      // they are not recorded as practice — you never engaged with them.
      if (chosen === null) return;
      const touched = q.teaches?.length ? q.teaches : [q.entityId];
      touched.forEach((entityId, idx) => {
        progress = recordAnswer(progress, {
          entityId,
          domainId: idx === 0 ? q.domainId : null,
          countAsAnswered: idx === 0,
          correct: ok,
        });
      });
      profile = recordProfileAnswer(profile, { correct: ok });
    });

    await ctx.store.setCert(cert.code, progress);
    await ctx.store.setProfile(profile);

    const rawPct = Math.round((correct / quiz.questions.length) * 100);
    const scaled = scaledEstimate(rawPct);
    result = {
      certCode: cert.code,
      total: quiz.questions.length,
      correct,
      rawPct,
      scaled,
      passed: scaled >= cert.exam.passingScore,
      timedOut,
      secondsUsed: Math.round(minutes * 60 - Math.max(0, (endsAt - Date.now()) / 1000)),
      domains: Object.values(perDomain).map((d) => ({
        ...d, accuracy: Math.round((d.correct / d.answered) * 100), thin: false,
      })).sort((a, b) => a.number - b.number),
    };

    await ctx.store.addMock({
      certCode: result.certCode, total: result.total, correct: result.correct,
      rawPct: result.rawPct, scaled: result.scaled, passed: result.passed,
      timedOut: result.timedOut, secondsUsed: result.secondsUsed,
    });
    await ctx.publishSummary(true);
    drawResults();
  }

  function drawResults() {
    const missed = quiz.questions
      .map((q, i) => ({ q, chosen: answers[i] }))
      .filter((x) => x.chosen !== x.q.correctIndex);

    host.innerHTML = `
      <section class="results">
        <div class="mock-score ${result.passed ? 'pass' : 'fail'}">
          <span class="mock-score-label">${result.passed ? 'Above the pass mark' : 'Below the pass mark'}</span>
          <strong>${result.rawPct}<span>%</span></strong>
          <p>${result.correct} of ${result.total} correct</p>
          <p class="mock-scaled">≈ ${result.scaled} scaled <span class="muted">(pass is ${cert.exam.passingScore}) — estimated</span></p>
        </div>

        ${result.timedOut ? `<p class="notice">${icon('warning', { size: 15 })} Time ran out and the exam submitted automatically. Unanswered questions were marked incorrect, as they would be on the day.</p>` : ''}

        <p class="muted centred">Finished in ${clock(result.secondsUsed)} of ${minutes}:00.
        ${result.passed
          ? 'A good sign — but this bank is not the real exam, so keep drilling your weakest domain.'
          : 'The domain breakdown below shows where the marks went.'}</p>

        <h3>By exam domain</h3>
        ${domainBars(result.domains)}

        ${missed.length
          ? `<details class="review" open>
              <summary>Review ${missed.length} incorrect answer${missed.length === 1 ? '' : 's'}</summary>
              <ol class="review-list">${missed
                .map(({ q, chosen }) => `<li>
                  ${q.situation ? `<p class="rq">${esc(q.situation)}</p>` : ''}
                  <p class="rq">${esc(q.question || q.stem)}</p>
                  <p class="ra bad">Your answer: ${chosen === null ? '<em>left blank</em>' : esc(q.options[chosen].text)}</p>
                  <p class="ra good">Correct: ${esc(q.options[q.correctIndex].text)}</p>
                  <p class="rex">${esc(q.options[q.correctIndex].why || q.explanation)}</p>
                  ${chosen !== null && q.options[chosen]?.why
                    ? `<p class="rex bad-why"><strong>Why yours was wrong:</strong> ${esc(q.options[chosen].why)}</p>`
                    : ''}
                </li>`)
                .join('')}</ol>
            </details>`
          : '<p class="all-correct">Every question correct. Take another with a different seed before believing it.</p>'}

        <div class="quiz-actions">
          <button class="btn primary" data-action="again">${icon('refresh', { size: 15 })} Sit another</button>
          <a class="btn" href="${buildHash(['cert', cert.code])}">Back to dashboard</a>
          <a class="btn ghost" href="${buildHash(['cert', cert.code, 'quiz'], { mode: 'weak', n: 15 })}">Drill weak spots</a>
        </div>
      </section>
    `;
    host.querySelector('[data-action="again"]').addEventListener('click', () => ctx.refresh());
  }

  drawBrief();
}
