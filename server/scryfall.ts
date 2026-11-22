import type {
  CardMetadata,
  ColorBreakdownItem,
  CurveBucket,
  DeckFormat,
  DeckMetrics,
  ManaColor,
  ParsedCardEntry,
  ResolvedDeckCard,
} from '../src/types/deck.ts';
import {
  addMapCardCount,
  consolidateResolvedDeckCards,
  detectFormatFromParsedCards,
  getMaxCopiesForCard,
  getTargetDeckSizeForFormat,
  isRestrictedCardInFormat,
  isSameCardName,
} from '../src/utils/deckRules.ts';
import {
  buildMarketplaceUrls,
  ensureCardKingdomIndex,
  getCardKingdomRecord,
} from './marketplace.ts';
import {
  loadPersistedScryfallCache,
  scheduleSaveScryfallCache,
} from './desktopStorage.ts';

interface ScryfallFace {
  name?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  power?: string;
  toughness?: string;
  image_uris?: { normal?: string; large?: string; small?: string };
}

interface ScryfallCard {
  id?: string;
  name: string;
  set?: string;
  set_name?: string;
  collector_number?: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  color_identity?: string[];
  produced_mana?: string[];
  legalities?: Record<string, string>;
  prices?: {
    usd?: string | null;
    usd_foil?: string | null;
    eur?: string | null;
    tix?: string | null;
  };
  purchase_uris?: {
    tcgplayer?: string;
    cardmarket?: string;
    cardhoarder?: string;
  };
  rarity?: string;
  scryfall_uri?: string;
  image_uris?: { normal?: string; large?: string; small?: string };
  card_faces?: Array<ScryfallFace & { flavor_name?: string; printed_name?: string }>;
  flavor_name?: string;
  printed_name?: string;
  layout?: string;
}

export const MAX_CARD_CACHE_ENTRIES = 1500;
const cardCache = new Map<string, ScryfallCard>();

const USED_LEGALITY_KEYS = [
  'commander',
  'brawl',
  'standardbrawl',
  'standard',
  'modern',
  'pioneer',
  'pauper',
  'legacy',
  'vintage',
] as const;

function compactScryfallCard(raw: ScryfallCard): ScryfallCard {
  const compactLegalities: Record<string, string> | undefined = raw.legalities
    ? (() => {
        const out: Record<string, string> = {};
        for (const k of USED_LEGALITY_KEYS) {
          if (raw.legalities?.[k]) out[k] = raw.legalities[k];
        }
        return out;
      })()
    : undefined;

  const compactFaces = Array.isArray(raw.card_faces)
    ? raw.card_faces.map((f) => ({
        name: f.name,
        mana_cost: f.mana_cost,
        type_line: f.type_line,
        oracle_text: f.oracle_text,
        colors: f.colors,
        power: f.power,
        toughness: f.toughness,
        flavor_name: f.flavor_name,
        printed_name: f.printed_name,
        image_uris: f.image_uris
          ? {
              normal: f.image_uris.normal,
              large: f.image_uris.normal ? undefined : f.image_uris.large,
            }
          : undefined,
      }))
    : undefined;

  return {
    id: raw.id,
    name: raw.name,
    set: raw.set,
    set_name: raw.set_name,
    collector_number: raw.collector_number,
    mana_cost: raw.mana_cost,
    cmc: raw.cmc,
    type_line: raw.type_line,
    oracle_text: raw.oracle_text,
    power: raw.power,
    toughness: raw.toughness,
    colors: raw.colors,
    color_identity: raw.color_identity,
    produced_mana: raw.produced_mana,
    legalities: compactLegalities,
    prices: raw.prices
      ? {
          usd: raw.prices.usd ?? null,
          usd_foil: raw.prices.usd_foil ?? null,
          eur: raw.prices.eur ?? null,
          tix: raw.prices.tix ?? null,
        }
      : undefined,
    purchase_uris: raw.purchase_uris
      ? {
          tcgplayer: raw.purchase_uris.tcgplayer,
          cardmarket: raw.purchase_uris.cardmarket,
          cardhoarder: raw.purchase_uris.cardhoarder,
        }
      : undefined,
    rarity: raw.rarity,
    scryfall_uri: raw.scryfall_uri,
    image_uris: raw.image_uris
      ? {
          normal: raw.image_uris.normal,
          large: raw.image_uris.normal ? undefined : raw.image_uris.large,
        }
      : undefined,
    card_faces: compactFaces,
    flavor_name: raw.flavor_name,
    printed_name: raw.printed_name,
    layout: raw.layout,
  };
}

export function setCardCacheEntry(key: string, card: ScryfallCard): void {
  if (!key) return;
  if (cardCache.has(key)) {
    cardCache.delete(key);
  } else if (cardCache.size >= MAX_CARD_CACHE_ENTRIES) {
    const oldestKey = cardCache.keys().next().value;
    if (oldestKey !== undefined) {
      cardCache.delete(oldestKey);
    }
  }
  cardCache.set(key, card);
}

function getCardCacheEntry(key: string): ScryfallCard | undefined {
  const hit = cardCache.get(key);
  if (hit) {
    cardCache.delete(key);
    cardCache.set(key, hit);
  }
  return hit;
}

export function getCardCacheSize(): number {
  return cardCache.size;
}

const persistedScryfall = loadPersistedScryfallCache();
for (const [k, v] of Object.entries(persistedScryfall)) {
  if (v && typeof v === 'object' && typeof (v as ScryfallCard).name === 'string') {
    setCardCacheEntry(k, compactScryfallCard(v as ScryfallCard));
  }
}

