import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  deleteUser,
  GoogleAuthProvider,
  getAuth,
  reauthenticateWithPopup,
  setPersistence,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import rawFirebaseConfig from '@/firebase-applet-config.json';
import type {
  BotLearningProfile,
  DeckFormat,
  DeckGoal,
  DeckVersionSnapshot,
} from './types/deck';
import { buildOptimizedDeckExport } from './utils/deckExport';

// Merge file config with environment variables (e.g. VITE_FIREBASE_API_KEY).
// This allows keeping sensitive API credentials completely out of Git/GitHub commits.
const firebaseConfig = {
  ...rawFirebaseConfig,
  apiKey:
    (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) ||
    rawFirebaseConfig.apiKey ||
    '',
  authDomain:
    (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) ||
    rawFirebaseConfig.authDomain ||
    '',
  projectId:
    (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) ||
    rawFirebaseConfig.projectId ||
    '',
  storageBucket:
    (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) ||
    rawFirebaseConfig.storageBucket ||
    '',
  messagingSenderId:
    (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) ||
    rawFirebaseConfig.messagingSenderId ||
    '',
  appId:
    (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined) ||
    rawFirebaseConfig.appId ||
    '',
  firestoreDatabaseId:
    (import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID as string | undefined) ||
    rawFirebaseConfig.firestoreDatabaseId ||
    '',
};

function isPlaceholderFirebaseValue(val: string | undefined): boolean {
  const trimmed = (val || '').trim();
  return !trimmed || trimmed.startsWith('YOUR_') || trimmed === 'remixed-project-id';
}

export const isFirebaseConfigured = Boolean(
  !isPlaceholderFirebaseValue(firebaseConfig.apiKey) &&
    !isPlaceholderFirebaseValue(firebaseConfig.projectId) &&
    !isPlaceholderFirebaseValue(firebaseConfig.appId)
);

const app: FirebaseApp | null = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const db: Firestore | null = app
  ? !isPlaceholderFirebaseValue(firebaseConfig.firestoreDatabaseId)
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app)
  : null;
export const auth: Auth | null = app ? getAuth(app) : null;
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Validate connection to Firestore on boot when configured, as required by firebase-integration-rpc
async function testConnection() {
  if (!db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
if (isFirebaseConfigured) {
  void testConnection();
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo:
        auth?.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

import {
  getStoredAuthPersistenceMode,
  setStoredAuthPersistenceMode,
  type GoogleAuthPersistenceMode,
} from './utils/sessionSync';
export {
  broadcastSessionSyncEvent,
  getStoredAuthPersistenceMode,
  getStoredIdleTimeoutMinutes,
  isSharedSessionPersistenceActive,
  SESSION_SYNC_STORAGE_KEY,
  setStoredAuthPersistenceMode,
  setStoredIdleTimeoutMinutes,
  type GoogleAuthPersistenceMode,
  type IdleTimeoutMinutes,
} from './utils/sessionSync';

export async function applyGoogleAuthPersistence(
  mode: GoogleAuthPersistenceMode
): Promise<void> {
  setStoredAuthPersistenceMode(mode);
  if (!auth) return;
  await setPersistence(
    auth,
    mode === 'session' ? browserSessionPersistence : browserLocalPersistence
  );
}

export function isVerifiedGoogleUserSession(user: User | null | undefined): user is User {
  if (!user || !user.uid || !user.emailVerified) return false;
  return (user.providerData || []).some((p) => p.providerId === 'google.com');
}

export interface VerifiedGoogleTokenInfo {
  verified: boolean;
  signInProvider: string | null;
  authTime: string | null;
  issuedAtTime: string | null;
}

export async function verifyGoogleTokenClaims(
  user: User
): Promise<VerifiedGoogleTokenInfo> {
  try {
    const tokenResult = await user.getIdTokenResult();
    const provider = tokenResult.signInProvider || null;
    const verified = Boolean(
      user.emailVerified && provider === 'google.com'
    );
    return {
      verified,
      signInProvider: provider,
      authTime: tokenResult.authTime || null,
      issuedAtTime: tokenResult.issuedAtTime || null,
    };
  } catch {
    return {
      verified: isVerifiedGoogleUserSession(user),
      signInProvider: null,
      authTime: null,
      issuedAtTime: null,
    };
  }
}

/**
 * Validation constants synchronized verbatim with firebase-blueprint.json & firestore.rules
 */
export const USER_DECK_CONSTRAINTS = {
  idPattern: /^[a-zA-Z0-9_\-]+$/,
  maxIdLength: 128,
  maxDeckNameLength: 120,
  maxLabelLength: 160,
  maxFormatLength: 32,
  maxGoalLength: 32,
  maxOriginalDeckTextLength: 25000,
  maxExportedDeckTextLength: 25000,
  maxExportedCsvTextLength: 45000,
  maxActiveColorSummaryLength: 120,
  maxVerdictHeadlineLength: 300,
  maxVerdictSummaryLength: 2000,
  maxArchetypeLength: 120,
  maxCommanderNameLength: 200,
  allowedFormats: [
    'auto',
    'commander',
    'standard',
    'modern',
    'pioneer',
    'legacy',
    'pauper',
    'brawl',
    'limited',
    'casual60',
  ] as const,
  allowedGoals: [
    'bracket-1',
    'bracket-2',
    'bracket-3',
    'bracket-4',
    'bracket-5',
    'consistency',
    'speed',
    'budget',
  ] as const,
};

export interface CloudUserDeckRecord {
  id: string;
  ownerId: string;
  deckName: string;
  label: string;
  format: DeckFormat;
  goal: DeckGoal;
  originalDeckText: string;
  exportedDeckText: string;
  exportedCsvText: string;
  resultingLandCount: number;
  totalMainCount: number;
  averageCmcNonLand: number;
  tappedLandCount: number;
  activeColorSummary: string;
  activeChangeCount: number;
  verdictHeadline: string;
  verdictSummary: string;
  archetype: string;
  commanderName: string;
  isAutoSaved: boolean;
  createdAtIso: string;
  updatedAtIso: string;
}

function clampString(val: string, minLen: number, maxLen: number, fallback: string): string {
  const trimmed = (val || '').trim();
  const base = trimmed.length >= minLen ? trimmed : fallback;
  return base.slice(0, maxLen);
}

function clampInt(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, Math.round(val)));
}

function clampFloat(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, Number(val.toFixed(2))));
}

