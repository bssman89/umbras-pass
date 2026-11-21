import type { CardMetadata, ResolvedDeckCard } from '../types/deck';
import type { ExportDeckEntry } from './deckExport';

export type LandCategoryKey =
  | 'fetch'
  | 'shock'
  | 'typed-dual'
  | 'untapped-dual'
  | 'utility'
  | 'basic';

export interface LandCategoryMeta {
  key: LandCategoryKey;
  label: string;
  shortLabel: string;
  color: string;
  fetchableTarget: boolean;
  description: string;
}

export const LAND_CATEGORIES: LandCategoryMeta[] = [
  {
    key: 'fetch',
    label: 'Fetch Lands',
    shortLabel: 'Fetch',
    color: '#0284C7',
    fetchableTarget: false,
    description: 'Lands that search your library for other lands to fix colors and thin the deck.',
  },
  {
    key: 'shock',
    label: 'Shock Lands',
    shortLabel: 'Shock',
    color: '#DC2626',
    fetchableTarget: true,
    description: 'Dual lands with basic land types that enter untapped if you pay 2 life.',
  },
  {
    key: 'typed-dual',
    label: 'Typed Duals & Triomes',
    shortLabel: 'Typed Dual',
    color: '#0EA5E9',
    fetchableTarget: true,
    description: 'Non-shock lands with basic land types (Triomes, Surveil, Tango, Original Duals).',
  },
  {
    key: 'untapped-dual',
    label: 'Dual & Rainbow Lands',
    shortLabel: 'Dual / Fix',
    color: '#52525B',
    fetchableTarget: false,
    description: 'Untyped multi-color lands (Command Tower, Bond, Check, Pain, Fast, or Tap duals).',
  },
  {
    key: 'utility',
    label: 'Utility & MDFC Lands',
    shortLabel: 'Utility',
    color: '#D97706',
    fetchableTarget: false,
    description: 'Colorless/mono-color utility lands and modal double-faced spell-lands.',
  },
  {
    key: 'basic',
    label: 'Basic Lands',
    shortLabel: 'Basic',
    color: '#16A34A',
    fetchableTarget: true,
    description: 'Basic lands fetchable by virtually any land-search spell or fetch land.',
  },
];

const BASIC_LAND_NAMES = new Set([
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
  'snow-covered wastes',
]);

const SHOCK_LAND_NAMES = new Set([
  'hallowed fountain',
  'watery grave',
  'blood crypt',
  'stomping ground',
  'temple garden',
  'godless shrine',
  'steam vents',
  'overgrown tomb',
  'sacred foundry',
  'breeding pool',
]);

const FETCH_LAND_NAMES = new Set([
  'flooded strand',
  'polluted delta',
  'bloodstained mire',
  'wooded foothills',
  'windswept heath',
  'marsh flats',
  'scalding tarn',
  'verdant catacombs',
  'arid mesa',
  'misty rainforest',
  'prismatic vista',
  'fabled passage',
  'evolving wilds',
  'terramorphic expanse',
  'myriad landscape',
  'krosan verge',
]);

export interface CategorizedLandCard {
  name: string;
  quantity: number;
  category: LandCategoryKey;
  meta: CardMetadata | null;
}

export interface LandCategoryBucket extends LandCategoryMeta {
  count: number;
  pct: number;
  cards: CategorizedLandCard[];
}

export interface LandSearchDensitySummary {
  totalLands: number;
  fetchLandCount: number;
  landSearchSpellCount: number;
  totalLandSearchers: number;
  basicTargetCount: number;
  typedDualTargetCount: number;
  totalFetchableTargets: number;
  targetsPerSearcher: number | null;
  verdictSeverity: 'ok' | 'warning' | 'critical';
  verdictHeadline: string;
  verdictDetail: string;
  buckets: LandCategoryBucket[];
}

const BASIC_LAND_TYPE_REGEX = /\b(plains|island|swamp|mountain|forest)\b/i;

