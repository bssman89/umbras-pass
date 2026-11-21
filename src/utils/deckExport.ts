import type {
  CardMetadata,
  DeckAnalysisResult,
  DeckExportSimulationStats,
  LiveSimulationExportStats,
  PlaytestResult,
} from '../types/deck';
import {
  addMapCardCount,
  consolidateResolvedDeckCards,
  findMatchingCardMapKey,
  getMapCardCount,
  getMaxCopiesForCard,
  isSameCardName,
  normalizeDeckCardKey,
} from './deckRules';

export interface ExportDeckEntry {
  name: string;
  qty: number;
  zone: 'Commander' | 'Companion' | 'Main' | 'Sideboard';
  isLand: boolean;
  setCode?: string;
  meta?: CardMetadata | null;
}

export interface ComputedOptimizedDeck {
  exportText: string;
  deckOnlyExportText: string;
  exportCsv: string;
  totalMainCount: number;
  resultingLandCount: number;
  commanderNames: string[];
  entries: ExportDeckEntry[];
  hasSimulationStats: boolean;
  simulationSummaryLines: string[];
}

function escapeCsvField(value: string | number | undefined | null): string {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface ExtraSwapSpec {
  cutCardName: string;
  addCardName: string;
  quantity: number;
  addMeta?: CardMetadata | null;
}

function formatDurationShortMs(ms: number): string {
  const safeMs = Math.max(0, ms);
  if (safeMs < 60_000) return `${(safeMs / 1000).toFixed(1)}s`;
  const totalSec = Math.round(safeMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export function isLiveSessionStatsMeaningful(
  live?: LiveSimulationExportStats | null
): boolean {
  if (!live) return false;
  return (
    live.turnsPassed > 0 ||
    live.cardsDrawn > 0 ||
    live.turn > 1 ||
    live.landsInPlay > 0 ||
    live.creaturesInPlay > 0 ||
    live.yourLife !== live.startingLife ||
    live.yourPoison > 0 ||
    live.outcome !== 'in-progress'
  );
}

export function buildSimulationStatEntries(
  simulationStats?: DeckExportSimulationStats | null
): Array<{ label: string; value: string }> {
  const entries: Array<{ label: string; value: string }> = [];
  const botMatch: PlaytestResult | null | undefined = simulationStats?.botMatchResult;
  const live: LiveSimulationExportStats | null | undefined =
    isLiveSessionStatsMeaningful(simulationStats?.liveSessionStats)
      ? simulationStats?.liveSessionStats
      : null;

  if (botMatch) {
    const outcomeText =
      botMatch.outcome === 'win'
        ? 'Victory'
        : botMatch.outcome === 'loss'
        ? 'Defeat'
        : 'Close Match';
    const winVectorText = botMatch.finalStats?.winCondition
      ? botMatch.finalStats.winCondition === 'poison'
        ? '10+ Poison'
        : botMatch.finalStats.winCondition === 'commander'
        ? '21+ Commander Damage'
        : botMatch.finalStats.winCondition === 'mill'
        ? 'Library Milled'
        : botMatch.finalStats.winCondition === 'life'
        ? '0 Life Elimination'
        : 'Clock Lead'
      : '';
    const youFinal = botMatch.finalStats?.participants.find(
      (p) => (p.player || '').trim().toLowerCase() === 'you'
    );
    const lastRound =
      Array.isArray(botMatch.rounds) && botMatch.rounds.length > 0
        ? botMatch.rounds[botMatch.rounds.length - 1]
        : null;

    entries.push({
      label: 'Bot Match Result',
      value: `${outcomeText} (${botMatch.mode}, ${botMatch.totalRounds} rounds · List: ${botMatch.testedListLabel})`,
    });
    if (botMatch.finalStats?.winningPlayer || winVectorText) {
      entries.push({
        label: 'Match Winner & Vector',
        value: `${botMatch.finalStats?.winningPlayer || '—'}${winVectorText ? ` via ${winVectorText}` : ''}`,
      });
    }
    const endingLife = youFinal?.life ?? botMatch.startingLife;
    const endingLands = youFinal?.landsInPlay ?? lastRound?.landsInPlay ?? 0;
    const endingCreatures =
      youFinal?.creaturesInPlay ?? lastRound?.playerStats?.creaturesOnBoard ?? 0;
    const endingHand = youFinal?.handSize ?? lastRound?.handSnapshot?.length ?? 0;
    const endingLib = youFinal?.libraryRemaining ?? lastRound?.libraryRemaining ?? 0;
    entries.push({
      label: 'Bot Match Final Board',
      value: `Your Life ${endingLife}/${botMatch.startingLife} HP · ${endingLands} Lands · ${endingCreatures} Creatures · ${endingHand} Hand · ${endingLib} Lib`,
    });
    if (youFinal && (youFinal.poisonCounters > 0 || youFinal.maxCommanderDamage > 0)) {
      entries.push({
        label: 'Bot Match Damage Counters',
        value: `Poison ${youFinal.poisonCounters}/10 · Max Cmdr Taken ${youFinal.maxCommanderDamage}/21`,
      });
    }
    if (botMatch.mulliganVerdict) {
      entries.push({
        label: 'Opening Hand Verdict',
        value: botMatch.mulliganVerdict,
      });
    }
    if (Array.isArray(botMatch.openingHand) && botMatch.openingHand.length > 0) {
      entries.push({
        label: 'Opening 7 Cards',
        value: botMatch.openingHand.join(', '),
      });
    }
    if (botMatch.finalStats?.participants && botMatch.finalStats.participants.length > 1) {
      const oppSummary = botMatch.finalStats.participants
        .filter((p) => (p.player || '').trim().toLowerCase() !== 'you')
        .map(
          (p) =>
            `${p.player}: ${p.life} HP${p.eliminatedBy ? ` [KO: ${p.eliminatedBy}]` : ''}`
        )
        .join(' | ');
      if (oppSummary) {
        entries.push({
          label: 'Bot Match Standings',
          value: oppSummary,
        });
      }
    }
  }

  if (live) {
    const liveStatus =
      live.outcome === 'victory'
        ? 'Victory'
        : live.outcome === 'defeat'
        ? 'Defeat'
        : live.outcome === 'manual-end'
        ? 'Completed'
        : 'In Progress';
    const modeLabel = live.liveBotMode ? `${live.mode} vs AI Bots` : 'Solo Goldfish';
    entries.push({
      label: 'Live Play Session',
      value: `${liveStatus} (${modeLabel} · Turn ${live.turn} · ${live.activePhase} · List: ${live.testedListLabel})`,
    });
    entries.push({
      label: 'Live Play Board & Tempo',
      value: `${live.yourLife}/${live.startingLife} HP · ${live.landsInPlay} Lands · ${live.creaturesInPlay} Creatures · ${live.handSize} Hand · ${live.libraryRemaining} Lib · ${live.cardsDrawn} Extra Draws · ${live.turnsPassed} Turns Passed`,
    });
    if (live.turnsTimed > 0) {
      entries.push({
        label: 'Live Turn Timer',
        value: `Avg ${formatDurationShortMs(live.avgTurnDurationMs)} / turn (${formatDurationShortMs(live.totalTurnTimeMs)} across ${live.turnsTimed} timed turn${live.turnsTimed === 1 ? '' : 's'})`,
      });
    }
    if (live.liveBotMode && live.opponents.length > 0) {
      entries.push({
        label: 'Live Pod Opponents',
        value: live.opponents
          .map((o) => `${o.name}: ${o.life} HP${o.eliminated ? ' [KO]' : ''}`)
          .join(' | '),
      });
    }
  }

  return entries;
}

export function buildOptimizedDeckExport(
  analysis: DeckAnalysisResult,
  selectedSwapIds: Set<string>,
  selectedCutIds: Set<string>,
  selectedAddIds: Set<string>,
  selectedLandChangeIds: Set<string>,
  extraSwaps: ExtraSwapSpec[] = [],
  simulationStats?: DeckExportSimulationStats | null,
  includeSimulationStats = true,
  balanceOverflowToTarget = false
): ComputedOptimizedDeck {
  const detectedFormat = analysis?.metrics?.detectedFormat;
  const consolidatedCards = consolidateResolvedDeckCards(
    analysis?.resolvedCards ?? [],
    detectedFormat
  );

  const commanders: ExportDeckEntry[] = [];
  const companions: ExportDeckEntry[] = [];
  const sideboardMap = new Map<string, ExportDeckEntry>();
  const mainMap = new Map<string, ExportDeckEntry>();
  const cmdAndCompCounts = new Map<string, number>();

  for (const card of consolidatedCards) {
    if (card.zone === 'commander') {
      commanders.push({
        name: card.name,
        qty: card.quantity,
        zone: 'Commander',
        isLand: Boolean(card.card?.isLand),
        setCode: card.setCode,
        meta: card.card,
      });
      addMapCardCount(cmdAndCompCounts, card.name, card.quantity);
    } else if (card.zone === 'companion') {
      companions.push({
        name: card.name,
        qty: card.quantity,
        zone: 'Companion',
        isLand: Boolean(card.card?.isLand),
        setCode: card.setCode,
        meta: card.card,
      });
      addMapCardCount(cmdAndCompCounts, card.name, card.quantity);
    } else if (card.zone === 'sideboard') {
      const existingKey = findMatchingCardMapKey(sideboardMap, card.name);
      if (existingKey) {
        sideboardMap.get(existingKey)!.qty += card.quantity;
      } else {
        const key = normalizeDeckCardKey(card.name);
        if (key) {
          sideboardMap.set(key, {
            name: card.name,
            qty: card.quantity,
            zone: 'Sideboard',
            isLand: Boolean(card.card?.isLand),
            setCode: card.setCode,
            meta: card.card,
          });
        }
      }
    } else if (card.zone === 'main') {
      const existingKey = findMatchingCardMapKey(mainMap, card.name);
      if (existingKey) {
        const existing = mainMap.get(existingKey)!;
        existing.qty += card.quantity;
        if (!existing.meta && card.card) existing.meta = card.card;
      } else {
        const key = normalizeDeckCardKey(card.name);
        if (key) {
          mainMap.set(key, {
            name: card.name,
            qty: card.quantity,
            zone: 'Main',
            isLand: Boolean(card.card?.isLand),
            setCode: card.setCode,
            meta: card.card,
          });
        }
      }
    }
  }

  const getMainCardCount = (name: string): number => {
    const existingKey = findMatchingCardMapKey(mainMap, name);
    return existingKey ? mainMap.get(existingKey)?.qty || 0 : 0;
  };

  const getAddHeadroom = (name: string, metaHint?: CardMetadata | null): number => {
    const existingKey = findMatchingCardMapKey(mainMap, name);
    const existing = existingKey ? mainMap.get(existingKey) : undefined;
    const effectiveMeta = existing?.meta ?? metaHint ?? null;
    const maxCopies = getMaxCopiesForCard(name, detectedFormat, effectiveMeta);
    if (!Number.isFinite(maxCopies)) return Number.POSITIVE_INFINITY;
    const currentTotal =
      getMapCardCount(cmdAndCompCounts, name) + (existing?.qty || 0);
    return Math.max(0, maxCopies - currentTotal);
  };

  const adjustCard = (
    name: string,
    delta: number,
    isLandHint = false,
    metaHint?: CardMetadata | null
  ) => {
    if (typeof name !== 'string' || !name.trim() || !Number.isFinite(delta) || delta === 0) {
      return;
    }
    const existingKey = findMatchingCardMapKey(mainMap, name);
    const existing = existingKey ? mainMap.get(existingKey) : undefined;

    if (delta < 0) {
      if (!existing || !existingKey) return;
      existing.qty += delta;
      if (!existing.meta && metaHint) existing.meta = metaHint;
      if (existing.qty <= 0) mainMap.delete(existingKey);
      return;
    }

    const headroom = getAddHeadroom(name, metaHint);
    const appliedDelta = Math.min(delta, headroom);
    if (appliedDelta <= 0) return;

    if (existing) {
      existing.qty += appliedDelta;
      if (!existing.meta && metaHint) existing.meta = metaHint;
      if (!existing.isLand && isLandHint) existing.isLand = true;
    } else {
      const key = normalizeDeckCardKey(name);
      if (!key) return;
      mainMap.set(key, {
        name: metaHint?.name || name.trim(),
        qty: appliedDelta,
        zone: 'Main',
        isLand: isLandHint || Boolean(metaHint?.isLand),
        meta: metaHint ?? null,
      });
    }
  };

  for (const swap of analysis?.swaps ?? []) {
    if (!selectedSwapIds.has(swap.id)) continue;
    if (isSameCardName(swap.cutCardName, swap.addCardName)) continue;
    const cutAvail = getMainCardCount(swap.cutCardName);
    const addRoom = getAddHeadroom(swap.addCardName, swap.addCardMeta);
    const qty = Math.min(Math.max(1, swap.quantity || 1), cutAvail, addRoom);
    if (qty <= 0) continue;
    adjustCard(swap.cutCardName, -qty);
    adjustCard(
      swap.addCardName,
      qty,
      Boolean(swap.addCardMeta?.isLand),
      swap.addCardMeta
    );
  }

  for (const extra of extraSwaps ?? []) {
    const requestedQty = Math.max(1, extra.quantity || 1);
    const cutAvail = getMainCardCount(extra.cutCardName);
    if (!extra.addCardName || !extra.addCardName.trim()) {
      const cutQty = Math.min(requestedQty, cutAvail);
      if (cutQty > 0) adjustCard(extra.cutCardName, -cutQty);
      continue;
    }
    if (isSameCardName(extra.cutCardName, extra.addCardName)) continue;
    const addRoom = getAddHeadroom(extra.addCardName, extra.addMeta);
    const qty = Math.min(requestedQty, cutAvail, addRoom);
    if (qty <= 0) continue;
    adjustCard(extra.cutCardName, -qty);
    adjustCard(
      extra.addCardName,
      qty,
      Boolean(extra.addMeta?.isLand),
      extra.addMeta
    );
  }

  for (const cut of analysis?.cuts ?? []) {
    if (!selectedCutIds.has(cut.id)) continue;
    adjustCard(cut.cardName, -Math.max(1, cut.quantity || 1));
  }

  for (const add of analysis?.additions ?? []) {
    if (!selectedAddIds.has(add.id)) continue;
    adjustCard(
      add.cardName,
      Math.max(1, add.quantity || 1),
      add.role === 'Land' || Boolean(add.cardMeta?.isLand),
      add.cardMeta
    );
  }

  for (const lc of analysis?.manaPlan?.landChanges ?? []) {
    if (!selectedLandChangeIds.has(lc.id)) continue;
    const qty = Math.max(1, lc.quantity || 1);
    if (lc.action === 'cut') {
      adjustCard(lc.cardName, -qty, true, lc.cardMeta);
    } else {
      adjustCard(
        lc.cardName,
        qty,
        Boolean(lc.cardMeta?.isLand) ||
          /plains|island|swamp|mountain|forest|wastes|tower|land|gate|crypt|pool|fountain|grave|garden|shrine|foundry|vents|sanctum|passage|wilds|expanse|delta|strand|mire|foothills|heath|flats|tarn|catacombs|mesa|rainforest|vista|triome|tomb|sewers|parlor|archive|theatre/i.test(
            lc.cardName
          ),
        lc.cardMeta
      );
    }
  }

  // Optional overflow guard (used by mana-only playtest export so adding lands never pushes deck over format target size)
  const targetDeckSize = analysis?.metrics?.targetDeckSize;
  if (balanceOverflowToTarget && typeof targetDeckSize === 'number' && targetDeckSize > 0) {
    const cmdQty = commanders.reduce((sum, c) => sum + c.qty, 0);
    const currentMainQty = Array.from(mainMap.values()).reduce((sum, e) => sum + e.qty, 0);
    let overflow = cmdQty + currentMainQty - targetDeckSize;

    // 1. Prefer applying recommended cuts from analysis.cuts first
    if (overflow > 0) {
      for (const cut of analysis?.cuts ?? []) {
        if (overflow <= 0) break;
        if (selectedCutIds.has(cut.id)) continue;
        const avail = getMainCardCount(cut.cardName);
        const take = Math.min(avail, Math.max(1, cut.quantity || 1), overflow);
        if (take > 0) {
          adjustCard(cut.cardName, -take);
          overflow -= take;
        }
      }
    }

    // 2. If still over, trim highest-CMC non-land maindeck entries
    if (overflow > 0) {
      const nonLandEntries = Array.from(mainMap.values())
        .filter((e) => !e.isLand)
        .sort((a, b) => (b.meta?.cmc ?? 3) - (a.meta?.cmc ?? 3));
      for (const entry of nonLandEntries) {
        if (overflow <= 0) break;
        const take = Math.min(entry.qty, overflow);
        if (take > 0) {
          adjustCard(entry.name, -take);
          overflow -= take;
        }
      }
    }
  }

  const sideboard = Array.from(sideboardMap.values());
  const mainEntries = Array.from(mainMap.values()).sort((a, b) => {
    if (a.isLand !== b.isLand) return a.isLand ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  const textLines: string[] = [];
  if (commanders.length > 0) {
    textLines.push('Commander');
    for (const c of commanders) textLines.push(`${c.qty} ${c.name}`);
    textLines.push('');
  }
  if (companions.length > 0) {
    textLines.push('Companion');
    for (const c of companions) textLines.push(`${c.qty} ${c.name}`);
    textLines.push('');
  }
  textLines.push('Deck');
  for (const entry of mainEntries) {
    textLines.push(`${entry.qty} ${entry.name}`);
  }
  if (sideboard.length > 0) {
    textLines.push('', 'Sideboard');
    for (const s of sideboard) textLines.push(`${s.qty} ${s.name}`);
  }

  const allEntries = [...commanders, ...companions, ...mainEntries, ...sideboard];

  const simStatEntries = buildSimulationStatEntries(simulationStats);
  const simulationSummaryLines = simStatEntries.map(
    (item) => `${item.label}: ${item.value}`
  );

  const deckOnlyExportText = textLines.join('\n');

  if (includeSimulationStats && simulationSummaryLines.length > 0) {
    textLines.push('', '// === Simulation & Playtest Stats ===');
    for (const line of simulationSummaryLines) {
      textLines.push(`// ${line}`);
    }
  }

  const csvRows = [
    'Count,Name,Section,Set Code,Type,Mana Cost,Mana Value',
    ...allEntries.map((entry) =>
      [
        escapeCsvField(entry.qty),
        escapeCsvField(entry.name),
        escapeCsvField(entry.zone),
        escapeCsvField(entry.setCode || ''),
        escapeCsvField(entry.meta?.typeLine || ''),
        escapeCsvField(entry.meta?.manaCost || ''),
        escapeCsvField(entry.meta ? entry.meta.cmc : ''),
      ].join(',')
    ),
  ];

  if (includeSimulationStats && simStatEntries.length > 0) {
    csvRows.push('');
    csvRows.push('Simulation Metric,Value,Section,Set Code,Type,Mana Cost,Mana Value');
    for (const stat of simStatEntries) {
      csvRows.push(
        [
          escapeCsvField(stat.label),
          escapeCsvField(stat.value),
          escapeCsvField('Simulation Stats'),
          '',
          '',
          '',
          '',
        ].join(',')
      );
    }
  }

  const cmdCount = commanders.reduce((sum, c) => sum + c.qty, 0);
  const mainCount = mainEntries.reduce((sum, e) => sum + e.qty, 0);
  const landCount = mainEntries.filter((e) => e.isLand).reduce((sum, e) => sum + e.qty, 0);

  return {
    exportText: textLines.join('\n'),
    deckOnlyExportText,
    exportCsv: csvRows.join('\n'),
    totalMainCount: cmdCount + mainCount,
    resultingLandCount: landCount,
    commanderNames: commanders.map((c) => c.name),
    entries: allEntries,
    hasSimulationStats: simStatEntries.length > 0,
    simulationSummaryLines,
  };
}

export function downloadDeckFile(
  content: string,
  deckName: string,
  extension: 'txt' | 'csv'
): void {
  const mimeType =
    extension === 'csv'
      ? 'text/csv;charset=utf-8'
      : 'text/plain;charset=utf-8';
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (deckName || 'optimized-deck')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  a.href = url;
  a.download = `${safeName || 'optimized-deck'}.${extension}`;
  a.click();
  URL.revokeObjectURL(url);
}
