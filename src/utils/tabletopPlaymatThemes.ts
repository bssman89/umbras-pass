export type TabletopThemeId =
  | 'emerald-felt'
  | 'arcane-midnight'
  | 'obsidian-dragon'
  | 'simic-biolum'
  | 'azorius-celestial'
  | 'golgari-undercity'
  | 'volcanic-forge'
  | 'tournament-slate';

export type PlaymatArtworkPresetId =
  | 'none'
  | 'arcane-compass'
  | 'dragon-sigil'
  | 'mana-sanctum'
  | 'aether-lattice'
  | 'tournament-zones';

export type PlaymatZoneBorderStyle = 'classic' | 'glow' | 'minimal';

export interface TabletopThemePreset {
  id: TabletopThemeId;
  name: string;
  tagline: string;
  badgeColor: string;
  swatchHex: string;
  secondaryHex: string;
  accentHex: string;
  /** Outer tabletop container classes */
  tableOuterClass: string;
  /** Top HUD bar classes */
  tableHudClass: string;
  /** Default playmat seat container classes */
  seatMatClass: string;
  /** Active/focused seat container classes */
  seatMatActiveClass: string;
  /** Inner lane / battlefield zone classes */
  innerLaneClass: string;
  /** Divider border class inside seats */
  dividerBorderClass: string;
}

export interface PlaymatArtworkPreset {
  id: PlaymatArtworkPresetId;
  name: string;
  description: string;
  dataUri: string;
}

export interface TabletopSurfaceConfig {
  themeId: TabletopThemeId;
  artworkPresetId: PlaymatArtworkPresetId;
  customImageUrl: string;
  dimmerOpacity: number; // 0.25 .. 0.90
  zoneBorderStyle: PlaymatZoneBorderStyle;
}

export interface SeatPlaymatConfig extends TabletopSurfaceConfig {
  useTabletopDefault: boolean;
}

export type SeatPlaymatKey = 'seat-1' | 'seat-2' | 'seat-3' | 'seat-4';

export interface TabletopPlaymatPreferences {
  /** Global tabletop arena surface */
  tabletop: TabletopSurfaceConfig;
  /** Current user's personal playmat (applies to their seat in Solo & Multiplayer) */
  yourPlaymat: SeatPlaymatConfig;
  /** Per-tabletop seat overrides for seats 1..4 (e.g., distinct playmats for AI bots or pod seats) */
  seatPlaymats: Record<SeatPlaymatKey, SeatPlaymatConfig>;
  updatedAt: string;
}

export interface ResolvedPlaymatSurface {
  preset: TabletopThemePreset;
  backgroundImageUrl: string | null;
  dimmerOpacity: number;
  zoneBorderStyle: PlaymatZoneBorderStyle;
  outerClass: string;
  hudClass: string;
  seatClass: string;
  seatActiveClass: string;
  innerLaneClass: string;
  dividerBorderClass: string;
}