function normalizeKey(name: string | undefined | null): string {
  return (typeof name === 'string' ? name : '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function buildScryfallHeaders(jsonBody = false): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'UmbrasPass/1.0',
  };
  if (jsonBody) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

function cacheScryfallCard(rawCard: ScryfallCard, queriedName?: string): void {
  if (!rawCard?.name) return;
  const card = compactScryfallCard(rawCard);
  setCardCacheEntry(normalizeKey(card.name), card);
  if (card.flavor_name) {
    setCardCacheEntry(normalizeKey(card.flavor_name), card);
  }
  if (card.printed_name) {
    setCardCacheEntry(normalizeKey(card.printed_name), card);
  }
  if (card.name.includes(' // ')) {
    const [frontName, backName] = card.name.split(' // ');
    if (frontName) setCardCacheEntry(normalizeKey(frontName), card);
    if (backName) setCardCacheEntry(normalizeKey(backName), card);
    setCardCacheEntry(normalizeKey(card.name.replace(' // ', ' / ')), card);
  }
  for (const face of card.card_faces || []) {
    if (face.flavor_name) setCardCacheEntry(normalizeKey(face.flavor_name), card);
    if (face.printed_name) setCardCacheEntry(normalizeKey(face.printed_name), card);
  }
  if (queriedName) {
    setCardCacheEntry(normalizeKey(queriedName), card);
  }
}

function toScryfallQueryName(name: string): string {
  let cleaned = (typeof name === 'string' ? name : '')
    .replace(/[\uFEFF\u200B-\u200D]/g, '')
    .replace(/[\u00A0\u2009\u202F\t]+/g, ' ')
    .replace(/\*[A-Za-z0-9-]+\*/g, ' ')
    .replace(/\s+\(([A-Za-z0-9]{2,6})\)\s+(?:[0-9]+[A-Za-z0-9-]*|[A-Za-z0-9]{2,5}-[A-Za-z0-9-]+)(?:\s+.*)?$/i, '')
    .replace(/\s+\(([A-Za-z0-9]{2,6})\)\s*(?:[A-Za-z0-9-]+)?\s*[★†☆✦✧※*]?\s*$/i, '')
    .replace(/\s*\[([A-Za-z0-9]{2,6})(?::[A-Za-z0-9-]+)?\]\s*(?:[A-Za-z0-9-]+)?\s*[★†☆✦✧※*]?\s*$/i, '')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/[★†☆✦✧※]+$/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/\s+\/\s+/g, ' // ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    cleaned = (typeof name === 'string' ? name : '').replace(/\s+\/\s+/g, ' // ').trim();
  }
  return cleaned;
}

async function fetchScryfallSingleCard(rawName: string): Promise<ScryfallCard | null> {
  const queryName = toScryfallQueryName(rawName);
  const candidates = queryName.includes(' // ')
    ? [queryName, queryName.split(' // ')[0].trim()]
    : [queryName];

  for (const candidate of candidates) {
    if (!candidate) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fuzzyRes = await fetch(
          `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(candidate)}`,
          {
            headers: buildScryfallHeaders(false),
            signal: AbortSignal.timeout(8000),
          }
        );
        if (fuzzyRes.ok) {
          const card = (await fuzzyRes.json()) as ScryfallCard;
          cacheScryfallCard(card, rawName);
          if (queryName !== rawName) {
            cacheScryfallCard(card, queryName);
          }
          return card;
        }
        if ((fuzzyRes.status === 429 || fuzzyRes.status >= 500) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 450));
          continue;
        }
        break;
      } catch {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
      }
    }
  }
  return null;
}

