import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Bot,
  Brain,
  ChevronLeft,
  ChevronRight,
  Flame,
  LayoutGrid,
  MessageSquarePlus,
  Play,
  RotateCcw,
  Shield,
  Sliders,
  Swords,
  X,
} from 'lucide-react';
import { BOT_INDIGNANCE_OPTIONS } from '../utils/botIndignance';

export type TutorialStepId = 'setup' | 'modes' | 'indignance' | 'learning';

interface PlaytestTutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialStep?: TutorialStepId;
  autoLearnEnabled?: boolean;
}

const STEPS: { id: TutorialStepId; number: string; title: string; shortLabel: string }[] = [
  { id: 'setup', number: '01', title: 'Setting Up a Match', shortLabel: 'Match Setup' },
  { id: 'modes', number: '02', title: 'Two Ways to Playtest', shortLabel: 'Play Modes' },
  { id: 'indignance', number: '03', title: 'Bot Indignance & Playstyle', shortLabel: 'Indignance' },
  { id: 'learning', number: '04', title: 'How Bots Learn & Adapt', shortLabel: 'Bot Learning' },
];

const IQ_GAINS = [
  { outcome: 'Bot Wins Match', delta: '+8 IQ', detail: 'Reinforces lines and sequencing that worked.' },
  { outcome: 'Close / Drawn Game', delta: '+11 IQ', detail: 'Refines late-game closing decisions.' },
  { outcome: 'Bot Loses Match', delta: '+13 IQ', detail: 'Logs which threats beat it and adjusts priorities.' },
  { outcome: 'Bot Eliminated', delta: '+15 IQ', detail: 'Strongest lesson: saves answers for lethal threats.' },
  { outcome: 'Your Coaching Note', delta: '+10 to +15 IQ', detail: 'Directly adds your custom rule to its memory.' },
];

