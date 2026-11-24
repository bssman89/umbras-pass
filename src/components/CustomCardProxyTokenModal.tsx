import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  Crown,
  Image as ImageIcon,
  Layers,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import {
  BUILTIN_TOKEN_ART_PRESETS,
  createDefaultCustomCardTokenPreferences,
  normalizeCardLookupKey,
  saveCustomCardTokenPreferences,
  type CustomCardFrameStyle,
  type CustomCardProxyEntry,
  type CustomCardTokenPreferences,
  type CustomTokenVisualEntry,
} from '../utils/customCardProxiesAndTokens';
import { isValidPlaymatImageUrl } from '../utils/tabletopPlaymatThemes';

const TOKEN_KEYWORDS = [
  'Flying',
  'Haste',
  'Vigilance',
  'Trample',
  'Lifelink',
  'Deathtouch',
  'First Strike',
  'Menace',
  'Reach',
  'Infect',
];

const FRAME_STYLE_OPTIONS: Array<{
  id: CustomCardFrameStyle;
  label: string;
  ringClass: string;
}> = [
  {
    id: 'standard',
    label: 'Standard Frame',
    ringClass: 'border-zinc-500',
  },
  {
    id: 'full-art',
    label: 'Full-Art Borderless',
    ringClass: 'border-sky-400 ring-1 ring-sky-400/50',
  },
  {
    id: 'retro',
    label: 'Retro Artifact / Brown',
    ringClass: 'border-amber-600 ring-1 ring-amber-500/40',
  },
  {
    id: 'gold-foil',
    label: 'Gold Mythic Foil',
    ringClass: 'border-amber-300 ring-2 ring-amber-300/70',
  },
];

export function getCustomFrameBorderClass(style?: CustomCardFrameStyle): string {
  if (style === 'full-art') return 'border-sky-400 ring-1 ring-sky-400/50';
  if (style === 'retro') return 'border-amber-600/90 bg-amber-950/30';
  if (style === 'gold-foil') return 'border-amber-300 ring-1 ring-amber-300/75';
  return '';
}

export interface CustomCardProxyTokenModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: CustomCardTokenPreferences;
  onChangePreferences: (next: CustomCardTokenPreferences) => void;
  userScope?: string;
  /** Cards from the user's current deck for quick selection */
  deckCardNames?: string[];
  /** Optional callback to spawn a custom token directly onto the active battlefield (Multiplayer or Solo) */
  onSpawnTokenOnBattlefield?: (token: {
    name: string;
    kind: 'creature' | 'artifact' | 'enchantment';
    power: number;
    toughness: number;
    quantity: number;
    keywords: string[];
    imageUri?: string;
    tokenAbility?: 'treasure' | 'food' | 'clue' | 'blood' | 'none';
    frameStyle?: CustomCardFrameStyle;
  }) => void;
  /** Optional callback to inject a playtest proxy card into the active match (Hand, Battlefield, or Command Zone) */
  onInjectProxyIntoMatch?: (
    zone: 'hand' | 'battlefield' | 'commandZone',
    proxy: CustomCardProxyEntry
  ) => void;
  /** Optional callback to live-update an existing card's art/proxy metadata across the active multiplayer match */
  onSyncCardArtToMatch?: (proxy: CustomCardProxyEntry) => void;
  /** Initial tab to open */
  initialTab?: 'card-art' | 'playtest-proxies' | 'custom-tokens';
}

export const CustomCardProxyTokenModal: React.FC<
  CustomCardProxyTokenModalProps
