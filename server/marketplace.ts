import type { CardMetadata, CardPrinting, CardPrintingsResponse } from '../src/types/deck.ts';

interface CKRawEntry {
  scryfall_id?: string;
  url?: string;
  name?: string;
  is_foil?: string;
  price_retail?: string;
  price_buy?: string;
  qty_retail?: number;
}

interface CKPriceRecord {
  nonFoilUsd: number | null;
  foilUsd: number | null;
  buyUsd: number | null;
  qty: number | null;
  urlPath: string;
}

export interface CKResolvedPriceRecord {
  nonFoilUsd: number | null;
  foilUsd: number | null;
  buyUsd: number | null;
  qty: number | null;
  url: string;
}

interface ScryfallRawCard {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  released_at: string;
  rarity: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  scryfall_uri?: string;
  image_uris?: { normal?: string; large?: string };
  card_faces?: Array<{
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    image_uris?: { normal?: string; large?: string };
  }>;
  prices?: {
    usd?: string | null;
    usd_foil?: string | null;
    usd_etched?: string | null;
    eur?: string | null;
    eur_foil?: string | null;
    tix?: string | null;
  };
  purchase_uris?: {
    tcgplayer?: string;
    cardmarket?: string;
    cardhoarder?: string;
  };
}

let ckByScryfallId = new Map<string, CKPriceRecord>();
let ckByName = new Map<string, CKPriceRecord>();
let ckLastFetchedAt = 0;
let ckInFlight: Promise<void> | null = null;
let ckIdleClearTimer: ReturnType<typeof setTimeout> | null = null;
const CK_TTL_MS = 45 * 60 * 1000; // 45 minutes
const CK_IDLE_CLEAR_MS = 20 * 60 * 1000; // Free multi-MB index after 20 min of inactivity

function scheduleCardKingdomIdleClear(): void {
  if (ckIdleClearTimer) clearTimeout(ckIdleClearTimer);
  ckIdleClearTimer = setTimeout(() => {
    ckByScryfallId.clear();
    ckByName.clear();
    ckByScryfallId = new Map();
    ckByName = new Map();
    ckLastFetchedAt = 0;
  }, CK_IDLE_CLEAR_MS);
  if (typeof ckIdleClearTimer.unref === 'function') {
    ckIdleClearTimer.unref();
  }
}