function mapScryfallToMetadata(raw: ScryfallCard, format: Exclude<DeckFormat, 'auto'>): CardMetadata {
  const face0 = raw.card_faces?.[0];
  const face1 = raw.card_faces?.[1];
  const typeLine = raw.type_line || face0?.type_line || '';
  const frontType = face0?.type_line || typeLine;
  const backType = face1?.type_line || '';
  const manaCost = raw.mana_cost ?? face0?.mana_cost ?? '';
  const oracleText = raw.oracle_text ?? raw.card_faces?.map((f) => f.oracle_text || '').join('\n') ?? '';
  const oracleLower = oracleText.toLowerCase();
  const typeLower = typeLine.toLowerCase();

  const isFrontLand = /\bland\b/i.test(frontType);
  const isBackLand = /\bland\b/i.test(backType);
  const isLand = isFrontLand || /\bland\b/i.test(typeLine.split('//')[0] || '');
  const isMdfcLand = !isFrontLand && isBackLand;

  const entersTappedLikely =
    (isLand || isMdfcLand) &&
    (oracleLower.includes('enters tapped') ||
      oracleLower.includes('enters the battlefield tapped')) &&
    !oracleLower.includes('unless') &&
    !oracleLower.includes('you may pay 2 life');

  const isRamp =
    !isLand &&
    (oracleLower.includes('add {') ||
      oracleLower.includes('add one mana') ||
      oracleLower.includes('add two mana') ||
      oracleLower.includes('add three mana') ||
      oracleLower.includes('search your library for a basic land') ||
      oracleLower.includes('search your library for a land') ||
      oracleLower.includes('search your library for up to two basic land') ||
      oracleLower.includes('create a treasure token') ||
      oracleLower.includes('create two treasure tokens'));

  const isDraw =
    !isLand &&
    (oracleLower.includes('draw a card') ||
      oracleLower.includes('draw two cards') ||
      oracleLower.includes('draw three cards') ||
      oracleLower.includes('draw x cards') ||
      oracleLower.includes('draw cards equal') ||
      oracleLower.includes('look at the top') && oracleLower.includes('into your hand'));

  const isBoardWipe =
    !isLand &&
    (oracleLower.includes('destroy all ') ||
      oracleLower.includes('exile all ') ||
      oracleLower.includes('all creatures get -') ||
      (oracleLower.includes('each creature') && oracleLower.includes('damage')));

  const isRemoval =
    !isLand &&
    !isBoardWipe &&
    (oracleLower.includes('destroy target') ||
      oracleLower.includes('exile target') ||
      oracleLower.includes('deals ') && oracleLower.includes('damage to target') ||
      oracleLower.includes('return target') && oracleLower.includes('to its owner') ||
      oracleLower.includes('target creature gets -') ||
      oracleLower.includes('counter target'));

  const isProtection =
    !isLand &&
    (oracleLower.includes('counter target') ||
      oracleLower.includes('hexproof') ||
      oracleLower.includes('indestructible') ||
      oracleLower.includes('phase out'));

  const imageUri =
    raw.image_uris?.normal ||
    raw.image_uris?.large ||
    face0?.image_uris?.normal ||
    face0?.image_uris?.large ||
    '';

  const backImageUri = face1?.image_uris?.normal || face1?.image_uris?.large;
  const priceNum = raw.prices?.usd ? parseFloat(raw.prices.usd) : null;
  const priceFoilNum = raw.prices?.usd_foil ? parseFloat(raw.prices.usd_foil) : null;
  const priceEurNum = raw.prices?.eur ? parseFloat(raw.prices.eur) : null;
  const priceTixNum = raw.prices?.tix ? parseFloat(raw.prices.tix) : null;
  const ck = getCardKingdomRecord(raw.id, raw.name);
  const marketUrls = buildMarketplaceUrls(raw.name, raw.set_name, raw.purchase_uris);

  let legalInFormat = true;
  let restrictedInFormat = false;
  let standardBrawlLegal: boolean | undefined;
  if (format !== 'casual60' && format !== 'limited') {
    const legKey = format === 'commander' ? 'commander' : format;
    const status = raw.legalities?.[legKey];
    if (status && status !== 'legal' && status !== 'restricted') {
      legalInFormat = false;
    }
    if (status === 'restricted') {
      restrictedInFormat = true;
    }
    if (format === 'brawl') {
      const stdBrawlStatus = raw.legalities?.['standardbrawl'];
      if (stdBrawlStatus) {
        standardBrawlLegal = stdBrawlStatus === 'legal' || stdBrawlStatus === 'restricted';
      }
    }
  }

  // Basic/staple land mana production fallback if produced_mana isn't set
  const producedMana = raw.produced_mana ? [...raw.produced_mana] : [];
  if ((isLand || isMdfcLand) && producedMana.length === 0) {
    if (typeLower.includes('plains') || oracleLower.includes('{w}')) producedMana.push('W');
    if (typeLower.includes('island') || oracleLower.includes('{u}')) producedMana.push('U');
    if (typeLower.includes('swamp') || oracleLower.includes('{b}')) producedMana.push('B');
    if (typeLower.includes('mountain') || oracleLower.includes('{r}')) producedMana.push('R');
    if (typeLower.includes('forest') || oracleLower.includes('{g}')) producedMana.push('G');
    if (oracleLower.includes('mana of any color') || oracleLower.includes('any type')) {
      producedMana.push('W', 'U', 'B', 'R', 'G');
    }
    // Fetchlands check
    if (oracleLower.includes('search your library for a') && oracleLower.includes('land')) {
      if (oracleLower.includes('plains')) producedMana.push('W');
      if (oracleLower.includes('island')) producedMana.push('U');
      if (oracleLower.includes('swamp')) producedMana.push('B');
      if (oracleLower.includes('mountain')) producedMana.push('R');
      if (oracleLower.includes('forest')) producedMana.push('G');
      if (oracleLower.includes('basic land')) producedMana.push('W', 'U', 'B', 'R', 'G');
    }
  }

  // Also check "mana of any color" on lands/rocks even when produced_mana is partial
  if ((isLand || isRamp) && (oracleLower.includes('any color') || oracleLower.includes('any one color'))) {
    for (const c of ['W', 'U', 'B', 'R', 'G']) {
      if (!producedMana.includes(c)) producedMana.push(c);
    }
  }

  return {
    name: raw.name,
    manaCost,
    cmc: typeof raw.cmc === 'number' ? raw.cmc : 0,
    typeLine,
    oracleText,
    colors: raw.colors ?? face0?.colors ?? [],
    colorIdentity: raw.color_identity ?? [],
    producedMana: Array.from(new Set(producedMana)),
    isLand,
    isMdfcLand,
    entersTappedLikely,
    isRamp,
    isDraw,
    isRemoval,
    isBoardWipe,
    isProtection,
    power: raw.power ?? face0?.power,
    toughness: raw.toughness ?? face0?.toughness,
    imageUri,
    backImageUri,
    priceUsd: priceNum !== null && !isNaN(priceNum) ? priceNum : null,
    priceFoilUsd: priceFoilNum !== null && !isNaN(priceFoilNum) ? priceFoilNum : null,
    priceEur: priceEurNum !== null && !isNaN(priceEurNum) ? priceEurNum : null,
    priceTix: priceTixNum !== null && !isNaN(priceTixNum) ? priceTixNum : null,
    cardKingdomPriceUsd: ck?.nonFoilUsd ?? null,
    cardKingdomUrl: ck?.url || marketUrls.cardKingdom,
    tcgplayerUrl: marketUrls.tcgplayer,
    cardmarketUrl: marketUrls.cardmarket,
    cardhoarderUrl: marketUrls.cardhoarder,
    ebayUrl: marketUrls.ebayListings,
    setCode: raw.set ? raw.set.toUpperCase() : undefined,
    setName: raw.set_name,
    collectorNumber: raw.collector_number,
    scryfallUri: raw.scryfall_uri || `https://scryfall.com/search?q=${encodeURIComponent(raw.name)}`,
    legalInFormat,
    restrictedInFormat,
    standardBrawlLegal,
    rarity: raw.rarity || 'common',
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

export async function resolveCardNamesWithScryfall(
  names: string[],
  format: Exclude<DeckFormat, 'auto'> = 'commander',
  options?: { skipMarketPrices?: boolean }
): Promise<Map<string, CardMetadata>> {
  const uniqueNames = Array.from(
    new Set(
      (Array.isArray(names) ? names : [])
        .filter((n): n is string => typeof n === 'string')
        .map((n) => n.trim())
        .filter(Boolean)
    )
  );
  const missingNames: string[] = [];

  for (const name of uniqueNames) {
    const direct = getCardCacheEntry(normalizeKey(name));
    if (direct) continue;
    const queryCached = getCardCacheEntry(normalizeKey(toScryfallQueryName(name)));
    if (queryCached) {
      setCardCacheEntry(normalizeKey(name), queryCached);
      continue;
    }
    missingNames.push(name);
  }

  // Warm Card Kingdom pricelist cache opportunistically with a brief cap so analysis never stalls on slow networks
  if (!options?.skipMarketPrices && uniqueNames.length > 0) {
    await Promise.race([
      ensureCardKingdomIndex(),
      new Promise((resolve) => setTimeout(resolve, 1200)),
    ]);
  }

  // Batch fetch up to 75 per Scryfall collection request
  for (let i = 0; i < missingNames.length; i += 75) {
    const batch = missingNames.slice(i, i + 75);
    const identifiers = batch.map((name) => ({ name: toScryfallQueryName(name) }));

    let batchResolved = false;
    for (let attempt = 0; attempt < 2 && !batchResolved; attempt++) {
      try {
        const res = await fetch('https://api.scryfall.com/cards/collection', {
          method: 'POST',
          headers: buildScryfallHeaders(true),
          body: JSON.stringify({ identifiers }),
          signal: AbortSignal.timeout(12000),
        });

        if (res.ok) {
          batchResolved = true;
          const payload = (await res.json()) as {
            data?: ScryfallCard[];
            not_found?: Array<{ name?: string }>;
          };

          for (const card of payload.data || []) {
            cacheScryfallCard(card);
          }

          // Match back any batch entries whose queried name normalized slightly differently from Scryfall canonical name
          const notFoundNames = new Set(
            (payload.not_found || [])
              .map((nf) => (nf?.name ? normalizeKey(nf.name) : ''))
              .filter(Boolean)
          );
          for (const reqName of batch) {
            const key = normalizeKey(reqName);
            const qKey = normalizeKey(toScryfallQueryName(reqName));
            if (cardCache.has(key)) continue;
            const qCached = getCardCacheEntry(qKey);
            if (qCached) {
              setCardCacheEntry(key, qCached);
              continue;
            }
            if (!notFoundNames.has(qKey) && !notFoundNames.has(key)) {
              const matched = (payload.data || []).find((card) => {
                const cKey = normalizeKey(card.name);
                return (
                  cKey === key ||
                  cKey === qKey ||
                  cKey.startsWith(`${key} // `) ||
                  cKey.startsWith(`${qKey} // `)
                );
              });
              if (matched) {
                cacheScryfallCard(matched, reqName);
              }
            }
          }

          // Fuzzy fallback for any not_found cards using polite bounded concurrency (~10 req/s Scryfall limit)
          const notFound = (payload.not_found || []).filter(
            (nf): nf is { name: string } => typeof nf?.name === 'string' && nf.name.length > 0
          );
          if (notFound.length > 0) {
            await runWithConcurrency(notFound, 2, async (nf, idx) => {
              if (idx >= 2) {
                await new Promise((r) => setTimeout(r, 110));
              }
              await fetchScryfallSingleCard(nf.name);
            });
          }
        } else if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 450));
        } else {
          break;
        }
      } catch {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 350));
        }
      }
    }

    // If the entire batch request failed (e.g. transient HTTP error), fall back with bounded concurrency
    if (!batchResolved) {
      const unresolvedInBatch = batch.filter(
        (cardName) =>
          !cardCache.has(normalizeKey(cardName)) &&
          !cardCache.has(normalizeKey(toScryfallQueryName(cardName)))
      );
      await runWithConcurrency(unresolvedInBatch, 2, async (cardName, idx) => {
        if (idx >= 2) {
          await new Promise((r) => setTimeout(r, 110));
        }
        await fetchScryfallSingleCard(cardName);
      });
    }
  }

  if (missingNames.length > 0 && cardCache.size > 0) {
    scheduleSaveScryfallCache(cardCache);
  }

  const result = new Map<string, CardMetadata>();
  for (const name of uniqueNames) {
    const key = normalizeKey(name);
    const cached =
      getCardCacheEntry(key) || getCardCacheEntry(normalizeKey(toScryfallQueryName(name)));
    if (cached) {
      result.set(key, mapScryfallToMetadata(cached, format));
    }
  }
  return result;
}