export const TABLETOP_THEME_PRESETS: TabletopThemePreset[] = [
  {
    id: 'emerald-felt',
    name: 'Emerald Sanctum Felt',
    tagline: 'Classic championship green felt with deep jade zone stitching',
    badgeColor: 'text-emerald-300',
    swatchHex: '#0F4C3A',
    secondaryHex: '#0B392C',
    accentHex: '#1E6E56',
    tableOuterClass: 'border-[#186A52] bg-[#0F4C3A]',
    tableHudClass: 'border-[#1A7158] bg-[#0B392C]/95',
    seatMatClass: 'border-[#1E6E56] bg-[#0B392C]/88 hover:border-emerald-400/60',
    seatMatActiveClass: 'border-sky-400 bg-[#125541]/92 ring-1 ring-sky-400/50',
    innerLaneClass: 'border-[#247059] bg-[#082E23]/80',
    dividerBorderClass: 'border-[#1A624D]',
  },
  {
    id: 'arcane-midnight',
    name: 'Midnight Arcane Vault',
    tagline: 'Deep astral navy sanctum with starlight cyan & sapphire trim',
    badgeColor: 'text-sky-300',
    swatchHex: '#071324',
    secondaryHex: '#0B1D33',
    accentHex: '#1E436E',
    tableOuterClass: 'border-[#1E436E] bg-[#071324]',
    tableHudClass: 'border-[#214B7A] bg-[#0A1A2E]/95',
    seatMatClass: 'border-[#214B7A] bg-[#0B1D33]/88 hover:border-sky-400/60',
    seatMatActiveClass: 'border-amber-400 bg-[#102947]/92 ring-1 ring-amber-400/50',
    innerLaneClass: 'border-[#1F4673] bg-[#06101D]/80',
    dividerBorderClass: 'border-[#1A3B61]',
  },
  {
    id: 'obsidian-dragon',
    name: 'Obsidian Dragonscale',
    tagline: 'Charcoal volcanic slate with crimson dragon-ember borders',
    badgeColor: 'text-rose-300',
    swatchHex: '#181014',
    secondaryHex: '#24161C',
    accentHex: '#7A283B',
    tableOuterClass: 'border-[#6E2435] bg-[#181014]',
    tableHudClass: 'border-[#7A283B] bg-[#211419]/95',
    seatMatClass: 'border-[#6E2435] bg-[#24161C]/88 hover:border-rose-400/60',
    seatMatActiveClass: 'border-amber-400 bg-[#331D26]/92 ring-1 ring-amber-400/50',
    innerLaneClass: 'border-[#5C202E] bg-[#130C0F]/80',
    dividerBorderClass: 'border-[#521C29]',
  },
  {
    id: 'simic-biolum',
    name: 'Bioluminescent Grove',
    tagline: 'Aether-infused abyssal teal with luminous cyan growth lines',
    badgeColor: 'text-cyan-300',
    swatchHex: '#06262E',
    secondaryHex: '#0A3640',
    accentHex: '#197485',
    tableOuterClass: 'border-[#197485] bg-[#06262E]',
    tableHudClass: 'border-[#1D8294] bg-[#082F38]/95',
    seatMatClass: 'border-[#197485] bg-[#0A3640]/88 hover:border-cyan-400/60',
    seatMatActiveClass: 'border-emerald-300 bg-[#0F4957]/92 ring-1 ring-emerald-300/50',
    innerLaneClass: 'border-[#1B6E7D] bg-[#051E24]/80',
    dividerBorderClass: 'border-[#165D6B]',
  },
  {
    id: 'azorius-celestial',
    name: 'Celestial Law Sanctum',
    tagline: 'Regal steel-blue marble surface with golden hallowed accents',
    badgeColor: 'text-amber-200',
    swatchHex: '#101C30',
    secondaryHex: '#162742',
    accentHex: '#3B5F91',
    tableOuterClass: 'border-[#3B5F91] bg-[#101C30]',
    tableHudClass: 'border-[#466FA8] bg-[#13223A]/95',
    seatMatClass: 'border-[#3B5F91] bg-[#162742]/88 hover:border-amber-300/60',
    seatMatActiveClass: 'border-amber-300 bg-[#1D3457]/92 ring-1 ring-amber-300/60',
    innerLaneClass: 'border-[#355685] bg-[#0B1424]/80',
    dividerBorderClass: 'border-[#2D4A73]',
  },
  {
    id: 'golgari-undercity',
    name: 'Undercity Moss & Bone',
    tagline: 'Overgrown catacomb stone with deep moss & necrotic amber trim',
    badgeColor: 'text-lime-300',
    swatchHex: '#131D14',
    secondaryHex: '#1A291C',
    accentHex: '#3E5E42',
    tableOuterClass: 'border-[#3E5E42] bg-[#131D14]',
    tableHudClass: 'border-[#486E4D] bg-[#172419]/95',
    seatMatClass: 'border-[#3E5E42] bg-[#1A291C]/88 hover:border-lime-400/60',
    seatMatActiveClass: 'border-amber-400 bg-[#233826]/92 ring-1 ring-amber-400/50',
    innerLaneClass: 'border-[#36523A] bg-[#0E160F]/80',
    dividerBorderClass: 'border-[#2F4732]',
  },
  {
    id: 'volcanic-forge',
    name: 'Molten Mana Forge',
    tagline: 'Dark forged iron playmat with smoldering copper & magma seams',
    badgeColor: 'text-orange-300',
    swatchHex: '#1C120D',
    secondaryHex: '#291A12',
    accentHex: '#80411E',
    tableOuterClass: 'border-[#80411E] bg-[#1C120D]',
    tableHudClass: 'border-[#914A22] bg-[#24160F]/95',
    seatMatClass: 'border-[#80411E] bg-[#291A12]/88 hover:border-orange-400/60',
    seatMatActiveClass: 'border-amber-400 bg-[#382318]/92 ring-1 ring-amber-400/50',
    innerLaneClass: 'border-[#6E3719] bg-[#140D09]/80',
    dividerBorderClass: 'border-[#5E2F15]',
  },
  {
    id: 'tournament-slate',
    name: 'Pro Tournament Carbon',
    tagline: 'Neutral high-contrast carbon matte engineered for competitive clarity',
    badgeColor: 'text-zinc-300',
    swatchHex: '#12151A',
    secondaryHex: '#1A1E26',
    accentHex: '#384152',
    tableOuterClass: 'border-[#384152] bg-[#12151A]',
    tableHudClass: 'border-[#434E63] bg-[#161A21]/95',
    seatMatClass: 'border-[#384152] bg-[#1A1E26]/88 hover:border-sky-400/60',
    seatMatActiveClass: 'border-sky-400 bg-[#232936]/92 ring-1 ring-sky-400/50',
    innerLaneClass: 'border-[#323A4A] bg-[#0D1014]/80',
    dividerBorderClass: 'border-[#2C3342]',
  },
];

