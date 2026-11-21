import type {
  DeckAnalysisResult,
  DeckFormat,
  DeckGoal,
  DeckSelectionState,
  DeckVersionSnapshot,
} from '../types/deck';
import { buildOptimizedDeckExport } from './deckExport';
import { consolidateResolvedDeckCards } from './deckRules';

const LEGACY_SHARED_STORAGE_KEY = 'manalens_version_history_v1';
const USER_STORAGE_PREFIX = 'umbras_pass_user_history_v2_';
const GUEST_SESSION_KEY = 'umbras_pass_active_guest_session_v2';
const LOCAL_PROFILES_LIST_KEY = 'umbras_pass_local_profiles_v2';
const ACTIVE_LOCAL_PROFILE_SESSION_KEY = 'umbras_pass_active_local_profile_v2';
export const MAX_SNAPSHOTS = 10;

export interface StoredLocalUserProfile {
  id: string;
  name: string;
  createdAt: string;
  passcodeSalt?: string;
  passcodeHash?: string;
}

function generateSaltHex(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback deterministic digest if WebCrypto subtle is unavailable
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2 ^ (ch + i), 2246822519);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export async function createProfilePasscodeDigest(passcode: string): Promise<{
  passcodeSalt: string;
  passcodeHash: string;
}> {
  const passcodeSalt = generateSaltHex();
  const passcodeHash = await sha256Hex(`${passcodeSalt}:${passcode}`);
  return { passcodeSalt, passcodeHash };
}

export async function verifyProfilePasscode(
  profile: StoredLocalUserProfile,
  passcode: string
): Promise<boolean> {
  if (!profile.passcodeHash || !profile.passcodeSalt) return true;
  const candidate = await sha256Hex(`${profile.passcodeSalt}:${passcode}`);
  return candidate === profile.passcodeHash;
}

export function loadSavedLocalProfiles(): StoredLocalUserProfile[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_PROFILES_LIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is StoredLocalUserProfile =>
        Boolean(p && typeof p.id === 'string' && typeof p.name === 'string')
    );
  } catch {
    return [];
  }
}

export function saveLocalProfilesList(profiles: StoredLocalUserProfile[]): void {
  try {
    window.localStorage.setItem(LOCAL_PROFILES_LIST_KEY, JSON.stringify(profiles));
  } catch {
    // Ignore storage unavailability
  }
}

export function loadActiveSessionLocalProfile(): StoredLocalUserProfile | null {
  try {
    const sessionOnly = isSessionOnlyPersistenceMode();
    if (sessionOnly) {
      window.localStorage.removeItem(ACTIVE_LOCAL_PROFILE_SESSION_KEY);
    }
    const raw =
      window.sessionStorage.getItem(ACTIVE_LOCAL_PROFILE_SESSION_KEY) ||
      (!sessionOnly
        ? window.localStorage.getItem(ACTIVE_LOCAL_PROFILE_SESSION_KEY)
        : null);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'string' && typeof parsed.name === 'string') {
      return parsed as StoredLocalUserProfile;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveActiveSessionLocalProfile(
  profile: StoredLocalUserProfile | null
): void {
  try {
    const sessionOnly = isSessionOnlyPersistenceMode();
    if (!profile) {
      window.sessionStorage.removeItem(ACTIVE_LOCAL_PROFILE_SESSION_KEY);
      window.localStorage.removeItem(ACTIVE_LOCAL_PROFILE_SESSION_KEY);
      return;
    }
    const serialized = JSON.stringify(profile);
    window.sessionStorage.setItem(ACTIVE_LOCAL_PROFILE_SESSION_KEY, serialized);
    if (sessionOnly) {
      window.localStorage.removeItem(ACTIVE_LOCAL_PROFILE_SESSION_KEY);
    } else {
      window.localStorage.setItem(ACTIVE_LOCAL_PROFILE_SESSION_KEY, serialized);
    }
  } catch {
    // Ignore storage unavailability
  }
}

export function clearLegacySharedDeckStorage(): void {
  try {
    window.localStorage.removeItem(LEGACY_SHARED_STORAGE_KEY);
  } catch {
    // Ignore storage unavailability
  }
}

export function getOrCreateGuestSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(GUEST_SESSION_KEY);
    if (existing && existing.trim()) {
      return existing.trim();
    }
    const freshId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `guest_${crypto.randomUUID()}`
        : `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(GUEST_SESSION_KEY, freshId);
    return freshId;
  } catch {
    return `guest_${Date.now()}`;
  }
}

export function rotateGuestSessionId(): string {
  const freshId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `guest_${crypto.randomUUID()}`
      : `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    const oldId = window.sessionStorage.getItem(GUEST_SESSION_KEY);
    if (oldId) {
      window.sessionStorage.removeItem(`${USER_STORAGE_PREFIX}${oldId}`);
    }
    window.sessionStorage.setItem(GUEST_SESSION_KEY, freshId);
  } catch {
    // Ignore storage unavailability
  }
  return freshId;
}