export function classifyLandCategory(
  name: string,
  meta?: CardMetadata | null
): LandCategoryKey {
  const lowerName = (typeof name === 'string' ? name : '').trim().toLowerCase();
  const typeLine = (meta?.typeLine || '').toLowerCase();
  const frontTypeLine = (typeLine.split('//')[0] || typeLine).trim();
  const oracle = (meta?.oracleText || '').toLowerCase();

  // 1. Basic Lands
  if (
    (/\bbasic\b/.test(frontTypeLine) && /\bland\b/.test(frontTypeLine)) ||
    BASIC_LAND_NAMES.has(lowerName)
  ) {
    return 'basic';
  }

  // 2. Fetch Lands (lands that search your library for lands / basic types)
  const searchesForLand =
    /search your library for (?:a|an|up to \w+|one|two)?[^.]*\b(land|basic|plains|island|swamp|mountain|forest)\b/i.test(
      oracle
    );
  if (searchesForLand || FETCH_LAND_NAMES.has(lowerName)) {
    return 'fetch';
  }

  // 3. Shock Lands & Other Typed Duals / Triomes (non-basic lands carrying basic land types)
  const hasBasicLandSubtype = BASIC_LAND_TYPE_REGEX.test(frontTypeLine);
  if (SHOCK_LAND_NAMES.has(lowerName)) {
    return 'shock';
  }
  if (hasBasicLandSubtype) {
    if (
      /as .* enters(?: the battlefield)?, you may pay 2 life/i.test(oracle) ||
      /pay 2 life\. if you don't, it enters tapped/i.test(oracle)
    ) {
      return 'shock';
    }
    return 'typed-dual';
  }

  // 4. MDFC Spell-Lands (classify as Utility & MDFC unless multi-color dual pathway)
  if (meta?.isMdfcLand) {
    // Dual-faced Pathway lands have Land on both faces; spell-lands have a spell front face
    const backType = (typeLine.split('//')[1] || '').trim();
    const frontIsLand = /\bland\b/.test(frontTypeLine);
    if (!frontIsLand || !/\bland\b/.test(backType)) {
      return 'utility';
    }
  }

  // 5. Untyped Dual & Rainbow Lands
  const producedCount = meta?.producedMana?.filter((c) => c !== 'C').length || 0;
  const addsAnyColor = /mana of any (?:color|one color|type)/i.test(oracle);
  if (producedCount >= 2 || addsAnyColor) {
    return 'untapped-dual';
  }

  // 6. Utility & Mono-Color Non-Basic Lands
  return 'utility';
}

export function isLandSearchSpell(card: {
  isLand?: boolean;
  oracleText?: string;
}): boolean {
  if (card.isLand) return false;
  const oracle = (card.oracleText || '').toLowerCase();
  return /search your library for (?:a|an|up to \w+|one|two)?[^.]*\b(land|basic land|plains|island|swamp|mountain|forest)\b/i.test(
    oracle
  );
}

