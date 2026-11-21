import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Power, X } from 'lucide-react';
import type {
  BotLearningProfile,
  CardMetadata,
  DeckAnalysisResult,
  DeckFormat,
  DeckGoal,
  DeckSelectionState,
  DeckVersionSnapshot,
} from './types/deck';
import {
  broadcastSessionSyncEvent,
  getStoredAuthPersistenceMode,
  SESSION_SYNC_STORAGE_KEY,
  setStoredAuthPersistenceMode,
  type GoogleAuthPersistenceMode,
} from './utils/sessionSync';
import { FirestoreErrorBoundary } from './components/FirestoreErrorBoundary';
import { TopBar, type ActiveSection } from './components/TopBar';
import { DeckImporter } from './components/DeckImporter';
import { FooterContactSection } from './components/FooterContactSection';
import { GgufStartupModal } from './components/GgufStartupModal';
import { lazyWithRetry } from './utils/lazyWithRetry';

const AnalysisDashboard = lazyWithRetry(() =>
  import('./components/AnalysisDashboard').then((m) => ({
    default: m.AnalysisDashboard,
  }))
);
const CardInspectorModal = lazyWithRetry(() =>
  import('./components/CardInspectorModal').then((m) => ({
    default: m.CardInspectorModal,
  }))
);
const VersionHistoryDrawer = lazyWithRetry(() =>
  import('./components/VersionHistoryDrawer').then((m) => ({
    default: m.VersionHistoryDrawer,
  }))
);
const UserProfileModal = lazyWithRetry(() =>
  import('./components/UserProfileModal').then((m) => ({
    default: m.UserProfileModal,
  }))
);
const DesktopAppModal = lazyWithRetry(() =>
  import('./components/DesktopAppModal').then((m) => ({
    default: m.DesktopAppModal,
  }))
);
import {
  OperationProgressBar,
  type OperationProgressState,
} from './components/OperationProgressBar';
import { buildOptimizedDeckExport } from './utils/deckExport';
import { loadSharedDeckSnapshotFromUrl } from './utils/deckSharing';
import {
  loadUserBotMemory,
  mergeLocalAndCloudBotMemory,
  migrateBotMemoryScopeToSessionStorage,
  persistUserBotMemory,
  purgeUserBotMemory,
} from './utils/botLearning';
import {
  clearLegacySharedDeckStorage,
  createDeckSnapshot,
  createProfilePasscodeDigest,
  createSelectionStateFromAnalysis,
  getOrCreateGuestSessionId,
  loadActiveSessionLocalProfile,
  loadSavedLocalProfiles,
  loadUserActiveWorkspace,
  loadVersionSnapshots,
  MAX_SNAPSHOTS,
  migrateAuthenticatedScopeToSessionStorage,
  normalizeDeckAnalysisResult,
  persistUserActiveWorkspace,
  persistVersionSnapshots,
  purgeUserLocalBrowserCache,
  rotateGuestSessionId,
  saveActiveSessionLocalProfile,
  saveLocalProfilesList,
  selectionSignature,
  verifyProfilePasscode,
  type StoredLocalUserProfile,
} from './utils/versionHistory';
type LocalUserProfile = StoredLocalUserProfile;
import { analyzeDeckClientSideFallback } from './utils/clientFallbackAnalyzer';
import {
  fetchNdjsonWithProgress,
  ServerReturnedError,
} from './utils/streamApi';

const EMPTY_SELECTION: DeckSelectionState = {
  swapIds: [],
  cutIds: [],
  addIds: [],
  landChangeIds: [],
};