function normalizeCardMetadata(rawMeta: unknown): DeckAnalysisResult['resolvedCards'][number]['card'] {
  if (!rawMeta || typeof rawMeta !== 'object') return null;
  const m = rawMeta as Record<string, unknown>;
  return {
    name: typeof m.name === 'string' ? m.name : 'Unknown Card',
    manaCost: typeof m.manaCost === 'string' ? m.manaCost : '',
    cmc: typeof m.cmc === 'number' && Number.isFinite(m.cmc) ? m.cmc : 0,
    typeLine: typeof m.typeLine === 'string' ? m.typeLine : '',
    oracleText: typeof m.oracleText === 'string' ? m.oracleText : '',
    colors: Array.isArray(m.colors)
      ? m.colors.filter((c): c is string => typeof c === 'string')
      : [],
    colorIdentity: Array.isArray(m.colorIdentity)
      ? m.colorIdentity.filter((c): c is string => typeof c === 'string')
      : [],
    producedMana: Array.isArray(m.producedMana)
      ? m.producedMana.filter((c): c is string => typeof c === 'string')
      : [],
    isLand: Boolean(m.isLand),
    isMdfcLand: Boolean(m.isMdfcLand),
    entersTappedLikely: Boolean(m.entersTappedLikely ?? m.entersTapped),
    isRamp: Boolean(m.isRamp),
    isDraw: Boolean(m.isDraw),
    isRemoval: Boolean(m.isRemoval),
    isBoardWipe: Boolean(m.isBoardWipe),
    isProtection: Boolean(m.isProtection),
    power: typeof m.power === 'string' ? m.power : undefined,
    toughness: typeof m.toughness === 'string' ? m.toughness : undefined,
    imageUri: typeof m.imageUri === 'string' ? m.imageUri : '',
    backImageUri: typeof m.backImageUri === 'string' ? m.backImageUri : undefined,
    priceUsd:
      typeof m.priceUsd === 'number' && Number.isFinite(m.priceUsd) ? m.priceUsd : null,
    priceFoilUsd:
      typeof m.priceFoilUsd === 'number' && Number.isFinite(m.priceFoilUsd)
        ? m.priceFoilUsd
        : null,
    priceEur:
      typeof m.priceEur === 'number' && Number.isFinite(m.priceEur) ? m.priceEur : null,
    priceTix:
      typeof m.priceTix === 'number' && Number.isFinite(m.priceTix) ? m.priceTix : null,
    cardKingdomPriceUsd:
      typeof m.cardKingdomPriceUsd === 'number' && Number.isFinite(m.cardKingdomPriceUsd)
        ? m.cardKingdomPriceUsd
        : null,
    cardKingdomUrl: typeof m.cardKingdomUrl === 'string' ? m.cardKingdomUrl : undefined,
    tcgplayerUrl: typeof m.tcgplayerUrl === 'string' ? m.tcgplayerUrl : undefined,
    cardmarketUrl: typeof m.cardmarketUrl === 'string' ? m.cardmarketUrl : undefined,
    cardhoarderUrl: typeof m.cardhoarderUrl === 'string' ? m.cardhoarderUrl : undefined,
    ebayUrl: typeof m.ebayUrl === 'string' ? m.ebayUrl : undefined,
    setCode: typeof m.setCode === 'string' ? m.setCode : undefined,
    setName: typeof m.setName === 'string' ? m.setName : undefined,
    collectorNumber:
      typeof m.collectorNumber === 'string' ? m.collectorNumber : undefined,
    scryfallUri: typeof m.scryfallUri === 'string' ? m.scryfallUri : '',
    legalInFormat: typeof m.legalInFormat === 'boolean' ? m.legalInFormat : true,
    rarity: typeof m.rarity === 'string' ? m.rarity : 'common',
  };
}

