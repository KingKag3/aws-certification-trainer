import { icon } from '../icons.js';
import { buildHash } from '../router.js';
import { memberSummary, LEADERBOARD_SORTS } from '../progression.js';
import { MEMBER_COLORS } from '../store.js';
import { cloud, friendlyAuthError, markCloudSeen } from '../cloud.js';

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
  return `<span class="avatar" style="--av:${esc(member.color || '#FF9900')};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px"
    aria-hidden="true">${esc(initials(member.name || '?'))}</span>`;
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
        <p class="muted" id="members-lede">Loading…</p>
      </div>
    </section>
    <div id="members-root"><p class="empty">Loading members…</p></div>
  `;
}

export function mount(ctx, root) {
  const host = root.querySelector('#members-root');
  const lede = root.querySelector('#members-lede');
  const codes = ctx.certData.certifications.map((c) => c.code);
  let sortKey = ctx.query.sort && LEADERBOARD_SORTS[ctx.query.sort] ? ctx.query.sort : 'mastered';
  let editingId = null;
  let authMode = 'signin';
  let authBusy = false;
  let authError = '';
  let authNotice = '';

  const isCloud = () => ctx.store.mode === 'cloud' && cloud.user;

  /* ---------------- data loading ---------------- */

  async function loadLocal() {
    const roster = await ctx.store.ensureRoster();
    const summaries = [];
    for (const member of roster.members) {
      const progressByCert = await ctx.store.allCertsFor(member.id, codes);
      const profile = await ctx.store.getProfileFor(member.id);
      summaries.push(memberSummary(member, ctx.certData, progressByCert, profile));
    }
    return { roster, summaries };
  }

  async function loadCloudBoard() {
    try {
      const rows = await cloud.fetchLeaderboard();
      return rows.map((r) => ({
        member: { id: r.uid, name: r.displayName, color: r.color },
        answered: r.answered || 0,
        correct: r.correct || 0,
        accuracy: r.accuracy || 0,
        mastered: r.mastered || 0,
        avgReadiness: r.avgReadiness || 0,
        streak: r.streak || 0,
        longestStreak: r.longestStreak || 0,
        lastStudiedAt: r.updatedAt?.toMillis?.() || 0,
        isMe: r.uid === cloud.user?.uid,
      }));
    } catch (err) {
      console.error('Leaderboard read failed:', err);
      return { error: err };
    }
  }

  /* ---------------- shared pieces ---------------- */

  function podium(ranked) {
    const top = ranked.filter((s) => s.answered > 0).slice(0, 3);
    if (top.length < 2) return '';
    const order = [1, 0, 2];
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

  function boardRows(ranked, activeId) {
    const sort = LEADERBOARD_SORTS[sortKey];
    return `<ol class="leaderboard">${ranked
      .map(
        (s, i) => `<li class="lb-row${s.member.id === activeId || s.isMe ? ' active' : ''}${s.answered ? '' : ' idle'}">
          <span class="lb-rank">${s.answered ? i + 1 : '—'}</span>
          ${avatar(s.member, 30)}
          <span class="lb-name">${esc(s.member.name)}${s.isMe ? ' <span class="you-tag">you</span>' : ''}</span>
          <span class="lb-primary">${esc(sort.format(s))}</span>
          <span class="lb-bar"><i style="width:${Math.max(2, s.avgReadiness)}%;background:${esc(s.member.color || '#FF9900')}"></i></span>
          <span class="lb-sub">${s.answered} q · ${s.answered ? s.accuracy + '%' : '—'} · ${s.streak}d</span>
        </li>`
      )
      .join('')}</ol>`;
  }

  function sortControl() {
    return `<label class="sort-control">
      <span class="sr-only">Rank by</span>
      <select id="sort">
        ${Object.entries(LEADERBOARD_SORTS)
          .map(([k, v]) => `<option value="${k}"${k === sortKey ? ' selected' : ''}>Rank by ${esc(v.label.toLowerCase())}</option>`)
          .join('')}
      </select>
    </label>`;
  }

  /* ---------------- signed-out (local) view ---------------- */

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

  function authPanel() {
    if (!cloud.enabled) return '';
    const signup = authMode === 'signup';
    return `<section class="panel auth-panel">
      <h3>${icon('globe', { size: 18 })} Study on more than one device</h3>
      <p class="muted small">
        The members below live in this browser only — nobody on another phone or laptop can see them or join.
        Create an account and your progress follows you anywhere, and you appear on a leaderboard shared with everyone else who signs in.
      </p>

      <div class="auth-tabs" role="tablist">
        <button class="auth-tab${signup ? '' : ' current'}" data-mode="signin" role="tab" aria-selected="${!signup}">Sign in</button>
        <button class="auth-tab${signup ? ' current' : ''}" data-mode="signup" role="tab" aria-selected="${signup}">Create account</button>
      </div>

      <form class="auth-form" id="auth-form">
        ${signup
          ? `<label class="field">
               <span>Display name</span>
               <input name="displayName" type="text" maxlength="24" autocomplete="nickname" placeholder="Shown on the leaderboard">
             </label>`
          : ''}
        <label class="field">
          <span>Email</span>
          <input name="email" type="email" required autocomplete="email" placeholder="you@example.com">
        </label>
        <label class="field">
          <span>Password</span>
          <input name="password" type="password" required minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? 'At least 6 characters' : ''}">
        </label>
        ${authError ? `<p class="auth-error">${icon('warning', { size: 14 })} ${esc(authError)}</p>` : ''}
        ${authNotice ? `<p class="auth-notice">${esc(authNotice)}</p>` : ''}
        <div class="auth-actions">
          <button class="btn primary" type="submit" ${authBusy ? 'disabled' : ''}>
            ${authBusy ? 'Working…' : signup ? 'Create account' : 'Sign in'}
          </button>
          ${signup ? '' : '<button class="btn ghost" type="button" data-action="reset-password">Forgot password</button>'}
        </div>
      </form>
      <p class="muted small">Your password is handled by Firebase Authentication and never reaches this site's code or its repository.</p>
    </section>`;
  }

  async function drawLocal() {
    const { roster, summaries } = await loadLocal();
    const ranked = summaries.slice().sort(LEADERBOARD_SORTS[sortKey].compare);
    const anyProgress = summaries.some((s) => s.answered > 0);

    lede.innerHTML =
      'Everyone studying on this browser. Each member keeps their own progress, weak spots and streak — switching member switches the whole app.';

    host.innerHTML = `
      ${authPanel()}

      <section class="panel leaderboard-panel">
        <div class="leaderboard-head">
          <h3>${icon('trophy', { size: 18 })} Leaderboard <span class="scope-tag local">this browser</span></h3>
          ${sortControl()}
        </div>
        ${anyProgress
          ? podium(ranked) + boardRows(ranked, roster.activeId)
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
        <p class="muted small">These profiles never leave this browser. To study from another device, create an account above.</p>
      </section>
    `;

    wireLocal(roster);
    wireAuth();
  }

  /* ---------------- signed-in (cloud) view ---------------- */

  async function drawCloud() {
    const user = cloud.user;
    const board = await loadCloudBoard();
    const failed = !Array.isArray(board);
    const rows = failed ? [] : board;
    const ranked = rows.slice().sort(LEADERBOARD_SORTS[sortKey].compare);
    const me = rows.find((r) => r.isMe);
    const localCandidates = await ctx.store.localMembersWithProgress(codes);

    lede.innerHTML =
      'Signed in. Your progress syncs to every device you sign in from, and the leaderboard is shared with everyone else using this app.';

    host.innerHTML = `
      <section class="panel account-panel">
        <div class="account-head">
          ${avatar({ name: user.displayName || user.email, color: me?.member.color || '#FF9900' }, 48)}
          <div class="account-id">
            <strong>${esc(user.displayName || user.email.split('@')[0])}</strong>
            <span class="muted small">${esc(user.email)}</span>
          </div>
          <span class="pill status mastered">${icon('check', { size: 13 })} synced</span>
        </div>
        <form class="rename-form" id="rename-form">
          <label class="field">
            <span>Display name on the leaderboard</span>
            <input name="displayName" type="text" value="${esc(user.displayName || '')}" maxlength="24" required>
          </label>
          <button class="btn small" type="submit">Save name</button>
        </form>
        <div class="quiz-actions">
          <button class="btn" data-action="signout">${icon('swap', { size: 15 })} Sign out</button>
          <button class="btn ghost" data-action="wipe-cloud">${icon('trash', { size: 15 })} Delete my cloud progress</button>
        </div>
        <p class="muted small">Signing out returns this browser to its local profiles. Nothing in the cloud is deleted.</p>
      </section>

      ${localCandidates.length
        ? `<section class="panel upload-panel">
            <h3>${icon('upload', { size: 18 })} Bring local progress with you</h3>
            <p class="muted small">This browser has study history saved before you signed in. Copy it into your account — existing cloud progress that is further along is never overwritten.</p>
            <ul class="upload-list">${localCandidates
              .map(
                (m) => `<li>
                  ${avatar(m, 30)}
                  <span>${esc(m.name)}</span>
                  <span class="muted small">${m.answered} answered</span>
                  <button class="btn small" data-action="upload" data-id="${m.id}" data-name="${esc(m.name)}">Copy to my account</button>
                </li>`
              )
              .join('')}</ul>
          </section>`
        : ''}

      <section class="panel leaderboard-panel">
        <div class="leaderboard-head">
          <h3>${icon('trophy', { size: 18 })} Leaderboard <span class="scope-tag cloud">${icon('globe', { size: 12 })} everyone signed in</span></h3>
          ${sortControl()}
        </div>
        ${failed
          ? `<p class="auth-error">${icon('warning', { size: 14 })} Could not read the leaderboard. If you have just published the security rules, give it a moment and reload. Otherwise check that <code>firestore.rules</code> from the repository has been published in the Firebase console.</p>`
          : ranked.some((s) => s.answered > 0)
            ? podium(ranked) + boardRows(ranked, user.uid)
            : '<p class="muted small">Nobody has answered a question yet. Run a quiz and you will be first on the board.</p>'}
        ${sortKey === 'accuracy'
          ? '<p class="muted small">Members with fewer than 20 answers are listed but not ranked on accuracy.</p>'
          : ''}
      </section>
    `;

    wireCloud();
  }

  /* ---------------- wiring ---------------- */

  function wireSort() {
    host.querySelector('#sort')?.addEventListener('change', (e) => {
      sortKey = e.target.value;
      draw();
    });
  }

  function wireLocal(roster) {
    wireSort();

    host.querySelector('#add-member')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.target.elements.name;
      if (!input.value.trim()) return;
      await ctx.store.addMember(input.value);
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

  function wireAuth() {
    host.querySelectorAll('.auth-tab').forEach((tab) =>
      tab.addEventListener('click', () => {
        authMode = tab.dataset.mode;
        authError = '';
        authNotice = '';
        draw();
      })
    );

    const form = host.querySelector('#auth-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (authBusy) return;
      const { email, password, displayName } = form.elements;
      authBusy = true;
      authError = '';
      authNotice = '';
      draw();
      try {
        if (authMode === 'signup') {
          await cloud.signUp(email.value, password.value, displayName?.value);
        } else {
          await cloud.signIn(email.value, password.value);
        }
        markCloudSeen();
        await ctx.onCloudSignIn();
      } catch (err) {
        authError = friendlyAuthError(err);
        authBusy = false;
        draw();
      }
    });

    host.querySelector('[data-action="reset-password"]')?.addEventListener('click', async () => {
      const email = host.querySelector('#auth-form')?.elements.email.value;
      if (!email) {
        authError = 'Enter your email address first, then press Forgot password.';
        return draw();
      }
      try {
        await cloud.resetPassword(email);
        authNotice = `Password reset email sent to ${email}.`;
        authError = '';
      } catch (err) {
        authError = friendlyAuthError(err);
      }
      draw();
    });
  }

  function wireCloud() {
    wireSort();

    host.querySelector('#rename-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await cloud.setDisplayName(e.target.elements.displayName.value);
      await ctx.store.adoptCloudUser(cloud.user);
      await ctx.publishSummary(true);
      ctx.refresh();
    });

    host.querySelector('[data-action="signout"]')?.addEventListener('click', async () => {
      await cloud.signOut();
      await ctx.onCloudSignOut();
    });

    host.querySelector('[data-action="wipe-cloud"]')?.addEventListener('click', async () => {
      if (!window.confirm('Delete all of your progress stored in the cloud, on every device? This cannot be undone.')) return;
      await cloud.deleteAccountData();
      ctx.refresh();
    });

    host.querySelectorAll('[data-action="upload"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const { id, name } = btn.dataset;
        btn.disabled = true;
        btn.textContent = 'Copying…';
        const copied = await ctx.store.copyLocalMemberToActive(id, cloud.user.uid, codes);
        await ctx.publishSummary(true);
        window.alert(copied ? `Copied ${name}'s progress for ${copied} certification${copied === 1 ? '' : 's'}.` : `Nothing to copy — your account is already further along than ${name}.`);
        ctx.refresh();
      })
    );
  }

  function draw() {
    return isCloud() ? drawCloud() : drawLocal();
  }

  draw();
}
