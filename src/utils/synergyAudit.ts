import type {
  CardMetadata,
  DeckAnalysisResult,
  DeckFormat,
  DeckGoal,
} from '../types/deck';
import {
  addMapCardCount,
  findMatchingCardMapKey,
  getMapCardCount,
  getMaxCopiesForCard,
  isSameCardName,
  normalizeDeckCardKey,
} from './deckRules';

export type SynergyIssueCategory =
  | 'color-identity'
  | 'off-color-mana'
  | 'anti-synergy'
  | 'off-strategy';

export interface ReplacementSuggestion {
  cardName: string;
  role: string;
  reason: string;
  matchLabel?: string;
  meta?: CardMetadata | null;
}

export interface SynergyFlagItem {
  id: string;
  cardName: string;
  quantity: number;
  zone: string;
  cardMeta: CardMetadata | null;
  issueCategory: SynergyIssueCategory;
  severity: 'critical' | 'warning';
  issueTitle: string;
  reason: string;
  linkedSwapId?: string;
  linkedCutId?: string;
  suggestions: ReplacementSuggestion[];
}

export interface ColorAuditRow {
  color: 'W' | 'U' | 'B' | 'R' | 'G';
  label: string;
  pips: number;
  spellCount: number;
  doublePipCards: number;
  sources: number;
  recommendedSources: number;
  delta: number;
  illegalCards: number;
  status: 'Healthy' | 'Tight' | 'Short' | 'Zero Sources' | 'Identity Violation' | 'Unused Surplus';
}

export interface ThemeBreakdownItem {
  theme: string;
  label: string;
  cardCount: number;
  sharePct: number;
  topCards: Array<{ name: string; meta: CardMetadata | null }>;
}

export interface AuditRoleSummaryItem {
  role: string;
  count: number;
  targetMin: number;
  targetMax: number;
  status: 'On Target' | 'Low' | 'High';
}

export interface StrongSynergyCard {
  cardName: string;
  cardMeta: CardMetadata | null;
  matchedThemes: string[];
  reason: string;
}

export interface SynergyAuditReport {
  detectedStrategy: {
    archetype: string;
    primaryThemes: string[];
    identityColors: string[];
    identityLabel: string;
    dominantTribe: string | null;
  };
  scores: {
    colorHealth: number;
    synergyCohesion: number;
    overallScore: number;
    grade: 'A' | 'B' | 'C' | 'D';
  };
  colorAuditRows: ColorAuditRow[];
  themeBreakdown: ThemeBreakdownItem[];
  roleSummary: AuditRoleSummaryItem[];
  strongestSynergies: StrongSynergyCard[];
  totalCardsScanned: number;
  flaggedCards: SynergyFlagItem[];
  counts: {
    total: number;
    colorIssues: number;
    antiSynergy: number;
    offStrategy: number;
    critical: number;
  };
}

interface CandidateCard {
  name: string;
  colors: string[];
  role: string;
  reason: string;
  themes?: string[];
  formats?: Array<Exclude<DeckFormat, 'auto'>>;
  powerTier?: 'casual' | 'all' | 'high';
  cmc?: number;
}