export function normalizeDeckAnalysisResult(raw: unknown): DeckAnalysisResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<DeckAnalysisResult>;
  const rawMetrics = (obj.metrics && typeof obj.metrics === 'object' ? obj.metrics : {}) as Partial<
    DeckAnalysisResult['metrics']
  >;
  const rawManaPlan = (obj.manaPlan && typeof obj.manaPlan === 'object'
    ? obj.manaPlan
    : {}) as Partial<DeckAnalysisResult['manaPlan']>;

  const defaultCurve = Array.from({ length: 8 }, (_, idx) => ({
    cmc: idx,
    cmcLabel: idx === 7 ? '7+' : `${idx}`,
    currentCount: 0,
  }));

  const curve =
    Array.isArray(rawMetrics.curve) && rawMetrics.curve.length > 0
      ? rawMetrics.curve
          .filter((item): item is NonNullable<typeof item> => Boolean(item && typeof item === 'object'))
          .map((item, idx) => ({
            cmc: typeof item.cmc === 'number' && Number.isFinite(item.cmc) ? item.cmc : idx,
            cmcLabel:
              typeof item.cmcLabel === 'string' && item.cmcLabel
                ? item.cmcLabel
                : idx === 7
                ? '7+'
                : `${idx}`,
            currentCount:
              typeof item.currentCount === 'number' && Number.isFinite(item.currentCount)
                ? item.currentCount
                : 0,
          }))
      : defaultCurve;

  const rawResolvedCards = Array.isArray(obj.resolvedCards)
    ? obj.resolvedCards
        .filter((item): item is NonNullable<typeof item> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          name:
            typeof item.name === 'string' && item.name.trim()
              ? item.name.trim()
              : typeof item.card?.name === 'string' && item.card.name.trim()
              ? item.card.name.trim()
              : 'Unknown Card',
          quantity:
            typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0
              ? item.quantity
              : 1,
          zone:
            item.zone === 'commander' ||
            item.zone === 'companion' ||
            item.zone === 'sideboard' ||
            item.zone === 'maybeboard' ||
            item.zone === 'main'
              ? item.zone
              : 'main',
          setCode: typeof item.setCode === 'string' ? item.setCode : undefined,
          collectorNumber:
            typeof item.collectorNumber === 'string' ? item.collectorNumber : undefined,
          categoryTag: typeof item.categoryTag === 'string' ? item.categoryTag : undefined,
          notFound: typeof item.notFound === 'boolean' ? item.notFound : undefined,
          card: normalizeCardMetadata(item.card),
        }))
    : [];

  const resolvedCards = consolidateResolvedDeckCards(
    rawResolvedCards,
    typeof rawMetrics.detectedFormat === 'string' ? rawMetrics.detectedFormat : undefined
  );

  const rawCmdColors = Array.isArray(rawMetrics.commanderColorIdentity)
    ? rawMetrics.commanderColorIdentity.filter((c): c is string => typeof c === 'string')
    : [];

  const trueAllowedColorsSet = new Set<string>(rawCmdColors);
  if (trueAllowedColorsSet.size === 0) {
    for (const rc of resolvedCards) {
      if (rc.zone === 'sideboard' || rc.zone === 'maybeboard') continue;
      if (rc.card && !rc.card.isLand) {
        for (const cid of rc.card.colorIdentity || []) {
          if (cid === 'W' || cid === 'U' || cid === 'B' || cid === 'R' || cid === 'G') {
            trueAllowedColorsSet.add(cid);
          }
        }
      }
    }
    if (Array.isArray(rawMetrics.colorBreakdown)) {
      for (const cb of rawMetrics.colorBreakdown) {
        if (cb && typeof cb.pips === 'number' && cb.pips > 0 && typeof cb.color === 'string') {
          trueAllowedColorsSet.add(cb.color);
        }
      }
    }
  }

  const colorBreakdown = Array.isArray(rawMetrics.colorBreakdown)
    ? rawMetrics.colorBreakdown
        .filter((item): item is NonNullable<typeof item> => Boolean(item && typeof item === 'object'))
        .map((item) => {
          const color = (item.color || 'C') as DeckAnalysisResult['metrics']['colorBreakdown'][number]['color'];
          const pips = typeof item.pips === 'number' && Number.isFinite(item.pips) ? item.pips : 0;
          const isAllowedColor =
            pips > 0 || trueAllowedColorsSet.has(color);

          if (!isAllowedColor) {
            return {
              color,
              label: typeof item.label === 'string' ? item.label : 'Colorless',
              pips: 0,
              pipSharePct: 0,
              currentSources: 0,
              recommendedSources: 0,
              deltaSources: 0,
              status: 'unused' as const,
            };
          }

          return {
            color,
            label: typeof item.label === 'string' ? item.label : 'Colorless',
            pips,
            pipSharePct:
              typeof item.pipSharePct === 'number' && Number.isFinite(item.pipSharePct)
                ? item.pipSharePct
                : 0,
            currentSources:
              typeof item.currentSources === 'number' && Number.isFinite(item.currentSources)
                ? item.currentSources
                : 0,
            recommendedSources:
              typeof item.recommendedSources === 'number' && Number.isFinite(item.recommendedSources)
                ? item.recommendedSources
                : 0,
            deltaSources:
              typeof item.deltaSources === 'number' && Number.isFinite(item.deltaSources)
                ? item.deltaSources
                : 0,
            status: item.status || 'unused',
          };
        })
    : [];

  const isMetaAllowedInColors = (meta: ReturnType<typeof normalizeCardMetadata>): boolean => {
    if (!meta || trueAllowedColorsSet.size === 0) return true;
    const cid = meta.colorIdentity || [];
    return cid.every((c) => trueAllowedColorsSet.has(c));
  };

  const swaps = Array.isArray(obj.swaps)
    ? obj.swaps
        .filter((s): s is NonNullable<typeof s> => Boolean(s && typeof s === 'object'))
        .map((s, idx) => ({
          id: typeof s.id === 'string' && s.id ? s.id : `swap-${idx}`,
          cutCardName: typeof s.cutCardName === 'string' ? s.cutCardName : 'Unknown Card',
          addCardName: typeof s.addCardName === 'string' ? s.addCardName : 'Unknown Card',
          quantity:
            typeof s.quantity === 'number' && Number.isFinite(s.quantity) && s.quantity > 0
              ? s.quantity
              : 1,
          role: typeof s.role === 'string' ? s.role : 'Synergy',
          cutReason: typeof s.cutReason === 'string' ? s.cutReason : '',
          addReason: typeof s.addReason === 'string' ? s.addReason : '',
          priority:
            s.priority === 'high' || s.priority === 'medium' || s.priority === 'low'
              ? s.priority
              : ('medium' as const),
          cutCardMeta: normalizeCardMetadata(s.cutCardMeta),
          addCardMeta: normalizeCardMetadata(s.addCardMeta),
        }))
        .filter((s) => isMetaAllowedInColors(s.addCardMeta))
    : [];

  const cuts = Array.isArray(obj.cuts)
    ? obj.cuts
        .filter((c): c is NonNullable<typeof c> => Boolean(c && typeof c === 'object'))
        .map((c, idx) => ({
          id: typeof c.id === 'string' && c.id ? c.id : `cut-${idx}`,
          cardName: typeof c.cardName === 'string' ? c.cardName : 'Unknown Card',
          quantity:
            typeof c.quantity === 'number' && Number.isFinite(c.quantity) && c.quantity > 0
              ? c.quantity
              : 1,
          category: c.category || 'off-plan',
          reason: typeof c.reason === 'string' ? c.reason : '',
          priority:
            c.priority === 'high' || c.priority === 'medium' || c.priority === 'low'
              ? c.priority
              : ('medium' as const),
          cardMeta: normalizeCardMetadata(c.cardMeta),
        }))
    : [];

  const additions = Array.isArray(obj.additions)
    ? obj.additions
        .filter((a): a is NonNullable<typeof a> => Boolean(a && typeof a === 'object'))
        .map((a, idx) => ({
          id: typeof a.id === 'string' && a.id ? a.id : `add-${idx}`,
          cardName: typeof a.cardName === 'string' ? a.cardName : 'Unknown Card',
          quantity:
            typeof a.quantity === 'number' && Number.isFinite(a.quantity) && a.quantity > 0
              ? a.quantity
              : 1,
          role: a.role || ('Synergy' as const),
          reason: typeof a.reason === 'string' ? a.reason : '',
          priority:
            a.priority === 'high' || a.priority === 'medium' || a.priority === 'low'
              ? a.priority
              : ('medium' as const),
          cardMeta: normalizeCardMetadata(a.cardMeta),
        }))
        .filter((a) => isMetaAllowedInColors(a.cardMeta))
    : [];

  const landChanges = Array.isArray(rawManaPlan.landChanges)
    ? rawManaPlan.landChanges
        .filter((lc): lc is NonNullable<typeof lc> => Boolean(lc && typeof lc === 'object'))
        .map((lc, idx) => ({
          id: typeof lc.id === 'string' && lc.id ? lc.id : `land-${idx}`,
          action: (lc.action === 'cut' ? 'cut' : 'add') as 'add' | 'cut',
          cardName: typeof lc.cardName === 'string' ? lc.cardName : 'Command Tower',
          quantity:
            typeof lc.quantity === 'number' && Number.isFinite(lc.quantity) && lc.quantity > 0
              ? lc.quantity
              : 1,
          reason: typeof lc.reason === 'string' ? lc.reason : '',
          cardMeta: normalizeCardMetadata(lc.cardMeta),
        }))
        .filter((lc) => lc.action === 'cut' || isMetaAllowedInColors(lc.cardMeta))
    : [];

  const currentLands = typeof rawMetrics.currentLands === 'number' ? rawMetrics.currentLands : 0;
  const recommendedLands =
    typeof rawMetrics.recommendedLands === 'number' ? rawMetrics.recommendedLands : 37;
  const landsDelta =
    typeof rawMetrics.landsDelta === 'number'
      ? rawMetrics.landsDelta
      : recommendedLands - currentLands;
  const currentRamp = typeof rawMetrics.currentRamp === 'number' ? rawMetrics.currentRamp : 0;
  const recommendedRamp =
    typeof rawMetrics.recommendedRamp === 'number' ? rawMetrics.recommendedRamp : 10;
  const rampDelta =
    typeof rawMetrics.rampDelta === 'number'
      ? rawMetrics.rampDelta
      : Math.max(0, recommendedRamp - currentRamp);

  return {
    deckName: typeof obj.deckName === 'string' && obj.deckName ? obj.deckName : 'Analyzed Deck',
    sourceFormat: typeof obj.sourceFormat === 'string' ? obj.sourceFormat : 'Decklist',
    goal: obj.goal || 'bracket-3',
    archetype: typeof obj.archetype === 'string' ? obj.archetype : 'MTG Deck',
    verdictHeadline:
      typeof obj.verdictHeadline === 'string' ? obj.verdictHeadline : 'Deck Analysis Complete',
    verdictSummary: typeof obj.verdictSummary === 'string' ? obj.verdictSummary : '',
    topPriorities: Array.isArray(obj.topPriorities)
      ? obj.topPriorities.filter((p): p is string => typeof p === 'string')
      : [],
    metrics: {
      detectedFormat: rawMetrics.detectedFormat || 'commander',
      targetDeckSize:
        typeof rawMetrics.targetDeckSize === 'number' ? rawMetrics.targetDeckSize : 100,
      currentMainAndCommanderCount:
        typeof rawMetrics.currentMainAndCommanderCount === 'number'
          ? rawMetrics.currentMainAndCommanderCount
          : 0,
      sideboardCount:
        typeof rawMetrics.sideboardCount === 'number' ? rawMetrics.sideboardCount : 0,
      deckSizeDelta:
        typeof rawMetrics.deckSizeDelta === 'number' ? rawMetrics.deckSizeDelta : 0,
      commanderNames: Array.isArray(rawMetrics.commanderNames)
        ? rawMetrics.commanderNames.filter((n): n is string => typeof n === 'string')
        : [],
      commanderColorIdentity: Array.isArray(rawMetrics.commanderColorIdentity)
        ? rawMetrics.commanderColorIdentity.filter((c): c is string => typeof c === 'string')
        : [],
      currentLands,
      mdfcLandCount:
        typeof rawMetrics.mdfcLandCount === 'number' ? rawMetrics.mdfcLandCount : 0,
      tappedLandCount:
        typeof rawMetrics.tappedLandCount === 'number' ? rawMetrics.tappedLandCount : 0,
      recommendedLands,
      landsDelta,
      recommendedRamp,
      currentRamp,
      rampDelta,
      currentDraw: typeof rawMetrics.currentDraw === 'number' ? rawMetrics.currentDraw : 0,
      recommendedDraw:
        typeof rawMetrics.recommendedDraw === 'number' ? rawMetrics.recommendedDraw : 10,
      currentRemoval:
        typeof rawMetrics.currentRemoval === 'number' ? rawMetrics.currentRemoval : 0,
      recommendedRemoval:
        typeof rawMetrics.recommendedRemoval === 'number' ? rawMetrics.recommendedRemoval : 10,
      currentBoardWipes:
        typeof rawMetrics.currentBoardWipes === 'number' ? rawMetrics.currentBoardWipes : 0,
      averageCmcNonLand:
        typeof rawMetrics.averageCmcNonLand === 'number' ? rawMetrics.averageCmcNonLand : 0,
      averageCmcWithLands:
        typeof rawMetrics.averageCmcWithLands === 'number' ? rawMetrics.averageCmcWithLands : 0,
      curve,
      colorBreakdown,
      formatViolations: Array.isArray(rawMetrics.formatViolations)
        ? rawMetrics.formatViolations.filter((v): v is string => typeof v === 'string')
        : [],
      singletonViolations: Array.isArray(rawMetrics.singletonViolations)
        ? rawMetrics.singletonViolations.filter((v): v is string => typeof v === 'string')
        : [],
      colorIdentityViolations: Array.isArray(rawMetrics.colorIdentityViolations)
        ? rawMetrics.colorIdentityViolations.filter((v): v is string => typeof v === 'string')
        : [],
      unresolvedCards: Array.isArray(rawMetrics.unresolvedCards)
        ? rawMetrics.unresolvedCards.filter((v): v is string => typeof v === 'string')
        : [],
    },
    manaPlan: {
      verdict: rawManaPlan.verdict || 'balanced',
      headline:
        typeof rawManaPlan.headline === 'string'
          ? rawManaPlan.headline
          : 'Mana Base Assessment',
      plainExplanation:
        typeof rawManaPlan.plainExplanation === 'string' ? rawManaPlan.plainExplanation : '',
      currentLands,
      recommendedLands,
      landsMissingOrExcess: landsDelta,
      currentRamp,
      recommendedRamp,
      rampMissing: rampDelta,
      tappedLandsWarning:
        typeof rawManaPlan.tappedLandsWarning === 'string'
          ? rawManaPlan.tappedLandsWarning
          : null,
      colorIssues: Array.isArray(rawManaPlan.colorIssues)
        ? rawManaPlan.colorIssues.filter((v): v is string => typeof v === 'string')
        : [],
      landChanges,
    },
    swaps,
    cuts,
    additions,
    resolvedCards,
  };
}

