import type { CardMetadata } from '../types/deck';
import type { MultiplayerDeckSummary } from '../types/multiplayer';
import { isValidPlaymatImageUrl } from './tabletopPlaymatThemes';

export type CustomCardFrameStyle = 'standard' | 'full-art' | 'retro' | 'gold-foil';

export interface CustomCardProxyEntry {
  id: string;
  /** Target card name (exact or proxy name) */
  cardName: string;
  /** Optional alternate/nickname display header (e.g., Godzilla skin title) */
  displayTitle?: string;
  /** Custom image URL, data:image/ upload, or built-in SVG preset URI */
  customImageUrl: string;
  /** True if this entry also overrides rules/stats or defines a brand-new playtest card */
  isFullProxy: boolean;
  manaCost?: string;
  cmc?: number;
  typeLine?: string;
  oracleText?: string;
  power?: string;
  toughness?: string;
  frameStyle: CustomCardFrameStyle;
  proxyBadgeLabel: 'ALT ART' | 'PROXY' | 'PLAYTEST';
  updatedAt: string;
}

export interface CustomTokenVisualEntry {
  id: string;
  name: string;
  kind: 'creature' | 'artifact' | 'enchantment';
  power: number;
  toughness: number;
  keywords: string[];
  tokenAbility: 'treasure' | 'food' | 'clue' | 'blood' | 'none';
  customImageUrl: string;
  frameStyle: CustomCardFrameStyle;
  updatedAt: string;
}

export interface CustomCardTokenPreferences {
  cardProxies: Record<string, CustomCardProxyEntry>;
  customTokens: CustomTokenVisualEntry[];
  updatedAt: string;
}

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

