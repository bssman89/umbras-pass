import type {
  DeckAnalysisResult,
  PlaytestResult,
  PlaytestRound,
  RoundDeckChange,
} from '../types/deck';

export type ManaIssueTag =
  | 'missed-land'
  | 'color-screw'
  | 'tapped-slow'
  | 'ramp-needed'
  | 'mana-flood';

export interface ManaTagMeta {
  id: ManaIssueTag;
  label: string;
  shortLabel: string;
  description: string;
}

export const MANA_ISSUE_TAGS: ManaTagMeta[] = [
  {
    id: 'missed-land',
    label: 'Missed Land Drop',
    shortLabel: 'Missed Land',
    description: 'Stuck below curve because you missed a land drop this turn.',
  },
  {
    id: 'color-screw',
    label: 'Missing Color Pip',
    shortLabel: 'Color Screw',
    description: 'Had mana available, but lacked the right colored sources to cast spells.',
  },
  {
    id: 'tapped-slow',
    label: 'Tapped Land Slowdown',
    shortLabel: 'Tapped Slow',
    description: 'An enters-tapped land delayed your play by a full turn.',
  },
  {
    id: 'ramp-needed',
    label: 'Insufficient Ramp',
    shortLabel: 'Need Ramp',
    description: 'Fell behind opponents on mana development and needed acceleration.',
  },
  {
    id: 'mana-flood',
    label: 'Mana Flood / Dead Lands',
    shortLabel: 'Mana Flood',
    description: 'Drew excess lands with too few payoffs or card draw.',
  },
];

export function getManaTagMeta(tag: ManaIssueTag): ManaTagMeta {
  return MANA_ISSUE_TAGS.find((t) => t.id === tag) || MANA_ISSUE_TAGS[0];
}

/**
 * Inspects a round's real lands-in-play progression and mana/tempo text
 * to suggest an appropriate mana underperformance tag when the user clicks
 * "Auto-tag Stalled Turns".
 */
export function detectRoundManaTag(
  round: PlaytestRound,
  prevRound?: PlaytestRound
): ManaIssueTag | null {
  const changeReasons = round.roundChanges
    .map((c) => `${c.action} ${c.cutCardName || ''} ${c.addCardName || ''} ${c.reason}`)
    .join(' ')
    .toLowerCase();
  const issue = `${round.manaOrTempoIssue || ''} ${changeReasons}`.toLowerCase();
  const prevLands = prevRound ? prevRound.landsInPlay : 0;
  const missedLandDrop =
    round.roundNumber <= 5 && round.landsInPlay <= prevLands;

  if (
    issue.includes('color') ||
    issue.includes('pip') ||
    issue.includes('fixing') ||
    issue.includes('double-')
  ) {
    return 'color-screw';
  }
  if (issue.includes('tapped') || issue.includes('slow land')) {
    return 'tapped-slow';
  }
  if (issue.includes('flood') || issue.includes('too many lands')) {
    return 'mana-flood';
  }
  if (
    missedLandDrop ||
    issue.includes('missed land') ||
    issue.includes('land drop') ||
    issue.includes('mana screw') ||
    issue.includes('stuck on')
  ) {
    return 'missed-land';
  }
  if (
    issue.includes('ramp') ||
    issue.includes('mana rock') ||
    issue.includes('behind on mana') ||
    issue.includes('expensive') ||
    issue.includes('curve')
  ) {
    return 'ramp-needed';
  }
  if (round.cardsPlayed.length === 0 && round.roundNumber <= 4) {
    return 'missed-land';
  }
  return null;
}

export function autoTagPlaytestRounds(
  result: PlaytestResult
): Record<number, ManaIssueTag> {
  const tags: Record<number, ManaIssueTag> = {};
  const safeRounds = Array.isArray(result?.rounds) ? result.rounds : [];
  safeRounds.forEach((round, idx) => {
    const prev = idx > 0 ? safeRounds[idx - 1] : undefined;
    const detected = detectRoundManaTag(round, prev);
    if (detected) {
      tags[round.roundNumber] = detected;
    }
  });
  return tags;
}

