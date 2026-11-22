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
      'Sequences cleanly, evaluates You and rival bots neutrally, and targets the biggest table threat.',
    textColorClass: 'text-sky-700',
    activeSegmentClass: 'bg-white text-sky-700 shadow-sm',
    aiDirective:
      'MODERATE INDIGNANCE (Balanced & Measured): Sequence lands and spells cleanly, evaluate You and rival bots completely neutrally, spread early attacks across open seats, retaliate against whoever hits you, and spend removal on whichever permanent is currently the biggest threat at the table.',
  },
  {
    id: 'ruthless',
    shortLabel: 'High',
    label: 'High (Ruthless)',
    description:
      'Cutthroat optimal play—targets whoever is the leading table threat (You or rival bots) and closes out openings.',
    textColorClass: 'text-amber-700',
    activeSegmentClass: 'bg-amber-50 text-amber-800 border border-amber-300 shadow-sm',
    aiDirective:
      'HIGH INDIGNANCE (Cutthroat & Optimal Table Play): Pilot ruthlessly to win the pod—hold up instant-speed counters/removal for whichever player (You OR a rival bot) is the current table leader or deploying combo/commander engines, exploit mana stumbles on any seat, and eliminate whichever opponent gives the cleanest path to victory.',
  },
  {
    id: 'vindictive',
    shortLabel: 'Max',
    label: 'Maximum (Vindictive)',
    description:
      'Archenemy hostility—heavily favors targeting you, though it will still stop a rival bot about to win.',
    textColorClass: 'text-red-700',
    activeSegmentClass: 'bg-red-50 text-red-800 border border-red-300 shadow-sm',
    aiDirective:
      'MAXIMUM INDIGNANCE (Archenemy Focus): Treat the human player as primary rival—direct heavier combat pressure, countermagic, and targeted removal at the human player when threat levels are close, while still stopping or finishing off a rival bot that is about to win the pod or aggressively attacked you.',
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
