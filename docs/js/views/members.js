import { icon } from '../icons.js';
import { buildHash } from '../router.js';
import { memberSummary, LEADERBOARD_SORTS } from '../progression.js';
import { MEMBER_COLORS } from '../store.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

export function avatar(member, size = 40) {
  return `<span class="avatar" style="--av:${esc(member.color)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px"
    aria-hidden="true">${esc(initials(member.name))}</span>`;
}

function relative(ts) {
  if (!ts) return 'never';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(ts).toLocaleDateString();
}

export function render() {
  return `
    <section class="page-head">
      <div>
        <h2>${icon('users', { size: 22 })} Members</h2>
        <p class="muted">Everyone studying on this browser. Each member keeps their own progress, weak spots and streak — switching member switches the whole app.</p>
      </div>
    </section>
    <div id="members-root"><p class="empty">Loading members…</p></div>
  `;
}

export function mount(ctx, root) {
  const host = root.querySelector('#members-root');
  const codes = ctx.certData.certifications.map((c) => c.code);
  let sortKey = ctx.query.sort && LEADERBOARD_SORTS[ctx.query.sort] ? ctx.query.sort : 'mastered';
  let editingId = null;

  async function load() {
    const roster = await ctx.store.ensureRoster();
    const summaries = [];
    for (const member of roster.members) {
      const progressByCert = await ctx.store.allCertsFor(member.id, codes);
      const profile = await ctx.store.getProfileFor(member.id);
      summaries.push(memberSummary(member, ctx.certData, progressByCert, profile));
    }
    return { roster, summaries };
  }

  function podium(ranked) {
    const top = ranked.filter((s) => s.answered > 0).slice(0, 3);
    if (top.length < 2) return '';
    const order = [1, 0, 2]; // silver, gold, bronze — gold raised in the middle
    return `<ol class="podium">${order
      .filter((i) => top[i])
      .map((i) => {
        const s = top[i];
        return `<li class="podium-step p${i + 1}">
          <span class="podium-rank">${i + 1}</span>
          ${avatar(s.member, i === 0 ? 56 : 44)}
          <strong>${esc(s.member.name)}</strong>
          <span class="podium-stat">${esc(LEADERBOARD_SORTS[sortKey].format(s))}</span>
          <span class="podium-block"></span>
        </li>`;
      })
      .join('')}</ol>`;
  }

  function memberRow(s, rank, activeId) {
    const m = s.member;
    const isActive = m.id === activeId;
    if (editingId === m.id) {
      return `<li class="member-card editing">
        <form class="member-edit" data-id="${m.id}">
          <label class="sr-only" for="name-${m.id}">Member name</label>
          <input id="name-${m.id}" name="name" type="text" value="${esc(m.name)}" maxlength="24" required>
          <fieldset class="swatches">
            <legend class="sr-only">Avatar colour</legend>
            ${MEMBER_COLORS.map(
              (c) => `<label class="swatch" style="--av:${c}">
                <input type="radio" name="color" value="${c}"${c === m.color ? ' checked' : ''}>
                <span></span>
              </label>`
            ).join('')}
          </fieldset>
          <div class="member-edit-actions">
            <button class="btn small primary" type="submit">Save</button>
            <button class="btn small" type="button" data-action="cancel-edit">Cancel</button>
          </div>
        </form>
      </li>`;
    }

    return `<li class="member-card${isActive ? ' active' : ''}">
      <span class="member-rank">${s.answered ? rank : '—'}</span>
      ${avatar(m, 44)}
      <div class="member-id">
        <strong>${esc(m.name)}${isActive ? ' <span class="you-tag">active</span>' : ''}</strong>
        <span class="muted small">${s.answered ? `last studied ${relative(s.lastStudiedAt)}` : 'no attempts yet'}</span>
      </div>
      <dl class="member-stats">
        <div><dt>Mastered</dt><dd>${s.mastered}<span>/${codes.length}</span></dd></div>
        <div><dt>Avg readiness</dt><dd>${s.avgReadiness}<span>%</span></dd></div>
        <div><dt>Answered</dt><dd>${s.answered}</dd></div>
        <div><dt>Accuracy</dt><dd>${s.answered ? s.accuracy + '<span>%</span>' : '—'}</dd></div>
        <div><dt>Streak</dt><dd>${s.streak}<span>d</span></dd></div>
      </dl>
      <p class="member-best">${
        s.bestCert
          ? `Strongest: <a href="${buildHash(['cert', s.bestCert.cert.code])}">${esc(s.bestCert.cert.shortName)}</a> at ${s.bestCert.readiness.overall}%`
          : '<span class="muted">Nothing started yet</span>'
      }</p>
      <div class="member-actions">
        ${isActive
          ? '<span class="btn small ghost" aria-disabled="true">Studying as this member</span>'
          : `<button class="btn small primary" data-action="switch" data-id="${m.id}">${icon('swap', { size: 14 })} Study as ${esc(m.name)}</button>`}
        <button class="btn small" data-action="edit" data-id="${m.id}">${icon('edit', { size: 14 })} Edit</button>
        <button class="btn small ghost" data-action="remove" data-id="${m.id}" data-name="${esc(m.name)}">${icon('trash', { size: 14 })} Remove</button>
      </div>
    </li>`;
  }

  async function draw() {
    const { roster, summaries } = await load();
    const sort = LEADERBOARD_SORTS[sortKey];
    const ranked = summaries.slice().sort(sort.compare);
    const anyProgress = summaries.some((s) => s.answered > 0);

    host.innerHTML = `
      <section class="panel leaderboard-panel">
        <div class="leaderboard-head">
          <h3>${icon('trophy', { size: 18 })} Leaderboard</h3>
          <label class="sort-control">
            <span class="sr-only">Rank by</span>
            <select id="sort">
              ${Object.entries(LEADERBOARD_SORTS)
                .map(([k, v]) => `<option value="${k}"${k === sortKey ? ' selected' : ''}>Rank by ${esc(v.label.toLowerCase())}</option>`)
                .join('')}
            </select>
          </label>
        </div>
        ${anyProgress
          ? podium(ranked) +
            `<ol class="leaderboard">${ranked
              .map(
                (s, i) => `<li class="lb-row${s.member.id === roster.activeId ? ' active' : ''}${s.answered ? '' : ' idle'}">
                  <span class="lb-rank">${s.answered ? i + 1 : '—'}</span>
                  ${avatar(s.member, 30)}
                  <span class="lb-name">${esc(s.member.name)}</span>
                  <span class="lb-primary">${esc(sort.format(s))}</span>
                  <span class="lb-bar"><i style="width:${Math.max(2, s.avgReadiness)}%;background:${esc(s.member.color)}"></i></span>
                  <span class="lb-sub">${s.answered} q · ${s.answered ? s.accuracy + '%' : '—'} · ${s.streak}d</span>
                </li>`
              )
              .join('')}</ol>`
          : '<p class="muted small">No one has answered a question yet. The board fills in as soon as someone runs a quiz.</p>'}
        ${sortKey === 'accuracy'
          ? '<p class="muted small">Members with fewer than 20 answers are listed but not ranked on accuracy — a 3-for-3 start is not a 100% record.</p>'
          : ''}
      </section>

      <section class="panel">
        <h3>Roster</h3>
        <ul class="member-list">${ranked.map((s, i) => memberRow(s, i + 1, roster.activeId)).join('')}</ul>

        <form class="add-member" id="add-member">
          <label class="sr-only" for="new-name">New member name</label>
          <input id="new-name" name="name" type="text" placeholder="Add a member…" maxlength="24" required>
          <button class="btn primary" type="submit">${icon('plus', { size: 15 })} Add member</button>
        </form>
        <p class="muted small">Members live in this browser only. Progress does not sync between devices yet — use Profile → Export/Import to move it.</p>
      </section>
    `;

    host.querySelector('#sort').addEventListener('change', (e) => {
      sortKey = e.target.value;
      draw();
    });

    host.querySelector('#add-member').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.target.elements.name;
      if (!input.value.trim()) return;
      await ctx.store.addMember(input.value);
      input.value = '';
      draw();
    });

    host.querySelectorAll('[data-action="switch"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        await ctx.store.setActiveMember(btn.dataset.id);
        ctx.refresh();
      })
    );

    host.querySelectorAll('[data-action="edit"]').forEach((btn) =>
      btn.addEventListener('click', () => {
        editingId = btn.dataset.id;
        draw();
      })
    );

    host.querySelectorAll('[data-action="cancel-edit"]').forEach((btn) =>
      btn.addEventListener('click', () => {
        editingId = null;
        draw();
      })
    );

    host.querySelectorAll('.member-edit').forEach((form) =>
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = form.dataset.id;
        await ctx.store.renameMember(id, form.elements.name.value);
        const color = form.querySelector('input[name="color"]:checked')?.value;
        if (color) await ctx.store.setMemberColor(id, color);
        editingId = null;
        ctx.refresh();
      })
    );

    host.querySelectorAll('[data-action="remove"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const { id, name } = btn.dataset;
        if (roster.members.length === 1) {
          window.alert('This is the only member. Add another before removing this one.');
          return;
        }
        if (!window.confirm(`Remove ${name} and delete all of their progress? This cannot be undone.`)) return;
        await ctx.store.removeMember(id);
        ctx.refresh();
      })
    );
  }

  draw();
}