// Curated format-legal replacement catalog (strictly excludes Commander-banned cards)
const CURATED_REPLACEMENTS: CandidateCard[] = [
  // === Universal / Colorless Ramp, Lands & Payoffs ===
  {
    name: 'Arcane Signet',
    colors: [],
    role: 'Mana Ramp',
    reason: 'Untapped 2-MV rock that produces every color in your commander identity.',
    formats: ['commander', 'brawl'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Fellwar Stone',
    colors: [],
    role: 'Mana Ramp',
    reason: 'Untapped 2-MV mana rock that fixes colors without violating deck identity.',
    formats: ['commander', 'brawl', 'legacy', 'vintage'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Mind Stone',
    colors: [],
    role: 'Mana Ramp',
    reason: 'Untapped 2-MV ramp early that cycles into a fresh draw later.',
    themes: ['artifacts', 'midrange'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Thought Vessel',
    colors: [],
    role: 'Mana Ramp',
    reason: 'Untapped 2-MV rock that keeps oversized draw hands intact.',
    formats: ['commander', 'brawl', 'legacy', 'vintage'],
    themes: ['artifacts', 'spellslinger', 'midrange'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Liquimetal Torque',
    colors: [],
    role: 'Mana Ramp',
    reason: 'Untapped 2-MV rock that turns problem permanents into artifacts for removal or artifact payoffs.',
    formats: ['commander', 'modern', 'legacy', 'vintage'],
    themes: ['artifacts'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Wayfarer\'s Bauble',
    colors: [],
    role: 'Mana Ramp',
    reason: 'Colorless land-ramp piece that fixes missing colors and triggers landfall or artifact counts.',
    themes: ['artifacts', 'landfall'],
    powerTier: 'casual',
    cmc: 1,
  },
  {
    name: 'Command Tower',
    colors: [],
    role: 'Land',
    reason: 'Enters untapped and taps for any color in your commander’s exact identity.',
    formats: ['commander', 'brawl'],
    powerTier: 'all',
    cmc: 0,
  },
  {
    name: 'Exotic Orchard',
    colors: [],
    role: 'Land',
    reason: 'Untapped rainbow land that avoids off-color identity issues while fixing mana.',
    formats: ['commander', 'brawl', 'modern', 'legacy', 'vintage'],
    powerTier: 'all',
    cmc: 0,
  },
  {
    name: 'Path of Ancestry',
    colors: [],
    role: 'Land',
    reason: 'Produces your commander’s colors and scries whenever you cast a creature sharing a type.',
    formats: ['commander', 'brawl', 'pauper'],
    themes: ['tribal'],
    powerTier: 'all',
    cmc: 0,
  },
  {
    name: 'Unclaimed Territory',
    colors: [],
    role: 'Land',
    reason: 'Untapped five-color tribal land that fixes mana for your chosen creature type.',
    themes: ['tribal'],
    powerTier: 'all',
    cmc: 0,
  },
  {
    name: 'Secluded Courtyard',
    colors: [],
    role: 'Land',
    reason: 'Untapped tribal rainbow land that also funds activated abilities of that creature type.',
    themes: ['tribal'],
    powerTier: 'all',
    cmc: 0,
  },
  {
    name: 'Three Tree City',
    colors: [],
    role: 'Land',
    reason: 'Explosive tribal land that scales mana generation with your board of matching creatures.',
    themes: ['tribal', 'tokens'],
    powerTier: 'all',
    cmc: 0,
  },
  {
    name: 'Skullclamp',
    colors: [],
    role: 'Card Draw',
    reason: 'Turns 1/1 tokens or sacrifice fodder into two fresh cards per equip for {1}.',
    formats: ['commander', 'brawl', 'legacy', 'vintage'],
    themes: ['tokens', 'aristocrats', 'artifacts', 'voltron'],
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Lightning Greaves',
    colors: [],
    role: 'Protection',
    reason: 'Zero-equip shroud and haste that shields your commander or key synergy creature.',
    themes: ['voltron', 'artifacts', 'tribal', 'aggro'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Swiftfoot Boots',
    colors: [],
    role: 'Protection',
    reason: 'Grants hexproof and haste while still letting your own targeted buffs/auras hit.',
    themes: ['voltron', 'artifacts', 'tribal', 'counters'],
    powerTier: 'casual',
    cmc: 2,
  },
  {
    name: 'Mithril Coat',
    colors: [],
    role: 'Protection',
    reason: 'Flash indestructible equipment that auto-attaches to save legendary commanders mid-combat or from wipes.',
    themes: ['voltron', 'artifacts'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Shadowspear',
    colors: [],
    role: 'Voltron Synergy',
    reason: '1-mana equipment granting trample, lifelink, and an answer to opponent hexproof/indestructible.',
    themes: ['voltron', 'artifacts', 'lifegain'],
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Sword of the Animist',
    colors: [],
    role: 'Mana Ramp',
    reason: 'Ramps basic lands directly onto the battlefield every time the equipped creature attacks.',
    themes: ['voltron', 'artifacts', 'landfall', 'aggro'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Patchwork Banner',
    colors: [],
    role: 'Tribal Synergy',
    reason: 'Anthem buff for your primary creature type that doubles as an untapped mana rock.',
    themes: ['tribal', 'artifacts', 'tokens'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Herald\'s Horn',
    colors: [],
    role: 'Tribal Synergy',
    reason: 'Discounts your tribal spells by {1} and draws matching creatures off the top each upkeep.',
    themes: ['tribal', 'artifacts'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Vanquisher\'s Banner',
    colors: [],
    role: 'Tribal Synergy',
    reason: 'Buffs your tribe and turns every tribal creature cast into a fresh card draw.',
    themes: ['tribal'],
    powerTier: 'casual',
    cmc: 5,
  },
  {
    name: 'Roaming Throne',
    colors: [],
    role: 'Tribal Synergy',
    reason: 'Doubles every triggered ability of your chosen creature type (and your commander).',
    themes: ['tribal', 'blink', 'aristocrats', 'counters'],
    powerTier: 'all',
    cmc: 4,
  },
  {
    name: 'Metallic Mimic',
    colors: [],
    role: 'Tribal Synergy',
    reason: 'Low-curve tribal lord that puts +1/+1 counters on every matching creature entering.',
    themes: ['tribal', 'counters', 'artifacts'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'The Ozolith',
    colors: [],
    role: '+1/+1 Counters',
    reason: 'Saves all +1/+1 counters when creatures leave play and moves them onto fresh attackers.',
    themes: ['counters', 'artifacts', 'voltron'],
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Ozolith, the Shattered Spire',
    colors: ['G'],
    role: '+1/+1 Counters',
    reason: 'Doubles counter efficiency like Hardened Scales while adding counters and cycling late.',
    themes: ['counters', 'artifacts'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Panharmonicon',
    colors: [],
    role: 'Blink & ETB Synergy',
    reason: 'Doubles every creature and artifact enters-the-battlefield trigger on your side.',
    themes: ['blink', 'artifacts', 'tokens'],
    powerTier: 'all',
    cmc: 4,
  },
  {
    name: 'Conjurer\'s Closet',
    colors: [],
    role: 'Blink & ETB Synergy',
    reason: 'Blinks a key ETB creature at the end of every turn for free repeatable value.',
    themes: ['blink'],
    powerTier: 'casual',
    cmc: 5,
  },
  {
    name: 'Ashnod\'s Altar',
    colors: [],
    role: 'Aristocrats Synergy',
    reason: 'Free, instant-speed sacrifice outlet that converts expendable creatures/tokens into {C}{C}.',
    formats: ['commander', 'brawl', 'legacy', 'vintage'],
    themes: ['aristocrats', 'tokens', 'graveyard'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Foundry Inspector',
    colors: [],
    role: 'Artifact Synergy',
    reason: 'Reduces all artifact spell costs by {1} to accelerate multi-spell artifact turns.',
    themes: ['artifacts'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Warping Wail',
    colors: [],
    role: 'Removal',
    reason: 'Colorless instant-speed counter for sorceries, exile for small creatures, or ramp token.',
    formats: ['commander', 'modern', 'legacy', 'vintage'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Forsaken Monument',
    colors: [],
    role: 'Mana Ramp',
    reason: 'Doubles colorless mana production while pumping and sustaining colorless boards.',
    themes: ['artifacts'],
    powerTier: 'all',
    cmc: 5,
  },
  {
    name: 'All Is Dust',
    colors: [],
    role: 'Board Wipe',
    reason: 'Sweeps colored permanents across the table while leaving your colorless board intact.',
    themes: ['artifacts'],
    powerTier: 'all',
    cmc: 7,
  },
  {
    name: 'Kozilek\'s Command',
    colors: [],
    role: 'Removal',
    reason: 'Modal colorless instant that ramps Spawn tokens, exiles creatures, or filters draws.',
    formats: ['commander', 'modern', 'legacy', 'vintage'],
    themes: ['artifacts', 'tokens'],
    powerTier: 'all',
    cmc: 2,
  },

  // === White ===
  {
    name: 'Swords to Plowshares',
    colors: ['W'],
    role: 'Removal',
    reason: '1-mana instant exile removal that cleanly answers nearly any creature threat.',
    formats: ['commander', 'brawl', 'legacy', 'vintage'],
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Path to Exile',
    colors: ['W'],
    role: 'Removal',
    reason: 'Efficient 1-mana instant exile answer that keeps your mana open for synergy.',
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Get Lost',
    colors: ['W'],
    role: 'Removal',
    reason: '2-mana instant hitting creatures, enchantments, or planeswalkers across formats.',
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Stroke of Midnight',
    colors: ['W'],
    role: 'Removal',
    reason: 'Flexible 3-mana instant nonland permanent answer with minimal downside.',
    powerTier: 'casual',
    cmc: 3,
  },
  {
    name: 'Generous Gift',
    colors: ['W'],
    role: 'Removal',
    reason: 'Catch-all instant removal in White that destroys any permanent including problem lands.',
    formats: ['commander', 'brawl', 'modern', 'legacy', 'vintage'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Esper Sentinel',
    colors: ['W'],
    role: 'Card Draw',
    reason: '1-mana tax/draw engine that scales further when buffed by counters, equipment, or anthems.',
    formats: ['commander', 'brawl', 'modern', 'legacy', 'vintage'],
    themes: ['artifacts', 'counters', 'voltron'],
    powerTier: 'high',
    cmc: 1,
  },
  {
    name: 'Trouble in Pairs',
    colors: ['W'],
    role: 'Card Draw',
    reason: 'Reliable White multiplayer draw engine triggering off second cards, spells, or attacks.',
    formats: ['commander', 'legacy', 'vintage'],
    powerTier: 'high',
    cmc: 4,
  },
  {
    name: 'Teferi\'s Protection',
    colors: ['W'],
    role: 'Protection',
    reason: 'Phases out your entire board and life total to survive sweepers or lethal turns.',
    formats: ['commander', 'brawl', 'legacy', 'vintage'],
    powerTier: 'high',
    cmc: 3,
  },
  {
    name: 'Clever Concealment',
    colors: ['W'],
    role: 'Protection',
    reason: 'Convoke phasing shield that protects wide token or tribal boards for zero mana.',
    formats: ['commander', 'legacy', 'vintage'],
    themes: ['tokens', 'tribal', 'aggro'],
    powerTier: 'all',
    cmc: 4,
  },
  {
    name: 'Austere Command',
    colors: ['W'],
    role: 'Board Wipe',
    reason: 'Modal sweeper you can tailor to spare your key permanents or creature types.',
    powerTier: 'all',
    cmc: 6,
  },
  {
    name: 'Anointed Procession',
    colors: ['W'],
    role: 'Token Synergy',
    reason: 'Doubles every creature, Clue, or Treasure token your deck produces.',
    themes: ['tokens', 'aristocrats', 'enchantments'],
    powerTier: 'all',
    cmc: 4,
  },
  {
    name: 'Adeline, Resplendent Cathar',
    colors: ['W'],
    role: 'Token Synergy',
    reason: 'Generates three attacking Human tokens per combat while scaling aggressively.',
    themes: ['tokens', 'aggro', 'tribal'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Ephemerate',
    colors: ['W'],
    role: 'Blink & ETB Synergy',
    reason: '1-mana instant blink with Rebound that doubles up ETB triggers and dodges targeted removal.',
    formats: ['commander', 'brawl', 'modern', 'legacy', 'vintage', 'pauper'],
    themes: ['blink', 'spellslinger'],
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Teleportation Circle',
    colors: ['W'],
    role: 'Blink & ETB Synergy',
    reason: 'Enchantment blink engine that flickers a creature or artifact every end step.',
    themes: ['blink', 'enchantments', 'artifacts'],
    powerTier: 'all',
    cmc: 4,
  },
  {
    name: 'Sigarda\'s Aid',
    colors: ['W'],
    role: 'Voltron Synergy',
    reason: 'Gives all Equipment and Auras flash and free auto-equip upon entering.',
    themes: ['voltron', 'enchantments', 'artifacts'],
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Puresteel Paladin',
    colors: ['W'],
    role: 'Voltron Synergy',
    reason: 'Turns every Equipment into a cantrip and grants {0} equip costs with Metalcraft.',
    themes: ['voltron', 'artifacts'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Mesa Enchantress',
    colors: ['W'],
    role: 'Enchantment Synergy',
    reason: 'Draws a card every time you cast an enchantment spell.',
    themes: ['enchantments'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Grasp of Fate',
    colors: ['W'],
    role: 'Enchantment Synergy',
    reason: 'Oblivion Ring-style enchantment that exiles one nonland permanent from each opponent.',
    formats: ['commander', 'legacy', 'vintage'],
    themes: ['enchantments', 'blink'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Sevinne\'s Reclamation',
    colors: ['W'],
    role: 'Graveyard Synergy',
    reason: 'Renews ramp, fetchlands, or MV <= 3 engines from your graveyard with Flashback.',
    formats: ['commander', 'legacy', 'vintage'],
    themes: ['graveyard', 'landfall', 'enchantments'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Smothering Tithe',
    colors: ['W'],
    role: 'Mana Ramp',
    reason: 'Generates massive Treasure mana in multiplayer to fuel expensive spells or artifact counts.',
    formats: ['commander', 'brawl'],
    themes: ['artifacts', 'tokens', 'enchantments'],
    powerTier: 'high',
    cmc: 4,
  },

  // === Blue ===
  {
    name: 'Counterspell',
    colors: ['U'],
    role: 'Interaction',
    reason: 'Clean 2-mana hard counterspell to protect your synergy engine or stop win attempts.',
    formats: ['commander', 'brawl', 'modern', 'legacy', 'vintage', 'pauper'],
    themes: ['spellslinger', 'control'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Arcane Denial',
    colors: ['U'],
    role: 'Interaction',
    reason: 'Splashable 1U counterspell that replaces itself on the next upkeep.',
    formats: ['commander', 'legacy', 'vintage'],
    themes: ['spellslinger', 'control'],
    powerTier: 'casual',
    cmc: 2,
  },
  {
    name: 'An Offer You Can\'t Refuse',
    colors: ['U'],
    role: 'Interaction',
    reason: '1-mana instant answer to noncreature sweepers, combos, and opposing removal.',
    themes: ['spellslinger', 'control'],
    powerTier: 'high',
    cmc: 1,
  },
  {
    name: 'Negate',
    colors: ['U'],
    role: 'Interaction',
    reason: 'Splashable 2-mana counter protecting your board from wipes and noncreature threats.',
    themes: ['spellslinger', 'tribal', 'voltron'],
    powerTier: 'casual',
    cmc: 2,
  },
  {
    name: 'Pongify',
    colors: ['U'],
    role: 'Removal',
    reason: '1-mana instant creature answer that keeps mana open for synergy plays.',
    themes: ['spellslinger'],
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Rapid Hybridization',
    colors: ['U'],
    role: 'Removal',
    reason: 'Redundant 1-mana instant creature destruction in Blue.',
    themes: ['spellslinger'],
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Cyclonic Rift',
    colors: ['U'],
    role: 'Board Wipe',
    reason: 'One-sided instant bounce sweeper that leaves your synergy board untouched.',
    formats: ['commander', 'brawl', 'modern', 'legacy', 'vintage'],
    themes: ['spellslinger'],
    powerTier: 'high',
    cmc: 2,
  },
  {
    name: 'Ponder',
    colors: ['U'],
    role: 'Cantrip',
    reason: '1-mana spell velocity smoothing draws and triggering spellslinger payoffs.',
    formats: ['commander', 'brawl', 'legacy', 'vintage', 'pauper'],
    themes: ['spellslinger'],
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Preordain',
    colors: ['U'],
    role: 'Cantrip',
    reason: 'Efficient 1-mana scry/draw cantrip for spellslinger density and land consistency.',
    formats: ['commander', 'brawl', 'modern', 'legacy', 'vintage', 'pauper'],
    themes: ['spellslinger'],
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Rhystic Study',
    colors: ['U'],
    role: 'Card Draw',
    reason: 'Premier Blue enchantment draw engine that refuels your hand throughout multiplayer games.',
    formats: ['commander', 'brawl', 'legacy', 'vintage'],
    themes: ['enchantments', 'spellslinger'],
    powerTier: 'high',
    cmc: 3,
  },
  {
    name: 'Kindred Discovery',
    colors: ['U'],
    role: 'Tribal Synergy',
    reason: 'Draws a card whenever a creature of your chosen tribe enters or attacks.',
    formats: ['commander', 'legacy', 'vintage'],
    themes: ['tribal', 'enchantments', 'tokens'],
    powerTier: 'all',
    cmc: 5,
  },
  {
    name: 'Archmage Emeritus',
    colors: ['U'],
    role: 'Spellslinger Synergy',
    reason: 'Draws a fresh card off every instant or sorcery cast or copied.',
    themes: ['spellslinger'],
    powerTier: 'all',
    cmc: 4,
  },
  {
    name: 'Talrand, Sky Summoner',
    colors: ['U'],
    role: 'Spellslinger Synergy',
    reason: 'Converts every instant and sorcery into a 2/2 flying Drake body.',
    themes: ['spellslinger', 'tokens'],
    powerTier: 'casual',
    cmc: 4,
  },
  {
    name: 'Emry, Lurker of the Loch',
    colors: ['U'],
    role: 'Artifact Synergy',
    reason: 'Cost-reduced artifact engine that lets you recast key artifacts from the graveyard.',
    themes: ['artifacts', 'graveyard'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Sai, Master Thopterist',
    colors: ['U'],
    role: 'Artifact Synergy',
    reason: 'Builds a swarm of flying Thopter tokens with every artifact spell cast and draws cards.',
    themes: ['artifacts', 'tokens'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Thought Monitor',
    colors: ['U'],
    role: 'Artifact Synergy',
    reason: 'Affinity 2/2 flyer that draws two cards for as little as {U} in artifact builds.',
    themes: ['artifacts'],
    powerTier: 'all',
    cmc: 7,
  },
  {
    name: 'Displacer Kitten',
    colors: ['U'],
    role: 'Blink & ETB Synergy',
    reason: 'Flickers your ETB permanents or mana rocks every time you cast a noncreature spell.',
    themes: ['blink', 'spellslinger', 'artifacts'],
    powerTier: 'high',
    cmc: 4,
  },

  // === Black ===
  {
    name: 'Deadly Rollick',
    colors: ['B'],
    role: 'Removal',
    reason: 'Free instant exile removal when your commander is on the battlefield.',
    formats: ['commander', 'brawl'],
    powerTier: 'high',
    cmc: 4,
  },
  {
    name: 'Infernal Grasp',
    colors: ['B'],
    role: 'Removal',
    reason: 'Unconditional 2-mana instant removal answering almost any creature threat.',
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Go for the Throat',
    colors: ['B'],
    role: 'Removal',
    reason: 'Clean 2-mana instant creature removal with minimal life/pip tax.',
    powerTier: 'casual',
    cmc: 2,
  },
  {
    name: 'Feed the Swarm',
    colors: ['B'],
    role: 'Removal',
    reason: 'Rare mono-Black answer that cleanly removes problem enchantments as well as creatures.',
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Withering Torment',
    colors: ['B'],
    role: 'Removal',
    reason: 'Instant-speed Black answer to both enchantments and creatures for 3 mana.',
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Toxic Deluge',
    colors: ['B'],
    role: 'Board Wipe',
    reason: '3-mana scalable sweeper that bypasses indestructible and spares high-toughness threats.',
    formats: ['commander', 'brawl', 'modern', 'legacy', 'vintage'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Night\'s Whisper',
    colors: ['B'],
    role: 'Card Draw',
    reason: 'Efficient 2-mana card draw keeping early land drops and gas flowing.',
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Deadly Dispute',
    colors: ['B'],
    role: 'Card Draw',
    reason: 'Sacrifices a spare token or artifact at instant speed for two cards and a Treasure.',
    themes: ['aristocrats', 'tokens', 'artifacts', 'graveyard'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Black Market Connections',
    colors: ['B'],
    role: 'Card Draw',
    reason: 'Generates Treasure ramp, fresh cards, and Shapeshifter bodies matching any tribe.',
    formats: ['commander', 'legacy', 'vintage'],
    themes: ['tribal', 'tokens', 'aristocrats', 'enchantments'],
    powerTier: 'high',
    cmc: 3,
  },
  {
    name: 'Reanimate',
    colors: ['B'],
    role: 'Graveyard Synergy',
    reason: '1-mana reanimation spell bringing back key threats from any graveyard immediately.',
    formats: ['commander', 'brawl', 'legacy', 'vintage'],
    themes: ['graveyard'],
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Animate Dead',
    colors: ['B'],
    role: 'Graveyard Synergy',
    reason: '2-mana enchantment reanimation spell fueling both graveyard and enchantment triggers.',
    formats: ['commander', 'legacy', 'vintage'],
    themes: ['graveyard', 'enchantments'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Buried Alive',
    colors: ['B'],
    role: 'Graveyard Synergy',
    reason: 'Entombs up to three synergy creatures straight into your graveyard for recursion.',
    themes: ['graveyard', 'aristocrats'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Zulaport Cutthroat',
    colors: ['B'],
    role: 'Aristocrats Synergy',
    reason: 'Drains every opponent whenever your creatures die or are sacrificed.',
    themes: ['aristocrats', 'tokens'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Blood Artist',
    colors: ['B'],
    role: 'Aristocrats Synergy',
    reason: '2-mana drain payoff triggering off every creature dying across the entire table.',
    themes: ['aristocrats', 'tokens', 'lifegain'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Viscera Seer',
    colors: ['B'],
    role: 'Aristocrats Synergy',
    reason: '1-mana free, instant-speed sacrifice outlet that scries away excess lands.',
    themes: ['aristocrats', 'graveyard'],
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Haunting Voyage',
    colors: ['B'],
    role: 'Tribal Synergy',
    reason: 'Foretold mass-reanimation finisher that returns your whole tribe from the graveyard.',
    themes: ['tribal', 'graveyard'],
    powerTier: 'all',
    cmc: 6,
  },
  {
    name: 'Bojuka Bog',
    colors: ['B'],
    role: 'Land',
    reason: 'Black utility land slot that exiles opposing graveyards at zero spell-slot cost.',
    powerTier: 'all',
    cmc: 0,
  },

  // === Red ===
  {
    name: 'Chaos Warp',
    colors: ['R'],
    role: 'Removal',
    reason: 'Flexible 3-mana instant answer for enchantments, planeswalkers, or problem permanents.',
    formats: ['commander', 'brawl', 'legacy', 'vintage'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Abrade',
    colors: ['R'],
    role: 'Removal',
    reason: 'Modal 2-mana instant dealing with early creatures or mana-accelerating artifacts.',
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Vandalblast',
    colors: ['R'],
    role: 'Removal',
    reason: '1-mana artifact removal early or one-sided artifact sweeper overloaded late.',
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Blasphemous Act',
    colors: ['R'],
    role: 'Board Wipe',
    reason: 'Commonly casts for {R} to clear crowded boards cleanly.',
    powerTier: 'all',
    cmc: 9,
  },
  {
    name: 'Jeska\'s Will',
    colors: ['R'],
    role: 'Mana Ramp',
    reason: 'Explosive Red ritual plus impulse card draw when your commander is on board.',
    formats: ['commander', 'brawl', 'legacy', 'vintage'],
    themes: ['spellslinger', 'aggro'],
    powerTier: 'high',
    cmc: 3,
  },
  {
    name: 'Faithless Looting',
    colors: ['R'],
    role: 'Card Draw',
    reason: '1-mana spell velocity that sculpts hands and stocks your graveyard with Flashback.',
    themes: ['graveyard', 'spellslinger', 'artifacts'],
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Guttersnipe',
    colors: ['R'],
    role: 'Spellslinger Synergy',
    reason: 'Converts every instant and sorcery directly into table-wide burn damage.',
    themes: ['spellslinger'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Storm-Kiln Artist',
    colors: ['R'],
    role: 'Spellslinger Synergy',
    reason: 'Generates a Treasure token for every instant or sorcery cast or copied.',
    themes: ['spellslinger', 'artifacts', 'tokens'],
    powerTier: 'all',
    cmc: 4,
  },
  {
    name: 'Impact Tremors',
    colors: ['R'],
    role: 'Token Synergy',
    reason: '2-mana enchantment turning every creature or token ETB into table-wide damage.',
    themes: ['tokens', 'aristocrats', 'aggro', 'tribal'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Shared Animosity',
    colors: ['R'],
    role: 'Tribal Synergy',
    reason: 'Turns wide tribal attacks into explosive lethal damage spikes.',
    themes: ['tribal', 'tokens', 'aggro'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Goblin Bombardment',
    colors: ['R'],
    role: 'Aristocrats Synergy',
    reason: '2-mana free sacrifice outlet turning dying tokens or creatures into direct damage.',
    themes: ['aristocrats', 'tokens', 'aggro'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Reckless Fireweaver',
    colors: ['R'],
    role: 'Artifact Synergy',
    reason: 'Burns every opponent whenever an artifact or Treasure enters your board.',
    themes: ['artifacts', 'tokens'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Valakut Awakening',
    colors: ['R'],
    role: 'Card Draw',
    reason: 'MDFC land/wheel instant that tucks flooded lands or dead draws for fresh gas.',
    powerTier: 'all',
    cmc: 3,
  },

  // === Green ===
  {
    name: 'Nature\'s Lore',
    colors: ['G'],
    role: 'Mana Ramp',
    reason: '2-mana ramp finding any Forest (including shocklands/triomes) into play untapped.',
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Three Visits',
    colors: ['G'],
    role: 'Mana Ramp',
    reason: 'Redundant 2-mana untapped Forest tutor for smooth early mana fixing.',
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Farseek',
    colors: ['G'],
    role: 'Mana Ramp',
    reason: '2-mana ramp tutoring non-Forest duals and triomes to fix multicolor pips.',
    powerTier: 'casual',
    cmc: 2,
  },
  {
    name: 'Birds of Paradise',
    colors: ['G'],
    role: 'Mana Ramp',
    reason: '1-mana flying dork fixing all five colors from turn one.',
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Beast Within',
    colors: ['G'],
    role: 'Removal',
    reason: 'Instant-speed Green answer destroying any permanent on the battlefield.',
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Nature\'s Claim',
    colors: ['G'],
    role: 'Removal',
    reason: '1-mana instant answer to problem artifacts and enchantments.',
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Heroic Intervention',
    colors: ['G'],
    role: 'Protection',
    reason: '2-mana instant hexproof and indestructible shield protecting your entire board.',
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Guardian Project',
    colors: ['G'],
    role: 'Card Draw',
    reason: 'Turns every nontoken creature entering into a fresh card draw in Commander.',
    formats: ['commander', 'brawl'],
    themes: ['tribal', 'counters', 'blink', 'aggro'],
    powerTier: 'all',
    cmc: 4,
  },
  {
    name: 'Beast Whisperer',
    colors: ['G'],
    role: 'Card Draw',
    reason: 'Draws a card every time you cast a creature spell in creature-centric builds.',
    themes: ['tribal', 'counters', 'tokens', 'aggro'],
    powerTier: 'all',
    cmc: 4,
  },
  {
    name: 'Return of the Wildspeaker',
    colors: ['G'],
    role: 'Card Draw',
    reason: 'Instant-speed massive draw or +3/+3 overrun finisher for non-Human creature boards.',
    themes: ['tribal', 'counters', 'aggro'],
    powerTier: 'all',
    cmc: 5,
  },
  {
    name: 'Hardened Scales',
    colors: ['G'],
    role: '+1/+1 Counters',
    reason: '1-mana enchantment multiplying every +1/+1 counter placed on your creatures.',
    themes: ['counters', 'enchantments'],
    powerTier: 'all',
    cmc: 1,
  },
  {
    name: 'Branching Evolution',
    colors: ['G'],
    role: '+1/+1 Counters',
    reason: 'Doubles all +1/+1 counters placed on your creatures.',
    themes: ['counters', 'enchantments'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Parallel Lives',
    colors: ['G'],
    role: 'Token Synergy',
    reason: 'Doubles every creature, Food, or Treasure token generated on your board.',
    themes: ['tokens', 'aristocrats', 'enchantments', 'landfall'],
    powerTier: 'all',
    cmc: 4,
  },
  {
    name: 'Eternal Witness',
    colors: ['G'],
    role: 'Graveyard Synergy',
    reason: 'Regrows any card from your graveyard on ETB—pairs naturally with blink or recursion.',
    themes: ['graveyard', 'blink'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Bala Ged Recovery',
    colors: ['G'],
    role: 'Land',
    reason: 'MDFC tapped land that doubles as graveyard recursion when drawn late.',
    themes: ['graveyard', 'landfall'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Lotus Cobra',
    colors: ['G'],
    role: 'Landfall Synergy',
    reason: 'Generates free colored mana on every land drop and double mana off fetchlands.',
    themes: ['landfall', 'mana'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Tireless Provisioner',
    colors: ['G'],
    role: 'Landfall Synergy',
    reason: 'Creates a Treasure or Food on every landfall trigger to ramp and fuel artifacts/tokens.',
    themes: ['landfall', 'tokens', 'artifacts'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Realmwalker',
    colors: ['G'],
    role: 'Tribal Synergy',
    reason: 'Changeling letting you cast matching creatures directly off the top of your library.',
    themes: ['tribal'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Enchantress\'s Presence',
    colors: ['G'],
    role: 'Enchantment Synergy',
    reason: 'Resilient enchantment-type card draw engine triggering on every enchantment cast.',
    themes: ['enchantments'],
    powerTier: 'all',
    cmc: 3,
  },

  // === Multicolor Synergy Staples ===
  {
    name: 'Dovin\'s Veto',
    colors: ['W', 'U'],
    role: 'Protection',
    reason: 'Uncounterable 2-mana answer to noncreature sweepers and game-ending combos.',
    themes: ['spellslinger', 'control'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Soulherder',
    colors: ['W', 'U'],
    role: 'Blink & ETB Synergy',
    reason: 'Blinks a creature every end step while growing massive off your flicker triggers.',
    themes: ['blink'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Expressive Iteration',
    colors: ['U', 'R'],
    role: 'Spellslinger Synergy',
    reason: 'Efficient 2-mana card selection tailored for spell-dense curves.',
    themes: ['spellslinger'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Third Path Iconoclast',
    colors: ['U', 'R'],
    role: 'Spellslinger Synergy',
    reason: 'Creates a 1/1 Soldier artifact token on every noncreature spell cast.',
    themes: ['spellslinger', 'tokens', 'artifacts'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Veyran, Voice of Duality',
    colors: ['U', 'R'],
    role: 'Spellslinger Synergy',
    reason: 'Doubles every cast/copy trigger across all your magecraft and spellslinger payoffs.',
    themes: ['spellslinger'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Cruel Celebrant',
    colors: ['W', 'B'],
    role: 'Aristocrats Synergy',
    reason: '2-mana drain payoff triggering whenever your creatures or planeswalkers die.',
    themes: ['aristocrats', 'tokens'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Anguished Unmaking',
    colors: ['W', 'B'],
    role: 'Removal',
    reason: '3-mana instant exile removal for any nonland permanent.',
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Elas il-Kor, Sadistic Pilgrim',
    colors: ['W', 'B'],
    role: 'Aristocrats Synergy',
    reason: 'Gain-and-drain creature rewarding both token ETBs and sacrifice deaths.',
    themes: ['aristocrats', 'tokens', 'lifegain'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Assassin\'s Trophy',
    colors: ['B', 'G'],
    role: 'Removal',
    reason: '2-mana instant catch-all answer for any permanent on board.',
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Abrupt Decay',
    colors: ['B', 'G'],
    role: 'Removal',
    reason: 'Uncounterable 2-mana instant answer for MV <= 3 engines and hate pieces.',
    powerTier: 'high',
    cmc: 2,
  },
  {
    name: 'Grisly Salvage',
    colors: ['B', 'G'],
    role: 'Graveyard Synergy',
    reason: '2-mana instant digging 5 cards deep for a creature/land while filling the graveyard.',
    themes: ['graveyard', 'landfall'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Sythis, Harvest\'s Hand',
    colors: ['W', 'G'],
    role: 'Enchantment Synergy',
    reason: '2-mana enchantress engine gaining life and drawing a card per enchantment cast.',
    themes: ['enchantments', 'lifegain'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Aura Shards',
    colors: ['W', 'G'],
    role: 'Token Synergy',
    reason: 'Turns every creature or token ETB into repeatable artifact/enchantment removal.',
    themes: ['tokens', 'blink', 'enchantments', 'tribal'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Conclave Mentor',
    colors: ['W', 'G'],
    role: '+1/+1 Counters',
    reason: '2-mana Hardened Scales on a body that pads life when removed.',
    themes: ['counters'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Tatyova, Benthic Druid',
    colors: ['U', 'G'],
    role: 'Landfall Synergy',
    reason: 'Rewards every land drop with 1 life and a fresh card draw.',
    themes: ['landfall'],
    powerTier: 'all',
    cmc: 5,
  },
  {
    name: 'Growth Spiral',
    colors: ['U', 'G'],
    role: 'Mana Ramp',
    reason: '2-mana instant cantrip that drops an extra land cleanly on opponents’ end steps.',
    themes: ['landfall', 'spellslinger'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Rhythm of the Wild',
    colors: ['R', 'G'],
    role: 'Aggro Synergy',
    reason: 'Makes creature spells uncounterable and grants riot (+1/+1 counter or haste).',
    themes: ['aggro', 'counters', 'tribal', 'enchantments'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Mayhem Devil',
    colors: ['B', 'R'],
    role: 'Aristocrats Synergy',
    reason: 'Ping engine dealing 1 damage per sacrifice anywhere—including Treasure and fetchlands.',
    themes: ['aristocrats', 'tokens'],
    powerTier: 'all',
    cmc: 3,
  },
  {
    name: 'Terminate',
    colors: ['B', 'R'],
    role: 'Removal',
    reason: '2-mana instant unconditional creature removal.',
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Boros Charm',
    colors: ['W', 'R'],
    role: 'Protection',
    reason: '2-mana instant indestructible board protection or surprise double strike for Voltron wins.',
    themes: ['voltron', 'aggro', 'spellslinger'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Wear // Tear',
    colors: ['W', 'R'],
    role: 'Removal',
    reason: 'Low-cost Fuse instant destroying both artifacts and enchantments cleanly.',
    themes: ['spellslinger'],
    powerTier: 'all',
    cmc: 2,
  },
  {
    name: 'Baleful Strix',
    colors: ['U', 'B'],
    role: 'Card Draw',
    reason: '2-mana flying deathtouch blocker that replaces itself immediately and adds artifact count.',
    themes: ['artifacts', 'blink'],
    powerTier: 'all',
    cmc: 2,
  },
];

interface AntiSynergyRule {
  cardLower: string;
  requiredThemes?: string[];
  check?: (ctx: {
    themes: string[];
    identityColors: string[];
    manaDorkCount: number;
    nonBasicLandCount: number;
    landCount: number;
  }) => boolean;
  reason: string;
  roleHint: string;
}

const ANTI_SYNERGY_RULES: AntiSynergyRule[] = [
  {
    cardLower: 'rest in peace',
    requiredThemes: ['graveyard', 'aristocrats'],
    reason:
      'Exiles all graveyards—including your own—shutting off graveyard recursion, reanimation, and death triggers.',
    roleHint: 'Removal',
  },
  {
    cardLower: "grafdigger's cage",
    requiredThemes: ['graveyard'],
    reason:
      'Prevents creatures from entering from graveyards or libraries, directly blanking your reanimator game plan.',
    roleHint: 'Removal',
  },
  {
    cardLower: 'weathered runestone',
    requiredThemes: ['graveyard'],
    reason:
      'Blocks nonland permanents from entering from your own graveyard or library, conflicting with recursion.',
    roleHint: 'Removal',
  },
  {
    cardLower: 'ground seal',
    requiredThemes: ['graveyard'],
    reason:
      'Prevents targeting cards in any graveyard, stopping your own targeted recursion and reanimation spells.',
    roleHint: 'Card Draw',
  },
  {
    cardLower: 'necropotence',
    requiredThemes: ['graveyard'],
    reason:
      'Exiles cards you discard instead of putting them into your graveyard, disrupting discard/graveyard synergies.',
    roleHint: 'Card Draw',
  },
  {
    cardLower: 'collector ouphe',
    requiredThemes: ['artifacts', 'voltron'],
    reason:
      'Shuts off activated abilities of all artifacts—including your own mana rocks, Equipment, and Treasure engines.',
    roleHint: 'Mana Ramp',
  },
  {
    cardLower: 'null rod',
    requiredThemes: ['artifacts', 'voltron'],
    reason:
      'Turns off activated abilities of your own artifact base, equipment, and mana rocks.',
    roleHint: 'Mana Ramp',
  },
  {
    cardLower: 'stony silence',
    requiredThemes: ['artifacts', 'voltron'],
    reason:
      'Disables your own artifact mana rocks, clues/treasures, and artifact/equipment engines.',
    roleHint: 'Removal',
  },
  {
    cardLower: 'kataki, war\'s wage',
    requiredThemes: ['artifacts'],
    reason:
      'Forces an upkeep {1} tax on every artifact you control, punishing wide artifact and Treasure boards.',
    roleHint: 'Protection',
  },
  {
    cardLower: 'energy flux',
    requiredThemes: ['artifacts'],
    reason:
      'Forces an upkeep {2} tax on each of your own artifacts, wrecking artifact-heavy board states.',
    roleHint: 'Interaction',
  },
  {
    cardLower: 'bane of progress',
    requiredThemes: ['artifacts', 'enchantments', 'voltron'],
    reason:
      'Sweeps all artifacts and enchantments on the table—destroying your own synergy core alongside opponents’.',
    roleHint: 'Removal',
  },
  {
    cardLower: 'creeping corrosion',
    requiredThemes: ['artifacts', 'voltron'],
    reason:
      'Destroys your own artifact mana base and equipment alongside opposing artifacts.',
    roleHint: 'Removal',
  },
  {
    cardLower: 'back to nature',
    requiredThemes: ['enchantments'],
    reason:
      'Destroys all enchantments on the battlefield, wiping out your own enchantress board.',
    roleHint: 'Removal',
  },
  {
    cardLower: 'tranquility',
    requiredThemes: ['enchantments'],
    reason:
      'Sweeps your own enchantments alongside opponents’ boards.',
    roleHint: 'Removal',
  },
  {
    cardLower: 'torpor orb',
    requiredThemes: ['blink'],
    reason:
      'Stops creatures from triggering enters-the-battlefield abilities, disabling the core payoff of your ETB/blink deck.',
    roleHint: 'Protection',
  },
  {
    cardLower: 'hushbringer',
    requiredThemes: ['blink', 'aristocrats'],
    reason:
      'Suppresses both ETB and dies triggers across the table, undercutting your own creature value triggers.',
    roleHint: 'Protection',
  },
  {
    cardLower: 'strict proctor',
    requiredThemes: ['blink', 'landfall'],
    reason:
      'Counters your own ETB and landfall triggers unless you pay {2} each time.',
    roleHint: 'Protection',
  },
  {
    cardLower: 'containment priest',
    requiredThemes: ['blink', 'graveyard'],
    reason:
      'Exiles nontoken creatures entering without being cast—blanking your own flicker and reanimation lines.',
    roleHint: 'Protection',
  },
  {
    cardLower: 'solemnity',
    requiredThemes: ['counters'],
    reason:
      'Prevents counters from being placed on creatures, completely shutting off your +1/+1 counter engine.',
    roleHint: 'Protection',
  },
  {
    cardLower: 'yasharn, implacable earth',
    requiredThemes: ['aristocrats'],
    reason:
      'Stops players from paying life or sacrificing nonland permanents—locking out your own sacrifice outlets and Treasures.',
    roleHint: 'Mana Ramp',
  },
  {
    cardLower: 'angel of jubilation',
    requiredThemes: ['aristocrats'],
    reason:
      'Prevents players from paying life or sacrificing creatures to cast spells or activate abilities.',
    roleHint: 'Token Synergy',
  },
  {
    cardLower: 'humility',
    requiredThemes: ['voltron', 'counters', 'tribal', 'blink'],
    reason:
      'Removes all creature abilities and sets base P/T to 1/1, erasing your commander/tribal/ETB payoffs.',
    roleHint: 'Board Wipe',
  },
  {
    cardLower: 'cursed totem',
    check: (ctx) => ctx.manaDorkCount >= 5,
    reason:
      'Shuts down activated abilities of all creatures—turning off your own mana dorks and creature utility engines.',
    roleHint: 'Removal',
  },
  {
    cardLower: 'linvala, keeper of silence',
    check: (ctx) => false, // Only opponents
    reason: '',
    roleHint: 'Removal',
  },
  {
    cardLower: 'thalia, guardian of thraben',
    requiredThemes: ['spellslinger'],
    reason:
      'Taxes your own instants and sorceries by {1}, slowing down multi-spell spellslinger turns.',
    roleHint: 'Spellslinger Synergy',
  },
  {
    cardLower: 'thorn of amethyst',
    requiredThemes: ['spellslinger'],
    reason:
      'Adds a {1} tax to every noncreature spell you cast in a spell-heavy deck.',
    roleHint: 'Spellslinger Synergy',
  },
  {
    cardLower: 'damping sphere',
    requiredThemes: ['spellslinger'],
    reason:
      'Increases the cost of every consecutive spell each turn, punishing multi-spell turns.',
    roleHint: 'Interaction',
  },
  {
    cardLower: 'rule of law',
    requiredThemes: ['spellslinger'],
    reason:
      'Caps players at one spell per turn, preventing your spellslinger deck from chaining cantrips or payoffs.',
    roleHint: 'Interaction',
  },
  {
    cardLower: 'deafening silence',
    requiredThemes: ['spellslinger'],
    reason:
      'Restricts you to one noncreature spell per turn, directly shutting off spellslinger chains.',
    roleHint: 'Interaction',
  },
  {
    cardLower: 'blood moon',
    check: (ctx) => ctx.identityColors.length >= 3 && ctx.nonBasicLandCount >= 14,
    reason:
      'Turns your own greedy multicolor nonbasic landbase into basic Mountains, locking you out of non-Red pips.',
    roleHint: 'Removal',
  },
  {
    cardLower: 'magus of the moon',
    check: (ctx) => ctx.identityColors.length >= 3 && ctx.nonBasicLandCount >= 14,
    reason:
      'Turns all your nonbasic lands into Mountains in a 3+ color deck, stranding off-Red spells in hand.',
    roleHint: 'Removal',
  },
  {
    cardLower: 'back to basics',
    check: (ctx) => ctx.identityColors.length >= 3 && ctx.nonBasicLandCount >= 14,
    reason:
      'Prevents most of your own nonbasic multicolor lands from untapping.',
    roleHint: 'Interaction',
  },
  {
    cardLower: 'temple of the false god',
    check: (ctx) => ctx.landCount < 37,
    reason:
      'Dead land before you control four other lands—risky in a list running under 37 total lands.',
    roleHint: 'Land',
  },
  {
    cardLower: 'planar void',
    requiredThemes: ['graveyard'],
    reason:
      'Exiles every card as soon as it hits any graveyard, shutting down your own recursion and reanimation targets.',
    roleHint: 'Removal',
  },
  {
    cardLower: 'ground seal',
    requiredThemes: ['graveyard'],
    reason:
      'Prevents cards in graveyards from being targeted, blocking your own targeted reanimation and regrowth effects.',
    roleHint: 'Card Draw',
  },
  {
    cardLower: 'arcane laboratory',
    requiredThemes: ['spellslinger'],
    reason:
      'Limits every player to one spell per turn, shutting down spellslinger storm and prowess chains.',
    roleHint: 'Interaction',
  },
  {
    cardLower: 'eidolon of rhetoric',
    requiredThemes: ['spellslinger'],
    reason:
      'Restricts all players to casting only one spell per turn in a deck built to chain spells.',
    roleHint: 'Interaction',
  },
  {
    cardLower: 'ensnaring bridge',
    requiredThemes: ['aggro', 'tokens', 'voltron'],
    reason:
      'Stops your own high-power or wide attackers from dealing combat damage whenever your hand has cards.',
    roleHint: 'Protection',
  },
  {
    cardLower: 'meekstone',
    requiredThemes: ['voltron', 'counters'],
    reason:
      'Prevents your own power-3+ commanders and +1/+1 counter threats from untapping during untap steps.',
    roleHint: 'Removal',
  },
];

interface StrictlyOutclassedRule {
  title: string;
  reason: string;
  role: string;
  formats?: Array<Exclude<DeckFormat, 'auto'>>;
}

const STRICTLY_OUTCLASSED_CARDS: Record<string, StrictlyOutclassedRule> = {
  cancel: {
    title: 'Outclassed Counterspell',
    reason: '3-mana Cancel with double Blue pips is strictly slower than 2-MV answers like Counterspell, Arcane Denial, or Negate.',
    role: 'Interaction',
  },
  murder: {
    title: 'Outclassed Removal',
    reason: 'At {1}{B}{B}, Murder taxes Black pips for a slow effect easily upgraded to 2-MV instant removal.',
    role: 'Removal',
  },
  'diabolic tutor': {
    title: 'Slow Tutor Curve',
    reason: '4-mana sorcery tutoring loses major tempo compared to efficient card draw or synergy engines.',
    role: 'Card Draw',
  },
  divination: {
    title: 'Outclassed Card Draw',
    reason: '3-mana sorcery draw two is outpaced by 1–2 MV cantrips and repeatable draw engines.',
    role: 'Card Draw',
  },
  manalith: {
    title: 'Clunky 3-MV Mana Rock',
    reason: '3-mana tap-for-1 rocks fall a full turn behind 2-MV untapped rocks like Arcane Signet or Fellwar Stone.',
    role: 'Mana Ramp',
  },
  'darksteel ingot': {
    title: 'Clunky 3-MV Mana Rock',
    reason: '3-mana ramp gives up early tempo when 2-MV rocks accelerate your turn-3 plays.',
    role: 'Mana Ramp',
  },
  'azorius locket': {
    title: 'Clunky 3-MV Mana Rock',
    reason: '3-MV Lockets are outpaced by 2-MV rocks in fixing and tempo.',
    role: 'Mana Ramp',
  },
  'boros locket': {
    title: 'Clunky 3-MV Mana Rock',
    reason: '3-MV Lockets are outpaced by 2-MV rocks in fixing and tempo.',
    role: 'Mana Ramp',
  },
  'dimir locket': {
    title: 'Clunky 3-MV Mana Rock',
    reason: '3-MV Lockets are outpaced by 2-MV rocks in fixing and tempo.',
    role: 'Mana Ramp',
  },
  'golgari locket': {
    title: 'Clunky 3-MV Mana Rock',
    reason: '3-MV Lockets are outpaced by 2-MV rocks in fixing and tempo.',
    role: 'Mana Ramp',
  },
  'gruul locket': {
    title: 'Clunky 3-MV Mana Rock',
    reason: '3-MV Lockets are outpaced by 2-MV rocks in fixing and tempo.',
    role: 'Mana Ramp',
  },
  'izzet locket': {
    title: 'Clunky 3-MV Mana Rock',
    reason: '3-MV Lockets are outpaced by 2-MV rocks in fixing and tempo.',
    role: 'Mana Ramp',
  },
  'orzhov locket': {
    title: 'Clunky 3-MV Mana Rock',
    reason: '3-MV Lockets are outpaced by 2-MV rocks in fixing and tempo.',
    role: 'Mana Ramp',
  },
  'rakdos locket': {
    title: 'Clunky 3-MV Mana Rock',
    reason: '3-MV Lockets are outpaced by 2-MV rocks in fixing and tempo.',
    role: 'Mana Ramp',
  },
  'selesnya locket': {
    title: 'Clunky 3-MV Mana Rock',
    reason: '3-MV Lockets are outpaced by 2-MV rocks in fixing and tempo.',
    role: 'Mana Ramp',
  },
  'simic locket': {
    title: 'Clunky 3-MV Mana Rock',
    reason: '3-MV Lockets are outpaced by 2-MV rocks in fixing and tempo.',
    role: 'Mana Ramp',
  },
};

const GENERIC_CLASS_TYPES = new Set([
  'human',
  'legendary',
  'creature',
  'artifact',
  'enchantment',
  'snow',
  'kindred',
  'tribal',
  'token',
]);

function detectStrategyProfile(analysis: DeckAnalysisResult): {
  primaryThemes: string[];
  dominantTribe: string | null;
  identityColors: string[];
  identityLabel: string;
  manaDorkCount: number;
  nonBasicLandCount: number;
  landCount: number;
} {
  const metrics = analysis?.metrics;
  const resolvedCards = analysis?.resolvedCards || [];
  const archetype = analysis?.archetype || '';
  const verdictSummary = analysis?.verdictSummary || '';
  const contextText = `${archetype} ${verdictSummary}`.toLowerCase();

  const mainCards = resolvedCards.filter(
    (c) => c && (c.zone === 'main' || c.zone === 'commander' || c.zone === 'companion')
  );
  const commanders = resolvedCards.filter((c) => c && c.zone === 'commander');
  const commanderText = commanders
    .map((c) => `${c.card?.typeLine || ''} ${c.card?.oracleText || ''}`.toLowerCase())
    .join(' ');

  let instantSorceryCount = 0;
  let artifactCount = 0;
  let enchantmentCount = 0;
  let creatureCount = 0;
  let graveyardHits = 0;
  let tokenHits = 0;
  let counterHits = 0;
  let sacrificeHits = 0;
  let etbHits = 0;
  let landfallHits = 0;
  let equipmentHits = 0;
  let lifegainHits = 0;
  let manaDorkCount = 0;
  let nonBasicLandCount = 0;
  let landCount = 0;

  const tribeCounts = new Map<string, number>();

  for (const item of mainCards) {
    const meta = item.card;
    if (!meta) continue;
    const typeLower = (meta.typeLine || '').toLowerCase();
    const oracleLower = (meta.oracleText || '').toLowerCase();

    if (meta.isLand) {
      landCount += item.quantity;
      if (!typeLower.includes('basic')) {
        nonBasicLandCount += item.quantity;
      }
      continue;
    }

    if (typeLower.includes('instant') || typeLower.includes('sorcery')) {
      instantSorceryCount += item.quantity;
    }
    if (typeLower.includes('artifact')) {
      artifactCount += item.quantity;
    }
    if (typeLower.includes('enchantment')) {
      enchantmentCount += item.quantity;
    }
    if (typeLower.includes('creature')) {
      creatureCount += item.quantity;
      if (/\{t\}:?\s*add\b/i.test(meta.oracleText || '')) {
        manaDorkCount += item.quantity;
      }
      const dashIdx = (meta.typeLine || '').indexOf('—');
      if (dashIdx !== -1) {
        const subtypes = (meta.typeLine || '')
          .slice(dashIdx + 1)
          .trim()
          .split(/\s+/);
        for (const st of subtypes) {
          const clean = st.toLowerCase().replace(/[^a-z-]/g, '');
          if (clean.length >= 3 && !GENERIC_CLASS_TYPES.has(clean)) {
            tribeCounts.set(st, (tribeCounts.get(st) || 0) + item.quantity);
          }
        }
      }
    }

    if (
      /graveyard|reanimate|return target creature card|mill |flashback|unearth|delve|escape|dredge/.test(
        oracleLower
      )
    ) {
      graveyardHits += item.quantity;
    }
    if (/create .* token/.test(oracleLower)) tokenHits += item.quantity;
    if (/\+1\/\+1 counter/.test(oracleLower)) counterHits += item.quantity;
    if (/sacrifice a creature|whenever .* dies/.test(oracleLower)) {
      sacrificeHits += item.quantity;
    }
    if (/enters the battlefield|enters,|flicker|exile target .* return it/.test(oracleLower)) {
      etbHits += item.quantity;
    }
    if (/landfall|whenever a land you control enters/.test(oracleLower)) {
      landfallHits += item.quantity;
    }
    if (typeLower.includes('equipment') || /equipped creature/.test(oracleLower)) {
      equipmentHits += item.quantity;
    }
    if (/whenever you gain life|you gain \d+ life/.test(oracleLower)) {
      lifegainHits += item.quantity;
    }
  }

  // Dominant tribe detection
  let dominantTribe: string | null = null;
  const sortedTribes = Array.from(tribeCounts.entries()).sort((a, b) => b[1] - a[1]);
  if (sortedTribes.length > 0) {
    const [topTribe, topCount] = sortedTribes[0];
    const ratio = creatureCount > 0 ? topCount / creatureCount : 0;
    const mentionedInArchetypeOrCmd =
      contextText.includes(topTribe.toLowerCase()) ||
      commanderText.includes(topTribe.toLowerCase());
    if ((topCount >= 10 && ratio >= 0.36) || (mentionedInArchetypeOrCmd && topCount >= 7)) {
      dominantTribe = topTribe;
    }
  }

  const themes: string[] = [];
  if (dominantTribe || /tribal|kindred/.test(contextText)) themes.push('tribal');
  if (
    instantSorceryCount >= 22 ||
    /spellslinger|storm|prowess|magecraft|cantrip/.test(`${contextText} ${commanderText}`)
  ) {
    themes.push('spellslinger');
  }
  if (
    artifactCount >= 14 ||
    /artifact|equipment|affinity/.test(`${contextText} ${commanderText}`)
  ) {
    themes.push('artifacts');
  }
  if (
    enchantmentCount >= 14 ||
    /enchantress|enchantment|aura/.test(`${contextText} ${commanderText}`)
  ) {
    themes.push('enchantments');
  }
  if (
    graveyardHits >= 10 ||
    /graveyard|reanimator|self-mill|dredge/.test(`${contextText} ${commanderText}`)
  ) {
    themes.push('graveyard');
  }
  if (
    sacrificeHits >= 8 ||
    /aristocrat|sacrifice/.test(`${contextText} ${commanderText}`)
  ) {
    themes.push('aristocrats');
  }
  if (tokenHits >= 10 || /token|go-wide/.test(`${contextText} ${commanderText}`)) {
    themes.push('tokens');
  }
  if (counterHits >= 10 || /\+1\/\+1 counter|counters/.test(`${contextText} ${commanderText}`)) {
    themes.push('counters');
  }
  if (etbHits >= 12 || /blink|flicker|etb/.test(`${contextText} ${commanderText}`)) {
    themes.push('blink');
  }
  if (landfallHits >= 6 || /landfall/.test(`${contextText} ${commanderText}`)) {
    themes.push('landfall');
  }
  if (equipmentHits >= 6 || /voltron|equipment/.test(`${contextText} ${commanderText}`)) {
    themes.push('voltron');
  }
  if (lifegainHits >= 8 || /lifegain|soul sisters/.test(`${contextText} ${commanderText}`)) {
    themes.push('lifegain');
  }
  if (
    (metrics?.averageCmcNonLand ?? 3) <= 2.4 ||
    /aggro|burn|sligh|weenie/.test(contextText)
  ) {
    themes.push('aggro');
  }
  if (themes.length === 0) {
    themes.push('midrange');
  }

  const activeDeckColors = (metrics?.colorBreakdown || [])
    .filter(
      (c) =>
        c &&
        c.status !== 'unused' &&
        (c.pips > 0 || (metrics?.commanderColorIdentity || []).includes(c.color))
    )
    .map((c) => c.color);

  const hasCommanderIdentity =
    (metrics?.commanderNames || []).length > 0 ||
    metrics?.detectedFormat === 'commander' ||
    metrics?.detectedFormat === 'brawl';

  const cmdIdentity = metrics?.commanderColorIdentity || [];
  let identityColors: string[] =
    cmdIdentity.length > 0 ? cmdIdentity : activeDeckColors;

  if (identityColors.length === 0 && !hasCommanderIdentity) {
    const fallbackSpellColors = new Set<string>();
    for (const item of mainCards) {
      if (!item.card || item.card.isLand) continue;
      for (const col of item.card.colorIdentity || []) {
        if (col === 'W' || col === 'U' || col === 'B' || col === 'R' || col === 'G') {
          fallbackSpellColors.add(col);
        }
      }
    }
    identityColors = Array.from(fallbackSpellColors);
  }

  const identityLabel =
    identityColors.length > 0
      ? identityColors.join('')
      : hasCommanderIdentity
      ? 'Colorless (C)'
      : 'Mono / Colorless';

  return {
    primaryThemes: themes,
    dominantTribe,
    identityColors,
    identityLabel,
    manaDorkCount,
    nonBasicLandCount,
    landCount,
  };
}

function getPreferredRole(meta: CardMetadata | null): string {
  if (!meta) return 'Synergy';
  if (meta.isLand) return 'Land';
  if (meta.isRamp) return 'Mana Ramp';
  if (meta.isBoardWipe) return 'Board Wipe';
  if (meta.isRemoval) return 'Removal';
  if (meta.isDraw) return 'Card Draw';
  if (meta.isProtection) return 'Protection';
  return 'Synergy';
}

function scoreRoleMatch(candRole: string, targetRole: string): boolean {
  const c = candRole.toLowerCase();
  const t = targetRole.toLowerCase();
  if (c === t) return true;
  if (c.includes(t) || t.includes(c)) return true;
  if (t.includes('synergy') && c.includes('synergy')) return true;
  return false;
}

function pickAuditSuggestions(params: {
  cardName: string;
  cardMeta: CardMetadata | null;
  identityColors: string[];
  format: Exclude<DeckFormat, 'auto'>;
  goal?: DeckGoal;
  themes: string[];
  existingCounts: Map<string, number>;
  deckAdditions: DeckAnalysisResult['additions'];
  deckSwaps: DeckAnalysisResult['swaps'];
  globalSuggestionUsage: Map<string, number>;
  topPickUsage: Map<string, number>;
  roleOverride?: string;
  primarySwap?: {
    addCardName: string;
    role: string;
    addReason: string;
    addCardMeta?: CardMetadata | null;
  };
}): ReplacementSuggestion[] {
  const {
    cardName,
    cardMeta,
    identityColors,
    format,
    goal,
    themes,
    existingCounts,
    deckAdditions,
    deckSwaps,
    globalSuggestionUsage,
    topPickUsage,
    roleOverride,
    primarySwap,
  } = params;

  const results: ReplacementSuggestion[] = [];
  const usedKeys = new Set<string>([normalizeDeckCardKey(cardName)]);
  const allowedSet = new Set(identityColors);
  const targetRole = roleOverride || getPreferredRole(cardMeta);
  const isTargetLand = targetRole === 'Land' || Boolean(cardMeta?.isLand);

  const hasSeenCandidate = (name: string): boolean => {
    const key = normalizeDeckCardKey(name);
    if (!key) return true;
    for (const u of usedKeys) {
      if (isSameCardName(u, key)) return true;
    }
    return false;
  };

  const canSuggestCandidate = (
    name: string,
    meta?: CardMetadata | null,
    asTopPick = false
  ): boolean => {
    if (!name || !name.trim() || isSameCardName(name, cardName)) return false;
    if (hasSeenCandidate(name)) return false;
    if (meta && meta.legalInFormat === false) return false;
    const maxCopies = getMaxCopiesForCard(name, format, meta);
    if (!Number.isFinite(maxCopies)) return true;
    const existing = getMapCardCount(existingCounts, name);
    if (existing >= maxCopies) return false;
    if (asTopPick) {
      const topUsed = getMapCardCount(topPickUsage, name);
      if (existing + topUsed >= maxCopies) return false;
    }
    return true;
  };

  const recordResult = (sug: ReplacementSuggestion) => {
    const isTopSlot = results.length === 0;
    results.push(sug);
    usedKeys.add(normalizeDeckCardKey(sug.cardName));
    addMapCardCount(globalSuggestionUsage, sug.cardName, 1);
    if (isTopSlot) {
      addMapCardCount(topPickUsage, sug.cardName, 1);
    }
  };

  // 1. Primary AI-recommended swap for this exact card (when color identity & copy limits are legal)
  if (primarySwap && primarySwap.addCardName?.trim()) {
    const swapName = primarySwap.addCardName.trim();
    const swapMetaColors = primarySwap.addCardMeta?.colorIdentity || [];
    const isSwapLegalInColors = swapMetaColors.every((c) => allowedSet.has(c));
    if (
      isSwapLegalInColors &&
      canSuggestCandidate(swapName, primarySwap.addCardMeta, true)
    ) {
      recordResult({
        cardName: swapName,
        role: primarySwap.role,
        reason: primarySwap.addReason,
        matchLabel: 'Primary Upgrade',
        meta: primarySwap.addCardMeta,
      });
    }
  }

  // 2. Context-aware candidates pulled from AI-generated Additions & unused Swaps
  const dynamicPool: Array<{
    name: string;
    role: string;
    reason: string;
    meta?: CardMetadata | null;
    score: number;
  }> = [];

  for (const add of deckAdditions || []) {
    if (!add || !add.cardName) continue;
    if (!canSuggestCandidate(add.cardName, add.cardMeta, results.length === 0)) continue;
    const colors = add.cardMeta?.colorIdentity || [];
    if (!colors.every((c) => allowedSet.has(c))) continue;
    if (isTargetLand !== Boolean(add.role === 'Land' || add.cardMeta?.isLand)) continue;

    let score = 6;
    if (scoreRoleMatch(add.role || '', targetRole)) score += 6;
    const priorUses = getMapCardCount(globalSuggestionUsage, add.cardName);
    score -= priorUses * 7;

    dynamicPool.push({
      name: add.cardName.trim(),
      role: add.role || 'Deck Synergy',
      reason: add.reason,
      meta: add.cardMeta ?? null,
      score,
    });
  }

  for (const sw of deckSwaps || []) {
    if (!sw || !sw.addCardName) continue;
    if (!canSuggestCandidate(sw.addCardName, sw.addCardMeta, results.length === 0)) continue;
    const colors = sw.addCardMeta?.colorIdentity || [];
    if (!colors.every((c) => allowedSet.has(c))) continue;
    if (isTargetLand !== Boolean(sw.addCardMeta?.isLand)) continue;

    let score = 5;
    if (scoreRoleMatch(sw.role || '', targetRole)) score += 5;
    const priorUses = getMapCardCount(globalSuggestionUsage, sw.addCardName);
    score -= priorUses * 7;

    dynamicPool.push({
      name: sw.addCardName.trim(),
      role: sw.role || 'Upgrade',
      reason: sw.addReason,
      meta: sw.addCardMeta ?? null,
      score,
    });
  }

  dynamicPool.sort((a, b) => b.score - a.score);

  if (dynamicPool.length > 0 && dynamicPool[0].score >= 5 && results.length < 3) {
    const pick = dynamicPool[0];
    recordResult({
      cardName: pick.name,
      role: pick.role,
      reason: pick.reason,
      matchLabel: 'Commander Synergy Pick',
      meta: pick.meta,
    });
  }

  // 3. Curated format-legal, theme-aware & bracket-aligned replacements
  const isCasualBracket = goal === 'bracket-1' || goal === 'bracket-2';
  const isHighBracket = goal === 'bracket-4' || goal === 'bracket-5';

  const legalCandidates = CURATED_REPLACEMENTS.filter((cand) => {
    if (!canSuggestCandidate(cand.name, null, results.length === 0)) return false;
    if (cand.formats && !cand.formats.includes(format)) return false;
    if (isTargetLand && cand.role !== 'Land') return false;
    if (!isTargetLand && cand.role === 'Land') return false;
    return cand.colors.every((c) => allowedSet.has(c));
  });

  const scored = legalCandidates
    .map((cand) => {
      let score = 0;

      const roleMatched = scoreRoleMatch(cand.role, targetRole);
      const themeMatches = (cand.themes || []).filter((t) => themes.includes(t));

      if (roleMatched) score += 7;
      score += themeMatches.length * 5;

      if (cardMeta && typeof cand.cmc === 'number' && !isTargetLand) {
        if (cand.cmc <= Math.max(2, cardMeta.cmc)) score += 2;
        if (cand.cmc >= 5 && cardMeta.cmc <= 2) score -= 3;
      }

      if (isCasualBracket && cand.powerTier === 'high') score -= 4;
      if (isCasualBracket && cand.powerTier === 'casual') score += 2;
      if (isHighBracket && cand.powerTier === 'high') score += 4;

      if (identityColors.length > 0 && cand.colors.length > 0) score += 1.5;

      const priorUses = getMapCardCount(globalSuggestionUsage, cand.name);
      score -= priorUses * 9;

      let matchLabel = 'Role Staple';
      if (themeMatches.length > 0 && roleMatched) {
        matchLabel = 'Theme + Role Match';
      } else if (themeMatches.length > 0) {
        matchLabel = `${themeMatches[0].charAt(0).toUpperCase() + themeMatches[0].slice(1)} Synergy`;
      } else if (roleMatched) {
        matchLabel = `${cand.role} Upgrade`;
      }

      return { cand, score, matchLabel };
    })
    .sort((a, b) => b.score - a.score);

  for (const { cand, matchLabel } of scored) {
    if (results.length >= 3) break;
    if (!canSuggestCandidate(cand.name, null, results.length === 0)) continue;
    recordResult({
      cardName: cand.name,
      role: cand.role,
      reason: cand.reason,
      matchLabel,
    });
  }

  return results;
}

export function runSynergyAndColorAudit(
  analysis: DeckAnalysisResult
): SynergyAuditReport {
  const profile = detectStrategyProfile(analysis);
  const metrics = analysis?.metrics;
  const resolvedCards = analysis?.resolvedCards || [];
  const swaps = analysis?.swaps || [];
  const cuts = analysis?.cuts || [];
  const additions = analysis?.additions || [];

  const isIdentityEnforced =
    (metrics?.commanderNames || []).length > 0 ||
    metrics?.detectedFormat === 'commander' ||
    metrics?.detectedFormat === 'brawl';

  const allowedIdentitySet = new Set(profile.identityColors);
  const activeColorSourceMap = new Map<string, number>();
  for (const cb of metrics?.colorBreakdown || []) {
    if (cb) activeColorSourceMap.set(cb.color, cb.currentSources);
  }

  const existingCounts = new Map<string, number>();
  for (const rc of resolvedCards) {
    if (rc && rc.name && (rc.zone === 'main' || rc.zone === 'commander' || rc.zone === 'companion')) {
      addMapCardCount(existingCounts, rc.name, rc.quantity || 1);
    }
  }

  const swapByCutKey = new Map(
    swaps
      .filter((s) => Boolean(s && s.cutCardName))
      .map((s) => [normalizeDeckCardKey(s.cutCardName), s])
  );
  const cutByCardKey = new Map(
    cuts
      .filter((c) => Boolean(c && c.cardName))
      .map((c) => [normalizeDeckCardKey(c.cardName), c])
  );

  const flagged: SynergyFlagItem[] = [];
  const seenCardNames = new Set<string>();
  const globalSuggestionUsage = new Map<string, number>();
  const topPickUsage = new Map<string, number>();

  const scannable = resolvedCards.filter(
    (c) => c && c.name && (c.zone === 'main' || c.zone === 'companion')
  );

  const getSuggestions = (opts: {
    cardName: string;
    cardMeta: CardMetadata | null;
    roleOverride?: string;
    primarySwap?: {
      addCardName: string;
      role: string;
      addReason: string;
      addCardMeta?: CardMetadata | null;
    };
  }) =>
    pickAuditSuggestions({
      cardName: opts.cardName,
      cardMeta: opts.cardMeta,
      identityColors: profile.identityColors,
      format: metrics.detectedFormat,
      goal: analysis.goal,
      themes: profile.primaryThemes,
      existingCounts,
      deckAdditions: additions,
      deckSwaps: swaps,
      globalSuggestionUsage,
      topPickUsage,
      roleOverride: opts.roleOverride,
      primarySwap: opts.primarySwap,
    });

  const activePipMap = new Map<'W' | 'U' | 'B' | 'R' | 'G', number>();
  const activeSpellCountMap = new Map<'W' | 'U' | 'B' | 'R' | 'G', number>();
  const doublePipCountMap = new Map<'W' | 'U' | 'B' | 'R' | 'G', number>();
  const illegalByColorMap = new Map<'W' | 'U' | 'B' | 'R' | 'G', number>();
  for (const rc of scannable) {
    const meta = rc.card;
    if (!meta || meta.isLand) continue;
    const manaStr = meta.manaCost || '';
    const pipHits = manaStr.match(/\{([WUBRG])\}/g) || [];
    const localColorCounts = new Map<'W' | 'U' | 'B' | 'R' | 'G', number>();
    for (const p of pipHits) {
      const col = p.replace(/[{}]/g, '') as 'W' | 'U' | 'B' | 'R' | 'G';
      localColorCounts.set(col, (localColorCounts.get(col) || 0) + 1);
    }
    for (const [col, cnt] of localColorCounts.entries()) {
      activePipMap.set(col, (activePipMap.get(col) || 0) + cnt * (rc.quantity || 1));
      activeSpellCountMap.set(col, (activeSpellCountMap.get(col) || 0) + (rc.quantity || 1));
      if (cnt >= 2) {
        doublePipCountMap.set(col, (doublePipCountMap.get(col) || 0) + (rc.quantity || 1));
      }
    }
  }

  for (const entry of scannable) {
    const key = normalizeDeckCardKey(entry.name);
    if (!key || seenCardNames.has(key)) continue;
    const meta = entry.card;
    const swapMatchKey = findMatchingCardMapKey(swapByCutKey, entry.name);
    const matchedSwap = swapMatchKey ? swapByCutKey.get(swapMatchKey) : undefined;
    const cutMatchKey = findMatchingCardMapKey(cutByCardKey, entry.name);
    const matchedCut = cutMatchKey ? cutByCardKey.get(cutMatchKey) : undefined;
    const primarySwap = matchedSwap
      ? {
          addCardName: matchedSwap.addCardName,
          role: matchedSwap.role,
          addReason: matchedSwap.addReason,
          addCardMeta: matchedSwap.addCardMeta,
        }
      : undefined;

    // 1. Commander Color Identity Check
    if (isIdentityEnforced && meta) {
      const illegalColors = (meta.colorIdentity || []).filter(
        (c) => !allowedIdentitySet.has(c)
      );
      if (illegalColors.length > 0) {
        for (const ic of illegalColors) {
          if (ic === 'W' || ic === 'U' || ic === 'B' || ic === 'R' || ic === 'G') {
            illegalByColorMap.set(ic, (illegalByColorMap.get(ic) || 0) + (entry.quantity || 1));
          }
        }
        seenCardNames.add(key);
        flagged.push({
          id: `audit-ci-${key}`,
          cardName: entry.name,
          quantity: entry.quantity,
          zone: entry.zone,
          cardMeta: meta,
          issueCategory: 'color-identity',
          severity: 'critical',
          issueTitle: 'Outside Commander Color Identity',
          reason: `${entry.name} has color identity (${meta.colorIdentity.join('')}), which includes ${illegalColors.join(', ')} outside your commander’s identity (${profile.identityLabel}).`,
          linkedSwapId: matchedSwap?.id,
          linkedCutId: matchedCut?.id,
          suggestions: getSuggestions({
            cardName: entry.name,
            cardMeta: meta,
            primarySwap,
          }),
        });
        continue;
      }
    }

    // 1b. Dead Mono-Color Land Producing a Color With Zero Spell Demand
    if (meta && meta.isLand) {
      const coloredProduced = (meta.producedMana || []).filter(
        (c): c is 'W' | 'U' | 'B' | 'R' | 'G' =>
          c === 'W' || c === 'U' || c === 'B' || c === 'R' || c === 'G'
      );
      const isMonoColoredProducer = coloredProduced.length === 1;
      const onlyColor = coloredProduced[0];
      const hasFetchOrMultiText = /search your library|any color|choose a color/i.test(
        meta.oracleText || ''
      );
      if (
        isMonoColoredProducer &&
        onlyColor &&
        !hasFetchOrMultiText &&
        (activePipMap.get(onlyColor) ?? 0) === 0 &&
        (!isIdentityEnforced || !allowedIdentitySet.has(onlyColor))
      ) {
        seenCardNames.add(key);
        flagged.push({
          id: `audit-deadland-${key}`,
          cardName: entry.name,
          quantity: entry.quantity,
          zone: entry.zone,
          cardMeta: meta,
          issueCategory: 'off-color-mana',
          severity: 'warning',
          issueTitle: `Unused ${onlyColor} Mana Land`,
          reason: `${entry.name} only produces ${onlyColor} mana, but your deck currently has 0 non-land ${onlyColor} mana pips requiring it.`,
          linkedSwapId: matchedSwap?.id,
          linkedCutId: matchedCut?.id,
          suggestions: getSuggestions({
            cardName: entry.name,
            cardMeta: meta,
            roleOverride: 'Land',
            primarySwap,
          }),
        });
        continue;
      }
    }

    // 2. Uncastable / Off-Color Mana Requirement Check (Constructed & Commander)
    if (meta && !meta.isLand && meta.manaCost) {
      const purePips = meta.manaCost.match(/\{([WUBRG])\}/g) || [];
      const missingColors = Array.from(
        new Set(
          purePips
            .map((p) => p.replace(/[{}]/g, ''))
            .filter((c) => (activeColorSourceMap.get(c) ?? 0) === 0)
        )
      );
      if (missingColors.length > 0) {
        seenCardNames.add(key);
        flagged.push({
          id: `audit-mana-${key}`,
          cardName: entry.name,
          quantity: entry.quantity,
          zone: entry.zone,
          cardMeta: meta,
          issueCategory: 'off-color-mana',
          severity: 'critical',
          issueTitle: 'Uncastable Off-Color Pips',
          reason: `${entry.name} (${meta.manaCost}) requires ${missingColors.join(', ')} mana, but your current mana base has 0 ${missingColors.join('/')} sources.`,
          linkedSwapId: matchedSwap?.id,
          linkedCutId: matchedCut?.id,
          suggestions: getSuggestions({
            cardName: entry.name,
            cardMeta: meta,
            primarySwap,
          }),
        });
        continue;
      }

      // 2b. Severe triple+ pip or early double-pip splash bottleneck check
      const pipCounts = new Map<string, number>();
      for (const p of purePips) {
        const col = p.replace(/[{}]/g, '');
        pipCounts.set(col, (pipCounts.get(col) || 0) + 1);
      }
      const strainedColors = Array.from(pipCounts.entries()).filter(
        ([col, count]) => count >= 3 && (activeColorSourceMap.get(col) ?? 0) < 10
      );
      if (strainedColors.length > 0) {
        seenCardNames.add(key);
        const [col, count] = strainedColors[0];
        flagged.push({
          id: `audit-pip-${key}`,
          cardName: entry.name,
          quantity: entry.quantity,
          zone: entry.zone,
          cardMeta: meta,
          issueCategory: 'off-color-mana',
          severity: 'warning',
          issueTitle: `Heavy ${col} Pip Bottleneck`,
          reason: `${entry.name} demands ${count} ${col} pips (${meta.manaCost}), while your mana base only runs ${activeColorSourceMap.get(col) ?? 0} ${col} sources.`,
          linkedSwapId: matchedSwap?.id,
          linkedCutId: matchedCut?.id,
          suggestions: getSuggestions({
            cardName: entry.name,
            cardMeta: meta,
            primarySwap,
          }),
        });
        continue;
      }

      const doubleStrained = Array.from(pipCounts.entries()).filter(([col, count]) => {
        const src = activeColorSourceMap.get(col) ?? 0;
        return count === 2 && meta.cmc <= 4 && src > 0 && src <= 5;
      });
      if (doubleStrained.length > 0) {
        seenCardNames.add(key);
        const [col] = doubleStrained[0];
        flagged.push({
          id: `audit-dblpip-${key}`,
          cardName: entry.name,
          quantity: entry.quantity,
          zone: entry.zone,
          cardMeta: meta,
          issueCategory: 'off-color-mana',
          severity: 'warning',
          issueTitle: `Early ${col}${col} Double-Pip Strain`,
          reason: `${entry.name} (${meta.manaCost}, MV ${meta.cmc}) needs double ${col} early, but your mana base only has ${activeColorSourceMap.get(col) ?? 0} ${col} sources.`,
          linkedSwapId: matchedSwap?.id,
          linkedCutId: matchedCut?.id,
          suggestions: getSuggestions({
            cardName: entry.name,
            cardMeta: meta,
            primarySwap,
          }),
        });
        continue;
      }
    }

    // 3. Explicit Anti-Synergy ("Nonbo") Check
    const antiRule = ANTI_SYNERGY_RULES.find((r) => {
      if (r.cardLower !== key) return false;
      if (r.check) {
        return r.check({
          themes: profile.primaryThemes,
          identityColors: profile.identityColors,
          manaDorkCount: profile.manaDorkCount,
          nonBasicLandCount: profile.nonBasicLandCount,
          landCount: profile.landCount,
        });
      }
      return (r.requiredThemes || []).some((t) => profile.primaryThemes.includes(t));
    });
    if (antiRule) {
      seenCardNames.add(key);
      flagged.push({
        id: `audit-anti-${key}`,
        cardName: entry.name,
        quantity: entry.quantity,
        zone: entry.zone,
        cardMeta: meta,
        issueCategory: 'anti-synergy',
        severity: 'critical',
        issueTitle: 'Direct Anti-Synergy Conflict',
        reason: antiRule.reason,
        linkedSwapId: matchedSwap?.id,
        linkedCutId: matchedCut?.id,
        suggestions: getSuggestions({
          cardName: entry.name,
          cardMeta: meta,
          roleOverride: antiRule.roleHint,
          primarySwap,
        }),
      });
      continue;
    }

    // 4. Analyzer-Identified Off-Plan / Outclassed / Overcosted Cards
    if (
      matchedCut &&
      (matchedCut.category === 'off-plan' ||
        matchedCut.category === 'illegal' ||
        matchedCut.category === 'outclassed' ||
        matchedCut.category === 'overcosted')
    ) {
      seenCardNames.add(key);
      flagged.push({
        id: `audit-cut-${key}`,
        cardName: entry.name,
        quantity: entry.quantity,
        zone: entry.zone,
        cardMeta: meta,
        issueCategory: 'off-strategy',
        severity: matchedCut.category === 'illegal' ? 'critical' : 'warning',
        issueTitle:
          matchedCut.category === 'overcosted'
            ? 'Overcosted for Deck Tempo'
            : matchedCut.category === 'outclassed'
            ? 'Outclassed Slot'
            : 'Off-Plan Card Choice',
        reason: matchedCut.reason,
        linkedCutId: matchedCut.id,
        suggestions: getSuggestions({
          cardName: entry.name,
          cardMeta: meta,
          primarySwap,
        }),
      });
      continue;
    }

    if (
      matchedSwap &&
      /synergy|off-plan|clunky|slow|outclassed|upgrade|doesn't|does not|fit|theme/i.test(
        `${matchedSwap.cutReason} ${matchedSwap.role}`
      )
    ) {
      seenCardNames.add(key);
      flagged.push({
        id: `audit-swap-${key}`,
        cardName: entry.name,
        quantity: entry.quantity,
        zone: entry.zone,
        cardMeta: meta,
        issueCategory: 'off-strategy',
        severity: 'warning',
        issueTitle: `Strategy Upgrade Available (${matchedSwap.role})`,
        reason: matchedSwap.cutReason,
        linkedSwapId: matchedSwap.id,
        suggestions: getSuggestions({
          cardName: entry.name,
          cardMeta: meta,
          roleOverride: matchedSwap.role,
          primarySwap,
        }),
      });
      continue;
    }

    // 5. Known Outclassed / Clunky Staples
    const outclassed = STRICTLY_OUTCLASSED_CARDS[key];
    if (outclassed) {
      seenCardNames.add(key);
      flagged.push({
        id: `audit-outclassed-${key}`,
        cardName: entry.name,
        quantity: entry.quantity,
        zone: entry.zone,
        cardMeta: meta,
        issueCategory: 'off-strategy',
        severity: 'warning',
        issueTitle: outclassed.title,
        reason: outclassed.reason,
        linkedSwapId: matchedSwap?.id,
        linkedCutId: matchedCut?.id,
        suggestions: getSuggestions({
          cardName: entry.name,
          cardMeta: meta,
          roleOverride: outclassed.role,
          primarySwap,
        }),
      });
      continue;
    }

    // 6. Heuristic Strategy Alignment Checks across Archetypes
    if (meta && !meta.isLand) {
      const typeLower = meta.typeLine.toLowerCase();
      const oracleLower = meta.oracleText.toLowerCase();
      const isUtilityRole =
        meta.isRamp ||
        meta.isDraw ||
        meta.isRemoval ||
        meta.isBoardWipe ||
        meta.isProtection;

      // 6a. Off-tribe creature in a Kindred/Tribal deck
      if (
        profile.dominantTribe &&
        typeLower.includes('creature') &&
        !isUtilityRole &&
        meta.cmc >= 3 &&
        !typeLower.includes(profile.dominantTribe.toLowerCase()) &&
        !oracleLower.includes(profile.dominantTribe.toLowerCase()) &&
        !typeLower.includes('shapeshifter') &&
        !/changeling/i.test(oracleLower)
      ) {
        seenCardNames.add(key);
        flagged.push({
          id: `audit-tribe-${key}`,
          cardName: entry.name,
          quantity: entry.quantity,
          zone: entry.zone,
          cardMeta: meta,
          issueCategory: 'off-strategy',
          severity: 'warning',
          issueTitle: `Off-Tribe Creature (${profile.dominantTribe} Strategy)`,
          reason: `${entry.name} (${meta.typeLine}, MV ${meta.cmc}) neither shares the ${profile.dominantTribe} creature type nor fills a core ramp/draw/removal role.`,
          suggestions: getSuggestions({
            cardName: entry.name,
            cardMeta: meta,
            roleOverride: 'Tribal Synergy',
          }),
        });
        continue;
      }

      // 6b. High-MV non-synergy creature in a Spellslinger deck
      if (
        profile.primaryThemes.includes('spellslinger') &&
        typeLower.includes('creature') &&
        !isUtilityRole &&
        meta.cmc >= 4 &&
        !/instant|sorcery|noncreature|prowess|magecraft|cast a spell/.test(oracleLower)
      ) {
        seenCardNames.add(key);
        flagged.push({
          id: `audit-spell-${key}`,
          cardName: entry.name,
          quantity: entry.quantity,
          zone: entry.zone,
          cardMeta: meta,
          issueCategory: 'off-strategy',
          severity: 'warning',
          issueTitle: 'Clunky Non-Spell Creature',
          reason: `${entry.name} costs ${meta.cmc} mana without triggering off or supporting your instant/sorcery spellslinger plan.`,
          suggestions: getSuggestions({
            cardName: entry.name,
            cardMeta: meta,
            roleOverride: 'Spellslinger Synergy',
          }),
        });
        continue;
      }

      // 6c. Heavy non-enchantment filler in Enchantress / Enchantments deck
      if (
        profile.primaryThemes.includes('enchantments') &&
        !typeLower.includes('enchantment') &&
        !isUtilityRole &&
        meta.cmc >= 4 &&
        !/enchantment|aura|constellation|shrine/.test(oracleLower)
      ) {
        seenCardNames.add(key);
        flagged.push({
          id: `audit-ench-${key}`,
          cardName: entry.name,
          quantity: entry.quantity,
          zone: entry.zone,
          cardMeta: meta,
          issueCategory: 'off-strategy',
          severity: 'warning',
          issueTitle: 'Misses Enchantress Triggers',
          reason: `At MV ${meta.cmc}, ${entry.name} is neither an enchantment nor an enchantress payoff, missing your primary draw/constellation triggers.`,
          suggestions: getSuggestions({
            cardName: entry.name,
            cardMeta: meta,
            roleOverride: 'Enchantment Synergy',
          }),
        });
        continue;
      }

      // 6d. Clunky non-artifact top-end in Artifact deck
      if (
        profile.primaryThemes.includes('artifacts') &&
        !typeLower.includes('artifact') &&
        !isUtilityRole &&
        meta.cmc >= 4 &&
        !/artifact|treasure|clue|food|equipment|affinity|metalcraft|improvise/.test(oracleLower)
      ) {
        seenCardNames.add(key);
        flagged.push({
          id: `audit-art-${key}`,
          cardName: entry.name,
          quantity: entry.quantity,
          zone: entry.zone,
          cardMeta: meta,
          issueCategory: 'off-strategy',
          severity: 'warning',
          issueTitle: 'Off-Theme Non-Artifact Slot',
          reason: `${entry.name} (MV ${meta.cmc}) neither counts as an artifact nor interacts with artifacts, reducing affinity and artifact-trigger density.`,
          suggestions: getSuggestions({
            cardName: entry.name,
            cardMeta: meta,
            roleOverride: 'Artifact Synergy',
          }),
        });
        continue;
      }

      // 6e. Overcosted top-end in low-curve Aggro
      if (
        profile.primaryThemes.includes('aggro') &&
        meta.cmc >= 6 &&
        !oracleLower.includes('affinity') &&
        !oracleLower.includes('delve') &&
        !oracleLower.includes('convoke') &&
        !oracleLower.includes('cost')
      ) {
        seenCardNames.add(key);
        flagged.push({
          id: `audit-aggro-${key}`,
          cardName: entry.name,
          quantity: entry.quantity,
          zone: entry.zone,
          cardMeta: meta,
          issueCategory: 'off-strategy',
          severity: 'warning',
          issueTitle: 'Too Slow for Aggro Curve',
          reason: `At MV ${meta.cmc}, ${entry.name} risks getting stranded in hand in an aggressive deck averaging MV ${metrics.averageCmcNonLand}.`,
          suggestions: getSuggestions({
            cardName: entry.name,
            cardMeta: meta,
          }),
        });
      }
    }
  }

  // Sort critical issues first, then color/anti-synergy, then strategy warnings
  const severityRank: Record<SynergyFlagItem['severity'], number> = {
    critical: 0,
    warning: 1,
  };
  const categoryRank: Record<SynergyIssueCategory, number> = {
    'color-identity': 0,
    'off-color-mana': 1,
    'anti-synergy': 2,
    'off-strategy': 3,
  };

  flagged.sort((a, b) => {
    const sDiff = severityRank[a.severity] - severityRank[b.severity];
    if (sDiff !== 0) return sDiff;
    return categoryRank[a.issueCategory] - categoryRank[b.issueCategory];
  });

  // Compute Per-Color Audit Rows
  const COLOR_META: Array<{ color: 'W' | 'U' | 'B' | 'R' | 'G'; label: string }> = [
    { color: 'W', label: 'White' },
    { color: 'U', label: 'Blue' },
    { color: 'B', label: 'Black' },
    { color: 'R', label: 'Red' },
    { color: 'G', label: 'Green' },
  ];
  const colorBreakdownMap = new Map(
    (metrics?.colorBreakdown || []).map((cb) => [cb.color, cb])
  );
  const colorAuditRows: ColorAuditRow[] = [];
  for (const cm of COLOR_META) {
    const cb = colorBreakdownMap.get(cm.color);
    const pips = activePipMap.get(cm.color) ?? cb?.pips ?? 0;
    const sources = cb?.currentSources ?? activeColorSourceMap.get(cm.color) ?? 0;
    const recommendedSources =
      cb?.recommendedSources ?? (pips > 0 ? Math.max(6, Math.round(pips * 0.65)) : 0);
    const illegalCards = illegalByColorMap.get(cm.color) ?? 0;
    const spellCount = activeSpellCountMap.get(cm.color) ?? 0;
    const doublePipCards = doublePipCountMap.get(cm.color) ?? 0;
    const inIdentity = allowedIdentitySet.has(cm.color);

    if (!inIdentity && pips === 0 && sources === 0 && illegalCards === 0) continue;

    let status: ColorAuditRow['status'] = 'Healthy';
    if (illegalCards > 0) {
      status = 'Identity Violation';
    } else if (pips > 0 && sources === 0) {
      status = 'Zero Sources';
    } else if (pips === 0 && sources > 0 && !inIdentity) {
      status = 'Unused Surplus';
    } else if (sources < Math.max(1, recommendedSources - 3)) {
      status = 'Short';
    } else if (sources < recommendedSources || (doublePipCards >= 2 && sources < 9)) {
      status = 'Tight';
    }

    colorAuditRows.push({
      color: cm.color,
      label: cm.label,
      pips,
      spellCount,
      doublePipCards,
      sources,
      recommendedSources,
      delta: sources - recommendedSources,
      illegalCards,
      status,
    });
  }

  // Theme Match Scoring & Strongest Synergies across Scannable Nonlands
  const THEME_PATTERNS: Array<{
    theme: string;
    label: string;
    match: (typeLower: string, oracleLower: string, dominantTribe: string | null) => boolean;
  }> = [
    {
      theme: 'tribal',
      label: profile.dominantTribe ? `${profile.dominantTribe} Kindred` : 'Kindred / Tribal',
      match: (t, o, tribe) =>
        Boolean(tribe && (t.includes(tribe.toLowerCase()) || o.includes(tribe.toLowerCase()))) ||
        t.includes('shapeshifter') ||
        /changeling|choose a creature type/.test(o),
    },
    {
      theme: 'spellslinger',
      label: 'Spellslinger',
      match: (t, o) =>
        t.includes('instant') ||
        t.includes('sorcery') ||
        /instant|sorcery|magecraft|prowess|cast a noncreature/.test(o),
    },
    {
      theme: 'artifacts',
      label: 'Artifacts',
      match: (t, o) =>
        t.includes('artifact') || /artifact|treasure|clue|food|affinity|improvise/.test(o),
    },
    {
      theme: 'enchantments',
      label: 'Enchantments',
      match: (t, o) =>
        t.includes('enchantment') || /enchantment|aura|constellation|shrine/.test(o),
    },
    {
      theme: 'graveyard',
      label: 'Graveyard',
      match: (_t, o) =>
        /graveyard|reanimate|return target .* card|mill |flashback|unearth|delve|escape|dredge/.test(o),
    },
    {
      theme: 'aristocrats',
      label: 'Sacrifice / Aristocrats',
      match: (_t, o) => /sacrifice a creature|whenever .* dies|blood artist/.test(o),
    },
    {
      theme: 'tokens',
      label: 'Tokens / Go-Wide',
      match: (_t, o) => /create .* token|creature tokens you control/.test(o),
    },
    {
      theme: 'counters',
      label: '+1/+1 Counters',
      match: (_t, o) => /\+1\/\+1 counter|proliferate/.test(o),
    },
    {
      theme: 'blink',
      label: 'ETB / Blink',
      match: (_t, o) => /enters the battlefield|enters,|exile .* return it|flicker/.test(o),
    },
    {
      theme: 'landfall',
      label: 'Landfall / Ramp',
      match: (_t, o) => /landfall|whenever a land you control enters|search your library for a.*land/.test(o),
    },
    {
      theme: 'voltron',
      label: 'Equipment / Voltron',
      match: (t, o) => t.includes('equipment') || /equipped creature|enchanted creature/.test(o),
    },
    {
      theme: 'lifegain',
      label: 'Lifegain',
      match: (_t, o) => /whenever you gain life|you gain \d+ life|lifelink/.test(o),
    },
    {
      theme: 'aggro',
      label: 'Low-Curve Aggro',
      match: (_t, o) => /haste|menace|first strike|deals \d+ damage to each opponent/.test(o),
    },
    {
      theme: 'midrange',
      label: 'Midrange Value',
      match: (_t, o) => /draw a card|destroy target|exile target|add \{/.test(o),
    },
  ];

  const nonLandScannable = scannable.filter((c) => c.card && !c.card.isLand);
  const nonLandTotal = Math.max(
    1,
    nonLandScannable.reduce((sum, c) => sum + (c.quantity || 1), 0)
  );
  const flaggedKeySet = new Set(flagged.map((f) => normalizeDeckCardKey(f.cardName)));

  const themeBuckets = new Map<
    string,
    { label: string; count: number; cards: Array<{ name: string; meta: CardMetadata | null; qty: number }> }
  >();
  for (const activeTheme of profile.primaryThemes) {
    const def = THEME_PATTERNS.find((tp) => tp.theme === activeTheme);
    if (def) {
      themeBuckets.set(activeTheme, { label: def.label, count: 0, cards: [] });
    }
  }

  let alignedNonLandQty = 0;
  const synergyScoredCards: Array<StrongSynergyCard & { score: number }> = [];

  for (const rc of nonLandScannable) {
    const meta = rc.card;
    if (!meta) continue;
    const typeLower = (meta.typeLine || '').toLowerCase();
    const oracleLower = (meta.oracleText || '').toLowerCase();
    const qty = rc.quantity || 1;
    const matchedThemes: string[] = [];

    for (const activeTheme of profile.primaryThemes) {
      const def = THEME_PATTERNS.find((tp) => tp.theme === activeTheme);
      if (def && def.match(typeLower, oracleLower, profile.dominantTribe)) {
        matchedThemes.push(def.label);
        const bucket = themeBuckets.get(activeTheme);
        if (bucket) {
          bucket.count += qty;
          bucket.cards.push({ name: rc.name, meta, qty });
        }
      }
    }

    const isCoreUtility = Boolean(
      meta.isRamp || meta.isDraw || meta.isRemoval || meta.isBoardWipe || meta.isProtection
    );
    if (matchedThemes.length > 0 || isCoreUtility) {
      alignedNonLandQty += qty;
    }

    const key = normalizeDeckCardKey(rc.name);
    if (matchedThemes.length > 0 && !flaggedKeySet.has(key)) {
      let score = matchedThemes.length * 10;
      if (meta.isDraw) score += 4;
      if (meta.isRamp) score += 3;
      if (meta.isRemoval || meta.isProtection) score += 3;
      if (meta.cmc <= 4) score += 2;
      const roleNotes: string[] = [];
      if (meta.isDraw) roleNotes.push('card advantage');
      if (meta.isRamp) roleNotes.push('mana acceleration');
      if (meta.isRemoval) roleNotes.push('interaction');
      if (meta.isProtection) roleNotes.push('board protection');

      synergyScoredCards.push({
        cardName: rc.name,
        cardMeta: meta,
        matchedThemes,
        reason:
          roleNotes.length > 0
            ? `Feeds ${matchedThemes.join(' + ')} while supplying ${roleNotes.join(' & ')}.`
            : `Core ${matchedThemes.join(' + ')} engine piece at MV ${meta.cmc}.`,
        score,
      });
    }
  }

  synergyScoredCards.sort((a, b) => b.score - a.score);
  const strongestSynergies: StrongSynergyCard[] = synergyScoredCards
    .slice(0, 6)
    .map(({ cardName, cardMeta, matchedThemes, reason }) => ({
      cardName,
      cardMeta,
      matchedThemes,
      reason,
    }));

  const themeBreakdown: ThemeBreakdownItem[] = Array.from(themeBuckets.entries())
    .map(([theme, data]) => ({
      theme,
      label: data.label,
      cardCount: data.count,
      sharePct: Math.min(100, Math.round((data.count / nonLandTotal) * 100)),
      topCards: data.cards.slice(0, 4).map((c) => ({ name: c.name, meta: c.meta })),
    }))
    .sort((a, b) => b.cardCount - a.cardCount);

  // Role Balance Summary (100-card Commander/Brawl vs 60-card Constructed)
  const is100Card = (metrics?.targetDeckSize ?? 100) >= 85;
  let rampCount = metrics?.currentRamp ?? 0;
  let drawCount = metrics?.currentDraw ?? 0;
  let removalCount = metrics?.currentRemoval ?? 0;
  let wipeCount = metrics?.currentBoardWipes ?? 0;
  let protectionCount = 0;

  for (const rc of scannable) {
    if (rc.card?.isProtection) protectionCount += rc.quantity || 1;
  }

  const makeRole = (
    role: string,
    count: number,
    targetMin: number,
    targetMax: number
  ): AuditRoleSummaryItem => ({
    role,
    count,
    targetMin,
    targetMax,
    status: count < targetMin ? 'Low' : count > targetMax ? 'High' : 'On Target',
  });

  const roleSummary: AuditRoleSummaryItem[] = [
    makeRole('Ramp', rampCount, is100Card ? 9 : 4, is100Card ? 14 : 10),
    makeRole('Card Draw', drawCount, is100Card ? 9 : 6, is100Card ? 14 : 12),
    makeRole('Removal', removalCount, is100Card ? 7 : 6, is100Card ? 12 : 12),
    makeRole('Board Wipes', wipeCount, is100Card ? 2 : 0, is100Card ? 5 : 4),
    makeRole('Protection', protectionCount, is100Card ? 3 : 2, is100Card ? 8 : 6),
  ];

  // Quantitative Color & Synergy Scores
  const ciCount = flagged.filter((f) => f.issueCategory === 'color-identity').length;
  const offManaCritical = flagged.filter(
    (f) => f.issueCategory === 'off-color-mana' && f.severity === 'critical'
  ).length;
  const offManaWarn = flagged.filter(
    (f) => f.issueCategory === 'off-color-mana' && f.severity === 'warning'
  ).length;
  const colorShortfallSum = colorAuditRows.reduce(
    (sum, r) => sum + Math.max(0, r.recommendedSources - r.sources),
    0
  );

  const colorHealth = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 - ciCount * 24 - offManaCritical * 20 - offManaWarn * 7 - colorShortfallSum * 3
      )
    )
  );

  const antiCount = flagged.filter((f) => f.issueCategory === 'anti-synergy').length;
  const offStratCount = flagged.filter((f) => f.issueCategory === 'off-strategy').length;
  const baseAlignmentPct = Math.round((alignedNonLandQty / nonLandTotal) * 100);
  const lowRoleCount = roleSummary.filter((r) => r.status === 'Low' && r.targetMin > 0).length;
  const synergyCohesion = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        Math.min(98, 42 + baseAlignmentPct * 0.62) -
          antiCount * 12 -
          offStratCount * 4 -
          lowRoleCount * 3
      )
    )
  );

  const overallScore = Math.round(colorHealth * 0.45 + synergyCohesion * 0.55);
  const grade: 'A' | 'B' | 'C' | 'D' =
    overallScore >= 88 && ciCount === 0 && offManaCritical === 0
      ? 'A'
      : overallScore >= 74 && ciCount === 0
      ? 'B'
      : overallScore >= 58
      ? 'C'
      : 'D';

  return {
    detectedStrategy: {
      archetype: analysis.archetype,
      primaryThemes: profile.primaryThemes,
      identityColors: profile.identityColors,
      identityLabel: profile.identityLabel,
      dominantTribe: profile.dominantTribe,
    },
    scores: {
      colorHealth,
      synergyCohesion,
      overallScore,
      grade,
    },
    colorAuditRows,
    themeBreakdown,
    roleSummary,
    strongestSynergies,
    totalCardsScanned: scannable.length,
    flaggedCards: flagged,
    counts: {
      total: flagged.length,
      colorIssues: flagged.filter(
        (f) =>
          f.issueCategory === 'color-identity' ||
          f.issueCategory === 'off-color-mana'
      ).length,
      antiSynergy: flagged.filter((f) => f.issueCategory === 'anti-synergy').length,
      offStrategy: flagged.filter((f) => f.issueCategory === 'off-strategy').length,
      critical: flagged.filter((f) => f.severity === 'critical').length,
    },
  };
}