export function normalizeDeckSelectionState(
  raw: unknown,
  fallbackAnalysis?: DeckAnalysisResult | null
): DeckSelectionState {
  if (!raw || typeof raw !== 'object') {
    return fallbackAnalysis
      ? createSelectionStateFromAnalysis(fallbackAnalysis, true)
      : { swapIds: [], cutIds: [], addIds: [], landChangeIds: [] };
  }
  const sel = raw as Partial<DeckSelectionState>;
  return {
    swapIds: Array.isArray(sel.swapIds) ? sel.swapIds : [],
    cutIds: Array.isArray(sel.cutIds) ? sel.cutIds : [],
    addIds: Array.isArray(sel.addIds) ? sel.addIds : [],
    landChangeIds: Array.isArray(sel.landChangeIds) ? sel.landChangeIds : [],
  };
}

export function normalizeDeckSnapshot(raw: unknown): DeckVersionSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const snap = raw as Partial<DeckVersionSnapshot>;
  if (typeof snap.id !== 'string' || !snap.analysis) return null;
  const normalizedAnalysis = normalizeDeckAnalysisResult(snap.analysis);
  if (!normalizedAnalysis) return null;
  const normalizedSelection = normalizeDeckSelectionState(
    snap.selection,
    normalizedAnalysis
  );

  return {
    id: snap.id,
    label: typeof snap.label === 'string' ? snap.label : 'Saved Snapshot',
    createdAt:
      typeof snap.createdAt === 'string' ? snap.createdAt : new Date().toISOString(),
    isAutoSaved: Boolean(snap.isAutoSaved),
    deckName:
      typeof snap.deckName === 'string' && snap.deckName
        ? snap.deckName
        : normalizedAnalysis.deckName,
    format: snap.format || normalizedAnalysis.metrics.detectedFormat || 'auto',
    goal: snap.goal || normalizedAnalysis.goal || 'bracket-3',
    originalDeckText:
      typeof snap.originalDeckText === 'string' ? snap.originalDeckText : '',
    resultingDeckText:
      typeof snap.resultingDeckText === 'string' ? snap.resultingDeckText : '',
    resultingLandCount:
      typeof snap.resultingLandCount === 'number'
        ? snap.resultingLandCount
        : normalizedAnalysis.metrics.currentLands,
    totalMainCount:
      typeof snap.totalMainCount === 'number'
        ? snap.totalMainCount
        : normalizedAnalysis.metrics.currentMainAndCommanderCount,
    averageCmcNonLand:
      typeof snap.averageCmcNonLand === 'number'
        ? snap.averageCmcNonLand
        : normalizedAnalysis.metrics.averageCmcNonLand,
    tappedLandCount:
      typeof snap.tappedLandCount === 'number'
        ? snap.tappedLandCount
        : normalizedAnalysis.metrics.tappedLandCount,
    activeColorSummary:
      typeof snap.activeColorSummary === 'string'
        ? snap.activeColorSummary
        : 'Colorless',
    activeChangeCount:
      typeof snap.activeChangeCount === 'number' ? snap.activeChangeCount : 0,
    selection: normalizedSelection,
    analysis: normalizedAnalysis,
  };
}

