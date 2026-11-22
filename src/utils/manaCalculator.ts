import type { CardMetadata, ManaColor, ResolvedDeckCard } from '../types/deck';
import type { ExportDeckEntry } from './deckExport';
import { classifyLandCategory } from './landCategories';

export interface ParsedManaRequirement {
  cmc: number;
  generic: number;
  pips: ManaColor[]; // exact colored/colorless pips required (each entry = 1 mana symbol)
  hybridGroups: ManaColor[][]; // e.g. {W/U} -> ['W', 'U']
}

export interface LibraryCardUnit {
  id: string;
  name: string;
  isLand: boolean;
  isRamp: boolean;
  cmc: number;
  manaCost: string;
  entersTapped: boolean;
  producedColors: ManaColor[]; // colors this land can tap for (1 per turn)
  meta: CardMetadata | null;
}

export interface EarlySpellStat {
  name: string;
  manaCost: string;
  cmc: number;
  quantity: number;
  targetTurn: number;
  castablePct: number;
  meta: CardMetadata | null;
}

export interface TurnCurveStat {
  turn: number;
  hitLandDropPct: number;
  fullManaOnTurnPct: number;
}

export interface SimulationSummary {
  trials: number;
  librarySize: number;
  landCount: number;
  onPlay: boolean;
  keepablePct: number;
  screwPct: number; // 0-1 lands in opening 7
  floodPct: number; // 5+ lands (60-card) or 6+ lands (100-card)
  avgLandsInSeven: number;
  turnStats: TurnCurveStat[];
  earlySpells: EarlySpellStat[];
  customCheckPct: number;
}

export interface DrawnHandCard extends LibraryCardUnit {
  statusLabel: string;
}

export interface DrawnHandReport {
  hand: DrawnHandCard[];
  nextDraws: DrawnHandCard[];
  landsInHand: number;
  untappedLandsInHand: number;
  tappedLandsInHand: number;
  keepVerdict: 'keepable' | 'risky-low' | 'risky-high';
  keepVerdictText: string;
  castableSpellNames: Set<string>; // spells in opening hand castable by Turn 3
  blockedSpellNames: Set<string>;
}

const COLOR_SYMBOLS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

export function parseManaCostRequirement(
  manaCost: string,
  fallbackCmc = 0
): ParsedManaRequirement {
  const pips: ManaColor[] = [];
  const hybridGroups: ManaColor[][] = [];
  let generic = 0;

  // Handle split/MDFC mana costs by using front face
  const frontCost = (manaCost || '').split('//')[0].trim();
  const tokens = frontCost.match(/\{([^}]+)\}/g) || [];

  for (const rawToken of tokens) {
    const inner = rawToken.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(inner)) {
      generic += Number(inner);
    } else if (inner === 'X' || inner === 'Y' || inner === 'Z') {
      // X=0 minimum casting cost
    } else if (COLOR_SYMBOLS.includes(inner as ManaColor)) {
      pips.push(inner as ManaColor);
    } else if (inner.includes('/')) {
      const parts = inner.split('/');
      if (parts.includes('P')) {
        // Phyrexian mana can be paid with 2 life, treat as 0 mandatory colored pip if life available, or optional
        // Actually for mana consistency, count colored option in hybrid or skip if life payable
        const colorPart = parts.find((p) =>
          COLOR_SYMBOLS.includes(p as ManaColor)
        ) as ManaColor | undefined;
        if (colorPart) {
          hybridGroups.push([colorPart]);
        }
      } else if (parts.some((p) => p === '2')) {
        const colorPart = parts.find((p) =>
          COLOR_SYMBOLS.includes(p as ManaColor)
        ) as ManaColor | undefined;
        if (colorPart) {
          hybridGroups.push([colorPart]);
        } else {
          generic += 2;
        }
      } else {
        const validColors = parts.filter((p) =>
          COLOR_SYMBOLS.includes(p as ManaColor)
        ) as ManaColor[];
        if (validColors.length > 0) {
          hybridGroups.push(validColors);
        }
      }
    }
  }

  const computedCmc =
    tokens.length > 0
      ? generic + pips.length + hybridGroups.length
      : fallbackCmc;

  return {
    cmc: Math.max(computedCmc, fallbackCmc),
    generic,
    pips,
    hybridGroups,
  };
}

