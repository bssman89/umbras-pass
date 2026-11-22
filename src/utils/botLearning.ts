import type {
  BotLearningProfile,
  BotMatchLearningInsight,
  BotMatchTelemetryRecord,
  BotOpponentConfig,
  DeckAnalysisResult,
  PlaytestResult,
  ResolvedDeckCard,
  UserBotFeedbackInput,
  WinConditionType,
} from '../types/deck';

const BOT_MEMORY_STORAGE_PREFIX = 'umbras_pass_bot_memory_v1_';
const AUTO_LEARN_SETTING_KEY = 'umbras_pass_auto_learn_bots_v1';
export const MAX_BOT_MEMORY_LIST_ITEMS = 15;
const MAX_NOTE_LENGTH = 380;

export function loadAutoLearnFromMatchesSetting(): boolean {
  try {
    if (typeof window === 'undefined') return true;
    const raw = window.localStorage.getItem(AUTO_LEARN_SETTING_KEY);
    if (raw === 'false' || raw === '0') return false;
    return true;
  } catch {
    return true;
  }
}

export function saveAutoLearnFromMatchesSetting(enabled: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AUTO_LEARN_SETTING_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage unavailability
  }
}

export const QUICK_COACHING_TAGS = [
  'Hold removal/counters for Commander',
  'Punish tapped-land or missed-land turns',
  'Target fast mana & artifact ramp early',
  'Respect board wipes before overcommitting',
  'Fix your own curve / mulligan slow hands',
  'Spread pressure & target leading rival bots',
  'Evaluate table-wide threat level accurately',
] as const;

function clampNote(text: string, maxLen = MAX_NOTE_LENGTH): string {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

export function sanitizeBotKeySlug(raw: string): string {
  const slug = (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 56) || 'bot';
}

function hashShortString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function resolveBotLearningKey(opp: BotOpponentConfig): string {
  const nameSlug = sanitizeBotKeySlug(opp.name || opp.id || 'bot');
  const isCustom =
    opp.archetype === 'Custom Decklist' || Boolean(opp.customDeckText?.trim());
  const archSlug = isCustom
    ? `custom-${hashShortString((opp.customDeckText || '').trim().toLowerCase())}`
    : sanitizeBotKeySlug(opp.archetype || 'midrange');

  const combined = `${nameSlug}__${archSlug}`
    .replace(/[^a-zA-Z0-9_\-]/g, '-')
    .slice(0, 120);
  return combined || 'bot__default';
}

export function createDefaultBotProfile(opp: BotOpponentConfig): BotLearningProfile {
  const effectiveArchetype =
    opp.customDeckText && opp.customDeckText.trim()
      ? 'Custom Decklist'
      : opp.archetype || 'Midrange';

  return {
    botKey: resolveBotLearningKey(opp),
    botName: (opp.name || 'AI Bot').trim().slice(0, 80),
    archetype: effectiveArchetype.trim().slice(0, 120),
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    closes: 0,
    botIqScore: 100,
    lastDeckFaced: '',
    lastOwnDeckSummary: effectiveArchetype.slice(0, 300),
    learnedFromFacedDecks: [],
    learnedFromOwnDecks: [],
    userFeedbackNotes: [],
    tacticalDirectives: [],
    updatedAtIso: new Date().toISOString(),
    knownPlayerThreats: [],
    observedPlayerWeaknesses: [],
    winVectorStats: { life: 0, poison: 0, commander: 0, mill: 0 },
    cumulativeStats: {
      totalDamageDealt: 0,
      totalPoisonDealt: 0,
      totalCommanderDamageDealt: 0,
      totalCardsMilled: 0,
      totalGamesFinished: 0,
    },
    recentMatchHistory: [],
  };
}

export function mergeUniqueBounded(
  existing: string[],
  additions: string[],
  maxItems = MAX_BOT_MEMORY_LIST_ITEMS
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const raw of [...additions, ...existing]) {
    const cleaned = clampNote(raw);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= maxItems) break;
  }

  return result;
}

export function buildDeckTacticalFingerprint(
  analysis: DeckAnalysisResult,
  overrideCards?: ResolvedDeckCard[]
): {
  deckLabel: string;
  summary: string;
  keyThreats: string[];
  manaVulnerabilities: string[];
} {
  const cards = overrideCards && overrideCards.length > 0 ? overrideCards : analysis.resolvedCards || [];
  const commanders = cards
    .filter((c) => c.zone === 'commander')
    .map((c) => c.name);
  const nonLands = cards.filter((c) => c.zone === 'main' && c.card && !c.card.isLand);
  const keyThreats = nonLands
    .filter((c) => (c.card?.cmc ?? 0) >= 4 || /\b(?:legendary|planeswalker)\b/i.test(c.card?.typeLine || ''))
    .sort((a, b) => (b.card?.cmc ?? 0) - (a.card?.cmc ?? 0))
    .slice(0, 4)
    .map((c) => c.name);

  const manaVulnerabilities: string[] = [];
  if (analysis.metrics.tappedLandCount >= 5) {
    manaVulnerabilities.push(`${analysis.metrics.tappedLandCount} tapped lands slow early turns`);
  }
  if (analysis.metrics.landsDelta >= 2) {
    manaVulnerabilities.push(`short ${analysis.metrics.landsDelta} lands`);
  }
  if (analysis.metrics.currentRemoval < 6) {
    manaVulnerabilities.push(`light spot removal (${analysis.metrics.currentRemoval})`);
  }

  const cmdPart = commanders.length > 0 ? `Cmdr: ${commanders.join(' & ')}` : analysis.archetype;
  const deckLabel = clampNote(`${analysis.deckName} (${cmdPart})`, 160);
  const summary = clampNote(
    `${deckLabel} · Avg MV ${analysis.metrics.averageCmcNonLand} · ${analysis.metrics.currentLands} lands (${analysis.metrics.tappedLandCount} tapped) · Key threats: ${keyThreats.join(', ') || 'Low-curve threats'}`,
    300
  );

  return {
    deckLabel,
    summary,
    keyThreats,
    manaVulnerabilities,
  };
}

