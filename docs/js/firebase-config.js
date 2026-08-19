/**
 * Firebase project configuration.
 *
 * These values are NOT secrets. A Firebase web config is designed to ship in
 * client code — it identifies the project, it does not grant access. What
 * actually protects the data is the Firestore security rules in
 * `firestore.rules` at the repository root, plus the authorised-domain list in
 * the Firebase console. Committing this file is the intended usage.
 *
 * To point the app at a different Firebase project, replace this block.
 * To turn cloud accounts off entirely, set `enabled: false` — the app falls
 * back to local-only member profiles and never contacts the network.
 */

export const FIREBASE_ENABLED = true;

export const firebaseConfig = {
  apiKey: 'AIzaSyCoKoKJaDwaitzsIdCMMHsV5wMW6nXSBUY',
  authDomain: 'aws-cert-trainer-202be.firebaseapp.com',
  projectId: 'aws-cert-trainer-202be',
  storageBucket: 'aws-cert-trainer-202be.firebasestorage.app',
  messagingSenderId: '278211298441',
  appId: '1:278211298441:web:ed623eb856b3bfd757b258',
};

/**
 * The SDK is loaded from Google's CDN, and only at the moment someone chooses
 * to sign in. Nobody studying locally ever triggers a network request, which
 * keeps the offline promise intact for the signed-out path.
 */
export const FIREBASE_SDK_VERSION = '11.10.0';