export function createSelectionStateFromAnalysis(
  analysis: DeckAnalysisResult,
  selectAll = true
): DeckSelectionState {
  if (!selectAll) {
    return {
      swapIds: [],
      cutIds: [],
      addIds: [],
      landChangeIds: [],
    };
  }
  return {
    swapIds: (analysis.swaps ?? []).map((s) => s.id),
    cutIds: (analysis.cuts ?? []).map((c) => c.id),
    addIds: (analysis.additions ?? []).map((a) => a.id),
    landChangeIds: (analysis.manaPlan?.landChanges ?? []).map((l) => l.id),
  };
}

export function selectionSignature(selection: DeckSelectionState): string {
  return [
    [...(selection?.swapIds ?? [])].sort().join(','),
    [...(selection?.cutIds ?? [])].sort().join(','),
    [...(selection?.addIds ?? [])].sort().join(','),
    [...(selection?.landChangeIds ?? [])].sort().join(','),
  ].join('|');
}

function isSessionOnlyPersistenceMode(): boolean {
  try {
    return window.localStorage.getItem('umbras_pass_auth_persistence_v1') === 'session';
  } catch {
    return false;
  }
}

function getStorageForScope(userScopeKey: string): {
  storage: Storage;
  storageKey: string;
} {
  const safeScope = (userScopeKey || 'guest').replace(/[^a-zA-Z0-9_\-]/g, '_');
  const isAuthenticatedUser = safeScope.startsWith('uid_');
  const useSessionOnly = !isAuthenticatedUser || isSessionOnlyPersistenceMode();
  const storageKey = `${USER_STORAGE_PREFIX}${safeScope}`;

  if (useSessionOnly && isAuthenticatedUser) {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Ignore storage unavailability
    }
  }

  return {
    storage: useSessionOnly ? window.sessionStorage : window.localStorage,
    storageKey,
  };
}

