import type {
  CardAddRecommendation,
  CardCutRecommendation,
  CardMetadata,
  CardSwapRecommendation,
  DeckFormat,
  DeckMetrics,
  LandPlanItem,
  ManaColor,
  ParsedCardEntry,
  ResolvedDeckCard,
} from '../types/deck';

export const BASIC_LAND_KEYS = new Set<string>([
  'plains',
  'island',
  'swamp',
  'mountain',
  'forest',
  'wastes',
  'snow-covered plains',
  'snow-covered island',
  'snow-covered swamp',
  'snow-covered mountain',
  'snow-covered forest',
]);

const UNLIMITED_COPIES_KEYS = new Set<string>([
  'relentless rats',
  'shadowborn apostle',
  'rat colony',
  'persistent petitioners',
  "dragon's approach",
  'slime against humanity',
  'hare apparent',
  'tempest hawk',
]);

const SPECIAL_CAP_BY_KEY: Record<string, number> = {
  'seven dwarves': 7,
  nazgul: 9,
};

export const VINTAGE_RESTRICTED_KEYS = new Set<string>([
  'ancestral recall',
  'balance',
  'black lotus',
  'brainstorm',
  'chalice of the void',
  'channel',
  'demonic consultation',
  'demonic tutor',
  'dig through time',
  'flash',
  'gitaxian probe',
  'golgari grave-troll',
  'imperial seal',
  'karn, the great creator',
  'library of alexandria',
  'lion\'s eye diamond',
  'lodestone golem',
  'lotus petal',
  'mana crypt',
  'mana vault',
  'memory jar',
  'mental misstep',
  'mind\'s desire',
  'monastery mentor',
  'mox emerald',
  'mox jet',
  'mox pearl',
  'mox ruby',
  'mox sapphire',
  'mystic forge',
  'mystical tutor',
  'narset, parter of veils',
  'necropotence',
  'ponder',
  'sol ring',
  'strip mine',
  'thorn of amethyst',
  'time vault',
  'time walk',
  'timetwister',
  'tinker',
  'tolarian academy',
  'treasure cruise',
  'trinisphere',
  'urza\'s saga',
  'vampiric tutor',
  'vexing bauble',
  'wheel of fortune',
  'windfall',
  'yawgmoth\'s will',
]);

/**
 * Normalizes a Magic card name into a canonical lookup key:
 * - strips NFD diacritics (e.g. Lórien -> lorien, Lim-Dûl -> lim-dul)
 * - normalizes curly apostrophes/quotes to ASCII
 * - collapses whitespace and lowercases
 */