export interface CorrelatedAnalyzerFinding {
  tag: ManaIssueTag;
  tagLabel: string;
  taggedRounds: number[];
  diagnosticTitle: string;
  diagnosticDetail: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface CorrelatedCardAction {
  key: string;
  source: 'Mana Plan' | 'Analyzer Swap' | 'Analyzer Add' | 'Round Fix';
  action: 'add' | 'cut' | 'swap';
  cutCardName?: string;
  addCardName?: string;
  reason: string;
  matchedTags: ManaIssueTag[];
  matchedRounds: number[];
}

export function buildManaCorrelationReport(
  analysis: DeckAnalysisResult,
  result: PlaytestResult,
  manaTagsByRound: Record<number, ManaIssueTag | undefined>
): {
  taggedEntries: Array<{ round: PlaytestRound; tag: ManaIssueTag }>;
  findings: CorrelatedAnalyzerFinding[];
  correlatedCards: CorrelatedCardAction[];
} {
  const taggedEntries: Array<{ round: PlaytestRound; tag: ManaIssueTag }> = [];
  for (const round of result?.rounds || []) {
    const tag = manaTagsByRound[round.roundNumber];
    if (tag) {
      taggedEntries.push({ round, tag });
    }
  }

  if (taggedEntries.length === 0) {
    return { taggedEntries: [], findings: [], correlatedCards: [] };
  }

  // Group tagged round numbers by ManaIssueTag
  const roundsByTag = new Map<ManaIssueTag, number[]>();
  for (const { round, tag } of taggedEntries) {
    const list = roundsByTag.get(tag) || [];
    list.push(round.roundNumber);
    roundsByTag.set(tag, list);
  }

  const metrics = analysis?.metrics;
  const manaPlan = analysis?.manaPlan;
  const findings: CorrelatedAnalyzerFinding[] = [];

  if (roundsByTag.has('missed-land')) {
    const rNums = roundsByTag.get('missed-land')!;
    const missing = metrics?.landsDelta ?? 0;
    findings.push({
      tag: 'missed-land',
      tagLabel: getManaTagMeta('missed-land').label,
      taggedRounds: rNums,
      severity: missing > 0 ? 'critical' : 'warning',
      diagnosticTitle:
        missing > 0
          ? `Confirmed land shortage: ${metrics?.currentLands ?? 0} lands vs ${metrics?.recommendedLands ?? 37} recommended (+${missing})`
          : `Land count (${metrics?.currentLands ?? 0}) matches target (${metrics?.recommendedLands ?? 37}), pointing to opening-hand / draw smoothing`,
      diagnosticDetail:
        missing > 0
          ? `Missing land drops in Round${rNums.length > 1 ? 's' : ''} ${rNums.join(', ')} aligns with the Analyzer's recommendation to add ${missing} land${missing === 1 ? '' : 's'} (and/or MDFCs) so your opening 7 and Turn 1–4 draws hit land drops reliably.`
          : `Even though total lands (${metrics?.currentLands ?? 0}) are near target, missing drops on Turn ${rNums.join(', ')} means adding cheap cantrips, MDFC lands, or mulligan discipline will stabilize early land drops.`,
    });
  }

  if (roundsByTag.has('color-screw')) {
    const rNums = roundsByTag.get('color-screw')!;
    const shortColors = (Array.isArray(metrics?.colorBreakdown) ? metrics.colorBreakdown : []).filter(
      (c) => c && c.status !== 'unused' && c.deltaSources > 0
    );
    const shortSummary = shortColors
      .map(
        (c) =>
          `${c.label}: ${c.currentSources}/${c.recommendedSources} sources (missing ${c.deltaSources} for ${c.pips} pips)`
      )
      .join('; ');

    findings.push({
      tag: 'color-screw',
      tagLabel: getManaTagMeta('color-screw').label,
      taggedRounds: rNums,
      severity: shortColors.some((c) => c.status === 'critical') ? 'critical' : 'warning',
      diagnosticTitle:
        shortColors.length > 0
          ? `Confirmed color source deficit in ${shortColors.map((c) => c.label).join(', ')}`
          : `Color screw experienced in Round${rNums.length > 1 ? 's' : ''} ${rNums.join(', ')}`,
      diagnosticDetail:
        shortColors.length > 0
          ? `${shortSummary}. ${(manaPlan?.colorIssues || [])[0] || 'Upgrade single-color basics to dual/fetch/pain lands matching your heaviest pip colors.'}`
          : (manaPlan?.colorIssues || [])[0] ||
            'Swap colorless utility lands or off-ratio basics for multi-color fixing lands that cover your double-pip spells.',
    });
  }

  if (roundsByTag.has('tapped-slow')) {
    const rNums = roundsByTag.get('tapped-slow')!;
    const tappedCount = metrics?.tappedLandCount ?? 0;
    findings.push({
      tag: 'tapped-slow',
      tagLabel: getManaTagMeta('tapped-slow').label,
      taggedRounds: rNums,
      severity: tappedCount >= 5 ? 'critical' : 'warning',
      diagnosticTitle: `${tappedCount} likely enters-tapped land${tappedCount === 1 ? '' : 's'} detected in your list`,
      diagnosticDetail:
        manaPlan?.tappedLandsWarning ||
        `Enters-tapped lands slowed your Turn ${rNums.join(', ')} curve. Replace unconditionally tapped duals with shock/bond/check/pain lands or untapped basics.`,
    });
  }

  if (roundsByTag.has('ramp-needed')) {
    const rNums = roundsByTag.get('ramp-needed')!;
    const rampDelta = metrics?.rampDelta ?? 0;
    const currentRamp = metrics?.currentRamp ?? 0;
    const recommendedRamp = metrics?.recommendedRamp ?? 10;
    findings.push({
      tag: 'ramp-needed',
      tagLabel: getManaTagMeta('ramp-needed').label,
      taggedRounds: rNums,
      severity: rampDelta > 0 ? 'critical' : 'warning',
      diagnosticTitle:
        rampDelta > 0
          ? `Ramp shortfall: ${currentRamp} ramp pieces vs ${recommendedRamp} target (+${rampDelta} needed)`
          : `Mana curve tempo check (Avg non-land MV ${metrics?.averageCmcNonLand ?? 0} · ${currentRamp} ramp pieces)`,
      diagnosticDetail:
        rampDelta > 0
          ? `Falling behind on mana in Round${rNums.length > 1 ? 's' : ''} ${rNums.join(', ')} directly matches your ${rampDelta}-piece ramp deficit. Prioritize 2-mana rocks or land-ramp spells over 4+ MV cards.`
          : `Your ramp count (${currentRamp}) meets baseline, so mana bottlenecks in Round${rNums.length > 1 ? 's' : ''} ${rNums.join(', ')} point to cutting high-MV clunky spells for lower-cost ramp.`,
    });
  }

  if (roundsByTag.has('mana-flood')) {
    const rNums = roundsByTag.get('mana-flood')!;
    const landsDelta = metrics?.landsDelta ?? 0;
    const excess = landsDelta < 0 ? Math.abs(landsDelta) : 0;
    const drawDelta = Math.max(0, (metrics?.recommendedDraw ?? 10) - (metrics?.currentDraw ?? 0));
    findings.push({
      tag: 'mana-flood',
      tagLabel: getManaTagMeta('mana-flood').label,
      taggedRounds: rNums,
      severity: excess > 0 || drawDelta > 0 ? 'warning' : 'info',
      diagnosticTitle:
        excess > 0
          ? `Excess lands detected: ${metrics?.currentLands ?? 0} lands vs ${metrics?.recommendedLands ?? 37} recommended (-${excess})`
          : `Flood mitigation: ${metrics?.currentDraw ?? 0}/${metrics?.recommendedDraw ?? 10} card draw sources`,
      diagnosticDetail:
        excess > 0
          ? `Drawing dead lands in Round${rNums.length > 1 ? 's' : ''} ${rNums.join(', ')} matches the Analyzer's note to trim ${excess} excess land${excess === 1 ? '' : 's'} and add card-draw engines.`
          : `Add card draw, looting, or mana-sink utility lands so extra lands drawn in Round${rNums.join(', ')} convert into spells.`,
    });
  }

  // Collect directly correlated card recommendations
  const cardMap = new Map<string, CorrelatedCardAction>();
  const registerCard = (item: CorrelatedCardAction) => {
    const existing = cardMap.get(item.key);
    if (existing) {
      for (const t of item.matchedTags) {
        if (!existing.matchedTags.includes(t)) existing.matchedTags.push(t);
      }
      for (const r of item.matchedRounds) {
        if (!existing.matchedRounds.includes(r)) existing.matchedRounds.push(r);
      }
    } else {
      cardMap.set(item.key, item);
    }
  };

  // 1. Analyzer Mana Plan landChanges
  for (const lc of manaPlan?.landChanges || []) {
    const matchedTags: ManaIssueTag[] = [];
    if (lc.action === 'add') {
      if (roundsByTag.has('missed-land')) matchedTags.push('missed-land');
      if (roundsByTag.has('color-screw')) matchedTags.push('color-screw');
      if (roundsByTag.has('tapped-slow')) matchedTags.push('tapped-slow');
    } else {
      if (roundsByTag.has('tapped-slow')) matchedTags.push('tapped-slow');
      if (roundsByTag.has('mana-flood')) matchedTags.push('mana-flood');
      if (roundsByTag.has('color-screw')) matchedTags.push('color-screw');
    }
    if (matchedTags.length > 0) {
      const matchedRounds = Array.from(
        new Set(matchedTags.flatMap((t) => roundsByTag.get(t) || []))
      ).sort((a, b) => a - b);
      registerCard({
        key: `land-${lc.action}-${lc.cardName.toLowerCase()}`,
        source: 'Mana Plan',
        action: lc.action,
        cutCardName: lc.action === 'cut' ? lc.cardName : undefined,
        addCardName: lc.action === 'add' ? lc.cardName : undefined,
        reason: lc.reason,
        matchedTags,
        matchedRounds,
      });
    }
  }

  // 2. Analyzer Swaps related to mana / ramp / draw / curve
  for (const sw of analysis?.swaps || []) {
    const roleLower = (sw.role || '').toLowerCase();
    const combinedText = `${sw.role || ''} ${sw.cutReason || ''} ${sw.addReason || ''}`.toLowerCase();
    const matchedTags: ManaIssueTag[] = [];

    if (
      roundsByTag.has('missed-land') &&
      (roleLower.includes('land') || combinedText.includes('land') || combinedText.includes('mdfc'))
    ) {
      matchedTags.push('missed-land');
    }
    if (
      roundsByTag.has('color-screw') &&
      (roleLower.includes('land') ||
        roleLower.includes('fix') ||
        combinedText.includes('color') ||
        combinedText.includes('mana fix'))
    ) {
      matchedTags.push('color-screw');
    }
    if (
      roundsByTag.has('tapped-slow') &&
      (combinedText.includes('tapped') || combinedText.includes('untapped') || roleLower.includes('land'))
    ) {
      matchedTags.push('tapped-slow');
    }
    if (
      roundsByTag.has('ramp-needed') &&
      (roleLower.includes('ramp') || combinedText.includes('ramp') || combinedText.includes('curve'))
    ) {
      matchedTags.push('ramp-needed');
    }
    if (
      roundsByTag.has('mana-flood') &&
      (roleLower.includes('draw') || combinedText.includes('flood') || combinedText.includes('card draw'))
    ) {
      matchedTags.push('mana-flood');
    }

    if (matchedTags.length > 0) {
      const matchedRounds = Array.from(
        new Set(matchedTags.flatMap((t) => roundsByTag.get(t) || []))
      ).sort((a, b) => a - b);
      registerCard({
        key: `swap-${sw.cutCardName.toLowerCase()}-${sw.addCardName.toLowerCase()}`,
        source: 'Analyzer Swap',
        action: 'swap',
        cutCardName: sw.cutCardName,
        addCardName: sw.addCardName,
        reason: `${sw.cutReason} → ${sw.addReason}`,
        matchedTags,
        matchedRounds,
      });
    }
  }

  // 3. Analyzer Additions for Land / Mana Ramp / Card Draw
  for (const add of analysis?.additions || []) {
    const matchedTags: ManaIssueTag[] = [];
    if (add.role === 'Land') {
      if (roundsByTag.has('missed-land')) matchedTags.push('missed-land');
      if (roundsByTag.has('color-screw')) matchedTags.push('color-screw');
      if (roundsByTag.has('tapped-slow')) matchedTags.push('tapped-slow');
    }
    if (add.role === 'Mana Ramp' && roundsByTag.has('ramp-needed')) {
      matchedTags.push('ramp-needed');
    }
    if (add.role === 'Card Draw' && (roundsByTag.has('mana-flood') || roundsByTag.has('missed-land'))) {
      if (roundsByTag.has('mana-flood')) matchedTags.push('mana-flood');
      if (roundsByTag.has('missed-land')) matchedTags.push('missed-land');
    }

    if (matchedTags.length > 0) {
      const matchedRounds = Array.from(
        new Set(matchedTags.flatMap((t) => roundsByTag.get(t) || []))
      ).sort((a, b) => a - b);
      registerCard({
        key: `add-${add.cardName.toLowerCase()}`,
        source: 'Analyzer Add',
        action: 'add',
        addCardName: add.cardName,
        reason: add.reason,
        matchedTags,
        matchedRounds,
      });
    }
  }

  // 4. Round-specific deck changes recorded on those tagged rounds
  for (const { round, tag } of taggedEntries) {
    (Array.isArray(round.roundChanges) ? round.roundChanges : []).forEach((rc: RoundDeckChange) => {
      const key = `round-${rc.action}-${(rc.cutCardName || '').toLowerCase()}-${(rc.addCardName || '').toLowerCase()}`;
      registerCard({
        key,
        source: 'Round Fix',
        action: rc.action,
        cutCardName: rc.cutCardName,
        addCardName: rc.addCardName,
        reason: rc.reason,
        matchedTags: [tag],
        matchedRounds: [round.roundNumber],
      });
    });
  }

  return {
    taggedEntries,
    findings,
    correlatedCards: Array.from(cardMap.values()),
  };
}
