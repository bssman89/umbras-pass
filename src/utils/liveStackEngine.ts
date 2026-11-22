import type { CardMetadata, ManaColor } from '../types/deck';
import type { LiveBotCreature, PendingBotStackSpell } from './liveBotEngine';

export type StackMechanicKind =
  | 'counterspell'
  | 'protection'
  | 'instant-removal'
  | 'fog'
  | 'combat-trick'
  | 'instant-draw'
  | 'flash-creature'
  | 'burn-or-drain'
  | 'board-wipe'
  | 'commander'
  | 'creature'
  | 'activated-ability'
  | 'spell';

export type ActivatedAbilityEffectKind =
  | 'mana'
  | 'draw'
  | 'lifegain'
  | 'counterspell'
  | 'protection'
  | 'removal-damage'
  | 'pump'
  | 'scry';

export interface ActivatedAbilityPermanentInput {
  uid: string;
  name: string;
  typeLine: string;
  isLand: boolean;
  isCreature: boolean;
  isArtifactOrRock: boolean;
  tapped: boolean;
  summoningSick: boolean;
  producedMana: ManaColor[];
  isToken?: boolean;
  tokenAbility?: 'treasure' | 'food' | 'clue' | 'blood' | 'none';
  plusOneCounters?: number;
  meta: CardMetadata | null;
}

export interface ActivatedAbilityOption {
  id: string;
  permanentUid: string;
  permanentName: string;
  label: string;
  effectKind: ActivatedAbilityEffectKind;
  manaCost: number;
  requiresTap: boolean;
  sacrificesPermanent: boolean;
  usesStack: boolean;
  isTokenAbility?: boolean;
  producedMana?: ManaColor[];
  manaYieldCount?: number;
  drawCount?: number;
  lifegainAmount?: number;
  damageAmount?: number;
  pumpPower?: number;
  pumpToughness?: number;
  protectsWholeBoard?: boolean;
  canActivate: boolean;
  disabledReason?: string;
  summaryHint: string;
}

export interface CardStackProfile {
  isInstantSpeed: boolean;
  mechanic: StackMechanicKind;
  mechanicLabel: string;
  uncounterable: boolean;
  protectsWholeBoard: boolean;
  bouncesTarget: boolean;
  exilesTarget: boolean;
  fogsCombat: boolean;
  pumpPower: number;
  pumpToughness: number;
  burnDamage: number;
  freeWithCommander: boolean;
  summaryHint: string;
}

export interface PlayerStackCardPayload {
  uid: string;
  name: string;
  cmc: number;
  typeLine: string;
  isLand: boolean;
  isCreature: boolean;
  isCommander: boolean;
  isArtifactOrRock: boolean;
  producedMana: ManaColor[];
  power: number;
  toughness: number;
  toxicValue: number;
  hasInfect: boolean;
  extraDrawCount: number;
  lifegainAmount: number;
  meta: CardMetadata | null;
  fromCommandZone?: boolean;
}

export interface StackItem {
  id: string;
  controller: 'player' | 'bot';
  controllerBotId?: string;
  controllerName: string;
  seatLabel: string;
  cardName: string;
  cmc: number;
  typeLine: string;
  meta: CardMetadata | null;
  mechanic: StackMechanicKind;
  mechanicBadge: string;
  uncounterable: boolean;
  countered: boolean;
  counteredByName?: string;
  targetSummary: string;
  targetStackItemId?: string;
  targetPlayerCreatureUid?: string;
  targetPlayerCreatureName?: string;
  targetBotId?: string;
  targetBotName?: string;
  targetBotCreatureUid?: string;
  targetBotCreatureName?: string;
  playerCardPayload?: PlayerStackCardPayload;
  botSpellPayload?: PendingBotStackSpell;
  protectsWholeBoard?: boolean;
  bouncesTarget?: boolean;
  exilesTarget?: boolean;
  fogsCombat?: boolean;
  pumpPower?: number;
  pumpToughness?: number;
  burnDamage?: number;
  botReactionNote?: string;
  isActivatedAbility?: boolean;
  sourcePermanentUid?: string;
  activatedEffectKind?: ActivatedAbilityEffectKind;
  drawCount?: number;
  lifegainAmount?: number;
}

const FREE_WITH_COMMANDER_NAMES = new Set([
  'fierce guardianship',
  'deflecting swat',
  'flawless maneuver',
  'deadly rollick',
  'obscuring haze',
  'pact of negation',
  'mental misstep',
]);