function getFetchableDeckColors(
  entries: Array<{ name: string; isLand: boolean; meta: CardMetadata | null }>
): Set<ManaColor> {
  const available = new Set<ManaColor>();
  for (const e of entries) {
    if (!e.isLand) continue;
    const cat = classifyLandCategory(e.name, e.meta);
    if (cat === 'basic' || cat === 'shock' || cat === 'typed-dual') {
      const produced = e.meta?.producedMana || [];
      for (const c of produced) {
        if (COLOR_SYMBOLS.includes(c as ManaColor)) {
          available.add(c as ManaColor);
        }
      }
      const lower = e.name.toLowerCase();
      if (lower.includes('plains')) available.add('W');
      if (lower.includes('island')) available.add('U');
      if (lower.includes('swamp')) available.add('B');
      if (lower.includes('mountain')) available.add('R');
      if (lower.includes('forest')) available.add('G');
    }
  }
  return available;
}

function resolveLandColors(
  name: string,
  meta: CardMetadata | null,
  fetchableDeckColors: Set<ManaColor>
): ManaColor[] {
  const oracle = (meta?.oracleText || '').toLowerCase();
  const cat = classifyLandCategory(name, meta);

  if (cat === 'fetch') {
    const colors = new Set<ManaColor>();
    if (/plains/i.test(oracle)) colors.add('W');
    if (/island/i.test(oracle)) colors.add('U');
    if (/swamp/i.test(oracle)) colors.add('B');
    if (/mountain/i.test(oracle)) colors.add('R');
    if (/forest/i.test(oracle)) colors.add('G');
    if (/basic land/i.test(oracle) || colors.size === 0) {
      for (const c of fetchableDeckColors) colors.add(c);
    }
    const intersected = Array.from(colors).filter((c) =>
      fetchableDeckColors.size > 0 ? fetchableDeckColors.has(c) : true
    );
    return intersected.length > 0 ? intersected : ['C'];
  }

  if (meta?.producedMana && meta.producedMana.length > 0) {
    const filtered = meta.producedMana.filter((c): c is ManaColor =>
      COLOR_SYMBOLS.includes(c as ManaColor)
    );
    if (filtered.length > 0) return filtered;
  }

  const lower = (typeof name === 'string' ? name : '').trim().toLowerCase();
  if (lower.includes('plains')) return ['W'];
  if (lower.includes('island')) return ['U'];
  if (lower.includes('swamp')) return ['B'];
  if (lower.includes('mountain')) return ['R'];
  if (lower.includes('forest')) return ['G'];
  return ['C'];
}

export function buildLibraryUnits(
  source:
    | { kind: 'resolved'; cards: ResolvedDeckCard[] }
    | { kind: 'optimized'; entries: ExportDeckEntry[] }
): LibraryCardUnit[] {
  const rawList: Array<{
    name: string;
    quantity: number;
    isLand: boolean;
    meta: CardMetadata | null;
  }> = [];

  if (source.kind === 'resolved') {
    for (const c of source.cards || []) {
      if (!c || c.zone !== 'main') continue;
      rawList.push({
        name: c.name || 'Unknown Card',
        quantity: typeof c.quantity === 'number' ? c.quantity : 1,
        isLand: Boolean(c.card?.isLand || c.card?.isMdfcLand),
        meta: c.card ?? null,
      });
    }
  } else {
    for (const e of source.entries || []) {
      if (!e || e.zone !== 'Main') continue;
      rawList.push({
        name: e.name || 'Unknown Card',
        quantity: typeof e.qty === 'number' ? e.qty : 1,
        isLand: Boolean(e.isLand || e.meta?.isLand || e.meta?.isMdfcLand),
        meta: e.meta ?? null,
      });
    }
  }

  const fetchableColors = getFetchableDeckColors(rawList);
  const units: LibraryCardUnit[] = [];

  for (const item of rawList) {
    const producedColors = item.isLand
      ? resolveLandColors(item.name, item.meta, fetchableColors)
      : [];
    const entersTapped = item.isLand
      ? Boolean(item.meta?.entersTappedLikely)
      : false;
    const cmc = item.isLand ? 0 : item.meta?.cmc ?? 2;
    const manaCost = item.isLand ? '' : item.meta?.manaCost || '';
    const isRamp = Boolean(item.meta?.isRamp);

    for (let i = 0; i < item.quantity; i++) {
      units.push({
        id: `${item.name}-${units.length}`,
        name: item.name,
        isLand: item.isLand,
        isRamp,
        cmc,
        manaCost,
        entersTapped,
        producedColors,
        meta: item.meta,
      });
    }
  }

  return units;
}