> = ({
  isOpen,
  onClose,
  preferences,
  onChangePreferences,
  userScope,
  deckCardNames = [],
  onSpawnTokenOnBattlefield,
  onInjectProxyIntoMatch,
  onSyncCardArtToMatch,
  initialTab = 'card-art',
}) => {
  const [activeTab, setActiveTab] = useState<
    'card-art' | 'playtest-proxies' | 'custom-tokens'
  >(initialTab);

  // Tab 1 & 2 state: Card Art / Playtest Proxy form
  const [cardNameInput, setCardNameInput] = useState<string>(
    deckCardNames[0] || 'Sol Ring'
  );
  const [displayTitleInput, setDisplayTitleInput] = useState<string>('');
  const [imageUrlInput, setImageUrlInput] = useState<string>(
    BUILTIN_TOKEN_ART_PRESETS[BUILTIN_TOKEN_ART_PRESETS.length - 1].imageUri
  );
  const [frameStyleInput, setFrameStyleInput] =
    useState<CustomCardFrameStyle>('full-art');
  const [badgeLabelInput, setBadgeLabelInput] = useState<
    'ALT ART' | 'PROXY' | 'PLAYTEST'
  >('ALT ART');

  // Full Proxy fields
  const [manaCostInput, setManaCostInput] = useState<string>('{2}{U}{R}');
  const [cmcInput, setCmcInput] = useState<number>(4);
  const [typeLineInput, setTypeLineInput] = useState<string>(
    'Legendary Creature — Dragon Wizard'
  );
  const [oracleTextInput, setOracleTextInput] = useState<string>(
    'Flying, haste. Whenever this creature enters or attacks, draw a card and create a Treasure token.'
  );
  const [powerInput, setPowerInput] = useState<string>('4');
  const [toughnessInput, setToughnessInput] = useState<string>('4');
  const [spawnTargetZone, setSpawnTargetZone] = useState<
    'hand' | 'battlefield' | 'commandZone'
  >('hand');

  // Tab 3 state: Custom Token Visuals & Spawner
  const [tokenName, setTokenName] = useState<string>('Treasure');
  const [tokenKind, setTokenKind] = useState<
    'creature' | 'artifact' | 'enchantment'
  >('artifact');
  const [tokenPower, setTokenPower] = useState<number>(1);
  const [tokenToughness, setTokenToughness] = useState<number>(1);
  const [tokenKeywords, setTokenKeywords] = useState<string[]>([]);
  const [tokenAbility, setTokenAbility] = useState<
    'treasure' | 'food' | 'clue' | 'blood' | 'none'
  >('treasure');
  const [tokenImageUrl, setTokenImageUrl] = useState<string>(
    BUILTIN_TOKEN_ART_PRESETS[0].imageUri
  );
  const [tokenFrameStyle, setTokenFrameStyle] =
    useState<CustomCardFrameStyle>('standard');
  const [spawnQuantity, setSpawnQuantity] = useState<number>(1);

  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const cardFileInputRef = useRef<HTMLInputElement | null>(null);
  const tokenFileInputRef = useRef<HTMLInputElement | null>(null);

  const uniqueDeckCards = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const raw of deckCardNames) {
      const clean = (raw || '').trim();
      if (!clean) continue;
      const low = clean.toLowerCase();
      if (!seen.has(low)) {
        seen.add(low);
        list.push(clean);
      }
    }
    return list.slice(0, 60);
  }, [deckCardNames]);

  if (!isOpen) return null;

  const commitPreferences = (next: CustomCardTokenPreferences) => {
    saveCustomCardTokenPreferences(next, userScope);
    onChangePreferences(next);
  };

  const handleSelectCardForEdit = (targetName: string) => {
    setCardNameInput(targetName);
    const existing = preferences.cardProxies[normalizeCardLookupKey(targetName)];
    if (existing) {
      setDisplayTitleInput(existing.displayTitle || '');
      setImageUrlInput(existing.customImageUrl);
      setFrameStyleInput(existing.frameStyle);
      setBadgeLabelInput(existing.proxyBadgeLabel);
      if (existing.manaCost !== undefined) setManaCostInput(existing.manaCost);
      if (existing.cmc !== undefined) setCmcInput(existing.cmc);
      if (existing.typeLine !== undefined) setTypeLineInput(existing.typeLine);
      if (existing.oracleText !== undefined)
        setOracleTextInput(existing.oracleText);
      if (existing.power !== undefined) setPowerInput(existing.power);
      if (existing.toughness !== undefined)
        setToughnessInput(existing.toughness);
    }
  };

  const handleImageFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'card' | 'token'
  ) => {
    setErrorNotice(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorNotice('Please upload a PNG, JPG, WebP, or SVG image file.');
      return;
    }
    if (file.size > 2.5 * 1024 * 1024) {
      setErrorNotice(
        'Image exceeds 2.5 MB limit. Please use a compressed image or URL.'
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (dataUrl && isValidPlaymatImageUrl(dataUrl)) {
        if (target === 'card') {
          setImageUrlInput(dataUrl);
          setStatusNotice(`Loaded "${file.name}" for card artwork.`);
        } else {
          setTokenImageUrl(dataUrl);
          setStatusNotice(`Loaded "${file.name}" for custom token visual.`);
        }
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const buildCurrentProxyEntry = (
    isFullProxy: boolean
  ): CustomCardProxyEntry | null => {
    setErrorNotice(null);
    const cleanName = cardNameInput.trim();
    if (!cleanName) {
      setErrorNotice('Card name is required.');
      return null;
    }
    const cleanImg = imageUrlInput.trim();
    if (!cleanImg || !isValidPlaymatImageUrl(cleanImg)) {
      setErrorNotice(
        'Please provide a valid image URL (https://, http://, or data:image/) or select an offline SVG art preset.'
      );
      return null;
    }

    const isCreatureType = typeLineInput.toLowerCase().includes('creature');
    return {
      id: `prx_${normalizeCardLookupKey(cleanName)}`,
      cardName: cleanName,
      displayTitle: displayTitleInput.trim() || undefined,
      customImageUrl: cleanImg,
      isFullProxy,
      manaCost: isFullProxy ? manaCostInput.trim() : undefined,
      cmc: isFullProxy ? Math.max(0, Number(cmcInput) || 0) : undefined,
      typeLine: isFullProxy ? typeLineInput.trim() || 'Spell' : undefined,
      oracleText: isFullProxy ? oracleTextInput.trim() : undefined,
      power:
        isFullProxy && isCreatureType ? powerInput.trim() || '1' : undefined,
      toughness:
        isFullProxy && isCreatureType ? toughnessInput.trim() || '1' : undefined,
      frameStyle: frameStyleInput,
      proxyBadgeLabel: isFullProxy ? 'PROXY' : badgeLabelInput,
      updatedAt: new Date().toISOString(),
    };
  };

  const handleSaveCardArtOrProxy = (isFullProxy: boolean) => {
    const entry = buildCurrentProxyEntry(isFullProxy);
    if (!entry) return;

    const key = normalizeCardLookupKey(entry.cardName);
    const nextPrefs: CustomCardTokenPreferences = {
      ...preferences,
      cardProxies: {
        ...preferences.cardProxies,
        [key]: entry,
      },
      updatedAt: new Date().toISOString(),
    };
    commitPreferences(nextPrefs);
    onSyncCardArtToMatch?.(entry);
    setStatusNotice(
      isFullProxy
        ? `Saved playtest proxy "${entry.displayTitle || entry.cardName}" and synced with your tabletop.`
        : `Saved custom card art for "${entry.cardName}" and synced with your tabletop.`
    );
  };

  const handleSaveAndSpawnProxyInMatch = () => {
    const entry = buildCurrentProxyEntry(true);
    if (!entry) return;
    const key = normalizeCardLookupKey(entry.cardName);
    const nextPrefs: CustomCardTokenPreferences = {
      ...preferences,
      cardProxies: {
        ...preferences.cardProxies,
        [key]: entry,
      },
      updatedAt: new Date().toISOString(),
    };
    commitPreferences(nextPrefs);
    onSyncCardArtToMatch?.(entry);
    onInjectProxyIntoMatch?.(spawnTargetZone, entry);
    setStatusNotice(
      `Spawned playtest proxy "${entry.displayTitle || entry.cardName}" into your ${
        spawnTargetZone === 'commandZone' ? 'Command Zone' : spawnTargetZone
      }!`
    );
  };

  const handleRemoveCardProxy = (cardKey: string) => {
    const nextMap = { ...preferences.cardProxies };
    delete nextMap[cardKey];
    commitPreferences({
      ...preferences,
      cardProxies: nextMap,
    });
    setStatusNotice('Removed custom card art / proxy override.');
  };

  const handleSaveTokenBlueprint = () => {
    setErrorNotice(null);
    const cleanName = tokenName.trim();
    if (!cleanName) {
      setErrorNotice('Token name is required.');
      return;
    }
    if (!tokenImageUrl.trim() || !isValidPlaymatImageUrl(tokenImageUrl.trim())) {
      setErrorNotice('Provide a valid token artwork URL or choose a preset.');
      return;
    }

    const newTok: CustomTokenVisualEntry = {
      id: `tok_${normalizeCardLookupKey(cleanName)}`,
      name: cleanName,
      kind: tokenKind,
      power: tokenKind === 'creature' ? Math.max(0, tokenPower) : 0,
      toughness: tokenKind === 'creature' ? Math.max(1, tokenToughness) : 0,
      keywords: tokenKind === 'creature' ? tokenKeywords : [],
      tokenAbility: tokenKind === 'artifact' ? tokenAbility : 'none',
      customImageUrl: tokenImageUrl.trim(),
      frameStyle: tokenFrameStyle,
      updatedAt: new Date().toISOString(),
    };

    const existingIdx = preferences.customTokens.findIndex(
      (t) => normalizeCardLookupKey(t.name) === normalizeCardLookupKey(cleanName)
    );
    const nextTokens = [...preferences.customTokens];
    if (existingIdx !== -1) {
      nextTokens[existingIdx] = newTok;
    } else {
      nextTokens.unshift(newTok);
    }

    commitPreferences({
      ...preferences,
      customTokens: nextTokens,
    });
    setStatusNotice(`Saved custom token visual for "${cleanName} Token".`);
  };

  const handleSpawnCustomToken = (tok: CustomTokenVisualEntry, qty: number) => {
    if (!onSpawnTokenOnBattlefield) return;
    onSpawnTokenOnBattlefield({
      name: tok.name,
      kind: tok.kind,
      power: tok.power,
      toughness: tok.toughness,
      quantity: qty,
      keywords: tok.keywords,
      imageUri: tok.customImageUrl,
      tokenAbility: tok.tokenAbility,
      frameStyle: tok.frameStyle,
    });
    setStatusNotice(
      `Spawned ${qty}× ${tok.name} Token on your battlefield with custom visual!`
    );
  };

  const handleLoadTokenIntoEditor = (tok: CustomTokenVisualEntry) => {
    setTokenName(tok.name);
    setTokenKind(tok.kind);
    setTokenPower(tok.power);
    setTokenToughness(tok.toughness);
    setTokenKeywords(tok.keywords);
    setTokenAbility(tok.tokenAbility);
    setTokenImageUrl(tok.customImageUrl);
    setTokenFrameStyle(tok.frameStyle);
  };

  const handleDeleteTokenBlueprint = (id: string) => {
    commitPreferences({
      ...preferences,
      customTokens: preferences.customTokens.filter((t) => t.id !== id),
    });
  };

  const savedProxiesList = Object.values(preferences.cardProxies);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Custom Card Images, Proxies and Tokens Studio"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-5 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-2xl border border-zinc-700 bg-zinc-950 text-zinc-100 shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900/95 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-500/40 bg-sky-500/15 text-sky-300">
              <Wand2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Custom Card Images, Playtest Proxies &amp; Token Visuals
              </h2>
              <p className="text-xs text-zinc-400">
                Customize per-user card art, create playtest proxy cards, and spawn custom token visuals across solo &amp; multiplayer sessions.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                commitPreferences(createDefaultCustomCardTokenPreferences());
                setStatusNotice('Reset custom card proxies and token visuals to defaults.');
              }}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Reset Defaults</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Custom Card & Token Studio"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-zinc-800 bg-zinc-900/50 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('card-art')}
              className={`inline-flex min-h-[38px] items-center gap-2 rounded-lg border px-3.5 py-2 text-xs sm:text-sm font-semibold cursor-pointer transition-colors ${
                activeTab === 'card-art'
                  ? 'border-sky-400 bg-sky-500/20 text-white'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <ImageIcon className="h-4 w-4 text-sky-400" />
              <span>1. Custom Card Art &amp; Skins ({savedProxiesList.length})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('playtest-proxies');
                setBadgeLabelInput('PROXY');
              }}
              className={`inline-flex min-h-[38px] items-center gap-2 rounded-lg border px-3.5 py-2 text-xs sm:text-sm font-semibold cursor-pointer transition-colors ${
                activeTab === 'playtest-proxies'
                  ? 'border-violet-400 bg-violet-500/20 text-white'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Layers className="h-4 w-4 text-violet-400" />
              <span>2. Playtest Proxy Builder</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('custom-tokens')}
              className={`inline-flex min-h-[38px] items-center gap-2 rounded-lg border px-3.5 py-2 text-xs sm:text-sm font-semibold cursor-pointer transition-colors ${
                activeTab === 'custom-tokens'
                  ? 'border-amber-400 bg-amber-500/20 text-white'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sparkles className="h-4 w-4 text-amber-400" />
              <span>
                3. Custom Token Visuals &amp; Spawner ({preferences.customTokens.length})
              </span>
            </button>
          </div>

          {statusNotice && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300">
              <Check className="h-3.5 w-3.5" />
              {statusNotice}
            </span>
          )}
          {errorNotice && (
            <span className="text-xs font-medium text-red-300">
              {errorNotice}
            </span>
          )}
        </div>

        {/* Main Studio Content */}
        <div className="p-5 space-y-5 max-h-[78vh] overflow-y-auto">
          {activeTab === 'card-art' || activeTab === 'playtest-proxies' ? (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Left Column: Card Art / Playtest Proxy Form */}
              <div className="lg:col-span-8 space-y-4">
                {/* Quick Deck Card Selector */}
                {uniqueDeckCards.length > 0 && (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-zinc-200">
                        Quick-Select Card from Your Active Deck
                      </span>
                      <span className="text-xs text-zinc-400">
                        Click any card to customize its image or create a proxy
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {uniqueDeckCards.map((cName) => {
                        const hasCustom = Boolean(
                          preferences.cardProxies[normalizeCardLookupKey(cName)]
                        );
                        const isCurrent =
                          normalizeCardLookupKey(cardNameInput) ===
                          normalizeCardLookupKey(cName);
                        return (
                          <button
                            key={cName}
                            type="button"
                            onClick={() => handleSelectCardForEdit(cName)}
                            className={`min-h-[34px] rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                              isCurrent
                                ? 'border-sky-400 bg-sky-500/25 text-white font-bold'
                                : hasCustom
                                ? 'border-emerald-400/60 bg-emerald-950/50 text-emerald-200'
                                : 'border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-zinc-500'
                            }`}
                          >
                            {cName}
                            {hasCustom ? ' ★' : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Card Identity & Image Configuration */}
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3.5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                        Target Card Name (or New Proxy Name)
                      </label>
                      <input
                        type="text"
                        value={cardNameInput}
                        onChange={(e) => setCardNameInput(e.target.value)}
                        placeholder="e.g., Sol Ring or Custom Playtest Dragon"
                        className="min-h-[38px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs sm:text-sm text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                        Alternate / Skin Display Title (Optional)
                      </label>
                      <input
                        type="text"
                        value={displayTitleInput}
                        onChange={(e) => setDisplayTitleInput(e.target.value)}
                        placeholder="e.g., Astral Mana Dynamo (shows over card name)"
                        className="min-h-[38px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs sm:text-sm text-white"
                      />
                    </div>
                  </div>

                  {/* Image URL + Local File Upload */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-zinc-300">
                      Custom Card Artwork URL or Local Image Upload
                    </label>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                      <div className="sm:col-span-8">
                        <input
                          type="url"
                          value={imageUrlInput}
                          onChange={(e) => setImageUrlInput(e.target.value)}
                          placeholder="https://cards.scryfall.io/art_crop/... or data:image/..."
                          className="min-h-[38px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs sm:text-sm text-white"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <input
                          ref={cardFileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          onChange={(e) => handleImageFileUpload(e, 'card')}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => cardFileInputRef.current?.click()}
                          className="inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-xs sm:text-sm font-semibold text-sky-200 hover:border-sky-400 cursor-pointer"
                        >
                          <Upload className="h-4 w-4 text-sky-400" />
                          <span>Upload Local Image</span>
                        </button>
                      </div>
                    </div>

                    {/* Offline Built-in SVG Art Presets */}
                    <div className="pt-1">
                      <span className="block text-xs text-zinc-400 mb-1.5">
                        Or pick an offline-ready procedural SVG artwork (works over Offline LAN):
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {BUILTIN_TOKEN_ART_PRESETS.map((art) => (
                          <button
                            key={art.id}
                            type="button"
                            onClick={() => setImageUrlInput(art.imageUri)}
                            className={`min-h-[34px] rounded-lg border px-3 py-1.5 text-xs font-medium cursor-pointer ${
                              imageUrlInput === art.imageUri
                                ? 'border-sky-400 bg-sky-500/20 text-white'
                                : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {art.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Frame Style & Badge Selector */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                        Proxy / Custom Art Frame Treatment
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {FRAME_STYLE_OPTIONS.map((fOpt) => (
                          <button
                            key={fOpt.id}
                            type="button"
                            onClick={() => setFrameStyleInput(fOpt.id)}
                            className={`min-h-[36px] rounded-lg border px-3 py-1.5 text-xs font-semibold text-left cursor-pointer ${
                              frameStyleInput === fOpt.id
                                ? 'border-sky-400 bg-sky-500/20 text-white'
                                : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {fOpt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                        Card Tag Badge
                      </label>
                      <div className="flex items-center gap-2">
                        {(['ALT ART', 'PROXY', 'PLAYTEST'] as const).map(
                          (bTag) => (
                            <button
                              key={bTag}
                              type="button"
                              onClick={() => setBadgeLabelInput(bTag)}
                              className={`min-h-[36px] flex-1 rounded-lg border px-3 py-1.5 text-xs font-bold cursor-pointer ${
                                badgeLabelInput === bTag
                                  ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                                  : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              {bTag}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Full Playtest Proxy Stats & Rules Text Section */}
                  {activeTab === 'playtest-proxies' && (
                    <div className="border-t border-zinc-800 pt-3.5 space-y-3">
                      <div className="text-xs sm:text-sm font-bold text-violet-300">
                        Playtest Proxy Rules &amp; Combat Stats
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-xs text-zinc-400 mb-1">
                            Type Line
                          </label>
                          <input
                            type="text"
                            value={typeLineInput}
                            onChange={(e) => setTypeLineInput(e.target.value)}
                            placeholder="Legendary Creature — Dragon"
                            className="min-h-[38px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-400 mb-1">
                            Mana Cost
                          </label>
                          <input
                            type="text"
                            value={manaCostInput}
                            onChange={(e) => setManaCostInput(e.target.value)}
                            placeholder="{2}{U}{R}"
                            className="min-h-[38px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-400 mb-1">
                            Mana Value (CMC)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={20}
                            value={cmcInput}
                            onChange={(e) =>
                              setCmcInput(Math.max(0, Number(e.target.value) || 0))
                            }
                            className="min-h-[38px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                        <div className="sm:col-span-8">
                          <label className="block text-xs text-zinc-400 mb-1">
                            Oracle Rules Text
                          </label>
                          <textarea
                            rows={2}
                            value={oracleTextInput}
                            onChange={(e) => setOracleTextInput(e.target.value)}
                            placeholder="Enter card rules text, triggered abilities, or keywords..."
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-zinc-400 mb-1">
                            Power
                          </label>
                          <input
                            type="text"
                            value={powerInput}
                            onChange={(e) => setPowerInput(e.target.value)}
                            placeholder="4"
                            className="min-h-[38px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-zinc-400 mb-1">
                            Toughness
                          </label>
                          <input
                            type="text"
                            value={toughnessInput}
                            onChange={(e) => setToughnessInput(e.target.value)}
                            placeholder="4"
                            className="min-h-[38px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Save & Multiplayer Spawn Action Buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-3.5">
                    <button
                      type="button"
                      onClick={() =>
                        handleSaveCardArtOrProxy(activeTab === 'playtest-proxies')
                      }
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-sky-500 cursor-pointer"
                    >
                      <Check className="h-4 w-4" />
                      <span>
                        {activeTab === 'playtest-proxies'
                          ? 'Save Playtest Proxy & Sync to Table'
                          : 'Save Custom Card Art & Sync to Table'}
                      </span>
                    </button>

                    {onInjectProxyIntoMatch && (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label="Select zone to spawn playtest proxy"
                          value={spawnTargetZone}
                          onChange={(e) =>
                            setSpawnTargetZone(
                              e.target.value as
                                | 'hand'
                                | 'battlefield'
                                | 'commandZone'
                            )
                          }
                          className="min-h-[40px] rounded-lg border border-violet-400/50 bg-zinc-950 px-3 py-2 text-xs sm:text-sm text-white"
                        >
                          <option value="hand">Into Your Hand</option>
                          <option value="battlefield">Onto Your Battlefield</option>
                          <option value="commandZone">Into Command Zone</option>
                        </select>
                        <button
                          type="button"
                          onClick={handleSaveAndSpawnProxyInMatch}
                          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-violet-500 cursor-pointer"
                        >
                          <Plus className="h-4 w-4" />
                          <span>Spawn Proxy into Active Match</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Live Card Preview & Saved Custom Proxies List */}
              <div className="lg:col-span-4 space-y-4">
                {/* Live Card Tile Preview */}
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3">
                  <div className="text-xs sm:text-sm font-bold text-zinc-300">
                    Live Custom Card / Proxy Preview
                  </div>

                  <div
                    className={`mx-auto w-56 rounded-xl border-2 bg-zinc-950 p-2.5 space-y-2 shadow-xl ${getCustomFrameBorderClass(
                      frameStyleInput
                    )}`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-white">
                          {displayTitleInput.trim() || cardNameInput || 'Card Name'}
                        </div>
                        {displayTitleInput.trim() && (
                          <div className="truncate text-[10px] italic text-zinc-400">
                            ({cardNameInput})
                          </div>
                        )}
                      </div>
                      {activeTab === 'playtest-proxies' && manaCostInput && (
                        <span className="font-mono text-[10px] font-bold text-amber-300 shrink-0">
                          {manaCostInput}
                        </span>
                      )}
                    </div>

                    <div className="relative h-36 w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
                      {imageUrlInput && isValidPlaymatImageUrl(imageUrlInput) ? (
                        <img
                          src={imageUrlInput}
                          alt={cardNameInput}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                          No image URL
                        </div>
                      )}
                      <span className="absolute top-1.5 left-1.5 rounded bg-amber-400 px-1.5 py-0.5 font-mono text-[9px] font-bold text-zinc-950">
                        {activeTab === 'playtest-proxies'
                          ? 'PROXY'
                          : badgeLabelInput}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-sky-300">
                      <span className="truncate">
                        {activeTab === 'playtest-proxies'
                          ? typeLineInput
                          : 'Custom Art Override'}
                      </span>
                      {activeTab === 'playtest-proxies' &&
                        typeLineInput.toLowerCase().includes('creature') && (
                          <span className="font-mono font-bold text-amber-300">
                            {powerInput}/{toughnessInput}
                          </span>
                        )}
                    </div>

                    {activeTab === 'playtest-proxies' && oracleTextInput && (
                      <p className="rounded bg-zinc-900/90 p-2 text-[10px] leading-snug text-zinc-300 line-clamp-3">
                        {oracleTextInput}
                      </p>
                    )}
                  </div>
                </div>

                {/* Saved Custom Card Art & Proxies Library */}
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">
                      Your Saved Card Art &amp; Proxies ({savedProxiesList.length})
                    </span>
                  </div>

                  {savedProxiesList.length === 0 ? (
                    <div className="text-xs text-zinc-500 py-3">
                      No custom card art or playtest proxies saved yet. Select a card on the left and click Save.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {savedProxiesList.map((entry) => {
                        const key = normalizeCardLookupKey(entry.cardName);
                        return (
                          <div
                            key={entry.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs"
                          >
                            <button
                              type="button"
                              onClick={() => handleSelectCardForEdit(entry.cardName)}
                              className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
                            >
                              <img
                                src={entry.customImageUrl}
                                alt={entry.cardName}
                                className="h-9 w-11 rounded object-cover border border-zinc-700 shrink-0"
                              />
                              <div className="min-w-0">
                                <div className="font-bold text-white truncate">
                                  {entry.displayTitle || entry.cardName}
                                </div>
                                <div className="text-[10px] text-amber-300 font-mono">
                                  {entry.proxyBadgeLabel} · {entry.frameStyle}
                                </div>
                              </div>
                            </button>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {onInjectProxyIntoMatch && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onInjectProxyIntoMatch(spawnTargetZone, entry)
                                  }
                                  title="Spawn this proxy into your active match"
                                  className="min-h-[32px] rounded-md border border-violet-400/50 bg-violet-500/20 px-2.5 py-1 text-xs font-bold text-violet-200 hover:bg-violet-500/35 cursor-pointer"
                                >
                                  Spawn
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemoveCardProxy(key)}
                                aria-label={`Remove ${entry.cardName} custom proxy`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-400/30 bg-red-950/30 text-red-300 hover:bg-red-900/50 cursor-pointer"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* ============================================================================
               TAB 3: CUSTOM TOKEN VISUALS & MULTIPLAYER TOKEN SPAWNER
               ============================================================================ */
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Left Column: User's Custom Token Visual Gallery & One-Click Battlefield Spawner */}
              <div className="lg:col-span-7 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-zinc-200">
                      Your Custom Token Visuals Gallery
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Click any token to edit its custom artwork or spawn 1–10× directly onto your battlefield.
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 font-mono text-xs">
                    <span className="text-zinc-400">Spawn Qty:</span>
                    {[1, 2, 3, 5].map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setSpawnQuantity(q)}
                        className={`min-h-[34px] rounded-md border px-3 py-1 text-xs font-bold cursor-pointer ${
                          spawnQuantity === q
                            ? 'border-amber-400 bg-amber-400 text-zinc-950'
                            : 'border-zinc-700 bg-zinc-900 text-zinc-300'
                        }`}
                      >
                        {q}×
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {preferences.customTokens.map((tok) => (
                    <div
                      key={tok.id}
                      className={`rounded-xl border bg-zinc-900/80 p-3.5 flex flex-col justify-between gap-2.5 ${getCustomFrameBorderClass(
                        tok.frameStyle
                      )}`}
                    >
                      <div className="flex items-start gap-3">
                        <img
                          src={tok.customImageUrl}
                          alt={tok.name}
                          className="h-16 w-20 rounded-lg object-cover border border-zinc-700 shrink-0"
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold text-xs sm:text-sm text-white truncate">
                              {tok.name} Token
                            </span>
                            {tok.kind === 'creature' && (
                              <span className="font-mono text-xs font-bold text-amber-300 shrink-0">
                                {tok.power}/{tok.toughness}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-sky-300 capitalize">
                            Token {tok.kind}
                            {tok.keywords.length > 0
                              ? ` · ${tok.keywords.join(', ')}`
                              : ''}
                          </div>
                          <div className="flex items-center gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => handleLoadTokenIntoEditor(tok)}
                              className="min-h-[32px] rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs font-semibold text-zinc-200 hover:border-sky-400 hover:text-white cursor-pointer"
                            >
                              Customize Art
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTokenBlueprint(tok.id)}
                              aria-label={`Delete ${tok.name} token preset`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-red-300 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {onSpawnTokenOnBattlefield && (
                        <button
                          type="button"
                          onClick={() => handleSpawnCustomToken(tok, spawnQuantity)}
                          className="inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-300 cursor-pointer"
                        >
                          <Sparkles className="h-4 w-4" />
                          <span>
                            Spawn {spawnQuantity}× {tok.name} on Battlefield
                          </span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Custom Token Visual Editor */}
              <div className="lg:col-span-5 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 space-y-3.5">
                <div className="text-xs sm:text-sm font-bold text-amber-300">
                  Create or Customize Token Visual
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs text-zinc-300 mb-1">
                      Token Name
                    </label>
                    <input
                      type="text"
                      value={tokenName}
                      onChange={(e) => setTokenName(e.target.value)}
                      placeholder="e.g., Treasure, Goblin, Eldrazi"
                      className="min-h-[38px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-300 mb-1">
                      Token Type
                    </label>
                    <select
                      value={tokenKind}
                      onChange={(e) =>
                        setTokenKind(
                          e.target.value as
                            | 'creature'
                            | 'artifact'
                            | 'enchantment'
                        )
                      }
                      className="min-h-[38px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white"
                    >
                      <option value="creature">Token Creature</option>
                      <option value="artifact">Token Artifact</option>
                      <option value="enchantment">Token Enchantment</option>
                    </select>
                  </div>
                </div>

                {tokenKind === 'creature' ? (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-zinc-300 mb-1">
                          Power
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={30}
                          value={tokenPower}
                          onChange={(e) =>
                            setTokenPower(Math.max(0, Number(e.target.value) || 0))
                          }
                          className="min-h-[38px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-300 mb-1">
                          Toughness
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={tokenToughness}
                          onChange={(e) =>
                            setTokenToughness(
                              Math.max(1, Number(e.target.value) || 1)
                            )
                          }
                          className="min-h-[38px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-300 mb-1">
                        Keywords
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {TOKEN_KEYWORDS.map((kw) => {
                          const has = tokenKeywords.includes(kw);
                          return (
                            <button
                              key={kw}
                              type="button"
                              onClick={() =>
                                setTokenKeywords((prev) =>
                                  prev.includes(kw)
                                    ? prev.filter((k) => k !== kw)
                                    : [...prev, kw]
                                )
                              }
                              className={`min-h-[32px] rounded-md border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                                has
                                  ? 'border-sky-400 bg-sky-500/25 text-white'
                                  : 'border-zinc-800 bg-zinc-950 text-zinc-400'
                              }`}
                            >
                              {kw}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs text-zinc-300 mb-1">
                      Utility Token Ability
                    </label>
                    <select
                      value={tokenAbility}
                      onChange={(e) =>
                        setTokenAbility(
                          e.target.value as
                            | 'treasure'
                            | 'food'
                            | 'clue'
                            | 'blood'
                            | 'none'
                        )
                      }
                      className="min-h-[38px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white"
                    >
                      <option value="treasure">Treasure (+1 Mana)</option>
                      <option value="food">Food (+3 Life)</option>
                      <option value="clue">Clue (Draw 1 Card)</option>
                      <option value="blood">Blood (Loot / Draw 1)</option>
                      <option value="none">Generic Artifact / Enchantment</option>
                    </select>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-xs text-zinc-300">
                    Custom Token Image URL or Upload
                  </label>
                  <input
                    type="url"
                    value={tokenImageUrl}
                    onChange={(e) => setTokenImageUrl(e.target.value)}
                    placeholder="https://... or data:image/..."
                    className="min-h-[38px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      ref={tokenFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={(e) => handleImageFileUpload(e, 'token')}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => tokenFileInputRef.current?.click()}
                      className="inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-xs font-semibold text-sky-200 hover:border-sky-400 cursor-pointer"
                    >
                      <Upload className="h-4 w-4 text-sky-400" />
                      <span>Upload Custom Token Image</span>
                    </button>
                  </div>

                  <div className="pt-1">
                    <span className="block text-xs text-zinc-400 mb-1.5">
                      Built-in Offline Token Artworks:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {BUILTIN_TOKEN_ART_PRESETS.map((art) => (
                        <button
                          key={art.id}
                          type="button"
                          onClick={() => setTokenImageUrl(art.imageUri)}
                          className={`min-h-[32px] rounded-md border px-2.5 py-1 text-xs cursor-pointer ${
                            tokenImageUrl === art.imageUri
                              ? 'border-amber-400 bg-amber-500/20 text-white'
                              : 'border-zinc-800 bg-zinc-950 text-zinc-400'
                          }`}
                        >
                          {art.defaultTokenName}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleSaveTokenBlueprint}
                    className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs sm:text-sm font-bold text-white hover:bg-sky-500 cursor-pointer"
                  >
                    <Check className="h-4 w-4" />
                    <span>Save Token Visual</span>
                  </button>

                  {onSpawnTokenOnBattlefield && (
                    <button
                      type="button"
                      onClick={() => {
                        handleSaveTokenBlueprint();
                        onSpawnTokenOnBattlefield({
                          name: tokenName.trim() || 'Token',
                          kind: tokenKind,
                          power: tokenKind === 'creature' ? tokenPower : 0,
                          toughness: tokenKind === 'creature' ? tokenToughness : 0,
                          quantity: spawnQuantity,
                          keywords: tokenKind === 'creature' ? tokenKeywords : [],
                          imageUri: tokenImageUrl.trim(),
                          tokenAbility:
                            tokenKind === 'artifact' ? tokenAbility : 'none',
                          frameStyle: tokenFrameStyle,
                        });
                      }}
                      className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-2 text-xs sm:text-sm font-bold text-zinc-950 hover:bg-amber-300 cursor-pointer"
                    >
                      <Crown className="h-4 w-4" />
                      <span>Save &amp; Spawn ({spawnQuantity}×)</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-900/95 px-5 py-4 text-xs">
          <span className="text-zinc-400">
            Custom card images, playtest proxies, and token visuals are saved per user and sync automatically with your multiplayer deck &amp; battlefield.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-lg bg-emerald-500 px-5 py-2 text-xs sm:text-sm font-bold text-zinc-950 hover:bg-emerald-400 cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
