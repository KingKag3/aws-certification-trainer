/**
 * Hand-rolled SVG charts. No Chart.js, no CDN, no build step.
 * Every colour comes from a CSS custom property so both themes work.
 */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------------ */
/* Radar — domain accuracy against AWS's real domain weighting          */
/* ------------------------------------------------------------------ */

export function radarChart(domains, { size = 320, label = 'Accuracy by exam domain' } = {}) {
  if (!domains.length) return '';
  const cx = size / 2;
  const cy = size / 2 + 6;
  const r = size / 2 - 58;
  const n = domains.length;
  const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i, value) => {
    const rad = (value / 100) * r;
    return [cx + Math.cos(angle(i)) * rad, cy + Math.sin(angle(i)) * rad];
  };

  const rings = [25, 50, 75, 100]
    .map((v) => {
      const pts = domains.map((_, i) => point(i, v).join(',')).join(' ');
      return `<polygon points="${pts}" class="radar-ring" />`;
    })
    .join('');

  const spokes = domains
    .map((_, i) => {
      const [x, y] = point(i, 100);
      return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="radar-spoke" />`;
    })
    .join('');

  const accPts = domains.map((d, i) => point(i, d.accuracy).join(',')).join(' ');
  const dots = domains
    .map((d, i) => {
      const [x, y] = point(i, d.accuracy);
      return `<circle cx="${x}" cy="${y}" r="3.5" class="radar-dot" />`;
    })
    .join('');

  const labels = domains
    .map((d, i) => {
      const [x, y] = point(i, 118);
      const anchor = Math.abs(x - cx) < 12 ? 'middle' : x > cx ? 'start' : 'end';
      return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="radar-label">
        <tspan x="${x}" dy="0">D${d.number}</tspan>
        <tspan x="${x}" dy="13" class="radar-sublabel">${d.answered ? d.accuracy + '%' : '—'}</tspan>
      </text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${size} ${size + 10}" class="chart radar" role="img" aria-label="${esc(label)}">
    ${rings}${spokes}
    <polygon points="${accPts}" class="radar-area" />
    ${dots}${labels}
  </svg>`;
}

/* ------------------------------------------------------------------ */
/* Domain bars — accuracy, with the exam weighting shown alongside      */
/* ------------------------------------------------------------------ */

export function domainBars(domains) {
  if (!domains.length) return '';
  return `<ul class="bars">${domains
    .map((d) => {
      const pct = d.answered ? d.accuracy : 0;
      const state = !d.answered ? 'empty' : pct >= 85 ? 'good' : pct >= 65 ? 'ok' : 'poor';
      return `<li class="bar-row">
        <div class="bar-head">
          <span class="bar-name"><span class="bar-num">D${d.number}</span> ${esc(d.name)}</span>
          <span class="bar-value">${d.answered ? `${pct}%` : 'not started'}<span class="bar-weight">${d.weight}% of exam</span></span>
        </div>
        <div class="bar-track" role="img" aria-label="${esc(d.name)}: ${d.answered ? pct + '% accuracy' : 'no questions answered'}">
          <div class="bar-fill ${state}" style="width:${pct}%"></div>
          <div class="bar-target" style="left:85%" title="85% readiness threshold"></div>
        </div>
        <div class="bar-meta">${d.answered} answered${d.thin && d.answered ? ' · too few for a reliable estimate' : ''}</div>
      </li>`;
    })
    .join('')}</ul>`;
}

/* ------------------------------------------------------------------ */
/* Progress ring                                                       */
/* ------------------------------------------------------------------ */

export function ring(percent, { size = 132, stroke = 11, caption = '', sub = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent));
  const offset = c * (1 - pct / 100);
  const tone = pct >= 85 ? 'good' : pct >= 60 ? 'ok' : 'poor';
  return `<div class="ring-wrap">
    <svg viewBox="0 0 ${size} ${size}" class="chart ring" role="img" aria-label="${esc(caption || 'progress')}: ${pct}%">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track" stroke-width="${stroke}" fill="none" />
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fill ${tone}" stroke-width="${stroke}" fill="none"
        stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"
        transform="rotate(-90 ${size / 2} ${size / 2})" />
    </svg>
    <div class="ring-center"><strong>${pct}<span>%</span></strong>${caption ? `<span class="ring-caption">${esc(caption)}</span>` : ''}</div>
    ${sub ? `<p class="ring-sub">${esc(sub)}</p>` : ''}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Streak heatmap                                                      */
/* ------------------------------------------------------------------ */

export function heatmap(days, { weeks = 26, today = new Date() } = {}) {
  const cell = 13;
  const gap = 3;
  const step = cell + gap;
  const leftPad = 26;
  const topPad = 16;

  // Start on the Sunday `weeks` weeks back so columns are whole weeks.
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - (weeks * 7 - 1));
  start.setDate(start.getDate() - start.getDay());

  const key = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const counts = Object.values(days);
  const max = counts.length ? Math.max(...counts) : 0;
  const level = (n) => {
    if (!n) return 0;
    if (!max) return 1;
    const q = n / max;
    return q > 0.66 ? 4 : q > 0.33 ? 3 : q > 0.12 ? 2 : 1;
  };

  const cells = [];
  const monthMarks = [];
  let lastMonth = -1;
  const cursor = new Date(start);
  let col = 0;
  while (cursor <= end) {
    for (let row = 0; row < 7 && cursor <= end; row++) {
      const k = key(cursor);
      const n = days[k] || 0;
      const x = leftPad + col * step;
      const y = topPad + row * step;
      cells.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" class="heat l${level(n)}"><title>${k}: ${n} question${n === 1 ? '' : 's'}</title></rect>`
      );
      if (cursor.getMonth() !== lastMonth && row === 0) {
        lastMonth = cursor.getMonth();
        monthMarks.push(
          `<text x="${x}" y="${topPad - 5}" class="heat-month">${cursor.toLocaleString(undefined, { month: 'short' })}</text>`
        );
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    col++;
  }

  const dayLabels = ['Mon', 'Wed', 'Fri']
    .map((lbl, i) => `<text x="0" y="${topPad + (i * 2 + 1) * step + 10}" class="heat-day">${lbl}</text>`)
    .join('');

  const width = leftPad + col * step;
  const height = topPad + 7 * step;
  return `<svg viewBox="0 0 ${width} ${height}" class="chart heatmap" role="img" aria-label="Study activity over the last ${weeks} weeks">
    ${monthMarks.join('')}${dayLabels}${cells.join('')}
  </svg>`;
}

/* ------------------------------------------------------------------ */
/* Sparkline-ish tier summary bar                                      */
/* ------------------------------------------------------------------ */

export function stackBar(segments) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return `<div class="stack-bar">${segments
    .map((s) => `<span class="seg ${s.tone}" style="width:${(s.value / total) * 100}%" title="${esc(s.label)}: ${s.value}"></span>`)
    .join('')}</div>`;
}
