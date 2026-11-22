import React, { useState } from 'react';
import {
  Crown,
  Minus,
  Plus,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';

export interface TabletopTokenBlueprint {
  name: string;
  kind: 'creature' | 'artifact' | 'enchantment';
  power: number;
  toughness: number;
  quantity: number;
  keywords: string[];
  tokenAbility?: 'treasure' | 'food' | 'clue' | 'blood' | 'none';
}

interface TokenPresetItem {
  label: string;
  sublabel: string;
  blueprint: Omit<TabletopTokenBlueprint, 'quantity'>;
}

const UTILITY_TOKEN_PRESETS: TokenPresetItem[] = [
  {
    label: 'Treasure',
    sublabel: 'Sac: +1 mana',
    blueprint: {
      name: 'Treasure',
      kind: 'artifact',
      power: 0,
      toughness: 0,
      keywords: [],
      tokenAbility: 'treasure',
    },
  },
  {
    label: 'Food',
    sublabel: 'Sac: +3 life',
    blueprint: {
      name: 'Food',
      kind: 'artifact',
      power: 0,
      toughness: 0,
      keywords: [],
      tokenAbility: 'food',
    },
  },
  {
    label: 'Clue',
    sublabel: 'Sac: Draw 1',
    blueprint: {
      name: 'Clue',
      kind: 'artifact',
      power: 0,
      toughness: 0,
      keywords: [],
      tokenAbility: 'clue',
    },
  },
  {
    label: 'Blood',
    sublabel: 'Sac: Draw 1',
    blueprint: {
      name: 'Blood',
      kind: 'artifact',
      power: 0,
      toughness: 0,
      keywords: [],
      tokenAbility: 'blood',
    },
  },
];

const CREATURE_TOKEN_PRESETS: TokenPresetItem[] = [
  {
    label: '1/1 Soldier',
    sublabel: 'Creature',
    blueprint: { name: 'Soldier', kind: 'creature', power: 1, toughness: 1, keywords: [] },
  },
  {
    label: '1/1 Goblin',
    sublabel: 'Creature',
    blueprint: { name: 'Goblin', kind: 'creature', power: 1, toughness: 1, keywords: [] },
  },
  {
    label: '1/1 Elf',
    sublabel: 'Creature',
    blueprint: { name: 'Elf Warrior', kind: 'creature', power: 1, toughness: 1, keywords: [] },
  },
  {
    label: '1/1 Spirit',
    sublabel: 'Flying',
    blueprint: { name: 'Spirit', kind: 'creature', power: 1, toughness: 1, keywords: ['Flying'] },
  },
  {
    label: '2/2 Zombie',
    sublabel: 'Creature',
    blueprint: { name: 'Zombie', kind: 'creature', power: 2, toughness: 2, keywords: [] },
  },
  {
    label: '3/3 Beast',
    sublabel: 'Creature',
    blueprint: { name: 'Beast', kind: 'creature', power: 3, toughness: 3, keywords: [] },
  },
  {
    label: '4/4 Angel',
    sublabel: 'Fly · Vig',
    blueprint: {
      name: 'Angel',
      kind: 'creature',
      power: 4,
      toughness: 4,
      keywords: ['Flying', 'Vigilance'],
    },
  },
  {
    label: '5/5 Dragon',
    sublabel: 'Flying',
    blueprint: { name: 'Dragon', kind: 'creature', power: 5, toughness: 5, keywords: ['Flying'] },
  },
];

const TOKEN_KEYWORD_OPTIONS = [
  'Flying',
  'Haste',
  'Lifelink',
  'Deathtouch',
  'Trample',
  'Vigilance',
  'First Strike',
  'Menace',
  'Reach',
  'Infect',
];

interface TokenCreatorPanelProps {
  onCreateToken: (blueprint: TabletopTokenBlueprint) => void;
  onClose: () => void;
}

export const TokenCreatorPanel: React.FC<TokenCreatorPanelProps> = ({
  onCreateToken,
  onClose,
}) => {
  const [name, setName] = useState('Construct');
  const [kind, setKind] = useState<'creature' | 'artifact' | 'enchantment'>('creature');
  const [power, setPower] = useState(2);
  const [toughness, setToughness] = useState(2);
  const [quantity, setQuantity] = useState(1);
  const [keywords, setKeywords] = useState<string[]>([]);

  const toggleKeyword = (kw: string) => {
    setKeywords((prev) =>
      prev.includes(kw) ? prev.filter((k) => k !== kw) : [...prev, kw]
    );
  };

  const handleSubmitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const safeName = name.trim() || (kind === 'creature' ? 'Token Creature' : 'Token');
    onCreateToken({
      name: safeName,
      kind,
      power: kind === 'creature' ? Math.max(0, power) : 0,
      toughness: kind === 'creature' ? Math.max(1, toughness) : 0,
      quantity: Math.max(1, Math.min(10, quantity)),
      keywords: kind === 'creature' ? keywords : [],
      tokenAbility: 'none',
    });
  };

  return (
    <div className="rounded-xl border border-amber-300/60 bg-[#0A3528] p-3.5 space-y-3 text-white shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-[#1E6E56] pb-2">
        <div className="flex items-center gap-2 text-xs font-bold text-amber-200">
          <Sparkles className="h-3.5 w-3.5 text-amber-300 shrink-0" />
          <span>Create Tokens on Playfield</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close token creator"
          className="rounded border border-[#287D64] bg-[#0F4C3A] p-1 text-emerald-200 hover:text-white cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Quick Utility & Creature Token Presets */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-200/80">
            Quick Presets (adds {quantity}×)
          </span>
          <div className="inline-flex items-center gap-1 font-mono text-[10px] tabular-nums">
            <span className="text-emerald-200/80">Qty:</span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="rounded border border-[#287D64] bg-[#0F4C3A] px-1.5 py-0.5 text-emerald-100 hover:bg-[#17614B] cursor-pointer"
            >
              -
            </button>
            <span className="min-w-[20px] text-center font-bold text-white">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(10, q + 1))}
              className="rounded border border-[#287D64] bg-[#0F4C3A] px-1.5 py-0.5 text-emerald-100 hover:bg-[#17614B] cursor-pointer"
            >
              +
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
          {[...UTILITY_TOKEN_PRESETS, ...CREATURE_TOKEN_PRESETS].map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() =>
                onCreateToken({
                  ...preset.blueprint,
                  quantity,
                })
              }
              className="rounded-lg border border-[#287D64] bg-[#0F4C3A] px-2.5 py-1.5 text-left hover:border-amber-300 hover:bg-[#145D47] transition-colors cursor-pointer"
            >
              <div className="text-[11px] font-bold text-white truncate">{preset.label}</div>
              <div className="text-[9px] font-mono text-emerald-200/80 truncate">
                {preset.sublabel}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Token Builder */}
      <form
        onSubmit={handleSubmitCustom}
        className="border-t border-[#1E6E56] pt-2.5 space-y-2.5"
      >
        <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-200/80">
          Custom Token
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_auto_auto_auto] items-end">
          <div>
            <label className="block text-[10px] text-emerald-200/80 mb-1">Token Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="e.g. Eldrazi Spawn"
              className="w-full rounded-md border border-[#2A8469] bg-[#0F4C3A] px-2.5 py-1.5 text-xs text-white placeholder:text-emerald-300/50 focus:border-sky-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[10px] text-emerald-200/80 mb-1">Type</label>
            <select
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as 'creature' | 'artifact' | 'enchantment')
              }
              className="w-full rounded-md border border-[#2A8469] bg-[#0F4C3A] px-2 py-1.5 text-xs text-white focus:border-sky-400 focus:outline-none cursor-pointer"
            >
              <option value="creature">Creature Token</option>
              <option value="artifact">Artifact Token</option>
              <option value="enchantment">Enchantment Token</option>
            </select>
          </div>

          {kind === 'creature' && (
            <>
              <div>
                <label className="block text-[10px] text-emerald-200/80 mb-1">Power</label>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={power}
                  onChange={(e) => setPower(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                  className="w-16 rounded-md border border-[#2A8469] bg-[#0F4C3A] px-2 py-1.5 text-xs font-mono tabular-nums text-white focus:border-sky-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-emerald-200/80 mb-1">Toughness</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={toughness}
                  onChange={(e) =>
                    setToughness(Math.max(1, Math.min(30, Number(e.target.value) || 1)))
                  }
                  className="w-16 rounded-md border border-[#2A8469] bg-[#0F4C3A] px-2 py-1.5 text-xs font-mono tabular-nums text-white focus:border-sky-400 focus:outline-none"
                />
              </div>
            </>
          )}

          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            Create {quantity > 1 ? `${quantity}×` : ''}
          </button>
        </div>

        {kind === 'creature' && (
          <div className="flex flex-wrap items-center gap-1.5">
            {TOKEN_KEYWORD_OPTIONS.map((kw) => {
              const active = keywords.includes(kw);
              return (
                <button
                  key={kw}
                  type="button"
                  onClick={() => toggleKeyword(kw)}
                  className={`rounded border px-2 py-0.5 text-[10px] font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'border-sky-300 bg-sky-700 text-white'
                      : 'border-[#287D64] bg-[#0F4C3A] text-emerald-200 hover:border-emerald-300'
                  }`}
                >
                  {kw}
                </button>
              );
            })}
          </div>
        )}
      </form>
    </div>
  );
};