function clampStringArray(arr: string[] | undefined, maxItems = 15, maxItemLen = 380): string[] {
  if (!Array.isArray(arr)) return [];
  const cleaned: string[] = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, maxItemLen);
    if (trimmed.length > 0) {
      cleaned.push(trimmed);
    }
    if (cleaned.length >= maxItems) break;
  }
  return cleaned;
}

export function sanitizeDocId(rawId: string): string {
  const cleaned = (rawId || '')
    .replace(/[^a-zA-Z0-9_\-]/g, '-')
    .slice(0, USER_DECK_CONSTRAINTS.maxIdLength);
  return cleaned.length > 0 ? cleaned : `deck-${Date.now()}`;
}

export interface UserAccountProfileRecord {
  uid: string;
  displayName: string;
  defaultFormat: DeckFormat;
  defaultGoal: DeckGoal;
  lastActiveDeckName: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export async function signInWithGooglePopup(
  promptSelectAccount = true,
  persistenceMode?: GoogleAuthPersistenceMode
): Promise<User> {
  if (!auth) {
    throw new Error('Firebase cloud sync is not configured in this build.');
  }
  const effectiveMode = persistenceMode ?? getStoredAuthPersistenceMode();
  await applyGoogleAuthPersistence(effectiveMode);

  if (promptSelectAccount) {
    googleProvider.setCustomParameters({ prompt: 'select_account' });
  }
  const credential = await signInWithPopup(auth, googleProvider);
  if (!isVerifiedGoogleUserSession(credential.user)) {
    await signOut(auth);
    throw new Error(
      'Your Google account email must be verified before accessing private cloud storage.'
    );
  }
  return credential.user;
}

export async function reauthenticateCurrentGoogleUser(): Promise<User> {
  const user = auth?.currentUser;
  if (!user) {
    throw new Error('No signed-in Google account found.');
  }
  googleProvider.setCustomParameters({ prompt: 'select_account' });
  const cred = await reauthenticateWithPopup(user, googleProvider);
  return cred.user;
}

export async function signOutCurrentUser(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
}

export async function deleteCurrentGoogleAccountAndCloudData(user: User): Promise<void> {
  if (!db) return;
  if (!isVerifiedGoogleUserSession(user)) {
    throw new Error('Only a verified Google account can delete cloud records.');
  }

  // Require fresh Google re-authentication before deleting cloud decks, bot brains, and auth account
  const reauthed = await reauthenticateCurrentGoogleUser();

  await clearAllUserDecksFromCloud(reauthed);
  await clearAllBotMemoryFromCloud(reauthed);

  const safeUid = reauthed.uid.slice(0, USER_DECK_CONSTRAINTS.maxIdLength);
  const profilePath = `userProfiles/${safeUid}`;
  try {
    await deleteDoc(doc(db, 'userProfiles', safeUid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, profilePath);
  }

  await deleteUser(reauthed);
}

export async function ensureUserAccountProfile(
  user: User,
  initialFormat: DeckFormat = 'auto',
  initialGoal: DeckGoal = 'bracket-3',
  lastActiveDeckName = ''
): Promise<{ profile: UserAccountProfileRecord; isNewAccount: boolean }> {
  if (!db) {
    throw new Error('Firebase cloud sync is not configured in this build.');
  }
  if (!isVerifiedGoogleUserSession(user)) {
    throw new Error('Verified Google Sign-In is required for account profile access.');
  }

  const safeUid = user.uid.slice(0, USER_DECK_CONSTRAINTS.maxIdLength);
  const path = `userProfiles/${safeUid}`;
  const profileRef = doc(db, 'userProfiles', safeUid);

  try {
    const existingSnap = await getDoc(profileRef);
    if (existingSnap.exists()) {
      const data = existingSnap.data();
      const createdAtIso =
        data.createdAt && typeof data.createdAt.toDate === 'function'
          ? data.createdAt.toDate().toISOString()
          : new Date().toISOString();
      const updatedAtIso =
        data.updatedAt && typeof data.updatedAt.toDate === 'function'
          ? data.updatedAt.toDate().toISOString()
          : createdAtIso;

      return {
        isNewAccount: false,
        profile: {
          uid: String(data.uid || safeUid),
          displayName: String(
            data.displayName ||
              user.displayName ||
              user.email?.split('@')[0] ||
              'Planeswalker'
          ),
          defaultFormat: (data.defaultFormat as DeckFormat) || 'auto',
          defaultGoal: (data.defaultGoal as DeckGoal) || 'bracket-3',
          lastActiveDeckName: String(data.lastActiveDeckName || ''),
          createdAtIso,
          updatedAtIso,
        },
      };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  // Create new account profile document in Firestore
  const safeFormat: DeckFormat = (
    USER_DECK_CONSTRAINTS.allowedFormats as readonly string[]
  ).includes(initialFormat)
    ? initialFormat
    : 'auto';
  const safeGoal: DeckGoal = (
    USER_DECK_CONSTRAINTS.allowedGoals as readonly string[]
  ).includes(initialGoal)
    ? initialGoal
    : 'bracket-3';
  const safeDisplayName = clampString(
    user.displayName || user.email?.split('@')[0] || 'Planeswalker',
    1,
    USER_DECK_CONSTRAINTS.maxDeckNameLength,
    'Planeswalker'
  );
  const safeLastDeck = clampString(
    lastActiveDeckName,
    0,
    USER_DECK_CONSTRAINTS.maxDeckNameLength,
    ''
  );

  try {
    await setDoc(profileRef, {
      uid: safeUid,
      displayName: safeDisplayName,
      defaultFormat: safeFormat,
      defaultGoal: safeGoal,
      lastActiveDeckName: safeLastDeck,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  const nowIso = new Date().toISOString();
  return {
    isNewAccount: true,
    profile: {
      uid: safeUid,
      displayName: safeDisplayName,
      defaultFormat: safeFormat,
      defaultGoal: safeGoal,
      lastActiveDeckName: safeLastDeck,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    },
  };
}

export async function updateUserAccountPreferences(
  user: User,
  params: {
    displayName: string;
    defaultFormat: DeckFormat;
    defaultGoal: DeckGoal;
    lastActiveDeckName: string;
  }
): Promise<void> {
  if (!db || !isVerifiedGoogleUserSession(user)) return;
  const safeUid = user.uid.slice(0, USER_DECK_CONSTRAINTS.maxIdLength);
  const path = `userProfiles/${safeUid}`;
  const profileRef = doc(db, 'userProfiles', safeUid);

  const safeFormat: DeckFormat = (
    USER_DECK_CONSTRAINTS.allowedFormats as readonly string[]
  ).includes(params.defaultFormat)
    ? params.defaultFormat
    : 'auto';
  const safeGoal: DeckGoal = (
    USER_DECK_CONSTRAINTS.allowedGoals as readonly string[]
  ).includes(params.defaultGoal)
    ? params.defaultGoal
    : 'bracket-3';

  try {
    await updateDoc(profileRef, {
      displayName: clampString(
        params.displayName,
        1,
        USER_DECK_CONSTRAINTS.maxDeckNameLength,
        'Planeswalker'
      ),
      defaultFormat: safeFormat,
      defaultGoal: safeGoal,
      lastActiveDeckName: clampString(
        params.lastActiveDeckName,
        0,
        USER_DECK_CONSTRAINTS.maxDeckNameLength,
        ''
      ),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveUserDeckToCloud(
  user: User,
  snapshot: DeckVersionSnapshot
): Promise<void> {
  if (!db || !isVerifiedGoogleUserSession(user)) {
    return;
  }

  const safeDocId = sanitizeDocId(`${user.uid.slice(0, 24)}_${snapshot.id}`);
  const path = `userDecks/${safeDocId}`;
  const deckRef = doc(db, 'userDecks', safeDocId);

  const computedExport = buildOptimizedDeckExport(
    snapshot.analysis,
    new Set(snapshot.selection?.swapIds ?? []),
    new Set(snapshot.selection?.cutIds ?? []),
    new Set(snapshot.selection?.addIds ?? []),
    new Set(snapshot.selection?.landChangeIds ?? [])
  );

  const safeFormat: DeckFormat = (
    USER_DECK_CONSTRAINTS.allowedFormats as readonly string[]
  ).includes(snapshot.format)
    ? snapshot.format
    : 'commander';

  const safeGoal: DeckGoal = (
    USER_DECK_CONSTRAINTS.allowedGoals as readonly string[]
  ).includes(snapshot.goal)
    ? snapshot.goal
    : 'bracket-3';

  const commanderNamesJoined = (snapshot.analysis?.metrics?.commanderNames ?? []).join(', ');

  const mutableFields = {
    deckName: clampString(
      snapshot.deckName,
      1,
      USER_DECK_CONSTRAINTS.maxDeckNameLength,
      'Analyzed Deck'
    ),
    label: clampString(
      snapshot.label,
      1,
      USER_DECK_CONSTRAINTS.maxLabelLength,
      'Saved Snapshot'
    ),
    format: safeFormat,
    goal: safeGoal,
    originalDeckText: clampString(
      snapshot.originalDeckText || snapshot.resultingDeckText,
      1,
      USER_DECK_CONSTRAINTS.maxOriginalDeckTextLength,
      '1 Command Tower'
    ),
    exportedDeckText: clampString(
      snapshot.resultingDeckText || computedExport.exportText,
      1,
      USER_DECK_CONSTRAINTS.maxExportedDeckTextLength,
      '1 Command Tower'
    ),
    exportedCsvText: clampString(
      computedExport.exportCsv || '',
      0,
      USER_DECK_CONSTRAINTS.maxExportedCsvTextLength,
      ''
    ),
    resultingLandCount: clampInt(snapshot.resultingLandCount, 0, 250),
    totalMainCount: clampInt(snapshot.totalMainCount, 0, 500),
    averageCmcNonLand: clampFloat(snapshot.averageCmcNonLand, 0, 20),
    tappedLandCount: clampInt(snapshot.tappedLandCount, 0, 250),
    activeColorSummary: clampString(
      snapshot.activeColorSummary,
      1,
      USER_DECK_CONSTRAINTS.maxActiveColorSummaryLength,
      'Colorless'
    ),
    activeChangeCount: clampInt(snapshot.activeChangeCount, 0, 250),
    verdictHeadline: clampString(
      snapshot.analysis?.verdictHeadline || '',
      0,
      USER_DECK_CONSTRAINTS.maxVerdictHeadlineLength,
      ''
    ),
    verdictSummary: clampString(
      snapshot.analysis?.verdictSummary || '',
      0,
      USER_DECK_CONSTRAINTS.maxVerdictSummaryLength,
      ''
    ),
    archetype: clampString(
      snapshot.analysis?.archetype || '',
      0,
      USER_DECK_CONSTRAINTS.maxArchetypeLength,
      ''
    ),
    commanderName: clampString(
      commanderNamesJoined,
      0,
      USER_DECK_CONSTRAINTS.maxCommanderNameLength,
      ''
    ),
    isAutoSaved: Boolean(snapshot.isAutoSaved),
    updatedAt: serverTimestamp(),
  };

  try {
    const existingSnap = await getDoc(deckRef);
    if (existingSnap.exists()) {
      await updateDoc(deckRef, mutableFields);
    } else {
      await setDoc(deckRef, {
        ownerId: user.uid.slice(0, USER_DECK_CONSTRAINTS.maxIdLength),
        ...mutableFields,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteUserDeckFromCloud(
  user: User,
  snapshotId: string
): Promise<void> {
  if (!db || !isVerifiedGoogleUserSession(user)) return;
  const safeDocId = sanitizeDocId(`${user.uid.slice(0, 24)}_${snapshotId}`);
  const path = `userDecks/${safeDocId}`;
  try {
    await deleteDoc(doc(db, 'userDecks', safeDocId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function clearAllUserDecksFromCloud(user: User): Promise<void> {
  if (!db || !isVerifiedGoogleUserSession(user)) return;
  const path = 'userDecks';
  try {
    const q = query(collection(db, 'userDecks'), where('ownerId', '==', user.uid));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToUserDecks(
  userId: string,
  onRecords: (records: CloudUserDeckRecord[]) => void
): Unsubscribe {
  if (!db) {
    onRecords([]);
    return () => {};
  }
  const path = 'userDecks';
  const q = query(collection(db, 'userDecks'), where('ownerId', '==', userId));

  return onSnapshot(
    q,
    (querySnapshot) => {
      const records: CloudUserDeckRecord[] = [];
      const prefix = `${userId.slice(0, 24)}_`;

      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const rawDocId = docSnap.id;
        const localId = rawDocId.startsWith(prefix)
          ? rawDocId.slice(prefix.length)
          : rawDocId;

        const createdAtIso =
          data.createdAt && typeof data.createdAt.toDate === 'function'
            ? data.createdAt.toDate().toISOString()
            : new Date().toISOString();
        const updatedAtIso =
          data.updatedAt && typeof data.updatedAt.toDate === 'function'
            ? data.updatedAt.toDate().toISOString()
            : createdAtIso;

        records.push({
          id: localId,
          ownerId: String(data.ownerId || userId),
          deckName: String(data.deckName || 'Analyzed Deck'),
          label: String(data.label || 'Saved Snapshot'),
          format: (data.format as DeckFormat) || 'commander',
          goal: (data.goal as DeckGoal) || 'bracket-3',
          originalDeckText: String(data.originalDeckText || ''),
          exportedDeckText: String(data.exportedDeckText || ''),
          exportedCsvText: String(data.exportedCsvText || ''),
          resultingLandCount: Number(data.resultingLandCount ?? 0),
          totalMainCount: Number(data.totalMainCount ?? 0),
          averageCmcNonLand: Number(data.averageCmcNonLand ?? 0),
          tappedLandCount: Number(data.tappedLandCount ?? 0),
          activeColorSummary: String(data.activeColorSummary || 'Colorless'),
          activeChangeCount: Number(data.activeChangeCount ?? 0),
          verdictHeadline: String(data.verdictHeadline || ''),
          verdictSummary: String(data.verdictSummary || ''),
          archetype: String(data.archetype || ''),
          commanderName: String(data.commanderName || ''),
          isAutoSaved: Boolean(data.isAutoSaved),
          createdAtIso,
          updatedAtIso,
        });
      });

      records.sort(
        (a, b) => new Date(b.createdAtIso).getTime() - new Date(a.createdAtIso).getTime()
      );
      onRecords(records);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

// Per-User Adaptive Bot Memory CRUD (/botMemory/{memoryId})
export async function saveBotLearningProfileToCloud(
  user: User,
  profile: BotLearningProfile
): Promise<void> {
  if (!db || !isVerifiedGoogleUserSession(user)) return;

  const safeBotKey = sanitizeDocId(profile.botKey);
  const safeDocId = sanitizeDocId(`${user.uid.slice(0, 24)}_${safeBotKey}`);
  const path = `botMemory/${safeDocId}`;
  const memoryRef = doc(db, 'botMemory', safeDocId);

  const mutableFields = {
    botName: clampString(profile.botName, 1, 80, 'AI Bot'),
    archetype: clampString(profile.archetype, 1, 120, 'Midrange'),
    matchesPlayed: clampInt(profile.matchesPlayed, 0, 100000),
    wins: clampInt(profile.wins, 0, 100000),
    losses: clampInt(profile.losses, 0, 100000),
    closes: clampInt(profile.closes, 0, 100000),
    botIqScore: clampInt(profile.botIqScore, 0, 2000),
    lastDeckFaced: clampString(profile.lastDeckFaced, 0, 160, ''),
    lastOwnDeckSummary: clampString(profile.lastOwnDeckSummary, 0, 300, ''),
    learnedFromFacedDecks: clampStringArray(profile.learnedFromFacedDecks, 15, 380),
    learnedFromOwnDecks: clampStringArray(profile.learnedFromOwnDecks, 15, 380),
    userFeedbackNotes: clampStringArray(profile.userFeedbackNotes, 15, 380),
    tacticalDirectives: clampStringArray(profile.tacticalDirectives, 15, 380),
    updatedAt: serverTimestamp(),
  };

  try {
    const existingSnap = await getDoc(memoryRef);
    if (existingSnap.exists()) {
      await updateDoc(memoryRef, mutableFields);
    } else {
      await setDoc(memoryRef, {
        ownerId: user.uid.slice(0, USER_DECK_CONSTRAINTS.maxIdLength),
        botKey: safeBotKey,
        ...mutableFields,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteBotLearningProfileFromCloud(
  user: User,
  botKey: string
): Promise<void> {
  if (!db || !isVerifiedGoogleUserSession(user)) return;
  const safeDocId = sanitizeDocId(`${user.uid.slice(0, 24)}_${sanitizeDocId(botKey)}`);
  const path = `botMemory/${safeDocId}`;
  try {
    await deleteDoc(doc(db, 'botMemory', safeDocId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function clearAllBotMemoryFromCloud(user: User): Promise<void> {
  if (!db || !isVerifiedGoogleUserSession(user)) return;
  const path = 'botMemory';
  try {
    const q = query(collection(db, 'botMemory'), where('ownerId', '==', user.uid));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToBotLearningProfiles(
  userId: string,
  onProfiles: (profiles: BotLearningProfile[]) => void
): Unsubscribe {
  if (!db) {
    onProfiles([]);
    return () => {};
  }
  const path = 'botMemory';
  const q = query(collection(db, 'botMemory'), where('ownerId', '==', userId));

  return onSnapshot(
    q,
    (querySnapshot) => {
      const profiles: BotLearningProfile[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const updatedAtIso =
          data.updatedAt && typeof data.updatedAt.toDate === 'function'
            ? data.updatedAt.toDate().toISOString()
            : new Date().toISOString();

        profiles.push({
          botKey: String(data.botKey || docSnap.id),
          botName: String(data.botName || 'AI Bot'),
          archetype: String(data.archetype || 'Midrange'),
          matchesPlayed: Number(data.matchesPlayed ?? 0),
          wins: Number(data.wins ?? 0),
          losses: Number(data.losses ?? 0),
          closes: Number(data.closes ?? 0),
          botIqScore: Number(data.botIqScore ?? 100),
          lastDeckFaced: String(data.lastDeckFaced || ''),
          lastOwnDeckSummary: String(data.lastOwnDeckSummary || ''),
          learnedFromFacedDecks: Array.isArray(data.learnedFromFacedDecks)
            ? data.learnedFromFacedDecks.filter((x): x is string => typeof x === 'string')
            : [],
          learnedFromOwnDecks: Array.isArray(data.learnedFromOwnDecks)
            ? data.learnedFromOwnDecks.filter((x): x is string => typeof x === 'string')
            : [],
          userFeedbackNotes: Array.isArray(data.userFeedbackNotes)
            ? data.userFeedbackNotes.filter((x): x is string => typeof x === 'string')
            : [],
          tacticalDirectives: Array.isArray(data.tacticalDirectives)
            ? data.tacticalDirectives.filter((x): x is string => typeof x === 'string')
            : [],
          updatedAtIso,
        });
      });

      profiles.sort((a, b) => b.botIqScore - a.botIqScore);
      onProfiles(profiles);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}
