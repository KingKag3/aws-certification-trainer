/**
 * progressStore — the only module that knows where progress physically lives.
 *
 * Every method is async on purpose. Swapping localStorage for Firestore,
 * Supabase or a Cloudflare Worker later means writing a new adapter with the
 * same five methods and changing the one line at the bottom of this file.
 * Nothing else in the app touches storage directly.
 */

const NAMESPACE = 'awsstudy';
const VERSION = 'v1';

const key = (...parts) => [NAMESPACE, VERSION, ...parts].join(':');

/* ------------------------------------------------------------------ */
/* Adapter: browser localStorage                                       */
/* ------------------------------------------------------------------ */

class LocalStorageAdapter {
  constructor() {
    this.available = (() => {
      try {
        const probe = key('probe');
        window.localStorage.setItem(probe, '1');
        window.localStorage.removeItem(probe);
        return true;
      } catch {
        return false;
      }
    })();
    this.memory = new Map(); // fallback for private-mode browsers
  }

  async get(k, fallback = null) {
    try {
      const raw = this.available ? window.localStorage.getItem(k) : this.memory.get(k);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  async set(k, value) {
    const raw = JSON.stringify(value);
    if (this.available) window.localStorage.setItem(k, raw);
    else this.memory.set(k, raw);
    return value;
  }

  async remove(k) {
    if (this.available) window.localStorage.removeItem(k);
    else this.memory.delete(k);
  }

  async keys(prefix) {
    if (!this.available) return [...this.memory.keys()].filter((k) => k.startsWith(prefix));
    const out = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export const emptyCertProgress = () => ({
  answered: 0,
  correct: 0,
  domains: {},
  entities: {},
  startedAt: null,
  lastStudiedAt: null,
  sessions: 0,
  bestRun: 0,
  manuallyStarted: false,
});

export const emptyProfile = () => ({
  days: {},
  streak: 0,
  longestStreak: 0,
  lastStudyDate: null,
  totalAnswered: 0,
  totalCorrect: 0,
});

export const defaultPrefs = () => ({
  theme: null, // null = follow the operating system
  lastCert: null,
  quizLength: 10,
});

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export function createProgressStore(adapter) {
  const listeners = new Set();
  const notify = (event) => listeners.forEach((fn) => fn(event));

  const store = {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /* prefs ------------------------------------------------------- */
    async getPrefs() {
      return { ...defaultPrefs(), ...(await adapter.get(key('prefs'), {})) };
    },
    async setPrefs(patch) {
      const next = { ...(await store.getPrefs()), ...patch };
      await adapter.set(key('prefs'), next);
      notify({ type: 'prefs', value: next });
      return next;
    },

    /* per-certification progress ---------------------------------- */
    async getCert(certCode) {
      return { ...emptyCertProgress(), ...(await adapter.get(key('cert', certCode), {})) };
    },
    async setCert(certCode, value) {
      await adapter.set(key('cert', certCode), value);
      notify({ type: 'cert', certCode, value });
      return value;
    },
    async resetCert(certCode) {
      await adapter.remove(key('cert', certCode));
      notify({ type: 'cert', certCode, value: emptyCertProgress() });
    },
    async allCerts(codes) {
      const out = {};
      for (const code of codes) out[code] = await store.getCert(code);
      return out;
    },

    /* profile ------------------------------------------------------ */
    async getProfile() {
      return { ...emptyProfile(), ...(await adapter.get(key('profile'), {})) };
    },
    async setProfile(value) {
      await adapter.set(key('profile'), value);
      notify({ type: 'profile', value });
      return value;
    },

    /* bulk --------------------------------------------------------- */
    async exportAll() {
      const ks = await adapter.keys(`${NAMESPACE}:${VERSION}:`);
      const data = {};
      for (const k of ks) data[k] = await adapter.get(k);
      return { exportedAt: new Date().toISOString(), version: VERSION, data };
    },
    async importAll(payload) {
      if (!payload?.data) throw new Error('Not a valid export file.');
      for (const [k, v] of Object.entries(payload.data)) await adapter.set(k, v);
      notify({ type: 'import' });
    },
    async clearAll() {
      const ks = await adapter.keys(`${NAMESPACE}:${VERSION}:`);
      for (const k of ks) await adapter.remove(k);
      notify({ type: 'clear' });
    },
  };

  return store;
}

/* ------------------------------------------------------------------ */
/* Recording helpers — pure functions over the shapes above            */
/* ------------------------------------------------------------------ */

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayDiff(a, b) {
  const toUtc = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(a) - toUtc(b)) / 86400000);
}

/** Fold one answered question into a certification's progress record. */
export function recordAnswer(progress, { entityId, domainId, correct, at = Date.now() }) {
  const next = {
    ...progress,
    answered: progress.answered + 1,
    correct: progress.correct + (correct ? 1 : 0),
    domains: { ...progress.domains },
    entities: { ...progress.entities },
    startedAt: progress.startedAt || at,
    lastStudiedAt: at,
  };

  const d = next.domains[domainId] || { answered: 0, correct: 0 };
  next.domains[domainId] = { answered: d.answered + 1, correct: d.correct + (correct ? 1 : 0) };

  const e = next.entities[entityId] || { seen: 0, missed: 0, lastSeenAt: 0, lastMissedAt: 0 };
  next.entities[entityId] = {
    seen: e.seen + 1,
    missed: e.missed + (correct ? 0 : 1),
    lastSeenAt: at,
    lastMissedAt: correct ? e.lastMissedAt : at,
  };

  return next;
}

/** Fold one answered question into the global profile, maintaining the streak. */
export function recordProfileAnswer(profile, { correct, date = new Date() }) {
  const day = todayKey(date);
  const days = { ...profile.days, [day]: (profile.days[day] || 0) + 1 };

  let streak = profile.streak;
  if (profile.lastStudyDate !== day) {
    const gap = profile.lastStudyDate ? dayDiff(day, profile.lastStudyDate) : null;
    streak = gap === 1 ? profile.streak + 1 : 1;
  }
  if (streak === 0) streak = 1;

  return {
    ...profile,
    days,
    streak,
    longestStreak: Math.max(profile.longestStreak, streak),
    lastStudyDate: day,
    totalAnswered: profile.totalAnswered + 1,
    totalCorrect: profile.totalCorrect + (correct ? 1 : 0),
  };
}

/** A streak is only current if the last study day was today or yesterday. */
export function currentStreak(profile, date = new Date()) {
  if (!profile.lastStudyDate) return 0;
  const gap = dayDiff(todayKey(date), profile.lastStudyDate);
  return gap <= 1 ? profile.streak : 0;
}

/* ------------------------------------------------------------------ */
/* Default instance                                                    */
/* ------------------------------------------------------------------ */
/* To move to a cloud backend later, replace this one line with a new  */
/* adapter exposing get/set/remove/keys. Nothing else needs to change. */

export const progressStore = createProgressStore(new LocalStorageAdapter());
