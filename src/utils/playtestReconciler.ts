import type {
  BotOpponentConfig,
  CardMetadata,
  CommanderDamageEntry,
  DeckFormat,
  PlaytestFinalStatsSummary,
  PlaytestMode,
  PlaytestRound,
  PlayerRoundCombatStats,
  ResolvedDeckCard,
  WinConditionType,
} from '../types/deck';

export interface FormatSimulationRules {
  format: Exclude<DeckFormat, 'auto'>;
  mode: PlaytestMode;
  isMultiplayer: boolean;
  startingLife: number;
  targetDeckSize: number;
  targetMainDeckSize: number;
  recommendedLands: number;
  allowsCommandZone: boolean;
  usesCommanderDamage21: boolean;
  playerSkipsTurn1Draw: boolean;
  freeFirstMulligan: boolean;
  poisonLossThreshold: number;
  commanderLossThreshold: number;
}

export function getFormatSimulationRules(
  format: Exclude<DeckFormat, 'auto'> = 'commander',
  mode: PlaytestMode = '1v3',
  totalDeckCards?: number
): FormatSimulationRules {
  const isMultiplayer = mode !== '1v1';
  const allowsCommandZone = format === 'commander' || format === 'brawl';
  const usesCommanderDamage21 = format === 'commander';

  const startingLife =
    format === 'commander'
      ? 40
      : format === 'brawl'
      ? isMultiplayer
        ? 30
        : 25
      : 20;

  const isHistoricBrawlSize =
    format === 'brawl' && typeof totalDeckCards === 'number' && totalDeckCards >= 80;

  const targetDeckSize =
    format === 'commander'
      ? 100
      : format === 'brawl'
      ? isHistoricBrawlSize
        ? 100
        : 60
      : format === 'limited'
      ? 40
      : 60;

  const targetMainDeckSize = allowsCommandZone ? targetDeckSize - 1 : targetDeckSize;

  const recommendedLands =
    targetDeckSize >= 100
      ? 37
      : format === 'brawl'
      ? 25
      : format === 'limited'
      ? 17
      : 24;

  return {
    format,
    mode,
    isMultiplayer,
    startingLife,
    targetDeckSize,
    targetMainDeckSize,
    recommendedLands,
    allowsCommandZone,
    usesCommanderDamage21,
    // CR 103.8: In 1v1 duels across all formats, starting player skips Turn 1 draw; in 3+ player pods, everyone draws Turn 1.
    playerSkipsTurn1Draw: !isMultiplayer,
    // Official rules: free 1st mulligan in multiplayer pods (3+ players) and Brawl; standard London mulligan in 1v1 Constructed/Limited.
    freeFirstMulligan: isMultiplayer || format === 'brawl',
    poisonLossThreshold: 10,
    commanderLossThreshold: 21,
  };
}

export interface ColorPipRequirements {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  generic: number;
}

export interface CardMechanicFlags {
  hasInfect: boolean;
  toxicValue: number;
  hasProliferate: boolean;
  millAmount: number;
  isVoltronBuff: boolean;
  burnOrDrainAmount: number;
  lifegainAmount: number;
  selfLifeLossAmount: number;
  isXSpell: boolean;
  isBoardPump: boolean;
  tokenCount: number;
  tokenPower: number;
  estimatedPower: number;
  estimatedToughness: number;
  extraDrawCount: number;
  isCounterOrRemoval: boolean;
  isCounterspell: boolean;
  isBoardWipe: boolean;
  isTutor: boolean;
  isProtection: boolean;
  isReanimator: boolean;
  isTokenMaker: boolean;
  isEnginePermanent: boolean;
  isAristocratsPayoff: boolean;
  isSacOutlet: boolean;
  isLandfallPayoff: boolean;
  isSpellslingerPayoff: boolean;
  hasFlying: boolean;
  hasReach: boolean;
  hasMenace: boolean;
  isUnblockable: boolean;
  hasEvasion: boolean;
  hasFirstStrike: boolean;
  hasDoubleStrike: boolean;
  hasHaste: boolean;
  hasVigilance: boolean;
  hasLifelink: boolean;
  hasDeathtouch: boolean;
  hasTrample: boolean;
  hitsEachOpponent: boolean;
  colorPips: ColorPipRequirements;
}

const MAX_RECONCILER_CACHE_SIZE = 4096;
const _pipCache = new Map<string, ColorPipRequirements>();

export function parseManaCostPips(manaCost?: string): ColorPipRequirements {
  const key = manaCost || '';
  const cached = _pipCache.get(key);
  if (cached) return cached;

  const pips: ColorPipRequirements = { W: 0, U: 0, B: 0, R: 0, G: 0, generic: 0 };
  if (manaCost) {
    const tokens = manaCost.match(/\{([^}]+)\}/g) || [];
    for (const rawTok of tokens) {
      const tok = rawTok.slice(1, -1).toUpperCase();
      if (/^\d+$/.test(tok)) {
        pips.generic += Number(tok);
      } else if (tok === 'W' || tok === 'U' || tok === 'B' || tok === 'R' || tok === 'G') {
        pips[tok] += 1;
      } else if (tok.includes('/')) {
        const parts = tok.split('/');
        const colorPart = parts.find((p) => p === 'W' || p === 'U' || p === 'B' || p === 'R' || p === 'G') as
          | 'W'
          | 'U'
          | 'B'
          | 'R'
          | 'G'
          | undefined;
        if (colorPart && !parts.includes('P')) {
          pips[colorPart] += 1;
        } else {
          pips.generic += 1;
        }
      }
    }
  }
  if (_pipCache.size >= MAX_RECONCILER_CACHE_SIZE) {
    _pipCache.clear();
  }
  _pipCache.set(key, pips);
  return pips;
}

export function getProducedColorsFromCard(
  name: string,
  meta?: CardMetadata | null
): Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> {
  if (meta?.producedMana && meta.producedMana.length > 0) {
    return meta.producedMana as Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'>;
  }
  const lower = (name || '').toLowerCase();
  const oracle = (meta?.oracleText || '').toLowerCase();
  if (
    /\b(command tower|exotic orchard|arcane signet|fellwar stone|chromatic lantern|city of brass|mana confluence|birds of paradise|reflecting pool|path of ancestry|triome)\b/i.test(
      lower
    ) ||
    /any color/i.test(oracle)
  ) {
    return ['W', 'U', 'B', 'R', 'G'];
  }
  const cols: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> = [];
  if (/\bplains\b/i.test(lower) || /\{w\}/i.test(oracle)) cols.push('W');
  if (/\bisland\b/i.test(lower) || /\{u\}/i.test(oracle)) cols.push('U');
  if (/\bswamp\b/i.test(lower) || /\{b\}/i.test(oracle)) cols.push('B');
  if (/\bmountain\b/i.test(lower) || /\{r\}/i.test(oracle)) cols.push('R');
  if (/\bforest\b/i.test(lower) || /\{g\}/i.test(oracle)) cols.push('G');
  if (cols.length === 0 && (meta?.isLand || meta?.isRamp)) {
    return ['W', 'U', 'B', 'R', 'G'];
  }
  return cols;
}

export function canPayManaCost(
  totalManaAvailable: number,
  colorCounts: Record<'W' | 'U' | 'B' | 'R' | 'G', number>,
  cmc: number,
  manaCost?: string
): boolean {
  if (cmc > totalManaAvailable) return false;
  if (!manaCost) return true;
  const pips = parseManaCostPips(manaCost);
  const colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = ['W', 'U', 'B', 'R', 'G'];
  for (const col of colors) {
    if (pips[col] > 0 && colorCounts[col] < pips[col]) {
      return false;
    }
  }
  return true;
}

export function normalizeCardLookupKey(name: string): string {
  return (name || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function findMetaFromMap<T>(
  map: Map<string, T>,
  cardName: string
): T | undefined {
  const key = normalizeCardLookupKey(cardName);
  if (!key) return undefined;
  const direct = map.get(key);
  if (direct !== undefined) return direct;
  if (key.includes(' // ')) {
    const front = key.split(' // ')[0].trim();
    const frontHit = map.get(front);
    if (frontHit !== undefined) return frontHit;
  } else {
    for (const [k, v] of map.entries()) {
      if (k.startsWith(`${key} // `)) return v;
    }
  }
  return undefined;
}

export function parsePowerOrToughnessNumeric(
  raw: string | undefined,
  fallbackCmc: number
): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^-?\d+$/.test(trimmed)) {
    return Math.max(0, Number(trimmed));
  }
  if (trimmed === '*' || trimmed.includes('*')) {
    return Math.max(2, Math.min(7, Math.round(fallbackCmc)));
  }
  const lead = trimmed.match(/^(-?\d+)/);
  if (lead) return Math.max(0, Number(lead[1]));
  return null;
}

export interface ArchetypeCombatBias {
  defaultCommanderName: string;
  commanderNames: string[];
  usesInfect: boolean;
  usesToxic: boolean;
  usesProliferate: boolean;
  usesMill: boolean;
  usesVoltronCommander: boolean;
  usesBurnDrain: boolean;
  usesControl: boolean;
  basePowerFactor: number;
  landCount: number;
  wipeCount: number;
  removalCount: number;
  rampCount: number;
}

const _mechCache = new Map<string, CardMechanicFlags>();

