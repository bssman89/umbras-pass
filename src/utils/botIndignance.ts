import type { BotIndignanceLevel } from '../types/deck.ts';

export interface BotIndignanceOption {
  id: BotIndignanceLevel;
  shortLabel: string;
  label: string;
  description: string;
  textColorClass: string;
  activeSegmentClass: string;
  aiDirective: string;
}

export const BOT_INDIGNANCE_OPTIONS: BotIndignanceOption[] = [
  {
    id: 'forgiving',
    shortLabel: 'Low',
    label: 'Low (Forgiving)',
    description:
      'Plays casually, spreads combat evenly, and rarely holds up removal for your key turn.',
    textColorClass: 'text-zinc-800',
    activeSegmentClass: 'bg-white text-zinc-900 shadow-sm',
    aiDirective:
      'LOW INDIGNANCE (Casual & Forgiving): Play on curve without sandbagging interaction, spread attacks and spot removal across the table fairly (never tunnel-vision the human player), and occasionally make suboptimal relaxed lines.',
  },
  {
    id: 'measured',
    shortLabel: 'Moderate',
    label: 'Moderate (Measured)',
    description:
      'Sequences cleanly, evaluates threats neutrally, and answers obvious bombs fairly.',
    textColorClass: 'text-sky-700',
    activeSegmentClass: 'bg-white text-sky-700 shadow-sm',
    aiDirective:
      'MODERATE INDIGNANCE (Balanced & Measured): Sequence lands and spells cleanly, attack open players based on real board threat rather than grudge, and spend removal on whichever permanent is currently the biggest threat at the table.',
  },
  {
    id: 'ruthless',
    shortLabel: 'High',
    label: 'High (Ruthless)',
    description:
      'Optimal spell sequencing; holds countermagic and removal for your engine pieces and presses tempo.',
    textColorClass: 'text-amber-700',
    activeSegmentClass: 'bg-amber-50 text-amber-800 border border-amber-300 shadow-sm',
    aiDirective:
      'HIGH INDIGNANCE (Cutthroat & Tight Play): Pilot optimally—hold up instant-speed counters/removal specifically for the human player’s ramp, commander, or engine pieces, double-spell on key turns, and press every tempo or mana stumble.',
  },
  {
    id: 'vindictive',
    shortLabel: 'Max',
    label: 'Maximum (Vindictive)',
    description:
      'Archenemy hostility—laser-focuses you over other bots, kills ramp/commander on sight, and shows no mercy.',
    textColorClass: 'text-red-700',
    activeSegmentClass: 'bg-red-50 text-red-800 border border-red-300 shadow-sm',
    aiDirective:
      'MAXIMUM INDIGNANCE (Spiteful & Relentless Archenemy Focus): Treat the human player as public enemy #1 at all times. Direct disproportionate combat pressure, countermagic, hand disruption, and targeted removal at the human player (killing their mana rocks/dorks, commander, or key lands/engines on sight) even ahead of other bots, and ruthlessly punish any mana screw or tapped-land turn.',
  },
];

export function getBotIndignanceMeta(
  level?: BotIndignanceLevel
): BotIndignanceOption {
  return (
    BOT_INDIGNANCE_OPTIONS.find((opt) => opt.id === level) ||
    BOT_INDIGNANCE_OPTIONS[1]
  );
}