export function loadVersionSnapshots(userScopeKey?: string): DeckVersionSnapshot[] {
  clearLegacySharedDeckStorage();
  const effectiveScope = userScopeKey || getOrCreateGuestSessionId();
  try {
    const { storage, storageKey } = getStorageForScope(effectiveScope);
    const raw = storage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeDeckSnapshot(item))
      .filter((item): item is DeckVersionSnapshot => item !== null);
  } catch {
    return [];
  }
}

export function persistVersionSnapshots(
  snapshots: DeckVersionSnapshot[],
  userScopeKey?: string
): void {
  clearLegacySharedDeckStorage();
  const effectiveScope = userScopeKey || getOrCreateGuestSessionId();
  const { storage, storageKey } = getStorageForScope(effectiveScope);

  let trimmed = snapshots.slice(0, MAX_SNAPSHOTS);
  while (trimmed.length > 0) {
    try {
      storage.setItem(storageKey, JSON.stringify(trimmed));
      return;
    } catch {
      // Evict oldest auto-saved snapshot first; otherwise drop the oldest item
      const oldestAutoIdx = [...trimmed]
        .reverse()
        .findIndex((s) => Boolean(s.isAutoSaved));
      if (oldestAutoIdx >= 0) {
        const idxToRemove = trimmed.length - 1 - oldestAutoIdx;
        trimmed = trimmed.filter((_, i) => i !== idxToRemove);
      } else {
        trimmed = trimmed.slice(0, trimmed.length - 1);
      }
    }
  }
  try {
    storage.removeItem(storageKey);
  } catch {
    // Ignore storage unavailability
  }
}