/**
 * Checks if a set of lands in play can satisfy a given mana requirement on Turn T.
 * Uses exact backtracking over colored pips so dual lands are never double-counted.
 */
export function canLandsPayRequirement(
  landsInPlay: LibraryCardUnit[],
  availableManaCount: number,
  req: ParsedManaRequirement
): boolean {
  const totalNeeded = Math.max(req.cmc, req.pips.length + req.hybridGroups.length);
  if (availableManaCount < totalNeeded) return false;
  if (req.pips.length === 0 && req.hybridGroups.length === 0) return true;

  // Each pip slot is an array of allowed ManaColors
  const pipSlots: ManaColor[][] = [
    ...req.pips.map((p) => [p]),
    ...req.hybridGroups,
  ];

  // If fewer lands in play than total colored pips, impossible from lands alone
  if (landsInPlay.length < pipSlots.length) return false;

  // Restrict to the usable mana slots (at most availableManaCount lands)
  const usableLands = landsInPlay.slice(0, availableManaCount);
  const used = new Array<boolean>(usableLands.length).fill(false);

  // Order most constrained pips first
  pipSlots.sort((a, b) => a.length - b.length);

  const backtrack = (slotIdx: number): boolean => {
    if (slotIdx >= pipSlots.length) return true;
    const allowed = pipSlots[slotIdx];
    for (let i = 0; i < usableLands.length; i++) {
      if (used[i]) continue;
      const landColors = usableLands[i].producedColors;
      if (allowed.some((c) => landColors.includes(c))) {
        used[i] = true;
        if (backtrack(slotIdx + 1)) return true;
        used[i] = false;
      }
    }
    return false;
  };

  return backtrack(0);
}

/**
 * Checks if any subset of up to `turn` land drops chosen from all `seenLands`
 * available by Turn T can cast `req` on Turn T (accounting for color requirements
 * and the fact that only the Turn-T land drop fails to untap on Turn T if tapped).
 */
export function canSeenLandsPayAtTurn(
  seenLands: LibraryCardUnit[],
  turn: number,
  req: ParsedManaRequirement
): boolean {
  const totalLandDrops = Math.min(turn, seenLands.length);
  const untappedSeenCount = seenLands.filter((l) => !l.entersTapped).length;
  const turnTLandEnteredTapped =
    totalLandDrops === turn && untappedSeenCount === 0;
  const manaAvailable = turnTLandEnteredTapped
    ? Math.max(0, totalLandDrops - 1)
    : totalLandDrops;

  const totalNeeded = Math.max(req.cmc, req.pips.length + req.hybridGroups.length);
  if (manaAvailable < totalNeeded) return false;
  if (req.pips.length === 0 && req.hybridGroups.length === 0) return true;

  const pipSlots: ManaColor[][] = [
    ...req.pips.map((p) => [p]),
    ...req.hybridGroups,
  ];
  pipSlots.sort((a, b) => a.length - b.length);

  // Order untapped lands first so valid assignments are found quickly
  const orderedLands = [...seenLands].sort((a, b) => {
    if (a.entersTapped !== b.entersTapped) return a.entersTapped ? 1 : -1;
    return a.producedColors.length - b.producedColors.length;
  });
  const used = new Array<boolean>(orderedLands.length).fill(false);

  const backtrack = (slotIdx: number, chosenHasUntapped: boolean): boolean => {
    if (slotIdx >= pipSlots.length) {
      // If we are making all `turn` land drops and have at least one untapped land,
      // at least one of the `turn` chosen land drops must be untapped (played on Turn T).
      if (totalLandDrops === turn && !turnTLandEnteredTapped) {
        if (chosenHasUntapped) return true;
        if (pipSlots.length < turn) {
          return orderedLands.some((l, idx) => !used[idx] && !l.entersTapped);
        }
        return false;
      }
      return true;
    }

    const allowed = pipSlots[slotIdx];
    const triedAtLevel = new Set<string>();
    for (let i = 0; i < orderedLands.length; i++) {
      if (used[i]) continue;
      const land = orderedLands[i];
      if (!allowed.some((c) => land.producedColors.includes(c))) continue;
      const sig = `${land.entersTapped ? 'T' : 'U'}:${land.producedColors.join(',')}`;
      if (triedAtLevel.has(sig)) continue;
      triedAtLevel.add(sig);

      used[i] = true;
      if (backtrack(slotIdx + 1, chosenHasUntapped || !land.entersTapped)) {
        return true;
      }
      used[i] = false;
    }
    return false;
  };

  return backtrack(0, false);
}