function svgToDataUri(svgString: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgString.trim())}`;
}

export const PLAYMAT_ARTWORK_PRESETS: PlaymatArtworkPreset[] = [
  {
    id: 'none',
    name: 'Clean Felt / Solid Texture',
    description: 'Pure high-contrast tabletop surface without overlaid sigil artwork.',
    dataUri: '',
  },
  {
    id: 'arcane-compass',
    name: 'Planar Astrolabe & Runes',
    description: 'Concentric planar rings, cardinal leyline compass, and subtle mana geometry.',
    dataUri: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
        <defs>
          <radialGradient id="g1" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.28"/>
            <stop offset="55%" stop-color="#6366f1" stop-opacity="0.12"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="800" height="500" fill="url(#g1)"/>
        <g stroke="#7dd3fc" stroke-opacity="0.28" fill="none" stroke-width="1.5">
          <circle cx="400" cy="250" r="185"/>
          <circle cx="400" cy="250" r="145" stroke-dasharray="8 6"/>
          <circle cx="400" cy="250" r="95"/>
          <polygon points="400,75 552,338 248,338"/>
          <polygon points="400,425 552,162 248,162"/>
          <line x1="80" y1="250" x2="720" y2="250" stroke-opacity="0.2"/>
          <line x1="400" y1="30" x2="400" y2="470" stroke-opacity="0.2"/>
        </g>
      </svg>
    `),
  },
  {
    id: 'dragon-sigil',
    name: 'Elder Dragon Crest & Ember Grid',
    description: 'Draconic wing crest with angular command zone framing and ember lines.',
    dataUri: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
        <defs>
          <radialGradient id="drg" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stop-color="#f43f5e" stop-opacity="0.30"/>
            <stop offset="60%" stop-color="#f59e0b" stop-opacity="0.10"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="800" height="500" fill="url(#drg)"/>
        <g stroke="#fda4af" stroke-opacity="0.26" fill="none" stroke-width="2">
          <path d="M400,90 L520,180 L660,120 L580,260 L640,380 L400,330 L160,380 L220,260 L140,120 L280,180 Z"/>
          <polygon points="400,130 490,250 400,370 310,250"/>
          <rect x="30" y="30" width="740" height="440" rx="18" stroke-opacity="0.18"/>
        </g>
      </svg>
    `),
  },
  {
    id: 'mana-sanctum',
    name: 'Five-Color Leyline Pentagram',
    description: 'Balanced five-point mana convergence ring ideal for Commander pods.',
    dataUri: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
        <g stroke="#a7f3d0" stroke-opacity="0.24" fill="none" stroke-width="1.8">
          <circle cx="400" cy="250" r="190"/>
          <circle cx="400" cy="250" r="172"/>
          <polygon points="400,68 573,194 507,398 293,398 227,194"/>
          <path d="M400,68 L507,398 L227,194 L573,194 L293,398 Z" stroke-opacity="0.18"/>
        </g>
        <circle cx="400" cy="78" r="12" fill="#fef08a" fill-opacity="0.35"/>
        <circle cx="565" cy="196" r="12" fill="#38bdf8" fill-opacity="0.35"/>
        <circle cx="502" cy="390" r="12" fill="#a855f7" fill-opacity="0.35"/>
        <circle cx="298" cy="390" r="12" fill="#f87171" fill-opacity="0.35"/>
        <circle cx="235" cy="196" r="12" fill="#34d399" fill-opacity="0.35"/>
      </svg>
    `),
  },
  {
    id: 'aether-lattice',
    name: 'Kaladesh Aether Filigree',
    description: 'Flowing hexagonal aether conduits and glowing arcane circuit curves.',
    dataUri: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
        <g stroke="#22d3ee" stroke-opacity="0.24" fill="none" stroke-width="1.5">
          <path d="M0,250 Q200,110 400,250 T800,250"/>
          <path d="M0,250 Q200,390 400,250 T800,250"/>
          <polygon points="400,110 520,180 520,320 400,390 280,320 280,180"/>
          <polygon points="400,155 480,202 480,298 400,345 320,298 320,202" stroke-dasharray="6 4"/>
        </g>
      </svg>
    `),
  },
  {
    id: 'tournament-zones',
    name: 'TCG Championship Zone Blueprint',
    description: 'Subtle Command, Library, Graveyard, Frontline Combat, and Mana Row markings.',
    dataUri: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
        <g stroke="#e4e4e7" stroke-opacity="0.22" fill="none" stroke-width="1.5" stroke-dasharray="6 4">
          <rect x="24" y="24" width="160" height="210" rx="10"/>
          <rect x="24" y="254" width="160" height="222" rx="10"/>
          <rect x="204" y="24" width="572" height="220" rx="10"/>
          <rect x="204" y="260" width="572" height="216" rx="10"/>
        </g>
      </svg>
    `),
  },
];

