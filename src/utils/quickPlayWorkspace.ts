import type {
  CardMetadata,
  ColorBreakdownItem,
  CurveBucket,
  DeckAnalysisResult,
  DeckFormat,
  DeckGoal,
  ManaColor,
  ResolvedDeckCard,
} from '../types/deck';
import { SAMPLE_DECKS } from '../data/sampleDecks';
import { parseDecklistClientSide } from './clientFallbackAnalyzer';
import {
  consolidateResolvedDeckCards,
  detectFormatFromParsedCards,
  getTargetDeckSizeForFormat,
} from './deckRules';
import { getScryfallFallbackImageUri } from './customCardProxiesAndTokens';

const BASIC_LAND_COLORS: Record<string, { color: ManaColor; typeLine: string }> = {
  plains: { color: 'W', typeLine: 'Basic Land — Plains' },
  island: { color: 'U', typeLine: 'Basic Land — Island' },
  swamp: { color: 'B', typeLine: 'Basic Land — Swamp' },
  mountain: { color: 'R', typeLine: 'Basic Land — Mountain' },
  forest: { color: 'G', typeLine: 'Basic Land — Forest' },
  wastes: { color: 'C', typeLine: 'Basic Land' },
};

const KNOWN_LAND_REGEX =
  /\b(command tower|watery grave|drowned catacomb|sunken hollow|choked estuary|dimir aqueduct|temple of deceit|dismal backwater|evolving wilds|terramorphic expanse|unclaimed territory|path of ancestry|bojuka bog|reliquary tower|bloodstained mire|blackcleave cliffs|blood crypt|dragonskull summit|temple of malice|ghost quarter|simic growth chamber|thornwood falls|woodland stream|temple of mystery|blighted woodland|myriad landscape|jungle basin|coral atoll|fabled passage|prismatic vista|exotic orchard|cavern of souls|urza's saga|ancient tomb|strip mine|wasteland|mana confluence|city of brass|reflecting pool|rogue's passage|solitary sanctuary|arena|tower|sanctuary|catacomb|estuary|aqueduct|temple|backwater|wilds|expanse|territory|ancestry|bog|mire|cliffs|crypt|summit|quarter|chamber|falls|stream|woodland|landscape|basin|atoll|harbor|glade|grove|citadel|monastery|outpost|bivouac|palace|headquarters|triome|lounge|garden|fountain|shrine|ground|foundry|vents|tomb|pool|grounds)\b/i;