/**
 * Computes available mana and lands-in-play on Turn T given all lands drawn so far.
 */
function resolveLandsAtTurn(
  seenCards: LibraryCardUnit[],
  turn: number
): { landsInPlay: LibraryCardUnit[]; manaAvailable: number } {
  const seenLands = seenCards.filter((c) => c.isLand);
  if (seenLands.length === 0) {
    return { landsInPlay: [], manaAvailable: 0 };
  }

  // Prioritize multi-color / untapped lands when choosing up to `turn` land drops
  const sorted = [...seenLands].sort((a, b) => {
    if (a.entersTapped !== b.entersTapped) return a.entersTapped ? 1 : -1;
    return b.producedColors.length - a.producedColors.length;
  });

  const landsPlayed = sorted.slice(0, turn);
  const untappedCount = landsPlayed.filter((l) => !l.entersTapped).length;
  const tappedCount = landsPlayed.length - untappedCount;

  // Only the final Turn-T land drop enters tapped on Turn T if we ran out of untapped lands
  const turnTLandEnteredTapped =
    landsPlayed.length === turn && untappedCount === 0 && tappedCount > 0;
  const manaAvailable = turnTLandEnteredTapped
    ? landsPlayed.length - 1
    : landsPlayed.length;

  return {
    landsInPlay: landsPlayed,
    manaAvailable,
  };
}