export function summarizeBotOwnDeck(opp: BotOpponentConfig): string {
  if (opp.customDeckText && opp.customDeckText.trim()) {
    const lines = opp.customDeckText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^(deck|commander|sideboard|companion|maybeboard)$/i.test(l))
      .slice(0, 12);
    return clampNote(`Custom list (${lines.length}+ lines): ${lines.join(', ')}`, 300);
  }
  return clampNote(opp.archetype || 'Midrange Pod Deck', 300);
}

/**
 * Generates an accurate historical briefing for a bot from its past simulated games
 * so both AI server simulations and deterministic fallback simulations adapt precisely.
 */
export function buildBotPastPlayBriefing(
  mem: BotLearningProfile | undefined,
  currentDeckName?: string
): {
  gamesPlayed: number;
  winRatePct: number;
  lossCount: number;
  knownThreats: string[];
  manaWeaknesses: string[];
  dominantWinVector: WinConditionType | null;
  avgPoisonPerGame: number;
  avgCmdrDmgPerGame: number;
  avgMillPerGame: number;
  recentLossLessons: string[];
  rivalThreatByName: Record<string, number>;
  avgDamageToRivalsPerGame: number;
  summaryText: string;
} {
  if (!mem || mem.matchesPlayed <= 0) {
    return {
      gamesPlayed: 0,
      winRatePct: 0,
      lossCount: 0,
      knownThreats: [],
      manaWeaknesses: [],
      dominantWinVector: null,
      avgPoisonPerGame: 0,
      avgCmdrDmgPerGame: 0,
      avgMillPerGame: 0,
      recentLossLessons: [],
      rivalThreatByName: {},
      avgDamageToRivalsPerGame: 0,
      summaryText: 'No prior simulated games logged yet — establishing baseline matchup reads across the pod.',
    };
  }

  const gamesPlayed = mem.matchesPlayed;
  const lossCount = mem.losses || 0;
  const winRatePct = Math.round((mem.wins / Math.max(1, gamesPlayed)) * 100);
  const knownThreats = (mem.knownPlayerThreats || []).slice(0, 8);
  const manaWeaknesses = (mem.observedPlayerWeaknesses || []).slice(0, 4);

  const wv = mem.winVectorStats || { life: 0, poison: 0, commander: 0, mill: 0 };
  const vectorEntries: Array<[WinConditionType, number]> = [
    ['life', wv.life],
    ['poison', wv.poison],
    ['commander', wv.commander],
    ['mill', wv.mill],
  ];
  vectorEntries.sort((a, b) => b[1] - a[1]);
  const dominantWinVector = vectorEntries[0][1] > 0 ? vectorEntries[0][0] : null;

  const cum = mem.cumulativeStats;
  const avgPoisonPerGame = cum ? Number((cum.totalPoisonDealt / Math.max(1, gamesPlayed)).toFixed(1)) : 0;
  const avgCmdrDmgPerGame = cum ? Number((cum.totalCommanderDamageDealt / Math.max(1, gamesPlayed)).toFixed(1)) : 0;
  const avgMillPerGame = cum ? Number((cum.totalCardsMilled / Math.max(1, gamesPlayed)).toFixed(1)) : 0;

  // Build persistent rival-bot threat ratings from past pod matches & directives
  const rivalThreatByName: Record<string, number> = {};
  const allRecent = mem.recentMatchHistory || [];
  let totalRivalDmgLogged = 0;
  let podGamesLogged = 0;
  for (const m of allRecent) {
    if (Array.isArray(m.rivalsFaced) && m.rivalsFaced.length > 0) {
      podGamesLogged += 1;
      totalRivalDmgLogged += m.damageDealtToRivals || 0;
      for (const rName of m.rivalsFaced) {
        const key = (rName || '').trim().toLowerCase();
        if (!key) continue;
        // Bots learn that rival bots who survived/won while this bot lost are dangerous pod threats!
        const delta =
          m.outcomeForBot === 'loss'
            ? m.eliminatedBy
              ? 6
              : 4
            : m.outcomeForBot === 'close'
            ? 2
            : 1;
        rivalThreatByName[key] = Math.min(20, (rivalThreatByName[key] || 0) + delta);
      }
    }
  }
  // Also boost rival threat when tactical directives or faced lessons specifically cite a rival bot
  const combinedLessons = [
    ...(mem.tacticalDirectives || []),
    ...(mem.learnedFromFacedDecks || []),
  ];
  for (const rKey of Object.keys(rivalThreatByName)) {
    const cited = combinedLessons.some(
      (line) =>
        line.toLowerCase().includes(rKey) &&
        /eliminat|pressured|pivot|leading|rival|threat|damage/i.test(line)
    );
    if (cited) {
      rivalThreatByName[rKey] = Math.min(24, rivalThreatByName[rKey] + 5);
    }
  }
  const avgDamageToRivalsPerGame =
    podGamesLogged > 0 ? Number((totalRivalDmgLogged / podGamesLogged).toFixed(1)) : 0;

  const topRivalNames = Object.entries(rivalThreatByName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  const recentMatches = allRecent
    .filter((m) => !currentDeckName || m.playerDeckName.toLowerCase() === currentDeckName.toLowerCase())
    .slice(0, 3);
  const recentSummary =
    recentMatches.length > 0
      ? `Recent vs ${currentDeckName || 'table'}: ${recentMatches
          .map(
            (m) =>
              `${m.outcomeForBot.toUpperCase()}${m.eliminatedBy ? ` [KO:${m.eliminatedBy}]` : ''} (${m.endingBotLife} Bot HP / ${m.endingPlayerLife} Your HP / ${m.damageDealtToRivals || 0} Rival Dmg)`
          )
          .join('; ')}.`
      : '';

  const recentLossLessons = (mem.tacticalDirectives || [])
    .filter((d) => /loss|eliminat|blocker|wipe|overextend|rival|removal|pivot/i.test(d))
    .slice(0, 4);

  const summaryParts = [
    `${gamesPlayed} prior simulated game${gamesPlayed === 1 ? '' : 's'} (${mem.wins}W-${lossCount}L-${mem.closes}C, ${winRatePct}% bot win rate, IQ ${mem.botIqScore}).`,
    lossCount > 0
      ? `Experienced ${lossCount} defeat${lossCount === 1 ? '' : 's'} — hold blockers/wipes when behind and actively pressure leading rival bots as well as You.`
      : '',
    topRivalNames.length > 0
      ? `Learned rival pod threats to contest early: ${topRivalNames.join(', ')}.`
      : '',
    knownThreats.length > 0
      ? `Known player threats to answer: ${knownThreats.join(', ')}.`
      : '',
    manaWeaknesses.length > 0
      ? `Observed player vulnerabilities: ${manaWeaknesses.join(' | ')}.`
      : '',
    `Historical averages: ${avgDamageToRivalsPerGame} Rival Dmg/pod, ${avgPoisonPerGame} Poison/game, ${avgCmdrDmgPerGame} Cmdr Dmg/game, ${avgMillPerGame} Milled/game.`,
    recentSummary,
  ].filter(Boolean);

  return {
    gamesPlayed,
    winRatePct,
    lossCount,
    knownThreats,
    manaWeaknesses,
    dominantWinVector,
    avgPoisonPerGame,
    avgCmdrDmgPerGame,
    avgMillPerGame,
    recentLossLessons,
    rivalThreatByName,
    avgDamageToRivalsPerGame,
    summaryText: summaryParts.join(' '),
  };
}

export function applyMatchLearningsToBotProfiles(params: {
  existingMemory: Record<string, BotLearningProfile>;
  opponents: BotOpponentConfig[];
  result: PlaytestResult;
  analysis: DeckAnalysisResult;
}): {
  updatedMemory: Record<string, BotLearningProfile>;
  updatedProfiles: BotLearningProfile[];
} {
  const { existingMemory, opponents, result, analysis } = params;
  const fingerprint = buildDeckTacticalFingerprint(analysis);
  const nextMemory: Record<string, BotLearningProfile> = { ...existingMemory };
  const updatedProfiles: BotLearningProfile[] = [];

  const landNameSet = new Set(
    (analysis.resolvedCards || [])
      .filter((c) => c.card?.isLand)
      .map((c) => c.name.toLowerCase())
  );

  // Actual nonland cards played by player in this simulated game
  const playedNonLands = Array.from(
    new Set(
      (result.rounds || [])
        .flatMap((r) => r.cardsPlayed || [])
        .filter(
          (name) =>
            !landNameSet.has(name.toLowerCase()) &&
            !/\b(plains|island|swamp|mountain|forest|command tower|exotic orchard)\b/i.test(name)
        )
    )
  ).slice(0, 6);

  const playerHadManaStumble = (result.rounds || []).some(
    (r) => /missed land|tapped|short|screw|bottleneck|stranded/i.test(r.manaOrTempoIssue || '')
  );

  const youFinal = result.finalStats?.participants.find((p) => p.player === 'You');
  const winCondition: WinConditionType = result.finalStats?.winCondition || 'life';
  const winningPlayerLower = (result.finalStats?.winningPlayer || '').trim().toLowerCase();

  for (const opp of opponents) {
    const botKey = resolveBotLearningKey(opp);
    const current = nextMemory[botKey] || createDefaultBotProfile(opp);
    const matchingInsight: BotMatchLearningInsight | undefined = (
      Array.isArray(result.botLearnings) ? result.botLearnings : []
    ).find(
      (b) => (b?.botName || '').trim().toLowerCase() === (opp?.name || '').trim().toLowerCase()
    );

    const botFinal = (Array.isArray(result.finalStats?.participants) ? result.finalStats.participants : []).find(
      (p) => (p?.player || '').trim().toLowerCase() === (opp?.name || '').trim().toLowerCase()
    );
    const botNameLower = (opp?.name || '').trim().toLowerCase();
    const rivalNames = opponents
      .filter((o) => (o?.name || '').trim().toLowerCase() !== botNameLower)
      .map((o) => o.name);

    // Measure exact per-bot telemetry across all simulated rounds (against You AND rival bots)
    let botDamageToPlayer = 0;
    let botPoisonToPlayer = 0;
    let botCmdrToPlayer = 0;
    let botMillToPlayer = 0;
    let botDamageToRivals = 0;
    let botEliminatedInRound: number | null = null;
    let biggestAttackerAgainstBot = '';
    let biggestDamageTakenFromSingleSource = 0;
    const damageTakenBySource = new Map<string, number>();

    for (const round of Array.isArray(result.rounds) ? result.rounds : []) {
      const roundBotPlays = Array.isArray(round.botPlays) ? round.botPlays : [];
      const bp = roundBotPlays.find(
        (p) => (p?.botName || '').trim().toLowerCase() === botNameLower
      );
      if (bp) {
        const targetLower = (bp.targetParticipant || 'You').trim().toLowerCase();
        const isTargetingRival = targetLower !== 'you' && targetLower !== botNameLower;

        if (typeof bp.lifeChangeToYou === 'number' && bp.lifeChangeToYou < 0) {
          botDamageToPlayer += Math.abs(bp.lifeChangeToYou);
        } else if (!isTargetingRival && typeof bp.targetLifeDelta === 'number' && bp.targetLifeDelta < 0) {
          botDamageToPlayer += Math.abs(bp.targetLifeDelta);
        }

        if (isTargetingRival) {
          if (typeof bp.targetLifeDelta === 'number' && bp.targetLifeDelta < 0) {
            botDamageToRivals += Math.abs(bp.targetLifeDelta);
          }
          if ((bp.targetPoisonDelta ?? 0) > 0) {
            botDamageToRivals += (bp.targetPoisonDelta ?? 0) * 3;
          }
          if ((bp.targetMillAmount ?? 0) > 0) {
            botDamageToRivals += Math.round((bp.targetMillAmount ?? 0) / 2);
          }
        }

        botPoisonToPlayer += Math.max(0, bp.poisonToYou ?? (!isTargetingRival ? bp.targetPoisonDelta ?? 0 : 0));
        botCmdrToPlayer += Math.max(0, bp.commanderDamageToYou ?? (!isTargetingRival ? bp.targetCommanderDamage ?? 0 : 0));
        botMillToPlayer += Math.max(0, bp.millToYou ?? (!isTargetingRival ? bp.targetMillAmount ?? 0 : 0));

        if ((bp.damageTakenFromYou ?? 0) > 0) {
          damageTakenBySource.set(
            'You',
            (damageTakenBySource.get('You') || 0) + (bp.damageTakenFromYou ?? 0)
          );
        }
      }

      // Check damage dealt by rival bots TO this bot
      for (const otherBp of roundBotPlays) {
        const otherLower = (otherBp?.botName || '').trim().toLowerCase();
        if (!otherLower || otherLower === botNameLower) continue;
        const otherTarget = (otherBp.targetParticipant || 'You').trim().toLowerCase();
        if (otherTarget === botNameLower && typeof otherBp.targetLifeDelta === 'number' && otherBp.targetLifeDelta < 0) {
          const dmg = Math.abs(otherBp.targetLifeDelta);
          damageTakenBySource.set(otherBp.botName, (damageTakenBySource.get(otherBp.botName) || 0) + dmg);
        }
      }

      if (botEliminatedInRound === null) {
        const ps = (Array.isArray(round.participantStats) ? round.participantStats : []).find(
          (p) => (p?.player || '').trim().toLowerCase() === botNameLower
        );
        if (ps?.eliminatedBy) {
          botEliminatedInRound = round.roundNumber;
        }
      }
    }

    for (const [src, totalDmg] of damageTakenBySource.entries()) {
      if (totalDmg > biggestDamageTakenFromSingleSource) {
        biggestDamageTakenFromSingleSource = totalDmg;
        biggestAttackerAgainstBot = src;
      }
    }

    // Accurate INDIVIDUAL bot outcome (pod-aware: eliminated bots ALWAYS record a loss!)
    const isBotEliminated = Boolean(botFinal?.eliminatedBy);
    let outcomeForBot: 'win' | 'loss' | 'close';

    if (isBotEliminated) {
      outcomeForBot = 'loss';
    } else if (opponents.length <= 1) {
      outcomeForBot =
        result.outcome === 'loss' ? 'win' : result.outcome === 'win' ? 'loss' : 'close';
    } else if (result.outcome === 'loss' && winningPlayerLower === botNameLower) {
      outcomeForBot = 'win';
    } else if (result.outcome === 'win') {
      outcomeForBot = 'loss';
    } else if (
      result.outcome === 'close' &&
      (winningPlayerLower === botNameLower ||
        (!winningPlayerLower.includes('you') &&
          (botFinal?.life ?? 0) >= (youFinal?.life ?? 0)))
    ) {
      outcomeForBot = 'close';
    } else if (
      result.outcome === 'close' &&
      (botFinal?.life ?? 0) >= Math.round(result.startingLife * 0.6)
    ) {
      outcomeForBot = 'close';
    } else {
      outcomeForBot = 'loss';
    }

    const isBotWin = outcomeForBot === 'win';
    const isBotLoss = outcomeForBot === 'loss';
    const isClose = outcomeForBot === 'close';

    const facedLesson =
      matchingInsight?.lessonFromPlayerDeck ||
      `Faced ${fingerprint.deckLabel}${rivalNames.length > 0 ? ` & pod rivals (${rivalNames.join(', ')})` : ''}: ${
        playedNonLands.length > 0
          ? `saw ${playedNonLands.slice(0, 3).join(', ')}; `
          : ''
      }${
        isBotEliminated && biggestAttackerAgainstBot
          ? `eliminated via ${botFinal?.eliminatedBy} after heavy pressure from ${biggestAttackerAgainstBot}`
          : fingerprint.manaVulnerabilities.length > 0
          ? `exploit ${fingerprint.manaVulnerabilities.join(' and ')}`
          : `save interaction for ${fingerprint.keyThreats[0] || 'key engine pieces'}`
      }.`;

    const ownDeckSummary = summarizeBotOwnDeck(opp);
    const ownLesson =
      matchingInsight?.lessonFromOwnDeck ||
      `Piloting ${
        opp.customDeckText?.trim() ? 'Custom Decklist' : opp.archetype
      }: dealt ${botDamageToPlayer} dmg to You${botDamageToRivals > 0 ? `, ${botDamageToRivals} pressure to rival bots` : ''}${botPoisonToPlayer > 0 ? `, ${botPoisonToPlayer} poison` : ''}${botCmdrToPlayer > 0 ? `, ${botCmdrToPlayer} cmdr dmg` : ''}${botMillToPlayer > 0 ? `, ${botMillToPlayer} mill` : ''} (${outcomeForBot.toUpperCase()}).`;

    const tacticalAdj =
      matchingInsight?.tacticalAdjustment ||
      (isBotEliminated
        ? `Defeat lesson (${botFinal?.eliminatedBy} KO${botEliminatedInRound ? ` R${botEliminatedInRound}` : ''}): keep blockers back when pressured by ${biggestAttackerAgainstBot || 'table threats'} and save wipes/removal.`
        : isBotLoss
        ? `Loss adjustment: pivot removal onto leading threat (${winningPlayerLower && winningPlayerLower !== 'you' ? result.finalStats?.winningPlayer : playedNonLands[0] || analysis.deckName}) and avoid overextending.`
        : `Press ${
            botPoisonToPlayer >= 5
              ? 'Toxic/Infect poison clock'
              : botCmdrToPlayer >= 10
              ? 'Commander lethal clock'
              : botMillToPlayer >= 10
              ? 'Mill library lock'
              : 'combat & threat-pivoting pressure'
          } while guarding against ${fingerprint.keyThreats[0] || analysis.deckName}.`);

    const iqGain = isBotEliminated ? 15 : isBotLoss ? 13 : isClose ? 11 : 8;
    const nextIq = Math.min(2000, (current.botIqScore || 100) + iqGain);

    const newWeaknesses: string[] = [];
    if (playerHadManaStumble) {
      newWeaknesses.push(`Mana/tapped-land stumble observed vs ${analysis.deckName}`);
    }
    if ((youFinal?.poisonCounters ?? 0) >= 5) {
      newWeaknesses.push(`Vulnerable to Toxic/Infect clock vs ${opp.name}`);
    }
    if ((youFinal?.maxCommanderDamage ?? 0) >= 12) {
      newWeaknesses.push(`Takes heavy Commander damage if unblocked`);
    }
    if ((youFinal?.cardsMilledTotal ?? 0) >= 12) {
      newWeaknesses.push(`Library exposed to heavy mill attrition`);
    }
    if (
      typeof matchingInsight?.observedWeakness === 'string' &&
      matchingInsight.observedWeakness.trim()
    ) {
      newWeaknesses.unshift(matchingInsight.observedWeakness.trim().slice(0, 140));
    }

    const ggufThreats = Array.isArray(matchingInsight?.identifiedThreats)
      ? matchingInsight.identifiedThreats
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim())
          .slice(0, 5)
      : [];

    const prevWv = current.winVectorStats || { life: 0, poison: 0, commander: 0, mill: 0 };
    const nextWv = {
      life: prevWv.life + (isBotWin && (winCondition === 'life' || winCondition === 'points-lead') ? 1 : 0),
      poison: prevWv.poison + (isBotWin && winCondition === 'poison' ? 1 : 0),
      commander: prevWv.commander + (isBotWin && winCondition === 'commander' ? 1 : 0),
      mill: prevWv.mill + (isBotWin && winCondition === 'mill' ? 1 : 0),
    };

    const prevCum = current.cumulativeStats || {
      totalDamageDealt: 0,
      totalPoisonDealt: 0,
      totalCommanderDamageDealt: 0,
      totalCardsMilled: 0,
      totalGamesFinished: 0,
    };
    const nextCum = {
      totalDamageDealt: prevCum.totalDamageDealt + botDamageToPlayer + botDamageToRivals,
      totalPoisonDealt: prevCum.totalPoisonDealt + botPoisonToPlayer,
      totalCommanderDamageDealt: prevCum.totalCommanderDamageDealt + botCmdrToPlayer,
      totalCardsMilled: prevCum.totalCardsMilled + botMillToPlayer,
      totalGamesFinished: prevCum.totalGamesFinished + 1,
    };

    const matchRecord: BotMatchTelemetryRecord = {
      dateIso: new Date().toISOString(),
      playerDeckName: analysis.deckName,
      mode: result.mode,
      outcomeForBot,
      winVector: winCondition,
      roundsPlayed: result.totalRounds,
      endingPlayerLife: youFinal?.life ?? result.startingLife,
      endingBotLife: botFinal?.life ?? result.startingLife,
      poisonInflictedToPlayer: botPoisonToPlayer,
      maxCommanderDamageToPlayer: botCmdrToPlayer,
      cardsMilledToPlayer: botMillToPlayer,
      keyThreatsSeen: (ggufThreats.length > 0 ? ggufThreats : playedNonLands).slice(0, 4),
      playerManaStumbled: playerHadManaStumble,
      eliminatedBy: botFinal?.eliminatedBy ?? null,
      rivalsFaced: rivalNames,
      damageDealtToRivals: botDamageToRivals,
    };

    const updated: BotLearningProfile = {
      ...current,
      botKey,
      botName: (opp.name || current.botName || 'Bot').trim().slice(0, 80),
      archetype: (
        opp.customDeckText?.trim() ? 'Custom Decklist' : opp.archetype || current.archetype
      ).slice(0, 120),
      matchesPlayed: (current.matchesPlayed || 0) + 1,
      wins: (current.wins || 0) + (isBotWin ? 1 : 0),
      losses: (current.losses || 0) + (isBotLoss ? 1 : 0),
      closes: (current.closes || 0) + (isClose ? 1 : 0),
      botIqScore: nextIq,
      lastDeckFaced: fingerprint.deckLabel,
      lastOwnDeckSummary: ownDeckSummary,
      learnedFromFacedDecks: mergeUniqueBounded(current.learnedFromFacedDecks, [
        facedLesson,
      ]),
      learnedFromOwnDecks: mergeUniqueBounded(current.learnedFromOwnDecks, [
        ownLesson,
      ]),
      userFeedbackNotes: [...(current.userFeedbackNotes || [])].slice(
        0,
        MAX_BOT_MEMORY_LIST_ITEMS
      ),
      tacticalDirectives: mergeUniqueBounded(current.tacticalDirectives, [
        tacticalAdj,
      ]),
      knownPlayerThreats: mergeUniqueBounded(
        current.knownPlayerThreats || [],
        [...ggufThreats, ...fingerprint.keyThreats, ...playedNonLands],
        15
      ),
      observedPlayerWeaknesses: mergeUniqueBounded(
        current.observedPlayerWeaknesses || [],
        newWeaknesses,
        10
      ),
      winVectorStats: nextWv,
      cumulativeStats: nextCum,
      recentMatchHistory: [
        matchRecord,
        ...(current.recentMatchHistory || []),
      ].slice(0, 10),
      updatedAtIso: new Date().toISOString(),
    };

    nextMemory[botKey] = updated;
    updatedProfiles.push(updated);
  }

  return { updatedMemory: nextMemory, updatedProfiles };
}