const UNCOUNTERABLE_CARD_NAMES = new Set([
  'supreme verdict',
  "dovin's veto",
  'abrupt decay',
  'void rend',
  'carnage tyrant',
  'koma, cosmos serpent',
  'niv-mizzet, parun',
  'krosan grip',
  'sudden spoiling',
  'wipe away',
  'counterflux',
  'last word',
]);

export function isSpellUncounterable(name: string, meta?: CardMetadata | null): boolean {
  const lowerName = (name || '').trim().toLowerCase();
  if (UNCOUNTERABLE_CARD_NAMES.has(lowerName)) return true;
  const oracle = (meta?.oracleText || '').toLowerCase();
  return (
    oracle.includes("can't be countered") ||
    oracle.includes('cannot be countered') ||
    oracle.includes('split second')
  );
}

export function classifyCardStackProfile(
  name: string,
  typeLine: string,
  meta?: CardMetadata | null
): CardStackProfile {
  const lowerName = (name || '').trim().toLowerCase();
  const lowerType = (typeLine || meta?.typeLine || '').toLowerCase();
  const oracle = (meta?.oracleText || '').toLowerCase();
  const isInstant = lowerType.includes('instant');
  const isCreature = lowerType.includes('creature');
  const hasFlash =
    /\bflash\b/i.test(oracle) ||
    /\b(snapcaster mage|venser, shaper savant|notion thief|opposition agent|hullbreacher|orcish bowmasters|dress down|wandering emperor|avacyn|endurance|solitude|subtlety|brazen borrower|faerie mastermind|spectral sailor|tidal barracuda|leyline of anticipation)\b/i.test(
      lowerName
    );

  const isInstantSpeed = isInstant || hasFlash;
  const uncounterable = isSpellUncounterable(name, meta);
  const freeWithCommander = FREE_WITH_COMMANDER_NAMES.has(lowerName);

  // 1. Counterspell detection
  const isCounterspell =
    isInstantSpeed &&
    (/\bcounter target\b/i.test(oracle) ||
      /\bchange the target of target spell\b/i.test(oracle) ||
      /\bexile target spell\b/i.test(oracle) ||
      /\b(counterspell|swan song|arcane denial|negate|mana drain|dovin's veto|fierce guardianship|force of will|force of negation|pact of negation|an offer you can't refuse|dispel|flusterstorm|spell pierce|miscast|stubborn denial|cancel|disallow|narset's reversal|deflecting swat|delay|remand|mana leak|daze|spell snare|mental misstep|sink into stupor|wash away|stifle|tishana's tidebinder|subtlety|mystic confluence|cryptic command|three steps ahead)\b/i.test(
        lowerName
      ));

  if (isCounterspell) {
    return {
      isInstantSpeed: true,
      mechanic: 'counterspell',
      mechanicLabel: 'Counterspell',
      uncounterable,
      protectsWholeBoard: false,
      bouncesTarget: /\breturn target spell\b/i.test(oracle) || /remand|narset's reversal/i.test(lowerName),
      exilesTarget: /\bexile target spell\b/i.test(oracle),
      fogsCombat: false,
      pumpPower: 0,
      pumpToughness: 0,
      burnDamage: 0,
      freeWithCommander,
      summaryHint: uncounterable
        ? "Counters target spell on the stack (can't be countered)."
        : 'Counters target spell on the stack.',
    };
  }

  // 2. Fog / Combat Damage Prevention detection
  const isFog =
    isInstantSpeed &&
    (/\bprevent all combat damage\b/i.test(oracle) ||
      /\breturn all attacking creatures\b/i.test(oracle) ||
      /\bexile all attacking creatures\b/i.test(oracle) ||
      /\b(fog|constant mists|darkness|holy day|obscuring haze|aetherize|settle the wreckage|arachnogenesis|inkshield|sporesfrog|dawn charm)\b/i.test(
        lowerName
      ));

  if (isFog) {
    return {
      isInstantSpeed: true,
      mechanic: 'fog',
      mechanicLabel: /\baetherize|settle the wreckage\b/i.test(lowerName)
        ? 'Combat Blowout'
        : 'Combat Fog',
      uncounterable,
      protectsWholeBoard: true,
      bouncesTarget: /aetherize/i.test(lowerName) || /\breturn all attacking\b/i.test(oracle),
      exilesTarget: /settle the wreckage/i.test(lowerName),
      fogsCombat: true,
      pumpPower: 0,
      pumpToughness: 0,
      burnDamage: 0,
      freeWithCommander,
      summaryHint: 'Prevents all incoming combat damage this turn.',
    };
  }

  // 3. Protection / Blink / Hexproof / Indestructible / Phase Out detection
  const protectsWholeBoard =
    /\b(permanents you control|creatures you control)\b.*\b(hexproof|indestructible|phase out|protection)\b/i.test(
      oracle
    ) ||
    /\b(heroic intervention|teferi's protection|flawless maneuver|clever concealment|boros charm|unbreakable formation|rootborn defenses|and they shall know no fear|akroma's will|guardian of faith|galadriel's dismissal|eerie interlude|ghostway|perch protection)\b/i.test(
      lowerName
    );

  const isSingleProtection =
    /\b(gains? hexproof|gains? indestructible|gains? protection|phases? out|exile target creature you control, then return it)\b/i.test(
      oracle
    ) ||
    /\b(tamiyo's safekeeping|ephemerate|cloudshift|slip out the back|tyvar's stand|snakeskin veil|blossoming defense|vines of vastwood|blacksmith's skill|loran's escape|surge of salvation|feigned death|malakir rebirth|undying malice|not dead after all|royal treatment|shore up|march of swirling mist)\b/i.test(
      lowerName
    );

  if (isInstantSpeed && (protectsWholeBoard || isSingleProtection || meta?.isProtection)) {
    return {
      isInstantSpeed: true,
      mechanic: 'protection',
      mechanicLabel: protectsWholeBoard ? 'Board Protection' : 'Protection / Blink',
      uncounterable,
      protectsWholeBoard,
      bouncesTarget: false,
      exilesTarget: false,
      fogsCombat: /teferi's protection/i.test(lowerName),
      pumpPower: /\+(\d+)\/\+\d+/.test(oracle) ? Number(oracle.match(/\+(\d+)\/\+\d+/)?.[1] || 0) : 0,
      pumpToughness: /\+\d+\/\+(\d+)/.test(oracle) ? Number(oracle.match(/\+\d+\/\+(\d+)/)?.[1] || 0) : 0,
      burnDamage: 0,
      freeWithCommander,
      summaryHint: protectsWholeBoard
        ? 'Grants your board Hexproof & Indestructible until end of turn (fizzles wipes & removal).'
        : 'Protects target creature until end of turn (fizzles targeted removal).',
    };
  }

  // 4. Instant-speed Removal / Bounce / Exile
  const bouncesTarget =
    /\breturn target\b.*\bto its owner's hand\b/i.test(oracle) ||
    /\breturn each nonland permanent\b/i.test(oracle) ||
    /\b(cyclonic rift|unsummon|snap|into the roil|boomerang|chain of vapor|fading hope|brazen borrower|otawara|wipe away|pongify|resculpt)\b/i.test(
      lowerName
    );
  const exilesTarget =
    /\bexile target (creature|permanent|nonland|artifact|enchantment)\b/i.test(oracle) ||
    /\b(swords to plowshares|path to exile|anguished unmaking|despark|reality shift|deadly rollick|solitude|march of otherworldly light)\b/i.test(
      lowerName
    );

  const isInstantRemoval =
    isInstantSpeed &&
    (meta?.isRemoval ||
      bouncesTarget ||
      exilesTarget ||
      /\b(destroy target|exile target|sacrifices a creature|-\d+\/-\d+)\b/i.test(oracle) ||
      /\b(beast within|generous gift|fatal push|assassin's trophy|terminate|murder|doom blade|go for the throat|infernal grasp|heartless act|chaos warp|pongify|rapid hybridization|abrupt decay|void rend|krosan grip|nature's claim|wear \/\/ tear|dismember|snuff out|vendetta|tragic slip|cut down|sheoldred's edict|bitter triumph)\b/i.test(
        lowerName
      ));

  if (isInstantRemoval) {
    return {
      isInstantSpeed: true,
      mechanic: 'instant-removal',
      mechanicLabel: bouncesTarget
        ? 'Instant Bounce'
        : exilesTarget
        ? 'Instant Exile'
        : 'Instant Removal',
      uncounterable,
      protectsWholeBoard: false,
      bouncesTarget,
      exilesTarget,
      fogsCombat: false,
      pumpPower: 0,
      pumpToughness: 0,
      burnDamage: 0,
      freeWithCommander,
      summaryHint: bouncesTarget
        ? 'Returns target opponent creature to hand at instant speed.'
        : exilesTarget
        ? 'Exiles target opponent creature at instant speed.'
        : 'Destroys target opponent creature at instant speed.',
    };
  }

  // 5. Instant-speed Direct Damage / Burn
  const dmgMatch = oracle.match(/deals? (\d+) damage to (any target|target creature|target opponent|each opponent|target player)/i);
  const burnDamage =
    dmgMatch
      ? Math.min(12, Math.max(1, Number(dmgMatch[1])))
      : /\b(lightning bolt|galvanic blast)\b/i.test(lowerName)
      ? 3
      : /\b(shock|play with fire|abrade)\b/i.test(lowerName)
      ? 2
      : 0;

  if (isInstantSpeed && burnDamage > 0) {
    return {
      isInstantSpeed: true,
      mechanic: 'burn-or-drain',
      mechanicLabel: `Instant Burn (${burnDamage} dmg)`,
      uncounterable,
      protectsWholeBoard: false,
      bouncesTarget: false,
      exilesTarget: false,
      fogsCombat: false,
      pumpPower: 0,
      pumpToughness: 0,
      burnDamage,
      freeWithCommander,
      summaryHint: `Deals ${burnDamage} damage to target creature or opponent at instant speed.`,
    };
  }

  // 6. Combat Trick / Pump Spell
  const pumpMatch = oracle.match(/gets? \+(\d+)\/\+(\d+)/i);
  if (
    isInstantSpeed &&
    (pumpMatch || /\b(giant growth|become immense|mutagenic growth|tainted strike|berserk|temur battle rage|invigorate|might of old krosa)\b/i.test(lowerName))
  ) {
    const pP = pumpMatch ? Number(pumpMatch[1]) : 3;
    const pT = pumpMatch ? Number(pumpMatch[2]) : 3;
    return {
      isInstantSpeed: true,
      mechanic: 'combat-trick',
      mechanicLabel: `Combat Trick (+${pP}/+${pT})`,
      uncounterable,
      protectsWholeBoard: false,
      bouncesTarget: false,
      exilesTarget: false,
      fogsCombat: false,
      pumpPower: pP,
      pumpToughness: pT,
      burnDamage: 0,
      freeWithCommander,
      summaryHint: `Buffs target creature +${pP}/+${pT} until end of turn.`,
    };
  }

  // 7. Flash Creature
  if (isCreature && hasFlash) {
    return {
      isInstantSpeed: true,
      mechanic: 'flash-creature',
      mechanicLabel: 'Flash Creature',
      uncounterable,
      protectsWholeBoard: false,
      bouncesTarget: false,
      exilesTarget: false,
      fogsCombat: false,
      pumpPower: 0,
      pumpToughness: 0,
      burnDamage: 0,
      freeWithCommander,
      summaryHint: 'Enters the battlefield at instant speed (ready to block attackers).',
    };
  }

  // 8. Instant Card Draw / Tutor / Cantrip
  if (
    isInstantSpeed &&
    (meta?.isDraw ||
      /\b(draw a card|draw two cards|draw three cards|draw \d+ cards|search your library|scry)\b/i.test(
        oracle
      ) ||
      /\b(brainstorm|opt|consider|fact or fiction|impulse|vampiric tutor|mystical tutor|enlightened tutor|worldly tutor|blue sun's zenith|pull from tomorrow|deadly dispute|village rites|corrupted conviction|thrill of possibility|frantic search|quick study|archmage's charm|memory deluge)\b/i.test(
        lowerName
      ))
  ) {
    return {
      isInstantSpeed: true,
      mechanic: 'instant-draw',
      mechanicLabel: 'Instant Draw / Dig',
      uncounterable,
      protectsWholeBoard: false,
      bouncesTarget: false,
      exilesTarget: false,
      fogsCombat: false,
      pumpPower: 0,
      pumpToughness: 0,
      burnDamage: 0,
      freeWithCommander,
      summaryHint: 'Draws cards immediately at instant speed to dig for answers.',
    };
  }

  // 9. Any other Instant spell
  if (isInstant) {
    return {
      isInstantSpeed: true,
      mechanic: 'spell',
      mechanicLabel: 'Instant',
      uncounterable,
      protectsWholeBoard: false,
      bouncesTarget: false,
      exilesTarget: false,
      fogsCombat: false,
      pumpPower: 0,
      pumpToughness: 0,
      burnDamage: 0,
      freeWithCommander,
      summaryHint: 'Instant-speed spell — can be cast in response on the stack.',
    };
  }

  // Sorcery-speed defaults
  return {
    isInstantSpeed: false,
    mechanic: meta?.isBoardWipe ? 'board-wipe' : isCreature ? 'creature' : 'spell',
    mechanicLabel: isCreature ? 'Creature' : 'Spell',
    uncounterable,
    protectsWholeBoard: false,
    bouncesTarget: false,
    exilesTarget: false,
    fogsCombat: false,
    pumpPower: 0,
    pumpToughness: 0,
    burnDamage: 0,
    freeWithCommander: false,
    summaryHint: 'Sorcery-speed spell.',
  };
}

