import React, { useRef, useState } from 'react';
import {
  Check,
  Image as ImageIcon,
  Layers,
  Palette,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  createDefaultTabletopPlaymatPreferences,
  getTabletopThemePreset,
  isValidPlaymatImageUrl,
  PLAYMAT_ARTWORK_PRESETS,
  resolveSeatPlaymatSurface,
  resolveTabletopSurface,
  saveTabletopPlaymatPreferences,
  TABLETOP_THEME_PRESETS,
  type PlaymatArtworkPresetId,
  type PlaymatZoneBorderStyle,
  type ResolvedPlaymatSurface,
  type SeatPlaymatConfig,
  type SeatPlaymatKey,
  type TabletopPlaymatPreferences,
  type TabletopSurfaceConfig,
  type TabletopThemeId,
} from '../utils/tabletopPlaymatThemes';

const SWATCH_BG_BY_THEME: Record<TabletopThemeId, string> = {
  'emerald-felt': 'bg-[#0F4C3A] border-[#1E6E56]',
  'arcane-midnight': 'bg-[#071324] border-[#1E436E]',
  'obsidian-dragon': 'bg-[#181014] border-[#7A283B]',
  'simic-biolum': 'bg-[#06262E] border-[#197485]',
  'azorius-celestial': 'bg-[#101C30] border-[#3B5F91]',
  'golgari-undercity': 'bg-[#131D14] border-[#3E5E42]',
  'volcanic-forge': 'bg-[#1C120D] border-[#80411E]',
  'tournament-slate': 'bg-[#12151A] border-[#384152]',
};

function getDimmerTailwindClass(opacity: number): string {
  if (opacity <= 0.32) return 'bg-black/25';
  if (opacity <= 0.45) return 'bg-black/40';
  if (opacity <= 0.58) return 'bg-black/55';
  if (opacity <= 0.72) return 'bg-black/65';
  if (opacity <= 0.82) return 'bg-black/75';
  return 'bg-black/85';
}

export function PlaymatSurfaceBackdrop({
  surface,
  variant = 'seat',
}: {
  surface: ResolvedPlaymatSurface;
  variant?: 'table' | 'seat';
}) {
  if (!surface.backgroundImageUrl && surface.zoneBorderStyle === 'classic') {
    return null;
  }

  const dimmerClass = getDimmerTailwindClass(surface.dimmerOpacity);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none select-none absolute inset-0 overflow-hidden rounded-[inherit] z-0"
    >
      {surface.backgroundImageUrl && (
        <>
          <img
            src={surface.backgroundImageUrl}
            alt=""
            className={`h-full w-full object-cover ${
              variant === 'table' ? 'opacity-85' : 'opacity-90'
            }`}
          />
          <div className={`absolute inset-0 ${dimmerClass}`} />
        </>
      )}
      {surface.zoneBorderStyle === 'glow' && (
        <div className="absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-sky-300/35 shadow-[inset_0_0_24px_rgba(56,189,248,0.14)]" />
      )}
    </div>
  );
}

interface TabletopPlaymatCustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: TabletopPlaymatPreferences;
  onChangePreferences: (next: TabletopPlaymatPreferences) => void;
  userScope?: string;
  /** Optional seat labels from active match (e.g., ['You', 'Atraxa Bot', 'Krenko Bot', 'Tatyova Bot']) */
  seatLabels?: [string?, string?, string?, string?];
  /** Optional multiplayer sync info */
  multiplayerContext?: {
    isHost: boolean;
    callerSeatIndex: number | null;
    roomCode: string;
    onSyncToRoom?: (payload: {
      seatPlaymatThemeId?: TabletopThemeId;
      seatPlaymatArtworkPresetId?: PlaymatArtworkPresetId;
      seatPlaymatCustomImageUrl?: string;
      tabletopThemeId?: TabletopThemeId;
      tabletopArtworkPresetId?: PlaymatArtworkPresetId;
      tabletopCustomImageUrl?: string;
    }) => void;
  };
}