export function detectFormat(entries: ParsedCardEntry[], requestedFormat: DeckFormat): Exclude<DeckFormat, 'auto'> {
  return detectFormatFromParsedCards(entries, requestedFormat);
}

function countPips(manaCost: string): Record<ManaColor, number> {
  const counts: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  if (!manaCost) return counts;
  const tokens = manaCost.match(/\{([^}]+)\}/g) || [];
  for (const token of tokens) {
    const inner = token.slice(1, -1).toUpperCase();
    if (inner === 'W') counts.W += 1;
    else if (inner === 'U') counts.U += 1;
    else if (inner === 'B') counts.B += 1;
    else if (inner === 'R') counts.R += 1;
    else if (inner === 'G') counts.G += 1;
    else if (inner === 'C') counts.C += 1;
    else if (inner.includes('/')) {
      // Hybrid or Phyrexian pips (e.g. W/U, G/P)
      for (const part of inner.split('/')) {
        if (part === 'W') counts.W += 0.5;
        else if (part === 'U') counts.U += 0.5;
        else if (part === 'B') counts.B += 0.5;
        else if (part === 'R') counts.R += 0.5;
        else if (part === 'G') counts.G += 0.5;
      }
    }
  }
  return counts;
}

const COLOR_LABELS: Record<ManaColor, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};