const STORAGE_KEY_PREFIX = 'umbras_pass_playmat_prefs_v1';
export const PLAYMAT_THEME_UPDATED_EVENT = 'umbras:playmat-theme-updated';

export function isValidPlaymatImageUrl(rawUrl?: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('data:image/')) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function getTabletopThemePreset(themeId?: string): TabletopThemePreset {
  const found = TABLETOP_THEME_PRESETS.find((t) => t.id === themeId);
  return found || TABLETOP_THEME_PRESETS[0];
}

export function getPlaymatArtworkPreset(artworkId?: string): PlaymatArtworkPreset {
  const found = PLAYMAT_ARTWORK_PRESETS.find((a) => a.id === artworkId);
  return found || PLAYMAT_ARTWORK_PRESETS[0];
}

export function createDefaultTabletopPlaymatPreferences(): TabletopPlaymatPreferences {
  const defaultSurface: TabletopSurfaceConfig = {
    themeId: 'emerald-felt',
    artworkPresetId: 'none',
    customImageUrl: '',
    dimmerOpacity: 0.65,
    zoneBorderStyle: 'classic',
  };

  const defaultSeatConfig = (themeId: TabletopThemeId = 'emerald-felt'): SeatPlaymatConfig => ({
    useTabletopDefault: true,
    themeId,
    artworkPresetId: 'none',
    customImageUrl: '',
    dimmerOpacity: 0.65,
    zoneBorderStyle: 'classic',
  });

  return {
    tabletop: { ...defaultSurface },
    yourPlaymat: {
      useTabletopDefault: true,
      themeId: 'emerald-felt',
      artworkPresetId: 'arcane-compass',
      customImageUrl: '',
      dimmerOpacity: 0.62,
      zoneBorderStyle: 'classic',
    },
    seatPlaymats: {
      'seat-1': defaultSeatConfig('emerald-felt'),
      'seat-2': defaultSeatConfig('arcane-midnight'),
      'seat-3': defaultSeatConfig('obsidian-dragon'),
      'seat-4': defaultSeatConfig('simic-biolum'),
    },
    updatedAt: new Date().toISOString(),
  };
}

function getScopedStorageKey(userScope?: string): string {
  const cleanScope = (userScope || '').trim().toLowerCase();
  return cleanScope ? `${STORAGE_KEY_PREFIX}:${cleanScope}` : STORAGE_KEY_PREFIX;
}