export function drawSampleOpeningHand(
  units: LibraryCardUnit[],
  mulliganCount = 0,
  onPlay = true
): DrawnHandReport {
  const pool = [...units];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const rawHand = pool.slice(0, 7);
  const nextDraws = pool.slice(7, 11).map((c) => ({
    ...c,
    statusLabel: c.isLand
      ? c.entersTapped
        ? 'Tapped Land'
        : 'Untapped Land'
      : `MV ${c.cmc}`,
  }));

  const isCommanderSize = units.length >= 85;
  const idealMin = 2;
  const idealMax = isCommanderSize ? 5 : 4;

  // Sort hand visually: lands first, then spells by MV
  const sortedHand = [...rawHand].sort((a, b) => {
    if (a.isLand !== b.isLand) return a.isLand ? -1 : 1;
    return a.cmc - b.cmc;
  });

  const landsInHand = sortedHand.filter((c) => c.isLand).length;
  const untappedLandsInHand = sortedHand.filter(
    (c) => c.isLand && !c.entersTapped
  ).length;
  const tappedLandsInHand = landsInHand - untappedLandsInHand;

  let keepVerdict: 'keepable' | 'risky-low' | 'risky-high' = 'keepable';
  let keepVerdictText = `Keepable ${landsInHand}-land opening 7${
    mulliganCount > 0 ? ` (put ${mulliganCount} card${mulliganCount === 1 ? '' : 's'} on bottom for London Mulligan)` : ''
  }.`;

  if (landsInHand < idealMin) {
    keepVerdict = 'risky-low';
    keepVerdictText = `Mana-light (${landsInHand} land${landsInHand === 1 ? '' : 's'}). High risk of missing Turn 2–3 land drops unless you mulligan.`;
  } else if (landsInHand > idealMax) {
    keepVerdict = 'risky-high';
    keepVerdictText = `Land-heavy (${landsInHand} lands). Low early spell density — consider a mulligan unless your commander is a mana sink.`;
  } else if (untappedLandsInHand === 0 && landsInHand > 0) {
    keepVerdictText = `${landsInHand} lands drawn, but all enter tapped — Turn 1 plays will be delayed.`;
  }

  // Check castability of spells in opening hand by Turn 3 (including Turn 1-3 draws if applicable)
  const cardsByTurn3 = onPlay ? [...rawHand, ...pool.slice(7, 9)] : [...rawHand, ...pool.slice(7, 10)];
  const landsByTurn3 = cardsByTurn3.filter((c) => c.isLand);

  const castableSpellNames = new Set<string>();
  const blockedSpellNames = new Set<string>();

  const handWithStatus: DrawnHandCard[] = sortedHand.map((card) => {
    if (card.isLand) {
      return {
        ...card,
        statusLabel: card.entersTapped ? 'Enters Tapped' : 'Untapped',
      };
    }

    const checkTurn = Math.max(1, Math.min(4, Math.ceil(card.cmc)));
    const cardsByCheckTurn = onPlay
      ? [...rawHand, ...pool.slice(7, 7 + Math.max(0, checkTurn - 1))]
      : [...rawHand, ...pool.slice(7, 7 + checkTurn)];
    const landsByCheckTurn = cardsByCheckTurn.filter((c) => c.isLand);
    const req = parseManaCostRequirement(card.manaCost, card.cmc);
    const canCastOnCurve = canSeenLandsPayAtTurn(landsByCheckTurn, checkTurn, req);

    if (card.cmc <= 3) {
      const canByT3 = canSeenLandsPayAtTurn(landsByTurn3, 3, req);
      if (canByT3) castableSpellNames.add(card.name);
      else blockedSpellNames.add(card.name);
    }

    return {
      ...card,
      statusLabel: canCastOnCurve
        ? `Castable T${checkTurn}`
        : card.cmc <= 4
        ? `Blocked T${checkTurn}`
        : `MV ${card.cmc}`,
    };
  });

  return {
    hand: handWithStatus,
    nextDraws,
    landsInHand,
    untappedLandsInHand,
    tappedLandsInHand,
    keepVerdict,
    keepVerdictText,
    castableSpellNames,
    blockedSpellNames,
  };
}