const BASIC_LAND_NAMES = new Set([
  'plains',
  'island',
  'swamp',
  'mountain',
  'forest',
  'wastes',
  'snow-covered plains',
  'snow-covered island',
  'snow-covered swamp',
  'snow-covered mountain',
  'snow-covered forest',
]);

function isEligibleCommanderMeta(
  meta: CardMetadata | null,
  format: Exclude<DeckFormat, 'auto'>
): boolean {
  if (!meta || meta.isLand) return false;
  const tl = meta.typeLine || '';
  const ot = meta.oracleText || '';
  if (/can be your commander/i.test(ot)) return true;
  if (!/\blegendary\b/i.test(tl)) return false;
  if (/\b(?:creature|vehicle|spacecraft|background)\b/i.test(tl)) return true;
  if (format === 'brawl' && /\bplaneswalker\b/i.test(tl)) return true;
  return false;
}

function canPairPartner(metaA: CardMetadata | null, metaB: CardMetadata | null): boolean {
  if (!metaA || !metaB) return false;
  const otA = metaA.oracleText || '';
  const otB = metaB.oracleText || '';
  const tlB = metaB.typeLine || '';
  if (/\bpartner\b/i.test(otA) && /\bpartner\b/i.test(otB)) return true;
  if (/\bchoose a background\b/i.test(otA) && /\bbackground\b/i.test(tlB)) return true;
  if (/\bfriends forever\b/i.test(otA) && /\bfriends forever\b/i.test(otB)) return true;
  if (/\bdoctor's companion\b/i.test(otB) && /\btime lord doctor\b/i.test(metaA.typeLine || '')) return true;
  if (/\bdoctor's companion\b/i.test(otA) && /\btime lord doctor\b/i.test(tlB)) return true;
  return false;
}

export function autoRecognizeCommanders(
  resolvedCards: ResolvedDeckCard[],
  format: Exclude<DeckFormat, 'auto'>
): void {
  if (format !== 'commander' && format !== 'brawl') return;

  const mainCards = resolvedCards.filter((c) => c.zone === 'main');
  const sideboardCards = resolvedCards.filter((c) => c.zone === 'sideboard');
  const eligibleMainAndSideExists =
    mainCards.some((c) => c.quantity === 1 && isEligibleCommanderMeta(c.card, format)) ||
    sideboardCards.some((c) => c.quantity === 1 && isEligibleCommanderMeta(c.card, format));

  const existingCmds = resolvedCards.filter((c) => c.zone === 'commander');
  if (existingCmds.length > 0) {
    // Sanitize mis-classified non-commander cards (e.g. "1 Sol Ring" separated by a blank line at top of a plain .txt list)
    // whenever eligible legends exist OR when >2 cards were placed in commander zone.
    let kept = 0;
    for (const c of existingCmds) {
      const eligible = isEligibleCommanderMeta(c.card, format);
      const shouldDemote =
        (existingCmds.length > 2 && (!eligible || kept >= 2)) ||
        (c.card !== null && !eligible && (c.card.isLand || eligibleMainAndSideExists));
      if (shouldDemote) {
        c.zone = 'main';
      } else {
        kept++;
      }
    }
  }

  const currentCmds = resolvedCards.filter((c) => c.zone === 'commander');
  if (currentCmds.length > 0) return;

  // Common MTGO / MTGGoldfish / ManaBox EDH export puts the 1-2 Commander(s) in Sideboard alongside a 98-99 card main deck
  const mainQty = mainCards.reduce((s, c) => s + c.quantity, 0);
  const sideQty = sideboardCards.reduce((s, c) => s + c.quantity, 0);
  const eligibleSideCmds = sideboardCards.filter(
    (c) => c.quantity === 1 && isEligibleCommanderMeta(c.card, format)
  );
  if (
    eligibleSideCmds.length > 0 &&
    eligibleSideCmds.length <= 2 &&
    sideQty <= 2 &&
    mainQty >= 85 &&
    mainQty + sideQty <= 101
  ) {
    for (const c of eligibleSideCmds) {
      c.zone = 'commander';
    }
    return;
  }

  if (mainCards.length === 0) return;

  // Count how many non-land cards use each color so 1 stray card doesn't skew commander detection
  const colorCardCounts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const c of mainCards) {
    if (!c.card || c.card.isLand) continue;
    for (const col of c.card.colorIdentity || []) {
      if (col in colorCardCounts) {
        colorCardCounts[col] += c.quantity;
      }
    }
  }

  const deckColors = new Set<string>(
    Object.entries(colorCardCounts)
      .filter(([, count]) => count >= 2)
      .map(([col]) => col)
  );
  if (deckColors.size === 0) {
    for (const [col, count] of Object.entries(colorCardCounts)) {
      if (count > 0) deckColors.add(col);
    }
  }

  const candidates = mainCards.filter(
    (c) => c.quantity === 1 && isEligibleCommanderMeta(c.card, format)
  );
  if (candidates.length === 0) return;

  // Score candidates by how well their colorIdentity matches the deck's colors, penalizing extra unused colors
  const firstMain = mainCards[0];
  const secondMain = mainCards[1];
  const lastMain = mainCards[mainCards.length - 1];

  let bestCandidate = candidates[0];
  let bestScore = -9999;

  for (const cand of candidates) {
    const cid = new Set(cand.card?.colorIdentity || []);
    let covered = 0;
    for (const col of deckColors) {
      if (cid.has(col)) covered++;
    }
    let extraUnusedColors = 0;
    for (const col of cid) {
      if (!deckColors.has(col) && (colorCardCounts[col] || 0) === 0) {
        extraUnusedColors++;
      }
    }
    const coversAll = covered === deckColors.size ? 120 : 0;
    const exactMatchBonus =
      covered === deckColors.size && extraUnusedColors === 0 ? 60 : 0;
    const positionBonus =
      cand === firstMain ? 45 : cand === secondMain ? 30 : cand === lastMain ? 25 : 0;
    const score =
      coversAll +
      exactMatchBonus +
      covered * 25 -
      extraUnusedColors * 75 +
      positionBonus;
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = cand;
    }
  }

  bestCandidate.zone = 'commander';

  // If bestCandidate supports Partner / Background / Friends Forever, check if a valid partner is adjacent at top/bottom
  const partnerCandidate = candidates.find(
    (c) =>
      c !== bestCandidate &&
      (c === firstMain || c === secondMain || c === lastMain) &&
      canPairPartner(bestCandidate.card, c.card)
  );
  if (partnerCandidate) {
    partnerCandidate.zone = 'commander';
  }
}