export const BUILTIN_TOKEN_ART_PRESETS: Array<{
  id: string;
  name: string;
  defaultTokenName: string;
  kind: 'creature' | 'artifact' | 'enchantment';
  power: number;
  toughness: number;
  keywords: string[];
  tokenAbility: 'treasure' | 'food' | 'clue' | 'blood' | 'none';
  imageUri: string;
}> = [
  {
    id: 'art-treasure',
    name: 'Auric Treasure Chest',
    defaultTokenName: 'Treasure',
    kind: 'artifact',
    power: 0,
    toughness: 0,
    keywords: [],
    tokenAbility: 'treasure',
    imageUri: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240">
        <defs>
          <radialGradient id="tr" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stop-color="#f59e0b"/>
            <stop offset="55%" stop-color="#78350f"/>
            <stop offset="100%" stop-color="#1c1917"/>
          </radialGradient>
        </defs>
        <rect width="320" height="240" fill="url(#tr)"/>
        <g stroke="#fef08a" stroke-width="3" fill="#b45309" fill-opacity="0.75">
          <rect x="85" y="95" width="150" height="90" rx="10"/>
          <path d="M85,95 Q160,48 235,95 Z"/>
          <rect x="146" y="118" width="28" height="36" rx="4" fill="#fef08a"/>
        </g>
        <circle cx="160" cy="52" r="14" fill="#fde047" opacity="0.65"/>
      </svg>
    `),
  },
  {
    id: 'art-goblin',
    name: 'Crimson Goblin Raider',
    defaultTokenName: 'Goblin',
    kind: 'creature',
    power: 1,
    toughness: 1,
    keywords: ['Haste'],
    tokenAbility: 'none',
    imageUri: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240">
        <defs>
          <radialGradient id="gb" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stop-color="#ef4444"/>
            <stop offset="60%" stop-color="#7f1d1d"/>
            <stop offset="100%" stop-color="#181014"/>
          </radialGradient>
        </defs>
        <rect width="320" height="240" fill="url(#gb)"/>
        <g stroke="#fecaca" stroke-width="3" fill="#991b1b">
          <polygon points="160,52 210,120 265,92 218,175 102,175 55,92 110,120"/>
          <circle cx="138" cy="128" r="8" fill="#fef08a"/>
          <circle cx="182" cy="128" r="8" fill="#fef08a"/>
        </g>
      </svg>
    `),
  },
  {
    id: 'art-spirit',
    name: 'Aether Spirit Wisp',
    defaultTokenName: 'Spirit',
    kind: 'creature',
    power: 1,
    toughness: 1,
    keywords: ['Flying'],
    tokenAbility: 'none',
    imageUri: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240">
        <defs>
          <radialGradient id="sp" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stop-color="#38bdf8"/>
            <stop offset="55%" stop-color="#1e3a8a"/>
            <stop offset="100%" stop-color="#090d16"/>
          </radialGradient>
        </defs>
        <rect width="320" height="240" fill="url(#sp)"/>
        <g stroke="#bae6fd" stroke-width="2.5" fill="none">
          <circle cx="160" cy="115" r="46" fill="#7dd3fc" fill-opacity="0.28"/>
          <path d="M160,42 C210,85 215,155 160,202 C105,155 110,85 160,42 Z"/>
          <circle cx="160" cy="115" r="18" fill="#e0f2fe"/>
        </g>
      </svg>
    `),
  },
  {
    id: 'art-zombie',
    name: 'Necrotic Undead Walker',
    defaultTokenName: 'Zombie',
    kind: 'creature',
    power: 2,
    toughness: 2,
    keywords: ['Deathtouch'],
    tokenAbility: 'none',
    imageUri: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240">
        <defs>
          <radialGradient id="zm" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stop-color="#84cc16"/>
            <stop offset="50%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#090a0f"/>
          </radialGradient>
        </defs>
        <rect width="320" height="240" fill="url(#zm)"/>
        <g stroke="#bef264" stroke-width="2.5" fill="#1e293b" fill-opacity="0.85">
          <circle cx="160" cy="105" r="48"/>
          <rect x="135" y="142" width="50" height="36" rx="6"/>
          <circle cx="142" cy="100" r="10" fill="#a3e635"/>
          <circle cx="178" cy="100" r="10" fill="#a3e635"/>
        </g>
      </svg>
    `),
  },
  {
    id: 'art-angel',
    name: 'Seraphic Halo Valkyrie',
    defaultTokenName: 'Angel',
    kind: 'creature',
    power: 4,
    toughness: 4,
    keywords: ['Flying', 'Vigilance'],
    tokenAbility: 'none',
    imageUri: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240">
        <defs>
          <radialGradient id="an" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stop-color="#fef08a"/>
            <stop offset="55%" stop-color="#0284c7"/>
            <stop offset="100%" stop-color="#0f172a"/>
          </radialGradient>
        </defs>
        <rect width="320" height="240" fill="url(#an)"/>
        <g stroke="#fef9c3" stroke-width="3" fill="none">
          <ellipse cx="160" cy="58" rx="42" ry="12"/>
          <path d="M160,125 L62,65 L90,165 Z" fill="#e0f2fe" fill-opacity="0.45"/>
          <path d="M160,125 L258,65 L230,165 Z" fill="#e0f2fe" fill-opacity="0.45"/>
          <circle cx="160" cy="115" r="22" fill="#fef08a"/>
        </g>
      </svg>
    `),
  },
  {
    id: 'art-dragon',
    name: 'Hellkite Elder Wyrm',
    defaultTokenName: 'Dragon',
    kind: 'creature',
    power: 5,
    toughness: 5,
    keywords: ['Flying'],
    tokenAbility: 'none',
    imageUri: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240">
        <defs>
          <radialGradient id="dr" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stop-color="#f97316"/>
            <stop offset="55%" stop-color="#991b1b"/>
            <stop offset="100%" stop-color="#180d0d"/>
          </radialGradient>
        </defs>
        <rect width="320" height="240" fill="url(#dr)"/>
        <g stroke="#fed7aa" stroke-width="2.5" fill="#7c2d12" fill-opacity="0.8">
          <path d="M160,48 L215,105 L292,62 L245,152 L275,200 L160,168 L45,200 L75,152 L28,62 L105,105 Z"/>
        </g>
      </svg>
    `),
  },
  {
    id: 'art-clue',
    name: 'Inquisitor Clue Glyph',
    defaultTokenName: 'Clue',
    kind: 'artifact',
    power: 0,
    toughness: 0,
    keywords: [],
    tokenAbility: 'clue',
    imageUri: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240">
        <rect width="320" height="240" fill="#0f2942"/>
        <g stroke="#7dd3fc" stroke-width="4" fill="none">
          <circle cx="145" cy="105" r="46" fill="#0284c7" fill-opacity="0.35"/>
          <line x1="178" y1="138" x2="232" y2="192" stroke-width="10" stroke-linecap="round"/>
        </g>
      </svg>
    `),
  },
  {
    id: 'art-food',
    name: 'Hearth Feast Ration',
    defaultTokenName: 'Food',
    kind: 'artifact',
    power: 0,
    toughness: 0,
    keywords: [],
    tokenAbility: 'food',
    imageUri: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240">
        <rect width="320" height="240" fill="#1e3a1e"/>
        <circle cx="160" cy="125" r="56" fill="#d97706" stroke="#fde68a" stroke-width="3"/>
        <path d="M125,110 Q160,80 195,110" stroke="#fef3c7" stroke-width="3" fill="none"/>
      </svg>
    `),
  },
  {
    id: 'art-proxy-sigil',
    name: 'Planar Playtest Proxy Crest',
    defaultTokenName: 'Construct',
    kind: 'creature',
    power: 2,
    toughness: 2,
    keywords: [],
    tokenAbility: 'none',
    imageUri: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240">
        <defs>
          <linearGradient id="px" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#312e81"/>
            <stop offset="50%" stop-color="#0f172a"/>
            <stop offset="100%" stop-color="#064e3b"/>
          </linearGradient>
        </defs>
        <rect width="320" height="240" fill="url(#px)"/>
        <g stroke="#a5b4fc" stroke-width="2.5" fill="none">
          <polygon points="160,36 240,120 160,204 80,120"/>
          <circle cx="160" cy="120" r="46" stroke="#34d399"/>
          <circle cx="160" cy="120" r="14" fill="#38bdf8" fill-opacity="0.6"/>
        </g>
      </svg>
    `),
  },
];

const STORAGE_KEY_PREFIX = 'umbras_pass_custom_cards_tokens_v1';
export const CUSTOM_CARDS_TOKENS_UPDATED_EVENT = 'umbras:custom-cards-tokens-updated';

export function normalizeCardLookupKey(cardName: string): string {
  return (cardName || '').trim().toLowerCase();
}

export function createDefaultCustomCardTokenPreferences(): CustomCardTokenPreferences {
  return {
    cardProxies: {},
    customTokens: BUILTIN_TOKEN_ART_PRESETS.slice(0, 6).map((p) => ({
      id: `tok_${p.id}`,
      name: p.defaultTokenName,
      kind: p.kind,
      power: p.power,
      toughness: p.toughness,
      keywords: [...p.keywords],
      tokenAbility: p.tokenAbility,
      customImageUrl: p.imageUri,
      frameStyle: 'standard',
      updatedAt: new Date().toISOString(),
    })),
    updatedAt: new Date().toISOString(),
  };
}

function getScopedKey(userScope?: string): string {
  const clean = (userScope || '').trim().toLowerCase();
  return clean ? `${STORAGE_KEY_PREFIX}:${clean}` : STORAGE_KEY_PREFIX;
}

export function loadCustomCardTokenPreferences(
  userScope?: string
): CustomCardTokenPreferences {
  const fallback = createDefaultCustomCardTokenPreferences();
  if (typeof window === 'undefined') return fallback;

  try {
    const raw =
      window.localStorage.getItem(getScopedKey(userScope)) ||
      window.localStorage.getItem(STORAGE_KEY_PREFIX);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<CustomCardTokenPreferences>;
    if (!parsed || typeof parsed !== 'object') return fallback;

    const cleanProxies: Record<string, CustomCardProxyEntry> = {};
    if (parsed.cardProxies && typeof parsed.cardProxies === 'object') {
      for (const [k, entry] of Object.entries(parsed.cardProxies)) {
        if (!entry || !entry.cardName) continue;
        const safeUrl = isValidPlaymatImageUrl(entry.customImageUrl)
          ? entry.customImageUrl.trim()
          : '';
        cleanProxies[normalizeCardLookupKey(k)] = {
          id: entry.id || `prx_${Date.now()}`,
          cardName: entry.cardName.trim(),
          displayTitle: entry.displayTitle?.trim() || undefined,
          customImageUrl: safeUrl,
          isFullProxy: Boolean(entry.isFullProxy),
          manaCost: entry.manaCost,
          cmc: typeof entry.cmc === 'number' ? entry.cmc : undefined,
          typeLine: entry.typeLine,
          oracleText: entry.oracleText,
          power: entry.power,
          toughness: entry.toughness,
          frameStyle:
            entry.frameStyle === 'full-art' ||
            entry.frameStyle === 'retro' ||
            entry.frameStyle === 'gold-foil'
              ? entry.frameStyle
              : 'standard',
          proxyBadgeLabel:
            entry.proxyBadgeLabel === 'PROXY' ||
            entry.proxyBadgeLabel === 'PLAYTEST'
              ? entry.proxyBadgeLabel
              : 'ALT ART',
          updatedAt: entry.updatedAt || new Date().toISOString(),
        };
      }
    }

    const cleanTokens: CustomTokenVisualEntry[] = Array.isArray(parsed.customTokens)
      ? parsed.customTokens
          .filter((t) => t && typeof t.name === 'string' && t.name.trim())
          .map((t, idx) => ({
            id: t.id || `tok_custom_${idx}`,
            name: t.name.trim(),
            kind:
              t.kind === 'artifact' || t.kind === 'enchantment'
                ? t.kind
                : 'creature',
            power: Number(t.power) || 0,
            toughness: Number(t.toughness) || 0,
            keywords: Array.isArray(t.keywords) ? t.keywords : [],
            tokenAbility:
              t.tokenAbility === 'treasure' ||
              t.tokenAbility === 'food' ||
              t.tokenAbility === 'clue' ||
              t.tokenAbility === 'blood'
                ? t.tokenAbility
                : 'none',
            customImageUrl: isValidPlaymatImageUrl(t.customImageUrl)
              ? t.customImageUrl.trim()
              : BUILTIN_TOKEN_ART_PRESETS[0].imageUri,
            frameStyle:
              t.frameStyle === 'full-art' ||
              t.frameStyle === 'retro' ||
              t.frameStyle === 'gold-foil'
                ? t.frameStyle
                : 'standard',
            updatedAt: t.updatedAt || new Date().toISOString(),
          }))
      : fallback.customTokens;

    return {
      cardProxies: cleanProxies,
      customTokens: cleanTokens.length > 0 ? cleanTokens : fallback.customTokens,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return fallback;
  }
}

export function saveCustomCardTokenPreferences(
  prefs: CustomCardTokenPreferences,
  userScope?: string
): void {
  if (typeof window === 'undefined') return;
  const stamped: CustomCardTokenPreferences = {
    ...prefs,
    updatedAt: new Date().toISOString(),
  };
  try {
    const serialized = JSON.stringify(stamped);
    window.localStorage.setItem(STORAGE_KEY_PREFIX, serialized);
    if (userScope) {
      window.localStorage.setItem(getScopedKey(userScope), serialized);
    }
    window.dispatchEvent(
      new CustomEvent(CUSTOM_CARDS_TOKENS_UPDATED_EVENT, { detail: stamped })
    );
  } catch {
    // Ignore storage quota issues
  }
}

export function getScryfallFallbackImageUri(cardName: string): string {
  const raw = (cardName || '').trim();
  if (!raw) return '';
  const frontFace = raw
    .split('//')[0]
    .replace(/\s+—.*$/, '')
    .replace(/\s*\([A-Z0-9]{2,6}\)\s*\d*$/i, '')
    .replace(/\s+token$/i, '')
    .trim();
  if (!frontFace) return '';
  return `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(frontFace)}&format=image&version=normal`;
}

export function resolveCardWithCustomProxy(
  cardName: string,
  baseMeta: CardMetadata | null,
  prefs?: CustomCardTokenPreferences
): {
  meta: CardMetadata | null;
  proxyEntry: CustomCardProxyEntry | null;
  displayTitle: string;
  badgeLabel?: string;
  frameStyle: CustomCardFrameStyle;
} {
  const activePrefs = prefs || loadCustomCardTokenPreferences();
  const key = normalizeCardLookupKey(cardName);
  const proxy = activePrefs.cardProxies[key] || null;

  if (!proxy) {
    // Also check if this card matches a custom token name when baseMeta lacks an image
    if (!baseMeta?.imageUri) {
      const isExplicitToken = /\btoken\b/i.test(cardName) || /\btoken\b/i.test(baseMeta?.typeLine || '');
      const cleanTokenName = key.replace(/\s+token$/i, '').trim();
      const matchingTok = activePrefs.customTokens.find(
        (t) => normalizeCardLookupKey(t.name) === cleanTokenName
      );
      if (matchingTok && matchingTok.customImageUrl && (isExplicitToken || !baseMeta)) {
        return {
          meta: baseMeta
            ? { ...baseMeta, imageUri: matchingTok.customImageUrl }
            : {
                name: cardName,
                manaCost: '',
                cmc: 0,
                typeLine:
                  matchingTok.kind === 'creature'
                    ? 'Token Creature'
                    : `Token ${matchingTok.kind}`,
                oracleText: matchingTok.keywords.join(', '),
                colors: [],
                colorIdentity: [],
                producedMana: [],
                isLand: false,
                isMdfcLand: false,
                entersTappedLikely: false,
                isRamp: matchingTok.tokenAbility === 'treasure',
                isDraw: matchingTok.tokenAbility === 'clue',
                isRemoval: false,
                isBoardWipe: false,
                isProtection: false,
                imageUri: matchingTok.customImageUrl,
                power:
                  matchingTok.kind === 'creature'
                    ? String(matchingTok.power)
                    : undefined,
                toughness:
                  matchingTok.kind === 'creature'
                    ? String(matchingTok.toughness)
                    : undefined,
                priceUsd: null,
                scryfallUri: '',
                legalInFormat: true,
                rarity: 'common',
              },
          proxyEntry: null,
          displayTitle: cardName,
          frameStyle: matchingTok.frameStyle,
        };
      }

      const fallbackImg = getScryfallFallbackImageUri(cardName);
      if (fallbackImg) {
        return {
          meta: baseMeta
            ? { ...baseMeta, imageUri: fallbackImg }
            : {
                name: cardName,
                manaCost: '',
                cmc: 0,
                typeLine: 'Card',
                oracleText: '',
                colors: [],
                colorIdentity: [],
                producedMana: [],
                isLand: /\b(plains|island|swamp|mountain|forest|wastes|land)\b/i.test(cardName),
                isMdfcLand: false,
                entersTappedLikely: false,
                isRamp: false,
                isDraw: false,
                isRemoval: false,
                isBoardWipe: false,
                isProtection: false,
                imageUri: fallbackImg,
                priceUsd: null,
                scryfallUri: `https://scryfall.com/search?q=!"${encodeURIComponent(cardName)}"`,
                legalInFormat: true,
                rarity: 'common',
              },
          proxyEntry: null,
          displayTitle: cardName,
          frameStyle: 'standard',
        };
      }
    }

    return {
      meta: baseMeta,
      proxyEntry: null,
      displayTitle: cardName,
      frameStyle: 'standard',
    };
  }

  const effectiveImage =
    proxy.customImageUrl ||
    baseMeta?.imageUri ||
    getScryfallFallbackImageUri(cardName) ||
    BUILTIN_TOKEN_ART_PRESETS[BUILTIN_TOKEN_ART_PRESETS.length - 1].imageUri;

  const mergedMeta: CardMetadata = {
    name: proxy.cardName,
    manaCost: proxy.isFullProxy
      ? proxy.manaCost ?? baseMeta?.manaCost ?? ''
      : baseMeta?.manaCost ?? '',
    cmc: proxy.isFullProxy
      ? proxy.cmc ?? baseMeta?.cmc ?? 0
      : baseMeta?.cmc ?? 0,
    typeLine: proxy.isFullProxy
      ? proxy.typeLine || baseMeta?.typeLine || 'Spell'
      : baseMeta?.typeLine || 'Card',
    oracleText: proxy.isFullProxy
      ? proxy.oracleText ?? baseMeta?.oracleText ?? ''
      : baseMeta?.oracleText ?? '',
    colors: baseMeta?.colors || [],
    colorIdentity: baseMeta?.colorIdentity || [],
    producedMana: baseMeta?.producedMana || [],
    isLand: (proxy.typeLine || baseMeta?.typeLine || '')
      .toLowerCase()
      .includes('land'),
    isMdfcLand: baseMeta?.isMdfcLand || false,
    entersTappedLikely: baseMeta?.entersTappedLikely || false,
    isRamp: baseMeta?.isRamp || false,
    isDraw: baseMeta?.isDraw || false,
    isRemoval: baseMeta?.isRemoval || false,
    isBoardWipe: baseMeta?.isBoardWipe || false,
    isProtection: baseMeta?.isProtection || false,
    imageUri: effectiveImage,
    power: proxy.isFullProxy
      ? proxy.power ?? baseMeta?.power
      : baseMeta?.power,
    toughness: proxy.isFullProxy
      ? proxy.toughness ?? baseMeta?.toughness
      : baseMeta?.toughness,
    priceUsd: baseMeta?.priceUsd ?? null,
    scryfallUri: baseMeta?.scryfallUri || '',
    legalInFormat: baseMeta?.legalInFormat ?? true,
    rarity: baseMeta?.rarity || 'rare',
  };

  return {
    meta: mergedMeta,
    proxyEntry: proxy,
    displayTitle: proxy.displayTitle || cardName,
    badgeLabel: proxy.proxyBadgeLabel,
    frameStyle: proxy.frameStyle,
  };
}