function inferQuickCardMetadata(
  cardName: string,
  zone: ResolvedDeckCard['zone'],
  format: Exclude<DeckFormat, 'auto'>
): CardMetadata {
  const lower = cardName.trim().toLowerCase();
  const autoImageUri = getScryfallFallbackImageUri(cardName);
  const basic = BASIC_LAND_COLORS[lower];
  if (basic) {
    return {
      name: cardName,
      manaCost: '',
      cmc: 0,
      typeLine: basic.typeLine,
      oracleText: `({T}: Add {${basic.color}}.)`,
      colors: [],
      colorIdentity: basic.color === 'C' ? [] : [basic.color],
      producedMana: [basic.color],
      isLand: true,
      isMdfcLand: false,
      entersTappedLikely: false,
      isRamp: false,
      isDraw: false,
      isRemoval: false,
      isBoardWipe: false,
      isProtection: false,
      imageUri: autoImageUri,
      priceUsd: 0.1,
      priceFoilUsd: null,
      priceEur: null,
      priceTix: null,
      cardKingdomPriceUsd: null,
      scryfallUri: `https://scryfall.com/search?q=!"${encodeURIComponent(cardName)}"`,
      legalInFormat: true,
      rarity: 'common',
    };
  }

  const isLikelyLand = KNOWN_LAND_REGEX.test(lower);
  if (isLikelyLand) {
    const entersTapped =
      /\b(temple of|aqueduct|growth chamber|backwater|falls|stream|evolving wilds|terramorphic expanse|blighted woodland|myriad landscape|jungle basin|coral atoll|bojuka bog|path of ancestry)\b/i.test(
        lower
      );
    return {
      name: cardName,
      manaCost: '',
      cmc: 0,
      typeLine: 'Land',
      oracleText: '{T}: Add mana.',
      colors: [],
      colorIdentity: [],
      producedMana: ['W', 'U', 'B', 'R', 'G'],
      isLand: true,
      isMdfcLand: false,
      entersTappedLikely: entersTapped,
      isRamp: false,
      isDraw: false,
      isRemoval: false,
      isBoardWipe: false,
      isProtection: false,
      imageUri: autoImageUri,
      priceUsd: 1.0,
      priceFoilUsd: null,
      priceEur: null,
      priceTix: null,
      cardKingdomPriceUsd: null,
      scryfallUri: `https://scryfall.com/search?q=!"${encodeURIComponent(cardName)}"`,
      legalInFormat: true,
      rarity: 'uncommon',
    };
  }

  const isCommanderCard = zone === 'commander';
  const isRamp =
    /\b(sol ring|signet|talisman|rampant growth|cultivate|kodama's reach|harrow|roiling regrowth|explore|growth spiral|llanowar elves|elvish mystic|sakura-tribe elder|wood elves|lotus cobra|mind stone|dark ritual|phyrexian altar|ashnod's altar|caged sun)\b/i.test(
      lower
    );
  const isDraw =
    /\b(rhystic study|mystic remora|midnight reaper|undead augur|kindred discovery|distant melody|harmonize|fact or fiction|urban evolution|tatyova|aesi|coiling oracle)\b/i.test(
      lower
    );
  const isRemoval =
    /\b(counterspell|negate|arcane denial|infernal grasp|go for the throat|feed the swarm|deadly rollick|beast within|reality shift|lightning bolt|fatal push|terminate|thoughtseize|fleshbag marauder|plaguecrafter)\b/i.test(
      lower
    );
  const isBoardWipe =
    /\b(toxic deluge|decree of pain|living death|whelming wave|damn|wrath|blasphemous act)\b/i.test(
      lower
    );

  return {
    name: cardName,
    manaCost: isCommanderCard ? '{2}{U}{B}' : isRamp ? '{2}' : '{2}{B}',
    cmc: isRamp ? 2 : isCommanderCard ? 4 : 3,
    typeLine: isCommanderCard
      ? 'Legendary Creature — Commander'
      : isRamp && /\b(ring|signet|talisman|stone|altar|sun)\b/i.test(lower)
      ? 'Artifact'
      : isRemoval || isBoardWipe
      ? 'Instant'
      : 'Creature',
    oracleText: '',
    colors: [],
    colorIdentity: [],
    producedMana: isRamp ? ['C'] : [],
    isLand: false,
    isMdfcLand: false,
    entersTappedLikely: false,
    isRamp,
    isDraw,
    isRemoval,
    isBoardWipe,
    isProtection: false,
    power: isCommanderCard ? '3' : '2',
    toughness: isCommanderCard ? '3' : '2',
    imageUri: autoImageUri,
    priceUsd: null,
    priceFoilUsd: null,
    priceEur: null,
    priceTix: null,
    cardKingdomPriceUsd: null,
    scryfallUri: `https://scryfall.com/search?q=!"${encodeURIComponent(cardName)}"`,
    legalInFormat: format !== 'pauper' || true,
    rarity: isCommanderCard ? 'mythic' : 'rare',
  };
}

/**
 * Builds an instant, zero-wait DeckAnalysisResult from raw decklist text (or the default sample Commander pod deck)
 * so the user can jump straight into Bot Playtest or LAN / Online Multiplayer without running full deck analysis first.
 * PlaytestArena automatically resolves full Scryfall card art & Oracle metadata in the background.
 */