export interface UserActiveWorkspaceState {
  deckText: string;
  deckName: string;
  format: DeckFormat;
  goal: DeckGoal;
  analysis: DeckAnalysisResult | null;
  selection: DeckSelectionState;
}

const USER_ACTIVE_WORKSPACE_PREFIX = 'umbras_pass_active_workspace_v2_';

function getWorkspaceStorageTarget(userScopeKey: string): {
  storage: Storage;
  key: string;
} {
  const safeScope = userScopeKey.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const key = `${USER_ACTIVE_WORKSPACE_PREFIX}${safeScope}`;
  const sessionOnly = isSessionOnlyPersistenceMode();
  if (sessionOnly) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage unavailability
    }
  }
  return {
    storage: sessionOnly ? window.sessionStorage : window.localStorage,
    key,
  };
}

export function loadUserActiveWorkspace(
  userScopeKey: string
): UserActiveWorkspaceState | null {
  if (!userScopeKey || !userScopeKey.startsWith('uid_')) {
    return null;
  }
  const { storage, key } = getWorkspaceStorageTarget(userScopeKey);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserActiveWorkspaceState>;
    if (!parsed || typeof parsed !== 'object') {
      storage.removeItem(key);
      return null;
    }
    const normalizedAnalysis = parsed.analysis
      ? normalizeDeckAnalysisResult(parsed.analysis)
      : null;
    const normalizedSelection = normalizeDeckSelectionState(
      parsed.selection,
      normalizedAnalysis
    );
    return {
      deckText: typeof parsed.deckText === 'string' ? parsed.deckText : '',
      deckName: typeof parsed.deckName === 'string' ? parsed.deckName : '',
      format: parsed.format || 'auto',
      goal: parsed.goal || 'bracket-3',
      analysis: normalizedAnalysis,
      selection: normalizedSelection,
    };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore
    }
    return null;
  }
}

export function persistUserActiveWorkspace(
  userScopeKey: string,
  state: UserActiveWorkspaceState | null
): void {
  if (!userScopeKey || !userScopeKey.startsWith('uid_')) {
    return;
  }
  const { storage, key } = getWorkspaceStorageTarget(userScopeKey);
  try {
    if (!state || (!(typeof state.deckText === 'string' ? state.deckText : '').trim() && !state.analysis)) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(state));
  } catch {
    // Ignore quota or storage errors
  }
}

export function migrateAuthenticatedScopeToSessionStorage(
  userScopeKey: string
): void {
  if (!userScopeKey || !userScopeKey.startsWith('uid_')) return;
  const safeScope = userScopeKey.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const historyKey = `${USER_STORAGE_PREFIX}${safeScope}`;
  const workspaceKey = `${USER_ACTIVE_WORKSPACE_PREFIX}${safeScope}`;
  try {
    const localHistory = window.localStorage.getItem(historyKey);
    if (localHistory) {
      window.sessionStorage.setItem(historyKey, localHistory);
      window.localStorage.removeItem(historyKey);
    }
    const localWorkspace = window.localStorage.getItem(workspaceKey);
    if (localWorkspace) {
      window.sessionStorage.setItem(workspaceKey, localWorkspace);
      window.localStorage.removeItem(workspaceKey);
    }
  } catch {
    // Ignore storage unavailability
  }
}

export function purgeUserLocalBrowserCache(userScopeKey: string): void {
  if (!userScopeKey) return;
  const safeScope = userScopeKey.replace(/[^a-zA-Z0-9_\-]/g, '_');
  try {
    window.localStorage.removeItem(`${USER_STORAGE_PREFIX}${safeScope}`);
    window.sessionStorage.removeItem(`${USER_STORAGE_PREFIX}${safeScope}`);
    window.localStorage.removeItem(`${USER_ACTIVE_WORKSPACE_PREFIX}${safeScope}`);
    window.sessionStorage.removeItem(`${USER_ACTIVE_WORKSPACE_PREFIX}${safeScope}`);
  } catch {
    // Ignore storage unavailability
  }
}

