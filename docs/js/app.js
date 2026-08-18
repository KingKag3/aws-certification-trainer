import { buildEngine } from './generator.js';
import { buildProgressionState } from './progression.js';
import { progressStore } from './store.js';
import { createRouter, parseHash, buildHash } from './router.js';
import { icon } from './icons.js';

import * as roadmapView from './views/roadmap.js';
import * as certView from './views/cert.js';
import * as quizView from './views/quiz.js';
import * as flashcardsView from './views/flashcards.js';
import * as profileView from './views/profile.js';

const DATA_FILES = ['services.json', 'certifications.json', 'templates.json'];

async function loadData() {
  const [services, certifications, templates] = await Promise.all(
    DATA_FILES.map(async (f) => {
      const res = await fetch(new URL(`../data/${f}`, import.meta.url));
      if (!res.ok) throw new Error(`Could not load data/${f} (${res.status})`);
      return res.json();
    })
  );
  return { services, certifications, templates };
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

function routeToView(route) {
  const [first, code, sub] = route.segments;
  if (!first) return { view: roadmapView, params: {} };
  if (first === 'profile') return { view: profileView, params: {} };
  if (first === 'cert' && code) {
    if (sub === 'quiz') return { view: quizView, params: { code, sub } };
    if (sub === 'flashcards') return { view: flashcardsView, params: { code, sub } };
    return { view: certView, params: { code } };
  }
  return { view: roadmapView, params: {} };
}

async function renderRoute(route) {
  runCleanups();

  const codes = certData.certifications.map((c) => c.code);
  const progressByCert = await progressStore.allCerts(codes);
  const profile = await progressStore.getProfile();
  const state = buildProgressionState(certData, progressByCert);

  const { view, params } = routeToView(route);

  const ctx = {
    engine,
    certData,
    state,
    store: progressStore,
    progressByCert,
    profile,
    params,
    query: route.query,
    refresh: () => renderRoute(parseHash()),
    onCleanup: (fn) => cleanups.push(fn),
  };

  app.innerHTML = view.render(ctx);
  view.mount?.(ctx, app);

  // Header nav highlighting.
  const isProfile = route.segments[0] === 'profile';
  document.getElementById('nav-roadmap')?.classList.toggle('current', !isProfile);
  document.getElementById('nav-profile')?.classList.toggle('current', isProfile);

  document.title = params.code
    ? `${params.code} · AWS Certification Trainer`
    : isProfile
      ? 'Profile · AWS Certification Trainer'
      : 'AWS Certification Trainer';

  if (!route.query.keepScroll) window.scrollTo({ top: 0 });
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