export function detectCardMechanics(
  name: string,
  meta?: CardMetadata | null
): CardMechanicFlags {
  const lowerName = normalizeCardLookupKey(name || '');
  const oracle = (meta?.oracleText || '').toLowerCase();
  const typeLine = (meta?.typeLine || '').toLowerCase();
  const manaCostStr = meta?.manaCost || '';
  const cacheKey = `${lowerName}|${manaCostStr}|${meta?.cmc ?? ''}|${meta?.power ?? ''}|${meta?.toughness ?? ''}|${typeLine.length}|${oracle.length}`;
  const cached = _mechCache.get(cacheKey);
  if (cached) return cached;

  const hasInfect =
    /\binfect\b/i.test(oracle) ||
    /\b(blighted agent|skithiryx|phyrexian crusader|glistening oil|grafted exoskeleton|tainted strike|phyresis|ichor rats|plague stinger|glistener elf|inkmoth nexus|phyrexian swarmlord|viral drake|corpse cur)\b/i.test(
      lowerName
    );

  const toxicMatch = oracle.match(/\btoxic\s+(\d+)/i);
  let toxicValue = toxicMatch ? Number(toxicMatch[1]) : 0;
  if (
    toxicValue === 0 &&
    /\b(venerated rotpriest|bloated contaminator|tyrranax rex|jawbone duelist|slaughter singer|bilious skulldweller|pestilent syphoner|necrogen rotpriest|voidwing hybrid|skrelv)\b/i.test(
      lowerName
    )
  ) {
    toxicValue = /tyrranax rex/i.test(lowerName) ? 4 : 1;
  }

  const hasProliferate =
    /\bproliferate\b/i.test(oracle) ||
    /\b(atraxa|experimental augury|prologue to phyresis|inexorable tide|vraska's fall|infectious inquiry|radstorm|flux channeler|tekkuthal|thrummingbird|contagion clasp|contagion engine)\b/i.test(
      lowerName
    );

  let millAmount = 0;
  const millMatches = oracle.match(/mills?\s+(\d+|x|half|ten|eight|five|four|three|two|one)/i);
  if (millMatches) {
    const token = millMatches[1].toLowerCase();
    const wordMap: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      eight: 8,
      ten: 10,
      x: 5,
      half: 18,
    };
    millAmount = Number.isFinite(Number(token)) ? Number(token) : wordMap[token] || 4;
  } else if (
    /\b(maddening cacophony|traumatize|glimpse the unthinkable|archive trap|fractured sanity|hedron crab|ruin crab|mesmeric orb|mindcrank|ashiok|bruvac|phenax|fraying sanity|court of cunning|altar of dementia|tasha's hideous laughter)\b/i.test(
      lowerName
    )
  ) {
    millAmount = /\b(maddening cacophony|traumatize|tasha's hideous laughter)\b/i.test(
      lowerName
    )
      ? 12
      : /\b(glimpse the unthinkable|archive trap|fractured sanity)\b/i.test(lowerName)
      ? 10
      : 4;
  }

  const isVoltronBuff =
    /\b(double strike|equipped creature|enchanted creature|commander you control|gets \+\d+\/\+\d+)\b/i.test(
      oracle
    ) ||
    /\b(embercleave|colossus hammer|blackblade reforged|hammer of nazahn|swiftfoot boots|lightning greaves|sword of|umezawa's jitte|shadowspear|jeska, thrice reborn)\b/i.test(
      lowerName
    );

  const isXSpell =
    /\{x\}/i.test(manaCostStr) ||
    /\b(?:deals?\s+x\s+damage|loses?\s+x\s+life|x\s+or\s+less)\b/i.test(oracle) ||
    /\b(torment of hailfire|exsanguinate|finale of devastation|crackle with power|walking ballista|banefire|debt to the deathless)\b/i.test(
      lowerName
    );

  const isBoardPump =
    /\b(?:creatures you control|other creatures you control|attacking creatures) get \+\d+\/\+\d+/i.test(
      oracle
    ) ||
    /\b(?:creatures you control get \+x\/\+x)\b/i.test(oracle) ||
    /\b(craterhoof behemoth|overrun|triumph of the hordes|jetmir|beastmaster ascension|shared animosity|coat of arms|moonshaker cavalry|akroma's will|finishers)\b/i.test(
      lowerName
    );

  let burnOrDrainAmount = 0;
  const dmgMatch = oracle.match(
    /(?:deals?\s+(\d+)\s+damage|loses?\s+(\d+)\s+life)/i
  );
  if (dmgMatch) {
    burnOrDrainAmount = Number(dmgMatch[1] || dmgMatch[2] || 0);
  } else if (
    /\b(lightning bolt|chain lightning|blood artist|zulaport cutthroat|cruel celebrant|sheoldred|guttersnipe|torment of hailfire|exsanguinate|exquisite blood|gray merchant|purphoros|price of progress|crackle with power|vito, thorn)\b/i.test(
      lowerName
    )
  ) {
    burnOrDrainAmount = /\b(gray merchant|price of progress|torment of hailfire|exsanguinate|crackle with power)\b/i.test(
      lowerName
    )
      ? 5
      : 3;
  }

  let lifegainAmount = 0;
  const gainMatch = oracle.match(/gain[s]?\s+(\d+)\s+life/i);
  if (gainMatch) {
    lifegainAmount = Number(gainMatch[1] || 0);
  } else if (
    /\blifelink\b/i.test(oracle) ||
    /\b(blood artist|zulaport|cruel celebrant|exsanguinate|gray merchant|approach of the second sun|aetherflux reservoir)\b/i.test(
      lowerName
    )
  ) {
    lifegainAmount = /\b(approach of the second sun|gray merchant|exsanguinate)\b/i.test(
      lowerName
    )
      ? 6
      : 2;
  }

  let selfLifeLossAmount = 0;
  const selfLossMatch = oracle.match(/you lose (\d+) life/i);
  if (selfLossMatch) {
    selfLifeLossAmount = Math.min(8, Number(selfLossMatch[1] || 0));
  } else if (/pay 2 life/i.test(oracle) && /\bland\b/i.test(typeLine)) {
    selfLifeLossAmount = 2;
  } else if (/deals? 1 damage to you/i.test(oracle) || /\btalisman of\b/i.test(lowerName)) {
    selfLifeLossAmount = 1;
  } else if (
    /\b(phyrexian arena|bitterblossom|mana crypt|sylvan library|ancient tomb|black market connections|reanimate|necropotence|bolas's citadel|toxic deluge|night's whisper|sign in blood|read the bones|thoughtseize)\b/i.test(
      lowerName
    )
  ) {
    selfLifeLossAmount = /\b(ancient tomb|thoughtseize|night's whisper|sign in blood|read the bones|sylvan library)\b/i.test(
      lowerName
    )
      ? 2
      : /\b(reanimate|toxic deluge|necropotence|bolas's citadel)\b/i.test(lowerName)
      ? 3
      : 1;
  }

  const hasFlying = /\bflying\b/i.test(oracle) || /\b(bird|angel|dragon|drake|sphinx|demon|spirit|faerie|thopter)\b/i.test(typeLine);
  const hasReach = /\breach\b/i.test(oracle);
  const hasMenace = /\bmenace\b/i.test(oracle);
  const isUnblockable =
    /\b(can't be blocked|unblockable|shadow|horsemanship)\b/i.test(oracle) ||
    /\b(blighted agent|invisible stalker|triton shorestalker|slither blade)\b/i.test(lowerName);
  const hasFirstStrike = /\bfirst strike\b/i.test(oracle);
  const hasDoubleStrike = /\bdouble strike\b/i.test(oracle);
  const hasHaste = /\bhaste\b/i.test(oracle);
  const hasVigilance = /\bvigilance\b/i.test(oracle);
  const hasLifelink = /\blifelink\b/i.test(oracle);
  const hasDeathtouch = /\bdeathtouch\b/i.test(oracle);
  const hasTrample = /\btrample\b/i.test(oracle);
  // IMPORTANT: Trample is NOT evasion; Trample creatures can still be blocked by ground creatures!
  const hasEvasion =
    hasFlying ||
    hasMenace ||
    isUnblockable ||
    /\b(fear|intimidate|skulk)\b/i.test(oracle);
  const hitsEachOpponent =
    /\beach opponent\b/i.test(oracle) ||
    /\b(zulaport cutthroat|cruel celebrant|blood artist|kokusho|gray merchant|torment of hailfire|exsanguinate|syr konrad|purphoros|impact tremors|sheoldred, the apocalypse|eidolon of the great revel|price of progress)\b/i.test(
      lowerName
    );

  const isCreature = /\bcreature\b/i.test(typeLine);
  const cmc = meta?.cmc ?? 2;
  const parsedPower = parsePowerOrToughnessNumeric(meta?.power, cmc);
  const parsedToughness = parsePowerOrToughnessNumeric(meta?.toughness, cmc);

  const estimatedPower = isCreature
    ? parsedPower !== null
      ? parsedPower
      : Math.max(
          1,
          Math.min(
            8,
            Math.round(
              cmc + (/trample|haste|menace|flying|double strike/i.test(oracle) ? 1 : 0)
            )
          )
        )
    : 0;

  const estimatedToughness = isCreature
    ? parsedToughness !== null
      ? parsedToughness
      : Math.max(1, estimatedPower)
    : 0;

  let extraDrawCount = 0;
  if (meta?.isDraw || /\bdraw\s+(two|three|four|a card|cards|\d+)\b/i.test(oracle)) {
    const dMatch = oracle.match(/\bdraw\s+(\d+|two|three|four|a)\b/i);
    if (dMatch) {
      const tok = dMatch[1].toLowerCase();
      extraDrawCount = tok === 'two' ? 2 : tok === 'three' ? 3 : tok === 'four' ? 4 : tok === 'a' ? 1 : Number(tok) || 1;
    } else {
      extraDrawCount = 1;
    }
  }

  const isCounterspell =
    /\bcounter target\b/i.test(oracle) ||
    /\b(counterspell|dovin's veto|fierce guardianship|swan song|force of will|force of negation|mana drain|negate|an offer you can't refuse|arcane denial|pact of negation|flusterstorm|dispel|stubborn denial|delay)\b/i.test(
      lowerName
    );

  const isCounterOrRemoval =
    isCounterspell ||
    Boolean(meta?.isRemoval) ||
    /\b(destroy target|exile target|target creature gets -|fight target|bite)\b/i.test(oracle) ||
    /\b(swords to plowshares|path to exile|assassin's trophy|fatal push|beast within|anguished unmaking|pongify|rapid hybridization|chaos warp|generous gift|abrupt decay|lightning bolt|snuff out|deadly rollick)\b/i.test(
      lowerName
    );

  const isBoardWipe =
    Boolean(meta?.isBoardWipe) ||
    /\b(destroy all|exile all|return all nonland permanents|each creature gets -)\b/i.test(oracle) ||
    /\b(supreme verdict|farewell|wrath of god|damnation|blasphemous act|cyclonic rift|living death|toxic deluge|austere command|vanquish the horde|meathook massacre)\b/i.test(
      lowerName
    );

  const isTutor =
    (/\bsearch your library for\b/i.test(oracle) &&
      !/\b(basic land|plains|island|swamp|mountain|forest)\b/i.test(
        (oracle.match(/search your library for[^.]*/) || [''])[0]
      )) ||
    /\b(demonic tutor|vampiric tutor|mystical tutor|worldly tutor|enlightened tutor|imperial seal|diabolic intent|chord of calling|finale of devastation|green sun's zenith|gamble|eldritch evolution|wishclaw talisman|beseech the mirror)\b/i.test(
      lowerName
    );

  const isProtection =
    /\b(hexproof|indestructible|shroud|phases? out|protection from)\b/i.test(oracle) ||
    /\b(heroic intervention|teferi's protection|deflecting swat|flawless maneuver|swiftfoot boots|lightning greaves|mithril coat|slip out the back|tamiyo's safekeeping|blacksmith's skill|mother of runes|giver of runes)\b/i.test(
      lowerName
    );

  const isReanimator =
    /\breturn target .*creature.*from .*graveyard to the battlefield\b/i.test(oracle) ||
    /\b(reanimate|animate dead|necromancy|exhume|dread return|living death|victimize|persist|unburial rites|sheoldred, whispering one|meren of clan nel toth)\b/i.test(
      lowerName
    );

  const tokMatch = oracle.match(
    /\bcreate\s+(a|one|two|three|four|x|\d+)\s+(?:tapped\s+)?(?:(\d+)\/(\d+)|[^.]*?)?\s*(?:[^.]*?\s+)?creature tokens?\b/i
  );
  const isTokenMaker =
    Boolean(tokMatch) ||
    /\b(scute swarm|avenger of zendikar|krenko|bitterblossom|talrand|young pyromancer|third path iconoclast|adeline|mondrak|anointed procession|chatterfang|rabid|elspeth, sun's champion|rampaging baloths)\b/i.test(
      lowerName
    );
  let tokenCount = 0;
  let tokenPower = 1;
  if (isTokenMaker) {
    const cntTok = tokMatch?.[1]?.toLowerCase() || '';
    const cntWord: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, x: 3 };
    tokenCount = cntTok
      ? Number.isFinite(Number(cntTok))
        ? Math.min(5, Math.max(1, Number(cntTok)))
        : cntWord[cntTok] || 1
      : /\b(avenger of zendikar|elspeth|krenko)\b/i.test(lowerName)
      ? 3
      : 1;
    const ptMatch = oracle.match(/(\d+)\/(\d+)[^.]*creature token/i);
    if (ptMatch) {
      tokenPower = Math.max(1, Math.min(6, Number(ptMatch[1])));
    } else if (/4\/4|angel|dragon|beast/i.test(oracle + lowerName)) {
      tokenPower = /beast/i.test(oracle + lowerName) ? 3 : 4;
    } else if (/2\/2|zombie|knight|wolf/i.test(oracle + lowerName)) {
      tokenPower = 2;
    }
  }

  const isAristocratsPayoff =
    /\bwhenever (?:a|another) creature .*dies\b/i.test(oracle) ||
    /\b(blood artist|zulaport cutthroat|cruel celebrant|mayhem devil|marionette master|bastion of remembrance|teysa karlov|syr konrad|corpse knight)\b/i.test(
      lowerName
    );

  const isSacOutlet =
    /\bsacrifice (?:a|another) creature\b/i.test(oracle) ||
    /\b(ashnod's altar|phyrexian altar|viscera seer|woe strider|yawgmoth|carrion feeder|goblin bombardment|altar of dementia)\b/i.test(
      lowerName
    );

  const isLandfallPayoff =
    /\blandfall\b/i.test(oracle) ||
    /\bwhenever a land(?: you control)? enters\b/i.test(oracle) ||
    /\b(tatyova|aesi|scute swarm|rampaging baloths|lotus cobra|tireless provisioner|omnath|avenger of zendikar|hedron crab)\b/i.test(
      lowerName
    );

  const isSpellslingerPayoff =
    /\bwhenever you cast an instant or sorcery\b/i.test(oracle) ||
    /\b(magecraft|prowess)\b/i.test(oracle) ||
    /\b(niv-mizzet|guttersnipe|storm-kiln artist|veyran|talrand|young pyromancer|archmage emeritus|kykar|monastery swiftspear)\b/i.test(
      lowerName
    );

  const isEnginePermanent =
    !isCreature &&
    /\b(artifact|enchantment|planeswalker)\b/i.test(typeLine) &&
    (/\b(whenever|at the beginning of|each opponent|draw a card|treasure|create)\b/i.test(oracle) ||
      /\b(rhystic study|smothering tithe|mystic remora|sylvan library|phyrexian arena|black market connections|bolas's citadel|necropotence|esper sentinel|the one ring|chandra, torch of defiance|teferi, time raveler|elspeth, sun's champion)\b/i.test(
        lowerName
      ));

  const colorPips = parseManaCostPips(meta?.manaCost);

  const flags: CardMechanicFlags = {
    hasInfect,
    toxicValue,
    hasProliferate,
    millAmount,
    isVoltronBuff,
    burnOrDrainAmount,
    lifegainAmount,
    selfLifeLossAmount,
    isXSpell,
    isBoardPump,
    tokenCount,
    tokenPower,
    estimatedPower,
    estimatedToughness,
    extraDrawCount,
    isCounterOrRemoval,
    isCounterspell,
    isBoardWipe,
    isTutor,
    isProtection,
    isReanimator,
    isTokenMaker,
    isEnginePermanent,
    isAristocratsPayoff,
    isSacOutlet,
    isLandfallPayoff,
    isSpellslingerPayoff,
    hasFlying,
    hasReach,
    hasMenace,
    isUnblockable,
    hasEvasion,
    hasFirstStrike,
    hasDoubleStrike,
    hasHaste,
    hasVigilance,
    hasLifelink,
    hasDeathtouch,
    hasTrample,
    hitsEachOpponent,
    colorPips,
  };

  if (_mechCache.size >= MAX_RECONCILER_CACHE_SIZE) {
    _mechCache.clear();
  }
  _mechCache.set(cacheKey, flags);
  return flags;
}