export function computeLandTypeBreakdown(params: {
  cards: Array<{
    name: string;
    quantity: number;
    isLand: boolean;
    meta: CardMetadata | null;
  }>;
  activeColorCount: number;
}): LandSearchDensitySummary {
  const { cards, activeColorCount } = params;

  const bucketCards = new Map<LandCategoryKey, CategorizedLandCard[]>();
  for (const cat of LAND_CATEGORIES) {
    bucketCards.set(cat.key, []);
  }

  let totalLands = 0;
  let landSearchSpellCount = 0;

  for (const entry of cards) {
    if (!entry.isLand) {
      if (entry.meta && isLandSearchSpell(entry.meta)) {
        landSearchSpellCount += entry.quantity;
      }
      continue;
    }

    totalLands += entry.quantity;
    const category = classifyLandCategory(entry.name, entry.meta);
    const list = bucketCards.get(category)!;
    const existing = list.find(
      (item) => item.name.toLowerCase() === entry.name.toLowerCase()
    );
    if (existing) {
      existing.quantity += entry.quantity;
    } else {
      list.push({
        name: entry.name,
        quantity: entry.quantity,
        category,
        meta: entry.meta,
      });
    }
  }

  const buckets: LandCategoryBucket[] = LAND_CATEGORIES.map((cat) => {
    const items = (bucketCards.get(cat.key) || []).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const count = items.reduce((sum, item) => sum + item.quantity, 0);
    const pct = totalLands > 0 ? Math.round((count / totalLands) * 100) : 0;
    return {
      ...cat,
      count,
      pct,
      cards: items,
    };
  });

  const countFor = (key: LandCategoryKey) =>
    buckets.find((b) => b.key === key)?.count || 0;

  const fetchLandCount = countFor('fetch');
  const shockCount = countFor('shock');
  const typedDualCount = countFor('typed-dual');
  const basicTargetCount = countFor('basic');
  const typedDualTargetCount = shockCount + typedDualCount;
  const totalFetchableTargets = basicTargetCount + typedDualTargetCount;
  const totalLandSearchers = fetchLandCount + landSearchSpellCount;
  const targetsPerSearcher =
    totalLandSearchers > 0
      ? Number((totalFetchableTargets / totalLandSearchers).toFixed(1))
      : null;

  let verdictSeverity: 'ok' | 'warning' | 'critical' = 'ok';
  let verdictHeadline = 'Balanced land-search density';
  let verdictDetail = `You have ${totalFetchableTargets} fetchable target${
    totalFetchableTargets === 1 ? '' : 's'
  } (${basicTargetCount} basics + ${typedDualTargetCount} shock/typed duals) to support ${totalLandSearchers} land-search effect${
    totalLandSearchers === 1 ? '' : 's'
  }.`;

  if (totalLands === 0) {
    verdictSeverity = 'critical';
    verdictHeadline = 'No lands detected';
    verdictDetail = 'Add lands to compute fetchable target ratios and land-search density.';
  } else if (totalLandSearchers > 0 && totalFetchableTargets < totalLandSearchers) {
    verdictSeverity = 'critical';
    verdictHeadline = 'Too few fetchable targets (Fail-to-find risk)';
    verdictDetail = `You are running ${totalLandSearchers} land-search effects (${fetchLandCount} fetches + ${landSearchSpellCount} search spells) but only ${totalFetchableTargets} fetchable targets. Add Basic lands, Shock lands, or Typed Duals so searches don't whiff mid-game.`;
  } else if (
    fetchLandCount > 0 &&
    typedDualTargetCount === 0 &&
    activeColorCount >= 2
  ) {
    verdictSeverity = 'warning';
    verdictHeadline = 'Fetch lands lack dual-color typed targets';
    verdictDetail = `Your ${fetchLandCount} fetch land${
      fetchLandCount === 1 ? '' : 's'
    } can currently only fetch single-color Basics. Adding Shock lands, Surveil lands, or Triomes lets each fetch land fix multiple colors at once.`;
  } else if (totalLandSearchers > 0 && basicTargetCount <= 1 && activeColorCount >= 2) {
    verdictSeverity = 'warning';
    verdictHeadline = 'Very low Basic land safety net';
    verdictDetail = `Only ${basicTargetCount} Basic land detected. Running at least 3–5 Basics protects against nonbasic hate (Blood Moon, Field of Ruin) and guarantees untapped targets for basic-only ramp.`;
  } else if (totalLandSearchers === 0 && activeColorCount >= 2) {
    verdictSeverity = 'warning';
    verdictHeadline = 'No fetch lands or land-search spells';
    verdictDetail = `You have ${totalFetchableTargets} fetchable targets (${basicTargetCount} basics + ${typedDualTargetCount} shock/typed duals), but 0 fetch lands or land-tutor spells. Adding fetch lands improves multi-color consistency and deck thinning.`;
  } else if (
    targetsPerSearcher !== null &&
    targetsPerSearcher < 1.5 &&
    totalLandSearchers >= 4
  ) {
    verdictSeverity = 'warning';
    verdictHeadline = 'Tight fetchable target ratio';
    verdictDetail = `${targetsPerSearcher}x targets per searcher (${totalFetchableTargets} targets for ${totalLandSearchers} searchers). Consider trimming a generic fetch or adding 1–2 extra Basics/Shock lands so late-game fetches stay live.`;
  }

  return {
    totalLands,
    fetchLandCount,
    landSearchSpellCount,
    totalLandSearchers,
    basicTargetCount,
    typedDualTargetCount,
    totalFetchableTargets,
    targetsPerSearcher,
    verdictSeverity,
    verdictHeadline,
    verdictDetail,
    buckets,
  };
}

export function mapResolvedCardsForLandBreakdown(resolvedCards: ResolvedDeckCard[] = []) {
  return (resolvedCards || [])
    .filter((c) => c && (c.zone === 'main' || c.zone === 'commander' || c.zone === 'companion'))
    .map((c) => ({
      name: c.name || 'Unknown Card',
      quantity: typeof c.quantity === 'number' ? c.quantity : 1,
      isLand: Boolean(c.card?.isLand || c.card?.isMdfcLand),
      meta: c.card ?? null,
    }));
}

export function mapExportEntriesForLandBreakdown(entries: ExportDeckEntry[] = []) {
  return (entries || [])
    .filter((e) => e && (e.zone === 'Main' || e.zone === 'Commander' || e.zone === 'Companion'))
    .map((e) => ({
      name: e.name || 'Unknown Card',
      quantity: typeof e.qty === 'number' ? e.qty : 1,
      isLand: Boolean(e.isLand || e.meta?.isLand || e.meta?.isMdfcLand),
      meta: e.meta ?? null,
    }));
}