export function runOpeningHandMonteCarlo(params: {
  units: LibraryCardUnit[];
  trials?: number;
  onPlay: boolean;
  customTurn: number;
  customGeneric: number;
  customPips: ManaColor[];
}): SimulationSummary {
  const {
    units,
    trials = 2000,
    onPlay,
    customTurn,
    customGeneric,
    customPips,
  } = params;

  const n = units.length;
  const landCount = units.filter((u) => u.isLand).length;

  // Collect unique early-game non-land spells (MV 1 to 3) sorted by MV then frequency
  const earlySpellMap = new Map<
    string,
    {
      name: string;
      manaCost: string;
      cmc: number;
      quantity: number;
      req: ParsedManaRequirement;
      targetTurn: number;
      hits: number;
      meta: CardMetadata | null;
    }
  >();

  for (const u of units) {
    if (u.isLand || u.cmc > 3 || u.cmc < 0) continue;
    const key = u.name.toLowerCase();
    const existing = earlySpellMap.get(key);
    if (existing) {
      existing.quantity += 1;
    } else {
      const req = parseManaCostRequirement(u.manaCost, u.cmc);
      earlySpellMap.set(key, {
        name: u.name,
        manaCost: u.manaCost,
        cmc: u.cmc,
        quantity: 1,
        req,
        targetTurn: Math.max(1, Math.min(3, Math.ceil(req.cmc))),
        hits: 0,
        meta: u.meta,
      });
    }
  }

  const earlySpellsList = Array.from(earlySpellMap.values())
    .sort((a, b) => a.cmc - b.cmc || b.quantity - a.quantity || a.name.localeCompare(b.name))
    .slice(0, 12);

  if (n < 7) {
    return {
      trials: 0,
      librarySize: n,
      landCount,
      onPlay,
      keepablePct: 0,
      screwPct: 0,
      floodPct: 0,
      avgLandsInSeven: 0,
      turnStats: [1, 2, 3, 4].map((t) => ({
        turn: t,
        hitLandDropPct: 0,
        fullManaOnTurnPct: 0,
      })),
      earlySpells: earlySpellsList.map((s) => ({
        name: s.name,
        manaCost: s.manaCost,
        cmc: s.cmc,
        quantity: s.quantity,
        targetTurn: s.targetTurn,
        castablePct: 0,
        meta: s.meta,
      })),
      customCheckPct: 0,
    };
  }

  const maxDepth = Math.min(n, 7 + Math.max(4, customTurn) + (onPlay ? 0 : 1));
  const scratch = [...units];
  const isCommanderSize = n >= 85;
  const keepMin = 2;
  const keepMax = isCommanderSize ? 5 : 4;

  let keepableCount = 0;
  let screwCount = 0;
  let floodCount = 0;
  let totalLandsInSeven = 0;
  let customHits = 0;

  const turnLandHits = [0, 0, 0, 0];
  const turnFullManaHits = [0, 0, 0, 0];

  const customReq: ParsedManaRequirement = {
    cmc: customGeneric + customPips.length,
    generic: customGeneric,
    pips: customPips,
    hybridGroups: [],
  };

  for (let t = 0; t < trials; t++) {
    // Partial Fisher-Yates shuffle for top `maxDepth` cards
    for (let i = 0; i < maxDepth; i++) {
      const j = i + Math.floor(Math.random() * (n - i));
      const tmp = scratch[i];
      scratch[i] = scratch[j];
      scratch[j] = tmp;
    }

    let lands7 = 0;
    for (let i = 0; i < 7; i++) {
      if (scratch[i].isLand) lands7++;
    }

    totalLandsInSeven += lands7;
    if (lands7 <= 1) screwCount++;
    else if (lands7 > keepMax) floodCount++;
    else if (lands7 >= keepMin && lands7 <= keepMax) keepableCount++;

    // Evaluate Turns 1..4
    const seenLandsByTurn: LibraryCardUnit[][] = [];
    for (let turn = 1; turn <= 4; turn++) {
      const seenCount = Math.min(n, 7 + (onPlay ? turn - 1 : turn));
      const seenSlice = scratch.slice(0, seenCount);
      seenLandsByTurn.push(seenSlice.filter((c) => c.isLand));
      const state = resolveLandsAtTurn(seenSlice, turn);
      if (state.landsInPlay.length >= turn) turnLandHits[turn - 1]++;
      if (state.manaAvailable >= turn) turnFullManaHits[turn - 1]++;
    }

    // Evaluate early spells on their curve turn
    for (const sp of earlySpellsList) {
      const seenLands = seenLandsByTurn[sp.targetTurn - 1];
      if (canSeenLandsPayAtTurn(seenLands, sp.targetTurn, sp.req)) {
        sp.hits++;
      }
    }

    // Evaluate custom mana requirement at `customTurn`
    const customSeenCount = Math.min(
      n,
      7 + (onPlay ? Math.max(0, customTurn - 1) : customTurn)
    );
    const customSeenLands =
      customTurn <= 4
        ? seenLandsByTurn[customTurn - 1]
        : scratch.slice(0, customSeenCount).filter((c) => c.isLand);
    if (canSeenLandsPayAtTurn(customSeenLands, customTurn, customReq)) {
      customHits++;
    }
  }

  return {
    trials,
    librarySize: n,
    landCount,
    onPlay,
    keepablePct: Math.round((keepableCount / trials) * 100),
    screwPct: Math.round((screwCount / trials) * 100),
    floodPct: Math.round((floodCount / trials) * 100),
    avgLandsInSeven: Number((totalLandsInSeven / trials).toFixed(2)),
    turnStats: [1, 2, 3, 4].map((turn, idx) => ({
      turn,
      hitLandDropPct: Math.round((turnLandHits[idx] / trials) * 100),
      fullManaOnTurnPct: Math.round((turnFullManaHits[idx] / trials) * 100),
    })),
    earlySpells: earlySpellsList.map((s) => ({
      name: s.name,
      manaCost: s.manaCost,
      cmc: s.cmc,
      quantity: s.quantity,
      targetTurn: s.targetTurn,
      castablePct: Math.round((s.hits / trials) * 100),
      meta: s.meta,
    })),
    customCheckPct: Math.round((customHits / trials) * 100),
  };
}