export interface DeckSynergyBlueprint {
  primaryPlan: string;
  commanderRole: string;
  synergyPackages: string[];
  keyPayoffs: string[];
  tutorCount: number;
  counterspellCount: number;
  protectionCount: number;
  reanimatorCount: number;
  tokenMakerCount: number;
  engineCount: number;
  wipeCount: number;
  removalCount: number;
  rampCount: number;
  drawCount: number;
}

export function extractDeckSynergyBlueprint(
  cards: ResolvedDeckCard[]
): DeckSynergyBlueprint {
  let tutorCount = 0;
  let counterspellCount = 0;
  let protectionCount = 0;
  let reanimatorCount = 0;
  let tokenMakerCount = 0;
  let engineCount = 0;
  let wipeCount = 0;
  let removalCount = 0;
  let rampCount = 0;
  let drawCount = 0;
  let infectToxicCount = 0;
  let millCount = 0;
  let voltronCount = 0;
  let aristocratsCount = 0;
  let landfallCount = 0;
  let spellslingerCount = 0;

  const payoffScores: Array<{ name: string; score: number }> = [];
  const commanders = cards.filter((c) => c.zone === 'commander');

  for (const item of cards) {
    if (item.zone !== 'main' && item.zone !== 'commander') continue;
    const qty = Math.max(1, item.quantity);
    const m = detectCardMechanics(item.name, item.card);

    if (m.isTutor) tutorCount += qty;
    if (m.isCounterspell) counterspellCount += qty;
    if (m.isProtection) protectionCount += qty;
    if (m.isReanimator) reanimatorCount += qty;
    if (m.isTokenMaker) tokenMakerCount += qty;
    if (m.isEnginePermanent) engineCount += qty;
    if (m.isBoardWipe) wipeCount += qty;
    if (m.isCounterOrRemoval) removalCount += qty;
    if (item.card?.isRamp) rampCount += qty;
    if (item.card?.isDraw || m.extraDrawCount > 0) drawCount += qty;
    if (m.hasInfect || m.toxicValue > 0 || m.hasProliferate) infectToxicCount += qty;
    if (m.millAmount > 0) millCount += qty;
    if (m.isVoltronBuff) voltronCount += qty;
    if (m.isAristocratsPayoff || m.isSacOutlet) aristocratsCount += qty;
    if (m.isLandfallPayoff) landfallCount += qty;
    if (m.isSpellslingerPayoff) spellslingerCount += qty;

    if (item.zone === 'main' && !item.card?.isLand) {
      let score = 0;
      if (m.isEnginePermanent) score += 6;
      if (m.isTutor) score += 5;
      if (m.isReanimator || m.isAristocratsPayoff || m.isLandfallPayoff || m.isSpellslingerPayoff) {
        score += 5;
      }
      if (m.isTokenMaker || m.hasInfect || m.toxicValue > 0 || m.millAmount >= 4) score += 4;
      if (m.isBoardWipe || m.isCounterspell) score += 3;
      if ((item.card?.cmc ?? 0) >= 4) score += 2;
      if (score >= 4) {
        payoffScores.push({ name: item.name, score });
      }
    }
  }

  payoffScores.sort((a, b) => b.score - a.score);
  const keyPayoffs = Array.from(new Set(payoffScores.map((p) => p.name))).slice(0, 6);

  const strategyCandidates: Array<{ plan: string; weight: number }> = [
    { plan: 'Infect / Toxic & Proliferate', weight: infectToxicCount * 3 },
    { plan: 'Mill & Library Denial', weight: millCount * 3 },
    { plan: 'Aristocrats Drain & Sacrifice', weight: aristocratsCount * 3.5 },
    { plan: 'Landfall Ramp & Value', weight: landfallCount * 3.5 },
    { plan: 'Spellslinger / Storm Payoffs', weight: spellslingerCount * 3.2 },
    { plan: 'Graveyard Reanimator', weight: reanimatorCount * 4 },
    { plan: 'Voltron Commander Aggro', weight: voltronCount * 2.5 },
    { plan: 'Go-Wide Token Swarm', weight: tokenMakerCount * 2.6 },
    { plan: 'Draw-Go Control & Stack Interaction', weight: counterspellCount * 2.5 + wipeCount * 2.5 },
    { plan: 'Value Engines / Midrange Pod', weight: engineCount * 2 + removalCount },
  ];
  strategyCandidates.sort((a, b) => b.weight - a.weight);
  const primaryPlan =
    strategyCandidates[0].weight > 0 ? strategyCandidates[0].plan : 'Balanced Combat & Midrange';

  const synergyPackages: string[] = [];
  if (tutorCount > 0) synergyPackages.push(`Tutors (${tutorCount})`);
  if (counterspellCount > 0) synergyPackages.push(`Countermagic (${counterspellCount})`);
  if (protectionCount > 0) synergyPackages.push(`Protection (${protectionCount})`);
  if (engineCount > 0) synergyPackages.push(`Value Engines (${engineCount})`);
  if (reanimatorCount > 0) synergyPackages.push(`Reanimation (${reanimatorCount})`);
  if (tokenMakerCount > 0) synergyPackages.push(`Token Makers (${tokenMakerCount})`);
  if (aristocratsCount > 0) synergyPackages.push(`Aristocrats/Sac (${aristocratsCount})`);
  if (landfallCount > 0) synergyPackages.push(`Landfall (${landfallCount})`);
  if (spellslingerCount > 0) synergyPackages.push(`Spellslinger (${spellslingerCount})`);
  if (wipeCount > 0) synergyPackages.push(`Board Wipes (${wipeCount})`);

  let commanderRole = 'Midrange Threat / Synergy Anchor';
  if (commanders.length > 0) {
    const cmdText = commanders
      .map((c) => `${c.name} ${c.card?.oracleText || ''}`)
      .join(' ')
      .toLowerCase();
    if (/draw|whenever.*cast|treasure|proliferate/.test(cmdText)) {
      commanderRole = 'Primary Card Advantage / Engine Commander';
    } else if (/double strike|trample|infect|equipped|enchanted|commander damage/.test(cmdText)) {
      commanderRole = 'Lethal Commander-Damage / Voltron Finisher';
    } else if (/dies|sacrifice|graveyard/.test(cmdText)) {
      commanderRole = 'Graveyard / Aristocrats Engine';
    } else if (/token|land/.test(cmdText)) {
      commanderRole = 'Board Multiplier / Landfall Engine';
    }
  }

  return {
    primaryPlan,
    commanderRole,
    synergyPackages,
    keyPayoffs,
    tutorCount,
    counterspellCount,
    protectionCount,
    reanimatorCount,
    tokenMakerCount,
    engineCount,
    wipeCount,
    removalCount,
    rampCount,
    drawCount,
  };
}