function parseNum(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = typeof val === 'number' ? val : parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

export async function ensureCardKingdomIndex(): Promise<void> {
  const now = Date.now();
  if (ckByScryfallId.size > 0 && now - ckLastFetchedAt < CK_TTL_MS) {
    return;
  }
  if (ckInFlight) {
    return ckInFlight;
  }

  ckInFlight = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const res = await fetch('https://api.cardkingdom.com/api/v2/pricelist', {
        headers: { 'User-Agent': 'UmbrasPass/1.0' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return;

      const payload = (await res.json()) as { data?: CKRawEntry[] };
      const rawList = Array.isArray(payload.data) ? payload.data : [];
      payload.data = undefined;
      const byId = new Map<string, CKPriceRecord>();
      const byName = new Map<string, CKPriceRecord>();

      for (const item of rawList) {
        if (!item.scryfall_id || !item.name) continue;
        const isFoil = String(item.is_foil).toLowerCase() === 'true';
        const retail = parseNum(item.price_retail);
        const buy = parseNum(item.price_buy);
        if (retail === null && buy === null) continue;
        const qty = typeof item.qty_retail === 'number' ? item.qty_retail : null;
        const urlPath = item.url ? item.url.replace(/^\/+/, '') : '';

        const existing = byId.get(item.scryfall_id);
        let idRecord: CKPriceRecord;
        if (!existing) {
          idRecord = {
            nonFoilUsd: isFoil ? null : retail,
            foilUsd: isFoil ? retail : null,
            buyUsd: isFoil ? null : buy,
            qty: isFoil ? null : qty,
            urlPath,
          };
          byId.set(item.scryfall_id, idRecord);
        } else {
          idRecord = existing;
          if (isFoil) {
            existing.foilUsd = retail;
          } else {
            existing.nonFoilUsd = retail;
            existing.buyUsd = buy;
            existing.qty = qty;
            if (urlPath) existing.urlPath = urlPath;
          }
        }

        if (!isFoil && retail !== null && typeof item.name === 'string') {
          const nameKey = item.name.trim().toLowerCase();
          const prevName = byName.get(nameKey);
          if (
            !prevName ||
            prevName.nonFoilUsd === null ||
            (qty && qty > 0 && (!prevName.qty || retail < prevName.nonFoilUsd))
          ) {
            byName.set(nameKey, idRecord);
          }
        }
      }

      ckByScryfallId = byId;
      ckByName = byName;
      ckLastFetchedAt = Date.now();
      scheduleCardKingdomIdleClear();
    } catch {
      // Non-fatal: continue gracefully without Card Kingdom cache if unreachable
    } finally {
      ckInFlight = null;
    }
  })();

  return ckInFlight;
}

function hydrateCardKingdomRecord(
  rec: CKPriceRecord | undefined,
  fallbackName?: string
): CKResolvedPriceRecord | null {
  if (!rec) return null;
  scheduleCardKingdomIdleClear();
  const url = rec.urlPath
    ? `https://www.cardkingdom.com/${rec.urlPath}`
    : fallbackName
    ? `https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${encodeURIComponent(fallbackName)}`
    : 'https://www.cardkingdom.com/';
  return {
    nonFoilUsd: rec.nonFoilUsd,
    foilUsd: rec.foilUsd,
    buyUsd: rec.buyUsd,
    qty: rec.qty,
    url,
  };
}

export function getCardKingdomRecord(
  scryfallId?: string,
  cardName?: string
): CKResolvedPriceRecord | null {
  if (scryfallId && ckByScryfallId.has(scryfallId)) {
    return hydrateCardKingdomRecord(ckByScryfallId.get(scryfallId), cardName);
  }
  if (typeof cardName === 'string' && cardName.trim()) {
    const key = cardName.trim().toLowerCase();
    if (ckByName.has(key)) return hydrateCardKingdomRecord(ckByName.get(key), cardName);
    if (key.includes(' // ')) {
      const front = key.split(' // ')[0];
      if (ckByName.has(front)) return hydrateCardKingdomRecord(ckByName.get(front), cardName);
    }
  }
  return null;
}

export function buildMarketplaceUrls(cardName: string, setName?: string, purchaseUris?: ScryfallRawCard['purchase_uris']) {
  const ebayQuery = setName ? `${cardName} ${setName} mtg` : `${cardName} mtg`;
  return {
    tcgplayer:
      purchaseUris?.tcgplayer ||
      `https://www.tcgplayer.com/search/magic/product?q=${encodeURIComponent(cardName)}`,
    cardKingdom: `https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${encodeURIComponent(cardName)}`,
    ebayListings: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(ebayQuery)}&_sacat=183454&LH_BIN=1`,
    ebaySold: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(ebayQuery)}&_sacat=183454&LH_Sold=1&LH_Complete=1`,
    cardmarket:
      purchaseUris?.cardmarket ||
      `https://www.cardmarket.com/en/Magic/Products/Search?searchString=${encodeURIComponent(cardName)}`,
    cardhoarder:
      purchaseUris?.cardhoarder ||
      `https://www.cardhoarder.com/cards?data%5Bsearch%5D=${encodeURIComponent(cardName)}`,
  };
}

function mapRawToPrinting(raw: ScryfallRawCard): CardPrinting {
  const face0 = raw.card_faces?.[0];
  const face1 = raw.card_faces?.[1];
  const imageUri =
    raw.image_uris?.normal ||
    raw.image_uris?.large ||
    face0?.image_uris?.normal ||
    face0?.image_uris?.large ||
    '';
  const backImageUri = face1?.image_uris?.normal || face1?.image_uris?.large;

  const ck = getCardKingdomRecord(raw.id, raw.name);
  const baseUrls = buildMarketplaceUrls(raw.name, raw.set_name, raw.purchase_uris);

  return {
    scryfallId: raw.id,
    name: raw.name,
    setCode: raw.set.toUpperCase(),
    setName: raw.set_name,
    collectorNumber: raw.collector_number,
    releasedAt: raw.released_at,
    rarity: raw.rarity,
    imageUri,
    backImageUri,
    scryfallUri: raw.scryfall_uri || `https://scryfall.com/search?q=${encodeURIComponent(raw.name)}`,
    prices: {
      tcgplayerUsd: parseNum(raw.prices?.usd),
      tcgplayerFoilUsd: parseNum(raw.prices?.usd_foil),
      tcgplayerEtchedUsd: parseNum(raw.prices?.usd_etched),
      cardKingdomUsd: ck?.nonFoilUsd ?? null,
      cardKingdomFoilUsd: ck?.foilUsd ?? null,
      cardKingdomBuyUsd: ck?.buyUsd ?? null,
      cardKingdomQty: ck?.qty ?? null,
      cardmarketEur: parseNum(raw.prices?.eur),
      cardmarketFoilEur: parseNum(raw.prices?.eur_foil),
      cardhoarderTix: parseNum(raw.prices?.tix),
    },
    urls: {
      ...baseUrls,
      cardKingdom: ck?.url || baseUrls.cardKingdom,
    },
  };
}