export function buildInstantQuickPlayWorkspace(params: {
  deckText?: string;
  deckName?: string;
  format?: DeckFormat;
  goal?: DeckGoal;
}): {
  deckText: string;
  deckName: string;
  format: DeckFormat;
  goal: DeckGoal;
  analysis: DeckAnalysisResult;
} {
  const defaultSample = SAMPLE_DECKS[0];
  let sourceText = (params.deckText || '').trim();
  let parsed = parseDecklistClientSide(sourceText);

  let usedSampleFallback = false;
  if (parsed.cards.length === 0) {
    sourceText = defaultSample.deckText;
    parsed = parseDecklistClientSide(sourceText);
    usedSampleFallback = true;
  }

  const effectiveFormat: Exclude<DeckFormat, 'auto'> = usedSampleFallback
    ? defaultSample.format === 'auto'
      ? 'commander'
      : defaultSample.format
    : detectFormatFromParsedCards(parsed.cards, params.format || 'auto');

  const effectiveGoal: DeckGoal = usedSampleFallback
    ? defaultSample.goal
    : params.goal || 'bracket-3';

  const rawResolved: ResolvedDeckCard[] = parsed.cards.map((entry) => ({
    ...entry,
    card: inferQuickCardMetadata(entry.name, entry.zone, effectiveFormat),
  }));

  // Ensure a commander is tagged if playing Commander/Brawl and none was explicitly in the Commander zone
  if (
    (effectiveFormat === 'commander' || effectiveFormat === 'brawl') &&
    !rawResolved.some((c) => c.zone === 'commander')
  ) {
    const firstNonLand = rawResolved.find((c) => c.zone === 'main' && !c.card?.isLand);
    if (firstNonLand) {
      firstNonLand.zone = 'commander';
      firstNonLand.card = inferQuickCardMetadata(
        firstNonLand.name,
        'commander',
        effectiveFormat
      );
    }
  }

  const resolvedCards = consolidateResolvedDeckCards(rawResolved, effectiveFormat);
  const mainAndCmd = resolvedCards.filter(
    (c) => c.zone === 'main' || c.zone === 'commander'
  );
  const sideboardCount = resolvedCards
    .filter((c) => c.zone === 'sideboard' || c.zone === 'companion')
    .reduce((sum, c) => sum + c.quantity, 0);
  const totalMainAndCmd = mainAndCmd.reduce((sum, c) => sum + c.quantity, 0);
  const targetDeckSize = getTargetDeckSizeForFormat(effectiveFormat, totalMainAndCmd);

  const commanders = resolvedCards.filter((c) => c.zone === 'commander');
  const commanderNames = commanders.map((c) => c.name);

  let currentLands = 0;
  let tappedLandCount = 0;
  let currentRamp = 0;
  let currentDraw = 0;
  let currentRemoval = 0;
  let currentBoardWipes = 0;
  let nonLandCount = 0;
  let nonLandCmcSum = 0;

  const curveCounts = new Array<number>(8).fill(0);

  for (const item of mainAndCmd) {
    const qty = item.quantity;
    if (item.card?.isLand) {
      currentLands += qty;
      if (item.card.entersTappedLikely) tappedLandCount += qty;
    } else {
      const cmc = item.card?.cmc ?? 3;
      nonLandCount += qty;
      nonLandCmcSum += cmc * qty;
      const bucketIdx = Math.min(7, Math.max(0, Math.floor(cmc)));
      curveCounts[bucketIdx] += qty;
      if (item.card?.isRamp) currentRamp += qty;
      if (item.card?.isDraw) currentDraw += qty;
      if (item.card?.isRemoval) currentRemoval += qty;
      if (item.card?.isBoardWipe) currentBoardWipes += qty;
    }
  }

  const recommendedLands = effectiveFormat === 'commander' ? 37 : 24;
  const landsDelta = recommendedLands - currentLands;
  const averageCmcNonLand =
    nonLandCount > 0 ? Number((nonLandCmcSum / nonLandCount).toFixed(2)) : 3.0;
  const averageCmcWithLands =
    totalMainAndCmd > 0 ? Number((nonLandCmcSum / totalMainAndCmd).toFixed(2)) : 2.1;

  const curve: CurveBucket[] = curveCounts.map((cnt, idx) => ({
    cmc: idx,
    cmcLabel: idx === 7 ? '7+' : `${idx}`,
    currentCount: cnt,
  }));

  const defaultColors: Array<{ color: ManaColor; label: string }> = [
    { color: 'W', label: 'White' },
    { color: 'U', label: 'Blue' },
    { color: 'B', label: 'Black' },
    { color: 'R', label: 'Red' },
    { color: 'G', label: 'Green' },
    { color: 'C', label: 'Colorless' },
  ];

  const colorBreakdown: ColorBreakdownItem[] = defaultColors.map((c) => ({
    color: c.color,
    label: c.label,
    pips: 0,
    pipSharePct: 0,
    currentSources: Math.round(currentLands / 2),
    recommendedSources: Math.round(recommendedLands / 2),
    deltaSources: 0,
    status: 'ok',
  }));

  const resolvedDeckName = usedSampleFallback
    ? defaultSample.title
    : (params.deckName || '').trim() ||
      parsed.deckName?.trim() ||
      (commanderNames.length > 0
        ? `${commanderNames.join(' & ')} Deck`
        : 'Quick Playtest Deck');

  const analysis: DeckAnalysisResult = {
    deckName: resolvedDeckName,
    sourceFormat: usedSampleFallback
      ? 'Quick-Play Ready Deck'
      : 'Quick-Play Decklist (Unanalyzed)',
    goal: effectiveGoal,
    archetype:
      commanderNames.length > 0
        ? `${commanderNames.join(' & ')} (${effectiveFormat})`
        : `${effectiveFormat.toUpperCase()} Deck`,
    verdictHeadline:
      'Quick-Play Mode Active — Play vs AI Bots or in LAN / Online Multiplayer anytime',
    verdictSummary:
      'You jumped straight into the playtest & multiplayer workspace without running a full deck analysis. You can play live games vs AI bots, host or join LAN/Online multiplayer pods, edit your decklist on the fly, or click "Run Full Deck Analysis" whenever you want mana & synergy recommendations.',
    topPriorities: [
      'Ready for Bot Playtest & 1–4 Player LAN / Online Multiplayer right away.',
      'Card art and Oracle text resolve automatically via Scryfall in the playtest arena.',
      'Run Full Deck Analysis anytime to compute mana fixing, curve swaps, and synergy upgrades.',
    ],
    metrics: {
      detectedFormat: effectiveFormat,
      targetDeckSize,
      currentMainAndCommanderCount: totalMainAndCmd,
      sideboardCount,
      deckSizeDelta: targetDeckSize - totalMainAndCmd,
      commanderNames,
      commanderColorIdentity: ['U', 'B'],
      currentLands,
      mdfcLandCount: 0,
      tappedLandCount,
      recommendedLands,
      landsDelta,
      recommendedRamp: 10,
      currentRamp,
      rampDelta: Math.max(0, 10 - currentRamp),
      currentDraw,
      recommendedDraw: 10,
      currentRemoval,
      recommendedRemoval: 10,
      currentBoardWipes,
      averageCmcNonLand,
      averageCmcWithLands,
      curve,
      colorBreakdown,
      formatViolations: [],
      singletonViolations: [],
      colorIdentityViolations: [],
      unresolvedCards: [],
    },
    manaPlan: {
      verdict: 'balanced',
      headline: 'Quick-Play Decklist Loaded',
      plainExplanation:
        'Click "Re-Analyze Updated List" in the Optimized List tab or "Import Deck -> Analyze Deck" anytime you want a full mana & synergy audit.',
      currentLands,
      recommendedLands,
      landsMissingOrExcess: landsDelta,
      currentRamp,
      recommendedRamp: 10,
      rampMissing: Math.max(0, 10 - currentRamp),
      tappedLandsWarning: null,
      colorIssues: [],
      landChanges: [],
    },
    swaps: [],
    cuts: [],
    additions: [],
    resolvedCards,
  };

  return {
    deckText: sourceText,
    deckName: resolvedDeckName,
    format: usedSampleFallback ? defaultSample.format : params.format || effectiveFormat,
    goal: effectiveGoal,
    analysis,
  };
}