export function applyUserCoachingToBotProfile(
  existingProfile: BotLearningProfile | undefined,
  opp: BotOpponentConfig,
  feedback: UserBotFeedbackInput
): BotLearningProfile {
  const base = existingProfile || createDefaultBotProfile(opp);
  const tagText = feedback.quickTags.join('; ');
  const custom = clampNote(feedback.customNote, 260);
  const ratingLabel =
    feedback.rating === 'strong'
      ? 'Strong Play'
      : feedback.rating === 'mistake'
      ? 'Tactical Mistake'
      : 'Needs Adjustment';

  const noteParts = [`[${ratingLabel}]`];
  if (tagText) noteParts.push(tagText);
  if (custom) noteParts.push(`Coach: ${custom}`);
  const combinedFeedback = clampNote(noteParts.join(' — '));

  const newDirectives: string[] = [];
  for (const tag of feedback.quickTags) {
    newDirectives.push(`User coaching directive: ${tag}.`);
  }
  if (custom) {
    newDirectives.push(`User coaching directive: ${custom}`);
  }

  const iqBonus = feedback.rating === 'strong' ? 10 : 15;

  return {
    ...base,
    botName: (opp.name || base.botName || 'Bot').trim().slice(0, 80),
    archetype: (
      opp.customDeckText?.trim() ? 'Custom Decklist' : opp.archetype || base.archetype
    ).slice(0, 120),
    botIqScore: Math.min(2000, (base.botIqScore || 100) + iqBonus),
    userFeedbackNotes: mergeUniqueBounded(base.userFeedbackNotes, [combinedFeedback]),
    tacticalDirectives: mergeUniqueBounded(base.tacticalDirectives, newDirectives),
    updatedAtIso: new Date().toISOString(),
  };
}

