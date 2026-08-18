import { icon } from '../icons.js';
import { radarChart, domainBars, ring } from '../charts.js';
import { buildHash } from '../router.js';
import { weakEntities } from '../progression.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (v, unit = '') => (v === null || v === undefined ? '—' : `${v}${unit}`);

export function render(ctx) {
  const { certData, state, engine, params, progressByCert } = ctx;
  const cert = engine.certByCode.get(params.code);
  if (!cert) return `<p class="empty">Unknown certification code “${esc(params.code)}”.</p>`;

  const progress = progressByCert[cert.code];
  const readiness = state.readiness[cert.code];
  const status = state.status[cert.code];
  const config = state.config;
  const scope = engine.scopeFor(cert.code);
  const weak = weakEntities(progress, engine, 12);
  const prereqs = (cert.recommendedBefore || []).map((c) => engine.certByCode.get(c)).filter(Boolean);
  const unlocks = (cert.unlocks || []).map((c) => engine.certByCode.get(c)).filter(Boolean);

  const gap = config.masteryThreshold - readiness.overall;
  const verdict = !progress.answered
    ? 'No questions answered yet. Run a quiz to start building a readiness estimate.'
    : status === 'mastered'
      ? `You are above this app’s ${config.masteryThreshold}% readiness bar across every domain.`
      : progress.answered < config.minQuestionsForMastery
        ? `Answer at least ${config.minQuestionsForMastery} questions (${progress.answered} so far) before the estimate means much.`
        : readiness.domains.some((d) => d.thin)
          ? `Some domains still have fewer than ${config.minQuestionsPerDomain} answers. Use domain drill to fill the gaps.`
          : `${gap} points below this app’s readiness bar.${readiness.weakestDomain ? ` Weakest: ${readiness.weakestDomain.name}.` : ''}`;

  return `
    <nav class="crumbs"><a href="${buildHash([])}">${icon('arrowLeft', { size: 14 })} Roadmap</a></nav>

    <section class="cert-head ${status}">
      <div class="cert-head-main">
        <div class="cert-title-row">
          <span class="pill">${esc(certData.tiers[cert.tier].label)}</span>
          <span class="pill code">${esc(cert.code)}</span>
          <span class="pill status ${status}">${status.replace('-', ' ')}</span>
          ${cert.dataStatus === 'stub' ? '<span class="pill draft">draft question pool</span>' : ''}
        </div>
        <h2>${esc(cert.name)}</h2>
        <p class="lede">${esc(cert.tagline)}</p>
        <p class="muted small">${esc(cert.targetCandidate)}</p>
        ${cert.formerName ? `<p class="muted small">Formerly ${esc(cert.formerName)}.</p>` : ''}
        ${cert.note ? `<p class="notice">${icon('warning', { size: 15 })} ${esc(cert.note)}</p>` : ''}
        <dl class="exam-facts">
          <div><dt>Questions</dt><dd>${fmt(cert.exam.questions)} <span>(${fmt(cert.exam.scoredQuestions)} scored)</span></dd></div>
          <div><dt>Time</dt><dd>${fmt(cert.exam.minutes, ' min')}</dd></div>
          <div><dt>Pass mark</dt><dd>${fmt(cert.exam.passingScore)}<span> of ${cert.exam.scoreRange[1]}</span></dd></div>
          <div><dt>Price</dt><dd>${cert.exam.priceUsd === null ? '—' : '$' + cert.exam.priceUsd}</dd></div>
        </dl>
        <p class="links">
          <a href="${esc(cert.url)}" target="_blank" rel="noopener">Official exam page ${icon('external', { size: 13 })}</a>
          <a href="${esc(cert.examGuideUrl)}" target="_blank" rel="noopener">Official exam guide ${icon('external', { size: 13 })}</a>
        </p>
      </div>
      <div class="cert-head-side">
        ${ring(readiness.overall, { caption: 'readiness', sub: verdict })}
      </div>
    </section>

    <section class="modes">
      <h3>Study modes</h3>
      <div class="mode-grid">
        <a class="mode-card learn-first" href="${buildHash(['cert', cert.code, 'concepts'])}">
          ${icon('book', { size: 22 })}<strong>Concepts</strong>
          <span>New to all this? Every topic in plain English, grouped by exam domain. Read before you quiz.</span>
        </a>
        <a class="mode-card" href="${buildHash(['cert', cert.code, 'quiz'], { n: 10 })}">
          ${icon('target', { size: 22 })}<strong>Quiz</strong>
          <span>10 fresh questions, weighted to match the real domain split.</span>
        </a>
        <a class="mode-card" href="${buildHash(['cert', cert.code, 'flashcards'])}">
          ${icon('cards', { size: 22 })}<strong>Flashcards</strong>
          <span>${scope.length} in-scope services and concepts, definition and gotchas on the back.</span>
        </a>
        <a class="mode-card ${weak.length ? '' : 'disabled'}" href="${weak.length ? buildHash(['cert', cert.code, 'quiz'], { mode: 'weak', n: 10 }) : '#'}"
           ${weak.length ? '' : 'aria-disabled="true" tabindex="-1"'}>
          ${icon('flame', { size: 22 })}<strong>Weak spots</strong>
          <span>${weak.length ? `${weak.length} topic${weak.length === 1 ? '' : 's'} you have missed.` : 'Nothing missed yet — answer some questions first.'}</span>
        </a>
        <a class="mode-card" href="${buildHash(['cert', cert.code, 'quiz'], { n: 20 })}">
          ${icon('play', { size: 22 })}<strong>Long set</strong>
          <span>20 questions in one run, for a fuller readiness signal.</span>
        </a>
      </div>
    </section>

    <section class="dashboard">
      <div class="panel">
        <h3>Accuracy by exam domain</h3>
        <p class="muted small">Domains and weightings are AWS’s published values for ${esc(cert.code)}.</p>
        ${radarChart(readiness.domains)}
      </div>
      <div class="panel wide">
        <h3>Domain drill</h3>
        <p class="muted small">Pick one domain and quiz only that.</p>
        ${domainBars(readiness.domains)}
        <div class="drill-row">${readiness.domains
          .map(
            (d) =>
              `<a class="btn small" href="${buildHash(['cert', cert.code, 'quiz'], { domain: d.id, n: 10 })}">
                 D${d.number} · ${esc(d.name.length > 34 ? d.name.slice(0, 32) + '…' : d.name)}
               </a>`
          )
          .join('')}</div>
      </div>
    </section>

    ${weak.length
      ? `<section class="panel">
          <h3>${icon('flame', { size: 18 })} Weak spots</h3>
          <ul class="weak-list">${weak
            .map(
              (w) =>
                `<li><span>${esc(w.name)}</span><span class="weak-stat">${w.missed}/${w.seen} missed</span>
                 <span class="weak-bar"><i style="width:${Math.round(w.missRate * 100)}%"></i></span></li>`
            )
            .join('')}</ul>
          <a class="btn primary" href="${buildHash(['cert', cert.code, 'quiz'], { mode: 'weak', n: 10 })}">Drill these</a>
        </section>`
      : ''}

    <section class="panel path-panel">
      <h3>Where this sits on the path</h3>
      <div class="path-cols">
        <div>
          <h4>Recommended before</h4>
          ${prereqs.length
            ? `<ul class="path-list">${prereqs
                .map(
                  (p) =>
                    `<li><a href="${buildHash(['cert', p.code])}">${esc(p.name)}</a>
                     <span class="pill status ${state.status[p.code]}">${state.status[p.code].replace('-', ' ')}</span></li>`
                )
                .join('')}</ul>`
            : '<p class="muted small">None — this is an entry point.</p>'}
          <p class="muted small">AWS does not enforce prerequisites. These are recommendations only.</p>
        </div>
        <div>
          <h4>Leads to</h4>
          ${unlocks.length
            ? `<ul class="path-list">${unlocks
                .map(
                  (u) =>
                    `<li><a href="${buildHash(['cert', u.code])}">${esc(u.name)}</a>
                     <p class="muted small">${esc(cert.whyNext?.[u.code] || '')}</p></li>`
                )
                .join('')}</ul>`
            : '<p class="muted small">This is a terminal node on the roadmap.</p>'}
        </div>
      </div>
    </section>

    <section class="panel danger-zone">
      <h3>Progress for this certification</h3>
      <p class="muted small">${progress.answered} questions answered · ${progress.correct} correct · ${readiness.accuracy}% raw accuracy${progress.lastStudiedAt ? ` · last studied ${new Date(progress.lastStudiedAt).toLocaleDateString()}` : ''}</p>
      <button class="btn ghost" data-action="reset-cert" data-code="${cert.code}">${icon('trash', { size: 15 })} Reset ${esc(cert.code)} progress</button>
    </section>
  `;
}

export function mount(ctx, root) {
  root.querySelector('[data-action="reset-cert"]')?.addEventListener('click', async (e) => {
    const code = e.currentTarget.dataset.code;
    if (!window.confirm(`Reset all stored progress for ${code}? This cannot be undone.`)) return;
    await ctx.store.resetCert(code);
    ctx.refresh();
  });
}
