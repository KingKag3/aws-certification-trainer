import { icon } from '../icons.js';
import { buildGraph, suggestNext } from '../progression.js';
import { buildHash } from '../router.js';
import { stackBar } from '../charts.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS_LABEL = {
  locked: 'Locked',
  available: 'Ready to start',
  'in-progress': 'In progress',
  mastered: 'Mastered',
};

const STATUS_ICON = { locked: 'lock', available: 'play', 'in-progress': 'target', mastered: 'check' };

function nodeCard(node, { compact = false } = {}) {
  const { cert, status, readiness } = node;
  const href = buildHash(['cert', cert.code]);
  const draft = cert.dataStatus === 'stub';
  return `<a class="cert-node ${status}" href="${href}" data-code="${cert.code}"
      aria-label="${esc(cert.name)} — ${STATUS_LABEL[status]}, readiness ${readiness.overall} percent">
    <span class="node-top">
      <span class="node-code">${esc(cert.code)}</span>
      <span class="node-status">${icon(STATUS_ICON[status], { size: 14 })}${STATUS_LABEL[status]}</span>
    </span>
    <span class="node-name">${esc(cert.shortName)}</span>
    ${compact ? `<span class="node-full">${esc(cert.name)}</span>` : ''}
    <span class="node-meter" role="img" aria-hidden="true">
      <span class="node-meter-fill" style="width:${readiness.overall}%"></span>
      <span class="node-meter-mark"></span>
    </span>
    <span class="node-foot">
      <span>${readiness.overall}% ready</span>
      <span>${readiness.answered ? `${readiness.accuracy}% acc · ${readiness.answered} q` : 'no attempts'}</span>
    </span>
    ${draft ? '<span class="node-draft" title="Metadata and exam domains are real; the question pool for this exam is still thin">draft pool</span>' : ''}
  </a>`;
}

function treeView(certData, state) {
  const graph = buildGraph(certData, state);
  const edges = graph.edges
    .map(
      (e) =>
        `<path d="${e.d}" class="edge ${e.active ? 'active' : ''}" data-from="${e.from}" data-to="${e.to}" />`
    )
    .join('');

  const tierBands = graph.rows
    .map((row, i) => {
      const y = graph.padY + i * (graph.nodeH + graph.gapY);
      return `<div class="tier-band" style="top:${y - 30}px">
        <span class="tier-label">${esc(row.tier.label)}</span>
        <span class="tier-blurb">${esc(row.tier.blurb)}</span>
      </div>`;
    })
    .join('');

  const nodes = graph.nodes
    .map(
      (n) =>
        `<div class="node-slot" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px">${nodeCard(n)}</div>`
    )
    .join('');

  return `<div class="roadmap-scroll">
    <div class="roadmap-canvas" style="width:${graph.width}px;height:${graph.height}px">
      <svg class="edges" viewBox="0 0 ${graph.width} ${graph.height}" aria-hidden="true">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        ${edges}
      </svg>
      ${tierBands}
      ${nodes}
    </div>
  </div>`;
}

function stackedView(certData, state) {
  return `<div class="tier-stack">${Object.entries(certData.tiers)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([tierId, tier]) => {
      const certs = certData.certifications.filter((c) => c.tier === tierId);
      if (!certs.length) return '';
      return `<section class="tier-group">
        <header class="tier-group-head">
          <h3>${esc(tier.label)}</h3>
          <p>${esc(tier.blurb)}</p>
        </header>
        <div class="tier-cards">${certs
          .map((cert) =>
            nodeCard(
              { cert, status: state.status[cert.code], readiness: state.readiness[cert.code] },
              { compact: true }
            )
          )
          .join('')}</div>
        ${certs.some((c) => c.unlocks?.length)
          ? `<ul class="path-hints">${certs
              .filter((c) => c.unlocks?.length)
              .map(
                (c) =>
                  `<li>${esc(c.shortName)} ${icon('arrowRight', { size: 13 })} ${c.unlocks
                    .map((u) => esc(certData.certifications.find((x) => x.code === u)?.shortName || u))
                    .join(', ')}</li>`
              )
              .join('')}</ul>`
          : ''}
      </section>`;
    })
    .join('')}</div>`;
}