export interface LondonMulliganHandResult<T extends { isLand: boolean; cmc: number; isRamp?: boolean }> {
  keptHand: T[];
  remainingLibrary: T[];
  mulliganCount: number;
  mulliganVerdict: string;
}

export function performLondonMulligan<
  T extends { name: string; isLand: boolean; cmc: number; isRamp?: boolean },
>(params: {
  library: T[];
  isMultiplayerCommander?: boolean;
  freeFirstMulligan?: boolean;
  maxMulligans?: number;
}): LondonMulliganHandResult<T> {
  const { isMultiplayerCommander, freeFirstMulligan, maxMulligans = 2 } = params;
  const hasFreeFirstMulligan = freeFirstMulligan ?? Boolean(isMultiplayerCommander);
  const shuffleLocal = (arr: T[]): T[] => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  let workingLib = shuffleLocal(params.library);
  let mulligansTaken = 0;
  let hand = workingLib.slice(0, Math.min(7, workingLib.length));

  const isKeepable = (cards: T[]): boolean => {
    const lands = cards.filter((c) => c.isLand).length;
    const earlyPlays = cards.filter((c) => !c.isLand && c.cmc <= 3).length;
    const cheapRamp = cards.filter((c) => !c.isLand && c.isRamp && c.cmc <= 2).length;
    if (lands >= 2 && lands <= 4 && (earlyPlays >= 1 || cheapRamp >= 1)) return true;
    if (lands === 1 && cheapRamp >= 1 && earlyPlays >= 2) return true;
    if (lands === 5 && earlyPlays >= 2) return true;
    return false;
  };

  const mulliganReasons: string[] = [];
  while (mulligansTaken < maxMulligans && !isKeepable(hand)) {
    const landsSeen = hand.filter((c) => c.isLand).length;
    mulliganReasons.push(
      `Mulligan #${mulligansTaken + 1} (${landsSeen} land${landsSeen === 1 ? '' : 's'} / no early curve)`
    );
    mulligansTaken += 1;
    workingLib = shuffleLocal(params.library);
    hand = workingLib.slice(0, Math.min(7, workingLib.length));
  }

  let keptHand = [...hand];
  const restOfLibrary = workingLib.slice(keptHand.length);

  // Free first mulligan in paper multiplayer pods & Brawl; standard bottom N cards in 1v1 Constructed/Limited
  const cardsToBottom = hasFreeFirstMulligan
    ? Math.max(0, mulligansTaken - 1)
    : mulligansTaken;

  const bottomed: T[] = [];
  for (let b = 0; b < cardsToBottom; b++) {
    const landCount = keptHand.filter((c) => c.isLand).length;
    let dropIdx = -1;
    if (landCount >= 5) {
      dropIdx = keptHand.findIndex((c) => c.isLand);
    }
    if (dropIdx === -1) {
      let highestCmc = -1;
      keptHand.forEach((c, idx) => {
        if (!c.isLand && c.cmc > highestCmc) {
          highestCmc = c.cmc;
          dropIdx = idx;
        }
      });
    }
    if (dropIdx === -1) dropIdx = keptHand.length - 1;
    if (dropIdx >= 0) {
      const [removed] = keptHand.splice(dropIdx, 1);
      bottomed.push(removed);
    }
  }

  const finalLibrary = [...restOfLibrary, ...bottomed];
  const finalLands = keptHand.filter((c) => c.isLand).length;
  const verdict =
    mulligansTaken === 0
      ? `Kept opening 7 (${finalLands} lands, smooth early curve).`
      : `${mulliganReasons.join(' -> ')} -> Kept ${keptHand.length} (${finalLands} lands${
          hasFreeFirstMulligan && mulligansTaken === 1 ? ', free first mulligan' : ''
        }).`;

  return {
    keptHand,
    remainingLibrary: finalLibrary,
    mulliganCount: mulligansTaken,
    mulliganVerdict: verdict,
  };
}

export function detectArchetypeCombatBias(
  opp: BotOpponentConfig,
  resolvedCustomCards: ResolvedDeckCard[] = [],
  format: Exclude<DeckFormat, 'auto'> = 'commander'
): ArchetypeCombatBias {
  const lowerArch = (opp.archetype || '').toLowerCase();
  const customText = (opp.customDeckText || '').toLowerCase();
  const customJoined =
    customText +
    ' ' +
    resolvedCustomCards
      .map((c) => `${c.name} ${c.card?.oracleText || ''} ${c.card?.typeLine || ''}`)
      .join(' ')
      .toLowerCase();

  const allowsCommandZone = format === 'commander' || format === 'brawl';
  const customCmds = allowsCommandZone
    ? resolvedCustomCards.filter((c) => c.zone === 'commander').map((c) => c.name)
    : [];
  const customCmd = customCmds.join(' & ');

  let landCount = 0;
  let wipeCount = 0;
  let removalCount = 0;
  let rampCount = 0;
  for (const c of resolvedCustomCards) {
    if (c.zone !== 'main' && c.zone !== 'commander') continue;
    const mech = detectCardMechanics(c.name, c.card);
    if (c.card?.isLand) landCount += c.quantity;
    if (mech.isBoardWipe) wipeCount += c.quantity;
    if (mech.isCounterOrRemoval) removalCount += c.quantity;
    if (c.card?.isRamp) rampCount += c.quantity;
  }

  const usesInfect =
    /infect/i.test(lowerArch) ||
    /\b(infect|blighted agent|skithiryx|glistener elf|grafted exoskeleton|tainted strike|phyresis|ichor rats)\b/i.test(
      customJoined
    );
  const usesToxic =
    /toxic|poison/i.test(lowerArch) ||
    /\b(toxic|corrupted|venerated rotpriest|bloated contaminator|tyrranax rex|skrelv|prologue to phyresis)\b/i.test(
      customJoined
    );
  const usesProliferate =
    usesInfect ||
    usesToxic ||
    /\b(proliferate|atraxa|inexorable tide|flux channeler|experimental augury)\b/i.test(
      customJoined
    );
  const usesMill =
    /mill|library/i.test(lowerArch) ||
    /\b(mill|maddening cacophony|mesmeric orb|mindcrank|hedron crab|ruin crab|bruvac|traumatize|ashiok|phenax|fraying sanity)\b/i.test(
      customJoined
    );
  const usesVoltronCommander =
    allowsCommandZone &&
    (/voltron|commander damage/i.test(lowerArch) ||
      /\b(colossus hammer|embercleave|blackblade reforged|rafiq|zurgo|slicer|godo|light-paws|issin)\b/i.test(
        customJoined
      ));
  const usesBurnDrain =
    /aggro|burn|aristocrats|drain|spellslinger/i.test(lowerArch) ||
    /\b(lightning bolt|lightning strike|blood artist|zulaport|sheoldred|guttersnipe|torment of hailfire)\b/i.test(
      customJoined
    );
  const usesControl =
    /control|countermagic|midrange/i.test(lowerArch) ||
    /\b(counterspell|dovin's veto|supreme verdict|cyclonic rift|wrath of god|sunfall|negate)\b/i.test(
      customJoined
    );

  const defaultCommanderName = !allowsCommandZone
    ? ''
    : customCmd
    ? customCmd
    : usesInfect || usesToxic
    ? "Atraxa, Praetors' Voice"
    : usesMill
    ? 'Phenax, God of Deception'
    : usesVoltronCommander
    ? 'Slicer, Hired Muscle'
    : /mono-red|burn/i.test(lowerArch)
    ? 'Torbran, Thane of Red Fell'
    : /azorius|control/i.test(lowerArch)
    ? 'Grand Arbiter Augustin IV'
    : /dimir/i.test(lowerArch)
    ? "Yuriko, the Tiger's Shadow"
    : /simic/i.test(lowerArch)
    ? 'Aesi, Tyrant of Gyre Strait'
    : /golgari/i.test(lowerArch)
    ? 'Meren of Clan Nel Toth'
    : /orzhov/i.test(lowerArch)
    ? 'Teysa Karlov'
    : /izzet/i.test(lowerArch)
    ? 'Niv-Mizzet, Parun'
    : /gruul/i.test(lowerArch)
    ? 'Xenagos, God of Revels'
    : `${opp.name} Commander`;

  return {
    defaultCommanderName,
    commanderNames: !allowsCommandZone
      ? []
      : customCmds.length > 0
      ? customCmds
      : [defaultCommanderName],
    usesInfect,
    usesToxic,
    usesProliferate,
    usesMill,
    usesVoltronCommander,
    usesBurnDrain,
    usesControl,
    basePowerFactor: usesVoltronCommander ? 1.5 : usesControl ? 0.75 : 1.0,
    landCount,
    wipeCount,
    removalCount,
    rampCount,
  };
}