export async function getAllPrintingsForCard(cardName: string): Promise<CardPrintingsResponse> {
  // Warm/wait up to 4s on Card Kingdom cache without blocking long
  await Promise.race([
    ensureCardKingdomIndex(),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]);

  const namedRes = await fetch(
    `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName.trim())}`,
    { headers: { 'User-Agent': 'UmbrasPass/1.0' } }
  );
  if (!namedRes.ok) {
    throw new Error(`Card "${cardName}" was not found in the Scryfall MTG database.`);
  }
  const canonical = (await namedRes.json()) as ScryfallRawCard;
  const face0 = canonical.card_faces?.[0];

  const printings: CardPrinting[] = [];
  if (canonical.oracle_id) {
    let nextUrl: string | null = `https://api.scryfall.com/cards/search?order=released&q=oracleid%3A${canonical.oracle_id}&unique=prints`;
    let page = 0;
    while (nextUrl && page < 2) {
      const printsRes = await fetch(nextUrl, { headers: { 'User-Agent': 'UmbrasPass/1.0' } });
      if (!printsRes.ok) break;
      const pageData = (await printsRes.json()) as {
        data?: ScryfallRawCard[];
        has_more?: boolean;
        next_page?: string;
      };
      for (const item of pageData.data || []) {
        if (item.image_uris?.normal || item.card_faces?.[0]?.image_uris?.normal) {
          printings.push(mapRawToPrinting(item));
        }
      }
      nextUrl = pageData.has_more && pageData.next_page ? pageData.next_page : null;
      page++;
    }
  }

  if (printings.length === 0) {
    printings.push(mapRawToPrinting(canonical));
  }

  return {
    cardName: canonical.name,
    manaCost: canonical.mana_cost ?? face0?.mana_cost ?? '',
    typeLine: canonical.type_line ?? face0?.type_line ?? '',
    oracleText:
      canonical.oracle_text ??
      canonical.card_faces?.map((f) => f.oracle_text || '').join('\n') ??
      '',
    cmc: typeof canonical.cmc === 'number' ? canonical.cmc : 0,
    totalPrintings: printings.length,
    printings,
  };
}

export async function searchMtgDatabase(query: string): Promise<CardMetadata[]> {
  await Promise.race([
    ensureCardKingdomIndex(),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);

  const res = await fetch(
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query.trim())}&order=edhrec`,
    { headers: { 'User-Agent': 'UmbrasPass/1.0' } }
  );
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Scryfall search failed (HTTP ${res.status}).`);
  }

  const payload = (await res.json()) as { data?: ScryfallRawCard[] };
  return (payload.data || []).slice(0, 24).map((raw) => {
    const face0 = raw.card_faces?.[0];
    const imageUri =
      raw.image_uris?.normal ||
      raw.image_uris?.large ||
      face0?.image_uris?.normal ||
      face0?.image_uris?.large ||
      '';
    const backImageUri = raw.card_faces?.[1]?.image_uris?.normal;
    const ck = getCardKingdomRecord(raw.id, raw.name);
    const urls = buildMarketplaceUrls(raw.name, raw.set_name, raw.purchase_uris);

    return {
      name: raw.name,
      manaCost: raw.mana_cost ?? face0?.mana_cost ?? '',
      cmc: typeof raw.cmc === 'number' ? raw.cmc : 0,
      typeLine: raw.type_line ?? face0?.type_line ?? '',
      oracleText:
        raw.oracle_text ??
        raw.card_faces?.map((f) => f.oracle_text || '').join('\n') ??
        '',
      colors: [],
      colorIdentity: [],
      producedMana: [],
      isLand: /\bland\b/i.test(raw.type_line || ''),
      isMdfcLand: false,
      entersTappedLikely: false,
      isRamp: false,
      isDraw: false,
      isRemoval: false,
      isBoardWipe: false,
      isProtection: false,
      imageUri,
      backImageUri,
      priceUsd: parseNum(raw.prices?.usd),
      priceFoilUsd: parseNum(raw.prices?.usd_foil),
      priceEur: parseNum(raw.prices?.eur),
      priceTix: parseNum(raw.prices?.tix),
      cardKingdomPriceUsd: ck?.nonFoilUsd ?? null,
      cardKingdomUrl: ck?.url || urls.cardKingdom,
      tcgplayerUrl: urls.tcgplayer,
      cardmarketUrl: urls.cardmarket,
      cardhoarderUrl: urls.cardhoarder,
      ebayUrl: urls.ebayListings,
      setCode: raw.set.toUpperCase(),
      setName: raw.set_name,
      collectorNumber: raw.collector_number,
      scryfallUri: raw.scryfall_uri || `https://scryfall.com/search?q=${encodeURIComponent(raw.name)}`,
      legalInFormat: true,
      rarity: raw.rarity,
    };
  });
}
