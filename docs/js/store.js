/**
 * progressStore — the only module that knows where progress physically lives.
 *
 * Every method is async on purpose. Swapping localStorage for Firestore,
 * Supabase or a Cloudflare Worker later means writing a new adapter with the
 * same five methods and changing the one line at the bottom of this file.
 * Nothing else in the app touches storage directly.
 *
 * Keys are namespaced per member so several people can share one browser:
 *
 *   awsstudy:v1:members                       roster + who is active
 *   awsstudy:v1:u:<memberId>:cert:<CODE>      that member's progress per exam
 *   awsstudy:v1:u:<memberId>:profile          that member's streak and totals
 *   awsstudy:v1:prefs                         device-level (theme)
 */

const NAMESPACE = 'awsstudy';
const VERSION = 'v1';
const PREFIX = `${NAMESPACE}:${VERSION}:`;

const key = (...parts) => PREFIX + parts.join(':');
const memberKey = (memberId, ...parts) => key('u', memberId, ...parts);

/** Palette for member avatars — AWS orange first, then distinguishable hues. */
export const MEMBER_COLORS = [
  '#FF9900', '#527FFF', '#1A7F4B', '#C925D1', '#DD344C',
  '#01A88D', '#8C4FFF', '#B7791F', '#0B62C4', '#E7157B',
];

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

export const emptyRoster = () => ({ members: [], activeId: null });

function makeId() {
  if (globalThis.crypto?.randomUUID) return 'm_' + globalThis.crypto.randomUUID().slice(0, 8);
  return 'm_' + Math.random().toString(36).slice(2, 10);
}

function makeAttemptId() {
  if (globalThis.crypto?.randomUUID) return 'a_' + globalThis.crypto.randomUUID().slice(0, 8);
  return 'a_' + Math.random().toString(36).slice(2, 10);
}

