import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

/**
 * Firebase client initialization.
 *
 * Project config comes from Vite env vars (VITE_FIREBASE_*). Set these in
 * apps/web/.env.local for local dev (committed example: .env.example).
 *
 * When VITE_USE_EMULATORS=true, all SDKs connect to the local emulator suite
 * (firebase emulators:start). This is the primary local dev loop.
 */

const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseApp = initializeApp(config);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);
export const functions = getFunctions(firebaseApp, 'us-central1');

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

// Dev-only diagnostic hooks. Lets us reach the live SDK instances from
// the browser console (or a Playwright/Chrome MCP `evaluate`) without
// shipping anything to prod — Vite tree-shakes the entire `if` body away
// in production builds.
if (import.meta.env.MODE === 'development') {
  void Promise.all([
    import('firebase/firestore'),
    import('firebase/auth'),
  ]).then(([fs, au]) => {
    const w = globalThis as unknown as { __OPS__?: unknown };
    w.__OPS__ = { auth, db, functions, firestore: fs, authSdk: au };
  });
}

/**
 * URL for an HTTP-style Cloud Function (the v2 onRequest variety) — used
 * for endpoints that accept binary bodies (audio upload) or stream
 * responses (audio playback). Callable functions go through the SDK's
 * `httpsCallable` instead.
 */
export function functionsHttpUrl(name: string): string {
  if (import.meta.env.VITE_USE_EMULATORS === 'true') {
    return `http://127.0.0.1:5001/${String(import.meta.env.VITE_FIREBASE_PROJECT_ID)}/us-central1/${name}`;
  }
  return `https://us-central1-${String(import.meta.env.VITE_FIREBASE_PROJECT_ID)}.cloudfunctions.net/${name}`;
}