function getEliminationReason(
  life: number,
  poison: number,
  cmdMap: Map<string, number>,
  deckedOut: boolean,
  usesCommanderDamage21 = true
): 'life' | 'poison' | 'commander' | 'mill' | null {
  if (poison >= 10) return 'poison';
  if (usesCommanderDamage21) {
    for (const dmg of cmdMap.values()) {
      if (dmg >= 21) return 'commander';
    }
  }
  if (life <= 0) return 'life';
  if (deckedOut) return 'mill';
  return null;
}

function resolveTargetParticipantName(
  rawTarget: string | undefined,
  attackerName: string,
  orderedNames: string[]
): string {
  const cleaned = (typeof rawTarget === 'string' ? rawTarget : '').trim().toLowerCase();
  if (!cleaned || cleaned === 'you' || cleaned === 'player' || cleaned === 'human') {
    return 'You';
  }
  const attackerLower = (typeof attackerName === 'string' ? attackerName : '').trim().toLowerCase();

  // Exact match
  for (const name of orderedNames) {
    const lower = (typeof name === 'string' ? name : '').trim().toLowerCase();
    if (!lower || lower === attackerLower) continue;
    if (lower === cleaned) return name;
  }

  // Substring / prefix match (e.g. "Bot 2" -> "Bot 2 (Lyra)")
  for (const name of orderedNames) {
    const lower = (typeof name === 'string' ? name : '').trim().toLowerCase();
    if (!lower || lower === attackerLower || lower === 'you') continue;
    if (lower.includes(cleaned) || cleaned.includes(lower)) return name;
  }

  return 'You';
}

export interface ReconcilePlaytestInput {
  rounds: PlaytestRound[];
  startingLife: number;
  format: Exclude<DeckFormat, 'auto'>;
  mode?: PlaytestMode;
  playerMainDeckCount: number;
  playerOpeningHandSize?: number;
  playerCommanderNames: string[];
  opponents: Array<{
    name: string;
    archetype: string;
    commanderName?: string;
    deckSize?: number;
    openingHandSize?: number;
  }>;
  reportedOutcome?: 'win' | 'loss' | 'close';
}

/**
 * Reconciles every round's HP, Poison Counters (Toxic/Infect), Per-Bot Commander Damage (to 21 in Commander),
 * Library Remaining / Mill counts, Graveyard size, inter-bot combat/removal, and final single-winner state
 * so all displayed numbers match 100% mathematically across rounds, sidebar log, and final scoreboard.
 */
