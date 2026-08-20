import { buildEngine } from './generator.js';
import { buildProgressionState, memberSummary } from './progression.js';
import { progressStore } from './store.js';
import { cloud, markCloudSeen } from './cloud.js';
import { createRouter, parseHash, buildHash } from './router.js';
import { icon } from './icons.js';

import * as roadmapView from './views/roadmap.js';
import * as certView from './views/cert.js';
import * as quizView from './views/quiz.js';
import * as flashcardsView from './views/flashcards.js';
import * as profileView from './views/profile.js';
import * as membersView from './views/members.js';
import * as conceptsView from './views/concepts.js';
import * as attemptsView from './views/attempts.js';
import * as examsView from './views/exams.js';
import { avatar } from './views/members.js';

const DATA_FILES = ['services.json', 'certifications.json', 'templates.json', 'scenarios.json'];

async function loadData() {
  const [services, certifications, templates, scenarios] = await Promise.all(
    DATA_FILES.map(async (f) => {
      const res = await fetch(new URL(`../data/${f}`, import.meta.url));
      if (!res.ok) throw new Error(`Could not load data/${f} (${res.status})`);
      return res.json();
    })
  );
  return { services, certifications, templates, scenarios };
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark' || theme === 'light') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    const isDark =
      theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    btn.innerHTML = icon(isDark ? 'sun' : 'moon', { size: 18 });
    btn.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} theme`);
    btn.title = theme ? `Theme: ${theme}` : 'Theme: follows your system';
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

const app = document.getElementById('app');
let engine;
let certData;
let cleanups = [];

function runCleanups() {
  cleanups.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a listener that has already gone is not an error */
    }
  });
  cleanups = [];
}

/** The header chip showing who the app is currently recording progress for. */
function renderMemberChip(member) {
  const el = document.getElementById('member-chip');
  if (!el || !member) return;
  const synced = progressStore.mode === 'cloud';
  el.classList.toggle('synced', synced);
  el.innerHTML =
    `${avatar(member, 24)}<span class="chip-name">${member.name.replace(/[<>&]/g, '')}</span>` +
    (synced ? `<span class="chip-sync" title="Synced to your account">${icon('globe', { size: 12 })}</span>` : '');
  el.title = synced
    ? `Signed in as ${member.name} — progress syncs across devices`
    : `Studying as ${member.name} (this browser only) — switch member`;
}

/* ------------------------------------------------------------------ */
/* Cloud session                                                       */
/* ------------------------------------------------------------------ */

let lastPublished = '';

/** Pushes the signed-in user's summary to the shared leaderboard when it changes. */
async function publishSummary(force = false) {
  if (progressStore.mode !== 'cloud' || !cloud.user) return;
  try {
    const codes = certData.certifications.map((c) => c.code);
    const member = await progressStore.getActiveMember();
    const progressByCert = await progressStore.allCerts(codes);
    const profile = await progressStore.getProfile();
    const attempts = await progressStore.getAttempts();
    const s = memberSummary(member, certData, progressByCert, profile, new Date(), attempts);
    const payload = {
      color: member.color,
      answered: s.answered,
      correct: s.correct,
      accuracy: s.accuracy,
      mastered: s.mastered,
      // Passes only. Failed attempts and scores never leave the owner's account.
      certified: s.certified,
      avgReadiness: s.avgReadiness,
      streak: s.streak,
      longestStreak: s.longestStreak,
    };
    const fingerprint = JSON.stringify(payload);
    if (!force && fingerprint === lastPublished) return;
    lastPublished = fingerprint;
    await cloud.publishSummary(payload);
  } catch (err) {
    console.error('Could not publish leaderboard summary:', err);
  }
}

async function enterCloudMode() {
  if (!cloud.user || !cloud.adapter) return;
  progressStore.setAdapter(cloud.adapter, 'cloud');
  await progressStore.adoptCloudUser(cloud.user);
  markCloudSeen();
  await publishSummary(true);
  await renderRoute(parseHash());
}

async function exitCloudMode() {
  progressStore.setAdapter(null);
  lastPublished = '';
  await renderRoute(parseHash());
}

function routeToView(route) {
  const [first, code, sub] = route.segments;
  if (!first) return { view: roadmapView, params: {} };
  if (first === 'profile') return { view: profileView, params: {} };
  if (first === 'members') return { view: membersView, params: {} };
  if (first === 'exams') return { view: examsView, params: {} };
  if (first === 'cert' && code) {
    if (sub === 'quiz') return { view: quizView, params: { code, sub } };
    if (sub === 'flashcards') return { view: flashcardsView, params: { code, sub } };
    if (sub === 'concepts') return { view: conceptsView, params: { code, sub } };
    if (sub === 'attempts') return { view: attemptsView, params: { code, sub } };
    return { view: certView, params: { code } };
  }
  return { view: roadmapView, params: {} };
}

async function renderRoute(route) {
  runCleanups();

  const codes = certData.certifications.map((c) => c.code);
  const activeMember = await progressStore.getActiveMember();
  const progressByCert = await progressStore.allCerts(codes);
  const profile = await progressStore.getProfile();
  const attempts = await progressStore.getAttempts();
  const state = buildProgressionState(certData, progressByCert, attempts);

  renderMemberChip(activeMember);

  const { view, params } = routeToView(route);

  const ctx = {
    engine,
    certData,
    state,
    store: progressStore,
    progressByCert,
    profile,
    attempts,
    activeMember,
    params,
    query: route.query,
    refresh: () => renderRoute(parseHash()),
    onCleanup: (fn) => cleanups.push(fn),
    cloud,
    publishSummary,
    onCloudSignIn: enterCloudMode,
    onCloudSignOut: exitCloudMode,
  };

  app.innerHTML = view.render(ctx);
  view.mount?.(ctx, app);

  // Header nav highlighting.
  const first = route.segments[0];
  document.getElementById('nav-roadmap')?.classList.toggle('current', !['profile', 'members', 'exams'].includes(first));
  document.getElementById('nav-exams')?.classList.toggle('current', first === 'exams');
  document.getElementById('nav-members')?.classList.toggle('current', first === 'members');
  document.getElementById('nav-profile')?.classList.toggle('current', first === 'profile');

  document.title = params.code
    ? `${params.code} · AWS Certification Trainer`
    : first === 'profile'
      ? 'Profile · AWS Certification Trainer'
      : first === 'members'
        ? 'Members · AWS Certification Trainer'
        : first === 'exams'
          ? 'Exams · AWS Certification Trainer'
          : 'AWS Certification Trainer';

  if (!route.query.keepScroll) window.scrollTo({ top: 0 });

  // Keep the shared board current without a write per answered question.
  publishSummary();
}

async function main() {
  try {
    const data = await loadData();
    certData = data.certifications;
    engine = buildEngine(data);
  } catch (err) {
    app.innerHTML = `<div class="fatal">
      <h2>${icon('warning', { size: 20 })} Could not load the study data</h2>
      <p>${err.message}</p>
      <p class="muted small">If you opened <code>index.html</code> directly from the file system, your browser will block the data files.
      Serve the folder over HTTP instead — for example <code>python -m http.server</code> from the <code>docs/</code> directory.</p>
    </div>`;
    return;
  }

  const prefs = await progressStore.getPrefs();
  applyTheme(prefs.theme);

  // Restore a previous cloud session before the first render, so a signed-in
  // user never sees their local profiles flash up first. Visitors who have
  // never signed in skip this entirely and download no SDK.
  try {
    const restored = await cloud.tryRestore();
    if (restored && cloud.adapter) {
      progressStore.setAdapter(cloud.adapter, 'cloud');
      await progressStore.adoptCloudUser(restored);
    }
  } catch (err) {
    console.error('Could not restore cloud session:', err);
  }

  document.getElementById('theme-toggle')?.addEventListener('click', async () => {
    const current = (await progressStore.getPrefs()).theme;
    const isDark =
      current === 'dark' || (!current && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isDark ? 'light' : 'dark';
    await progressStore.setPrefs({ theme: next });
    applyTheme(next);
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
    const { theme } = await progressStore.getPrefs();
    if (!theme) applyTheme(null);
  });

  const router = createRouter(renderRoute);
  router.start();
}

main();