export interface LiveBotMatchLearningInput {
  botId: string;
  botName: string;
  archetype: string;
  customDeckText?: string;
  deckIdentitySummary: string;
  endingBotLife: number;
  eliminated: boolean;
  eliminatedReason: 'life' | 'poison' | 'commander' | 'mill' | null;
  observedUserThreats: string[];
  observedUserHabits: string[];
  adaptationHistory: string[];
  damageDealtToPlayer: number;
  damageTakenFromPlayer: number;
  damageDealtToRivals?: number;
  damageTakenFromRivals?: number;
  biggestRivalThreatName?: string;
  spellsCastCount: number;
  creaturesPlayedCount: number;
  commanderDamageDealtToYou: number;
}

export function applyLiveGameLearningsToBotProfiles(params: {
  existingMemory: Record<string, BotLearningProfile>;
  opponents: BotOpponentConfig[];
  liveBotSummaries: LiveBotMatchLearningInput[];
  playerDeckLabel: string;
  playerArchetype: string;
  playerCommanders: string[];
  mode: '1v1' | '1v2' | '1v3';
  endingPlayerLife: number;
  outcome: 'victory' | 'defeat' | 'unfinished';
  turnsPlayed: number;
}): {
  updatedMemory: Record<string, BotLearningProfile>;
  updatedProfiles: BotLearningProfile[];
} {
  const {
    existingMemory,
    opponents,
    liveBotSummaries,
    playerDeckLabel,
    playerArchetype,
    playerCommanders,
    mode,
    endingPlayerLife,
    outcome,
    turnsPlayed,
  } = params;

  const nextMemory: Record<string, BotLearningProfile> = { ...existingMemory };
  const updatedProfiles: BotLearningProfile[] = [];
  const oppById = new Map(opponents.map((o) => [o.id, o]));

  for (const summary of liveBotSummaries) {
    const opp: BotOpponentConfig = oppById.get(summary.botId) || {
      id: summary.botId,
      name: summary.botName,
      archetype: summary.archetype,
      customDeckText: summary.customDeckText,
    };
    const botKey = resolveBotLearningKey(opp);
    const current = nextMemory[botKey] || createDefaultBotProfile(opp);

    const isBotWin = outcome === 'defeat' && !summary.eliminated;
    const isBotLoss = outcome === 'victory' || summary.eliminated;
    const isClose = outcome === 'unfinished';
    const outcomeForBot: 'win' | 'loss' | 'close' = isBotWin
      ? 'win'
      : isBotLoss
      ? 'loss'
      : 'close';

    const adaptationCount = summary.adaptationHistory.length;
    const iqDelta = isBotWin
      ? 14 + Math.min(10, adaptationCount * 2)
      : isBotLoss
      ? 18 + Math.min(12, adaptationCount * 2)
      : 10 + Math.min(8, adaptationCount * 2);

    const rivalDmgDealt = summary.damageDealtToRivals ?? 0;
    const rivalDmgTaken = summary.damageTakenFromRivals ?? 0;
    const cmdSuffix =
      playerCommanders.length > 0 ? ` (${playerCommanders[0]})` : '';
    const rivalClause = summary.biggestRivalThreatName
      ? ` & rival ${summary.biggestRivalThreatName}`
      : '';
    const facedLesson = clampNote(
      `[Live ${turnsPlayed}T] Vs ${playerDeckLabel}${cmdSuffix}${rivalClause} (${playerArchetype}): ${
        summary.observedUserThreats.length > 0
          ? `tracked key plays ${summary.observedUserThreats.slice(0, 3).join(', ')}`
          : 'scouted pod curve & board pacing'
      }${rivalDmgTaken >= 6 && summary.biggestRivalThreatName ? `; rival ${summary.biggestRivalThreatName} dealt ${rivalDmgTaken} dmg` : ''}.`
    );

    const ownLesson = clampNote(
      `[Live ${turnsPlayed}T] Piloted ${summary.deckIdentitySummary}: cast ${summary.spellsCastCount} spells (${summary.creaturesPlayedCount} creatures), dealt ${summary.damageDealtToPlayer} dmg to player${
        rivalDmgDealt > 0 ? ` & ${rivalDmgDealt} dmg to rival bots` : ''
      }${summary.eliminated ? ` (KO via ${summary.eliminatedReason || 'life'})` : ''}.`
    );

    const newDirectives: string[] = [];
    if (summary.adaptationHistory.length > 0) {
      newDirectives.push(clampNote(`[Live] ${summary.adaptationHistory[0]}`));
    }
    if (rivalDmgTaken >= 8 && summary.biggestRivalThreatName) {
      newDirectives.push(
        clampNote(
          `Pod rival lesson: contest ${summary.biggestRivalThreatName} earlier — took ${rivalDmgTaken} dmg from rival bot in live pod.`
        )
      );
    }
    if (summary.damageTakenFromPlayer >= 12) {
      newDirectives.push(
        clampNote(
          `Vs ${playerDeckLabel}: hold blockers & removal earlier — took ${summary.damageTakenFromPlayer} combat dmg in live game.`
        )
      );
    }

    const winVector: WinConditionType =
      summary.eliminatedReason === 'poison'
        ? 'poison'
        : summary.eliminatedReason === 'commander'
        ? 'commander'
        : summary.eliminatedReason === 'mill'
        ? 'mill'
        : 'life';

    const prevWv = current.winVectorStats || { life: 0, poison: 0, commander: 0, mill: 0 };
    const nextWv = {
      life: prevWv.life + (isBotWin && winVector === 'life' ? 1 : 0),
      poison: prevWv.poison + (isBotWin && winVector === 'poison' ? 1 : 0),
      commander: prevWv.commander + (isBotWin && winVector === 'commander' ? 1 : 0),
      mill: prevWv.mill + (isBotWin && winVector === 'mill' ? 1 : 0),
    };

    const prevCum = current.cumulativeStats || {
      totalDamageDealt: 0,
      totalPoisonDealt: 0,
      totalCommanderDamageDealt: 0,
      totalCardsMilled: 0,
      totalGamesFinished: 0,
    };
    const nextCum = {
      totalDamageDealt: prevCum.totalDamageDealt + summary.damageDealtToPlayer + rivalDmgDealt,
      totalPoisonDealt: prevCum.totalPoisonDealt,
      totalCommanderDamageDealt:
        prevCum.totalCommanderDamageDealt + summary.commanderDamageDealtToYou,
      totalCardsMilled: prevCum.totalCardsMilled,
      totalGamesFinished: prevCum.totalGamesFinished + 1,
    };

    const rivalNames = liveBotSummaries
      .filter((other) => other.botId !== summary.botId)
      .map((other) => other.botName);

    const matchRecord: BotMatchTelemetryRecord = {
      dateIso: new Date().toISOString(),
      playerDeckName: `[Live] ${playerDeckLabel}`,
      mode,
      outcomeForBot,
      winVector,
      roundsPlayed: Math.max(1, turnsPlayed),
      endingPlayerLife,
      endingBotLife: summary.endingBotLife,
      poisonInflictedToPlayer: 0,
      maxCommanderDamageToPlayer: summary.commanderDamageDealtToYou,
      cardsMilledToPlayer: 0,
      keyThreatsSeen: summary.observedUserThreats.slice(0, 4),
      playerManaStumbled: summary.observedUserHabits.some((h) => /missed land/i.test(h)),
      eliminatedBy: summary.eliminated ? summary.eliminatedReason || 'life' : null,
      rivalsFaced: rivalNames,
      damageDealtToRivals: rivalDmgDealt,
    };

    const updated: BotLearningProfile = {
      ...current,
      botKey,
      botName: (opp.name || current.botName || 'Bot').trim().slice(0, 80),
      archetype: (
        opp.customDeckText?.trim() ? 'Custom Decklist' : opp.archetype || current.archetype
      ).slice(0, 120),
      matchesPlayed: (current.matchesPlayed || 0) + 1,
      wins: (current.wins || 0) + (isBotWin ? 1 : 0),
      losses: (current.losses || 0) + (isBotLoss ? 1 : 0),
      closes: (current.closes || 0) + (isClose ? 1 : 0),
      botIqScore: Math.min(2000, (current.botIqScore || 100) + iqDelta),
      lastDeckFaced: playerDeckLabel,
      lastOwnDeckSummary: summary.deckIdentitySummary,
      learnedFromFacedDecks: mergeUniqueBounded(current.learnedFromFacedDecks, [facedLesson]),
      learnedFromOwnDecks: mergeUniqueBounded(current.learnedFromOwnDecks, [ownLesson]),
      tacticalDirectives: mergeUniqueBounded(current.tacticalDirectives, newDirectives),
      knownPlayerThreats: mergeUniqueBounded(
        current.knownPlayerThreats || [],
        summary.observedUserThreats,
        15
      ),
      observedPlayerWeaknesses: mergeUniqueBounded(
        current.observedPlayerWeaknesses || [],
        summary.observedUserHabits,
        10
      ),
      winVectorStats: nextWv,
      cumulativeStats: nextCum,
      recentMatchHistory: [matchRecord, ...(current.recentMatchHistory || [])].slice(0, 10),
      updatedAtIso: new Date().toISOString(),
    };

    nextMemory[botKey] = updated;
    updatedProfiles.push(updated);
  }

  return { updatedMemory: nextMemory, updatedProfiles };
}