/** Stable colour choice from a uid, so an account looks the same on every device. */
function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export function createProgressStore(initialAdapter) {
  const listeners = new Set();
  const notify = (event) => listeners.forEach((fn) => fn(event));

  let adapter = initialAdapter;
  const localAdapter = initialAdapter;

  const store = {
    /** 'local' = this browser only; 'cloud' = signed in, synced across devices. */
    mode: 'local',

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /**
     * Swaps the storage backend at runtime. This is the seam the whole app was
     * built around: signing in replaces the adapter and nothing else changes.
     */
    setAdapter(next, mode = 'cloud') {
      adapter = next || localAdapter;
      store.mode = next ? mode : 'local';
      notify({ type: 'adapter', mode: store.mode });
    },

    /** The always-available local backend, for reading local data while signed in. */
    localAdapter,

    /* prefs (device level — always local, even when signed in) ------- */
    async getPrefs() {
      return { ...defaultPrefs(), ...(await localAdapter.get(key('prefs'), {})) };
    },
    async setPrefs(patch) {
      const next = { ...(await store.getPrefs()), ...patch };
      await localAdapter.set(key('prefs'), next);
      notify({ type: 'prefs', value: next });
      return next;
    },

    /* members ------------------------------------------------------ */
    async getRoster() {
      return { ...emptyRoster(), ...(await adapter.get(key('members'), {})) };
    },
    async saveRoster(roster) {
      await adapter.set(key('members'), roster);
      notify({ type: 'members', value: roster });
      return roster;
    },

    /**
     * Guarantees a usable roster: migrates any pre-members progress into a
     * first member, and creates a default member on a fresh install so the app
     * never presents an empty shell.
     */
    async ensureRoster() {
      let roster = await store.getRoster();
      if (roster.members.length) {
        if (!roster.members.some((m) => m.id === roster.activeId)) {
          roster = { ...roster, activeId: roster.members[0].id };
          await store.saveRoster(roster);
        }
        return roster;
      }

      const member = {
        id: makeId(),
        name: 'You',
        color: MEMBER_COLORS[0],
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };

      // Adopt progress written before members existed, so nothing is lost.
      const legacy = (await adapter.keys(PREFIX)).filter(
        (k) => /^awsstudy:v1:cert:/.test(k) || k === key('profile')
      );
      for (const k of legacy) {
        const value = await adapter.get(k);
        const suffix = k.slice(PREFIX.length); // "cert:SAA-C03" or "profile"
        await adapter.set(memberKey(member.id, suffix), value);
        await adapter.remove(k);
      }

      roster = { members: [member], activeId: member.id };
      await store.saveRoster(roster);
      return roster;
    },

    async getActiveMember() {
      const roster = await store.ensureRoster();
      return roster.members.find((m) => m.id === roster.activeId) || roster.members[0];
    },

    /**
     * In cloud mode the account IS the member — one identity, synced. Creates or
     * refreshes that member so every existing member-aware code path keeps
     * working without knowing whether it is talking to localStorage or Firestore.
     */
    async adoptCloudUser(user) {
      const roster = await store.getRoster();
      const existing = roster.members.find((m) => m.id === user.uid);
      const name = user.displayName || user.email?.split('@')[0] || 'Member';
      const member = existing
        ? { ...existing, name, lastActiveAt: Date.now() }
        : {
            id: user.uid,
            name,
            color: MEMBER_COLORS[Math.abs(hashCode(user.uid)) % MEMBER_COLORS.length],
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
          };
      const members = existing
        ? roster.members.map((m) => (m.id === user.uid ? member : m))
        : [...roster.members, member];
      await store.saveRoster({ members, activeId: user.uid });
      return member;
    },

    /**
     * Copies one local member's progress into the active (cloud) backend.
     * Used when someone signs up on a browser that already has local study
     * history and chooses to bring it with them.
     */
    async copyLocalMemberToActive(localMemberId, targetMemberId, codes) {
      let copied = 0;
      for (const code of codes) {
        const raw = await localAdapter.get(memberKey(localMemberId, 'cert', code), null);
        if (!raw || !raw.answered) continue;
        const existing = await adapter.get(memberKey(targetMemberId, 'cert', code), null);
        // Never overwrite cloud progress that is already further along.
        if (existing && existing.answered >= raw.answered) continue;
        await adapter.set(memberKey(targetMemberId, 'cert', code), raw);
        copied++;
      }
      const localProfile = await localAdapter.get(memberKey(localMemberId, 'profile'), null);
      if (localProfile) {
        const cloudProfile = await adapter.get(memberKey(targetMemberId, 'profile'), null);
        if (!cloudProfile || (cloudProfile.totalAnswered || 0) < (localProfile.totalAnswered || 0)) {
          await adapter.set(memberKey(targetMemberId, 'profile'), localProfile);
        }
      }
      notify({ type: 'import' });
      return copied;
    },

    /** Local members that actually have progress worth offering to upload. */
    async localMembersWithProgress(codes) {
      const roster = { ...emptyRoster(), ...(await localAdapter.get(key('members'), {})) };
      const out = [];
      for (const m of roster.members) {
        let answered = 0;
        for (const code of codes) {
          const rec = await localAdapter.get(memberKey(m.id, 'cert', code), null);
          answered += rec?.answered || 0;
        }
        if (answered) out.push({ ...m, answered });
      }
      return out;
    },

    async addMember(name) {
      const roster = await store.ensureRoster();
      const clean = String(name || '').trim().slice(0, 24) || `Member ${roster.members.length + 1}`;
      const member = {
        id: makeId(),
        name: clean,
        color: MEMBER_COLORS[roster.members.length % MEMBER_COLORS.length],
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };
      await store.saveRoster({ members: [...roster.members, member], activeId: roster.activeId });
      return member;
    },

    async renameMember(id, name) {
      const roster = await store.ensureRoster();
      const clean = String(name || '').trim().slice(0, 24);
      if (!clean) return roster;
      return store.saveRoster({
        ...roster,
        members: roster.members.map((m) => (m.id === id ? { ...m, name: clean } : m)),
      });
    },

    async setMemberColor(id, color) {
      const roster = await store.ensureRoster();
      return store.saveRoster({
        ...roster,
        members: roster.members.map((m) => (m.id === id ? { ...m, color } : m)),
      });
    },

    /** Removes the member and every key belonging to them. */
    async removeMember(id) {
      const roster = await store.ensureRoster();
      const remaining = roster.members.filter((m) => m.id !== id);
      for (const k of await adapter.keys(memberKey(id, ''))) await adapter.remove(k);
      const next = {
        members: remaining,
        activeId: roster.activeId === id ? remaining[0]?.id ?? null : roster.activeId,
      };
      await store.saveRoster(next);
      if (!remaining.length) await store.ensureRoster();
      return next;
    },

    async setActiveMember(id) {
      const roster = await store.ensureRoster();
      if (!roster.members.some((m) => m.id === id)) return roster;
      return store.saveRoster({
        ...roster,
        activeId: id,
        members: roster.members.map((m) => (m.id === id ? { ...m, lastActiveAt: Date.now() } : m)),
      });
    },

    /* per-certification progress (active member) ------------------- */
    async getCert(certCode) {
      const m = await store.getActiveMember();
      return store.getCertFor(m.id, certCode);
    },
    async setCert(certCode, value) {
      const m = await store.getActiveMember();
      await adapter.set(memberKey(m.id, 'cert', certCode), value);
      notify({ type: 'cert', memberId: m.id, certCode, value });
      return value;
    },
    async resetCert(certCode) {
      const m = await store.getActiveMember();
      await adapter.remove(memberKey(m.id, 'cert', certCode));
      notify({ type: 'cert', memberId: m.id, certCode, value: emptyCertProgress() });
    },
    async allCerts(codes) {
      const m = await store.getActiveMember();
      return store.allCertsFor(m.id, codes);
    },

    /* per-certification progress (any member — used by the leaderboard) */
    async getCertFor(memberId, certCode) {
      return { ...emptyCertProgress(), ...(await adapter.get(memberKey(memberId, 'cert', certCode), {})) };
    },
    async allCertsFor(memberId, codes) {
      const out = {};
      for (const code of codes) out[code] = await store.getCertFor(memberId, code);
      return out;
    },

    /* real exam attempts (active member) --------------------------- */
    async getAttempts() {
      const m = await store.getActiveMember();
      return store.getAttemptsFor(m.id);
    },
    async getAttemptsFor(memberId) {
      const list = await adapter.get(memberKey(memberId, 'attempts'), []);
      return Array.isArray(list) ? list : [];
    },
    async saveAttempts(list) {
      const m = await store.getActiveMember();
      const sorted = list.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      await adapter.set(memberKey(m.id, 'attempts'), sorted);
      notify({ type: 'attempts', memberId: m.id, value: sorted });
      return sorted;
    },
    async addAttempt(attempt) {
      const list = await store.getAttempts();
      const record = {
        id: makeAttemptId(),
        createdAt: Date.now(),
        pitfalls: [],
        notes: '',
        score: null,
        ...attempt,
      };
      return store.saveAttempts([...list, record]);
    },
    async updateAttempt(id, patch) {
      const list = await store.getAttempts();
      return store.saveAttempts(list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    },
    async removeAttempt(id) {
      const list = await store.getAttempts();
      return store.saveAttempts(list.filter((a) => a.id !== id));
    },

    /* profile ------------------------------------------------------ */
    async getProfile() {
      const m = await store.getActiveMember();
      return store.getProfileFor(m.id);
    },
    async setProfile(value) {
      const m = await store.getActiveMember();
      await adapter.set(memberKey(m.id, 'profile'), value);
      notify({ type: 'profile', memberId: m.id, value });
      return value;
    },
    async getProfileFor(memberId) {
      return { ...emptyProfile(), ...(await adapter.get(memberKey(memberId, 'profile'), {})) };
    },

    /* bulk --------------------------------------------------------- */
    async exportAll() {
      const ks = await adapter.keys(PREFIX);
      const data = {};
      for (const k of ks) data[k] = await adapter.get(k);
      return { exportedAt: new Date().toISOString(), version: VERSION, data };
    },
    async importAll(payload) {
      if (!payload?.data) throw new Error('Not a valid export file.');
      for (const [k, v] of Object.entries(payload.data)) await adapter.set(k, v);
      notify({ type: 'import' });
    },
    /** Clears one member's progress but keeps them on the roster. */
    async clearMemberProgress(memberId) {
      for (const k of await adapter.keys(memberKey(memberId, ''))) await adapter.remove(k);
      notify({ type: 'clear', memberId });
    },
    async clearAll() {
      for (const k of await adapter.keys(PREFIX)) await adapter.remove(k);
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