interface PermanentCounterEditorProps {
  permanentUid: string;
  permanentName: string;
  isCreature: boolean;
  plusOneCounters: number;
  minusOneCounters: number;
  otherCounters: Record<string, number>;
  onAdjustCounter: (
    uid: string,
    counterKey: '+1/+1' | '-1/-1' | string,
    delta: number
  ) => void;
  onClose: () => void;
}

const QUICK_OTHER_COUNTERS = ['Loyalty', 'Charge', 'Shield', 'Stun', 'Oil', 'Time'];

export const PermanentCounterEditor: React.FC<PermanentCounterEditorProps> = ({
  permanentUid,
  permanentName,
  isCreature,
  plusOneCounters,
  minusOneCounters,
  otherCounters,
  onAdjustCounter,
  onClose,
}) => {
  const [customLabel, setCustomLabel] = useState('');

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = customLabel.trim();
    if (!cleaned) return;
    onAdjustCounter(permanentUid, cleaned, 1);
    setCustomLabel('');
  };

  const activeCustomKeys = Object.keys(otherCounters).filter(
    (k) => (otherCounters[k] || 0) > 0 && !QUICK_OTHER_COUNTERS.includes(k)
  );

  return (
    <div className="rounded-xl border border-sky-300/70 bg-[#0A3528] p-3.5 space-y-3 text-white shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-[#1E6E56] pb-2">
        <div className="min-w-0">
          <div className="text-xs font-bold text-sky-200 truncate">
            Counters on {permanentName}
          </div>
          <div className="text-[10px] text-emerald-200/80">
            {isCreature
              ? '+1/+1 and -1/-1 counters automatically update combat Power/Toughness.'
              : 'Track Loyalty, Charge, Shield, Stun (skips next untap), or custom counters.'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close permanent counter editor"
          className="rounded border border-[#287D64] bg-[#0F4C3A] p-1 text-emerald-200 hover:text-white cursor-pointer shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* +1/+1 */}
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/50 bg-emerald-950/60 px-2.5 py-1 font-mono text-xs tabular-nums">
          <span className="font-bold text-emerald-200">+1/+1</span>
          <button
            type="button"
            disabled={plusOneCounters <= 0}
            onClick={() => onAdjustCounter(permanentUid, '+1/+1', -1)}
            className="rounded border border-emerald-400/40 bg-[#0F4C3A] p-0.5 text-emerald-100 hover:bg-[#17614B] disabled:opacity-35 cursor-pointer"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="min-w-[20px] text-center font-bold text-white">
            {plusOneCounters}
          </span>
          <button
            type="button"
            onClick={() => onAdjustCounter(permanentUid, '+1/+1', 1)}
            className="rounded border border-emerald-400/40 bg-[#0F4C3A] p-0.5 text-emerald-100 hover:bg-[#17614B] cursor-pointer"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>

        {/* -1/-1 */}
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/50 bg-red-950/50 px-2.5 py-1 font-mono text-xs tabular-nums">
          <span className="font-bold text-red-200">-1/-1</span>
          <button
            type="button"
            disabled={minusOneCounters <= 0}
            onClick={() => onAdjustCounter(permanentUid, '-1/-1', -1)}
            className="rounded border border-red-400/40 bg-[#2C1216] p-0.5 text-red-100 hover:bg-red-900 disabled:opacity-35 cursor-pointer"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="min-w-[20px] text-center font-bold text-white">
            {minusOneCounters}
          </span>
          <button
            type="button"
            onClick={() => onAdjustCounter(permanentUid, '-1/-1', 1)}
            className="rounded border border-red-400/40 bg-[#2C1216] p-0.5 text-red-100 hover:bg-red-900 cursor-pointer"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>

        {/* Other standard MTG counters */}
        {[...QUICK_OTHER_COUNTERS, ...activeCustomKeys].map((label) => {
          const count = otherCounters[label] || 0;
          return (
            <div
              key={label}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px] tabular-nums ${
                count > 0
                  ? 'border-amber-300/60 bg-amber-950/50 text-amber-100'
                  : 'border-[#287D64] bg-[#0F4C3A] text-emerald-200'
              }`}
            >
              <span className="font-semibold">{label}</span>
              <button
                type="button"
                disabled={count <= 0}
                onClick={() => onAdjustCounter(permanentUid, label, -1)}
                className="rounded border border-white/15 bg-black/20 p-0.5 hover:bg-black/40 disabled:opacity-30 cursor-pointer"
              >
                <Minus className="h-2.5 w-2.5" />
              </button>
              <span className="min-w-[16px] text-center font-bold text-white">{count}</span>
              <button
                type="button"
                onClick={() => onAdjustCounter(permanentUid, label, 1)}
                className="rounded border border-white/15 bg-black/20 p-0.5 hover:bg-black/40 cursor-pointer"
              >
                <Plus className="h-2.5 w-2.5" />
              </button>
            </div>
          );
        })}
      </div>

      <form onSubmit={handleAddCustom} className="flex items-center gap-2">
        <input
          type="text"
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
          maxLength={24}
          placeholder="Custom counter (e.g. Lore, Quest, Divinity)..."
          className="flex-1 rounded-md border border-[#2A8469] bg-[#0F4C3A] px-2.5 py-1 text-xs text-white placeholder:text-emerald-300/50 focus:border-sky-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!customLabel.trim()}
          className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="h-3 w-3" />
          Add Counter
        </button>
      </form>
    </div>
  );
};

interface PlayerCountersPanelProps {
  playerCounters: Record<string, number>;
  isMonarch: boolean;
  onAdjustPlayerCounter: (label: string, delta: number) => void;
  onToggleMonarch: () => void;
  onClose: () => void;
}

const STANDARD_PLAYER_COUNTERS = ['Energy', 'Experience', 'Storm', 'Rad', 'Tickets'];

export const PlayerCountersPanel: React.FC<PlayerCountersPanelProps> = ({
  playerCounters,
  isMonarch,
  onAdjustPlayerCounter,
  onToggleMonarch,
  onClose,
}) => {
  const [customName, setCustomName] = useState('');

  const extraKeys = Object.keys(playerCounters).filter(
    (k) => (playerCounters[k] || 0) > 0 && !STANDARD_PLAYER_COUNTERS.includes(k)
  );

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = customName.trim();
    if (!cleaned) return;
    onAdjustPlayerCounter(cleaned, 1);
    setCustomName('');
  };

  return (
    <div className="rounded-xl border border-sky-300/60 bg-[#0A3528] p-3.5 space-y-2.5 text-white shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-[#1E6E56] pb-2">
        <div className="flex items-center gap-2 text-xs font-bold text-sky-200">
          <Zap className="h-3.5 w-3.5 text-amber-300 shrink-0" />
          <span>Player Counters &amp; Designations</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close player counters"
          className="rounded border border-[#287D64] bg-[#0F4C3A] p-1 text-emerald-200 hover:text-white cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggleMonarch}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer transition-colors ${
            isMonarch
              ? 'border-amber-300 bg-amber-500 text-zinc-950'
              : 'border-[#287D64] bg-[#0F4C3A] text-emerald-100 hover:border-amber-300'
          }`}
        >
          <Crown className="h-3.5 w-3.5" />
          {isMonarch ? 'You are The Monarch' : 'Become Monarch'}
        </button>

        {[...STANDARD_PLAYER_COUNTERS, ...extraKeys].map((label) => {
          const val = playerCounters[label] || 0;
          return (
            <div
              key={label}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] tabular-nums ${
                val > 0
                  ? 'border-sky-300/60 bg-sky-950/60 text-sky-100'
                  : 'border-[#287D64] bg-[#0F4C3A] text-emerald-200'
              }`}
            >
              <span className="font-semibold">{label}</span>
              <button
                type="button"
                disabled={val <= 0}
                onClick={() => onAdjustPlayerCounter(label, -1)}
                className="rounded border border-white/15 bg-black/20 p-0.5 hover:bg-black/40 disabled:opacity-30 cursor-pointer"
              >
                <Minus className="h-2.5 w-2.5" />
              </button>
              <span className="min-w-[16px] text-center font-bold text-white">{val}</span>
              <button
                type="button"
                onClick={() => onAdjustPlayerCounter(label, 1)}
                className="rounded border border-white/15 bg-black/20 p-0.5 hover:bg-black/40 cursor-pointer"
              >
                <Plus className="h-2.5 w-2.5" />
              </button>
            </div>
          );
        })}
      </div>

      <form onSubmit={handleAdd} className="flex items-center gap-2">
        <input
          type="text"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          maxLength={24}
          placeholder="Custom player counter (e.g. Floating, Emblem, Ring)..."
          className="flex-1 rounded-md border border-[#2A8469] bg-[#0F4C3A] px-2.5 py-1 text-xs text-white placeholder:text-emerald-300/50 focus:border-sky-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!customName.trim()}
          className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </form>
    </div>
  );
};