export function loadTabletopPlaymatPreferences(userScope?: string): TabletopPlaymatPreferences {
  const fallback = createDefaultTabletopPlaymatPreferences();
  if (typeof window === 'undefined') return fallback;

  try {
    const raw =
      window.localStorage.getItem(getScopedStorageKey(userScope)) ||
      window.localStorage.getItem(STORAGE_KEY_PREFIX);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<TabletopPlaymatPreferences>;
    if (!parsed || typeof parsed !== 'object') return fallback;

    const sanitizeSurface = (
      src: Partial<TabletopSurfaceConfig> | undefined,
      def: TabletopSurfaceConfig
    ): TabletopSurfaceConfig => ({
      themeId: getTabletopThemePreset(src?.themeId).id,
      artworkPresetId: getPlaymatArtworkPreset(src?.artworkPresetId).id,
      customImageUrl: isValidPlaymatImageUrl(src?.customImageUrl)
        ? (src?.customImageUrl || '').trim()
        : '',
      dimmerOpacity:
        typeof src?.dimmerOpacity === 'number' && !Number.isNaN(src.dimmerOpacity)
          ? Math.max(0.25, Math.min(0.9, src.dimmerOpacity))
          : def.dimmerOpacity,
      zoneBorderStyle:
        src?.zoneBorderStyle === 'glow' || src?.zoneBorderStyle === 'minimal'
          ? src.zoneBorderStyle
          : 'classic',
    });

    const sanitizeSeat = (
      src: Partial<SeatPlaymatConfig> | undefined,
      def: SeatPlaymatConfig
    ): SeatPlaymatConfig => ({
      ...sanitizeSurface(src, def),
      useTabletopDefault:
        typeof src?.useTabletopDefault === 'boolean'
          ? src.useTabletopDefault
          : def.useTabletopDefault,
    });

    return {
      tabletop: sanitizeSurface(parsed.tabletop, fallback.tabletop),
      yourPlaymat: sanitizeSeat(parsed.yourPlaymat, fallback.yourPlaymat),
      seatPlaymats: {
        'seat-1': sanitizeSeat(parsed.seatPlaymats?.['seat-1'], fallback.seatPlaymats['seat-1']),
        'seat-2': sanitizeSeat(parsed.seatPlaymats?.['seat-2'], fallback.seatPlaymats['seat-2']),
        'seat-3': sanitizeSeat(parsed.seatPlaymats?.['seat-3'], fallback.seatPlaymats['seat-3']),
        'seat-4': sanitizeSeat(parsed.seatPlaymats?.['seat-4'], fallback.seatPlaymats['seat-4']),
      },
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return fallback;
  }
}

export function saveTabletopPlaymatPreferences(
  prefs: TabletopPlaymatPreferences,
  userScope?: string
): void {
  if (typeof window === 'undefined') return;
  const stamped: TabletopPlaymatPreferences = {
    ...prefs,
    updatedAt: new Date().toISOString(),
  };
  try {
    const serialized = JSON.stringify(stamped);
    window.localStorage.setItem(STORAGE_KEY_PREFIX, serialized);
    if (userScope) {
      window.localStorage.setItem(getScopedStorageKey(userScope), serialized);
    }
    window.dispatchEvent(
      new CustomEvent(PLAYMAT_THEME_UPDATED_EVENT, { detail: stamped })
    );
  } catch {
    // Ignore localStorage quota errors
  }
}

function resolveBackgroundUrl(surface: TabletopSurfaceConfig): string | null {
  if (surface.customImageUrl && isValidPlaymatImageUrl(surface.customImageUrl)) {
    return surface.customImageUrl.trim();
  }
  const artPreset = getPlaymatArtworkPreset(surface.artworkPresetId);
  if (artPreset && artPreset.id !== 'none' && artPreset.dataUri) {
    return artPreset.dataUri;
  }
  return null;
}

export function resolveTabletopSurface(
  prefs: TabletopPlaymatPreferences,
  remoteRoomOverride?: {
    tabletopThemeId?: string;
    tabletopCustomImageUrl?: string;
    tabletopArtworkPresetId?: string;
  }
): ResolvedPlaymatSurface {
  const effectiveConfig: TabletopSurfaceConfig = {
    ...prefs.tabletop,
  };

  if (remoteRoomOverride?.tabletopThemeId) {
    effectiveConfig.themeId = getTabletopThemePreset(remoteRoomOverride.tabletopThemeId).id;
  }
  if (
    remoteRoomOverride?.tabletopCustomImageUrl &&
    isValidPlaymatImageUrl(remoteRoomOverride.tabletopCustomImageUrl)
  ) {
    effectiveConfig.customImageUrl = remoteRoomOverride.tabletopCustomImageUrl.trim();
  }
  if (remoteRoomOverride?.tabletopArtworkPresetId) {
    effectiveConfig.artworkPresetId = getPlaymatArtworkPreset(
      remoteRoomOverride.tabletopArtworkPresetId
    ).id;
  }

  const preset = getTabletopThemePreset(effectiveConfig.themeId);
  return {
    preset,
    backgroundImageUrl: resolveBackgroundUrl(effectiveConfig),
    dimmerOpacity: effectiveConfig.dimmerOpacity,
    zoneBorderStyle: effectiveConfig.zoneBorderStyle,
    outerClass: preset.tableOuterClass,
    hudClass: preset.tableHudClass,
    seatClass: preset.seatMatClass,
    seatActiveClass: preset.seatMatActiveClass,
    innerLaneClass: preset.innerLaneClass,
    dividerBorderClass: preset.dividerBorderClass,
  };
}

export function resolveSeatPlaymatSurface(
  prefs: TabletopPlaymatPreferences,
  seatNumber: 1 | 2 | 3 | 4,
  options?: {
    isYourSeat?: boolean;
    remoteSeatOverride?: {
      playmatThemeId?: string;
      playmatCustomImageUrl?: string;
      playmatArtworkPresetId?: string;
    };
    remoteTabletopOverride?: {
      tabletopThemeId?: string;
      tabletopCustomImageUrl?: string;
      tabletopArtworkPresetId?: string;
    };
  }
): ResolvedPlaymatSurface {
  const seatKey: SeatPlaymatKey = `seat-${seatNumber}`;
  const seatLocal = prefs.seatPlaymats[seatKey];

  // Priority:
  // 1. If remoteSeatOverride has an explicit theme or custom image set by that multiplayer seat occupant, use it unless the local user overrode that specific seat locally.
  // 2. If this is the caller's own seat (`isYourSeat`) and `yourPlaymat.useTabletopDefault === false`, use `yourPlaymat`.
  // 3. If `seatLocal.useTabletopDefault === false`, use `seatLocal`.
  // 4. Otherwise fall back to the Tabletop surface theme.

  if (options?.isYourSeat && !prefs.yourPlaymat.useTabletopDefault) {
    const preset = getTabletopThemePreset(prefs.yourPlaymat.themeId);
    return {
      preset,
      backgroundImageUrl: resolveBackgroundUrl(prefs.yourPlaymat),
      dimmerOpacity: prefs.yourPlaymat.dimmerOpacity,
      zoneBorderStyle: prefs.yourPlaymat.zoneBorderStyle,
      outerClass: preset.tableOuterClass,
      hudClass: preset.tableHudClass,
      seatClass: preset.seatMatClass,
      seatActiveClass: preset.seatMatActiveClass,
      innerLaneClass: preset.innerLaneClass,
      dividerBorderClass: preset.dividerBorderClass,
    };
  }

  if (seatLocal && !seatLocal.useTabletopDefault) {
    const preset = getTabletopThemePreset(seatLocal.themeId);
    return {
      preset,
      backgroundImageUrl: resolveBackgroundUrl(seatLocal),
      dimmerOpacity: seatLocal.dimmerOpacity,
      zoneBorderStyle: seatLocal.zoneBorderStyle,
      outerClass: preset.tableOuterClass,
      hudClass: preset.tableHudClass,
      seatClass: preset.seatMatClass,
      seatActiveClass: preset.seatMatActiveClass,
      innerLaneClass: preset.innerLaneClass,
      dividerBorderClass: preset.dividerBorderClass,
    };
  }

  if (
    options?.remoteSeatOverride?.playmatThemeId ||
    options?.remoteSeatOverride?.playmatCustomImageUrl ||
    options?.remoteSeatOverride?.playmatArtworkPresetId
  ) {
    const remoteConfig: TabletopSurfaceConfig = {
      themeId: getTabletopThemePreset(
        options.remoteSeatOverride.playmatThemeId || prefs.tabletop.themeId
      ).id,
      artworkPresetId: getPlaymatArtworkPreset(
        options.remoteSeatOverride.playmatArtworkPresetId || 'none'
      ).id,
      customImageUrl: isValidPlaymatImageUrl(options.remoteSeatOverride.playmatCustomImageUrl)
        ? (options.remoteSeatOverride.playmatCustomImageUrl || '').trim()
        : '',
      dimmerOpacity: 0.65,
      zoneBorderStyle: 'classic',
    };
    const preset = getTabletopThemePreset(remoteConfig.themeId);
    return {
      preset,
      backgroundImageUrl: resolveBackgroundUrl(remoteConfig),
      dimmerOpacity: remoteConfig.dimmerOpacity,
      zoneBorderStyle: remoteConfig.zoneBorderStyle,
      outerClass: preset.tableOuterClass,
      hudClass: preset.tableHudClass,
      seatClass: preset.seatMatClass,
      seatActiveClass: preset.seatMatActiveClass,
      innerLaneClass: preset.innerLaneClass,
      dividerBorderClass: preset.dividerBorderClass,
    };
  }

  return resolveTabletopSurface(prefs, options?.remoteTabletopOverride);
}