type CustomizerTab = 'tabletop' | 'your-playmat' | 'per-seat';

export function TabletopPlaymatCustomizerModal({
  isOpen,
  onClose,
  preferences,
  onChangePreferences,
  userScope,
  seatLabels,
  multiplayerContext,
}: TabletopPlaymatCustomizerModalProps) {
  const [activeTab, setActiveTab] = useState<CustomizerTab>('tabletop');
  const [selectedSeatKey, setSelectedSeatKey] = useState<SeatPlaymatKey>('seat-1');
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const commitPreferences = (next: TabletopPlaymatPreferences) => {
    saveTabletopPlaymatPreferences(next, userScope);
    onChangePreferences(next);

    if (multiplayerContext?.onSyncToRoom) {
      const callerSeatKey: SeatPlaymatKey =
        typeof multiplayerContext.callerSeatIndex === 'number' &&
        multiplayerContext.callerSeatIndex >= 0 &&
        multiplayerContext.callerSeatIndex <= 3
          ? (`seat-${(multiplayerContext.callerSeatIndex + 1) as 1 | 2 | 3 | 4}` as SeatPlaymatKey)
          : 'seat-1';

      const callerSeatPref = !next.yourPlaymat.useTabletopDefault
        ? next.yourPlaymat
        : !next.seatPlaymats[callerSeatKey].useTabletopDefault
        ? next.seatPlaymats[callerSeatKey]
        : next.tabletop;

      multiplayerContext.onSyncToRoom({
        seatPlaymatThemeId: callerSeatPref.themeId,
        seatPlaymatArtworkPresetId: callerSeatPref.artworkPresetId,
        seatPlaymatCustomImageUrl: callerSeatPref.customImageUrl,
        ...(multiplayerContext.isHost
          ? {
              tabletopThemeId: next.tabletop.themeId,
              tabletopArtworkPresetId: next.tabletop.artworkPresetId,
              tabletopCustomImageUrl: next.tabletop.customImageUrl,
            }
          : {}),
      });
    }
  };

  const getActiveTargetSurface = (): {
    surface: TabletopSurfaceConfig;
    isSeatTarget: boolean;
    useTabletopDefault: boolean;
  } => {
    if (activeTab === 'tabletop') {
      return {
        surface: preferences.tabletop,
        isSeatTarget: false,
        useTabletopDefault: false,
      };
    }
    if (activeTab === 'your-playmat') {
      return {
        surface: preferences.yourPlaymat,
        isSeatTarget: true,
        useTabletopDefault: preferences.yourPlaymat.useTabletopDefault,
      };
    }
    const seatCfg = preferences.seatPlaymats[selectedSeatKey];
    return {
      surface: seatCfg,
      isSeatTarget: true,
      useTabletopDefault: seatCfg.useTabletopDefault,
    };
  };

  const updateActiveSurface = (
    updater: (prev: SeatPlaymatConfig) => SeatPlaymatConfig
  ) => {
    setUrlError(null);
    setUploadNotice(null);

    if (activeTab === 'tabletop') {
      const updated = updater({
        ...preferences.tabletop,
        useTabletopDefault: false,
      });
      const { useTabletopDefault: _unused, ...cleanTabletop } = updated;
      commitPreferences({
        ...preferences,
        tabletop: cleanTabletop,
      });
      return;
    }

    if (activeTab === 'your-playmat') {
      const updated = updater({
        ...preferences.yourPlaymat,
        useTabletopDefault: false,
      });
      commitPreferences({
        ...preferences,
        yourPlaymat: updated,
      });
      return;
    }

    const currentSeat = preferences.seatPlaymats[selectedSeatKey];
    const updated = updater({
      ...currentSeat,
      useTabletopDefault: false,
    });
    commitPreferences({
      ...preferences,
      seatPlaymats: {
        ...preferences.seatPlaymats,
        [selectedSeatKey]: updated,
      },
    });
  };

  const handleToggleUseTabletopDefault = (useDefault: boolean) => {
    if (activeTab === 'your-playmat') {
      commitPreferences({
        ...preferences,
        yourPlaymat: {
          ...preferences.yourPlaymat,
          useTabletopDefault: useDefault,
        },
      });
    } else if (activeTab === 'per-seat') {
      commitPreferences({
        ...preferences,
        seatPlaymats: {
          ...preferences.seatPlaymats,
          [selectedSeatKey]: {
            ...preferences.seatPlaymats[selectedSeatKey],
            useTabletopDefault: useDefault,
          },
        },
      });
    }
  };

  const handleApplyCustomUrl = () => {
    const trimmed = customUrlInput.trim();
    if (!trimmed) {
      updateActiveSurface((prev) => ({ ...prev, customImageUrl: '' }));
      return;
    }
    if (!isValidPlaymatImageUrl(trimmed)) {
      setUrlError('Enter a valid http://, https://, or data:image/ URL.');
      return;
    }
    updateActiveSurface((prev) => ({
      ...prev,
      customImageUrl: trimmed,
    }));
    setCustomUrlInput('');
    setUploadNotice('Custom playmat artwork URL applied.');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUrlError('Please select a PNG, JPG, WebP, or SVG image file.');
      return;
    }
    if (file.size > 2.5 * 1024 * 1024) {
      setUrlError('Image exceeds 2.5 MB browser storage limit. Use a smaller image or direct URL.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (result && isValidPlaymatImageUrl(result)) {
        updateActiveSurface((prev) => ({
          ...prev,
          customImageUrl: result,
        }));
        setUploadNotice(`Uploaded "${file.name}" as custom playmat artwork.`);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleApplyFourFactionPodPreset = () => {
    commitPreferences({
      ...preferences,
      tabletop: {
        ...preferences.tabletop,
        themeId: 'tournament-slate',
        artworkPresetId: 'none',
      },
      yourPlaymat: {
        ...preferences.yourPlaymat,
        useTabletopDefault: false,
        themeId: 'emerald-felt',
        artworkPresetId: 'mana-sanctum',
      },
      seatPlaymats: {
        'seat-1': {
          ...preferences.seatPlaymats['seat-1'],
          useTabletopDefault: false,
          themeId: 'emerald-felt',
          artworkPresetId: 'mana-sanctum',
        },
        'seat-2': {
          ...preferences.seatPlaymats['seat-2'],
          useTabletopDefault: false,
          themeId: 'arcane-midnight',
          artworkPresetId: 'arcane-compass',
        },
        'seat-3': {
          ...preferences.seatPlaymats['seat-3'],
          useTabletopDefault: false,
          themeId: 'obsidian-dragon',
          artworkPresetId: 'dragon-sigil',
        },
        'seat-4': {
          ...preferences.seatPlaymats['seat-4'],
          useTabletopDefault: false,
          themeId: 'simic-biolum',
          artworkPresetId: 'aether-lattice',
        },
      },
    });
    setUploadNotice('Applied 4-Faction Commander Pod distinct playmats to Seats 1–4.');
  };

  const handleResetAllDefaults = () => {
    const fresh = createDefaultTabletopPlaymatPreferences();
    commitPreferences(fresh);
    setCustomUrlInput('');
    setUrlError(null);
    setUploadNotice('Reset tabletop background and all seat playmats to default.');
  };

  const { surface: activeSurface, isSeatTarget, useTabletopDefault } =
    getActiveTargetSurface();

  const resolvedTabletop = resolveTabletopSurface(preferences);
  const resolvedSeats: [
    ResolvedPlaymatSurface,
    ResolvedPlaymatSurface,
    ResolvedPlaymatSurface,
    ResolvedPlaymatSurface,
  ] = [
    resolveSeatPlaymatSurface(preferences, 1, { isYourSeat: true }),
    resolveSeatPlaymatSurface(preferences, 2),
    resolveSeatPlaymatSurface(preferences, 3),
    resolveSeatPlaymatSurface(preferences, 4),
  ];

  const defaultSeatTitles: [string, string, string, string] = [
    seatLabels?.[0] || 'Seat 1 (You)',
    seatLabels?.[1] || 'Seat 2 (Opponent / Bot 1)',
    seatLabels?.[2] || 'Seat 3 (Opponent / Bot 2)',
    seatLabels?.[3] || 'Seat 4 (Opponent / Bot 3)',
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Custom Tabletop Playmats and Backgrounds"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-5 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-2xl border border-zinc-700 bg-zinc-950 text-zinc-100 shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900/90 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Custom Tabletop Playmats &amp; Backgrounds
              </h2>
              <p className="text-xs text-zinc-400">
                Configure per-tabletop arena backgrounds and per-user / per-seat TCG playmats (Seats 1–4).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApplyFourFactionPodPreset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/45 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 cursor-pointer transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              <span>4-Faction Pod Preset</span>
            </button>

            <button
              type="button"
              onClick={handleResetAllDefaults}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 cursor-pointer transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close playmat customizer"
              className="rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* Live 4-Seat Tabletop Miniature Preview */}
          <div
            className={`relative rounded-xl border-2 p-3.5 space-y-2.5 overflow-hidden transition-colors ${resolvedTabletop.outerClass}`}
          >
            <PlaymatSurfaceBackdrop surface={resolvedTabletop} variant="table" />
            <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  Live Arena Preview
                </span>
                <span className="text-white/40">·</span>
                <span className="font-semibold text-white">
                  Tabletop: {resolvedTabletop.preset.name}
                </span>
              </div>
              {multiplayerContext && (
                <span className="rounded border border-sky-400/40 bg-sky-950/70 px-2 py-0.5 font-mono text-[10px] text-sky-200">
                  Synced with Room {multiplayerContext.roomCode}
                </span>
              )}
            </div>

            <div className="relative z-10 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {resolvedSeats.map((seatSurf, idx) => {
                const seatNum = (idx + 1) as 1 | 2 | 3 | 4;
                const sKey: SeatPlaymatKey = `seat-${seatNum}`;
                const isEditingThisSeat =
                  (activeTab === 'your-playmat' && idx === 0) ||
                  (activeTab === 'per-seat' && selectedSeatKey === sKey);

                return (
                  <button
                    key={sKey}
                    type="button"
                    onClick={() => {
                      if (idx === 0 && activeTab === 'your-playmat') return;
                      setActiveTab('per-seat');
                      setSelectedSeatKey(sKey);
                    }}
                    className={`relative rounded-lg border p-2.5 text-left overflow-hidden transition-all cursor-pointer ${
                      isEditingThisSeat
                        ? `${seatSurf.seatActiveClass} ring-2 ring-amber-300`
                        : seatSurf.seatClass
                    }`}
                  >
                    <PlaymatSurfaceBackdrop surface={seatSurf} variant="seat" />
                    <div className="relative z-10 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-[10px] font-bold text-sky-300">
                          S{seatNum}
                        </span>
                        <span className="font-mono text-[9px] text-white/80">
                          40 HP
                        </span>
                      </div>
                      <div className="truncate text-xs font-bold text-white">
                        {defaultSeatTitles[idx]}
                      </div>
                      <div className="truncate text-[10px] text-white/75">
                        {seatSurf.preset.name}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Target Selector Tabs: Tabletop Background | Your Personal Playmat | Per-Seat Playmats */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('tabletop')}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                  activeTab === 'tabletop'
                    ? 'border-emerald-400 bg-emerald-500/20 text-white'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Layers className="h-3.5 w-3.5 text-emerald-400" />
                <span>1. Tabletop Background</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('your-playmat')}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                  activeTab === 'your-playmat'
                    ? 'border-sky-400 bg-sky-500/20 text-white'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Palette className="h-3.5 w-3.5 text-sky-400" />
                <span>2. Your Personal Playmat</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('per-seat')}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                  activeTab === 'per-seat'
                    ? 'border-amber-400 bg-amber-500/20 text-white'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Users className="h-3.5 w-3.5 text-amber-400" />
                <span>3. Per-Seat Playmats (Seats 1–4)</span>
              </button>
            </div>

            {isSeatTarget && (
              <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!useTabletopDefault}
                  onChange={(e) => handleToggleUseTabletopDefault(!e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-600 text-emerald-500"
                />
                <span>Use custom playmat instead of Tabletop Background</span>
              </label>
            )}
          </div>

          {/* Per-Seat Pill Selector when on 'per-seat' tab */}
          {activeTab === 'per-seat' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['seat-1', 'seat-2', 'seat-3', 'seat-4'] as SeatPlaymatKey[]).map(
                (sKey, idx) => {
                  const cfg = preferences.seatPlaymats[sKey];
                  const preset = getTabletopThemePreset(cfg.themeId);
                  const isSelected = selectedSeatKey === sKey;
                  return (
                    <button
                      key={sKey}
                      type="button"
                      onClick={() => setSelectedSeatKey(sKey)}
                      className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? 'border-amber-400 bg-amber-500/15 text-white'
                          : 'border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      <div className="font-bold truncate">
                        {defaultSeatTitles[idx]}
                      </div>
                      <div className="text-[11px] text-zinc-400 truncate">
                        {cfg.useTabletopDefault ? 'Matches Tabletop' : preset.name}
                      </div>
                    </button>
                  );
                }
              )}
            </div>
          )}

          {/* Theme Color & Surface Material Presets */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                TCG Surface &amp; Felt Theme Presets
              </label>
              <span className="text-[11px] text-zinc-400">
                {activeTab === 'tabletop'
                  ? 'Applies to the overall tabletop arena'
                  : activeTab === 'your-playmat'
                  ? 'Applies to your personal playmat across solo & multiplayer'
                  : `Applies to ${
                      defaultSeatTitles[
                        Number(selectedSeatKey.replace('seat-', '')) - 1
                      ]
                    }`}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {TABLETOP_THEME_PRESETS.map((theme) => {
                const isSelected =
                  activeSurface.themeId === theme.id && !useTabletopDefault;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() =>
                      updateActiveSurface((prev) => ({
                        ...prev,
                        themeId: theme.id,
                      }))
                    }
                    className={`flex flex-col justify-between rounded-xl border p-3 text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-emerald-400 bg-zinc-900 ring-1 ring-emerald-400/60'
                        : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-block h-5 w-8 rounded border ${
                            SWATCH_BG_BY_THEME[theme.id]
                          }`}
                        />
                        {isSelected && (
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-emerald-300">
                            <Check className="h-3 w-3" />
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-bold text-white">
                        {theme.name}
                      </div>
                      <p className="text-[11px] leading-snug text-zinc-400">
                        {theme.tagline}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Built-In Procedural Playmat Art & Zone Blueprint Overlays */}
          <div className="space-y-2.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-300">
              Playmat Sigil &amp; Tournament Zone Overlays (100% Offline / LAN Ready)
            </label>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {PLAYMAT_ARTWORK_PRESETS.map((art) => {
                const isSelected =
                  activeSurface.artworkPresetId === art.id &&
                  !activeSurface.customImageUrl;
                return (
                  <button
                    key={art.id}
                    type="button"
                    onClick={() =>
                      updateActiveSurface((prev) => ({
                        ...prev,
                        artworkPresetId: art.id,
                        customImageUrl: '',
                      }))
                    }
                    className={`rounded-xl border p-3 text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-sky-400 bg-sky-950/30 ring-1 ring-sky-400/50'
                        : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white">
                        {art.name}
                      </span>
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 text-sky-300 shrink-0" />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-400 leading-snug">
                      {art.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Playmat Artwork Image URL / Local Upload & Contrast Dimmer */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-sky-300" />
                <span className="text-xs font-bold text-white">
                  Custom Playmat Image / Card Art Backdrop
                </span>
              </div>
              {activeSurface.customImageUrl && (
                <button
                  type="button"
                  onClick={() =>
                    updateActiveSurface((prev) => ({
                      ...prev,
                      customImageUrl: '',
                    }))
                  }
                  className="inline-flex items-center gap-1 rounded border border-red-400/40 bg-red-950/40 px-2 py-1 text-[11px] font-semibold text-red-200 hover:bg-red-900/50 cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Remove Custom Image</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-8 flex gap-2">
                <input
                  type="url"
                  value={customUrlInput}
                  onChange={(e) => setCustomUrlInput(e.target.value)}
                  placeholder="Paste image URL (e.g., https://cards.scryfall.io/art_crop/...)"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-white placeholder:text-zinc-500"
                />
                <button
                  type="button"
                  onClick={handleApplyCustomUrl}
                  className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-sky-500 cursor-pointer shrink-0"
                >
                  Apply URL
                </button>
              </div>

              <div className="md:col-span-4 flex items-center justify-end">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-sky-400 hover:text-white cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5 text-sky-300" />
                  <span>Upload Local Playmat Image</span>
                </button>
              </div>
            </div>

            {urlError && (
              <div className="text-xs font-medium text-red-300">{urlError}</div>
            )}
            {uploadNotice && (
              <div className="text-xs font-medium text-emerald-300">
                {uploadNotice}
              </div>
            )}

            {/* Readability Scrim Dimmer & Zone Border Style */}
            <div className="grid grid-cols-1 gap-4 pt-1 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-300">
                    Card Readability Scrim (Contrast Dimmer)
                  </span>
                  <span className="font-mono text-zinc-400">
                    {Math.round(activeSurface.dimmerOpacity * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {[
                    { label: 'Vivid (35%)', val: 0.35 },
                    { label: 'Balanced (55%)', val: 0.55 },
                    { label: 'Crisp (68%)', val: 0.68 },
                    { label: 'Deep (80%)', val: 0.8 },
                  ].map((opt) => (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() =>
                        updateActiveSurface((prev) => ({
                          ...prev,
                          dimmerOpacity: opt.val,
                        }))
                      }
                      className={`flex-1 rounded border px-2 py-1 text-[11px] font-semibold cursor-pointer ${
                        Math.abs(activeSurface.dimmerOpacity - opt.val) < 0.06
                          ? 'border-sky-400 bg-sky-500/20 text-white'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-zinc-300">
                  Playmat Zone Border Trim
                </div>
                <div className="flex items-center gap-1.5">
                  {(
                    [
                      { id: 'classic', label: 'Stitched Felt' },
                      { id: 'glow', label: 'Aether Glow' },
                      { id: 'minimal', label: 'Clean Matte' },
                    ] as Array<{ id: PlaymatZoneBorderStyle; label: string }>
                  ).map((bStyle) => (
                    <button
                      key={bStyle.id}
                      type="button"
                      onClick={() =>
                        updateActiveSurface((prev) => ({
                          ...prev,
                          zoneBorderStyle: bStyle.id,
                        }))
                      }
                      className={`flex-1 rounded border px-2 py-1 text-[11px] font-semibold cursor-pointer ${
                        activeSurface.zoneBorderStyle === bStyle.id
                          ? 'border-emerald-400 bg-emerald-500/20 text-white'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {bStyle.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-900/90 px-5 py-3.5 text-xs">
          <span className="text-zinc-400">
            Playmat &amp; tabletop themes persist automatically for your profile and sync across solo &amp; multiplayer sessions.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-bold text-zinc-950 hover:bg-emerald-400 cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
