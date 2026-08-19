/**
 * Cloud accounts: sign-in and a Firestore-backed storage adapter.
 *
 * Design notes that matter:
 *
 * - The Firebase SDK is imported dynamically, and only when someone actually
 *   signs in or a previous session is restored. A visitor who never signs in
 *   makes zero network requests, so the offline/local path is untouched.
 *
 * - The adapter exposes the same get/set/remove/keys contract as the
 *   localStorage adapter in store.js, so nothing else in the app changes.
 *
 * - Every one of a user's records lives in a single Firestore collection,
 *   `users/{uid}/data/{key}`. Signing in reads that collection ONCE and serves
 *   every subsequent read from memory. Firestore's free tier bills per document
 *   read, so per-key round trips would burn quota for no benefit.
 *
 * - The leaderboard is a separate top-level collection holding one small
 *   summary document per user. Progress documents stay private to their owner;
 *   only the summary is shared. See firestore.rules.
 */

import { firebaseConfig, FIREBASE_ENABLED, FIREBASE_SDK_VERSION } from './firebase-config.js';

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/`;

let sdk = null; // { app, auth, db, fns... } once loaded

/** Loads the Firebase SDK on first use. Repeat calls reuse the same promise. */
let loadPromise = null;
function loadSdk() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const [appMod, authMod, dbMod] = await Promise.all([
      import(`${CDN}firebase-app.js`),
      import(`${CDN}firebase-auth.js`),
      import(`${CDN}firebase-firestore.js`),
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    const auth = authMod.getAuth(app);
    const db = dbMod.getFirestore(app);
    sdk = { app, auth, db, authMod, dbMod };
    return sdk;
  })();
  return loadPromise;
}

/** Firebase error codes are not presentable. Translate the ones users hit. */
export function friendlyAuthError(err) {
  const code = err?.code || '';
  const map = {
    'auth/invalid-email': 'That does not look like a valid email address.',
    'auth/missing-password': 'Enter a password.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/email-already-in-use': 'An account already exists with that email. Try signing in instead.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'Could not reach Firebase. Check your connection.',
    'auth/unauthorized-domain':
      'This site is not on the Firebase authorised-domain list. Add it under Authentication → Settings → Authorised domains.',
    'auth/operation-not-allowed':
      'Email/password sign-in is not enabled on the Firebase project. Enable it under Authentication → Sign-in method.',
  };
  return map[code] || err?.message || 'Something went wrong.';
}

/* ------------------------------------------------------------------ */
/* Firestore-backed storage adapter                                    */
/* ------------------------------------------------------------------ */

export class CloudAdapter {
  constructor(uid) {
    this.uid = uid;
    this.cache = new Map();
    this.ready = false;
  }

  /** One read of the whole collection; everything after that is served locally. */
  async prime() {
    const { db, dbMod } = sdk;
    const snap = await dbMod.getDocs(dbMod.collection(db, 'users', this.uid, 'data'));
    this.cache.clear();
    snap.forEach((d) => this.cache.set(d.id, d.data()?.v ?? null));
    this.ready = true;
    return this.cache.size;
  }

  async get(k, fallback = null) {
    const v = this.cache.get(k);
    return v === undefined || v === null ? fallback : v;
  }

  async set(k, value) {
    this.cache.set(k, value);
    const { db, dbMod } = sdk;
    await dbMod.setDoc(dbMod.doc(db, 'users', this.uid, 'data', k), {
      v: value,
      updatedAt: dbMod.serverTimestamp(),
    });
    return value;
  }

  async remove(k) {
    this.cache.delete(k);
    const { db, dbMod } = sdk;
    await dbMod.deleteDoc(dbMod.doc(db, 'users', this.uid, 'data', k));
  }

  async keys(prefix) {
    return [...this.cache.keys()].filter((k) => k.startsWith(prefix));
  }
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const cloud = {
  enabled: FIREBASE_ENABLED,
  user: null,
  adapter: null,

  /**
   * Restores an existing session without forcing an SDK download on visitors
   * who have never signed in. Firebase persists a marker in IndexedDB /
   * localStorage; if there is no sign of one, we skip loading entirely.
   */
  async tryRestore(onChange) {
    if (!FIREBASE_ENABLED) return null;
    if (!hasPersistedSession()) return null;
    return cloud.init(onChange);
  },

  /** Loads the SDK and starts listening for auth state. Resolves on first state. */
  async init(onChange) {
    if (!FIREBASE_ENABLED) return null;
    await loadSdk();
    return new Promise((resolve) => {
      let settled = false;
      sdk.authMod.onAuthStateChanged(sdk.auth, async (user) => {
        cloud.user = user || null;
        if (user) {
          cloud.adapter = new CloudAdapter(user.uid);
          try {
            await cloud.adapter.prime();
          } catch (err) {
            console.error('Could not read cloud progress:', err);
          }
        } else {
          cloud.adapter = null;
        }
        onChange?.(cloud.user);
        if (!settled) {
          settled = true;
          resolve(cloud.user);
        }
      });
    });
  },

  async signUp(email, password, displayName) {
    await loadSdk();
    const cred = await sdk.authMod.createUserWithEmailAndPassword(sdk.auth, email.trim(), password);
    const name = (displayName || '').trim().slice(0, 24) || email.split('@')[0];
    await sdk.authMod.updateProfile(cred.user, { displayName: name });
    cloud.user = cred.user;
    cloud.adapter = new CloudAdapter(cred.user.uid);
    await cloud.adapter.prime();
    return cred.user;
  },

  async signIn(email, password) {
    await loadSdk();
    const cred = await sdk.authMod.signInWithEmailAndPassword(sdk.auth, email.trim(), password);
    cloud.user = cred.user;
    cloud.adapter = new CloudAdapter(cred.user.uid);
    await cloud.adapter.prime();
    return cred.user;
  },

  async signOut() {
    if (!sdk) return;
    await sdk.authMod.signOut(sdk.auth);
    cloud.user = null;
    cloud.adapter = null;
  },

  async resetPassword(email) {
    await loadSdk();
    await sdk.authMod.sendPasswordResetEmail(sdk.auth, email.trim());
  },

  async setDisplayName(name) {
    if (!sdk?.auth?.currentUser) return;
    const clean = String(name || '').trim().slice(0, 24);
    if (!clean) return;
    await sdk.authMod.updateProfile(sdk.auth.currentUser, { displayName: clean });
    cloud.user = sdk.auth.currentUser;
  },

  /* -------- Leaderboard: one shared summary document per user -------- */

  /** Publishes the signed-in user's summary. Called after progress changes. */
  async publishSummary(summary) {
    if (!cloud.user || !sdk) return;
    const { db, dbMod } = sdk;
    await dbMod.setDoc(dbMod.doc(db, 'leaderboard', cloud.user.uid), {
      uid: cloud.user.uid,
      displayName: cloud.user.displayName || cloud.user.email?.split('@')[0] || 'Member',
      color: summary.color || '#FF9900',
      answered: summary.answered || 0,
      correct: summary.correct || 0,
      accuracy: summary.accuracy || 0,
      mastered: summary.mastered || 0,
      avgReadiness: summary.avgReadiness || 0,
      streak: summary.streak || 0,
      longestStreak: summary.longestStreak || 0,
      updatedAt: dbMod.serverTimestamp(),
    });
  },

  /** Everyone on the shared board. Requires being signed in (see rules). */
  async fetchLeaderboard(limit = 100) {
    if (!cloud.user || !sdk) return [];
    const { db, dbMod } = sdk;
    const q = dbMod.query(dbMod.collection(db, 'leaderboard'), dbMod.limit(limit));
    const snap = await dbMod.getDocs(q);
    const rows = [];
    snap.forEach((d) => rows.push(d.data()));
    return rows;
  },

  async deleteAccountData() {
    if (!cloud.user || !sdk) return;
    const { db, dbMod } = sdk;
    const snap = await dbMod.getDocs(dbMod.collection(db, 'users', cloud.user.uid, 'data'));
    await Promise.all(snap.docs.map((d) => dbMod.deleteDoc(d.ref)));
    await dbMod.deleteDoc(dbMod.doc(db, 'leaderboard', cloud.user.uid));
    cloud.adapter?.cache.clear();
  },
};

/**
 * Cheap check for "has this browser ever signed in?" so we can avoid pulling
 * ~400KB of SDK for a first-time visitor who only wants a local quiz.
 */
function hasPersistedSession() {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('firebase:authUser:')) return true;
    }
    return Boolean(window.indexedDB) && window.localStorage.getItem('awsstudy:v1:cloudSeen') === '1';
  } catch {
    return false;
  }
}

/** Remembers that this browser has used cloud sign-in at least once. */
export function markCloudSeen() {
  try {
    window.localStorage.setItem('awsstudy:v1:cloudSeen', '1');
  } catch {
    /* private mode — restoring will simply require a manual sign-in */
  }
}
