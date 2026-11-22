import type { BotIntelligenceLevel } from '../types/deck';

export interface BotIntelligenceMeta {
  id: BotIntelligenceLevel;
  label: string;
  shortLabel: string;
  description: string;
  textColorClass: string;
  /** Scales probability of holding mana & firing reactive counterspells */
  counterChanceMult: number;
  /** Scales probability of fighting back in a stack Counter War */
  counterWarMult: number;
  /** Scales surgical removal / board-wipe firing discipline */
  removalFireMult: number;
  /** Whether the bot proactively holds open mana for interaction on curve */
  holdsInteractionMana: boolean;
  /** Minimum available mana before holding 2 mana open for counters */
  minManaToHold: number;
  /** Maximum counterspells per game for preset decks */
  maxPresetCounters: number;
  /** Chance to make an optimal block when available (novice occasionally misses blocks) */
  blockingAccuracy: number;
}

export const BOT_INTELLIGENCE_OPTIONS: BotIntelligenceMeta[] = [
  {
    id: 'novice',
    label: 'Novice',
    shortLabel: 'Novice',
    description: 'Taps out on curve, rarely holds countermagic, and makes occasional combat mistakes.',
    textColorClass: 'text-emerald-700',
    counterChanceMult: 0.4,
    counterWarMult: 0.3,
    removalFireMult: 0.65,
    holdsInteractionMana: false,
    minManaToHold: 6,
    maxPresetCounters: 1,
    blockingAccuracy: 0.68,
  },
  {
    id: 'tactical',
    label: 'Tactical',
    shortLabel: 'Tactical',
    description: 'Balanced play: curves cleanly, respects key threats, and trades profitably in combat.',
    textColorClass: 'text-sky-700',
    counterChanceMult: 1.0,
    counterWarMult: 1.0,
    removalFireMult: 1.0,
    holdsInteractionMana: true,
    minManaToHold: 4,
    maxPresetCounters: 2,
    blockingAccuracy: 0.92,
  },
  {
    id: 'competitive',
    label: 'Competitive',
    shortLabel: 'Competitive',
    description: 'Holds interaction early, prioritizes Commanders and engines, and fights on the stack.',
    textColorClass: 'text-amber-700',
    counterChanceMult: 1.28,
    counterWarMult: 1.32,
    removalFireMult: 1.22,
    holdsInteractionMana: true,
    minManaToHold: 3,
    maxPresetCounters: 3,
    blockingAccuracy: 0.98,
  },
  {
    id: 'mastermind',
    label: 'Mastermind',
    shortLabel: 'Mastermind',
    description: 'Maximum strategic foresight: surgical threat targeting, tight mana holding, and relentless counter wars.',
    textColorClass: 'text-red-700',
    counterChanceMult: 1.5,
    counterWarMult: 1.55,
    removalFireMult: 1.38,
    holdsInteractionMana: true,
    minManaToHold: 3,
    maxPresetCounters: 4,
    blockingAccuracy: 1.0,
  },
];

export function getBotIntelligenceMeta(
  level?: BotIntelligenceLevel | string | null
): BotIntelligenceMeta {
  const found = BOT_INTELLIGENCE_OPTIONS.find((o) => o.id === level);
  return found || BOT_INTELLIGENCE_OPTIONS[1]; // Tactical default
}
