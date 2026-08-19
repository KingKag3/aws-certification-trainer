import { icon } from '../icons.js';
import { buildHash } from '../router.js';
import { attemptsFor, certificationOf, pitfallIds } from '../progression.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pretty = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * The global entry point for real exam results. Per-certification logs are
 * still where you edit an attempt, but everything is visible and startable
 * from one place — burying this behind "pick a certification first" made it
 * effectively undiscoverable.
 */
export function render(ctx) {
  const { certData, engine } = ctx;
  const attempts = ctx.attempts || [];
  const certs = certData.certifications;

  const rows = certs.map((cert) => ({
    cert,
    mine: attemptsFor(attempts, cert.code),
    certification: certificationOf(attempts, cert.code),
    pitfalls: pitfallIds(attempts, cert.code),
  }));

  const withAttempts = rows.filter((r) => r.mine.length);
  const current = rows.filter((r) => r.certification && !r.certification.expired);
  const expired = rows.filter((r) => r.certification?.expired);
  const expiringSoon = current.filter((r) => r.certification.expiringSoon);
  const totalAttempts = attempts.length;
  const passes = attempts.filter((a) => a.result === 'pass').length;

  return `
    <section class="page-head">
      <div>
        <h2>${icon('trophy', { size: 22 })} Exams</h2>
        <p class="muted">Every time you sit a real AWS exam, record it here — pass or fail. A pass marks the certification as earned and unlocks what follows. A fail lets you flag the topics that caught you out, which then come up about twice as often in your practice quizzes.</p>
      </div>
    </section>

    <section class="stat-grid">
      <div class="stat"><span class="stat-icon">${icon('trophy', { size: 20 })}</span><strong>${current.length}</strong><span>current certification${current.length === 1 ? '' : 's'}</span></div>
      <div class="stat"><span class="stat-icon">${icon('target', { size: 20 })}</span><strong>${totalAttempts}</strong><span>attempt${totalAttempts === 1 ? '' : 's'} logged</span></div>
      <div class="stat"><span class="stat-icon">${icon('check', { size: 20 })}</span><strong>${passes}</strong><span>passed</span></div>
      <div class="stat"><span class="stat-icon">${icon('flame', { size: 20 })}</span><strong>${new Set(attempts.flatMap((a) => a.pitfalls || [])).size}</strong><span>pitfall topics</span></div>
    </section>

    ${expiringSoon.length || expired.length
      ? `<section class="panel">
          <h3>${icon('warning', { size: 18 })} Needs attention</h3>
          <ul class="exam-alert-list">
            ${expired
              .map(
                (r) => `<li class="expired">
                  <strong>${esc(r.cert.shortName)}</strong> expired ${esc(pretty(r.certification.expiresOn))}.
                  <a href="${buildHash(['cert', r.cert.code])}">Recertify</a>
                </li>`
              )
              .join('')}
            ${expiringSoon
              .map(
                (r) => `<li class="soon">
                  <strong>${esc(r.cert.shortName)}</strong> expires ${esc(pretty(r.certification.expiresOn))} — ${r.certification.daysLeft} days left.
                  <a href="${buildHash(['cert', r.cert.code])}">Start revising</a>
                </li>`
              )
              .join('')}
          </ul>
        </section>`
      : ''}

    <section class="panel">
      <h3>Log a result</h3>
      <p class="muted small">Pick the exam you sat.</p>
      <div class="exam-picker">
        ${certs
          .map((cert) => {
            const r = rows.find((x) => x.cert.code === cert.code);
            const certified = r.certification && !r.certification.expired;
            return `<a class="exam-pick${certified ? ' certified' : ''}" href="${buildHash(['cert', cert.code, 'attempts'], { new: 1 })}">
              <span class="exam-pick-code">${esc(cert.code)}</span>
              <span class="exam-pick-name">${esc(cert.shortName)}</span>
              <span class="exam-pick-meta">${
                certified
                  ? `${icon('trophy', { size: 12 })} certified`
                  : r.mine.length
                    ? `${r.mine.length} attempt${r.mine.length === 1 ? '' : 's'}`
                    : `${icon('plus', { size: 12 })} log`
              }</span>
            </a>`;
          })
          .join('')}
      </div>
    </section>

    ${withAttempts.length
      ? withAttempts
          .map(
            (r) => `<section class="panel">
              <div class="exam-cert-head">
                <h3><a href="${buildHash(['cert', r.cert.code])}">${esc(r.cert.name)}</a></h3>
                ${r.certification
                  ? `<span class="pill status ${r.certification.expired ? 'locked' : 'certified'}">${r.certification.expired ? 'expired' : 'certified'}</span>`
                  : ''}
                <a class="btn small" href="${buildHash(['cert', r.cert.code, 'attempts'])}">Open log</a>
              </div>
              <ul class="attempt-list">
                ${r.mine
                  .map((a) => {
                    const passed = a.result === 'pass';
                    return `<li class="attempt-card ${passed ? 'pass' : 'fail'}">
                      <header>
                        <span class="attempt-verdict ${passed ? 'pass' : 'fail'}">
                          ${icon(passed ? 'check' : 'warning', { size: 15 })} ${passed ? 'Passed' : 'Did not pass'}
                        </span>
                        <span class="attempt-date">${esc(pretty(a.date))}</span>
                        ${a.score != null && a.score !== ''
                          ? `<span class="attempt-score${a.score >= r.cert.exam.passingScore ? ' good' : ' bad'}">${a.score}<span> / ${r.cert.exam.scoreRange[1]}</span></span>`
                          : ''}
                      </header>
                      ${(a.pitfalls || []).length
                        ? `<div class="attempt-pitfalls"><ul>${a.pitfalls
                            .map((id) => `<li>${esc(engine.entityById.get(id)?.name || id)}</li>`)
                            .join('')}</ul></div>`
                        : ''}
                      ${a.notes ? `<p class="attempt-notes">${esc(a.notes)}</p>` : ''}
                    </li>`;
                  })
                  .join('')}
              </ul>
            </section>`
          )
          .join('')
      : `<p class="empty">No exam attempts logged yet. Sat one already? Pick it above — even an old pass is worth recording, because it marks the certification as earned and opens up the roadmap.</p>`}

    <p class="disclaimer">${icon('warning', { size: 15 })} Only passes appear on the shared leaderboard. Failed attempts, scores and notes stay private to your account.</p>
  `;
}