export function getEffectiveInstantCost(
  cardName: string,
  baseCmc: number,
  hasCommanderInPlay: boolean,
  profile?: CardStackProfile
): number {
  const p = profile ?? classifyCardStackProfile(cardName, 'Instant');
  if (p.freeWithCommander && hasCommanderInPlay) {
    return 0;
  }
  return Math.max(0, baseCmc);
}

export function createStackItemId(prefix: string): string {
  return `stack-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createStackItemFromBotSpell(pending: PendingBotStackSpell): StackItem {
  const mechanicMap: Record<PendingBotStackSpell['category'], { mechanic: StackMechanicKind; badge: string }> = {
    'board-wipe': { mechanic: 'board-wipe', badge: 'Board Wipe' },
    removal: { mechanic: 'instant-removal', badge: 'Targeted Removal' },
    commander: { mechanic: 'commander', badge: 'Commander' },
    creature: { mechanic: 'creature', badge: 'Creature' },
    burn: { mechanic: 'burn-or-drain', badge: 'Burn / Drain' },
    mill: { mechanic: 'spell', badge: 'Mill Spell' },
    draw: { mechanic: 'instant-draw', badge: 'Card Draw' },
    ramp: { mechanic: 'spell', badge: 'Mana Ramp' },
  };
  const mapped = mechanicMap[pending.category] || { mechanic: 'spell', badge: 'Spell' };

  return {
    id: pending.id || createStackItemId('bot'),
    controller: 'bot',
    controllerBotId: pending.botId,
    controllerName: pending.botName,
    seatLabel: `Seat ${pending.seatNumber} · ${pending.botName}`,
    cardName: pending.cardName,
    cmc: pending.cmc,
    typeLine: pending.typeLine,
    meta: pending.meta,
    mechanic: mapped.mechanic,
    mechanicBadge: mapped.badge,
    uncounterable: pending.uncounterable,
    countered: false,
    targetSummary: pending.targetSummary,
    targetPlayerCreatureUid: pending.targetPlayerCreatureUid,
    targetPlayerCreatureName: pending.targetPlayerCreatureName,
    targetBotId: pending.targetBotId,
    targetBotName: pending.targetBotName,
    targetBotCreatureUid: pending.targetBotCreatureUid,
    targetBotCreatureName: pending.targetBotCreatureName,
    botSpellPayload: pending,
  };
}

export function summarizeBotCreatureTarget(botName: string, creature: LiveBotCreature): string {
  return `${botName}'s ${creature.name} (${creature.power}/${creature.toughness})`;
}