export function mergeAiLearningsIntoLiveProfiles(params: {
  existingMemory: Record<string, BotLearningProfile>;
  opponents: BotOpponentConfig[];
  aiLearnings: BotMatchLearningInsight[];
  aiModelLabel?: string;
}): {
  updatedMemory: Record<string, BotLearningProfile>;
  updatedProfiles: BotLearningProfile[];
} {
  const { existingMemory, opponents, aiLearnings, aiModelLabel } = params;
  if (!Array.isArray(aiLearnings) || aiLearnings.length === 0) {
    return { updatedMemory: existingMemory, updatedProfiles: [] };
  }

  const nextMemory: Record<string, BotLearningProfile> = { ...existingMemory };
  const updatedProfiles: BotLearningProfile[] = [];
  const engineTag = aiModelLabel ? `[${aiModelLabel}] ` : '[AI] ';

  for (const opp of opponents) {
    const botKey = resolveBotLearningKey(opp);
    const current = nextMemory[botKey];
    if (!current) continue;
    const oppLower = (opp.name || '').trim().toLowerCase();
    const insight = aiLearnings.find(
      (b) => (b?.botName || '').trim().toLowerCase() === oppLower
    );
    if (!insight) continue;

    const newFaced = insight.lessonFromPlayerDeck
      ? [clampNote(`${engineTag}${insight.lessonFromPlayerDeck}`)]
      : [];
    const newOwn = insight.lessonFromOwnDeck
      ? [clampNote(`${engineTag}${insight.lessonFromOwnDeck}`)]
      : [];
    const newDirectives = [
      ...(insight.tacticalAdjustment
        ? [clampNote(`${engineTag}${insight.tacticalAdjustment}`)]
        : []),
      ...(insight.adaptationSummary
        ? [clampNote(`${engineTag}${insight.adaptationSummary}`)]
        : []),
    ];
    const newThreats = Array.isArray(insight.identifiedThreats)
      ? insight.identifiedThreats.filter(
          (t): t is string => typeof t === 'string' && t.trim().length > 0
        )
      : [];
    const newWeaknesses = insight.observedWeakness
      ? [clampNote(insight.observedWeakness, 160)]
      : [];

    const enriched: BotLearningProfile = {
      ...current,
      botIqScore: Math.min(2000, (current.botIqScore || 100) + 4),
      learnedFromFacedDecks: mergeUniqueBounded(current.learnedFromFacedDecks, newFaced),
      learnedFromOwnDecks: mergeUniqueBounded(current.learnedFromOwnDecks, newOwn),
      tacticalDirectives: mergeUniqueBounded(current.tacticalDirectives, newDirectives),
      knownPlayerThreats: mergeUniqueBounded(
        current.knownPlayerThreats || [],
        newThreats,
        15
      ),
      observedPlayerWeaknesses: mergeUniqueBounded(
        current.observedPlayerWeaknesses || [],
        newWeaknesses,
        10
      ),
      updatedAtIso: new Date().toISOString(),
    };

    nextMemory[botKey] = enriched;
    updatedProfiles.push(enriched);
  }

  return { updatedMemory: nextMemory, updatedProfiles };
}