export function createDeckSnapshot(params: {
  label: string;
  isAutoSaved?: boolean;
  deckName: string;
  format: DeckFormat;
  goal: DeckGoal;
  originalDeckText: string;
  analysis: DeckAnalysisResult;
  selection: DeckSelectionState;
}): DeckVersionSnapshot {
  const {
    label,
    isAutoSaved = false,
    deckName,
    format,
    goal,
    originalDeckText,
    analysis,
    selection,
  } = params;

  const computed = buildOptimizedDeckExport(
    analysis,
    new Set(selection?.swapIds ?? []),
    new Set(selection?.cutIds ?? []),
    new Set(selection?.addIds ?? []),
    new Set(selection?.landChangeIds ?? [])
  );

  const activeColors = (analysis.metrics?.colorBreakdown ?? [])
    .filter((c) => c.status !== 'unused')
    .map((c) => `${c.color}:${c.currentSources}`)
    .join(' · ');

  const activeChangeCount =
    (selection?.swapIds ?? []).length +
    (selection?.cutIds ?? []).length +
    (selection?.addIds ?? []).length +
    (selection?.landChangeIds ?? []).length;

  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    label: (typeof label === 'string' ? label : '').trim() || `Mana Snapshot · ${computed.resultingLandCount} Lands`,
    createdAt: new Date().toISOString(),
    isAutoSaved,
    deckName: (typeof deckName === 'string' ? deckName : '').trim() || analysis.deckName,
    format,
    goal,
    originalDeckText,
    resultingDeckText: computed.exportText,
    resultingLandCount: computed.resultingLandCount,
    totalMainCount: computed.totalMainCount,
    averageCmcNonLand: analysis.metrics?.averageCmcNonLand ?? 0,
    tappedLandCount: analysis.metrics?.tappedLandCount ?? 0,
    activeColorSummary: activeColors || 'Colorless',
    activeChangeCount,
    selection: {
      swapIds: [...(selection?.swapIds ?? [])],
      cutIds: [...(selection?.cutIds ?? [])],
      addIds: [...(selection?.addIds ?? [])],
      landChangeIds: [...(selection?.landChangeIds ?? [])],
    },
    analysis,
  };
}

export interface DecklistDiffEntry {
  name: string;
  delta: number; // positive = more in snapshot than in current, negative = fewer in snapshot
}

export interface DecklistDiffSummary {
  addedInSnapshot: DecklistDiffEntry[];
  removedInSnapshot: DecklistDiffEntry[];
  isIdentical: boolean;
}

function parseDeckTextCounts(deckText: string): Map<string, { name: string; qty: number }> {
  const counts = new Map<string, { name: string; qty: number }>();
  const lines = (typeof deckText === 'string' ? deckText : '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(commander|companion|deck|sideboard|maybeboard)$/i.test(line)) {
      continue;
    }
    const match = line.match(/^(\d+)x?\s+(.+)$/i);
    if (!match) continue;
    const qty = Number(match[1]);
    const name = match[2].trim();
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;

    const key = name.toLowerCase();
    const existing = counts.get(key);
    if (existing) {
      existing.qty += qty;
    } else {
      counts.set(key, { name, qty });
    }
  }
  return counts;
}

export function computeDecklistDiff(
  snapshotDeckText: string,
  currentDeckText: string
): DecklistDiffSummary {
  const snapMap = parseDeckTextCounts(snapshotDeckText);
  const currMap = parseDeckTextCounts(currentDeckText);

  const allKeys = new Set([...snapMap.keys(), ...currMap.keys()]);
  const addedInSnapshot: DecklistDiffEntry[] = [];
  const removedInSnapshot: DecklistDiffEntry[] = [];

  for (const key of allKeys) {
    const snapEntry = snapMap.get(key);
    const currEntry = currMap.get(key);
    const snapQty = snapEntry?.qty || 0;
    const currQty = currEntry?.qty || 0;
    const diff = snapQty - currQty;
    const displayName = snapEntry?.name || currEntry?.name || key;

    if (diff > 0) {
      addedInSnapshot.push({ name: displayName, delta: diff });
    } else if (diff < 0) {
      removedInSnapshot.push({ name: displayName, delta: Math.abs(diff) });
    }
  }

  addedInSnapshot.sort((a, b) => a.name.localeCompare(b.name));
  removedInSnapshot.sort((a, b) => a.name.localeCompare(b.name));

  return {
    addedInSnapshot,
    removedInSnapshot,
    isIdentical: addedInSnapshot.length === 0 && removedInSnapshot.length === 0,
  };
}

export function formatSnapshotTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
