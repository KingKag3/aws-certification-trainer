import { icon } from '../icons.js';
import { buildHash } from '../router.js';
import { esc, beginnerBlock, gotchaBlock, groupByDomain, videoLink } from '../learn.js';

/**
 * A read-it-start-to-finish glossary for one certification, grouped by the
 * exam's real domains. Intended to be usable before touching a quiz.
 */
export function render(ctx) {
  const cert = ctx.engine.certByCode.get(ctx.params.code);
  if (!cert) return `<p class="empty">Unknown certification code “${esc(ctx.params.code)}”.</p>`;

  const scope = ctx.engine.scopeFor(cert.code);
  const categories = ctx.engine.categories;
  const groups = groupByDomain(cert, scope, categories);

  return `
    <nav class="crumbs"><a href="${buildHash(['cert', cert.code])}">${icon('arrowLeft', { size: 14 })} ${esc(cert.shortName)}</a></nav>

    <section class="page-head">
      <div>
        <h2>${icon('book', { size: 22 })} Concepts — ${esc(cert.shortName)}</h2>
        <p class="muted">Every service and concept on the ${esc(cert.code)} exam, in plain English, grouped by the exam's own domains. Written for someone who has never used a cloud platform. Read it start to finish, or dip into the domain you are weakest on.</p>
      </div>
    </section>

    <section class="panel start-here">
      <h3>${icon('play', { size: 18 })} Start here</h3>
      <p class="muted small">A full free course covering this exam end to end${cert.startHereVideo.videoIsSearchFallback ? '. No verified course video is recorded for this exam yet, so this is a YouTube search.' : '.'}</p>
      ${videoLink(cert.startHereVideo)}
      ${cert.dataStatus !== 'full'
        ? `<p class="notice">${icon('warning', { size: 15 })} Every topic below has a plain-English explanation. This exam's bank of full exam-style scenarios is still growing — ${cert.scenarioCount} so far — so a mock draws more on generated recall questions than it does for Cloud Practitioner or Solutions Architect.</p>`
        : ''}
    </section>

    <nav class="concept-toc" aria-label="Exam domains">
      ${groups
        .map(
          (g) =>
            `<a href="#domain-${g.domain.id}"><span class="toc-num">D${g.domain.number}</span> ${esc(g.domain.name)} <span class="toc-count">${g.entries.length}</span></a>`
        )
        .join('')}
    </nav>

    ${groups
      .map(
        (g) => `<section class="concept-domain" id="domain-${g.domain.id}">
          <header class="concept-domain-head">
            <h3>Domain ${g.domain.number} · ${esc(g.domain.name)}</h3>
            <span class="pill">${g.domain.weight}% of the exam</span>
            ${g.shared ? '<span class="pill" title="These topics are also listed under another domain they overlap with">also covered elsewhere</span>' : ''}
            <a class="btn small" href="${buildHash(['cert', cert.code, 'quiz'], { domain: g.domain.id, n: 10 })}">
              ${icon('target', { size: 14 })} Drill this domain
            </a>
          </header>
          ${g.sections
            .map(
              (sec) => `<div class="concept-section">
                ${g.sections.length > 1
                  ? `<h4 class="concept-section-head">${icon(sec.icon, { size: 15 })} ${esc(sec.label)} <span>${sec.entries.length}</span></h4>`
                  : ''}
                <ul class="concept-list">
                  ${sec.entries
                    .map(
                      (e) => `<li class="concept-entry" id="concept-${esc(e.id)}">
                        <header>
                          <h4>${esc(e.name)}</h4>
                          <span class="concept-cat">${icon(sec.icon, { size: 13 })} ${esc(sec.label)}</span>
                        </header>
                        ${beginnerBlock(e)}
                        ${gotchaBlock(e, { collapsed: true })}
                      </li>`
                    )
                    .join('')}
                </ul>
              </div>`
            )
            .join('')}
        </section>`
      )
      .join('')}

    <p class="disclaimer">${icon('warning', { size: 15 })} Video links point at third-party channels. Only links labelled with a channel name were verified; the rest are YouTube searches, because guessing a video address produces broken or wrong links.</p>
  `;
}

export function mount(ctx, root) {
  // In-page anchors have to be intercepted, because the app itself lives in the hash.
  root.querySelectorAll('.concept-toc a').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = root.querySelector(a.getAttribute('href'));
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    })
  );
}