export function reconcilePlaytestMatchStats(input: ReconcilePlaytestInput): {
  rounds: PlaytestRound[];
  finalStats: PlaytestFinalStatsSummary;
  outcome: 'win' | 'loss' | 'close';
} {
  const {
    rounds,
    startingLife,
    format,
    mode,
    playerMainDeckCount,
    playerOpeningHandSize,
    playerCommanderNames,
    opponents,
    reportedOutcome,
  } = input;

  const inferredMode: PlaytestMode =
    mode || (opponents.length <= 1 ? '1v1' : opponents.length === 2 ? '1v2' : '1v3');
  const formatRules = getFormatSimulationRules(
    format,
    inferredMode,
    playerMainDeckCount + playerCommanderNames.length
  );

  const effectiveStartingLife = startingLife || formatRules.startingLife;
  const formatDeckTarget = formatRules.targetMainDeckSize;
  const effectivePlayerDeckTotal =
    playerMainDeckCount > 0 ? playerMainDeckCount : formatDeckTarget;
  const effectivePlayerHand = Math.min(
    effectivePlayerDeckTotal,
    playerOpeningHandSize ?? Math.min(7, effectivePlayerDeckTotal)
  );
  const startPlayerLib = Math.max(0, effectivePlayerDeckTotal - effectivePlayerHand);

  const playerPrimaryCommander = formatRules.allowsCommandZone
    ? playerCommanderNames[0] || 'Your Commander'
    : '';

  interface MutableParticipant {
    player: string;
    life: number;
    poison: number;
    cmdTaken: Map<string, number>;
    libraryRemaining: number;
    cardsMilledTotal: number;
    graveyardCount: number;
    handSize: number;
    landsInPlay: number;
    manaAvailable: number;
    creaturesInPlay: number;
    eliminatedBy: 'life' | 'poison' | 'commander' | 'mill' | null;
    eliminatedRound: number | null;
    commanderSourceLabel: string;
  }

  const stateByName = new Map<string, MutableParticipant>();
  stateByName.set('You', {
    player: 'You',
    life: effectiveStartingLife,
    poison: 0,
    cmdTaken: new Map<string, number>(),
    libraryRemaining: startPlayerLib,
    cardsMilledTotal: 0,
    graveyardCount: 0,
    handSize: effectivePlayerHand,
    landsInPlay: 0,
    manaAvailable: 0,
    creaturesInPlay: 0,
    eliminatedBy: null,
    eliminatedRound: null,
    commanderSourceLabel: playerPrimaryCommander,
  });

  for (const opp of opponents) {
    const oppDeckTotal = opp.deckSize && opp.deckSize > 0 ? opp.deckSize : formatDeckTarget;
    const oppOpeningHand = Math.min(
      oppDeckTotal,
      opp.openingHandSize ?? Math.min(7, oppDeckTotal)
    );
    const startLib = Math.max(0, oppDeckTotal - oppOpeningHand);
    stateByName.set(opp.name, {
      player: opp.name,
      life: effectiveStartingLife,
      poison: 0,
      cmdTaken: new Map<string, number>(),
      libraryRemaining: startLib,
      cardsMilledTotal: 0,
      graveyardCount: 0,
      handSize: oppOpeningHand,
      landsInPlay: 0,
      manaAvailable: 0,
      creaturesInPlay: 0,
      eliminatedBy: null,
      eliminatedRound: null,
      commanderSourceLabel: formatRules.allowsCommandZone
        ? opp.commanderName || `${opp.name} Cmdr`
        : '',
    });
  }

  const orderedNames = ['You', ...opponents.map((o) => o.name)];
  let matchWinCondition: WinConditionType = 'points-lead';
  let lastEliminationReason: 'life' | 'poison' | 'commander' | 'mill' | null = null;
  let lastEliminatedRound = 0;

  const markEliminated = (
    p: MutableParticipant,
    reason: 'life' | 'poison' | 'commander' | 'mill',
    roundNum: number
  ) => {
    if (p.eliminatedBy) return;
    p.eliminatedBy = reason;
    p.eliminatedRound = roundNum;
    p.creaturesInPlay = 0;
    p.manaAvailable = 0;
    p.handSize = 0;
    lastEliminationReason = reason;
    lastEliminatedRound = roundNum;
  };

  const reconciledRounds: PlaytestRound[] = rounds.map((round, roundIdx) => {
    const you = stateByName.get('You')!;
    const prevPlayerLife = you.life;
    const prevPlayerPoison = you.poison;
    const prevPlayerCmd = new Map(you.cmdTaken);
    let playerMilledThisRound = 0;
    let playerDecked = false;

    const botTurnDeltas = new Map<
      string,
      {
        prevLife: number;
        prevPoison: number;
        prevCmd: Map<string, number>;
        milledThisRound: number;
        decked: boolean;
      }
    >();

    for (const opp of opponents) {
      const b = stateByName.get(opp.name)!;
      botTurnDeltas.set(opp.name, {
        prevLife: b.life,
        prevPoison: b.poison,
        prevCmd: new Map(b.cmdTaken),
        milledThisRound: 0,
        decked: false,
      });
    }

    const roundNum = round.roundNumber || roundIdx + 1;

    // 1. Player Draw Step & Cast Spells
    if (!you.eliminatedBy) {
      if (roundIdx > 0 || !formatRules.playerSkipsTurn1Draw) {
        if (you.libraryRemaining > 0) {
          you.libraryRemaining = Math.max(0, you.libraryRemaining - 1);
        } else {
          playerDecked = true;
        }
      }
      const extraDraws = Math.max(0, round.playerStats?.cardsDrawnExtra ?? 0);
      if (extraDraws > 0) {
        if (you.libraryRemaining < extraDraws) {
          you.libraryRemaining = 0;
          playerDecked = true;
        } else {
          you.libraryRemaining -= extraDraws;
        }
      }
      you.landsInPlay = Math.max(you.landsInPlay, round.landsInPlay ?? you.landsInPlay);
      you.manaAvailable = Math.max(0, round.manaAvailable ?? you.manaAvailable);
      you.handSize = Math.max(0, (round.handSnapshot || []).length);
      if (round.playerStats) {
        you.creaturesInPlay = Math.max(0, round.playerStats.creaturesOnBoard ?? you.creaturesInPlay);
        const gain = Math.max(0, round.playerStats.lifeGained ?? 0);
        const loss = Math.max(0, round.playerStats.selfLifeLoss ?? 0);
        you.life = Math.max(0, you.life + gain - loss);
      } else {
        const nonLandPlayed = (Array.isArray(round.cardsPlayed) ? round.cardsPlayed : []).filter(
          (c) => !/island|forest|swamp|mountain|plains|command tower|land/i.test(String(c))
        ).length;
        you.creaturesInPlay = Math.max(
          you.creaturesInPlay,
          nonLandPlayed > 0 ? you.creaturesInPlay + 1 : you.creaturesInPlay
        );
      }
      const nonLandCastApprox = (Array.isArray(round.cardsPlayed) ? round.cardsPlayed : []).filter(
        (c) => !/island|forest|swamp|mountain|plains|command tower|land/i.test(String(c))
      ).length;
      if (nonLandCastApprox > 0) {
        you.graveyardCount += 1;
      }

      const immediateSelfElim = getEliminationReason(
        you.life,
        you.poison,
        you.cmdTaken,
        playerDecked,
        formatRules.usesCommanderDamage21
      );
      if (immediateSelfElim) {
        markEliminated(you, immediateSelfElim, roundNum);
      }
    }

    const roundBotPlays = Array.isArray(round.botPlays) ? round.botPlays : [];
    const roundLifeTotals = Array.isArray(round.lifeTotals) ? round.lifeTotals : [];

    const geminiReportedLifeByPlayer = new Map<string, number>();
    for (const lt of roundLifeTotals) {
      if (typeof lt?.player === 'string' && lt.player.trim()) {
        geminiReportedLifeByPlayer.set(lt.player.trim().toLowerCase(), lt.life);
      }
    }

    let hasExplicitBotCombatNumbers = false;
    let anyExplicitDamageTakenFromYou = false;
    for (const bp of roundBotPlays) {
      if (
        typeof bp.lifeChangeToYou === 'number' ||
        typeof bp.poisonToYou === 'number' ||
        typeof bp.commanderDamageToYou === 'number' ||
        typeof bp.millToYou === 'number' ||
        typeof bp.targetLifeDelta === 'number' ||
        typeof bp.targetPoisonDelta === 'number' ||
        typeof bp.targetCommanderDamage === 'number' ||
        typeof bp.targetMillAmount === 'number' ||
        typeof bp.eachOpponentLifeDelta === 'number' ||
        typeof bp.eachOpponentPoison === 'number' ||
        typeof bp.eachOpponentMill === 'number' ||
        typeof bp.damageTakenFromYou === 'number'
      ) {
        hasExplicitBotCombatNumbers = true;
      }
      if ((bp.damageTakenFromYou ?? 0) > 0 || (bp.commanderDamageTakenFromYou ?? 0) > 0 || (bp.poisonTakenFromYou ?? 0) > 0 || (bp.millTakenFromYou ?? 0) > 0) {
        anyExplicitDamageTakenFromYou = true;
      }
    }

    const rawPlayerTarget = (typeof round.playerStats?.targetBot === 'string' ? round.playerStats.targetBot : '').trim().toLowerCase();
    let preferredPlayerTargetIdx = -1;
    if (rawPlayerTarget) {
      preferredPlayerTargetIdx = roundBotPlays.findIndex((bp, idx) => {
        const oppName =
          opponents.find(
            (o) => (o?.name || '').trim().toLowerCase() === (bp?.botName || '').trim().toLowerCase()
          )?.name ||
          opponents[idx]?.name ||
          bp?.botName ||
          '';
        const st = stateByName.get(oppName);
        if (!st || st.eliminatedBy) return false;
        const lowerOpp = oppName.trim().toLowerCase();
        return (
          lowerOpp === rawPlayerTarget ||
          lowerOpp.includes(rawPlayerTarget) ||
          rawPlayerTarget.includes(lowerOpp)
        );
      });
    }

    const firstAliveBotIdx = roundBotPlays.findIndex((bp, idx) => {
      const oppName =
        opponents.find(
          (o) => (o?.name || '').trim().toLowerCase() === (bp?.botName || '').trim().toLowerCase()
        )?.name ||
        opponents[idx]?.name ||
        bp?.botName ||
        '';
      const st = stateByName.get(oppName);
      return Boolean(st && !st.eliminatedBy);
    });
    const fallbackTargetIdx =
      preferredPlayerTargetIdx !== -1
        ? preferredPlayerTargetIdx
        : Math.max(0, firstAliveBotIdx);

    // 2. Apply Player's Offense + Each Bot's Turn & Inter-Bot Combat
    let distributedPlayerCombatFallback = false;
    const totalPlayerDealtCombat = Math.max(0, round.playerStats?.combatDamageDealt ?? 0);
    const totalPlayerCmdDealt = Math.max(0, round.playerStats?.commanderDamageDealt ?? 0);
    const totalPlayerPoisonDealt = Math.max(0, round.playerStats?.poisonDealt ?? 0);
    const totalPlayerMillDealt = Math.max(0, round.playerStats?.millDealt ?? 0);

    // First pass: apply Player's damage/poison/commander/mill to targeted bots + eachOpponent player effects
    const playerEachOppLifeDelta = round.playerStats?.eachOpponentLifeDelta ?? 0;
    const playerEachOppPoison = Math.max(0, round.playerStats?.eachOpponentPoison ?? 0);
    const playerEachOppMill = Math.max(0, round.playerStats?.eachOpponentMill ?? 0);

    roundBotPlays.forEach((bp, idx) => {
      const oppName =
        opponents.find(
          (o) => (o?.name || '').trim().toLowerCase() === (bp?.botName || '').trim().toLowerCase()
        )?.name ||
        opponents[idx]?.name ||
        bp?.botName ||
        '';

      const botState = stateByName.get(oppName);
      if (!botState || botState.eliminatedBy) return;
      const botMeta = botTurnDeltas.get(oppName)!;

      const fallbackReceiver =
        !anyExplicitDamageTakenFromYou &&
        idx === fallbackTargetIdx &&
        !distributedPlayerCombatFallback;

      const dmgFromPlayer =
        typeof bp.damageTakenFromYou === 'number'
          ? Math.max(0, bp.damageTakenFromYou)
          : !hasExplicitBotCombatNumbers &&
            geminiReportedLifeByPlayer.has(oppName.toLowerCase())
          ? Math.max(
              0,
              botMeta.prevLife -
                (geminiReportedLifeByPlayer.get(oppName.toLowerCase()) ?? botMeta.prevLife)
            )
          : fallbackReceiver
          ? totalPlayerDealtCombat
          : 0;

      const cmdDmgFromPlayer =
        formatRules.usesCommanderDamage21 && !you.eliminatedBy
          ? typeof bp.commanderDamageTakenFromYou === 'number'
            ? Math.max(0, bp.commanderDamageTakenFromYou)
            : fallbackReceiver
            ? totalPlayerCmdDealt
            : 0
          : 0;

      const poisonFromPlayer =
        typeof bp.poisonTakenFromYou === 'number'
          ? Math.max(0, bp.poisonTakenFromYou)
          : fallbackReceiver
          ? totalPlayerPoisonDealt
          : 0;

      const millFromPlayer =
        typeof bp.millTakenFromYou === 'number'
          ? Math.max(0, bp.millTakenFromYou)
          : fallbackReceiver
          ? totalPlayerMillDealt
          : 0;

      if (fallbackReceiver) distributedPlayerCombatFallback = true;

      botState.life = Math.max(0, botState.life - dmgFromPlayer + playerEachOppLifeDelta);
      const totalPoisonThisPass = poisonFromPlayer + playerEachOppPoison;
      if (totalPoisonThisPass > 0) {
        botState.poison = Math.min(20, botState.poison + totalPoisonThisPass);
      }
      if (cmdDmgFromPlayer > 0 && playerPrimaryCommander && formatRules.usesCommanderDamage21) {
        const prevC = botState.cmdTaken.get(playerPrimaryCommander) || 0;
        botState.cmdTaken.set(playerPrimaryCommander, prevC + cmdDmgFromPlayer);
      }
      const totalMillThisPass = millFromPlayer + playerEachOppMill;
      if (totalMillThisPass > 0) {
        const actualMill = Math.min(botState.libraryRemaining, totalMillThisPass);
        botState.libraryRemaining -= actualMill;
        botState.cardsMilledTotal += actualMill;
        botState.graveyardCount += actualMill;
        botMeta.milledThisRound += actualMill;
      }

      const postPlayerElim = getEliminationReason(
        botState.life,
        botState.poison,
        botState.cmdTaken,
        botMeta.decked,
        formatRules.usesCommanderDamage21
      );
      if (postPlayerElim && !botState.eliminatedBy) {
        markEliminated(botState, postPlayerElim, roundNum);
      }
    });

    // Second pass: each surviving bot takes its turn (draw, board progression, self life, offense to You or rival Bot, wipes)
    roundBotPlays.forEach((bp, idx) => {
      const oppName =
        opponents.find(
          (o) => (o?.name || '').trim().toLowerCase() === (bp?.botName || '').trim().toLowerCase()
        )?.name ||
        opponents[idx]?.name ||
        bp?.botName ||
        '';

      const botState = stateByName.get(oppName);
      if (!botState) return;
      const botMeta = botTurnDeltas.get(oppName)!;

      // If this bot was eliminated before its turn (prior round, on Your turn, decked out, or by earlier bot this round), it takes no action
      if (botState.eliminatedBy || bp.eliminatedThisTurn) {
        if (!botState.eliminatedBy) {
          const inferredReason =
            getEliminationReason(
              botState.life,
              botState.poison,
              botState.cmdTaken,
              botState.libraryRemaining <= 0,
              formatRules.usesCommanderDamage21
            ) || 'mill';
          markEliminated(botState, inferredReason, roundNum);
        } else {
          botState.creaturesInPlay = 0;
          botState.manaAvailable = 0;
          botState.handSize = 0;
        }
        return;
      }

      // CR 104.2a: if all other participants were already eliminated earlier this round, this bot is the sole survivor and wins immediately without drawing.
      const anyLivingRivalForBot = orderedNames.some(
        (n) => n !== oppName && !stateByName.get(n)?.eliminatedBy
      );
      if (!anyLivingRivalForBot) {
        return;
      }

      // Bot Draw Step
      if (botState.libraryRemaining > 0) {
        botState.libraryRemaining = Math.max(0, botState.libraryRemaining - 1);
      } else {
        botMeta.decked = true;
      }

      // Check deck-out on draw step immediately
      if (botMeta.decked) {
        markEliminated(botState, 'mill', roundNum);
        return;
      }

      // Bot Mana / Board Progression
      botState.landsInPlay = Math.max(
        botState.landsInPlay,
        bp.landsInPlay ?? Math.min(round.roundNumber, botState.landsInPlay + 1)
      );
      botState.manaAvailable = Math.max(0, bp.manaAvailable ?? botState.landsInPlay);
      botState.creaturesInPlay = Math.max(
        0,
        bp.creaturesOnBoard ??
          Math.min(6, Math.max(botState.creaturesInPlay, Math.ceil(round.roundNumber / 2)))
      );
      botState.handSize = Math.max(
        0,
        bp.handSize ?? Math.max(1, 6 - Math.floor(round.roundNumber / 2))
      );

      // Self-mill & self lifegain / lifeloss
      if (typeof bp.cardsMilledThisTurn === 'number' && bp.cardsMilledThisTurn > botMeta.milledThisRound) {
        const extraSelfMill = Math.min(
          botState.libraryRemaining,
          bp.cardsMilledThisTurn - botMeta.milledThisRound
        );
        botState.libraryRemaining -= extraSelfMill;
        botState.cardsMilledTotal += extraSelfMill;
        botState.graveyardCount += extraSelfMill;
        botMeta.milledThisRound += extraSelfMill;
      }

      const botSelfGain = Math.max(0, bp.selfLifeGain ?? 0);
      const botSelfLoss = Math.max(0, bp.selfLifeLoss ?? 0);
      botState.life = Math.max(0, botState.life + botSelfGain - botSelfLoss);

      // Board wipe swept all active players/bots' creatures
      if (bp.boardWipeCast) {
        for (const pName of orderedNames) {
          if (pName === oppName) continue;
          const pSt = stateByName.get(pName);
          if (pSt) pSt.creaturesInPlay = 0;
        }
        if (typeof bp.creaturesOnBoard !== 'number') {
          botState.creaturesInPlay = 0;
        }
      }

      // Determine exact target for this bot's combat/spell interaction
      const targetName = resolveTargetParticipantName(
        bp.targetParticipant,
        oppName,
        orderedNames
      );
      const targetState = stateByName.get(targetName);
      const sourceCmdr =
        bp.commanderName || botState.commanderSourceLabel || `${oppName} Cmdr`;

      // Apply spot removal / combat trade creature losses to target
      if (targetState && !targetState.eliminatedBy && (bp.creaturesRemovedOnTarget ?? 0) > 0) {
        targetState.creaturesInPlay = Math.max(
          0,
          targetState.creaturesInPlay - Math.max(0, bp.creaturesRemovedOnTarget ?? 0)
        );
      }

      if (targetName === 'You') {
        if (!you.eliminatedBy) {
          let lifeDeltaToYou =
            typeof bp.lifeChangeToYou === 'number' && bp.lifeChangeToYou !== 0
              ? bp.lifeChangeToYou
              : typeof bp.targetLifeDelta === 'number' && bp.targetLifeDelta !== 0
              ? bp.targetLifeDelta
              : 0;

          if (!hasExplicitBotCombatNumbers && lifeDeltaToYou === 0) {
            const actionDmgMatch = (bp.action || '').match(/(\d+)\s+(?:combat\s+)?damage/i);
            if (actionDmgMatch) {
              lifeDeltaToYou = -Number(actionDmgMatch[1]);
            }
          }

          const poisonToYou = Math.max(
            0,
            bp.poisonToYou ?? 0,
            bp.targetPoisonDelta ?? 0
          );
          const cmdDmgToYou = formatRules.usesCommanderDamage21
            ? Math.max(0, bp.commanderDamageToYou ?? 0, bp.targetCommanderDamage ?? 0)
            : 0;
          const millToYou = Math.max(
            0,
            bp.millToYou ?? 0,
            bp.targetMillAmount ?? 0
          );

          const effectiveLifeDelta =
            lifeDeltaToYou !== 0
              ? lifeDeltaToYou
              : cmdDmgToYou > 0 && poisonToYou === 0
              ? -cmdDmgToYou
              : 0;

          you.life = Math.max(0, you.life + effectiveLifeDelta);
          if (poisonToYou > 0) {
            you.poison = Math.min(20, you.poison + poisonToYou);
          }
          if (cmdDmgToYou > 0 && formatRules.usesCommanderDamage21) {
            const prevC = you.cmdTaken.get(sourceCmdr) || 0;
            you.cmdTaken.set(sourceCmdr, prevC + cmdDmgToYou);
          }
          if (millToYou > 0) {
            const actualMill = Math.min(you.libraryRemaining, millToYou);
            you.libraryRemaining -= actualMill;
            you.cardsMilledTotal += actualMill;
            you.graveyardCount += actualMill;
            playerMilledThisRound += actualMill;
          }
          const midYouElim = getEliminationReason(
            you.life,
            you.poison,
            you.cmdTaken,
            playerDecked,
            formatRules.usesCommanderDamage21
          );
          if (midYouElim) {
            markEliminated(you, midYouElim, roundNum);
          }
        }
      } else if (targetState && !targetState.eliminatedBy) {
        // Inter-bot combat / removal / poison / commander / mill against another bot in the pod
        const targetBotMeta = botTurnDeltas.get(targetName);
        const tPoison = Math.max(0, bp.targetPoisonDelta ?? 0);
        const tCmd = formatRules.usesCommanderDamage21
          ? Math.max(0, bp.targetCommanderDamage ?? 0)
          : 0;
        const tMill = Math.max(0, bp.targetMillAmount ?? 0);
        let tLifeDelta = typeof bp.targetLifeDelta === 'number' ? bp.targetLifeDelta : 0;

        if (tLifeDelta === 0 && tCmd > 0 && tPoison === 0) {
          tLifeDelta = -tCmd;
        }
        if (
          tLifeDelta === 0 &&
          tPoison === 0 &&
          tCmd === 0 &&
          tMill === 0 &&
          !hasExplicitBotCombatNumbers
        ) {
          const actionDmgMatch = (bp.action || '').match(/(\d+)\s+(?:combat\s+)?damage/i);
          if (actionDmgMatch) {
            tLifeDelta = -Number(actionDmgMatch[1]);
          }
        }

        targetState.life = Math.max(0, targetState.life + tLifeDelta);
        if (tPoison > 0) {
          targetState.poison = Math.min(20, targetState.poison + tPoison);
        }
        if (tCmd > 0 && formatRules.usesCommanderDamage21) {
          const prevC = targetState.cmdTaken.get(sourceCmdr) || 0;
          targetState.cmdTaken.set(sourceCmdr, prevC + tCmd);
        }
        if (tMill > 0 && targetBotMeta) {
          const actualMill = Math.min(targetState.libraryRemaining, tMill);
          targetState.libraryRemaining -= actualMill;
          targetState.cardsMilledTotal += actualMill;
          targetState.graveyardCount += actualMill;
          targetBotMeta.milledThisRound += actualMill;
        }

        const targetElim = getEliminationReason(
          targetState.life,
          targetState.poison,
          targetState.cmdTaken,
          targetBotMeta?.decked ?? false,
          formatRules.usesCommanderDamage21
        );
        if (targetElim && !targetState.eliminatedBy) {
          markEliminated(targetState, targetElim, roundNum);
        }

        // Also apply any explicit "each opponent" spill damage/poison/mill to You if reported alongside inter-bot targeting
        if (!you.eliminatedBy) {
          const spillLife =
            typeof bp.lifeChangeToYou === 'number' && bp.lifeChangeToYou !== 0
              ? bp.lifeChangeToYou
              : typeof bp.eachOpponentLifeDelta === 'number'
              ? bp.eachOpponentLifeDelta
              : 0;
          const spillPoison = Math.max(
            0,
            bp.poisonToYou ?? 0,
            bp.eachOpponentPoison ?? 0
          );
          const spillMill = Math.max(
            0,
            bp.millToYou ?? 0,
            bp.eachOpponentMill ?? 0
          );
          if (spillLife !== 0) {
            you.life = Math.max(0, you.life + spillLife);
          }
          if (spillPoison > 0) {
            you.poison = Math.min(20, you.poison + spillPoison);
          }
          if (spillMill > 0) {
            const actualMill = Math.min(you.libraryRemaining, spillMill);
            you.libraryRemaining -= actualMill;
            you.cardsMilledTotal += actualMill;
            you.graveyardCount += actualMill;
            playerMilledThisRound += actualMill;
          }
          const midYouSpillElim = getEliminationReason(
            you.life,
            you.poison,
            you.cmdTaken,
            playerDecked,
            formatRules.usesCommanderDamage21
          );
          if (midYouSpillElim) {
            markEliminated(you, midYouSpillElim, roundNum);
          }
        }
      }

      // Apply "each opponent" group-slug / drain / proliferate spill to any OTHER living bots besides attacker & primary target
      const eachLife = typeof bp.eachOpponentLifeDelta === 'number' ? bp.eachOpponentLifeDelta : 0;
      const eachPoison = Math.max(0, bp.eachOpponentPoison ?? 0);
      const eachMill = Math.max(0, bp.eachOpponentMill ?? 0);
      if (eachLife !== 0 || eachPoison > 0 || eachMill > 0) {
        for (const otherOpp of opponents) {
          if (otherOpp.name === oppName || otherOpp.name === targetName) continue;
          const otherState = stateByName.get(otherOpp.name);
          const otherMeta = botTurnDeltas.get(otherOpp.name);
          if (!otherState || otherState.eliminatedBy) continue;
          if (eachLife !== 0) {
            otherState.life = Math.max(0, otherState.life + eachLife);
          }
          if (eachPoison > 0) {
            otherState.poison = Math.min(20, otherState.poison + eachPoison);
          }
          if (eachMill > 0 && otherMeta) {
            const actualMill = Math.min(otherState.libraryRemaining, eachMill);
            otherState.libraryRemaining -= actualMill;
            otherState.cardsMilledTotal += actualMill;
            otherState.graveyardCount += actualMill;
            otherMeta.milledThisRound += actualMill;
          }
          const otherElim = getEliminationReason(
            otherState.life,
            otherState.poison,
            otherState.cmdTaken,
            otherMeta?.decked ?? false,
            formatRules.usesCommanderDamage21
          );
          if (otherElim && !otherState.eliminatedBy) {
            markEliminated(otherState, otherElim, roundNum);
          }
        }
      }

      const selfElim = getEliminationReason(
        botState.life,
        botState.poison,
        botState.cmdTaken,
        botMeta.decked,
        formatRules.usesCommanderDamage21
      );
      if (selfElim && !botState.eliminatedBy) {
        markEliminated(botState, selfElim, roundNum);
      }
    });

    // If AI mode omitted individual combat fields altogether but gave exact `You` lifeTotals,
    // honor `You` life from Gemini
    if (!hasExplicitBotCombatNumbers && geminiReportedLifeByPlayer.has('you') && you.poison === 0 && !you.eliminatedBy) {
      const gemYouLife = Math.max(0, geminiReportedLifeByPlayer.get('you') ?? you.life);
      if (you.life === prevPlayerLife && gemYouLife !== prevPlayerLife) {
        you.life = gemYouLife;
      }
    }

    // Apply off-turn triggered life deltas ONLY to living participants
    if (round.offTurnLifeDeltas && typeof round.offTurnLifeDeltas === 'object') {
      for (const [pName, delta] of Object.entries(round.offTurnLifeDeltas)) {
        if (typeof delta !== 'number' || delta === 0) continue;
        const st = stateByName.get(pName);
        if (st && !st.eliminatedBy) {
          st.life = Math.max(0, st.life + delta);
        }
      }
    }

    const youElim = getEliminationReason(
      you.life,
      you.poison,
      you.cmdTaken,
      playerDecked,
      formatRules.usesCommanderDamage21
    );
    if (youElim && !you.eliminatedBy) {
      markEliminated(you, youElim, roundNum);
    }

    // Final end-of-round elimination sweep across all bots (catches late-round inter-bot & off-turn drain kills)
    for (const opp of opponents) {
      const st = stateByName.get(opp.name)!;
      const meta = botTurnDeltas.get(opp.name)!;
      const elim = getEliminationReason(
        st.life,
        st.poison,
        st.cmdTaken,
        meta.decked,
        formatRules.usesCommanderDamage21
      );
      if (elim && !st.eliminatedBy) {
        markEliminated(st, elim, roundNum);
      }
    }

    // Build synchronized participantStats snapshot for this round
    const participantStats: PlayerRoundCombatStats[] = orderedNames.map((pName) => {
      const st = stateByName.get(pName)!;
      const isYou = pName === 'You';
      const prevLife = isYou ? prevPlayerLife : botTurnDeltas.get(pName)!.prevLife;
      const prevPoison = isYou ? prevPlayerPoison : botTurnDeltas.get(pName)!.prevPoison;
      const prevCmd = isYou ? prevPlayerCmd : botTurnDeltas.get(pName)!.prevCmd;
      const milledThisRound = isYou
        ? playerMilledThisRound
        : botTurnDeltas.get(pName)!.milledThisRound;

      const commanderDamageTaken: CommanderDamageEntry[] = Array.from(
        st.cmdTaken.entries()
      ).map(([sourceName, totalDamage]) => ({
        sourceName,
        totalDamage,
        delta: totalDamage - (prevCmd.get(sourceName) || 0),
      }));

      const maxCommanderDamage = commanderDamageTaken.reduce(
        (mx, entry) => Math.max(mx, entry.totalDamage),
        0
      );

      return {
        player: st.player,
        life: st.life,
        lifeDelta: st.life - prevLife,
        poisonCounters: st.poison,
        poisonDelta: st.poison - prevPoison,
        commanderDamageTaken,
        maxCommanderDamage,
        libraryRemaining: st.libraryRemaining,
        cardsMilledTotal: st.cardsMilledTotal,
        cardsMilledThisRound: milledThisRound,
        graveyardCount: st.graveyardCount,
        handSize: st.handSize,
        landsInPlay: st.landsInPlay,
        manaAvailable: st.manaAvailable,
        creaturesInPlay: st.creaturesInPlay,
        eliminatedBy: st.eliminatedBy,
      };
    });

    const syncedLifeTotals = participantStats.map((ps) => ({
      player: ps.player,
      life: ps.life,
    }));

    return {
      ...round,
      libraryRemaining: you.libraryRemaining,
      graveyardCount: you.graveyardCount,
      cardsMilledToYou: playerMilledThisRound,
      lifeTotals: syncedLifeTotals,
      participantStats,
    };
  });

  // Determine exact win condition & outcome from final reconciled state
  const finalParticipants =
    reconciledRounds[reconciledRounds.length - 1]?.participantStats ||
    orderedNames.map((pName) => {
      const st = stateByName.get(pName)!;
      return {
        player: st.player,
        life: st.life,
        lifeDelta: 0,
        poisonCounters: st.poison,
        poisonDelta: 0,
        commanderDamageTaken: [],
        maxCommanderDamage: 0,
        libraryRemaining: st.libraryRemaining,
        cardsMilledTotal: st.cardsMilledTotal,
        cardsMilledThisRound: 0,
        graveyardCount: st.graveyardCount,
        handSize: st.handSize,
        landsInPlay: st.landsInPlay,
        manaAvailable: st.manaAvailable,
        creaturesInPlay: st.creaturesInPlay,
        eliminatedBy: st.eliminatedBy,
      };
    });

  const youFinal = finalParticipants.find((p) => p.player === 'You')!;
  const botFinals = finalParticipants.filter((p) => p.player !== 'You');
  const aliveFinals = finalParticipants.filter((p) => !p.eliminatedBy);
  const allBotsEliminated =
    botFinals.length > 0 && botFinals.every((b) => Boolean(b.eliminatedBy));

  const scorePlayerHealthRatio = (p: PlayerRoundCombatStats): number => {
    if (p.eliminatedBy) return -1;
    const lifeRatio = p.life / Math.max(1, effectiveStartingLife);
    const poisonPenalty = p.poisonCounters / 10;
    const cmdPenalty = formatRules.usesCommanderDamage21 ? p.maxCommanderDamage / 21 : 0;
    const millPenalty = p.libraryRemaining <= 5 ? 0.45 : 0;
    const boardPresenceBonus = Math.min(0.24, p.creaturesInPlay * 0.03);
    return lifeRatio + boardPresenceBonus - poisonPenalty * 0.85 - cmdPenalty * 0.85 - millPenalty;
  };

  let outcome: 'win' | 'loss' | 'close' = reportedOutcome || 'close';
  let winningPlayer = 'You';

  if (aliveFinals.length === 1) {
    // True sole survivor: guaranteed single winner
    const soleSurvivor = aliveFinals[0];
    winningPlayer = soleSurvivor.player;
    outcome = soleSurvivor.player === 'You' ? 'win' : 'loss';
    const elimCauses = finalParticipants
      .filter((p) => p.player !== soleSurvivor.player && p.eliminatedBy)
      .map((p) => p.eliminatedBy!);
    matchWinCondition =
      lastEliminationReason ||
      elimCauses[elimCauses.length - 1] ||
      'life';
  } else if (youFinal.eliminatedBy) {
    outcome = 'loss';
    matchWinCondition = lastEliminationReason || youFinal.eliminatedBy;
    const survivingBots = botFinals
      .filter((b) => !b.eliminatedBy)
      .sort((a, b) => scorePlayerHealthRatio(b) - scorePlayerHealthRatio(a));
    if (survivingBots[0]) {
      winningPlayer = survivingBots[0].player;
    } else {
      // Simultaneous elimination: pick latest eliminated bot by round
      const lastBot = [...opponents]
        .map((o) => stateByName.get(o.name)!)
        .sort((a, b) => (b.eliminatedRound ?? 0) - (a.eliminatedRound ?? 0))[0];
      winningPlayer = lastBot?.player || botFinals[0]?.player || 'Bot Opponent';
      if ((stateByName.get('You')?.eliminatedRound ?? 0) > (lastBot?.eliminatedRound ?? 0)) {
        winningPlayer = 'You';
        outcome = 'win';
      }
    }
  } else if (allBotsEliminated) {
    outcome = 'win';
    winningPlayer = 'You';
    const elimOrder = botFinals.map((b) => b.eliminatedBy).filter(Boolean);
    matchWinCondition =
      lastEliminationReason || elimOrder[elimOrder.length - 1] || 'life';
  } else {
    void lastEliminatedRound;
    const youScore = scorePlayerHealthRatio(youFinal);
    const bestBot = [...botFinals].sort(
      (a, b) => scorePlayerHealthRatio(b) - scorePlayerHealthRatio(a)
    )[0];
    const bestBotScore = bestBot ? scorePlayerHealthRatio(bestBot) : 0;
    const scoreDiff = youScore - bestBotScore;

    if (scoreDiff >= 0.14) {
      outcome = 'win';
      winningPlayer = 'You';
    } else if (
      scoreDiff <= -0.18 ||
      youFinal.poisonCounters >= 7 ||
      (formatRules.usesCommanderDamage21 && youFinal.maxCommanderDamage >= 15)
    ) {
      outcome = 'loss';
      winningPlayer = bestBot?.player || 'Bot Opponent';
    } else {
      outcome = 'close';
      winningPlayer = scoreDiff >= 0 ? 'You' : bestBot?.player || 'Bot Opponent';
    }

    if (
      youFinal.poisonCounters >= 8 ||
      botFinals.some((b) => !b.eliminatedBy && b.poisonCounters >= 8)
    ) {
      matchWinCondition = 'poison';
    } else if (
      formatRules.usesCommanderDamage21 &&
      (youFinal.maxCommanderDamage >= 16 ||
        botFinals.some((b) => !b.eliminatedBy && b.maxCommanderDamage >= 16))
    ) {
      matchWinCondition = 'commander';
    } else if (
      youFinal.cardsMilledTotal >= 25 ||
      botFinals.some((b) => !b.eliminatedBy && b.cardsMilledTotal >= 25)
    ) {
      matchWinCondition = 'mill';
    } else {
      matchWinCondition = 'points-lead';
    }
  }

  return {
    rounds: reconciledRounds,
    finalStats: {
      winCondition: matchWinCondition,
      winningPlayer,
      roundsPlayed: reconciledRounds.length,
      participants: finalParticipants,
    },
    outcome,
  };
}