export const PlaytestTutorialModal: React.FC<PlaytestTutorialModalProps> = ({
  isOpen,
  onClose,
  initialStep = 'setup',
  autoLearnEnabled = true,
}) => {
  const [activeStep, setActiveStep] = useState<TutorialStepId>(initialStep);
  const [adaptationView, setAdaptationView] = useState<'fresh' | 'adapted'>('fresh');

  useEffect(() => {
    if (isOpen) {
      setActiveStep(initialStep);
    }
  }, [isOpen, initialStep]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentIdx = STEPS.findIndex((s) => s.id === activeStep);
  const currentStepMeta = STEPS[currentIdx] || STEPS[0];
  const isFirst = currentIdx <= 0;
  const isLast = currentIdx >= STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="playtest-tutorial-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-sky-700">
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
              <span>Optional Playtest Guide</span>
              <span className="text-zinc-300" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-zinc-500">
                Step {currentIdx + 1} of {STEPS.length}
              </span>
            </div>
            <h2
              id="playtest-tutorial-title"
              className="font-display text-lg font-bold text-zinc-900"
            >
              How the Bot Playtest Simulator &amp; Bot Learning Work
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close playtest guide"
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step Navigation Tabs */}
        <div
          className="grid grid-cols-2 border-b border-zinc-200 bg-zinc-50 sm:grid-cols-4"
          role="tablist"
          aria-label="Tutorial topics"
        >
          {STEPS.map((step) => {
            const selected = step.id === activeStep;
            return (
              <button
                key={step.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveStep(step.id)}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-left text-xs font-semibold transition-colors cursor-pointer ${
                  selected
                    ? 'border-sky-700 bg-white text-zinc-900'
                    : 'border-transparent text-zinc-600 hover:bg-zinc-100/80 hover:text-zinc-900'
                }`}
              >
                <span
                  className={`font-mono tabular-nums text-[11px] ${
                    selected ? 'text-sky-700' : 'text-zinc-400'
                  }`}
                >
                  {step.number}
                </span>
                <span className="truncate">{step.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Step Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-sm text-zinc-700">
          <div className="space-y-1">
            <h3 className="font-display text-base font-bold text-zinc-900">
              {currentStepMeta.title}
            </h3>
            {activeStep === 'setup' && (
              <p className="text-zinc-600">
                Before starting a game, pick your table size, which version of your deck to test, and what decks the bots should pilot.
              </p>
            )}
            {activeStep === 'modes' && (
              <p className="text-zinc-600">
                You can either let the simulator run a fast full-game match for analytics, or sit at the virtual table and play every turn yourself.
              </p>
            )}
            {activeStep === 'indignance' && (
              <p className="text-zinc-600">
                Bot Indignance controls how aggressively a bot targets you, holds up removal, and punishes slow starts.
              </p>
            )}
            {activeStep === 'learning' && (
              <p className="text-zinc-600">
                Bots remember previous matches against your deck—tracking your threats, adapting their strategy, and taking direct coaching from you.
              </p>
            )}
          </div>

          {/* STEP 1: MATCH SETUP */}
          {activeStep === 'setup' && (
            <div className="space-y-4">
              <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
                <div className="flex items-start gap-3.5 p-4">
                  <Sliders className="mt-0.5 h-4 w-4 text-sky-700 shrink-0" />
                  <div className="space-y-1">
                    <div className="font-semibold text-zinc-900">1. Choose Table Size</div>
                    <p className="text-xs leading-relaxed text-zinc-600">
                      Pick <span className="font-semibold text-zinc-800">1v1 (2 Players)</span> for head-to-head testing,{' '}
                      <span className="font-semibold text-zinc-800">1v2 (3 Players)</span>, or{' '}
                      <span className="font-semibold text-zinc-800">1v3 (4-Player Pod)</span> for full multiplayer Commander politics and shared combat damage.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3.5 p-4">
                  <RotateCcw className="mt-0.5 h-4 w-4 text-sky-700 shrink-0" />
                  <div className="space-y-1">
                    <div className="font-semibold text-zinc-900">2. Pick Your Deck Version (A/B Test Upgrades)</div>
                    <p className="text-xs leading-relaxed text-zinc-600">
                      Switch instantly between <span className="font-semibold text-zinc-800">Original Upload</span>,{' '}
                      <span className="font-semibold text-zinc-800">Mana Optimization</span> (only your selected land swaps), and{' '}
                      <span className="font-semibold text-zinc-800">All Analyzer Fixes</span>. You can also click{' '}
                      <span className="font-semibold text-zinc-800">Edit List</span> to test quick card swaps without changing your original upload.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3.5 p-4">
                  <Bot className="mt-0.5 h-4 w-4 text-sky-700 shrink-0" />
                  <div className="space-y-1">
                    <div className="font-semibold text-zinc-900">3. Configure Opponent Bots</div>
                    <p className="text-xs leading-relaxed text-zinc-600">
                      Assign each bot a built-in archetype (Aggro, Control, Midrange, Ramp, Combo, etc.), paste any real{' '}
                      <span className="font-semibold text-zinc-800">Custom Decklist</span> for a bot to pilot, or click{' '}
                      <span className="font-semibold text-zinc-800">Mirror Your Deck</span> to test your list against itself.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-3 text-xs text-sky-950">
                <span className="font-semibold">Tip:</span> Each bot keeps its own separate memory for each archetype or custom decklist it pilots—so changing a bot&apos;s decklist starts a fresh matchup profile for that list without erasing its old memory.
              </div>
            </div>
          )}

          {/* STEP 2: TWO WAYS TO PLAYTEST */}
          {activeStep === 'modes' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col justify-between rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-zinc-900">
                      <Play className="h-4 w-4 text-sky-700 shrink-0" />
                      <span>Play Bot Match (Simulated)</span>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-600">
                      Simulates a complete multi-round match automatically using real shuffled decks, London mulligans, mana curves, combat, and alternate win conditions.
                    </p>
                    <ul className="space-y-1.5 pt-1 text-xs text-zinc-700">
                      <li className="flex items-start gap-2">
                        <span className="mt-1.5 h-1 w-1 rounded-full bg-sky-700 shrink-0" />
                        <span>Tracks Life, Commander Damage (<span className="font-mono tabular-nums">21</span>), Poison (<span className="font-mono tabular-nums">10</span>), and Mill.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-1.5 h-1 w-1 rounded-full bg-sky-700 shrink-0" />
                        <span>Produces a round-by-round play log, mana-stumble correlation, and deck tuning suggestions.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-1.5 h-1 w-1 rounded-full bg-sky-700 shrink-0" />
                        <span>Triggers automatic post-match Bot Learning &amp; IQ updates (when Auto-Learn is on).</span>
                      </li>
                    </ul>
                  </div>
                  <div className="border-t border-zinc-100 pt-2.5 text-[11px] font-medium text-zinc-500">
                    Best for: Fast stress-testing, spotting mana issues, and training bots over multiple games.
                  </div>
                </div>

                <div className="flex flex-col justify-between rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-zinc-900">
                      <Swords className="h-4 w-4 text-sky-700 shrink-0" />
                      <span>Play Live vs Bots (Tabletop)</span>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-600">
                      Hands you direct control of your deck in an interactive play area while bots take real sequential turns against you.
                    </p>
                    <ul className="space-y-1.5 pt-1 text-xs text-zinc-700">
                      <li className="flex items-start gap-2">
                        <span className="mt-1.5 h-1 w-1 rounded-full bg-sky-700 shrink-0" />
                        <span>Mulligan your opening 7, play lands, tap mana, cast spells, and move cards across zones.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-1.5 h-1 w-1 rounded-full bg-sky-700 shrink-0" />
                        <span>Declare attackers, assign blockers, or toggle Solo Goldfish mode to practice opening turns alone.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-1.5 h-1 w-1 rounded-full bg-sky-700 shrink-0" />
                        <span>Click any card to inspect its oracle text, mana cost, and interactions mid-game.</span>
                      </li>
                    </ul>
                  </div>
                  <div className="border-t border-zinc-100 pt-2.5 text-[11px] font-medium text-zinc-500">
                    Best for: Feeling how your opening hands curve out and practicing real combat decisions.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-700">
                <LayoutGrid className="mt-0.5 h-4 w-4 text-sky-700 shrink-0" />
                <div>
                  <span className="font-semibold text-zinc-900">Visual Board Replay:</span> After running a simulated match, click{' '}
                  <span className="font-semibold text-zinc-900">Visual Board Replay</span> to step through every round on the battlefield table and inspect what each player had in play.
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: BOT INDIGNANCE */}
          {activeStep === 'indignance' && (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Level</th>
                      <th className="px-4 py-2.5 font-semibold">How the Bot Plays</th>
                      <th className="px-4 py-2.5 font-semibold">Threat Targeting</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {BOT_INDIGNANCE_OPTIONS.map((opt) => (
                      <tr key={opt.id} className="align-top">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className={`font-semibold ${opt.textColorClass}`}>
                            {opt.shortLabel}
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {opt.label.replace(/^[^(]*\(/, '').replace(/\)$/, '')}
                          </div>
                        </td>
                        <td className="px-4 py-3 leading-relaxed text-zinc-700">
                          {opt.description}
                        </td>
                        <td className="px-4 py-3 text-zinc-600">
                          {opt.id === 'forgiving' && 'Spreads combat evenly across the pod; rarely holds up counters.'}
                          {opt.id === 'measured' && 'Targets the current board leader with balanced interaction.'}
                          {opt.id === 'ruthless' && 'Saves instant removal & counters for your commander, ramp, and engines.'}
                          {opt.id === 'vindictive' && 'Treats you as the Archenemy—prioritizes you ahead of rival bots.'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-700">
                <Flame className="mt-0.5 h-4 w-4 text-amber-600 shrink-0" />
                <div>
                  <span className="font-semibold text-zinc-900">Mix &amp; match per seat:</span> You can set different Indignance levels for each opponent in a 3- or 4-player pod (for example, one Forgiving ramp bot and one Ruthless control bot), or use{' '}
                  <span className="font-semibold text-zinc-900">Set all bots</span> to update the whole table at once.
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: HOW BOTS LEARN & ADAPT */}
          {activeStep === 'learning' && (
            <div className="space-y-5">
              {/* 4-Stage Learning Loop */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-zinc-900">
                  The Post-Match Learning Cycle
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-sky-700 font-semibold">
                      <span>01</span>
                      <ArrowRight className="h-3 w-3 text-zinc-400 hidden sm:block" />
                    </div>
                    <div className="text-xs font-semibold text-zinc-900">Review Outcome</div>
                    <p className="text-[11px] leading-relaxed text-zinc-600">
                      Logs who won, who dealt the most damage to the bot (you or rival bots), and how it lost.
                    </p>
                  </div>

                  <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-sky-700 font-semibold">
                      <span>02</span>
                      <ArrowRight className="h-3 w-3 text-zinc-400 hidden sm:block" />
                    </div>
                    <div className="text-xs font-semibold text-zinc-900">Save Threats</div>
                    <p className="text-[11px] leading-relaxed text-zinc-600">
                      Remembers your Commander, high-impact spells, and any mana stumbles or openings it spotted.
                    </p>
                  </div>

                  <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-sky-700 font-semibold">
                      <span>03</span>
                      <ArrowRight className="h-3 w-3 text-zinc-400 hidden sm:block" />
                    </div>
                    <div className="text-xs font-semibold text-zinc-900">Raise Bot IQ</div>
                    <p className="text-[11px] leading-relaxed text-zinc-600">
                      Adds IQ points and writes concrete tactical rules into the bot&apos;s saved Brain.
                    </p>
                  </div>

                  <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 space-y-1">
                    <div className="text-[11px] font-mono tabular-nums text-sky-700 font-semibold">
                      04
                    </div>
                    <div className="text-xs font-semibold text-sky-950">Adapt Next Game</div>
                    <p className="text-[11px] leading-relaxed text-sky-900/80">
                      Before the next match begins, the bot reads its memory briefing and adjusts its game plan.
                    </p>
                  </div>
                </div>
              </div>

              {/* Interactive Before vs After Adaptation Preview */}
              <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900">
                    <Brain className="h-4 w-4 text-sky-700 shrink-0" />
                    <span>See How a Bot Changes After Multiple Matches</span>
                  </div>
                  <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setAdaptationView('fresh')}
                      className={`rounded-md px-2.5 py-1 font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        adaptationView === 'fresh'
                          ? 'bg-white text-zinc-900 shadow-sm'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      Game 1 · IQ 100
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdaptationView('adapted')}
                      className={`rounded-md px-2.5 py-1 font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        adaptationView === 'adapted'
                          ? 'bg-white text-sky-900 shadow-sm'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      Game 4 · IQ 146
                    </button>
                  </div>
                </div>

                {adaptationView === 'fresh' ? (
                  <div className="grid grid-cols-1 gap-3 border-t border-zinc-100 pt-3 text-xs sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="font-semibold text-zinc-900">Opening Play &amp; Removal</div>
                      <p className="leading-relaxed text-zinc-600">
                        Plays generically based on its archetype. Spends removal on the first medium creature it sees without knowing your deck&apos;s key combo or Commander synergy.
                      </p>
                    </div>
                    <div className="space-y-1">
                      <div className="font-semibold text-zinc-900">Memory Profile</div>
                      <p className="font-mono tabular-nums text-[11px] text-zinc-500">
                        0 games · 0 known threats · 0 tactical directives
                      </p>
                      <p className="leading-relaxed text-zinc-600">
                        No matchup history yet—evaluates the board purely turn-by-turn.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 border-t border-zinc-100 pt-3 text-xs sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="font-semibold text-sky-900">Adapted Play &amp; Removal</div>
                      <p className="leading-relaxed text-zinc-700">
                        Holds instant-speed answers specifically for your Commander and engine pieces it lost to earlier, pressures your life total if it saw tapped-land stumbles, and pivots focus in 4-player pods.
                      </p>
                    </div>
                    <div className="space-y-1">
                      <div className="font-semibold text-sky-900">Memory Profile</div>
                      <p className="font-mono tabular-nums text-[11px] text-sky-700">
                        3 games (1W-2L) · 4 known threats · 3 tactical directives
                      </p>
                      <p className="leading-relaxed text-zinc-700">
                        Receives a pre-match briefing of its past defeats, observed weaknesses, and any coaching rules you saved.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Bot IQ Gain Table */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-900">
                    How Bot IQ Grows (Starts at <span className="font-mono tabular-nums">100</span> · Max <span className="font-mono tabular-nums">2000</span>)
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    Bots learn fastest when they lose
                  </span>
                </div>
                <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <tbody className="divide-y divide-zinc-100">
                      {IQ_GAINS.map((row) => (
                        <tr key={row.outcome}>
                          <td className="px-3.5 py-2 font-medium text-zinc-900 whitespace-nowrap">
                            {row.outcome}
                          </td>
                          <td className="px-3.5 py-2 font-mono tabular-nums font-semibold text-sky-700 whitespace-nowrap">
                            {row.delta}
                          </td>
                          <td className="px-3.5 py-2 text-zinc-600">{row.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* User Coaching & Memory Controls */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3.5 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900">
                    <MessageSquarePlus className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                    <span>Direct Coaching</span>
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-600">
                    After any match, rate a bot (<span className="font-medium text-zinc-800">Strong Play</span>,{' '}
                    <span className="font-medium text-zinc-800">Needs Adjustment</span>, or{' '}
                    <span className="font-medium text-zinc-800">Tactical Mistake</span>), click quick coaching tags, or write your own rule—then hit <span className="font-medium text-zinc-800">Save &amp; Rematch</span>.
                  </p>
                </div>

                <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3.5 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900">
                    <Shield className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                    <span>Inspect or Reset Anytime</span>
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-600">
                    Click <span className="font-medium text-zinc-800">Brain</span> on any opponent card to inspect every stored lesson or reset that bot to IQ 100. Auto-Learn is currently{' '}
                    <span className="font-semibold text-zinc-900">
                      {autoLearnEnabled ? 'On' : 'Off (Manual Coaching Only)'}
                    </span>{' '}
                    and can be toggled in AI Model Settings.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-3.5">
          <button
            type="button"
            onClick={() => {
              if (!isFirst) {
                setActiveStep(STEPS[currentIdx - 1].id);
              }
            }}
            disabled={isFirst}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap shrink-0"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </button>

          <div className="flex items-center gap-2">
            {!isLast ? (
              <button
                type="button"
                onClick={() => setActiveStep(STEPS[currentIdx + 1].id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
              >
                Next: {STEPS[currentIdx + 1].shortLabel}
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
              >
                Got It — Back to Simulator
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