function isBotSessionOnlyMode(): boolean {
  try {
    return window.localStorage.getItem('umbras_pass_auth_persistence_v1') === 'session';
  } catch {
    return false;
  }
}

function getBotStorageForScope(userScopeKey: string): {
  storage: Storage;
  storageKey: string;
} {
  const safeScope = (userScopeKey || 'guest').replace(/[^a-zA-Z0-9_\-]/g, '_');
  const isAuthenticatedUser = safeScope.startsWith('uid_');
  const useSessionOnly = !isAuthenticatedUser || isBotSessionOnlyMode();
  const storageKey = `${BOT_MEMORY_STORAGE_PREFIX}${safeScope}`;

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

export function migrateBotMemoryScopeToSessionStorage(userScopeKey: string): void {
  if (!userScopeKey || !userScopeKey.startsWith('uid_')) return;
  const safeScope = userScopeKey.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const key = `${BOT_MEMORY_STORAGE_PREFIX}${safeScope}`;
  try {
    const localData = window.localStorage.getItem(key);
    if (localData) {
      window.sessionStorage.setItem(key, localData);
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage unavailability
  }
}

export function loadUserBotMemory(
  userScopeKey: string
): Record<string, BotLearningProfile> {
  try {
    const { storage, storageKey } = getBotStorageForScope(userScopeKey);
    const raw = storage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, BotLearningProfile>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

export function persistUserBotMemory(
  userScopeKey: string,
  memory: Record<string, BotLearningProfile>
): void {
  try {
    const { storage, storageKey } = getBotStorageForScope(userScopeKey);
    const entries = Object.entries(memory);
    if (entries.length === 0) {
      storage.removeItem(storageKey);
      return;
    }
    storage.setItem(storageKey, JSON.stringify(memory));
  } catch {
    // Ignore storage quota errors
  }
}

export function purgeUserBotMemory(userScopeKey: string): void {
  const safeScope = (userScopeKey || '').replace(/[^a-zA-Z0-9_\-]/g, '_');
  if (!safeScope) return;
  try {
    window.localStorage.removeItem(`${BOT_MEMORY_STORAGE_PREFIX}${safeScope}`);
    window.sessionStorage.removeItem(`${BOT_MEMORY_STORAGE_PREFIX}${safeScope}`);
  } catch {
    // Ignore storage errors
  }
}

export function mergeLocalAndCloudBotMemory(
  localMemory: Record<string, BotLearningProfile>,
  cloudProfiles: BotLearningProfile[]
): Record<string, BotLearningProfile> {
  const merged: Record<string, BotLearningProfile> = { ...localMemory };
  for (const cp of cloudProfiles) {
    const existing = merged[cp.botKey];
    if (!existing) {
      merged[cp.botKey] = cp;
    } else {
      const existingTime = new Date(existing.updatedAtIso || 0).getTime();
      const cloudTime = new Date(cp.updatedAtIso || 0).getTime();
      const winner = cloudTime >= existingTime ? cp : existing;
      const loser = cloudTime >= existingTime ? existing : cp;
      merged[cp.botKey] = {
        ...winner,
        matchesPlayed: Math.max(winner.matchesPlayed, loser.matchesPlayed),
        botIqScore: Math.max(winner.botIqScore, loser.botIqScore),
        learnedFromFacedDecks: mergeUniqueBounded(
          winner.learnedFromFacedDecks,
          loser.learnedFromFacedDecks
        ),
        learnedFromOwnDecks: mergeUniqueBounded(
          winner.learnedFromOwnDecks,
          loser.learnedFromOwnDecks
        ),
        userFeedbackNotes: mergeUniqueBounded(
          winner.userFeedbackNotes,
          loser.userFeedbackNotes
        ),
        tacticalDirectives: mergeUniqueBounded(
          winner.tacticalDirectives,
          loser.tacticalDirectives
        ),
        knownPlayerThreats: mergeUniqueBounded(
          winner.knownPlayerThreats || [],
          loser.knownPlayerThreats || []
        ),
        observedPlayerWeaknesses: mergeUniqueBounded(
          winner.observedPlayerWeaknesses || [],
          loser.observedPlayerWeaknesses || []
        ),
      };
    }
  }
  return merged;
}
