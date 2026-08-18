import { icon } from '../icons.js';
import { heatmap, ring } from '../charts.js';
import { buildHash } from '../router.js';
import { currentStreak } from '../store.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function render(ctx) {
  const { certData, state, profile, progressByCert } = ctx;
  const streak = currentStreak(profile);
  const accuracy = profile.totalAnswered ? Math.round((profile.totalCorrect / profile.totalAnswered) * 100) : 0;
  const daysStudied = Object.keys(profile.days).length;

  const rows = certData.certifications
    .map((cert) => ({
      cert,
      status: state.status[cert.code],
      readiness: state.readiness[cert.code],
      progress: progressByCert[cert.code],
    }))
    .sort((a, b) => b.progress.answered - a.progress.answered || a.cert.code.localeCompare(b.cert.code));

  const active = rows.filter((r) => r.progress.answered > 0);

  return `
    <section class="page-head">
      <div>
        <h2>${icon('user', { size: 22 })} ${esc(ctx.activeMember?.name || 'Your')}${ctx.activeMember ? '’s profile' : ' profile'}</h2>
        <p class="muted">Progress for the member you are currently studying as. Everything here lives in this browser’s local storage — clearing site data wipes it, and it does not follow you to another device. <a href="${buildHash(['members'])}">Switch member</a></p>
      </div>
    </section>

    <section class="stat-grid">
      <div class="stat"><span class="stat-icon">${icon('flame', { size: 20 })}</span><strong>${streak}</strong><span>day streak${profile.longestStreak > streak ? ` · best ${profile.longestStreak}` : ''}</span></div>
      <div class="stat"><span class="stat-icon">${icon('target', { size: 20 })}</span><strong>${profile.totalAnswered}</strong><span>questions answered</span></div>
      <div class="stat"><span class="stat-icon">${icon('check', { size: 20 })}</span><strong>${accuracy}%</strong><span>overall accuracy</span></div>
      <div class="stat"><span class="stat-icon">${icon('map', { size: 20 })}</span><strong>${state.masteredCodes.size}</strong><span>of ${certData.certifications.length} mastered</span></div>
      <div class="stat"><span class="stat-icon">${icon('book', { size: 20 })}</span><strong>${daysStudied}</strong><span>day${daysStudied === 1 ? '' : 's'} studied</span></div>
    </section>

    <section class="panel">
      <h3>Activity</h3>
      ${daysStudied
        ? heatmap(profile.days)
        : '<p class="muted small">No activity recorded yet. Answer a question and this fills in.</p>'}
      <ul class="heat-legend"><li>Less</li><li><i class="heat-key l0"></i></li><li><i class="heat-key l1"></i></li><li><i class="heat-key l2"></i></li><li><i class="heat-key l3"></i></li><li><i class="heat-key l4"></i></li><li>More</li></ul>
    </section>

    <section class="panel">
      <h3>Certifications</h3>
      ${active.length
        ? `<div class="table-scroll"><table class="cert-table">
            <thead><tr><th>Certification</th><th>Status</th><th>Readiness</th><th>Accuracy</th><th>Answered</th><th>Weakest domain</th></tr></thead>
            <tbody>${rows
              .map(
                (r) => `<tr class="${r.progress.answered ? '' : 'untouched'}">
                  <td><a href="${buildHash(['cert', r.cert.code])}">${esc(r.cert.shortName)}</a><span class="cell-sub">${esc(r.cert.code)}</span></td>
                  <td><span class="pill status ${r.status}">${r.status.replace('-', ' ')}</span></td>
                  <td><div class="mini-meter"><i style="width:${r.readiness.overall}%"></i></div><span class="cell-sub">${r.readiness.overall}%</span></td>
                  <td>${r.progress.answered ? r.readiness.accuracy + '%' : '—'}</td>
                  <td>${r.progress.answered || '—'}</td>
                  <td>${r.readiness.weakestDomain ? esc(`D${r.readiness.weakestDomain.number} ${r.readiness.weakestDomain.name}`) + ` (${r.readiness.weakestDomain.accuracy}%)` : '—'}</td>
                </tr>`
              )
              .join('')}</tbody>
          </table></div>`
        : '<p class="muted small">Nothing started yet. Pick a certification from the roadmap.</p>'}
    </section>

    ${active.length
      ? `<section class="panel">
          <h3>Readiness at a glance</h3>
          <div class="ring-row">${active
            .slice(0, 6)
            .map(
              (r) => `<a class="ring-cell" href="${buildHash(['cert', r.cert.code])}">
                ${ring(r.readiness.overall, { size: 96, stroke: 8, caption: r.cert.code })}
              </a>`
            )
            .join('')}</div>
        </section>`
      : ''}

    <section class="panel danger-zone">
      <h3>Your data</h3>
      <p class="muted small">Progress is stored under the <code>awsstudy:v1:</code> key prefix in this browser, namespaced per member. Export covers <strong>every member on this device</strong> and gives you a JSON file you can import into another browser.</p>
      <div class="quiz-actions">
        <button class="btn" data-action="export">${icon('download', { size: 15 })} Export all members</button>
        <button class="btn" data-action="import">${icon('upload', { size: 15 })} Import progress</button>
        <button class="btn ghost" data-action="clear-me">${icon('refresh', { size: 15 })} Reset ${esc(ctx.activeMember?.name || 'this member')}</button>
        <button class="btn ghost" data-action="clear">${icon('trash', { size: 15 })} Clear everything</button>
      </div>
      <input type="file" id="import-file" accept="application/json" hidden>
    </section>
  `;
}

export function mount(ctx, root) {
  root.querySelector('[data-action="export"]')?.addEventListener('click', async () => {
    const payload = await ctx.store.exportAll();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aws-study-progress-${payload.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const file = root.querySelector('#import-file');
  root.querySelector('[data-action="import"]')?.addEventListener('click', () => file?.click());
  file?.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      await ctx.store.importAll(JSON.parse(await f.text()));
      ctx.refresh();
    } catch (err) {
      window.alert(`Could not import that file: ${err.message}`);
    }
  });

  root.querySelector('[data-action="clear-me"]')?.addEventListener('click', async () => {
    const name = ctx.activeMember?.name || 'this member';
    if (!window.confirm(`Delete all of ${name}'s progress across every certification? Other members are unaffected. This cannot be undone.`)) return;
    await ctx.store.clearMemberProgress(ctx.activeMember.id);
    ctx.refresh();
  });

  root.querySelector('[data-action="clear"]')?.addEventListener('click', async () => {
    if (!window.confirm('Delete every member and all of their progress on this device? This cannot be undone.')) return;
    await ctx.store.clearAll();
    ctx.refresh();
  });
}