export function normalizeDeckCardKey(name: string | undefined | null): string {
  return (typeof name === 'string' ? name : '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function getCardFrontFaceKey(name: string | undefined | null): string {
  const norm = normalizeDeckCardKey(name);
  if (!norm) return '';
  const splitIdx = norm.indexOf(' // ');
  return splitIdx >= 0 ? norm.slice(0, splitIdx).trim() : norm;
}

export function isSameCardName(a: string | undefined | null, b: string | undefined | null): boolean {
  const ka = normalizeDeckCardKey(a);
  const kb = normalizeDeckCardKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const fa = getCardFrontFaceKey(ka);
  const fb = getCardFrontFaceKey(kb);
  return fa === kb || ka === fb || (fa !== '' && fa === fb && (ka.includes(' // ') || kb.includes(' // ')));
}

/**
 * Resolves the best matching key in a Map keyed by `normalizeDeckCardKey(...)`,
 * falling back cleanly between full `Front // Back` DFC names and `Front`-only names.
 */
export function findMatchingCardMapKey<T>(
  map: Map<string, T>,
  cardName: string | undefined | null
): string | undefined {
  const norm = normalizeDeckCardKey(cardName);
  if (!norm) return undefined;
  if (map.has(norm)) return norm;
  if (norm.includes(' // ')) {
    const front = getCardFrontFaceKey(norm);
    if (front && map.has(front)) return front;
  } else {
    const prefix = `${norm} // `;
    for (const k of map.keys()) {
      if (k.startsWith(prefix)) return k;
    }
  }
  return undefined;
}

export function getMapCardCount(
  counts: Map<string, number>,
  cardName: string | undefined | null
): number {
  const matchedKey = findMatchingCardMapKey(counts, cardName);
  return matchedKey ? counts.get(matchedKey) || 0 : 0;
}

export function addMapCardCount(
  counts: Map<string, number>,
  cardName: string | undefined | null,
  delta: number
): void {
  const norm = normalizeDeckCardKey(cardName);
  if (!norm || !Number.isFinite(delta) || delta === 0) return;
  const existingKey = findMatchingCardMapKey(counts, norm) || norm;
  const next = (counts.get(existingKey) || 0) + delta;
  if (next <= 0) {
    counts.delete(existingKey);
  } else {
    counts.set(existingKey, next);
  }
}

export function isBasicLandCard(
  cardName: string | undefined | null,
  meta?: CardMetadata | null
): boolean {
  const key = normalizeDeckCardKey(cardName);
  if (BASIC_LAND_KEYS.has(key)) return true;
  const front = getCardFrontFaceKey(key);
  if (BASIC_LAND_KEYS.has(front)) return true;
  if (meta?.typeLine && /\bbasic\b/i.test(meta.typeLine) && /\bland\b/i.test(meta.typeLine)) {
    return true;
  }
  return false;
}

export function isSingletonFormat(format: DeckFormat | undefined): boolean {
  return format === 'commander' || format === 'brawl';
}

export function isRestrictedCardInFormat(
  cardName: string | undefined | null,
  format: DeckFormat | undefined,
  meta?: CardMetadata | null
): boolean {
  if (format !== 'vintage') return false;
  if (meta?.restrictedInFormat) return true;
  const key = normalizeDeckCardKey(cardName);
  const front = getCardFrontFaceKey(key);
  return VINTAGE_RESTRICTED_KEYS.has(key) || VINTAGE_RESTRICTED_KEYS.has(front);
}

/**
 * Returns the maximum legal copies of a card allowed in a deck for the given format.
 */
export function getMaxCopiesForCard(
  cardName: string | undefined | null,
  format: DeckFormat | undefined,
  meta?: CardMetadata | null
): number {
  if (isBasicLandCard(cardName, meta)) return Number.POSITIVE_INFINITY;

  const key = normalizeDeckCardKey(cardName);
  const front = getCardFrontFaceKey(key);
  if (UNLIMITED_COPIES_KEYS.has(key) || UNLIMITED_COPIES_KEYS.has(front)) {
    return Number.POSITIVE_INFINITY;
  }
  if (meta?.oracleText && /a deck can have any number of cards named/i.test(meta.oracleText)) {
    return Number.POSITIVE_INFINITY;
  }

  if (isRestrictedCardInFormat(cardName, format, meta)) {
    return 1;
  }

  const special = SPECIAL_CAP_BY_KEY[key] ?? SPECIAL_CAP_BY_KEY[front];
  if (typeof special === 'number') {
    return special;
  }

  if (format === 'commander' || format === 'brawl') {
    return 1;
  }
  if (format === 'limited') {
    return Number.POSITIVE_INFINITY;
  }
  return 4;
}

/**
 * Merges duplicate parsed card entries within the same zone using canonical name keys
 * (case, diacritics, smart quotes, whitespace, and DFC front/full variants when identical),
 * and strips redundant Commander/Companion copies mistakenly exported into Main/Sideboard.
 */
export function mergeParsedCardEntries(entries: ParsedCardEntry[]): ParsedCardEntry[] {
  const byZone = new Map<string, ParsedCardEntry>();

  for (const entry of entries) {
    if (!entry || !entry.name || !entry.name.trim()) continue;
    const norm = normalizeDeckCardKey(entry.name);
    if (!norm) continue;
    const qty = Number.isFinite(entry.quantity) && entry.quantity > 0 ? Math.round(entry.quantity) : 1;

    // Look for exact key or DFC front/full match in the same zone
    let targetKey = `${entry.zone}::${norm}`;
    if (!byZone.has(targetKey)) {
      const zonePrefix = `${entry.zone}::`;
      for (const [k, existing] of byZone.entries()) {
        if (!k.startsWith(zonePrefix)) continue;
        if (isSameCardName(existing.name, entry.name)) {
          targetKey = k;
          break;
        }
      }
    }

    const existing = byZone.get(targetKey);
    if (existing) {
      existing.quantity += qty;
      if (entry.name.includes(' // ') && !existing.name.includes(' // ')) {
        existing.name = entry.name;
      }
      if (!existing.setCode && entry.setCode) existing.setCode = entry.setCode;
      if (!existing.collectorNumber && entry.collectorNumber) {
        existing.collectorNumber = entry.collectorNumber;
      }
      if (!existing.categoryTag && entry.categoryTag) {
        existing.categoryTag = entry.categoryTag;
      }
    } else {
      byZone.set(targetKey, { ...entry, quantity: qty });
    }
  }

  const merged = Array.from(byZone.values());

  // If a card is explicitly listed in Commander (or Companion), ensure a duplicate 1x export
  // of that exact same card isn't also counted in Main/Sideboard.
  const commanderEntries = merged.filter((c) => c.zone === 'commander');
  for (const cmd of commanderEntries) {
    if (cmd.quantity > 1) cmd.quantity = 1;
  }
  const companionEntries = merged.filter((c) => c.zone === 'companion');
  for (const comp of companionEntries) {
    if (comp.quantity > 1) comp.quantity = 1;
  }

  if (commanderEntries.length === 0 && companionEntries.length === 0) {
    return merged;
  }

  const deduped: ParsedCardEntry[] = [];
  for (const entry of merged) {
    if (entry.zone === 'main' || entry.zone === 'sideboard') {
      const overlapsCommander = commanderEntries.some((cmd) => isSameCardName(cmd.name, entry.name));
      const overlapsCompanion =
        entry.zone === 'sideboard' &&
        companionEntries.some((comp) => isSameCardName(comp.name, entry.name));

      if (overlapsCommander || overlapsCompanion) {
        if (entry.quantity <= 1) {
          continue;
        }
        deduped.push({ ...entry, quantity: entry.quantity - 1 });
        continue;
      }
    }
    deduped.push(entry);
  }

  return deduped;
}

/**
 * Post-Scryfall consolidation of `ResolvedDeckCard[]`:
 * - Merges cards that resolved to the same Scryfall canonical name in the same zone
 *   (e.g. "Delver of Secrets" and "Delver of Secrets // Insectile Aberration", accented variants, or split printings).
 * - Deduplicates Commander & Companion copies so they are never double-counted in Main/Sideboard.
 */
export function consolidateResolvedDeckCards(
  resolvedCards: ResolvedDeckCard[],
  format?: DeckFormat
): ResolvedDeckCard[] {
  const byZone = new Map<string, ResolvedDeckCard>();

  for (const item of resolvedCards || []) {
    if (!item || !item.name || !item.name.trim()) continue;
    const zone = item.zone || 'main';
    const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? Math.round(item.quantity) : 1;
    const norm = normalizeDeckCardKey(item.name);
    if (!norm) continue;

    let targetKey = `${zone}::${norm}`;
    if (!byZone.has(targetKey)) {
      const zonePrefix = `${zone}::`;
      for (const [k, existing] of byZone.entries()) {
        if (!k.startsWith(zonePrefix)) continue;
        if (isSameCardName(existing.name, item.name)) {
          targetKey = k;
          break;
        }
      }
    }

    const existing = byZone.get(targetKey);
    if (existing) {
      existing.quantity += qty;
      if (!existing.card && item.card) {
        existing.card = item.card;
        existing.notFound = item.notFound;
      }
      if (item.name.includes(' // ') && !existing.name.includes(' // ')) {
        existing.name = item.name;
      }
      if (!existing.setCode && item.setCode) existing.setCode = item.setCode;
      if (!existing.collectorNumber && item.collectorNumber) {
        existing.collectorNumber = item.collectorNumber;
      }
      if (!existing.categoryTag && item.categoryTag) {
        existing.categoryTag = item.categoryTag;
      }
    } else {
      byZone.set(targetKey, { ...item, zone, quantity: qty });
    }
  }

  const merged = Array.from(byZone.values());
  const commanders = merged.filter((c) => c.zone === 'commander');
  const companions = merged.filter((c) => c.zone === 'companion');

  for (const cmd of commanders) {
    if (cmd.quantity > 1) cmd.quantity = 1;
  }
  for (const comp of companions) {
    if (comp.quantity > 1) comp.quantity = 1;
  }

  const singleton = isSingletonFormat(format);
  if (commanders.length === 0 && companions.length === 0) {
    return merged;
  }

  const out: ResolvedDeckCard[] = [];
  for (const item of merged) {
    if (item.zone === 'main' || item.zone === 'sideboard') {
      const isCmdOverlap = commanders.some((cmd) => isSameCardName(cmd.name, item.name));
      const isCompOverlap =
        companions.some((comp) => isSameCardName(comp.name, item.name)) &&
        (item.zone === 'sideboard' || singleton);

      if (isCmdOverlap || isCompOverlap) {
        if (item.quantity <= 1) continue;
        out.push({ ...item, quantity: item.quantity - 1 });
        continue;
      }
    }
    out.push(item);
  }

  return out;
}

/**
 * Returns the legal target Main + Commander deck size for a given MTG format.
 * Companion and Sideboard cards sit outside this count per official MTG rules.
 */
export function getTargetDeckSizeForFormat(
  format: Exclude<DeckFormat, 'auto'>,
  currentMainAndCommanderCount?: number
): number {
  if (format === 'commander') return 100;
  if (format === 'brawl') {
    return typeof currentMainAndCommanderCount === 'number' &&
      currentMainAndCommanderCount > 0 &&
      currentMainAndCommanderCount <= 65
      ? 60
      : 100;
  }
  if (format === 'limited') return 40;
  return 60;
}

/**
 * Consistently detects format from parsed decklist entries.
 * Excludes Companion & Sideboard from the Main + Commander count.
 */
export function detectFormatFromParsedCards(
  entries: ParsedCardEntry[],
  requestedFormat: DeckFormat
): Exclude<DeckFormat, 'auto'> {
  if (requestedFormat !== 'auto') return requestedFormat;

  const hasCommander = entries.some((e) => e.zone === 'commander');
  const mainAndCmdCount = entries
    .filter((e) => e.zone === 'main' || e.zone === 'commander')
    .reduce((acc, e) => acc + e.quantity, 0);

  if (hasCommander && mainAndCmdCount >= 50 && mainAndCmdCount <= 65) {
    return 'brawl';
  }
  if (hasCommander || mainAndCmdCount >= 85) return 'commander';
  if (mainAndCmdCount >= 35 && mainAndCmdCount <= 45) return 'limited';
  return 'casual60';
}

const BASIC_LAND_NAME_BY_COLOR: Record<ManaColor, string> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
  C: 'Wastes',
};