export default function App() {
  const [guestSessionId, setGuestSessionId] = useState<string>(() => {
    clearLegacySharedDeckStorage();
    return getOrCreateGuestSessionId();
  });
  const [savedLocalProfiles, setSavedLocalProfiles] = useState<LocalUserProfile[]>(
    () => loadSavedLocalProfiles()
  );
  const [activeLocalProfile, setActiveLocalProfile] =
    useState<LocalUserProfile | null>(() => loadActiveSessionLocalProfile());
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isDesktopModalOpen, setIsDesktopModalOpen] = useState(false);
  const [authPersistenceMode, setAuthPersistenceMode] =
    useState<GoogleAuthPersistenceMode>(() => getStoredAuthPersistenceMode());

  const activeUserScopeKey = useMemo(() => {
    if (activeLocalProfile) return `uid_profile_${activeLocalProfile.id}`;
    return guestSessionId;
  }, [activeLocalProfile, guestSessionId]);

  const [deckText, setDeckText] = useState('');
  const [deckName, setDeckName] = useState('');
  const [format, setFormat] = useState<DeckFormat>('auto');
  const [goal, setGoal] = useState<DeckGoal>('bracket-3');

  const [analysis, setAnalysis] = useState<DeckAnalysisResult | null>(null);
  const [selection, setSelection] = useState<DeckSelectionState>(EMPTY_SELECTION);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<OperationProgressState>({
    percent: 0,
    stage: 'Preparing decklist...',
  });
  const [error, setError] = useState<string | null>(null);

  const [snapshots, setSnapshots] = useState<DeckVersionSnapshot[]>(() =>
    loadVersionSnapshots(getOrCreateGuestSessionId())
  );
  const [botMemory, setBotMemory] = useState<Record<string, BotLearningProfile>>(() =>
    loadUserBotMemory(getOrCreateGuestSessionId())
  );
  const [accountStatusNotice, setAccountStatusNotice] = useState<string | null>(
    null
  );
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [justSavedSnapshot, setJustSavedSnapshot] = useState(false);
  const savedTimerRef = useRef<number | null>(null);
  const previousScopeRef = useRef<string>(activeUserScopeKey);

  const [activeSection, setActiveSection] = useState<ActiveSection>('import');
  const [inspectedCard, setInspectedCard] = useState<{
    name: string;
    meta: CardMetadata | null;
  } | null>(null);
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [isExitingProgram, setIsExitingProgram] = useState(false);
  const [hasExitedProgram, setHasExitedProgram] = useState(false);

  useEffect(() => {
    if (!isExitModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isExitingProgram) {
        setIsExitModalOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isExitModalOpen, isExitingProgram]);

  // Quietly clear any leftover Firebase Auth user from prior Google sessions without blocking initial render
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const [{ isFirebaseConfigured, auth, signOutCurrentUser }, { onAuthStateChanged }] =
            await Promise.all([import('./firebase'), import('firebase/auth')]);
          if (cancelled || !isFirebaseConfigured || !auth) return;
          unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
              void signOutCurrentUser();
            }
          });
        } catch {
          // Ignore when Firebase is not configured
        }
      })();
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const openDesktopModal = () => setIsDesktopModalOpen(true);
    window.addEventListener('umbras:open-desktop-modal', openDesktopModal);
    return () => window.removeEventListener('umbras:open-desktop-modal', openDesktopModal);
  }, []);

  // Isolate snapshots, active workspace, and adaptive bot memory per user scope
  useEffect(() => {
    const prevScope = previousScopeRef.current;
    if (prevScope !== activeUserScopeKey) {
      previousScopeRef.current = activeUserScopeKey;
      const wasGuest = prevScope.startsWith('guest_');
      const isNowAuthenticated = activeUserScopeKey.startsWith('uid_');

      const existingUserSnapshots = loadVersionSnapshots(activeUserScopeKey);
      const guestSnapshotsToMigrate =
        wasGuest && isNowAuthenticated ? loadVersionSnapshots(prevScope) : [];

      if (guestSnapshotsToMigrate.length > 0) {
        const merged = [
          ...guestSnapshotsToMigrate,
          ...existingUserSnapshots.filter(
            (existing) => !guestSnapshotsToMigrate.some((g) => g.id === existing.id)
          ),
        ].slice(0, MAX_SNAPSHOTS);
        setSnapshots(merged);
        persistVersionSnapshots(merged, activeUserScopeKey);
        rotateGuestSessionId();
      } else {
        setSnapshots(existingUserSnapshots);
      }

      // Migrate or load per-user Bot Learning Memory
      const existingBotMemory = loadUserBotMemory(activeUserScopeKey);
      const guestBotMemory =
        wasGuest && isNowAuthenticated ? loadUserBotMemory(prevScope) : {};
      const guestProfiles = Object.values(guestBotMemory);

      if (guestProfiles.length > 0) {
        const mergedBots = mergeLocalAndCloudBotMemory(existingBotMemory, guestProfiles);
        setBotMemory(mergedBots);
        persistUserBotMemory(activeUserScopeKey, mergedBots);
        purgeUserBotMemory(prevScope);
      } else {
        setBotMemory(existingBotMemory);
      }

      if (isNowAuthenticated) {
        const savedWorkspace = loadUserActiveWorkspace(activeUserScopeKey);
        if (savedWorkspace && (savedWorkspace.deckText || savedWorkspace.analysis)) {
          setDeckText(savedWorkspace.deckText);
          setDeckName(savedWorkspace.deckName);
          setFormat(savedWorkspace.format);
          setGoal(savedWorkspace.goal);
          setAnalysis(savedWorkspace.analysis);
          setSelection(savedWorkspace.selection);
          setError(null);
          setActiveSection(savedWorkspace.analysis ? 'mana' : 'import');
        } else if (!wasGuest) {
          setDeckText('');
          setDeckName('');
          setFormat('auto');
          setGoal('bracket-3');
          setAnalysis(null);
          setSelection(EMPTY_SELECTION);
          setError(null);
          setActiveSection('import');
        }
      } else {
        setDeckText('');
        setDeckName('');
        setFormat('auto');
        setGoal('bracket-3');
        setAnalysis(null);
        setSelection(EMPTY_SELECTION);
        setError(null);
        setActiveSection('import');
      }
      return;
    }
    setSnapshots(loadVersionSnapshots(activeUserScopeKey));
    setBotMemory(loadUserBotMemory(activeUserScopeKey));
  }, [activeUserScopeKey]);

  // Persist active deck workspace strictly under the signed-in profile's scope
  useEffect(() => {
    if (activeUserScopeKey.startsWith('uid_')) {
      persistUserActiveWorkspace(activeUserScopeKey, {
        deckText,
        deckName,
        format,
        goal,
        analysis,
        selection,
      });
    }
  }, [activeUserScopeKey, deckText, deckName, format, goal, analysis, selection]);

  useEffect(() => {
    const shared = loadSharedDeckSnapshotFromUrl();
    if (shared) {
      setDeckText(shared.originalDeckText);
      setDeckName(shared.deckName);
      setFormat(shared.format);
      setGoal(shared.goal);
      setAnalysis(shared.analysis);
      setSelection(shared.selection);
      setActiveSection('mana');
    }
  }, []);

  useEffect(() => {
    persistVersionSnapshots(snapshots, activeUserScopeKey);
  }, [snapshots, activeUserScopeKey]);

  // Hydrate persisted AppData workspace when running inside the Electron desktop app
  useEffect(() => {
    if (typeof window === 'undefined' || !window.desktopApp?.isDesktop) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/desktop/storage');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          snapshots?: DeckVersionSnapshot[];
          botMemory?: Record<string, BotLearningProfile>;
        };
        if (Array.isArray(data.snapshots) && data.snapshots.length > 0) {
          setSnapshots((prev) => {
            if (prev.length > 0) return prev;
            persistVersionSnapshots(data.snapshots!, activeUserScopeKey);
            return data.snapshots!;
          });
        }
        if (data.botMemory && Object.keys(data.botMemory).length > 0) {
          setBotMemory((prev) => {
            if (Object.keys(prev).length > 0) return prev;
            persistUserBotMemory(activeUserScopeKey, data.botMemory!);
            return data.botMemory!;
          });
        }
      } catch {
        // Ignore offline desktop storage read errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeUserScopeKey]);

  // Persist snapshots & bot IQ profiles to AppData disk backup in desktop mode
  useEffect(() => {
    if (typeof window === 'undefined' || !window.desktopApp?.isDesktop) return;
    const timer = window.setTimeout(() => {
      void fetch('/api/desktop/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshots, botMemory }),
      }).catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [snapshots, botMemory]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const currentExport = useMemo(() => {
    if (!analysis) return null;
    return buildOptimizedDeckExport(
      analysis,
      new Set(selection.swapIds),
      new Set(selection.cutIds),
      new Set(selection.addIds),
      new Set(selection.landChangeIds)
    );
  }, [analysis, selection]);

  const totalUserDeckCount = snapshots.length;

  const appendSnapshot = (
    snapshot: DeckVersionSnapshot,
    skipIfIdenticalToLatest = false
  ) => {
    setSnapshots((prev) => {
      if (skipIfIdenticalToLatest && prev.length > 0) {
        const latest = prev[0];
        if (
          latest.resultingDeckText === snapshot.resultingDeckText &&
          selectionSignature(latest.selection) ===
            selectionSignature(snapshot.selection) &&
          latest.deckName === snapshot.deckName
        ) {
          return prev;
        }
      }
      return [snapshot, ...prev].slice(0, MAX_SNAPSHOTS);
    });
  };

  const handleSaveSnapshot = (customLabel?: string) => {
    if (!analysis) return;
    const manualCount = snapshots.filter((s) => !s.isAutoSaved).length + 1;
    const landCount = currentExport?.resultingLandCount ?? analysis.metrics.currentLands;
    const snapshot = createDeckSnapshot({
      label: customLabel || `Saved Edits #${manualCount} · ${landCount} Lands`,
      isAutoSaved: false,
      deckName: (typeof deckName === 'string' ? deckName : '').trim() || analysis.deckName,
      format,
      goal,
      originalDeckText: deckText,
      analysis,
      selection,
    });
    appendSnapshot(snapshot, false);

    setJustSavedSnapshot(true);
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = window.setTimeout(() => {
      setJustSavedSnapshot(false);
    }, 2000);
  };

  const handleRevertSnapshot = (snapshot: DeckVersionSnapshot) => {
    const normalized = normalizeDeckAnalysisResult(snapshot.analysis);
    if (!normalized) return;
    setDeckText(snapshot.originalDeckText);
    setDeckName(snapshot.deckName);
    setFormat(snapshot.format);
    setGoal(snapshot.goal);
    setAnalysis(normalized);
    setSelection({
      swapIds: [...(snapshot.selection?.swapIds ?? [])],
      cutIds: [...(snapshot.selection?.cutIds ?? [])],
      addIds: [...(snapshot.selection?.addIds ?? [])],
      landChangeIds: [...(snapshot.selection?.landChangeIds ?? [])],
    });
    setError(null);
    setActiveSection('mana');
    setIsHistoryOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteSnapshot = (snapshotId: string) => {
    setSnapshots((prev) => prev.filter((s) => s.id !== snapshotId));
  };

  const handleClearHistory = () => {
    setSnapshots([]);
  };

  const handleChangeAuthPersistence = (mode: GoogleAuthPersistenceMode) => {
    setStoredAuthPersistenceMode(mode);
    setAuthPersistenceMode(mode);
    if (mode === 'session' && activeUserScopeKey.startsWith('uid_')) {
      migrateAuthenticatedScopeToSessionStorage(activeUserScopeKey);
      migrateBotMemoryScopeToSessionStorage(activeUserScopeKey);
    } else if (mode === 'local' && activeUserScopeKey.startsWith('uid_')) {
      persistVersionSnapshots(snapshots, activeUserScopeKey);
      persistUserBotMemory(activeUserScopeKey, botMemory);
      persistUserActiveWorkspace(activeUserScopeKey, {
        deckText,
        deckName,
        format,
        goal,
        analysis,
        selection,
      });
    }
    if (activeLocalProfile) {
      saveActiveSessionLocalProfile(activeLocalProfile);
    }
  };

  const handleCreateProfile = async (name: string, passcode?: string) => {
    const cleanName = (typeof name === 'string' ? name : '').trim().slice(0, 40);
    if (!cleanName) return;

    const existing = savedLocalProfiles.find(
      (p) => p.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (existing) {
      throw new Error(
        'A profile with that name already exists. Sign in from the list below.'
      );
    }

    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const cleanPasscode = passcode?.trim() || '';
    const digest = cleanPasscode
      ? await createProfilePasscodeDigest(cleanPasscode)
      : null;

    const newProf: LocalUserProfile = {
      id: `${slug || 'profile'}_${Date.now().toString(36)}`,
      name: cleanName,
      createdAt: new Date().toISOString(),
      ...(digest ? digest : {}),
    };

    const nextList = [newProf, ...savedLocalProfiles];
    setSavedLocalProfiles(nextList);
    saveLocalProfilesList(nextList);
    broadcastSessionSyncEvent('account-switch', newProf.id);
    setActiveLocalProfile(newProf);
    saveActiveSessionLocalProfile(newProf);
    setAccountStatusNotice(
      `Signed in as ${cleanName}.${digest ? ' Passcode protection enabled.' : ''}`
    );
  };

  const handleSignInProfile = async (
    profileId: string,
    passcode?: string
  ): Promise<boolean> => {
    const profile = savedLocalProfiles.find((p) => p.id === profileId);
    if (!profile) return false;

    if (profile.passcodeHash) {
      const ok = await verifyProfilePasscode(profile, passcode || '');
      if (!ok) return false;
    }

    broadcastSessionSyncEvent('account-switch', profile.id);
    setActiveLocalProfile(profile);
    saveActiveSessionLocalProfile(profile);
    setAccountStatusNotice(`Signed in as ${profile.name}.`);
    return true;
  };

  const handleUpdateProfilePasscode = async (
    profileId: string,
    newPasscode: string,
    currentPasscode?: string
  ): Promise<boolean> => {
    const profile = savedLocalProfiles.find((p) => p.id === profileId);
    if (!profile) return false;

    if (profile.passcodeHash) {
      const ok = await verifyProfilePasscode(profile, currentPasscode || '');
      if (!ok) return false;
    }

    const trimmedNext = (typeof newPasscode === 'string' ? newPasscode : '').trim();
    let updated: LocalUserProfile;
    if (trimmedNext) {
      const digest = await createProfilePasscodeDigest(trimmedNext);
      updated = {
        id: profile.id,
        name: profile.name,
        createdAt: profile.createdAt,
        passcodeSalt: digest.passcodeSalt,
        passcodeHash: digest.passcodeHash,
      };
    } else {
      updated = {
        id: profile.id,
        name: profile.name,
        createdAt: profile.createdAt,
      };
    }

    const nextList = savedLocalProfiles.map((p) =>
      p.id === profileId ? updated : p
    );
    setSavedLocalProfiles(nextList);
    saveLocalProfilesList(nextList);

    if (activeLocalProfile?.id === profileId) {
      setActiveLocalProfile(updated);
      saveActiveSessionLocalProfile(updated);
    }
    return true;
  };

  const handleDeleteProfileAndData = (profileId: string) => {
    const nextList = savedLocalProfiles.filter((p) => p.id !== profileId);
    setSavedLocalProfiles(nextList);
    saveLocalProfilesList(nextList);
    purgeUserLocalBrowserCache(`uid_profile_${profileId}`);
    purgeUserBotMemory(`uid_profile_${profileId}`);

    if (activeLocalProfile?.id === profileId) {
      broadcastSessionSyncEvent('lock');
      setActiveLocalProfile(null);
      saveActiveSessionLocalProfile(null);
      const freshGuestId = rotateGuestSessionId();
      setGuestSessionId(freshGuestId);
      setDeckText('');
      setDeckName('');
      setFormat('auto');
      setGoal('bracket-3');
      setAnalysis(null);
      setSelection(EMPTY_SELECTION);
      setSnapshots([]);
      setBotMemory({});
      setError(null);
      setAccountStatusNotice('Profile and saved decks were deleted.');
      setActiveSection('import');
      setIsHistoryOpen(false);
    }
  };

  const handleSignOut = (purgeBrowserCache = false) => {
    const scopeToClear = activeUserScopeKey;
    const shouldPurge =
      purgeBrowserCache || authPersistenceMode === 'session';
    if (shouldPurge) {
      purgeUserLocalBrowserCache(scopeToClear);
      purgeUserBotMemory(scopeToClear);
    }
    void import('./firebase')
      .then(({ auth, signOutCurrentUser }) => {
        if (auth?.currentUser) {
          void signOutCurrentUser();
        }
      })
      .catch(() => undefined);
    broadcastSessionSyncEvent(shouldPurge ? 'lock' : 'sign-out');
    setActiveLocalProfile(null);
    saveActiveSessionLocalProfile(null);
    const freshGuestId = rotateGuestSessionId();
    setGuestSessionId(freshGuestId);
    setDeckText('');
    setDeckName('');
    setFormat('auto');
    setGoal('bracket-3');
    setAnalysis(null);
    setSelection(EMPTY_SELECTION);
    setSnapshots([]);
    setBotMemory({});
    setError(null);
    setAccountStatusNotice(
      shouldPurge
        ? 'Session locked and temporary browser cache cleared.'
        : 'Signed out. Active workspace cleared.'
    );
    setActiveSection('import');
    setIsHistoryOpen(false);
  };

  // Synchronize sign-out and lock events cleanly across open browser tabs
  useEffect(() => {
    const onStorageSync = (event: StorageEvent) => {
      if (event.key !== SESSION_SYNC_STORAGE_KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as { action?: string };
        if (parsed.action === 'sign-out' || parsed.action === 'lock') {
          if (parsed.action === 'lock' && activeUserScopeKey.startsWith('uid_')) {
            purgeUserLocalBrowserCache(activeUserScopeKey);
            purgeUserBotMemory(activeUserScopeKey);
          }
          setActiveLocalProfile(null);
          saveActiveSessionLocalProfile(null);
          setDeckText('');
          setDeckName('');
          setAnalysis(null);
          setSelection(EMPTY_SELECTION);
          setSnapshots([]);
          setBotMemory({});
          setActiveSection('import');
          setIsHistoryOpen(false);
        }
      } catch {
        // Ignore malformed sync events
      }
    };
    window.addEventListener('storage', onStorageSync);
    return () => window.removeEventListener('storage', onStorageSync);
  }, [activeUserScopeKey]);

  const handleSaveBotMemoryProfiles = (profiles: BotLearningProfile[]) => {
    setBotMemory((prev) => {
      const next = { ...prev };
      for (const p of profiles) {
        next[p.botKey] = p;
      }
      persistUserBotMemory(activeUserScopeKey, next);
      return next;
    });
  };

  const handleResetBotMemory = (botKey?: string) => {
    if (botKey) {
      setBotMemory((prev) => {
        const next = { ...prev };
        delete next[botKey];
        persistUserBotMemory(activeUserScopeKey, next);
        return next;
      });
      return;
    }

    setBotMemory({});
    purgeUserBotMemory(activeUserScopeKey);
  };

  const handleNewUserSession = () => {
    setActiveLocalProfile(null);
    saveActiveSessionLocalProfile(null);
    const freshGuestId = rotateGuestSessionId();
    setGuestSessionId(freshGuestId);
    setDeckText('');
    setDeckName('');
    setFormat('auto');
    setGoal('bracket-3');
    setAnalysis(null);
    setSelection(EMPTY_SELECTION);
    setSnapshots([]);
    setBotMemory({});
    setError(null);
    setActiveSection('import');
    setIsHistoryOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const runAnalysis = async (
    textOverride?: string,
    mode: 'initial' | 'reanalyze' = 'initial',
    nameOverride?: string,
    formatOverride?: DeckFormat,
    goalOverride?: DeckGoal,
    forceLocalFallback = false
  ) => {
    const payloadText = typeof textOverride === 'string' ? textOverride : (typeof deckText === 'string' ? deckText : '');
    const effectiveInputName =
      typeof nameOverride === 'string' ? nameOverride : (typeof deckName === 'string' ? deckName : '');
    const effectiveFormat = formatOverride ?? format;
    const effectiveGoal = goalOverride ?? goal;

    if (!payloadText.trim()) {
      setError('Paste a decklist, import from a URL, or pick a sample deck first.');
      setActiveSection('import');
      return;
    }

    // Before re-analyzing updated edits, preserve the current edited mana base if not already saved
    if (mode === 'reanalyze' && analysis && currentExport) {
      const preUpdateSnapshot = createDeckSnapshot({
        label: `Pre-Update Edits · ${currentExport.resultingLandCount} Lands`,
        isAutoSaved: true,
        deckName: effectiveInputName.trim() || analysis.deckName,
        format: effectiveFormat,
        goal: effectiveGoal,
        originalDeckText: deckText,
        analysis,
        selection,
      });
      appendSnapshot(preUpdateSnapshot, true);
    }

    setIsAnalyzing(true);
    setAnalysisProgress({
      percent: 8,
      stage: 'Parsing decklist & detecting format...',
    });
    setError(null);

    try {
      let data: DeckAnalysisResult | null = null;

      if (!forceLocalFallback) {
        try {
          const rawJson = await fetchNdjsonWithProgress<Partial<DeckAnalysisResult>>(
            '/api/analyze',
            {
              deckText: payloadText,
              deckName: effectiveInputName.trim() || undefined,
              format: effectiveFormat,
              goal: effectiveGoal,
            },
            (update) => setAnalysisProgress(update)
          );
          if (rawJson && typeof rawJson === 'object') {
            const normalized = normalizeDeckAnalysisResult(rawJson);
            if (normalized && (normalized.resolvedCards || []).length > 0) {
              data = normalized;
            }
          }
        } catch (apiErr) {
          if (apiErr instanceof ServerReturnedError) {
            throw apiErr;
          }
        }
      }

      if (!data) {
        setAnalysisProgress({
          percent: 32,
          stage: 'Resolving cards with Scryfall in browser...',
          detail: 'Offline / client-side analyzer mode',
        });
        const fallbackResult = await analyzeDeckClientSideFallback({
          deckText: payloadText,
          deckName: effectiveInputName.trim() || undefined,
          format: effectiveFormat,
          goal: effectiveGoal,
        });
        setAnalysisProgress({
          percent: 84,
          stage: 'Computing mana sources & replacement plan...',
        });
        data = normalizeDeckAnalysisResult(fallbackResult);
      }

      if (!data) {
        throw new Error('Failed to analyze deck.');
      }

      setAnalysisProgress({
        percent: 96,
        stage: 'Finalizing deck analysis dashboard...',
      });

      const defaultSelection = createSelectionStateFromAnalysis(data, true);
      const baselineSelection = createSelectionStateFromAnalysis(data, false);
      const effectiveDeckName = effectiveInputName.trim() || data.deckName;

      // Auto-save an unedited baseline snapshot of this analyzed list into this user's vault
      const baselineSnapshot = createDeckSnapshot({
        label:
          mode === 'reanalyze'
            ? `Re-Analyzed Base · ${data.metrics.currentLands} Lands`
            : `Original Import · ${data.metrics.currentLands} Lands`,
        isAutoSaved: true,
        deckName: effectiveDeckName,
        format: effectiveFormat,
        goal: effectiveGoal,
        originalDeckText: payloadText,
        analysis: data,
        selection: baselineSelection,
      });
      appendSnapshot(baselineSnapshot, true);

      // Update the importer decklist with the balanced, format-legal card quantities
      const reconciledExport = buildOptimizedDeckExport(
        data,
        new Set(defaultSelection.swapIds),
        new Set(defaultSelection.cutIds),
        new Set(defaultSelection.addIds),
        new Set(defaultSelection.landChangeIds),
        [],
        null,
        false
      );
      if (reconciledExport.deckOnlyExportText.trim()) {
        setDeckText(reconciledExport.deckOnlyExportText);
      }
      if (!effectiveInputName.trim() && effectiveDeckName) {
        setDeckName(effectiveDeckName);
      }

      setAnalysisProgress({
        percent: 100,
        stage: 'Deck analysis complete.',
      });
      setAnalysis(data);
      setSelection(defaultSelection);
      setActiveSection('mana');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected analysis error.');
      setActiveSection('import');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleNavigate = (section: ActiveSection) => {
    setActiveSection(section);
    if (section === 'import') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!analysis) return;

    const targetId =
      section === 'mana'
        ? 'mana-section'
        : section === 'changes'
        ? 'changes-section'
        : section === 'playtest'
        ? 'playtest-section'
        : 'export-section';
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleReanalyzeUpdated = (updatedText: string) => {
    setDeckText(updatedText);
    void runAnalysis(updatedText, 'reanalyze');
  };

  const handleConfirmExitProgram = async () => {
    setIsExitingProgram(true);
    try {
      if (typeof window !== 'undefined' && window.desktopApp?.exitApp) {
        await window.desktopApp.exitApp();
        return;
      }
      if (typeof window !== 'undefined') {
        window.close();
      }
    } catch {
      // Fall through to clean exited state in web environments
    } finally {
      setIsExitingProgram(false);
      setIsExitModalOpen(false);
      setHasExitedProgram(true);
    }
  };

  if (hasExitedProgram) {
    return (
      <FirestoreErrorBoundary>
        <div className="min-h-screen flex items-center justify-center bg-zinc-100 px-6 py-12 text-zinc-900">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-xl space-y-5">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-sky-700">
              <Power className="h-6 w-6" />
            </div>
            <div className="space-y-1.5">
              <h1 className="font-display text-xl font-bold text-zinc-900">
                Umbras Pass Exited
              </h1>
              <p className="text-sm text-zinc-600">
                Your session has closed cleanly. You may now close this browser tab or relaunch the app below.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setHasExitedProgram(false)}
              className="inline-flex items-center justify-center rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 cursor-pointer transition-colors"
            >
              Relaunch Umbras Pass
            </button>
          </div>
        </div>
      </FirestoreErrorBoundary>
    );
  }

  return (
    <FirestoreErrorBoundary>
      <div className="min-h-screen flex flex-col bg-zinc-100 text-zinc-900">
        <TopBar
          hasAnalysis={Boolean(analysis)}
          activeSection={activeSection}
          onNavigate={handleNavigate}
          userDeckCount={totalUserDeckCount}
          onOpenUserDecks={() => setIsHistoryOpen(true)}
          onOpenDesktopModal={() => setIsDesktopModalOpen(true)}
          onRequestExit={() => setIsExitModalOpen(true)}
        />

        <main className="flex-1">
          {isAnalyzing && (
            <div className="mx-auto max-w-[1360px] px-6 py-10">
              <div className="rounded-xl border border-zinc-200 bg-white p-8 space-y-6">
                <OperationProgressBar
                  title={`Analyzing ${deckName.trim() || 'Decklist'}`}
                  progress={analysisProgress}
                />
                <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2 lg:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-24 animate-pulse rounded-xl border border-zinc-100 bg-zinc-50"
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {!isAnalyzing && (activeSection === 'import' || !analysis) && (
            <DeckImporter
              deckText={deckText}
              deckName={deckName}
              format={format}
              goal={goal}
              isAnalyzing={isAnalyzing}
              error={error}
              accountStatusNotice={accountStatusNotice}
              onDismissAccountNotice={() => setAccountStatusNotice(null)}
              onDeckTextChange={setDeckText}
              onDeckNameChange={setDeckName}
              onFormatChange={setFormat}
              onGoalChange={setGoal}
              onAnalyze={() => void runAnalysis(undefined, 'initial')}
              onAnalyzeLocalFallback={() =>
                void runAnalysis(undefined, 'initial', undefined, undefined, undefined, true)
              }
            />
          )}

          {!isAnalyzing && analysis && activeSection !== 'import' && (
            <Suspense
              fallback={
                <div className="mx-auto max-w-[1360px] space-y-6 px-6 py-8">
                  <div className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-white" />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-white"
                      />
                    ))}
                  </div>
                </div>
              }
            >
              <AnalysisDashboard
                analysis={analysis}
                selection={selection}
                onSelectionChange={setSelection}
                versionCount={totalUserDeckCount}
                justSavedSnapshot={justSavedSnapshot}
                onSaveSnapshot={() => handleSaveSnapshot()}
                onOpenHistory={() => setIsHistoryOpen(true)}
                onInspectCard={(name, meta) =>
                  setInspectedCard({ name, meta: meta ?? null })
                }
                onReanalyzeUpdated={handleReanalyzeUpdated}
                botMemory={botMemory}
                onSaveBotMemoryProfiles={handleSaveBotMemoryProfiles}
                onResetBotMemory={handleResetBotMemory}
              />
            </Suspense>
          )}
        </main>

        <FooterContactSection />

        {inspectedCard && (
          <Suspense fallback={null}>
            <CardInspectorModal
              cardName={inspectedCard.name}
              meta={inspectedCard.meta}
              onClose={() => setInspectedCard(null)}
            />
          </Suspense>
        )}

        {isHistoryOpen && (
          <Suspense fallback={null}>
            <VersionHistoryDrawer
              isOpen={isHistoryOpen}
              onClose={() => setIsHistoryOpen(false)}
              snapshots={snapshots}
              currentAnalysis={analysis}
              currentSelection={analysis ? selection : null}
              currentResultingDeckText={currentExport?.exportText || ''}
              currentResultingLandCount={currentExport?.resultingLandCount || 0}
              currentTotalMainCount={currentExport?.totalMainCount || 0}
              onSaveSnapshot={handleSaveSnapshot}
              onRevertSnapshot={handleRevertSnapshot}
              onDeleteSnapshot={handleDeleteSnapshot}
              onClearHistory={handleClearHistory}
            />
          </Suspense>
        )}

        {isProfileModalOpen && (
          <Suspense fallback={null}>
            <UserProfileModal
              isOpen={isProfileModalOpen}
              onClose={() => setIsProfileModalOpen(false)}
              authPersistenceMode={authPersistenceMode}
              onChangeAuthPersistence={handleChangeAuthPersistence}
              activeLocalProfile={activeLocalProfile}
              savedLocalProfiles={savedLocalProfiles}
              onSignInProfile={handleSignInProfile}
              onCreateProfile={handleCreateProfile}
              onUpdateProfilePasscode={handleUpdateProfilePasscode}
              onDeleteProfileAndData={handleDeleteProfileAndData}
              onSignOut={handleSignOut}
              onStartFreshGuestSession={handleNewUserSession}
            />
          </Suspense>
        )}

        {isDesktopModalOpen && (
          <Suspense fallback={null}>
            <DesktopAppModal
              isOpen={isDesktopModalOpen}
              onClose={() => setIsDesktopModalOpen(false)}
            />
          </Suspense>
        )}

        <GgufStartupModal
          onOpenAiSettings={() => setIsDesktopModalOpen(true)}
        />

        {isExitModalOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="exit-program-dialog-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            onClick={() => {
              if (!isExitingProgram) setIsExitModalOpen(false);
            }}
          >
            <div
              className="relative w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-2xl space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700">
                    <Power className="h-5 w-5" />
                  </div>
                  <div>
                    <h2
                      id="exit-program-dialog-title"
                      className="font-display text-lg font-bold text-zinc-900"
                    >
                      Exit Umbras Pass?
                    </h2>
                    <p className="mt-1 text-sm text-zinc-600 leading-relaxed">
                      Would you like to fully exit the program? Any unsaved snapshots in your current workspace will be closed.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isExitingProgram}
                  onClick={() => setIsExitModalOpen(false)}
                  aria-label="Cancel exit"
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-zinc-100 pt-4">
                <button
                  type="button"
                  disabled={isExitingProgram}
                  onClick={() => setIsExitModalOpen(false)}
                  className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isExitingProgram}
                  onClick={() => void handleConfirmExitProgram()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                >
                  <Power className="h-3.5 w-3.5" />
                  <span>{isExitingProgram ? 'Exiting...' : 'Yes, Exit Program'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </FirestoreErrorBoundary>
  );
}