function parseActivatedManaCost(costPrefix: string): number {
  let total = 0;
  const tokens = costPrefix.match(/\{([^}]+)\}/g) || [];
  for (const raw of tokens) {
    const sym = raw.slice(1, -1).trim().toUpperCase();
    if (sym === 'T' || sym === 'Q' || sym === 'X') continue;
    const numeric = Number(sym);
    if (!Number.isNaN(numeric) && numeric >= 0) {
      total += numeric;
    } else if (/^[WUBRGC]/.test(sym)) {
      total += 1;
    }
  }
  return total;
}

export function extractPermanentActivatedAbilities(
  permanents: ActivatedAbilityPermanentInput[],
  totalAvailableMana: number
): ActivatedAbilityOption[] {
  const options: ActivatedAbilityOption[] = [];

  for (const perm of permanents) {
    const lowerName = (perm.name || '').trim().toLowerCase();
    const oracle = perm.meta?.oracleText || '';
    const lowerOracle = oracle.toLowerCase();

    // 1. Token built-in activated abilities (Treasure, Clue, Food, Blood)
    if (perm.tokenAbility === 'treasure' || (perm.isToken && lowerName === 'treasure')) {
      options.push({
        id: `ab-treasure-${perm.uid}`,
        permanentUid: perm.uid,
        permanentName: perm.name,
        label: 'Sacrifice: +1 Any Mana',
        effectKind: 'mana',
        manaCost: 0,
        requiresTap: false,
        sacrificesPermanent: true,
        usesStack: false,
        isTokenAbility: true,
        producedMana: ['U'],
        manaYieldCount: 1,
        canActivate: !perm.tapped,
        disabledReason: perm.tapped ? 'Already tapped' : undefined,
        summaryHint: 'Mana ability (instant, does not use the stack). Adds 1 mana to your pool.',
      });
      continue;
    }

    if (perm.tokenAbility === 'clue' || (perm.isToken && lowerName === 'clue')) {
      const canPay = totalAvailableMana >= 2;
      options.push({
        id: `ab-clue-${perm.uid}`,
        permanentUid: perm.uid,
        permanentName: perm.name,
        label: '{2}, Sacrifice: Draw 1',
        effectKind: 'draw',
        manaCost: 2,
        requiresTap: false,
        sacrificesPermanent: true,
        usesStack: true,
        isTokenAbility: true,
        drawCount: 1,
        canActivate: canPay,
        disabledReason: canPay ? undefined : 'Needs 2 mana',
        summaryHint: 'Sacrifices Clue token on the stack to draw 1 card at instant speed.',
      });
      continue;
    }

    if (perm.tokenAbility === 'food' || (perm.isToken && lowerName === 'food')) {
      const canPay = totalAvailableMana >= 2 && !perm.tapped;
      options.push({
        id: `ab-food-${perm.uid}`,
        permanentUid: perm.uid,
        permanentName: perm.name,
        label: '{2}, {T}, Sacrifice: +3 Life',
        effectKind: 'lifegain',
        manaCost: 2,
        requiresTap: true,
        sacrificesPermanent: true,
        usesStack: true,
        isTokenAbility: true,
        lifegainAmount: 3,
        canActivate: canPay,
        disabledReason: perm.tapped ? 'Already tapped' : !canPay ? 'Needs 2 mana' : undefined,
        summaryHint: 'Sacrifices Food token on the stack to gain 3 life at instant speed.',
      });
      continue;
    }

    if (perm.tokenAbility === 'blood' || (perm.isToken && lowerName === 'blood')) {
      const canPay = totalAvailableMana >= 1 && !perm.tapped;
      options.push({
        id: `ab-blood-${perm.uid}`,
        permanentUid: perm.uid,
        permanentName: perm.name,
        label: '{1}, {T}, Sacrifice: Draw 1',
        effectKind: 'draw',
        manaCost: 1,
        requiresTap: true,
        sacrificesPermanent: true,
        usesStack: true,
        isTokenAbility: true,
        drawCount: 1,
        canActivate: canPay,
        disabledReason: perm.tapped ? 'Already tapped' : !canPay ? 'Needs 1 mana' : undefined,
        summaryHint: 'Sacrifices Blood token on the stack to loot/draw 1 card at instant speed.',
      });
      continue;
    }

    // 2. Nonland Mana Rocks & Mana Dorks (instant mana ability)
    if (!perm.isLand && perm.producedMana.length > 0 && !perm.tapped) {
      const blockedBySick = perm.isCreature && perm.summoningSick;
      const isSolRing = lowerName === 'sol ring' || lowerName === 'mana crypt' || lowerName === 'thran dynamo' || lowerName === 'gilded lotus';
      const yieldCount =
        lowerName === 'thran dynamo' || lowerName === 'gilded lotus'
          ? 3
          : isSolRing || /add \{c\}\{c\}/i.test(oracle)
          ? 2
          : 1;
      if (!blockedBySick) {
        options.push({
          id: `ab-mana-${perm.uid}`,
          permanentUid: perm.uid,
          permanentName: perm.name,
          label: `{T}: Add ${yieldCount > 1 ? `${yieldCount} Mana` : `{${perm.producedMana[0]}}`}`,
          effectKind: 'mana',
          manaCost: 0,
          requiresTap: true,
          sacrificesPermanent: false,
          usesStack: false,
          producedMana: perm.producedMana,
          manaYieldCount: yieldCount,
          canActivate: true,
          summaryHint: `Tap ${perm.name} to add ${yieldCount} mana to your pool immediately.`,
        });
      }
    }

    // 3. Parse oracle-text instant-speed activated abilities (Cost: Effect)
    const lines = oracle
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.includes(':'));

    let matchedOracleAbility = false;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes('activate only as a sorcery')) continue;
      if (lowerLine.includes('cycling') || lowerLine.includes('equip ')) continue;

      const colonIdx = line.indexOf(':');
      if (colonIdx <= 0) continue;
      const costPart = line.slice(0, colonIdx);
      const effectPart = line.slice(colonIdx + 1).trim();
      const lowerEffect = effectPart.toLowerCase();

      // Skip pure land mana abilities ("{T}: Add {U}") since lands have dedicated tap controls
      if (perm.isLand && /^add\s+\{/i.test(lowerEffect) && !lowerEffect.includes('draw')) {
        continue;
      }

      const requiresTap = /\{t\}/i.test(costPart);
      const sacrificesPermanent = /sacrifice/i.test(costPart) && !/sacrifice another/i.test(costPart);
      const manaCost = parseActivatedManaCost(costPart);
      const blockedByTap = requiresTap && (perm.tapped || (perm.isCreature && perm.summoningSick));
      const canPay = totalAvailableMana >= manaCost;
      const canActivate = !blockedByTap && canPay;
      const disabledReason = blockedByTap
        ? perm.tapped
          ? 'Already tapped'
          : 'Summoning sick'
        : !canPay
        ? `Needs ${manaCost} mana`
        : undefined;

      const costTag = [
        manaCost > 0 ? `{${manaCost}}` : '',
        requiresTap ? '{T}' : '',
        sacrificesPermanent ? 'Sac' : '',
      ]
        .filter(Boolean)
        .join(', ');

      // 3a. Counterspell activated ability
      if (/\bcounter target\b/i.test(lowerEffect)) {
        matchedOracleAbility = true;
        options.push({
          id: `ab-counter-${perm.uid}-${li}`,
          permanentUid: perm.uid,
          permanentName: perm.name,
          label: `${costTag || 'Activate'}: Counter Spell`,
          effectKind: 'counterspell',
          manaCost,
          requiresTap,
          sacrificesPermanent,
          usesStack: true,
          canActivate,
          disabledReason,
          summaryHint: `${perm.name} — Counters target spell on the stack.`,
        });
        break;
      }

      // 3b. Protection / Indestructible / Hexproof / Blink activated ability
      if (/\b(gains? hexproof|gains? indestructible|gains? protection|exile target creature you control, then return)\b/i.test(lowerEffect)) {
        matchedOracleAbility = true;
        const wholeBoard = /\b(creatures you control|permanents you control)\b/i.test(lowerEffect);
        options.push({
          id: `ab-prot-${perm.uid}-${li}`,
          permanentUid: perm.uid,
          permanentName: perm.name,
          label: `${costTag || 'Activate'}: ${wholeBoard ? 'Protect Board' : 'Protect Creature'}`,
          effectKind: 'protection',
          manaCost,
          requiresTap,
          sacrificesPermanent,
          usesStack: true,
          protectsWholeBoard: wholeBoard,
          canActivate,
          disabledReason,
          summaryHint: wholeBoard
            ? `${perm.name} — Grants your board Hexproof & Indestructible until EOT.`
            : `${perm.name} — Protects target creature you control until EOT.`,
        });
        break;
      }

      // 3c. Damage / Removal activated ability
      const dmgMatch = lowerEffect.match(/deals? (\d+) damage/);
      if (dmgMatch || /\b(destroy target|exile target)\b/i.test(lowerEffect)) {
        matchedOracleAbility = true;
        const dmg = dmgMatch ? Math.max(1, Number(dmgMatch[1])) : 3;
        const isDestroy = /\b(destroy target|exile target)\b/i.test(lowerEffect);
        options.push({
          id: `ab-dmg-${perm.uid}-${li}`,
          permanentUid: perm.uid,
          permanentName: perm.name,
          label: `${costTag || 'Activate'}: ${isDestroy ? 'Remove Target' : `Deal ${dmg} Dmg`}`,
          effectKind: 'removal-damage',
          manaCost,
          requiresTap,
          sacrificesPermanent,
          usesStack: true,
          damageAmount: isDestroy ? 99 : dmg,
          canActivate,
          disabledReason,
          summaryHint: isDestroy
            ? `${perm.name} — Destroys/exiles target opponent creature at instant speed.`
            : `${perm.name} — Deals ${dmg} damage to target creature or opponent.`,
        });
        break;
      }

      // 3d. Draw / Scry activated ability
      if (/\b(draw a card|draw two cards|draw three cards|draw \d+ cards)\b/i.test(lowerEffect)) {
        matchedOracleAbility = true;
        const count = /three|3/.test(lowerEffect) ? 3 : /two|2/.test(lowerEffect) ? 2 : 1;
        options.push({
          id: `ab-draw-${perm.uid}-${li}`,
          permanentUid: perm.uid,
          permanentName: perm.name,
          label: `${costTag || 'Activate'}: Draw ${count}`,
          effectKind: 'draw',
          manaCost,
          requiresTap,
          sacrificesPermanent,
          usesStack: true,
          drawCount: count,
          canActivate,
          disabledReason,
          summaryHint: `${perm.name} — Draws ${count} card${count === 1 ? '' : 's'} at instant speed.`,
        });
        break;
      }

      if (/\bscry \d+|look at the top three cards/i.test(lowerEffect)) {
        matchedOracleAbility = true;
        options.push({
          id: `ab-scry-${perm.uid}-${li}`,
          permanentUid: perm.uid,
          permanentName: perm.name,
          label: `${costTag || 'Activate'}: Scry / Topdeck`,
          effectKind: 'scry',
          manaCost,
          requiresTap,
          sacrificesPermanent,
          usesStack: true,
          canActivate,
          disabledReason,
          summaryHint: `${perm.name} — Scry/rearrange top of library at instant speed.`,
        });
        break;
      }

      // 3e. Pump activated ability
      const pumpMatch = lowerEffect.match(/gets? \+(\d+)\/\+(\d+)/);
      if (pumpMatch) {
        matchedOracleAbility = true;
        const pP = Number(pumpMatch[1]) || 1;
        const pT = Number(pumpMatch[2]) || 1;
        options.push({
          id: `ab-pump-${perm.uid}-${li}`,
          permanentUid: perm.uid,
          permanentName: perm.name,
          label: `${costTag || 'Activate'}: +${pP}/+${pT}`,
          effectKind: 'pump',
          manaCost,
          requiresTap,
          sacrificesPermanent,
          usesStack: true,
          pumpPower: pP,
          pumpToughness: pT,
          canActivate,
          disabledReason,
          summaryHint: `${perm.name} — Buffs target creature +${pP}/+${pT} until end of turn.`,
        });
        break;
      }

      // 3f. Lifegain activated ability
      const healMatch = lowerEffect.match(/gain (\d+) life/);
      if (healMatch) {
        matchedOracleAbility = true;
        const amt = Number(healMatch[1]) || 2;
        options.push({
          id: `ab-life-${perm.uid}-${li}`,
          permanentUid: perm.uid,
          permanentName: perm.name,
          label: `${costTag || 'Activate'}: +${amt} Life`,
          effectKind: 'lifegain',
          manaCost,
          requiresTap,
          sacrificesPermanent,
          usesStack: true,
          lifegainAmount: amt,
          canActivate,
          disabledReason,
          summaryHint: `${perm.name} — Gains ${amt} life at instant speed.`,
        });
        break;
      }
    }

    // 4. Fallback curated staples when metadata wasn't enriched yet
    if (!matchedOracleAbility && !lowerOracle) {
      if (/\b(sensei's divining top|mazemind tome)\b/.test(lowerName)) {
        const canPay = totalAvailableMana >= 1;
        options.push({
          id: `ab-staple-draw-${perm.uid}`,
          permanentUid: perm.uid,
          permanentName: perm.name,
          label: '{1}: Scry / Draw',
          effectKind: 'draw',
          manaCost: 1,
          requiresTap: true,
          sacrificesPermanent: false,
          usesStack: true,
          drawCount: 1,
          canActivate: canPay && !perm.tapped,
          disabledReason: perm.tapped ? 'Already tapped' : !canPay ? 'Needs 1 mana' : undefined,
          summaryHint: `${perm.name} — Dig for an instant response.`,
        });
      } else if (/\b(mother of runes|giver of runes|selfless spirit|dauntless escort)\b/.test(lowerName)) {
        const isSac = /selfless spirit|dauntless escort/.test(lowerName);
        const blocked = !isSac && (perm.tapped || perm.summoningSick);
        options.push({
          id: `ab-staple-prot-${perm.uid}`,
          permanentUid: perm.uid,
          permanentName: perm.name,
          label: isSac ? 'Sacrifice: Protect Board' : '{T}: Protect Creature',
          effectKind: 'protection',
          manaCost: 0,
          requiresTap: !isSac,
          sacrificesPermanent: isSac,
          usesStack: true,
          protectsWholeBoard: isSac,
          canActivate: !blocked,
          disabledReason: blocked ? (perm.tapped ? 'Already tapped' : 'Summoning sick') : undefined,
          summaryHint: `${perm.name} — Grants instant-speed protection.`,
        });
      }
    }
  }

  return options.sort((a, b) => {
    if (a.canActivate !== b.canActivate) return a.canActivate ? -1 : 1;
    // Put non-mana stack responses first, then mana abilities
    if (a.usesStack !== b.usesStack) return a.usesStack ? -1 : 1;
    return a.manaCost - b.manaCost;
  });
}