export interface ReconcileCandidateAddition {
  cardName: string;
  role: CardAddRecommendation['role'];
  reason: string;
  cardMeta?: CardMetadata | null;
}

/**
 * Strictly reconciles analysis recommendations (swaps, cuts, additions, landChanges)
 * so the resulting deck ALWAYS matches `metrics.targetDeckSize` (40 / 60 / 100)
 * and NEVER exceeds the format's card limit or per-card copy caps.
 */
export function reconcileAnalysisRecommendationsToTargetSize(params: {
  resolvedCards: ResolvedDeckCard[];
  metrics: DeckMetrics;
  swaps: CardSwapRecommendation[];
  cuts: CardCutRecommendation[];
  additions: CardAddRecommendation[];
  landChanges: LandPlanItem[];
  candidateAdditions?: ReconcileCandidateAddition[];
  lookupMeta?: (name: string) => CardMetadata | null;
}): {
  swaps: CardSwapRecommendation[];
  cuts: CardCutRecommendation[];
  additions: CardAddRecommendation[];
  landChanges: LandPlanItem[];
  resultingMainAndCommanderCount: number;
  resultingLandCount: number;
} {
  const { metrics, candidateAdditions = [], lookupMeta } = params;
  const format = metrics.detectedFormat;
  const targetDeckSize =
    metrics.targetDeckSize > 0
      ? metrics.targetDeckSize
      : getTargetDeckSizeForFormat(format, metrics.currentMainAndCommanderCount);

  const consolidated = consolidateResolvedDeckCards(params.resolvedCards || [], format);
  const mainAndCmd = consolidated.filter(
    (c) => c.zone === 'main' || c.zone === 'commander'
  );

  const metaByKey = new Map<string, CardMetadata>();
  const cardDisplayNameByKey = new Map<string, string>();
  const availableToCut = new Map<string, number>();
  const projectedCounts = new Map<string, number>();

  let baseMainAndCmdCount = 0;
  let baseLandCount = 0;

  for (const item of mainAndCmd) {
    const qty = Math.max(1, Math.round(item.quantity || 1));
    baseMainAndCmdCount += qty;
    if (item.card?.isLand) {
      baseLandCount += qty;
    }
    const key = normalizeDeckCardKey(item.name);
    if (key) {
      if (item.card && !metaByKey.has(key)) metaByKey.set(key, item.card);
      if (!cardDisplayNameByKey.has(key)) cardDisplayNameByKey.set(key, item.name);
    }
    addMapCardCount(projectedCounts, item.name, qty);
    if (item.zone === 'main') {
      addMapCardCount(availableToCut, item.name, qty);
    }
  }

  const getMeta = (name: string, hint?: CardMetadata | null): CardMetadata | null => {
    if (hint) return hint;
    const mk = findMatchingCardMapKey(metaByKey, name);
    if (mk) return metaByKey.get(mk) || null;
    return lookupMeta ? lookupMeta(name) : null;
  };

  const getCopyHeadroom = (name: string, meta?: CardMetadata | null): number => {
    const maxCopies = getMaxCopiesForCard(name, format, meta);
    if (!Number.isFinite(maxCopies)) return Number.POSITIVE_INFINITY;
    return Math.max(0, maxCopies - getMapCardCount(projectedCounts, name));
  };

  // Clone and defensively replay swaps, cuts, landChanges, and additions against real counts
  const swaps: CardSwapRecommendation[] = [];
  for (const s of params.swaps || []) {
    if (!s || isSameCardName(s.cutCardName, s.addCardName)) continue;
    const cutAvail = getMapCardCount(availableToCut, s.cutCardName);
    const addMeta = getMeta(s.addCardName, s.addCardMeta);
    const addRoom = getCopyHeadroom(s.addCardName, addMeta);
    const qty = Math.min(Math.max(1, Math.round(s.quantity || 1)), cutAvail, addRoom);
    if (qty <= 0) continue;
    addMapCardCount(availableToCut, s.cutCardName, -qty);
    addMapCardCount(projectedCounts, s.cutCardName, -qty);
    addMapCardCount(projectedCounts, s.addCardName, qty);
    swaps.push({ ...s, quantity: qty, addCardMeta: addMeta ?? s.addCardMeta ?? null });
  }

  const cuts: CardCutRecommendation[] = [];
  for (const c of params.cuts || []) {
    if (!c || !c.cardName) continue;
    const cutAvail = getMapCardCount(availableToCut, c.cardName);
    const qty = Math.min(Math.max(1, Math.round(c.quantity || 1)), cutAvail);
    if (qty <= 0) continue;
    addMapCardCount(availableToCut, c.cardName, -qty);
    addMapCardCount(projectedCounts, c.cardName, -qty);
    cuts.push({ ...c, quantity: qty });
  }

  const landChanges: LandPlanItem[] = [];
  for (const lc of params.landChanges || []) {
    if (!lc || !lc.cardName) continue;
    const reqQty = Math.max(1, Math.round(lc.quantity || 1));
    if (lc.action === 'cut') {
      const cutAvail = getMapCardCount(availableToCut, lc.cardName);
      const qty = Math.min(reqQty, cutAvail);
      if (qty <= 0) continue;
      addMapCardCount(availableToCut, lc.cardName, -qty);
      addMapCardCount(projectedCounts, lc.cardName, -qty);
      landChanges.push({ ...lc, quantity: qty });
    } else {
      const meta = getMeta(lc.cardName, lc.cardMeta);
      const addRoom = getCopyHeadroom(lc.cardName, meta);
      const qty = Math.min(reqQty, addRoom);
      if (qty <= 0) continue;
      addMapCardCount(projectedCounts, lc.cardName, qty);
      landChanges.push({ ...lc, quantity: qty, cardMeta: meta ?? lc.cardMeta ?? null });
    }
  }

  const additions: CardAddRecommendation[] = [];
  for (const a of params.additions || []) {
    if (!a || !a.cardName) continue;
    const reqQty = Math.max(1, Math.round(a.quantity || 1));
    const meta = getMeta(a.cardName, a.cardMeta);
    const addRoom = getCopyHeadroom(a.cardName, meta);
    const qty = Math.min(reqQty, addRoom);
    if (qty <= 0) continue;
    addMapCardCount(projectedCounts, a.cardName, qty);
    additions.push({ ...a, quantity: qty, cardMeta: meta ?? a.cardMeta ?? null });
  }

  const pushOrMergeCut = (
    cardName: string,
    qty: number,
    reason: string,
    category: CardCutRecommendation['category'],
    priority: CardCutRecommendation['priority'],
    cardMeta: CardMetadata | null
  ) => {
    if (qty <= 0) return;
    addMapCardCount(availableToCut, cardName, -qty);
    addMapCardCount(projectedCounts, cardName, -qty);
    const existing = cuts.find((c) => isSameCardName(c.cardName, cardName));
    if (existing) {
      existing.quantity += qty;
    } else {
      cuts.push({
        id: `cut-bal-${cuts.length}`,
        cardName,
        quantity: qty,
        reason,
        category,
        priority,
        cardMeta,
      });
    }
  };

  const pushOrMergeLandChange = (
    action: 'add' | 'cut',
    cardName: string,
    qty: number,
    reason: string,
    cardMeta: CardMetadata | null
  ) => {
    if (qty <= 0) return;
    if (action === 'cut') {
      addMapCardCount(availableToCut, cardName, -qty);
      addMapCardCount(projectedCounts, cardName, -qty);
    } else {
      addMapCardCount(projectedCounts, cardName, qty);
    }
    const existing = landChanges.find(
      (lc) => lc.action === action && isSameCardName(lc.cardName, cardName)
    );
    if (existing) {
      existing.quantity += qty;
    } else {
      landChanges.push({
        id: `land-${action}-bal-${landChanges.length}`,
        action,
        cardName,
        quantity: qty,
        reason,
        cardMeta,
      });
    }
  };

  const pushOrMergeAddition = (
    cardName: string,
    qty: number,
    role: CardAddRecommendation['role'],
    reason: string,
    priority: CardAddRecommendation['priority'],
    cardMeta: CardMetadata | null
  ) => {
    if (qty <= 0) return;
    addMapCardCount(projectedCounts, cardName, qty);
    const existing = additions.find((a) => isSameCardName(a.cardName, cardName));
    if (existing) {
      existing.quantity += qty;
    } else {
      additions.push({
        id: `add-bal-${additions.length}`,
        cardName,
        quantity: qty,
        role,
        reason,
        priority,
        cardMeta,
      });
    }
  };

  // Step 1: Enforce per-card format copy caps (e.g. >1 copy of non-basic in Commander/Brawl, >4 in 60-card)
  for (const [key, count] of Array.from(projectedCounts.entries())) {
    const displayName = cardDisplayNameByKey.get(key) || key;
    const meta = getMeta(displayName);
    const maxCopies = getMaxCopiesForCard(displayName, format, meta);
    if (Number.isFinite(maxCopies) && count > maxCopies) {
      const avail = getMapCardCount(availableToCut, displayName);
      const excess = Math.min(count - maxCopies, avail);
      if (excess > 0) {
        pushOrMergeCut(
          displayName,
          excess,
          `Removes ${excess} excess cop${excess === 1 ? 'y' : 'ies'} to comply with the ${format} ${maxCopies}-copy limit.`,
          'illegal',
          'high',
          meta
        );
      }
    }
  }

  const computeCurrentTotals = () => {
    let deltaMain = 0;
    let deltaLands = 0;
    for (const s of swaps) {
      const cutIsLand = Boolean(s.cutCardMeta?.isLand);
      const addIsLand = Boolean(s.addCardMeta?.isLand);
      if (addIsLand && !cutIsLand) deltaLands += s.quantity;
      else if (cutIsLand && !addIsLand) deltaLands -= s.quantity;
    }
    for (const c of cuts) {
      deltaMain -= c.quantity;
      if (c.cardMeta?.isLand) deltaLands -= c.quantity;
    }
    for (const a of additions) {
      deltaMain += a.quantity;
      if (a.role === 'Land' || a.cardMeta?.isLand) deltaLands += a.quantity;
    }
    for (const lc of landChanges) {
      if (lc.action === 'cut') {
        deltaMain -= lc.quantity;
        deltaLands -= lc.quantity;
      } else {
        deltaMain += lc.quantity;
        deltaLands += lc.quantity;
      }
    }
    return {
      total: baseMainAndCmdCount + deltaMain,
      lands: baseLandCount + deltaLands,
    };
  };

  // Determine active deck colors (ordered by highest pip demand) for proportional basic-land fill
  const activeColors: ManaColor[] = (metrics.colorBreakdown || [])
    .filter((c) => c.status !== 'unused')
    .sort((a, b) => b.deltaSources - a.deltaSources || b.pips - a.pips)
    .map((c) => c.color);
  const allowedColorSet = new Set<string>(
    metrics.commanderColorIdentity.length > 0
      ? metrics.commanderColorIdentity
      : activeColors
  );
  const basicColorPool: ManaColor[] =
    activeColors.length > 0
      ? activeColors
      : allowedColorSet.size > 0
      ? (Array.from(allowedColorSet).filter(
          (c): c is ManaColor => c === 'W' || c === 'U' || c === 'B' || c === 'R' || c === 'G'
        ) as ManaColor[])
      : ['C'];

  const isOffColorCard = (meta: CardMetadata | null): boolean => {
    if (!meta || allowedColorSet.size === 0) return false;
    return (meta.colorIdentity || []).some((c) => !allowedColorSet.has(c));
  };

  let { total: projectedTotal, lands: projectedLands } = computeCurrentTotals();

  // Step 2: Handle OVERFLOW (projectedTotal > targetDeckSize) — deck must NEVER go over format target!
  if (projectedTotal > targetDeckSize) {
    let overflow = projectedTotal - targetDeckSize;

    // 2a. First trim uncompensated spell additions (low -> medium -> high priority, from end)
    for (const prio of ['low', 'medium', 'high'] as const) {
      for (let i = additions.length - 1; i >= 0 && overflow > 0; i--) {
        const add = additions[i];
        if (add.priority !== prio) continue;
        const trim = Math.min(add.quantity, overflow);
        add.quantity -= trim;
        addMapCardCount(projectedCounts, add.cardName, -trim);
        overflow -= trim;
        if (add.quantity <= 0) {
          additions.splice(i, 1);
        }
      }
    }

    // 2b. Next cut weakest cuttable non-land maindeck cards to make room for missing lands or trim excess
    if (overflow > 0) {
      const cuttableNonLands = mainAndCmd
        .filter((c) => c.zone === 'main' && !c.card?.isLand)
        .map((c) => {
          const meta = c.card;
          const illegal =
            (meta && meta.legalInFormat === false) ||
            ((format === 'commander' || format === 'brawl') && isOffColorCard(meta));
          const isEngine = Boolean(
            meta?.isRamp || meta?.isDraw || meta?.isRemoval || meta?.isBoardWipe
          );
          const cmc = meta?.cmc ?? 3;
          // Higher score = better candidate to cut first
          const score =
            (illegal ? 1000 : 0) +
            (!isEngine ? 100 : 0) +
            cmc * 10 +
            (meta?.isMdfcLand ? -40 : 0);
          return { item: c, illegal, score };
        })
        .sort((a, b) => b.score - a.score);

      for (const cand of cuttableNonLands) {
        if (overflow <= 0) break;
        const avail = getMapCardCount(availableToCut, cand.item.name);
        if (avail <= 0) continue;
        const cutQty = Math.min(avail, overflow);
        const reason = cand.illegal
          ? `Not legal for ${format} deck rules or color identity.`
          : metrics.deckSizeDelta < 0
          ? `Trims deck to the legal ${targetDeckSize}-card ${format} limit (MV ${cand.item.card?.cmc ?? '?'}).`
          : `Frees slot(s) to keep the deck at ${targetDeckSize} cards after mana base additions.`;
        pushOrMergeCut(
          cand.item.name,
          cutQty,
          reason,
          cand.illegal ? 'illegal' : metrics.deckSizeDelta < 0 ? 'excess' : 'overcosted',
          cand.illegal ? 'high' : 'medium',
          cand.item.card
        );
        overflow -= cutQty;
      }
    }

    // 2c. If still over (e.g. deck is almost all lands), trim added lands first, then cut excess lands
    if (overflow > 0) {
      for (let i = landChanges.length - 1; i >= 0 && overflow > 0; i--) {
        const lc = landChanges[i];
        if (lc.action !== 'add') continue;
        const trim = Math.min(lc.quantity, overflow);
        lc.quantity -= trim;
        addMapCardCount(projectedCounts, lc.cardName, -trim);
        overflow -= trim;
        if (lc.quantity <= 0) {
          landChanges.splice(i, 1);
        }
      }
    }

    if (overflow > 0) {
      const cuttableLands = mainAndCmd
        .filter((c) => c.zone === 'main' && Boolean(c.card?.isLand))
        .sort((a, b) => {
          const aScore =
            (a.card?.entersTappedLikely ? 20 : 0) + (isBasicLandCard(a.name, a.card) ? 10 : 0);
          const bScore =
            (b.card?.entersTappedLikely ? 20 : 0) + (isBasicLandCard(b.name, b.card) ? 10 : 0);
          return bScore - aScore;
        });

      for (const land of cuttableLands) {
        if (overflow <= 0) break;
        const avail = getMapCardCount(availableToCut, land.name);
        if (avail <= 0) continue;
        const cutQty = Math.min(avail, overflow);
        pushOrMergeLandChange(
          'cut',
          land.name,
          cutQty,
          `Trims excess land to match the legal ${targetDeckSize}-card ${format} size.`,
          land.card
        );
        overflow -= cutQty;
      }
    }
  }

  ({ total: projectedTotal, lands: projectedLands } = computeCurrentTotals());

  // Step 3: Handle SHORTFALL (projectedTotal < targetDeckSize) — bring under-size decks up to targetDeckSize
  if (projectedTotal < targetDeckSize) {
    let shortfall = targetDeckSize - projectedTotal;

    // 3a. If we still need lands to reach recommendedLands, add basic lands in active colors first
    const landShortfall = Math.max(0, metrics.recommendedLands - projectedLands);
    const landsToAddNow = Math.min(shortfall, landShortfall);
    if (landsToAddNow > 0) {
      for (let i = 0; i < landsToAddNow; i++) {
        const color = basicColorPool[i % basicColorPool.length] || 'C';
        const basicName = BASIC_LAND_NAME_BY_COLOR[color] || 'Wastes';
        pushOrMergeLandChange(
          'add',
          basicName,
          1,
          `Brings deck up to ${targetDeckSize} cards while hitting the recommended ${metrics.recommendedLands}-land mana target.`,
          getMeta(basicName)
        );
        shortfall--;
      }
    }

    // 3b. Fill remaining slots with legal, on-color candidate spell additions (respecting copy limits)
    if (shortfall > 0 && candidateAdditions.length > 0) {
      const singleton = isSingletonFormat(format);
      // First pass: 1 copy of each unique eligible staple for diversity
      for (const cand of candidateAdditions) {
        if (shortfall <= 0) break;
        const meta = getMeta(cand.cardName, cand.cardMeta);
        if (meta && meta.legalInFormat === false) continue;
        if (isOffColorCard(meta)) continue;
        const canonicalName = meta?.name || cand.cardName;
        const room = getCopyHeadroom(canonicalName, meta);
        if (room <= 0) continue;
        const addQty = Math.min(shortfall, singleton ? 1 : Math.min(2, room));
        pushOrMergeAddition(
          canonicalName,
          addQty,
          cand.role,
          cand.reason,
          'medium',
          meta
        );
        shortfall -= addQty;
      }

      // Second pass for 60-card / 40-card formats if still short: top up copies up to copy cap
      if (shortfall > 0 && !singleton) {
        for (const cand of candidateAdditions) {
          if (shortfall <= 0) break;
          const meta = getMeta(cand.cardName, cand.cardMeta);
          if (meta && meta.legalInFormat === false) continue;
          if (isOffColorCard(meta)) continue;
          const canonicalName = meta?.name || cand.cardName;
          const room = getCopyHeadroom(canonicalName, meta);
          if (room <= 0) continue;
          const addQty = Math.min(shortfall, room);
          pushOrMergeAddition(
            canonicalName,
            addQty,
            cand.role,
            cand.reason,
            'medium',
            meta
          );
          shortfall -= addQty;
        }
      }
    }

    // 3c. If still short, roll back non-illegal standalone cuts (lowest priority first) so we don't leave deck under target
    if (shortfall > 0) {
      for (const prio of ['low', 'medium', 'high'] as const) {
        for (let i = cuts.length - 1; i >= 0 && shortfall > 0; i--) {
          const cut = cuts[i];
          if (cut.category === 'illegal' || cut.priority !== prio) continue;
          const restore = Math.min(cut.quantity, shortfall);
          cut.quantity -= restore;
          addMapCardCount(availableToCut, cut.cardName, restore);
          addMapCardCount(projectedCounts, cut.cardName, restore);
          shortfall -= restore;
          if (cut.quantity <= 0) {
            cuts.splice(i, 1);
          }
        }
      }
    }

    // 3d. Final guarantee: fill any remaining shortfall with on-color Basic Lands so exact targetDeckSize is reached
    if (shortfall > 0) {
      for (let i = 0; i < shortfall; i++) {
        const color = basicColorPool[i % basicColorPool.length] || 'C';
        const basicName = BASIC_LAND_NAME_BY_COLOR[color] || 'Wastes';
        pushOrMergeLandChange(
          'add',
          basicName,
          1,
          `Completes the deck to the legal ${targetDeckSize}-card ${format} size.`,
          getMeta(basicName)
        );
      }
    }
  }

  const finalTotals = computeCurrentTotals();
  return {
    swaps,
    cuts,
    additions,
    landChanges,
    resultingMainAndCommanderCount: finalTotals.total,
    resultingLandCount: finalTotals.lands,
  };
}

