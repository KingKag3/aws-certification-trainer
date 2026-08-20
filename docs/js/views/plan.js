import { icon } from '../icons.js';
import { buildHash } from '../router.js';
import { buildStudyPlan } from '../progression.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pretty = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const short = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function render(ctx) {
  const cert = ctx.engine.certByCode.get(ctx.params.code);
  if (!cert) return `<p class="empty">Unknown certification code “${esc(ctx.params.code)}”.</p>`;
  return `
    <nav class="crumbs"><a href="${buildHash(['cert', cert.code])}">${icon('arrowLeft', { size: 14 })} ${esc(cert.shortName)}</a></nav>
    <div id="plan-root"><p class="empty">Loading…</p></div>
  `;
}

export function mount(ctx, root) {
  const cert = ctx.engine.certByCode.get(ctx.params.code);
  if (!cert) return;
  const host = root.querySelector('#plan-root');

  /** A very short set is not worth the round trip, so a drill is never under 5. */
  const drillCount = (t) => Math.max(5, t.target || 10);

  /** Where "today's session" should send you. */
  function actionLink(t) {
    if (t.kind === 'concepts') return buildHash(['cert', cert.code, 'concepts']);
    if (t.kind === 'mock') return buildHash(['cert', cert.code, 'mock']);
    if (t.kind === 'domain') return buildHash(['cert', cert.code, 'quiz'], { domain: t.domainId, n: drillCount(t) });
    if (t.kind === 'past') return buildHash(['cert', cert.code, 'attempts'], { new: 1 });
    return buildHash(['cert', cert.code, 'quiz'], { n: 10 });
  }
  const actionLabel = (t) =>
    ({ concepts: 'Open Concepts', mock: 'Start the mock', domain: `Drill ${drillCount(t)} questions`, past: 'Log the result' }[t.kind] || 'Start');

  function setupForm(existing) {
    return `<section class="panel plan-setup">
      <h3>${icon('target', { size: 18 })} ${existing ? 'Change your exam date' : 'When is your exam?'}</h3>
      <p class="muted small">Everything else is worked out from the date — how much to do each day, what to do today, and whether you are on track.</p>
      <form id="plan-form" class="plan-form">
        <label class="field">
          <span>Exam date</span>
          <input name="examDate" type="date" min="${todayIso()}" value="${esc(existing?.examDate || '')}" required>
        </label>
        <div class="plan-form-actions">
          <button class="btn primary" type="submit">${existing ? 'Update plan' : 'Build my plan'}</button>
          ${existing ? '<button class="btn ghost" type="button" data-action="clear">Remove plan</button>' : ''}
          <a class="btn" href="${buildHash(['cert', cert.code])}">Cancel</a>
        </div>
      </form>
      ${existing ? '' : `<p class="muted small">Not booked yet? Pick a realistic target date — you can change it whenever you like.</p>`}
    </section>`;
  }

  function planView(p) {
    const pct = p.questionsNeeded + p.questionsDone
      ? Math.round((p.questionsDone / (p.questionsNeeded + p.questionsDone)) * 100)
      : 100;
    const statusCopy = {
      'on-track': { cls: 'good', label: 'On track', detail: `Ahead of the pace needed to be ready by ${short(p.examDate)}.` },
      behind: { cls: 'bad', label: 'Behind pace', detail: `About ${Math.max(0, p.expectedByNow - p.questionsDone)} questions behind where an even spread would put you.` },
      past: { cls: 'muted', label: 'Date passed', detail: 'Set a new date, or record how it went in the exam log.' },
    }[p.status];

    return `
      <section class="page-head">
        <div>
          <h2>${icon('map', { size: 22 })} Study plan — ${esc(cert.shortName)}</h2>
          <p class="muted">Exam on ${esc(pretty(p.examDate))}.</p>
        </div>
      </section>

      <section class="plan-hero ${p.daysLeft < 0 ? 'past' : p.inFinalStretch ? 'urgent' : ''}">
        <div class="plan-countdown">
          <strong>${p.daysLeft < 0 ? '—' : p.daysLeft}</strong>
          <span>${p.daysLeft < 0 ? 'date passed' : p.daysLeft === 1 ? 'day to go' : 'days to go'}</span>
        </div>
        <div class="plan-pace">
          <span class="pill status ${statusCopy.cls === 'good' ? 'mastered' : statusCopy.cls === 'bad' ? 'locked' : 'available'}">${statusCopy.label}</span>
          <p>${esc(statusCopy.detail)}</p>
          <div class="bar-track"><div class="bar-fill ${pct >= 85 ? 'good' : pct >= 50 ? 'ok' : 'poor'}" style="width:${pct}%"></div></div>
          <p class="muted small">${p.questionsDone} answered${p.questionsNeeded ? ` · about ${p.questionsNeeded} more to a reliable estimate` : ' · enough for a reliable estimate'}${p.daysLeft > 0 && p.questionsNeeded ? ` · roughly ${p.perDay} a day` : ''}</p>
        </div>
      </section>

      <section class="panel plan-today">
        <h3>${icon('play', { size: 18 })} Today</h3>
        <p class="plan-headline">${esc(p.today.headline)}</p>
        <p class="muted">${esc(p.today.detail)}</p>
        <div class="quiz-actions">
          <a class="btn primary lg" href="${actionLink(p.today)}">${esc(actionLabel(p.today))}</a>
          <a class="btn" href="${buildHash(['cert', cert.code])}">Dashboard</a>
        </div>
      </section>

      <section class="panel">
        <h3>Checkpoints</h3>
        <p class="muted small">Dates rather than a day-by-day timetable — a timetable breaks the first day you miss.</p>
        <ul class="milestones">
          ${p.milestones
            .map(
              (m) => `<li class="${m.done ? 'done' : ''}">
                <span class="ms-mark">${m.done ? icon('check', { size: 14 }) : ''}</span>
                <span class="ms-label">${esc(m.label)}</span>
                <span class="ms-by">${m.done ? 'done' : `by ${esc(short(m.by))}`}</span>
              </li>`
            )
            .join('')}
        </ul>
      </section>

      <section class="panel">
        <h3>Mocks</h3>
        <p class="muted small">${p.mocksTaken
          ? `${p.mocksTaken} sat${p.daysSinceMock !== null ? `, most recent ${p.daysSinceMock === 0 ? 'today' : `${p.daysSinceMock} days ago`}` : ''}. Aim for at least two before the day, one of them in the final week.`
          : 'None yet. Timing is what catches people out, and it is the one thing drilling does not rehearse.'}</p>
        <div class="quiz-actions">
          <a class="btn" href="${buildHash(['cert', cert.code, 'mock'])}">${icon('target', { size: 15 })} Mock exam</a>
          <a class="btn ghost" data-action="edit" href="#">Change exam date</a>
        </div>
      </section>
    `;
  }

  async function draw() {
    const plans = await ctx.store.getPlans();
    const plan = plans[cert.code];
    const editing = ctx.query.edit === '1' || !plan;

    if (editing) {
      host.innerHTML = `
        <section class="page-head">
          <div>
            <h2>${icon('map', { size: 22 })} Study plan — ${esc(cert.shortName)}</h2>
            <p class="muted">Work backwards from the day you sit it.</p>
          </div>
        </section>
        ${setupForm(plan)}`;
    } else {
      const built = buildStudyPlan({
        cert,
        readiness: ctx.state.readiness[cert.code],
        progress: ctx.progressByCert[cert.code],
        plan,
        mocks: ctx.mocks || [],
        config: ctx.state.config,
      });
      host.innerHTML = planView(built);
    }
    wire();
  }

  function wire() {
    host.querySelector('#plan-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const date = e.target.elements.examDate.value;
      if (!date) return;
      await ctx.store.setPlan(cert.code, { examDate: date });
      window.location.hash = buildHash(['cert', cert.code, 'plan']);
      ctx.refresh();
    });
    host.querySelector('[data-action="clear"]')?.addEventListener('click', async () => {
      if (!window.confirm('Remove the study plan for this certification?')) return;
      await ctx.store.removePlan(cert.code);
      ctx.refresh();
    });
    host.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = buildHash(['cert', cert.code, 'plan'], { edit: 1 });
    });
  }

  draw();
}