export function render(ctx) {
  const { certData, state } = ctx;
  const suggestions = suggestNext(state, certData);
  const counts = { mastered: 0, 'in-progress': 0, available: 0, locked: 0 };
  for (const c of certData.certifications) counts[state.status[c.code]]++;

  const wide = window.matchMedia('(min-width: 900px)').matches;

  return `
    <section class="page-head">
      <div>
        <h2>${icon('map', { size: 22 })} Certification roadmap</h2>
        <p class="muted">Eleven active AWS certifications. Mastering one highlights the exams that build on it — a recommendation, not a gate. AWS enforces no prerequisites, and neither does this app.</p>
      </div>
      <div class="roadmap-summary">
        ${stackBar([
          { value: counts.mastered, tone: 'mastered', label: 'Mastered' },
          { value: counts['in-progress'], tone: 'progress', label: 'In progress' },
          { value: counts.available, tone: 'available', label: 'Ready to start' },
          { value: counts.locked, tone: 'locked', label: 'Locked' },
        ])}
        <ul class="legend">
          <li><i class="dot mastered"></i>${counts.mastered} mastered</li>
          <li><i class="dot progress"></i>${counts['in-progress']} in progress</li>
          <li><i class="dot available"></i>${counts.available} ready</li>
          <li><i class="dot locked"></i>${counts.locked} locked</li>
        </ul>
      </div>
    </section>

    ${suggestions.length
      ? `<section class="suggestions">
          <h3>${icon('target', { size: 18 })} Suggested next</h3>
          <div class="suggestion-grid">${suggestions
            .map(
              (s) => `<article class="suggestion ${s.kind}">
                <header>
                  <span class="pill">${esc(certData.tiers[s.cert.tier].label)}</span>
                  <h4>${esc(s.cert.name)}</h4>
                </header>
                <p>${esc(s.reason)}</p>
                <a class="btn primary" href="${buildHash(['cert', s.code])}">
                  ${icon('play', { size: 15 })} ${s.kind === 'continue' ? 'Continue' : 'Start studying'}
                </a>
              </article>`
            )
            .join('')}</div>
        </section>`
      : ''}

    <section class="roadmap" data-mode="${wide ? 'tree' : 'stack'}">
      ${wide ? treeView(certData, state) : stackedView(certData, state)}
    </section>

    <p class="disclaimer">${icon('warning', { size: 15 })} “Mastered” is this app’s own estimate from generated practice questions — <strong>${state.config.masteryThreshold}% weighted readiness across every domain, over at least ${state.config.minQuestionsForMastery} questions</strong>. It is not a prediction that you will pass the real exam.</p>
  `;
}

export function mount(ctx, root) {
  // Swap between the tree and the stacked layout when the viewport crosses 900px.
  const mq = window.matchMedia('(min-width: 900px)');
  const section = root.querySelector('.roadmap');
  if (!section) return;
  const apply = () => {
    const want = mq.matches ? 'tree' : 'stack';
    if (section.dataset.mode === want) return;
    section.dataset.mode = want;
    section.innerHTML = want === 'tree' ? treeView(ctx.certData, ctx.state) : stackedView(ctx.certData, ctx.state);
  };
  mq.addEventListener('change', apply);
  ctx.onCleanup(() => mq.removeEventListener('change', apply));

  // Highlight the paths in and out of a node on hover/focus.
  const canvas = root.querySelector('.roadmap-canvas');
  if (!canvas) return;
  const setHot = (code) => {
    canvas.querySelectorAll('.edge').forEach((p) => {
      p.classList.toggle('hot', Boolean(code) && (p.dataset.from === code || p.dataset.to === code));
    });
  };
  canvas.addEventListener('pointerover', (e) => {
    const node = e.target.closest('.cert-node');
    setHot(node?.dataset.code || null);
  });
  canvas.addEventListener('pointerleave', () => setHot(null));
  canvas.addEventListener('focusin', (e) => setHot(e.target.closest('.cert-node')?.dataset.code || null));
  canvas.addEventListener('focusout', () => setHot(null));
}