export function computeDeckMetrics(
  entries: ParsedCardEntry[],
  resolvedMap: Map<string, CardMetadata>,
  format: Exclude<DeckFormat, 'auto'>
): { resolvedCards: ResolvedDeckCard[]; metrics: DeckMetrics } {
  const rawResolvedCards: ResolvedDeckCard[] = entries.map((entry) => {
    const meta = resolvedMap.get(normalizeKey(entry.name)) || null;
    return {
      ...entry,
      name: meta ? meta.name : entry.name,
      card: meta,
      notFound: !meta,
    };
  });

  autoRecognizeCommanders(rawResolvedCards, format);
  const resolvedCards = consolidateResolvedDeckCards(rawResolvedCards, format);

  // Per official MTG rules, Main + Commander form the 100/60/40-card deck; Companion sits outside in the companion/sideboard zone
  const mainAndCmd = resolvedCards.filter(
    (c) => c.zone === 'main' || c.zone === 'commander'
  );
  const sideboardCount = resolvedCards
    .filter((c) => c.zone === 'sideboard' || c.zone === 'companion')
    .reduce((acc, c) => acc + c.quantity, 0);

  const currentMainAndCommanderCount = mainAndCmd.reduce((acc, c) => acc + c.quantity, 0);
  const targetDeckSize = getTargetDeckSizeForFormat(format, currentMainAndCommanderCount);

  const deckSizeDelta = targetDeckSize - currentMainAndCommanderCount;

  const commanders = resolvedCards.filter((c) => c.zone === 'commander');
  const commanderNames = commanders.map((c) => c.name);
  const rawCommanderColorIdentity = Array.from(
    new Set(commanders.flatMap((c) => c.card?.colorIdentity || []))
  );

  let currentLands = 0;
  let mdfcLandCount = 0;
  let tappedLandCount = 0;
  let currentRamp = 0;
  let currentDraw = 0;
  let currentRemoval = 0;
  let currentBoardWipes = 0;

  let nonLandCount = 0;
  let nonLandCmcSum = 0;
  let totalCmcSum = 0;

  const curveCounts = new Array<number>(8).fill(0); // 0..6, 7+
  const totalPips: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const earlyDoublePipDemand: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const colorSources: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const spellColorIdentitySet = new Set<ManaColor>();

  const formatViolations: string[] = [];
  const singletonViolations: string[] = [];
  const colorIdentityViolations: string[] = [];
  const unresolvedCards: string[] = [];

  const totalCopiesByName = new Map<string, number>();

  // Pass 1: Count non-land spell pips, curve, roles, and true spell color identity
  for (const item of mainAndCmd) {
    addMapCardCount(totalCopiesByName, item.name, item.quantity);

    const meta = item.card;
    if (!meta) {
      unresolvedCards.push(item.name);
      continue;
    }

    const effectiveLegalInFormat =
      format === 'brawl' && targetDeckSize === 60 && typeof meta.standardBrawlLegal === 'boolean'
        ? meta.standardBrawlLegal
        : meta.legalInFormat;

    if (!effectiveLegalInFormat) {
      formatViolations.push(
        `${meta.name} is not legal in ${format === 'brawl' && targetDeckSize === 60 ? 'Standard Brawl (60-card)' : format}`
      );
    }

    if (
      (format === 'commander' || format === 'brawl') &&
      rawCommanderColorIdentity.length > 0 &&
      item.zone !== 'commander'
    ) {
      const illegalColors = meta.colorIdentity.filter(
        (c) => !rawCommanderColorIdentity.includes(c)
      );
      if (illegalColors.length > 0) {
        colorIdentityViolations.push(
          `${meta.name} (${meta.colorIdentity.join('')}) is outside your commander's color identity (${rawCommanderColorIdentity.join('')})`
        );
      }
    }

    if (meta.isLand) {
      currentLands += item.quantity;
      if (meta.entersTappedLikely) tappedLandCount += item.quantity;
    } else {
      if (meta.isMdfcLand) {
        mdfcLandCount += item.quantity;
      }

      nonLandCount += item.quantity;
      nonLandCmcSum += meta.cmc * item.quantity;
      totalCmcSum += meta.cmc * item.quantity;

      const bucketIdx = Math.min(7, Math.max(0, Math.round(meta.cmc)));
      curveCounts[bucketIdx] += item.quantity;

      if (meta.isRamp) currentRamp += item.quantity;
      if (meta.isDraw) currentDraw += item.quantity;
      if (meta.isBoardWipe) currentBoardWipes += item.quantity;
      if (meta.isRemoval) currentRemoval += item.quantity;

      const pips = countPips(meta.manaCost);
      for (const c of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
        totalPips[c] += pips[c] * item.quantity;
        if (pips[c] > 0 && c !== 'C') {
          spellColorIdentitySet.add(c);
        }
        if (meta.cmc <= 3 && pips[c] >= 2) {
          earlyDoublePipDemand[c] += item.quantity;
        }
      }

      for (const cid of meta.colorIdentity || []) {
        if (cid === 'W' || cid === 'U' || cid === 'B' || cid === 'R' || cid === 'G') {
          spellColorIdentitySet.add(cid);
        }
      }
    }
  }

  // Determine the deck's true active colors:
  // - If a Commander is present, strictly use the Commander's color identity.
  // - Otherwise, use the union of colors actually demanded by non-land spells.
  const activeDeckColorSet = new Set<ManaColor>(
    rawCommanderColorIdentity.length > 0
      ? (rawCommanderColorIdentity.filter(
          (c): c is ManaColor => c === 'W' || c === 'U' || c === 'B' || c === 'R' || c === 'G'
        ) as ManaColor[])
      : (['W', 'U', 'B', 'R', 'G'] as ManaColor[]).filter(
          (c) => totalPips[c] > 0 || spellColorIdentitySet.has(c)
        )
  );

  const commanderColorIdentity =
    rawCommanderColorIdentity.length > 0
      ? rawCommanderColorIdentity
      : Array.from(activeDeckColorSet);

  // Pass 2: Credit mana sources ONLY for colors actually used by the deck (activeDeckColorSet) or Colorless ('C').
  // This prevents Command Tower, Arcane Signet, Exotic Orchard, Evolving Wilds, Treasure producers, or off-color fetchland halves
  // from tricking the analyzer into thinking a non-White deck uses White.
  for (const item of mainAndCmd) {
    const meta = item.card;
    if (!meta) continue;

    if (meta.isLand) {
      for (const c of meta.producedMana) {
        if (c === 'C') {
          colorSources.C += item.quantity;
        } else if (
          (c === 'W' || c === 'U' || c === 'B' || c === 'R' || c === 'G') &&
          activeDeckColorSet.has(c)
        ) {
          colorSources[c] += item.quantity;
        }
      }
    } else {
      if (meta.isMdfcLand) {
        for (const c of meta.producedMana) {
          if (c === 'C') {
            colorSources.C += item.quantity * 0.5;
          } else if (
            (c === 'W' || c === 'U' || c === 'B' || c === 'R' || c === 'G') &&
            activeDeckColorSet.has(c)
          ) {
            colorSources[c] += item.quantity * 0.5;
          }
        }
      }

      if (meta.isRamp) {
        for (const c of meta.producedMana) {
          if (
            (c === 'W' || c === 'U' || c === 'B' || c === 'R' || c === 'G') &&
            activeDeckColorSet.has(c)
          ) {
            colorSources[c] += item.quantity * 0.5;
          }
        }
      }
    }
  }

  // Constructed formats (CR 100.4a) count Main + Sideboard combined for copy limits & sideboard legality
  const allLegalityCards =
    format !== 'commander' && format !== 'brawl' && format !== 'limited'
      ? [...mainAndCmd, ...resolvedCards.filter((c) => c.zone === 'sideboard' || c.zone === 'companion')]
      : mainAndCmd;

  if (format !== 'commander' && format !== 'brawl' && format !== 'limited') {
    for (const sideItem of resolvedCards) {
      if (sideItem.zone !== 'sideboard' && sideItem.zone !== 'companion') continue;
      addMapCardCount(totalCopiesByName, sideItem.name, sideItem.quantity);
      if (sideItem.card && !sideItem.card.legalInFormat) {
        formatViolations.push(`${sideItem.card.name} (Sideboard) is not legal in ${format}`);
      }
    }
    if (sideboardCount > 15) {
      formatViolations.push(`Sideboard has ${sideboardCount} cards (maximum is 15 in ${format})`);
    }
  }

  // Format copy-limit validation across singleton, Vintage restricted, and constructed formats
  for (const [key, qty] of totalCopiesByName.entries()) {
    const sample = allLegalityCards.find((c) => isSameCardName(c.name, key));
    const display = sample?.name || key;
    const maxAllowed = getMaxCopiesForCard(display, format, sample?.card);
    if (Number.isFinite(maxAllowed) && qty > maxAllowed) {
      if (isRestrictedCardInFormat(display, format, sample?.card)) {
        formatViolations.push(`${display} appears ${qty} times (Restricted in Vintage — max 1 copy)`);
      } else if (format === 'commander' || format === 'brawl') {
        singletonViolations.push(`${display} appears ${qty} times (singleton limit is 1)`);
      } else {
        formatViolations.push(`${display} appears ${qty} times (${maxAllowed}-copy limit)`);
      }
    }
  }

  const averageCmcNonLand = nonLandCount > 0 ? Number((nonLandCmcSum / nonLandCount).toFixed(2)) : 0;
  const averageCmcWithLands =
    currentMainAndCommanderCount > 0
      ? Number((totalCmcSum / currentMainAndCommanderCount).toFixed(2))
      : 0;

  // Recommended Land Formula (Karsten-inspired + Commander/60-card targets)
  let recommendedLands: number;
  let recommendedRamp: number;
  let recommendedDraw: number;
  let recommendedRemoval: number;

  if (targetDeckSize === 100) {
    const rawTarget = Math.round(31.5 + 2.6 * averageCmcNonLand - Math.min(4, currentRamp * 0.25));
    recommendedLands = Math.max(34, Math.min(41, rawTarget));
    recommendedRamp = 10;
    recommendedDraw = 10;
    recommendedRemoval = 10;
  } else if (targetDeckSize === 40) {
    recommendedLands = averageCmcNonLand <= 2.3 ? 16 : averageCmcNonLand >= 3.3 ? 18 : 17;
    recommendedRamp = 2;
    recommendedDraw = 3;
    recommendedRemoval = 5;
  } else {
    if (averageCmcNonLand <= 1.9) recommendedLands = 20;
    else if (averageCmcNonLand <= 2.35) recommendedLands = 22;
    else if (averageCmcNonLand <= 2.85) recommendedLands = 24;
    else if (averageCmcNonLand <= 3.4) recommendedLands = 25;
    else recommendedLands = 26;
    recommendedRamp = averageCmcNonLand >= 3.0 ? 6 : 2;
    recommendedDraw = 6;
    recommendedRemoval = 8;
  }

  const effectiveLands = currentLands + Math.floor(mdfcLandCount * 0.5);
  const landsDelta = recommendedLands - effectiveLands;
  const rampDelta = Math.max(0, recommendedRamp - currentRamp);

  // Color Breakdown — strictly mark any color not in activeDeckColorSet as 'unused'
  const totalColoredPips = (['W', 'U', 'B', 'R', 'G'] as ManaColor[])
    .filter((c) => activeDeckColorSet.has(c))
    .reduce((sum, c) => sum + totalPips[c], 0);

  const colorBreakdown: ColorBreakdownItem[] = (['W', 'U', 'B', 'R', 'G'] as ManaColor[]).map((color) => {
    if (!activeDeckColorSet.has(color)) {
      return {
        color,
        label: COLOR_LABELS[color],
        pips: 0,
        pipSharePct: 0,
        currentSources: 0,
        recommendedSources: 0,
        deltaSources: 0,
        status: 'unused',
      };
    }

    const pips = Math.round(totalPips[color]);
    const pipSharePct = totalColoredPips > 0 ? Math.round((pips / totalColoredPips) * 100) : 0;
    const currentSources = Math.round(colorSources[color]);

    if (pips === 0 && currentSources === 0) {
      return {
        color,
        label: COLOR_LABELS[color],
        pips: 0,
        pipSharePct: 0,
        currentSources: 0,
        recommendedSources: 0,
        deltaSources: 0,
        status: 'unused',
      };
    }

    // Karsten-style source requirements scaled to deck size
    const scale = targetDeckSize / 60;
    const baseNeeded = Math.round((pips / Math.max(1, totalColoredPips)) * recommendedLands * 1.15);
    const minBaseline = Math.round((earlyDoublePipDemand[color] > 0 ? 18 : 13) * scale * 0.85);
    const recommendedSources = Math.min(
      recommendedLands + 4,
      Math.max(pips > 0 ? minBaseline : 6, baseNeeded)
    );
    const deltaSources = recommendedSources - currentSources;

    let status: 'ok' | 'low' | 'critical' | 'unused' = 'ok';
    if (deltaSources >= 4) status = 'critical';
    else if (deltaSources >= 1) status = 'low';

    return {
      color,
      label: COLOR_LABELS[color],
      pips,
      pipSharePct,
      currentSources,
      recommendedSources,
      deltaSources,
      status,
    };
  });

  const curve: CurveBucket[] = curveCounts.map((count, idx) => ({
    cmc: idx,
    cmcLabel: idx === 7 ? '7+' : `${idx}`,
    currentCount: count,
  }));

  return {
    resolvedCards,
    metrics: {
      detectedFormat: format,
      targetDeckSize,
      currentMainAndCommanderCount,
      sideboardCount,
      deckSizeDelta,
      commanderNames,
      commanderColorIdentity,
      currentLands,
      mdfcLandCount,
      tappedLandCount,
      recommendedLands,
      landsDelta,
      recommendedRamp,
      currentRamp,
      rampDelta,
      currentDraw,
      recommendedDraw,
      currentRemoval,
      recommendedRemoval,
      currentBoardWipes,
      averageCmcNonLand,
      averageCmcWithLands,
      curve,
      colorBreakdown,
      formatViolations,
      singletonViolations,
      colorIdentityViolations,
      unresolvedCards,
    },
  };
}