export function resolveCustomTokenVisual(
  tokenName: string,
  prefs?: CustomCardTokenPreferences
): CustomTokenVisualEntry | null {
  const activePrefs = prefs || loadCustomCardTokenPreferences();
  const key = normalizeCardLookupKey(tokenName).replace(/\s+token$/i, '').trim();
  const found = activePrefs.customTokens.find(
    (t) => normalizeCardLookupKey(t.name) === key
  );
  if (found) return found;

  const preset = BUILTIN_TOKEN_ART_PRESETS.find(
    (p) => normalizeCardLookupKey(p.defaultTokenName) === key
  );
  if (preset) {
    return {
      id: preset.id,
      name: preset.defaultTokenName,
      kind: preset.kind,
      power: preset.power,
      toughness: preset.toughness,
      keywords: preset.keywords,
      tokenAbility: preset.tokenAbility,
      customImageUrl: preset.imageUri,
      frameStyle: 'standard',
      updatedAt: '',
    };
  }
  return null;
}

/**
 * Applies the user's custom card art overrides & full playtest proxies
 * to their MultiplayerDeckSummary so all connected players see their custom images & proxies.
 */
export function applyUserProxiesToMultiplayerDeck(
  baseDeck: MultiplayerDeckSummary,
  prefs: CustomCardTokenPreferences
): MultiplayerDeckSummary {
  const updatedCards = baseDeck.cards.map((card) => {
    const key = normalizeCardLookupKey(card.name);
    const proxy = prefs.cardProxies[key];
    if (!proxy) return card;

    return {
      ...card,
      imageUri: proxy.customImageUrl || card.imageUri,
      typeLine: proxy.isFullProxy ? proxy.typeLine || card.typeLine : card.typeLine,
      manaCost: proxy.isFullProxy ? proxy.manaCost ?? card.manaCost : card.manaCost,
      cmc: proxy.isFullProxy ? proxy.cmc ?? card.cmc : card.cmc,
      oracleText: proxy.isFullProxy
        ? proxy.oracleText ?? card.oracleText
        : card.oracleText,
      power: proxy.isFullProxy ? proxy.power ?? card.power : card.power,
      toughness: proxy.isFullProxy
        ? proxy.toughness ?? card.toughness
        : card.toughness,
      displayTitle: proxy.displayTitle,
      isProxy: proxy.isFullProxy,
      proxyBadgeLabel: proxy.proxyBadgeLabel,
      frameStyle: proxy.frameStyle,
    };
  });

  // Also include any standalone full-proxy cards that the user marked to include or added
  return {
    ...baseDeck,
    cards: updatedCards,
  };
}
