import type {
  CardAddRecommendation,
  CardCutRecommendation,
  CardMetadata,
  CardPrinting,
  CardPrintingsResponse,
  CardSwapRecommendation,
  ColorBreakdownItem,
  CurveBucket,
  DeckAnalysisResult,
  DeckFormat,
  DeckGoal,
  DeckMetrics,
  DeckZone,
  LandPlanItem,
  ManaColor,
  ManaPlanSummary,
  ParsedCardEntry,
  ParsedDeckResult,
  PlaytestMode,
  PlaytestResult,
  PlaytestRound,
  PlaytestFinalStatsSummary,
  ResolvedDeckCard,
  RoundDeckChange,
  BotOpponentConfig,
  BotIndignanceLevel,
  BotLearningProfile,
  BotMatchLearningInsight,
  PlaytestBotPlay,
} from '../types/deck';
import { getBotIndignanceMeta } from './botIndignance';
import {
  buildBotPastPlayBriefing,
  resolveBotLearningKey,
} from './botLearning';
import {
  canPayManaCost,
  detectArchetypeCombatBias,
  detectCardMechanics,
  extractDeckSynergyBlueprint,
  findMetaFromMap,
  getFormatSimulationRules,
  getProducedColorsFromCard,
  normalizeCardLookupKey,
  performLondonMulligan,
  reconcilePlaytestMatchStats,
  type CardMechanicFlags,
  type DeckSynergyBlueprint,
  type FormatSimulationRules,
} from './playtestReconciler';
import {
  addMapCardCount,
  consolidateResolvedDeckCards,
  detectFormatFromParsedCards,
  findMatchingCardMapKey,
  getMapCardCount,
  getMaxCopiesForCard,
  getTargetDeckSizeForFormat,
  isBasicLandCard,
  isSameCardName,
  mergeParsedCardEntries,
  normalizeDeckCardKey,
  reconcileAnalysisRecommendationsToTargetSize,
} from './deckRules';

/**
 * Safely parses a fetch Response as JSON without throwing when static hosting (e.g. Firebase Hosting)
 * rewrites /api/* routes to index.html (`<!doctype html>...`).
 */
export async function safeParseApiJson<T>(res: Response): Promise<T | null> {
  try {
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    const trimmed = text.trimStart();
    if (!trimmed || trimmed.startsWith('<') || !ct.includes('application/json')) {
      return null;
    }
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

// 1. Universal Client-Side Decklist Parser & URL Importer
const CLIENT_CATEGORY_HEADERS = new Set([
  'creature',
  'creatures',
  'land',
  'lands',
  'artifact',
  'artifacts',
  'enchantment',
  'enchantments',
  'instant',
  'instants',
  'sorcery',
  'sorceries',
  'instants & sorceries',
  'instants and sorceries',
  'planeswalker',
  'planeswalkers',
  'battle',
  'battles',
  'ramp',
  'mana ramp',
  'draw',
  'card draw',
  'card advantage',
  'removal',
  'targeted removal',
  'spot removal',
  'board wipe',
  'board wipes',
  'mass removal',
  'wipes',
  'protection',
  'interaction',
  'counterspells',
  'counters',
  'synergy',
  'finisher',
  'finishers',
  'wincon',
  'wincons',
  'win conditions',
  'tokens',
  'tutor',
  'tutors',
  'recursion',
  'graveyard',
  'utility',
  'other',
  'spells',
  'non-creature spells',
]);

function cleanCardName(raw: string): {
  name: string;
  zoneOverride?: DeckZone;
  setCode?: string;
  collectorNumber?: string;
  categoryTag?: string;
} {
  let text = (raw || '')
    .replace(/[\uFEFF\u200B-\u200D]/g, '')
    .replace(/[\u00A0\u2009\u202F\t]+/g, ' ')
    .trim();
  let zoneOverride: DeckZone | undefined;
  let setCode: string | undefined;
  let collectorNumber: string | undefined;
  let categoryTag: string | undefined;

  if (
    /\*(?:CMDR|COMMANDER)\*|\[(?:Commander|CMDR)(?:\{[^}]*\})?\]|\((?:Commander|CMDR)\)|#!?Commander\b|<(?:Commander|CMDR)>/i.test(
      text
    )
  ) {
    zoneOverride = 'commander';
    text = text
      .replace(
        /\*(?:CMDR|COMMANDER)\*|\[(?:Commander|CMDR)(?:\{[^}]*\})?\]|\((?:Commander|CMDR)\)|#!?Commander\b|<(?:Commander|CMDR)>/gi,
        ' '
      )
      .trim();
  }
  if (/\[Sideboard\]|\(Sideboard\)|#!?Sideboard\b/i.test(text)) {
    zoneOverride = 'sideboard';
    text = text.replace(/\[Sideboard\]|\(Sideboard\)|#!?Sideboard\b/gi, ' ').trim();
  }
  if (/\[Maybeboard\]|\(Maybeboard\)|#!?Maybeboard\b/i.test(text)) {
    zoneOverride = 'maybeboard';
    text = text.replace(/\[Maybeboard\]|\(Maybeboard\)|#!?Maybeboard\b/gi, ' ').trim();
  }
  if (/\[Companion\]|\(Companion\)|#!?Companion\b/i.test(text)) {
    zoneOverride = 'companion';
    text = text.replace(/\[Companion\]|\(Companion\)|#!?Companion\b/gi, ' ').trim();
  }

  const tagMatches = text.match(/#!?[A-Za-z0-9_/-]+/g);
  if (tagMatches && tagMatches.length > 0) {
    categoryTag = tagMatches.map((t) => t.replace(/^#!?/, '')).join(', ');
    text = text.replace(/#!?[A-Za-z0-9_/-]+/g, ' ');
  }

  text = text.replace(/\^[^^]+\^/g, ' ').replace(/~[^~]+~/g, ' ');
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1');

  const stripTrailingAnnotations = (input: string): string => {
    let cur = input.trim();
    for (let pass = 0; pass < 4; pass++) {
      const next = cur
        .replace(/\*[A-Za-z0-9-]+\*/g, ' ')
        .replace(
          /\(\s*(?:F|FE|ETCHED|FOIL|SHOWCASE|BORDERLESS|EXTENDED(?:\s+ART)?|RETRO|FULL\s+ART|PROMO|PRERELEASE|STAMPED|ALT(?:\s+ART)?)\s*\)\s*$/i,
          ' '
        )
        .replace(/\(\s*[$€£]\s*\d+(?:\.\d+)?\s*\)\s*$/i, ' ')
        .replace(/(?:^|\s)[$€£]\s*\d+(?:\.\d+)?\s*$/i, ' ')
        .replace(/[★†☆✦✧※*]+\s*$/g, ' ')
        .trim();
      if (next === cur) break;
      cur = next;
    }
    return cur;
  };

  text = stripTrailingAnnotations(text);

  const parenWithCollectorMatch = text.match(
    /\s+\(([A-Za-z0-9]{2,6})\)\s+([0-9]+[A-Za-z0-9-]*|[A-Za-z0-9]{2,5}-[A-Za-z0-9-]+)[★†☆✦✧※*]?(?:\s+(.*))?$/
  );
  if (parenWithCollectorMatch && parenWithCollectorMatch.index !== undefined && parenWithCollectorMatch.index > 0) {
    const trailingExtra = (parenWithCollectorMatch[3] || '').trim();
    if (!trailingExtra || /^(?:[\[{#~^($€£*★†☆✦✧※]|foil\b|etched\b|f\b|\/\/)/i.test(trailingExtra)) {
      setCode = parenWithCollectorMatch[1].toUpperCase();
      collectorNumber = parenWithCollectorMatch[2];
      if (trailingExtra) {
        const bracketTags = Array.from(trailingExtra.matchAll(/\[([^\]]+)\]/g))
          .map((m) => m[1].replace(/\{[^}]*\}/g, '').trim())
          .filter(Boolean);
        if (bracketTags.length > 0 && !categoryTag) {
          categoryTag = bracketTags.join(', ');
        }
      }
      text = text.slice(0, parenWithCollectorMatch.index).trim();
    }
  }

  const strippedTagsBeforeSet = text
    .replace(/\[[^\]]+\]/g, (m) => {
      return /^\s*\[[A-Za-z0-9]{2,6}(?::[A-Za-z0-9-]+)?\]\s*$/.test(m) ? m : ' ';
    })
    .replace(/\{[^}]+\}/g, ' ')
    .trim();
  if (strippedTagsBeforeSet) {
    text = strippedTagsBeforeSet;
  }

  text = stripTrailingAnnotations(text);

  const parenMatch = text.match(
    /\s*\(([A-Za-z0-9]{2,6})\)\s*([A-Za-z0-9-]+)?\s*[★†☆✦✧※*]?\s*$/
  );
  if (parenMatch && parenMatch.index !== undefined && parenMatch.index > 0) {
    if (!setCode) setCode = parenMatch[1].toUpperCase();
    if (!collectorNumber && parenMatch[2]) collectorNumber = parenMatch[2];
    text = text.slice(0, parenMatch.index).trim();
  }

  const bracketMatch = text.match(
    /\s*\[([A-Za-z0-9]{2,6})(?::([A-Za-z0-9-]+))?\]\s*([A-Za-z0-9-]+)?\s*[★†☆✦✧※*]?\s*$/
  );
  if (bracketMatch && bracketMatch.index !== undefined && bracketMatch.index > 0) {
    if (!setCode) setCode = bracketMatch[1].toUpperCase();
    if (!collectorNumber && (bracketMatch[2] || bracketMatch[3])) {
      collectorNumber = bracketMatch[2] || bracketMatch[3];
    }
    text = text.slice(0, bracketMatch.index).trim();
  }

  // Strip leading .mwdeck set tags like "[DIS] Lightning Helix"
  text = text.replace(/^\s*\[[A-Za-z0-9]{2,6}(?::[A-Za-z0-9-]+)?\]\s*/, '');

  const strippedTags = text.replace(/\[[^\]]+\]/g, ' ').replace(/\{[^}]+\}/g, ' ').trim();
  if (strippedTags) {
    text = strippedTags;
  } else {
    text = text.replace(/^\[+|\]+$/g, '').replace(/^\{+|\}+$/g, '').trim();
  }

  text = stripTrailingAnnotations(text);
  const lateParenMatch = text.match(
    /\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([0-9]+[A-Za-z0-9-]*|[A-Za-z0-9]{2,5}-[A-Za-z0-9-]+))?\s*$/
  );
  if (lateParenMatch && lateParenMatch.index !== undefined && lateParenMatch.index > 0) {
    if (!setCode) setCode = lateParenMatch[1].toUpperCase();
    if (!collectorNumber && lateParenMatch[2]) collectorNumber = lateParenMatch[2];
    text = text.slice(0, lateParenMatch.index).trim();
  }

  text = text.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();

  return { name: text, zoneOverride, setCode, collectorNumber, categoryTag };
}

function parseDelimitedLineClient(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function extractXmlAttrClient(tag: string, attrName: string): string | undefined {
  const m =
    tag.match(new RegExp(`\\b${attrName}\\s*=\\s*"([^"]*)"`, 'i')) ||
    tag.match(new RegExp(`\\b${attrName}\\s*=\\s*'([^']*)'`, 'i'));
  return m?.[1]
    ?.replace(/&amp;/g, '&')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function parseXmlDeckClient(raw: string): ParsedDeckResult | null {
  if (raw.includes('<cockatrice_deck') || raw.includes('<zone ')) {
    const cards: ParsedCardEntry[] = [];
    let deckName: string | undefined;
    const nameMatch = raw.match(/<deckname>([^<]+)<\/deckname>/i);
    if (nameMatch) deckName = nameMatch[1].trim();

    const zoneRegex = /<zone\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/zone>/gi;
    let zMatch: RegExpExecArray | null;
    while ((zMatch = zoneRegex.exec(raw)) !== null) {
      const zName = zMatch[1].toLowerCase();
      const zone: DeckZone =
        zName.includes('side') ? 'sideboard' : zName.includes('command') ? 'commander' : 'main';
      const cardTagRegex = /<card\b[^>]*\/?>/gi;
      let tagMatch: RegExpExecArray | null;
      while ((tagMatch = cardTagRegex.exec(zMatch[2])) !== null) {
        const rawName = extractXmlAttrClient(tagMatch[0], 'name');
        const numStr = extractXmlAttrClient(tagMatch[0], 'number') || '1';
        const qty = parseInt(numStr, 10);
        if (rawName) {
          const cleaned = cleanCardName(rawName);
          if (cleaned.name) {
            cards.push({
              quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
              name: cleaned.name,
              zone: cleaned.zoneOverride ?? zone,
              setCode: cleaned.setCode,
              collectorNumber: cleaned.collectorNumber,
              categoryTag: cleaned.categoryTag,
            });
          }
        }
      }
    }
    if (cards.length > 0) {
      return {
        sourceFormat: 'Cockatrice (.cod XML)',
        deckName,
        cards: mergeEntries(cards),
        warnings: [],
      };
    }
  }

  if (raw.includes('<Deck') && raw.includes('<Cards')) {
    const cards: ParsedCardEntry[] = [];
    const cardTagRegex = /<Cards\b[^>]*\/?>/gi;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = cardTagRegex.exec(raw)) !== null) {
      const rawName = extractXmlAttrClient(tagMatch[0], 'Name');
      const qtyStr = extractXmlAttrClient(tagMatch[0], 'Quantity') || '1';
      const sbStr = (extractXmlAttrClient(tagMatch[0], 'Sideboard') || 'false').toLowerCase();
      const qty = parseInt(qtyStr, 10);
      if (rawName) {
        const cleaned = cleanCardName(rawName);
        if (cleaned.name) {
          cards.push({
            quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
            zone: cleaned.zoneOverride ?? (sbStr === 'true' ? 'sideboard' : 'main'),
            name: cleaned.name,
            setCode: cleaned.setCode,
            collectorNumber: cleaned.collectorNumber,
            categoryTag: cleaned.categoryTag,
          });
        }
      }
    }
    if (cards.length > 0) {
      return { sourceFormat: 'MTGO (.dek XML)', cards: mergeEntries(cards), warnings: [] };
    }
  }
  return null;
}

function parseCsvDeckClient(lines: string[]): ParsedDeckResult | null {
  let delimiter = ',';
  const headerIdx = lines.slice(0, 12).findIndex((l) => {
    const lower = l.toLowerCase();
    for (const d of [',', ';', '\t']) {
      if (
        lower.includes(d) &&
        (lower.includes('name') || lower.includes('card') || lower.includes('title')) &&
        (lower.includes('count') ||
          lower.includes('qty') ||
          lower.includes('quantity') ||
          lower.includes('amount') ||
          lower.includes('copies'))
      ) {
        delimiter = d;
        return true;
      }
    }
    return false;
  });
  if (headerIdx === -1) return null;

  const headers = parseDelimitedLineClient(lines[headerIdx], delimiter).map((h) =>
    h.replace(/^["']|["']$/g, '').trim().toLowerCase()
  );
  const nameCol = headers.findIndex((h) =>
    ['name', 'card name', 'card_name', 'cardname', 'card', 'title'].includes(h)
  );
  const qtyCol = headers.findIndex((h) =>
    ['count', 'quantity', 'qty', 'tradelist count', 'amount', 'copies', 'number'].includes(h)
  );
  const zoneCol = headers.findIndex((h) =>
    ['board', 'section', 'zone', 'type', 'commander', 'category', 'location'].includes(h)
  );
  const setCol = headers.findIndex((h) =>
    ['set code', 'set_code', 'edition', 'set', 'expansion'].includes(h)
  );

  if (nameCol === -1 || qtyCol === -1) return null;

  const cards: ParsedCardEntry[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseDelimitedLineClient(line, delimiter);
    const rawCsvName = cols[nameCol]?.replace(/^["']|["']$/g, '').trim();
    const rawQtyStr = (cols[qtyCol] || '').replace(/^["']|["']$/g, '').trim();
    const rawZoneCol = zoneCol !== -1 ? (cols[zoneCol] || '').replace(/^["']|["']$/g, '').trim().toLowerCase() : '';
    if (
      rawZoneCol.includes('simulation') ||
      rawCsvName?.toLowerCase() === 'simulation metric' ||
      (rawQtyStr !== '' && !/^\d+$/.test(rawQtyStr))
    ) {
      continue;
    }
    const qty = rawQtyStr ? parseInt(rawQtyStr, 10) : 1;
    if (!rawCsvName || isNaN(qty) || qty <= 0) continue;

    const cleaned = cleanCardName(rawCsvName);
    if (!cleaned.name) continue;

    let zone: DeckZone = cleaned.zoneOverride ?? 'main';
    if (!cleaned.zoneOverride && rawZoneCol) {
      if (rawZoneCol.includes('side')) zone = 'sideboard';
      else if (rawZoneCol.includes('command') || rawZoneCol === 'true' || rawZoneCol === 'yes') zone = 'commander';
      else if (rawZoneCol.includes('maybe') || rawZoneCol.includes('considering')) zone = 'maybeboard';
      else if (rawZoneCol.includes('companion')) zone = 'companion';
    }

    const csvSet =
      setCol !== -1 ? cols[setCol]?.replace(/^["']|["']$/g, '').trim().toUpperCase() : undefined;

    cards.push({
      name: cleaned.name,
      quantity: qty,
      zone,
      setCode: csvSet || cleaned.setCode,
      collectorNumber: cleaned.collectorNumber,
      categoryTag: cleaned.categoryTag,
    });
  }

  if (cards.length === 0) return null;
  return {
    sourceFormat: 'CSV Export (ManaBox / Deckbox / Moxfield CSV)',
    cards: mergeEntries(cards),
    warnings: [],
  };
}

function parseJsonDeckClient(raw: string): ParsedDeckResult | null {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object') return null;

    if (Array.isArray(data)) {
      const cards: ParsedCardEntry[] = [];
      for (const item of data) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const rawJsonName = String(rec.name || rec.cardName || rec.card || '').trim();
        const cleaned = cleanCardName(rawJsonName);
        const qty = Number(rec.quantity ?? rec.count ?? rec.qty ?? 1);
        const zRaw = String(rec.zone || rec.board || 'main').toLowerCase();
        const zone: DeckZone =
          cleaned.zoneOverride ??
          (zRaw.includes('command')
            ? 'commander'
            : zRaw.includes('side')
            ? 'sideboard'
            : zRaw.includes('companion')
            ? 'companion'
            : 'main');
        if (cleaned.name) {
          cards.push({
            name: cleaned.name,
            quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
            zone,
            setCode: cleaned.setCode,
            collectorNumber: cleaned.collectorNumber,
            categoryTag: cleaned.categoryTag,
          });
        }
      }
      if (cards.length > 0) {
        return { sourceFormat: 'JSON Decklist', cards: mergeEntries(cards), warnings: [] };
      }
      return null;
    }

    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.cards)) {
      const cards: ParsedCardEntry[] = [];
      for (const rawItem of obj.cards) {
        if (!rawItem || typeof rawItem !== 'object') continue;
        const item = rawItem as {
          quantity?: number;
          categories?: string[];
          name?: string;
          card?: { oracleCard?: { name?: string }; displayName?: string; name?: string };
        };
        const rawName =
          item.card?.oracleCard?.name || item.card?.displayName || item.card?.name || item.name;
        if (!rawName) continue;
        const cleaned = cleanCardName(rawName);
        if (!cleaned.name) continue;
        const cats = (Array.isArray(item.categories) ? item.categories : []).map((c) => String(c).toLowerCase());
        if (cats.includes('maybeboard') || cats.includes('considering')) continue;
        const zone: DeckZone =
          cleaned.zoneOverride ??
          (cats.some((c) => c.includes('commander'))
            ? 'commander'
            : cats.includes('companion')
            ? 'companion'
            : cats.includes('sideboard')
            ? 'sideboard'
            : 'main');
        cards.push({
          name: cleaned.name,
          quantity: Math.max(1, item.quantity || 1),
          zone,
          setCode: cleaned.setCode,
          collectorNumber: cleaned.collectorNumber,
          categoryTag: cleaned.categoryTag,
        });
      }
      if (cards.length > 0) {
        return {
          sourceFormat: 'Archidekt JSON',
          deckName: typeof obj.name === 'string' ? obj.name : undefined,
          cards: mergeEntries(cards),
          warnings: [],
        };
      }
    }

    if (obj.boards || obj.mainboard || obj.commanders) {
      const cards: ParsedCardEntry[] = [];
      const boards = obj.boards as
        | Record<string, { cards?: Record<string, { quantity?: number; card?: { name?: string } }> }>
        | undefined;
      const pull = (
        mapObj: Record<string, { quantity?: number; card?: { name?: string } }> | undefined,
        zone: DeckZone
      ) => {
        for (const item of Object.values(mapObj || {})) {
          if (item?.card?.name) {
            const cleaned = cleanCardName(item.card.name);
            if (!cleaned.name) continue;
            cards.push({
              name: cleaned.name,
              quantity: Math.max(1, item.quantity || 1),
              zone: cleaned.zoneOverride ?? zone,
              setCode: cleaned.setCode,
              collectorNumber: cleaned.collectorNumber,
              categoryTag: cleaned.categoryTag,
            });
          }
        }
      };
      pull(
        boards?.commanders?.cards ||
          (obj.commanders as Record<string, { quantity?: number; card?: { name?: string } }> | undefined),
        'commander'
      );
      pull(
        boards?.companions?.cards ||
          (obj.companions as Record<string, { quantity?: number; card?: { name?: string } }> | undefined),
        'companion'
      );
      pull(
        boards?.mainboard?.cards ||
          (obj.mainboard as Record<string, { quantity?: number; card?: { name?: string } }> | undefined),
        'main'
      );
      pull(
        boards?.sideboard?.cards ||
          (obj.sideboard as Record<string, { quantity?: number; card?: { name?: string } }> | undefined),
        'sideboard'
      );
      if (cards.length > 0) {
        return {
          sourceFormat: 'Moxfield JSON',
          deckName: typeof obj.name === 'string' ? obj.name : undefined,
          cards: mergeEntries(cards),
          warnings: [],
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function classifyClientSectionHeader(line: string): DeckZone | 'ignore' | null {
  const stripped = line
    .replace(/^(?:\/\/|#)+\s*/, '')
    .replace(/^\[|\]$/g, '')
    .replace(/\s*(?:\(\d+\)|\[\d+\])\s*:?\s*$/, '')
    .replace(/:$/, '')
    .trim()
    .toLowerCase();

  if (!stripped) return null;

  if (['about', 'description', 'notes', 'metadata', 'format'].includes(stripped)) {
    return 'ignore';
  }
  if (
    [
      'commander',
      'commanders',
      'command zone',
      'commander / general',
      'general',
      'oathbreaker',
    ].includes(stripped)
  ) {
    return 'commander';
  }
  if (['companion', 'companions'].includes(stripped)) {
    return 'companion';
  }
  if (
    ['deck', 'main', 'mainboard', 'maindeck', 'main deck', 'library', 'cards'].includes(
      stripped
    ) ||
    CLIENT_CATEGORY_HEADERS.has(stripped)
  ) {
    return 'main';
  }
  if (['sideboard', 'side', 'side board', 'sb'].includes(stripped)) {
    return 'sideboard';
  }
  if (
    [
      'maybeboard',
      'maybe',
      'maybe board',
      'considering',
      'wishboard',
      'sideboard / maybeboard',
    ].includes(stripped)
  ) {
    return 'maybeboard';
  }

  return null;
}

function mergeEntries(entries: ParsedCardEntry[]): ParsedCardEntry[] {
  return mergeParsedCardEntries(entries);
}

export function parseDecklistClientSide(rawInput: string): ParsedDeckResult {
  const trimmed = (rawInput || '')
    .replace(/[\uFEFF\u200B-\u200D]/g, '')
    .replace(/[\u00A0\u2009\u202F]/g, ' ')
    .trim();
  if (!trimmed) {
    return { sourceFormat: 'Empty', cards: [], warnings: ['No decklist text provided.'] };
  }

  if (trimmed.startsWith('<')) {
    const xmlParsed = parseXmlDeckClient(trimmed);
    if (xmlParsed) return xmlParsed;
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const jsonParsed = parseJsonDeckClient(trimmed);
    if (jsonParsed) return jsonParsed;
  }

  let lines = trimmed.split(/\r?\n/);

  if (lines.length === 1 && trimmed.includes(',')) {
    const commaParts = trimmed.split(/\s*,\s*(?=\d+\s*[xX]?\s+\S)/).filter(Boolean);
    if (commaParts.length >= 3 && commaParts.filter((p) => /^\d+\s*[xX]?\s*\S+/.test(p)).length >= 2) {
      lines = commaParts;
    }
  }

  if (lines.length >= 2) {
    const csvParsed = parseCsvDeckClient(lines);
    if (csvParsed) return csvParsed;
  }

  let currentZone: DeckZone = 'main';
  let explicitCommanderHeaderSeen = false;
  let commanderCardsInCurrentBlock = 0;
  let deckName: string | undefined;
  let detectedArena = false;
  let detectedMoxfield = false;
  let detectedMtgo = false;
  const cards: ParsedCardEntry[] = [];
  const warnings: string[] = [];

  let currentParagraphIdx = 0;
  let lastLineWasBlank = false;
  const cardParagraphIndices: number[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    let line = lines[idx].trim();
    if (!line) {
      if (!lastLineWasBlank && cards.length > 0) {
        currentParagraphIdx++;
      }
      lastLineWasBlank = true;
      if (currentZone === 'commander' && commanderCardsInCurrentBlock > 0) {
        currentZone = 'main';
        commanderCardsInCurrentBlock = 0;
      }
      if (currentZone === 'companion') {
        currentZone = 'main';
      }
      continue;
    }
    lastLineWasBlank = false;

    if (/^(?:\/\/\s*|#\s*)?(?:Name|Deck\s*Name|Title)\s*[:=-]\s*(.+)$/i.test(line)) {
      deckName = line
        .replace(/^(?:\/\/\s*|#\s*)?(?:Name|Deck\s*Name|Title)\s*[:=-]\s*/i, '')
        .trim();
      continue;
    }

    const inlineCmdMatch = line.match(
      /^(?:\/\/\s*)?(?:Commander|Commanders|General)\s*:\s*(.+)$/i
    );
    if (inlineCmdMatch && inlineCmdMatch[1].trim()) {
      const rhs = inlineCmdMatch[1].trim();
      let qty = 1;
      let cardPart = rhs;
      const qm = rhs.match(/^(\d+)(?:[xX]\s*|\s+[xX]\s+|\s+)(.+)$/);
      if (qm) {
        qty = parseInt(qm[1], 10);
        cardPart = qm[2];
      }
      const cleanedCmd = cleanCardName(cardPart);
      if (cleanedCmd.name) {
        explicitCommanderHeaderSeen = true;
        cards.push({
          name: cleanedCmd.name,
          quantity: Math.max(1, qty),
          zone: 'commander',
          setCode: cleanedCmd.setCode,
          collectorNumber: cleanedCmd.collectorNumber,
          categoryTag: cleanedCmd.categoryTag,
        });
        cardParagraphIndices.push(currentParagraphIdx);
      }
      continue;
    }

    const headerZone = classifyClientSectionHeader(line);
    if (headerZone) {
      if (headerZone !== 'ignore') {
        currentZone = headerZone;
        if (headerZone === 'commander') {
          explicitCommanderHeaderSeen = true;
          commanderCardsInCurrentBlock = 0;
          detectedArena = true;
        } else if (headerZone === 'main') {
          detectedArena = true;
        }
      }
      continue;
    }

    if (line.startsWith('//') || line.startsWith('#')) continue;

    let lineZone: DeckZone = currentZone;
    if (/^SB:\s*/i.test(line)) {
      lineZone = 'sideboard';
      line = line.replace(/^SB:\s*/i, '').trim();
      detectedMtgo = true;
    } else if (/^CMDR:\s*|^COMMANDER:\s*/i.test(line)) {
      lineZone = 'commander';
      explicitCommanderHeaderSeen = true;
      line = line.replace(/^CMDR:\s*|^COMMANDER:\s*/i, '').trim();
    }

    line = line.replace(/^[-•*]\s+/, '').trim();
    if (/^\d+[.)]\s+\S+/.test(line) && !/^\d+\s+[A-Za-z]/.test(line)) {
      line = line.replace(/^\d+[.)]\s+/, '').trim();
    }

    let quantity = 1;
    let remainder = line;
    const qtyMatch =
      line.match(/^(\d+)[xX]\s*(.+)$/) ||
      line.match(/^(\d+)\s+[xX]\s+(.+)$/) ||
      line.match(/^(\d+)\s+(.+)$/);
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1], 10);
      remainder = qtyMatch[2];
    } else if (/^\d+$/.test(line)) {
      continue;
    } else {
      const trailingQty =
        line.match(/^(.+?)\s+[xX]\s*(\d+)$/) ||
        line.match(/^(.+?)\s+(\d+)[xX]$/) ||
        line.match(/^(.+?)\s+\((\d{1,2})\)$/);
      if (trailingQty) {
        remainder = trailingQty[1].trim();
        quantity = parseInt(trailingQty[2], 10);
      }
    }

    if (/\([A-Za-z0-9]{2,6}\)\s*\d+/.test(remainder)) {
      detectedMoxfield = true;
    }

    const cleaned = cleanCardName(remainder);
    if (!cleaned.name) {
      warnings.push(`Skipped unrecognized line ${idx + 1}: "${line}"`);
      continue;
    }

    if (!qtyMatch && idx < 4 && /^(name|format|author|player)\s+/i.test(line)) {
      if (/^name\s+/i.test(line)) deckName = line.replace(/^name\s+/i, '').trim();
      continue;
    }

    if (
      !qtyMatch &&
      /^(?:lands|creatures|artifacts|enchantments|instants|sorceries|planeswalkers|spells)\s*[-–:]\s*\d+$/i.test(
        cleaned.name
      )
    ) {
      currentZone = 'main';
      continue;
    }

    const finalZone = cleaned.zoneOverride ?? lineZone;
    if (finalZone === 'commander') {
      explicitCommanderHeaderSeen = true;
      commanderCardsInCurrentBlock += quantity;
    }

    cards.push({
      name: cleaned.name,
      quantity: Math.max(1, quantity),
      zone: finalZone,
      setCode: cleaned.setCode,
      collectorNumber: cleaned.collectorNumber,
      categoryTag: cleaned.categoryTag,
    });
    cardParagraphIndices.push(currentParagraphIdx);

    if (currentZone === 'commander' && commanderCardsInCurrentBlock >= 2) {
      currentZone = 'main';
    }
  }

  // Plain .txt Commander heuristic: 1 or 2 cards separated by a blank line at the top or bottom of an 85+ card deck
  const totalMainCards = cards
    .filter((c) => c.zone === 'main' || c.zone === 'commander')
    .reduce((acc, c) => acc + c.quantity, 0);

  if (
    !explicitCommanderHeaderSeen &&
    !cards.some((c) => c.zone === 'commander') &&
    totalMainCards >= 85
  ) {
    const firstParaCards = cards.filter(
      (_, i) => cardParagraphIndices[i] === 0 && cards[i].zone === 'main'
    );
    const firstParaQty = firstParaCards.reduce((s, c) => s + c.quantity, 0);

    const maxPara = Math.max(0, ...cardParagraphIndices);
    const lastParaCards =
      maxPara > 0
        ? cards.filter(
            (_, i) => cardParagraphIndices[i] === maxPara && cards[i].zone === 'main'
          )
        : [];
    const lastParaQty = lastParaCards.reduce((s, c) => s + c.quantity, 0);

    if (maxPara > 0 && (firstParaQty === 1 || firstParaQty === 2)) {
      for (const c of firstParaCards) {
        c.zone = 'commander';
      }
    } else if (maxPara > 0 && (lastParaQty === 1 || lastParaQty === 2)) {
      for (const c of lastParaCards) {
        c.zone = 'commander';
      }
    }
  }

  let sourceFormat = 'Plain Decklist';
  if (detectedMoxfield && detectedArena) sourceFormat = 'MTG Arena / Moxfield';
  else if (detectedMoxfield) sourceFormat = 'Moxfield / Archidekt';
  else if (detectedArena) sourceFormat = 'MTG Arena';
  else if (detectedMtgo) sourceFormat = 'MTGO / TappedOut';

  return {
    sourceFormat,
    deckName,
    cards: mergeEntries(cards),
    warnings,
  };
}

/**
 * Rewrites a decklist string so that the selected card name (and optional partner) is explicitly placed in the Commander section.
 */
export function setDecklistCommanderClientSide(
  rawDeckText: string,
  commanderName: string,
  secondaryCommanderName?: string
): string {
  const parsed = parseDecklistClientSide(rawDeckText);
  const targetKey = normalizeCardLookupKey(commanderName);
  const partnerKey = secondaryCommanderName ? normalizeCardLookupKey(secondaryCommanderName) : '';
  if (!targetKey || parsed.cards.length === 0) return rawDeckText;

  const lines: string[] = [];
  if (parsed.deckName) {
    lines.push(`// Name: ${parsed.deckName}`);
  }

  const commanders: ParsedCardEntry[] = [];
  const companions: ParsedCardEntry[] = [];
  const main: ParsedCardEntry[] = [];
  const side: ParsedCardEntry[] = [];

  for (const c of parsed.cards) {
    const key = normalizeCardLookupKey(c.name);
    const matchesPrimary =
      key === targetKey ||
      key.startsWith(`${targetKey} // `) ||
      targetKey.startsWith(`${key} // `);
    const matchesPartner =
      Boolean(partnerKey) &&
      (key === partnerKey ||
        key.startsWith(`${partnerKey} // `) ||
        partnerKey.startsWith(`${key} // `));

    if (matchesPrimary || matchesPartner) {
      commanders.push({ ...c, quantity: 1, zone: 'commander' });
      if (c.quantity > 1) {
        main.push({ ...c, quantity: c.quantity - 1, zone: 'main' });
      }
    } else if (c.zone === 'companion') {
      companions.push(c);
    } else if (c.zone === 'sideboard') {
      side.push(c);
    } else if (c.zone === 'maybeboard') {
      continue;
    } else {
      main.push({ ...c, zone: 'main' });
    }
  }

  if (commanders.length > 0) {
    lines.push('Commander');
    for (const c of commanders) lines.push(`${c.quantity} ${c.name}`);
    lines.push('');
  }
  if (companions.length > 0) {
    lines.push('Companion');
    for (const c of companions) lines.push(`${c.quantity} ${c.name}`);
    lines.push('');
  }
  lines.push('Deck');
  for (const c of main) lines.push(`${c.quantity} ${c.name}`);
  if (side.length > 0) {
    lines.push('', 'Sideboard');
    for (const c of side) lines.push(`${c.quantity} ${c.name}`);
  }

  return lines.join('\n');
}

function normalizeClientDeckUrl(rawUrl: string): URL {
  let cleaned = (rawUrl || '').trim().replace(/^<+|>+$/g, '').trim();
  if (!cleaned) {
    throw new Error('Please enter a deck URL.');
  }
  if (!/^https?:\/\//i.test(cleaned) && /^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }
  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    throw new Error('Please enter a valid http:// or https:// deck URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported.');
  }
  return url;
}

function decodeHtmlEntitiesClient(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function isBotChallengePageClient(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('just a moment...') ||
    lower.includes('attention required! | cloudflare') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('enable javascript and cookies to continue') ||
    lower.includes('verify you are human') ||
    lower.includes('requiring captcha')
  );
}

function extractDeckTextFromHtmlClient(
  html: string
): { rawText: string; parsed: ParsedDeckResult } | null {
  const textareaMatches = html.matchAll(/<textarea[^>]*>([\s\S]*?)<\/textarea>/gi);
  for (const m of textareaMatches) {
    const candidate = decodeHtmlEntitiesClient(m[1] || '').trim();
    if (!candidate) continue;
    const parsed = parseDecklistClientSide(candidate);
    if (parsed.cards.length >= 5) {
      return { rawText: candidate, parsed };
    }
  }

  const preMatches = html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi);
  for (const m of preMatches) {
    const stripped = decodeHtmlEntitiesClient((m[1] || '').replace(/<[^>]+>/g, '')).trim();
    if (!stripped) continue;
    const parsed = parseDecklistClientSide(stripped);
    if (parsed.cards.length >= 5) {
      return { rawText: stripped, parsed };
    }
  }

  return null;
}

async function fetchWithTimeoutClient(
  targetUrl: string,
  timeoutMs = 10000,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, text/html, */*',
        ...(extraHeaders || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function unwrapJinaReaderResponse(raw: string): {
  content: string;
  upstreamStatus?: number;
} {
  const marker = '\nMarkdown Content:\n';
  const idx = raw.indexOf(marker);
  if (idx === -1) {
    return { content: raw };
  }
  const header = raw.slice(0, idx);
  const content = raw.slice(idx + marker.length).trim();
  const errMatch = header.match(/^Warning:\s*Target URL returned error\s+(\d{3})\b/im);
  const upstreamStatus = errMatch ? parseInt(errMatch[1], 10) : undefined;
  return { content, upstreamStatus };
}

async function fetchWithCorsFallback(
  targetUrl: string,
  options?: { expectJson?: boolean; expectHtml?: boolean }
): Promise<string> {
  const host = (() => {
    try {
      return new URL(targetUrl).hostname.replace(/^www\./, '');
    } catch {
      return 'deck host';
    }
  })();

  let targetStatus = 0;
  let sawChallenge = false;

  const isAcceptable = (text: string): boolean => {
    if (!text || text.trim().length === 0) return false;
    if (isBotChallengePageClient(text)) {
      sawChallenge = true;
      return false;
    }
    if (options?.expectJson) {
      try {
        JSON.parse(text);
        return true;
      } catch {
        return false;
      }
    }
    return true;
  };

  // 1. Try direct browser fetch first (works immediately for CORS-enabled APIs like Scryfall / GitHub)
  try {
    const res = await fetchWithTimeoutClient(targetUrl, 5000);
    targetStatus = res.status;
    if (res.ok) {
      const text = await res.text();
      if (isAcceptable(text)) return text;
    }
  } catch {
    // Browser CORS or network error -> fall back to CORS-enabled fetch proxies
  }

  // 2. Try r.jina.ai primary CORS-enabled reader (echoes Origin, <1s for Archidekt JSON / plaintext / HTML)
  try {
    const jinaHeaders = options?.expectHtml ? { 'x-respond-with': 'html' } : undefined;
    const res = await fetchWithTimeoutClient(
      `https://r.jina.ai/${targetUrl}`,
      14000,
      jinaHeaders
    );
    if (res.ok) {
      const raw = await res.text();
      if (isBotChallengePageClient(raw)) {
        sawChallenge = true;
      } else if (options?.expectHtml) {
        if (isAcceptable(raw)) return raw;
      } else {
        const { content, upstreamStatus } = unwrapJinaReaderResponse(raw);
        if (upstreamStatus && upstreamStatus >= 400) {
          targetStatus = upstreamStatus;
        } else if (isAcceptable(content)) {
          return content;
        }
      }
    } else if (res.status >= 400 && res.status !== 429 && res.status < 500) {
      targetStatus = res.status;
    }
  } catch {
    // Fall through to backup CORS proxies
  }

  // If upstream returned a definitive 404 (not found / private deck), fail fast instead of waiting 18s on slow proxies
  if (targetStatus === 404) {
    throw new Error(
      `${host} returned HTTP 404 (not found or private). Make sure the deck URL is public and exact.`
    );
  }

  // 3. Fallback race across independent keyless CORS proxies (18s timeout for large 250KB Commander decks)
  const proxyAttempts: Array<Promise<string>> = [
    (async () => {
      const res = await fetchWithTimeoutClient(
        `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
        18000
      );
      if (!res.ok) {
        throw new Error(`AllOrigins HTTP ${res.status}`);
      }
      const wrapper = (await res.json()) as {
        contents?: string;
        status?: { http_code?: number };
      };
      if (wrapper.status?.http_code && wrapper.status.http_code >= 400) {
        targetStatus = wrapper.status.http_code;
        throw new Error(`Upstream HTTP ${wrapper.status.http_code}`);
      }
      if (!wrapper.contents || !isAcceptable(wrapper.contents)) {
        throw new Error('AllOrigins returned invalid contents');
      }
      return wrapper.contents;
    })(),
    (async () => {
      const res = await fetchWithTimeoutClient(
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
        18000
      );
      if (!res.ok) {
        throw new Error(`CodeTabs HTTP ${res.status}`);
      }
      const text = await res.text();
      if (!isAcceptable(text)) {
        throw new Error('CodeTabs returned invalid or challenge response');
      }
      return text;
    })(),
  ];

  try {
    return await Promise.any(proxyAttempts);
  } catch {
    // All proxies failed; fall through to informative error
  }

  if (sawChallenge || targetStatus === 403) {
    throw new Error(
      `${host} blocked automated browser fetching (HTTP ${targetStatus || 403}). Export or copy the plain-text decklist on ${host} and paste it into the Paste Decklist tab.`
    );
  }
  if (targetStatus === 404) {
    throw new Error(
      `${host} returned HTTP 404 (not found or private). Make sure the deck URL is public and exact.`
    );
  }
  throw new Error(
    `Could not fetch deck from ${host}${targetStatus ? ` (HTTP ${targetStatus})` : ''} due to browser CORS/proxy limits. Copy the exported plain-text decklist on ${host} and paste it in the Paste Decklist tab.`
  );
}

/**
 * Client-side URL importer fallback (used when backend is unavailable or as a secondary path).
 * Supports Scryfall, Archidekt, Moxfield, MTGGoldfish, Deckstats, TappedOut, CubeCobra, MTGTop8, Pastebin, GitHub Gist, and raw text URLs.
 */
export async function importDeckFromUrlClientSide(
  rawUrl: string
): Promise<{ rawText: string; parsed: ParsedDeckResult }> {
  const url = normalizeClientDeckUrl(rawUrl);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  // 1. Scryfall: https://scryfall.com/@user/decks/<uuid> or /decks/<uuid>
  if (host === 'scryfall.com' || host === 'api.scryfall.com') {
    const match = url.pathname.match(/\/decks\/([0-9a-f-]{36})/i);
    if (!match) throw new Error('Could not find a Scryfall deck UUID in that URL.');
    const deckId = match[1];
    try {
      const exportUrl = `https://api.scryfall.com/decks/${deckId}/export/text`;
      const rawText = await fetchWithCorsFallback(exportUrl);
      const parsed = parseDecklistClientSide(rawText);
      if (parsed.cards.length > 0) {
        parsed.sourceFormat = 'Scryfall URL';
        return { rawText, parsed };
      }
    } catch {
      // fallback to JSON Scryfall endpoint
    }

    const jsonText = await fetchWithCorsFallback(`https://api.scryfall.com/decks/${deckId}`, {
      expectJson: true,
    });
    const deckJson = JSON.parse(jsonText) as {
      name?: string;
      entries?: Record<string, Array<{ count?: number; card_digest?: { name?: string } }>>;
    };
    const lines: string[] = [];
    if (deckJson.name) lines.push(`// Name: ${deckJson.name}`);
    const cmdEntries = deckJson.entries?.commanders || [];
    const mainEntries =
      deckJson.entries?.mainboard || [
        ...(deckJson.entries?.nonlands || []),
        ...(deckJson.entries?.lands || []),
      ];
    const sideEntries = deckJson.entries?.sideboard || [];

    if (cmdEntries.length > 0) {
      lines.push('Commander');
      for (const e of cmdEntries) {
        if (e.card_digest?.name) lines.push(`${e.count || 1} ${e.card_digest.name}`);
      }
      lines.push('');
    }
    if (mainEntries.length > 0) {
      lines.push('Deck');
      for (const e of mainEntries) {
        if (e.card_digest?.name) lines.push(`${e.count || 1} ${e.card_digest.name}`);
      }
    }
    if (sideEntries.length > 0) {
      lines.push('', 'Sideboard');
      for (const e of sideEntries) {
        if (e.card_digest?.name) lines.push(`${e.count || 1} ${e.card_digest.name}`);
      }
    }

    const rawText = lines.join('\n');
    const parsed = parseDecklistClientSide(rawText);
    if (parsed.cards.length === 0) {
      throw new Error('The Scryfall deck appears empty or unavailable.');
    }
    parsed.sourceFormat = 'Scryfall URL';
    parsed.deckName = deckJson.name || parsed.deckName;
    return { rawText, parsed };
  }

  // 2. Archidekt: https://archidekt.com/decks/123456/slug
  if (host === 'archidekt.com') {
    const match = url.pathname.match(/\/decks\/(\d+)/);
    if (!match) throw new Error('Could not find an Archidekt deck ID in that URL.');
    const deckId = match[1];
    type ArchidektData = {
      name?: string;
      categories?: Array<{ name?: string; isPremier?: boolean; includedInDeck?: boolean }>;
      cards?: Array<{
        quantity: number;
        categories?: string[];
        card?: { oracleCard?: { name?: string }; displayName?: string };
      }>;
    };

    let data: ArchidektData | null = null;
    try {
      const jsonText = await fetchWithCorsFallback(`https://archidekt.com/api/decks/${deckId}/`, {
        expectJson: true,
      });
      data = JSON.parse(jsonText) as ArchidektData;
    } catch (apiErr) {
      // Fallback to webpage HTML __NEXT_DATA__ extraction
      try {
        const html = await fetchWithCorsFallback(`https://archidekt.com/decks/${deckId}`, {
          expectHtml: true,
        });
        const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
        if (nextMatch?.[1]) {
          const nextJson = JSON.parse(nextMatch[1]) as {
            props?: {
              pageProps?: {
                deck?: ArchidektData;
                redux?: {
                  deck?: {
                    name?: string;
                    categories?:
                      | Record<string, { name?: string; isPremier?: boolean; includedInDeck?: boolean }>
                      | Array<{ name?: string; isPremier?: boolean; includedInDeck?: boolean }>;
                    cardMap?: Record<
                      string,
                      {
                        name?: string;
                        displayName?: string | null;
                        qty?: number;
                        quantity?: number;
                        categories?: string[];
                      }
                    >;
                  };
                };
              };
            };
          };
          const legacyDeck = nextJson?.props?.pageProps?.deck;
          if (legacyDeck?.cards && legacyDeck.cards.length > 0) {
            data = legacyDeck;
          } else {
            const reduxDeck = nextJson?.props?.pageProps?.redux?.deck;
            if (reduxDeck?.cardMap) {
              const catList = Array.isArray(reduxDeck.categories)
                ? reduxDeck.categories
                : Object.values(reduxDeck.categories || {});
              data = {
                name: reduxDeck.name,
                categories: catList,
                cards: Object.values(reduxDeck.cardMap).map((c) => ({
                  quantity: c.qty || c.quantity || 1,
                  categories: c.categories || [],
                  card: {
                    displayName: c.displayName || c.name,
                    oracleCard: { name: c.name },
                  },
                })),
              };
            }
          }
        }
      } catch {
        throw apiErr;
      }
      if (!data) throw apiErr;
    }

    const premierCategories = new Set(
      (data.categories || [])
        .filter((c) => c.isPremier || (c.name || '').toLowerCase().includes('commander'))
        .map((c) => (c.name || '').toLowerCase())
    );
    premierCategories.add('commander');
    premierCategories.add('commanders');
    premierCategories.add('oathbreaker');

    const excludedCategories = new Set(
      (data.categories || [])
        .filter(
          (c) =>
            c.includedInDeck === false &&
            !premierCategories.has((c.name || '').toLowerCase())
        )
        .map((c) => (c.name || '').toLowerCase())
    );
    excludedCategories.add('maybeboard');
    excludedCategories.add('considering');

    const lines: string[] = [];
    if (data.name) lines.push(`// Name: ${data.name}`);
    const commanders: string[] = [];
    const companions: string[] = [];
    const main: string[] = [];
    const side: string[] = [];

    for (const item of data.cards || []) {
      const cardName = item.card?.oracleCard?.name || item.card?.displayName;
      if (!cardName) continue;
      const cats = (Array.isArray(item.categories) ? item.categories : []).map((c) => String(c).toLowerCase());
      if (cats.some((c) => excludedCategories.has(c))) continue;
      if (cats.some((c) => premierCategories.has(c))) {
        commanders.push(`${item.quantity} ${cardName}`);
      } else if (cats.includes('companion')) {
        companions.push(`${item.quantity} ${cardName}`);
      } else if (cats.includes('sideboard')) {
        side.push(`${item.quantity} ${cardName}`);
      } else {
        main.push(`${item.quantity} ${cardName}`);
      }
    }

    if (commanders.length > 0) lines.push('Commander', ...commanders, '');
    if (companions.length > 0) lines.push('Companion', ...companions, '');
    lines.push('Deck', ...main);
    if (side.length > 0) lines.push('', 'Sideboard', ...side);

    const rawText = lines.join('\n');
    const parsed = parseDecklistClientSide(rawText);
    if (parsed.cards.length === 0) {
      throw new Error('The Archidekt deck appears empty or only contains excluded/maybeboard cards.');
    }
    parsed.sourceFormat = 'Archidekt URL';
    parsed.deckName = data.name || parsed.deckName;
    return { rawText, parsed };
  }

  // 3. Moxfield: https://www.moxfield.com/decks/<publicId>
  if (host === 'moxfield.com') {
    const match = url.pathname.match(/\/decks\/([A-Za-z0-9_-]+)/);
    if (!match) throw new Error('Could not find a Moxfield deck ID in that URL.');
    const deckId = match[1];
    const endpoints = [
      `https://api2.moxfield.com/v3/decks/all/${deckId}`,
      `https://api2.moxfield.com/v2/decks/all/${deckId}`,
      `https://api.moxfield.com/v2/decks/all/${deckId}`,
    ];

    let data: {
      name?: string;
      commanders?: Record<string, { quantity: number; card?: { name?: string } }>;
      companions?: Record<string, { quantity: number; card?: { name?: string } }>;
      mainboard?: Record<string, { quantity: number; card?: { name?: string } }>;
      sideboard?: Record<string, { quantity: number; card?: { name?: string } }>;
      boards?: Record<
        string,
        { cards?: Record<string, { quantity: number; card?: { name?: string } }> }
      >;
    } | null = null;

    for (const ep of endpoints) {
      try {
        const jsonText = await fetchWithCorsFallback(ep, { expectJson: true });
        const parsedJson = JSON.parse(jsonText);
        if (parsedJson && (parsedJson.boards || parsedJson.mainboard)) {
          data = parsedJson;
          break;
        }
      } catch {
        // try next endpoint
      }
    }

    if (!data) {
      throw new Error(
        'Moxfield blocked automated fetching due to Cloudflare protection. On Moxfield, click "Export" -> "Copy for MTGA" or "Copy Plain Text" and paste it into the Paste Decklist tab!'
      );
    }

    const lines: string[] = [];
    if (data.name) lines.push(`// Name: ${data.name}`);

    const commanders = Object.values(data.boards?.commanders?.cards || data.commanders || {});
    const companions = Object.values(data.boards?.companions?.cards || data.companions || {});
    const mainboard = Object.values(data.boards?.mainboard?.cards || data.mainboard || {});
    const sideboard = Object.values(data.boards?.sideboard?.cards || data.sideboard || {});

    if (commanders.length > 0) {
      lines.push('Commander');
      for (const c of commanders) if (c.card?.name) lines.push(`${c.quantity} ${c.card.name}`);
      lines.push('');
    }
    if (companions.length > 0) {
      lines.push('Companion');
      for (const c of companions) if (c.card?.name) lines.push(`${c.quantity} ${c.card.name}`);
      lines.push('');
    }
    lines.push('Deck');
    for (const c of mainboard) if (c.card?.name) lines.push(`${c.quantity} ${c.card.name}`);
    if (sideboard.length > 0) {
      lines.push('', 'Sideboard');
      for (const c of sideboard) if (c.card?.name) lines.push(`${c.quantity} ${c.card.name}`);
    }

    const rawText = lines.join('\n');
    const parsed = parseDecklistClientSide(rawText);
    if (parsed.cards.length === 0) {
      throw new Error('The Moxfield deck appears empty or has no mainboard/commander cards.');
    }
    parsed.sourceFormat = 'Moxfield URL';
    parsed.deckName = data.name || parsed.deckName;
    return { rawText, parsed };
  }

  // 4. MTGGoldfish: https://www.mtggoldfish.com/deck/123456 or /archetype/...
  if (host === 'mtggoldfish.com') {
    let deckId = url.pathname.match(/\/deck\/(?:custom\/|visual\/)?(\d+)/)?.[1] || null;
    if (!deckId) {
      const html = await fetchWithCorsFallback(url.toString(), { expectHtml: true });
      const dlMatch = html.match(/\/deck\/(?:arena_)?download\/(\d+)/i);
      if (dlMatch?.[1]) {
        deckId = dlMatch[1];
      } else {
        const extracted = extractDeckTextFromHtmlClient(html);
        if (extracted) {
          extracted.parsed.sourceFormat = 'MTGGoldfish URL';
          return extracted;
        }
      }
    }
    if (!deckId) {
      throw new Error(
        'Could not find a downloadable MTGGoldfish deck ID in that URL. Paste a mtggoldfish.com/deck/<id> link or copy its Export text.'
      );
    }

    let rawText = '';
    try {
      const arenaHtml = await fetchWithCorsFallback(
        `https://www.mtggoldfish.com/deck/arena_download/${deckId}`,
        { expectHtml: true }
      );
      const extracted = extractDeckTextFromHtmlClient(arenaHtml);
      if (extracted) rawText = extracted.rawText;
    } catch {
      // fall through to /deck/download
    }

    if (!rawText) {
      rawText = await fetchWithCorsFallback(`https://www.mtggoldfish.com/deck/download/${deckId}`);
    }

    if (rawText.includes('<!DOCTYPE html') || rawText.includes('<html')) {
      const extracted = extractDeckTextFromHtmlClient(rawText);
      if (extracted) {
        extracted.parsed.sourceFormat = 'MTGGoldfish URL';
        return extracted;
      }
      throw new Error('MTGGoldfish returned HTML instead of deck text. Please paste the exported decklist text.');
    }
    const parsed = parseDecklistClientSide(rawText);
    if (parsed.cards.length === 0) {
      throw new Error('No cards were found in the MTGGoldfish deck export.');
    }
    parsed.sourceFormat = 'MTGGoldfish URL';
    return { rawText, parsed };
  }

  // 5. Deckstats: https://deckstats.net/decks/123/456-slug
  if (host === 'deckstats.net') {
    const cleanUrl = new URL(url.toString());
    cleanUrl.searchParams.set('export_txt', '1');
    const rawText = await fetchWithCorsFallback(cleanUrl.toString());
    if (rawText.includes('<!DOCTYPE html') || rawText.includes('<html')) {
      const extracted = extractDeckTextFromHtmlClient(rawText);
      if (extracted) {
        extracted.parsed.sourceFormat = 'Deckstats URL';
        return extracted;
      }
      throw new Error('Deckstats returned HTML instead of plain text. Copy the text export and paste it.');
    }
    const parsed = parseDecklistClientSide(rawText);
    if (parsed.cards.length === 0) {
      throw new Error('No cards were found in the Deckstats export.');
    }
    parsed.sourceFormat = 'Deckstats URL';
    return { rawText, parsed };
  }

  // 6. TappedOut: https://tappedout.net/mtg-decks/slug/
  if (host === 'tappedout.net') {
    const cleanPath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    const cleanUrl = `${url.origin}${cleanPath}?fmt=txt`;
    const rawText = await fetchWithCorsFallback(cleanUrl);
    if (rawText.includes('<!DOCTYPE html') || rawText.includes('<html')) {
      const extracted = extractDeckTextFromHtmlClient(rawText);
      if (extracted) {
        extracted.parsed.sourceFormat = 'TappedOut URL';
        return extracted;
      }
      throw new Error('TappedOut returned HTML instead of deck text. Please copy & paste the decklist text.');
    }
    const parsed = parseDecklistClientSide(rawText);
    if (parsed.cards.length === 0) {
      throw new Error('No cards were found in the TappedOut export.');
    }
    parsed.sourceFormat = 'TappedOut URL';
    return { rawText, parsed };
  }

  // 7. CubeCobra: https://cubecobra.com/cube/list/<id>
  if (host === 'cubecobra.com') {
    const match = url.pathname.match(/\/cube\/(?:list|overview|playtest|analysis|about)\/([A-Za-z0-9_-]+)/i);
    if (!match) throw new Error('Could not find a CubeCobra cube ID in that URL.');
    const rawText = await fetchWithCorsFallback(
      `https://cubecobra.com/cube/download/plaintext/${match[1]}`
    );
    const parsed = parseDecklistClientSide(rawText);
    if (parsed.cards.length === 0) throw new Error('No cards were found in that CubeCobra list.');
    parsed.sourceFormat = 'CubeCobra URL';
    return { rawText, parsed };
  }

  // 8. MTGTop8: https://www.mtgtop8.com/event?e=...&d=123456
  if (host === 'mtgtop8.com') {
    const deckId = url.searchParams.get('d');
    if (deckId && /^\d+$/.test(deckId)) {
      const rawText = await fetchWithCorsFallback(`https://www.mtgtop8.com/mtgo?d=${deckId}`);
      const parsed = parseDecklistClientSide(rawText);
      if (parsed.cards.length > 0) {
        parsed.sourceFormat = 'MTGTop8 URL';
        return { rawText, parsed };
      }
    }
  }

  // 9. Pastebin: pastebin.com/<id> -> pastebin.com/raw/<id>
  if (host === 'pastebin.com' && !url.pathname.startsWith('/raw/')) {
    const idMatch = url.pathname.match(/^\/([A-Za-z0-9]+)$/);
    if (idMatch) {
      const rawText = await fetchWithCorsFallback(`https://pastebin.com/raw/${idMatch[1]}`);
      const parsed = parseDecklistClientSide(rawText);
      if (parsed.cards.length === 0) throw new Error('No Magic cards found in that Pastebin paste.');
      parsed.sourceFormat = 'Pastebin URL';
      return { rawText, parsed };
    }
  }

  // 10. GitHub Gist: https://gist.github.com/user/<id>
  if (host === 'gist.github.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    const gistId = parts.length >= 2 ? parts[1] : parts[0];
    if (gistId && /^[0-9a-f]+$/i.test(gistId)) {
      const jsonText = await fetchWithCorsFallback(`https://api.github.com/gists/${gistId}`, {
        expectJson: true,
      });
      const gist = JSON.parse(jsonText) as {
        description?: string;
        files?: Record<string, { filename?: string; content?: string }>;
      };
      for (const file of Object.values(gist.files || {})) {
        if (!file.content) continue;
        const parsed = parseDecklistClientSide(file.content);
        if (parsed.cards.length > 0) {
          parsed.sourceFormat = 'GitHub Gist URL';
          if (!parsed.deckName && gist.description) parsed.deckName = gist.description;
          return { rawText: file.content, parsed };
        }
      }
    }
  }

  // 11. Generic plain-text or HTML textarea URL fallback
  const text = await fetchWithCorsFallback(url.toString());
  if (text.includes('<!DOCTYPE html') || text.includes('<html')) {
    const extracted = extractDeckTextFromHtmlClient(text);
    if (extracted) {
      extracted.parsed.sourceFormat = `URL Import (${host})`;
      return extracted;
    }
    throw new Error(
      `Direct URL import from ${host} requires exporting the text list. Copy the MTGA / Plain Text export from ${host} and paste it into the Paste Decklist tab!`
    );
  }
  const parsed = parseDecklistClientSide(text);
  if (parsed.cards.length === 0) {
    throw new Error('Could not find any Magic cards at that URL.');
  }
  parsed.sourceFormat = `URL Import (${host})`;
  return { rawText: text, parsed };
}

// 2. Direct Browser Scryfall Resolution (CORS-enabled)
interface ScryfallFace {
  name?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  image_uris?: { normal?: string; large?: string; small?: string };
}

interface ScryfallRawCard {
  id: string;
  oracle_id?: string;
  name: string;
  set?: string;
  set_name?: string;
  collector_number?: string;
  released_at?: string;
  rarity?: string;
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
  scryfall_uri?: string;
  image_uris?: { normal?: string; large?: string; small?: string };
  card_faces?: ScryfallFace[];
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

const MAX_BROWSER_CARD_CACHE_ENTRIES = 600;
const browserCardCache = new Map<string, ScryfallRawCard>();
const CLIENT_USED_LEGALITY_KEYS = [
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

function compactClientScryfallCard(raw: ScryfallRawCard): ScryfallRawCard {
  const compactLegalities: Record<string, string> | undefined = raw.legalities
    ? (() => {
        const out: Record<string, string> = {};
        for (const k of CLIENT_USED_LEGALITY_KEYS) {
          if (raw.legalities?.[k]) out[k] = raw.legalities[k];
        }
        return out;
      })()
    : undefined;

  return {
    id: raw.id,
    oracle_id: raw.oracle_id,
    name: raw.name,
    set: raw.set,
    set_name: raw.set_name,
    collector_number: raw.collector_number,
    released_at: raw.released_at,
    rarity: raw.rarity,
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
    scryfall_uri: raw.scryfall_uri,
    image_uris: raw.image_uris
      ? {
          normal: raw.image_uris.normal,
          large: raw.image_uris.normal ? undefined : raw.image_uris.large,
        }
      : undefined,
    card_faces: Array.isArray(raw.card_faces)
      ? raw.card_faces.map((f) => ({
          name: f.name,
          mana_cost: f.mana_cost,
          type_line: f.type_line,
          oracle_text: f.oracle_text,
          colors: f.colors,
          power: f.power,
          toughness: f.toughness,
          image_uris: f.image_uris
            ? {
                normal: f.image_uris.normal,
                large: f.image_uris.normal ? undefined : f.image_uris.large,
              }
            : undefined,
        }))
      : undefined,
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
  };
}

function setBrowserCardCacheEntry(key: string, card: ScryfallRawCard): void {
  if (!key) return;
  if (browserCardCache.has(key)) {
    browserCardCache.delete(key);
  } else if (browserCardCache.size >= MAX_BROWSER_CARD_CACHE_ENTRIES) {
    const oldestKey = browserCardCache.keys().next().value;
    if (oldestKey !== undefined) {
      browserCardCache.delete(oldestKey);
    }
  }
  browserCardCache.set(key, card);
}

function getBrowserCardCacheEntry(key: string): ScryfallRawCard | undefined {
  const hit = browserCardCache.get(key);
  if (hit) {
    browserCardCache.delete(key);
    browserCardCache.set(key, hit);
  }
  return hit;
}

function normalizeKey(name: string): string {
  return normalizeCardLookupKey(name);
}

function parseNum(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = typeof val === 'number' ? val : parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

export function buildClientMarketplaceUrls(
  cardName: string,
  setName?: string,
  purchaseUris?: ScryfallRawCard['purchase_uris']
) {
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

function mapScryfallToClientMetadata(
  raw: ScryfallRawCard,
  format: Exclude<DeckFormat, 'auto'> = 'commander'
): CardMetadata {
  const face0 = raw.card_faces?.[0];
  const face1 = raw.card_faces?.[1];
  const typeLine = raw.type_line || face0?.type_line || '';
  const frontType = face0?.type_line || typeLine;
  const backType = face1?.type_line || '';
  const manaCost = raw.mana_cost ?? face0?.mana_cost ?? '';
  const oracleText =
    raw.oracle_text ?? raw.card_faces?.map((f) => f.oracle_text || '').join('\n') ?? '';
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
      (oracleLower.includes('look at the top') && oracleLower.includes('into your hand')));

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
      (oracleLower.includes('deals ') && oracleLower.includes('damage to target')) ||
      (oracleLower.includes('return target') && oracleLower.includes('to its owner')) ||
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

  const marketUrls = buildClientMarketplaceUrls(raw.name, raw.set_name, raw.purchase_uris);

  let legalInFormat = true;
  if (format !== 'casual60' && format !== 'limited') {
    const legKey = format === 'commander' ? 'commander' : format;
    const status = raw.legalities?.[legKey];
    if (status && status !== 'legal' && status !== 'restricted') {
      legalInFormat = false;
    }
  }

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
  }
  if (
    (isLand || isRamp) &&
    (oracleLower.includes('any color') || oracleLower.includes('any one color'))
  ) {
    for (const c of ['W', 'U', 'B', 'R', 'G']) {
      if (!producedMana.includes(c)) producedMana.push(c);
    }
  }

  const tcgUsd = parseNum(raw.prices?.usd);

  return {
    name: raw.name,
    manaCost,
    cmc: typeof raw.cmc === 'number' ? raw.cmc : 0,
    typeLine,
    oracleText,
    colors: raw.colors ?? face0?.colors ?? [],
    colorIdentity: raw.color_identity ?? [],
    power: raw.power ?? face0?.power,
    toughness: raw.toughness ?? face0?.toughness,
    producedMana: Array.from(new Set(producedMana)),
    isLand,
    isMdfcLand,
    entersTappedLikely,
    isRamp,
    isDraw,
    isRemoval,
    isBoardWipe,
    isProtection,
    imageUri,
    backImageUri,
    priceUsd: tcgUsd,
    priceFoilUsd: parseNum(raw.prices?.usd_foil),
    priceEur: parseNum(raw.prices?.eur),
    priceTix: parseNum(raw.prices?.tix),
    cardKingdomPriceUsd: tcgUsd !== null ? Number((tcgUsd * 1.12).toFixed(2)) : null,
    cardKingdomUrl: marketUrls.cardKingdom,
    tcgplayerUrl: marketUrls.tcgplayer,
    cardmarketUrl: marketUrls.cardmarket,
    cardhoarderUrl: marketUrls.cardhoarder,
    ebayUrl: marketUrls.ebayListings,
    setCode: raw.set ? raw.set.toUpperCase() : undefined,
    setName: raw.set_name,
    collectorNumber: raw.collector_number,
    scryfallUri:
      raw.scryfall_uri || `https://scryfall.com/search?q=${encodeURIComponent(raw.name)}`,
    legalInFormat,
    rarity: raw.rarity || 'common',
  };
}

function buildClientScryfallHeaders(jsonBody = false): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (jsonBody) {
    headers['Content-Type'] = 'application/json';
  }
  // Browsers forbid setting User-Agent from JS and supply their own; Node.js sends "node" which Scryfall rejects (HTTP 400).
  if (typeof window === 'undefined') {
    headers['User-Agent'] = 'UmbrasPass/1.0';
  }
  return headers;
}

function toClientScryfallQueryName(name: string): string {
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

function cacheClientScryfallCard(rawCard: ScryfallRawCard, queriedName?: string): void {
  if (!rawCard?.name) return;
  const card = compactClientScryfallCard(rawCard);
  setBrowserCardCacheEntry(normalizeKey(card.name), card);
  if (card.name.includes(' // ')) {
    const [frontName, backName] = card.name.split(' // ');
    if (frontName) setBrowserCardCacheEntry(normalizeKey(frontName), card);
    if (backName) setBrowserCardCacheEntry(normalizeKey(backName), card);
    setBrowserCardCacheEntry(normalizeKey(card.name.replace(' // ', ' / ')), card);
  }
  if (queriedName) {
    setBrowserCardCacheEntry(normalizeKey(queriedName), card);
  }
}

async function fetchSingleClientScryfallCard(rawName: string): Promise<ScryfallRawCard | null> {
  const queryName = toClientScryfallQueryName(rawName);
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
            headers: buildClientScryfallHeaders(false),
          }
        );
        if (fuzzyRes.ok) {
          const card = (await fuzzyRes.json()) as ScryfallRawCard;
          cacheClientScryfallCard(card, rawName);
          if (queryName !== rawName) {
            cacheClientScryfallCard(card, queryName);
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

export async function resolveCardsWithBrowserScryfall(
  names: string[],
  format: Exclude<DeckFormat, 'auto'> = 'commander'
): Promise<Map<string, CardMetadata>> {
  const uniqueNames = Array.from(
    new Set(
      (Array.isArray(names) ? names : [])
        .filter((n): n is string => typeof n === 'string')
        .map((n) => n.trim())
        .filter(Boolean)
    )
  );
  const missingNames = uniqueNames.filter(
    (n) =>
      !browserCardCache.has(normalizeKey(n)) &&
      !browserCardCache.has(normalizeKey(toClientScryfallQueryName(n)))
  );

  for (let i = 0; i < missingNames.length; i += 75) {
    const batch = missingNames.slice(i, i + 75);
    const identifiers = batch.map((name) => ({ name: toClientScryfallQueryName(name) }));

    let batchResolved = false;
    for (let attempt = 0; attempt < 2 && !batchResolved; attempt++) {
      try {
        const res = await fetch('https://api.scryfall.com/cards/collection', {
          method: 'POST',
          headers: buildClientScryfallHeaders(true),
          body: JSON.stringify({ identifiers }),
        });

        if (res.ok) {
          batchResolved = true;
          const payload = (await res.json()) as {
            data?: ScryfallRawCard[];
            not_found?: Array<{ name?: string }>;
          };

          for (const card of payload.data || []) {
            cacheClientScryfallCard(card);
          }

          const notFoundNames = new Set(
            (payload.not_found || [])
              .map((nf) => (nf?.name ? normalizeKey(nf.name) : ''))
              .filter(Boolean)
          );
          for (const reqName of batch) {
            const key = normalizeKey(reqName);
            const qKey = normalizeKey(toClientScryfallQueryName(reqName));
            if (browserCardCache.has(key)) continue;
            const qHit = getBrowserCardCacheEntry(qKey);
            if (qHit) {
              setBrowserCardCacheEntry(key, qHit);
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
                cacheClientScryfallCard(matched, reqName);
              }
            }
          }

          const notFound = payload.not_found || [];
          for (let nfIdx = 0; nfIdx < notFound.length; nfIdx++) {
            const nf = notFound[nfIdx];
            if (!nf.name) continue;
            if (nfIdx > 0) {
              await new Promise((r) => setTimeout(r, 110));
            }
            await fetchSingleClientScryfallCard(nf.name);
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

    if (!batchResolved && typeof window === 'undefined') {
      for (let bIdx = 0; bIdx < batch.length; bIdx++) {
        const cardName = batch[bIdx];
        if (
          !browserCardCache.has(normalizeKey(cardName)) &&
          !browserCardCache.has(normalizeKey(toClientScryfallQueryName(cardName)))
        ) {
          if (bIdx > 0) {
            await new Promise((r) => setTimeout(r, 110));
          }
          await fetchSingleClientScryfallCard(cardName);
        }
      }
    }
  }

  const result = new Map<string, CardMetadata>();
  const stillMissing: string[] = [];
  for (const name of uniqueNames) {
    const key = normalizeKey(name);
    const cached =
      getBrowserCardCacheEntry(key) ||
      getBrowserCardCacheEntry(normalizeKey(toClientScryfallQueryName(name)));
    if (cached) {
      result.set(key, mapScryfallToClientMetadata(cached, format));
    } else {
      stillMissing.push(name);
    }
  }

  // If browser direct Scryfall calls failed/blocked (e.g., CORS/proxy/rate limit), try our own backend Scryfall resolver proxy
  if (stillMissing.length > 0 && typeof window !== 'undefined') {
    try {
      const proxyRes = await fetch('/api/cards/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: stillMissing, format }),
      });
      const proxyData = await safeParseApiJson<{ cards?: Record<string, CardMetadata> }>(proxyRes);
      if (proxyRes.ok && proxyData?.cards) {
        for (const [k, meta] of Object.entries(proxyData.cards)) {
          if (meta && typeof meta === 'object') {
            result.set(normalizeKey(k), meta);
            if (meta.name) {
              result.set(normalizeKey(meta.name), meta);
            }
          }
        }
      }
    } catch {
      // Ignore proxy fallback failure when genuinely offline
    }
  }

  return result;
}

export async function fetchCardPrintingsFromBrowserScryfall(
  cardName: string
): Promise<CardPrintingsResponse> {
  const cleanCardNameQuery = toClientScryfallQueryName(cardName);
  const namedRes = await fetch(
    `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanCardNameQuery)}`
  );
  if (!namedRes.ok) {
    throw new Error(`Card "${cardName}" was not found on Scryfall.`);
  }
  const canonical = (await namedRes.json()) as ScryfallRawCard;
  const face0 = canonical.card_faces?.[0];

  const mapPrinting = (raw: ScryfallRawCard): CardPrinting => {
    const f0 = raw.card_faces?.[0];
    const f1 = raw.card_faces?.[1];
    const imageUri =
      raw.image_uris?.normal ||
      raw.image_uris?.large ||
      f0?.image_uris?.normal ||
      f0?.image_uris?.large ||
      '';
    const backImageUri = f1?.image_uris?.normal || f1?.image_uris?.large;
    const urls = buildClientMarketplaceUrls(raw.name, raw.set_name, raw.purchase_uris);
    const tcgUsd = parseNum(raw.prices?.usd);

    return {
      scryfallId: raw.id,
      name: raw.name,
      setCode: (raw.set || 'MTG').toUpperCase(),
      setName: raw.set_name || 'Magic Set',
      collectorNumber: raw.collector_number || '1',
      releasedAt: raw.released_at || '2024-01-01',
      rarity: raw.rarity || 'common',
      imageUri,
      backImageUri,
      scryfallUri:
        raw.scryfall_uri || `https://scryfall.com/search?q=${encodeURIComponent(raw.name)}`,
      prices: {
        tcgplayerUsd: tcgUsd,
        tcgplayerFoilUsd: parseNum(raw.prices?.usd_foil),
        tcgplayerEtchedUsd: parseNum(raw.prices?.usd_etched),
        cardKingdomUsd: tcgUsd !== null ? Number((tcgUsd * 1.12).toFixed(2)) : null,
        cardKingdomFoilUsd: null,
        cardKingdomBuyUsd: null,
        cardKingdomQty: null,
        cardmarketEur: parseNum(raw.prices?.eur),
        cardmarketFoilEur: parseNum(raw.prices?.eur_foil),
        cardhoarderTix: parseNum(raw.prices?.tix),
      },
      urls,
    };
  };

  const printings: CardPrinting[] = [];
  if (canonical.oracle_id) {
    try {
      const printsRes = await fetch(
        `https://api.scryfall.com/cards/search?order=released&q=oracleid%3A${canonical.oracle_id}&unique=prints`
      );
      if (printsRes.ok) {
        const pageData = (await printsRes.json()) as { data?: ScryfallRawCard[] };
        for (const item of pageData.data || []) {
          if (item.image_uris?.normal || item.card_faces?.[0]?.image_uris?.normal) {
            printings.push(mapPrinting(item));
          }
        }
      }
    } catch {
      // fallback to canonical
    }
  }
  if (printings.length === 0) {
    printings.push(mapPrinting(canonical));
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

export async function searchMtgDatabaseFromBrowserScryfall(
  query: string
): Promise<CardMetadata[]> {
  const cleanQuery = typeof query === 'string' ? query.trim() : '';
  const res = await fetch(
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(cleanQuery)}&order=edhrec`
  );
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Scryfall search failed (HTTP ${res.status}).`);
  }
  const payload = (await res.json()) as { data?: ScryfallRawCard[] };
  return (payload.data || [])
    .slice(0, 24)
    .map((raw) => mapScryfallToClientMetadata(raw, 'commander'));
}

// 3. Client-Side Deterministic Metrics & Fallback Deck Analyzer
function detectClientFormat(
  entries: ParsedCardEntry[],
  requestedFormat: DeckFormat
): Exclude<DeckFormat, 'auto'> {
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

const BASIC_LAND_BY_COLOR: Record<ManaColor, string> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
  C: 'Wastes',
};

const STAPLE_UPGRADES_BY_COLOR: Record<
  string,
  Array<{ name: string; role: CardAddRecommendation['role']; reason: string }>
> = {
  W: [
    {
      name: 'Swords to Plowshares',
      role: 'Removal',
      reason: 'Instant-speed 1-mana exile removal that cleanly answers any creature threat.',
    },
    {
      name: 'Path to Exile',
      role: 'Removal',
      reason: 'Efficient 1-mana instant exile interaction to keep opposing boards in check.',
    },
    {
      name: 'Get Lost',
      role: 'Removal',
      reason: 'Instant 2-mana answer for creatures, enchantments, and planeswalkers.',
    },
    {
      name: 'Generous Gift',
      role: 'Removal',
      reason: 'Instant-speed catch-all removal that destroys any permanent including problematic lands.',
    },
    {
      name: 'Esper Sentinel',
      role: 'Card Draw',
      reason: '1-mana tax and draw engine that keeps your hand full as opponents cast noncreature spells.',
    },
    {
      name: 'Thraben Inspector',
      role: 'Card Draw',
      reason: 'Efficient 1-drop that replaces itself with a Clue token across Pauper and 60-card formats.',
    },
  ],
  U: [
    {
      name: 'Counterspell',
      role: 'Protection',
      reason: 'Unconditional 2-mana instant interaction to stop board wipes or game-winning threats.',
    },
    {
      name: 'Negate',
      role: 'Protection',
      reason: '2-mana instant countermagic that protects your board or stops key noncreature threats.',
    },
    {
      name: 'Consider',
      role: 'Card Draw',
      reason: '1-mana instant cantrip with surveil that smooths early land drops and fills the graveyard.',
    },
    {
      name: 'Opt',
      role: 'Card Draw',
      reason: 'Instant 1-mana scry-and-draw cantrip legal across Standard, Pioneer, Modern, and Commander.',
    },
    {
      name: 'Ponder',
      role: 'Card Draw',
      reason: 'Low-cost card selection that smooths early land drops and finds key pieces.',
    },
    {
      name: 'Pongify',
      role: 'Removal',
      reason: '1-mana instant creature removal to neutralize must-answer threats on curve.',
    },
    {
      name: 'Preordain',
      role: 'Card Draw',
      reason: '1-mana scry-and-draw cantrip that prevents early mana screw or flood.',
    },
  ],
  B: [
    {
      name: 'Go for the Throat',
      role: 'Removal',
      reason: 'Clean 2-mana instant creature removal across Standard, Pioneer, Modern, and Commander.',
    },
    {
      name: 'Fatal Push',
      role: 'Removal',
      reason: '1-mana instant removal that cleanly answers early creatures.',
    },
    {
      name: "Night's Whisper",
      role: 'Card Draw',
      reason: 'Reliable 2-mana draw-two spell that keeps cards flowing without stalling tempo.',
    },
    {
      name: 'Infernal Grasp',
      role: 'Removal',
      reason: 'Unconditional 2-mana instant creature destruction.',
    },
    {
      name: 'Sign in Blood',
      role: 'Card Draw',
      reason: '2-mana card draw that refills your hand early to hit land drops consistently.',
    },
    {
      name: 'Feed the Swarm',
      role: 'Removal',
      reason: 'Flexible black removal that answers both creatures and troublesome enchantments.',
    },
  ],
  R: [
    {
      name: 'Lightning Bolt',
      role: 'Removal',
      reason: 'Premier 1-mana instant burn and creature removal spell.',
    },
    {
      name: 'Abrade',
      role: 'Removal',
      reason: 'Modal 2-mana instant that destroys key artifacts or removes early creatures.',
    },
    {
      name: 'Play with Fire',
      role: 'Removal',
      reason: '1-mana instant burn with scry selection that clears early threats.',
    },
    {
      name: 'Chaos Warp',
      role: 'Removal',
      reason: 'Flexible instant removal that answers any permanent type, including enchantments.',
    },
    {
      name: 'Faithless Looting',
      role: 'Card Draw',
      reason: 'Fast 1-mana card filtering to dig past excess lands or find early plays.',
    },
    {
      name: 'Blasphemous Act',
      role: 'Board Wipe',
      reason: 'High-efficiency board reset that often costs just 1 red mana on crowded tables.',
    },
  ],
  G: [
    {
      name: 'Llanowar Elves',
      role: 'Mana Ramp',
      reason: '1-mana mana dork that accelerates your curve starting turn 2.',
    },
    {
      name: 'Cultivate',
      role: 'Mana Ramp',
      reason: 'Ramps one basic land onto the battlefield and guarantees your next land drop.',
    },
    {
      name: 'Rampant Growth',
      role: 'Mana Ramp',
      reason: '2-mana land ramp that fixes colors and thins your deck.',
    },
    {
      name: 'Beast Within',
      role: 'Removal',
      reason: 'Instant-speed catch-all removal for any troublesome permanent.',
    },
    {
      name: "Nature's Lore",
      role: 'Mana Ramp',
      reason: '2-mana ramp spell that puts a Forest or typed dual land onto the battlefield untapped.',
    },
    {
      name: 'Harmonize',
      role: 'Card Draw',
      reason: 'Unconditional green draw-three spell to reload your hand in the midgame.',
    },
  ],
  C: [
    {
      name: 'Arcane Signet',
      role: 'Mana Ramp',
      reason: 'Untapped 2-mana rock that produces any color in your commander identity.',
    },
    {
      name: 'Fellwar Stone',
      role: 'Mana Ramp',
      reason: 'Efficient 2-mana ramp piece that enters untapped for immediate mana access.',
    },
    {
      name: 'Mind Stone',
      role: 'Mana Ramp',
      reason: '2-mana untapped ramp rock that can be cashed in for a card later in the game.',
    },
    {
      name: 'Reckoner Bankbuster',
      role: 'Card Draw',
      reason: '2-mana colorless card-advantage engine that draws cards across 60-card and Commander games.',
    },
  ],
};

export function serializeResolvedDeckToText(
  cards: ResolvedDeckCard[],
  deckName?: string
): string {
  const consolidated = consolidateResolvedDeckCards(cards);
  const commanders = consolidated.filter((c) => c.zone === 'commander');
  const companions = consolidated.filter((c) => c.zone === 'companion');
  const main = consolidated.filter((c) => c.zone === 'main');
  const side = consolidated.filter((c) => c.zone === 'sideboard');

  const lines: string[] = [];
  if (deckName && deckName.trim()) {
    lines.push(`// Name: ${deckName.trim()}`);
  }
  if (commanders.length > 0) {
    lines.push('Commander');
    for (const c of commanders) lines.push(`${c.quantity} ${c.name}`);
    lines.push('');
  }
  if (companions.length > 0) {
    lines.push('Companion');
    for (const c of companions) lines.push(`${c.quantity} ${c.name}`);
    lines.push('');
  }
  lines.push('Deck');
  for (const c of main) lines.push(`${c.quantity} ${c.name}`);
  if (side.length > 0) {
    lines.push('', 'Sideboard');
    for (const c of side) lines.push(`${c.quantity} ${c.name}`);
  }
  return lines.join('\n');
}

export function autoRecognizeCommandersClientSide(
  resolvedCards: ResolvedDeckCard[],
  format: Exclude<DeckFormat, 'auto'>
): void {
  if (format !== 'commander' && format !== 'brawl') return;

  const isEligibleCmd = (meta: CardMetadata | null) => {
    if (!meta || meta.isLand) return false;
    const tl = meta.typeLine || '';
    const ot = meta.oracleText || '';
    if (/can be your commander/i.test(ot)) return true;
    if (!/\blegendary\b/i.test(tl)) return false;
    if (/\b(?:creature|vehicle|spacecraft|background)\b/i.test(tl)) return true;
    if (format === 'brawl' && /\bplaneswalker\b/i.test(tl)) return true;
    return false;
  };

  const canPairPartner = (a: ResolvedDeckCard, b: ResolvedDeckCard): boolean => {
    const o1 = (a.card?.oracleText || '').toLowerCase();
    const o2 = (b.card?.oracleText || '').toLowerCase();
    const t1 = (a.card?.typeLine || '').toLowerCase();
    const t2 = (b.card?.typeLine || '').toLowerCase();
    if (/\bpartner\b/i.test(o1) && /\bpartner\b/i.test(o2)) return true;
    if (
      (/\bchoose a background\b/i.test(o1) && /\bbackground\b/i.test(t2)) ||
      (/\bchoose a background\b/i.test(o2) && /\bbackground\b/i.test(t1))
    ) {
      return true;
    }
    if (/\bfriends forever\b/i.test(o1) && /\bfriends forever\b/i.test(o2)) return true;
    if (
      (/\bdoctor's companion\b/i.test(o1) && /\btime lord doctor\b/i.test(t2)) ||
      (/\bdoctor's companion\b/i.test(o2) && /\btime lord doctor\b/i.test(t1))
    ) {
      return true;
    }
    return false;
  };

  const existingCmds = resolvedCards.filter((c) => c.zone === 'commander');
  if (existingCmds.length > 0) {
    const anyEligibleAnywhere = resolvedCards.some(
      (c) => (c.zone === 'commander' || c.zone === 'main' || c.zone === 'sideboard') && isEligibleCmd(c.card)
    );
    if (anyEligibleAnywhere) {
      let kept = 0;
      for (const c of existingCmds) {
        if (kept < 2 && isEligibleCmd(c.card)) {
          kept++;
        } else if (c.card) {
          c.zone = 'main';
        }
      }
    } else if (existingCmds.length > 2) {
      let kept = 0;
      for (const c of existingCmds) {
        if (kept < 2 && isEligibleCmd(c.card)) kept++;
        else c.zone = 'main';
      }
    }
  }

  if (resolvedCards.some((c) => c.zone === 'commander')) return;

  const mainCards = resolvedCards.filter((c) => c.zone === 'main');
  const sideboardCards = resolvedCards.filter((c) => c.zone === 'sideboard');
  const mainQty = mainCards.reduce((s, c) => s + c.quantity, 0);
  const sideQty = sideboardCards.reduce((s, c) => s + c.quantity, 0);

  if (
    mainQty >= 85 &&
    mainQty + sideQty <= 101 &&
    sideQty > 0 &&
    sideQty <= 2
  ) {
    const eligibleSide = sideboardCards.filter(
      (c) => c.quantity === 1 && isEligibleCmd(c.card)
    );
    if (eligibleSide.length === sideboardCards.length && eligibleSide.length > 0) {
      for (const sc of eligibleSide) sc.zone = 'commander';
      return;
    }
  }

  if (mainCards.length === 0) return;

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

  const candidates = mainCards.filter((c) => c.quantity === 1 && isEligibleCmd(c.card));
  if (candidates.length === 0) return;

  const firstMain = mainCards[0];
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
    const posBonus = cand === firstMain ? 45 : cand === lastMain ? 25 : 0;
    const score =
      coversAll +
      exactMatchBonus +
      covered * 25 -
      extraUnusedColors * 75 +
      posBonus;
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = cand;
    }
  }
  bestCandidate.zone = 'commander';

  const partnerCandidate = candidates.find(
    (c) =>
      c !== bestCandidate &&
      canPairPartner(bestCandidate, c) &&
      (c === mainCards[1] || c === lastMain || mainCards.indexOf(c) <= 1)
  );
  if (partnerCandidate) {
    partnerCandidate.zone = 'commander';
  }
}

export async function analyzeDeckClientSideFallback(params: {
  deckText: string;
  deckName?: string;
  format?: DeckFormat;
  goal?: DeckGoal;
  preResolvedCards?: ResolvedDeckCard[];
  precomputedMetrics?: DeckMetrics;
  resolveCardsFn?: (
    names: string[],
    format: Exclude<DeckFormat, 'auto'>
  ) => Promise<Map<string, CardMetadata>>;
}): Promise<DeckAnalysisResult> {
  const parsed = parseDecklistClientSide(params.deckText);
  if (parsed.cards.length === 0 && (!params.preResolvedCards || params.preResolvedCards.length === 0)) {
    throw new Error('Could not recognize any cards in the decklist.');
  }

  const detectedFormat =
    params.precomputedMetrics?.detectedFormat ||
    detectClientFormat(parsed.cards, params.format || 'auto');
  const goal: DeckGoal = params.goal || 'bracket-3';
  const resolveFn = params.resolveCardsFn || resolveCardsWithBrowserScryfall;

  const preResolvedMetaByKey = new Map<string, CardMetadata>();
  for (const rc of params.preResolvedCards || []) {
    if (rc.card) {
      preResolvedMetaByKey.set(normalizeKey(rc.name), rc.card);
      if (rc.card.name) {
        preResolvedMetaByKey.set(normalizeKey(rc.card.name), rc.card);
      }
    }
  }

  let resolvedCards: ResolvedDeckCard[];
  if (params.preResolvedCards && params.preResolvedCards.length > 0) {
    resolvedCards = consolidateResolvedDeckCards(
      params.preResolvedCards.map((c) => ({ ...c })),
      detectedFormat
    );
  } else {
    const uncachedNames = parsed.cards
      .map((c) => c.name)
      .filter((name) => !preResolvedMetaByKey.has(normalizeKey(name)));
    const resolvedMap =
      uncachedNames.length > 0
        ? await resolveFn(uncachedNames, detectedFormat)
        : new Map<string, CardMetadata>();

    resolvedCards = parsed.cards.map((entry) => {
      const meta =
        preResolvedMetaByKey.get(normalizeKey(entry.name)) ||
        resolvedMap.get(normalizeKey(entry.name)) ||
        null;
      return {
        ...entry,
        name: meta ? meta.name : entry.name,
        card: meta,
        notFound: !meta,
      };
    });

    // Auto-recognize Legendary Creature / Commander if a flat 100-card .txt list omitted a "Commander" header
    autoRecognizeCommandersClientSide(resolvedCards, detectedFormat);
    resolvedCards = consolidateResolvedDeckCards(resolvedCards, detectedFormat);
  }

  // Per official MTG rules, Main + Commander form the 100/60/40-card deck; Companion sits outside in the companion/sideboard zone
  const mainAndCmd = resolvedCards.filter(
    (c) => c.zone === 'main' || c.zone === 'commander'
  );
  const sideboardCount = resolvedCards
    .filter((c) => c.zone === 'sideboard' || c.zone === 'companion')
    .reduce((acc, c) => acc + c.quantity, 0);
  const currentMainAndCommanderCount = mainAndCmd.reduce((acc, c) => acc + c.quantity, 0);
  const targetDeckSize = getTargetDeckSizeForFormat(
    detectedFormat,
    currentMainAndCommanderCount
  );
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

  const curveCounts = new Array<number>(8).fill(0);
  const totalPips: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const colorSources: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const spellColorIdentitySet = new Set<ManaColor>();

  const formatViolations: string[] = [];
  const singletonViolations: string[] = [];
  const colorIdentityViolations: string[] = [];
  const unresolvedCards: string[] = [];

  const totalCopiesByName = new Map<string, number>();

  // Pass 1: Count non-land spell pips, roles, curve, and true spell color identity
  for (const item of mainAndCmd) {
    addMapCardCount(totalCopiesByName, item.name, item.quantity);
    const meta = item.card;
    if (!meta) {
      unresolvedCards.push(item.name);
      continue;
    }
    if (!meta.legalInFormat) {
      formatViolations.push(`${meta.name} is not legal in ${detectedFormat}`);
    }
    if (
      (detectedFormat === 'commander' || detectedFormat === 'brawl') &&
      rawCommanderColorIdentity.length > 0 &&
      item.zone !== 'commander'
    ) {
      const illegal = meta.colorIdentity.filter(
        (c) => !rawCommanderColorIdentity.includes(c)
      );
      if (illegal.length > 0) {
        colorIdentityViolations.push(
          `${meta.name} (${meta.colorIdentity.join('')}) is outside commander color identity (${rawCommanderColorIdentity.join('')})`
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
      }

      for (const cid of meta.colorIdentity || []) {
        if (cid === 'W' || cid === 'U' || cid === 'B' || cid === 'R' || cid === 'G') {
          spellColorIdentitySet.add(cid);
        }
      }
    }
  }

  for (const [key, qty] of totalCopiesByName.entries()) {
    const sample = mainAndCmd.find((c) => isSameCardName(c.name, key));
    const display = sample?.name || key;
    const maxAllowed = getMaxCopiesForCard(display, detectedFormat, sample?.card);
    if (Number.isFinite(maxAllowed) && qty > maxAllowed) {
      if (detectedFormat === 'commander' || detectedFormat === 'brawl') {
        singletonViolations.push(`${display} appears ${qty} times (singleton limit is 1)`);
      } else {
        formatViolations.push(`${display} appears ${qty} times (${maxAllowed}-copy limit)`);
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
  // This prevents Command Tower, Arcane Signet, Exotic Orchard, Evolving Wilds, Treasure tokens, or off-color fetchland halves
  // from activating unused colors like White in a non-White deck.
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

  const averageCmcNonLand =
    nonLandCount > 0 ? Number((nonLandCmcSum / nonLandCount).toFixed(2)) : 0;
  const averageCmcWithLands =
    currentMainAndCommanderCount > 0
      ? Number((totalCmcSum / currentMainAndCommanderCount).toFixed(2))
      : 0;

  let recommendedLands = 37;
  let recommendedRamp = 10;
  let recommendedDraw = 10;
  let recommendedRemoval = 10;

  if (targetDeckSize === 100) {
    recommendedLands = Math.max(
      34,
      Math.min(40, Math.round(31.5 + 2.6 * averageCmcNonLand - Math.min(4, currentRamp * 0.25)))
    );
  } else if (targetDeckSize === 40) {
    recommendedLands = 17;
    recommendedRamp = 2;
    recommendedDraw = 3;
    recommendedRemoval = 5;
  } else {
    recommendedLands = averageCmcNonLand <= 2.3 ? 22 : averageCmcNonLand <= 3.0 ? 24 : 25;
    recommendedRamp = 4;
    recommendedDraw = 6;
    recommendedRemoval = 8;
  }

  const effectiveLands = currentLands + Math.floor(mdfcLandCount * 0.5);
  const landsDelta = recommendedLands - effectiveLands;
  const rampDelta = Math.max(0, recommendedRamp - currentRamp);

  const totalColoredPips = (['W', 'U', 'B', 'R', 'G'] as ManaColor[])
    .filter((c) => activeDeckColorSet.has(c))
    .reduce((sum, c) => sum + totalPips[c], 0);

  const colorBreakdown: ColorBreakdownItem[] = (['W', 'U', 'B', 'R', 'G'] as ManaColor[]).map(
    (color) => {
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
      const pipSharePct =
        totalColoredPips > 0 ? Math.round((pips / totalColoredPips) * 100) : 0;
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

      const scale = targetDeckSize / 60;
      const baseNeeded = Math.round(
        (pips / Math.max(1, totalColoredPips)) * recommendedLands * 1.15
      );
      const minBaseline = Math.round(13 * scale * 0.85);
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
    }
  );

  const curve: CurveBucket[] = curveCounts.map((count, idx) => ({
    cmc: idx,
    cmcLabel: idx === 7 ? '7+' : `${idx}`,
    currentCount: count,
  }));

  const metrics: DeckMetrics = {
    detectedFormat,
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
  };

  // Build deterministic recommendations for static hosting
  // Sort active colors by highest pip demand so the deck's primary colors lead
  const activeColors = colorBreakdown
    .filter((c) => c.status !== 'unused' && activeDeckColorSet.has(c.color))
    .sort((a, b) => b.pips - a.pips);
  const deficitColors = activeColors
    .filter((c) => c.deltaSources > 0)
    .sort((a, b) => b.deltaSources - a.deltaSources);
  const colorIssues = deficitColors.map(
    (c) =>
      `${c.label} (${c.color}) has ${c.currentSources} sources vs ${c.recommendedSources} recommended (${c.deltaSources} short for ${c.pips} spell pips).`
  );

  // Track live projected deck copy counts & cuttable maindeck quantities so no
  // deterministic suggestion ever duplicates existing cards or breaks format copy caps.
  const projectedCounts = new Map<string, number>();
  const availableToCut = new Map<string, number>();
  for (const item of mainAndCmd) {
    addMapCardCount(projectedCounts, item.name, item.quantity);
    if (item.zone === 'main') {
      addMapCardCount(availableToCut, item.name, item.quantity);
    }
  }

  const getUpgradeMeta = (
    name: string,
    metaMap: Map<string, CardMetadata>
  ): CardMetadata | null => {
    const direct = metaMap.get(normalizeKey(name));
    if (direct) return direct;
    const matched = findMatchingCardMapKey(metaMap, name);
    return matched ? metaMap.get(matched) || null : null;
  };

  const landChanges: LandPlanItem[] = [];
  if (landsDelta > 0) {
    const primaryColor =
      deficitColors[0]?.color || activeColors[0]?.color || ('C' as ManaColor);
    const basicName = BASIC_LAND_BY_COLOR[primaryColor] || 'Wastes';
    const isCommanderLike = detectedFormat === 'commander' || detectedFormat === 'brawl';
    const useCommandTower =
      isCommanderLike &&
      activeColors.length >= 2 &&
      getMapCardCount(projectedCounts, 'Command Tower') === 0;

    if (useCommandTower) {
      landChanges.push({
        id: 'land-add-0',
        action: 'add',
        cardName: 'Command Tower',
        quantity: 1,
        reason: `Adds reliable untapped mana fixing across your ${activeColors.map((c) => c.label).join('/')} identity.`,
        cardMeta: null,
      });
      addMapCardCount(projectedCounts, 'Command Tower', 1);
      if (landsDelta > 1) {
        landChanges.push({
          id: 'land-add-1',
          action: 'add',
          cardName: basicName,
          quantity: landsDelta - 1,
          reason: `Brings total land count up to the recommended ${recommendedLands} lands for your ${averageCmcNonLand} average mana value.`,
          cardMeta: null,
        });
        addMapCardCount(projectedCounts, basicName, landsDelta - 1);
      }
    } else {
      landChanges.push({
        id: 'land-add-0',
        action: 'add',
        cardName: basicName,
        quantity: landsDelta,
        reason: `Brings total land count up to the recommended ${recommendedLands} lands and bolsters ${COLOR_LABELS[primaryColor] || 'mana'} consistency.`,
        cardMeta: null,
      });
      addMapCardCount(projectedCounts, basicName, landsDelta);
    }
  } else if (landsDelta < 0) {
    // Trim excess lands (tapped lands first, then surplus basics) so land count matches recommendedLands
    let excessLands = Math.abs(landsDelta);
    const mainLands = mainAndCmd
      .filter((c) => c.zone === 'main' && Boolean(c.card?.isLand))
      .sort((a, b) => {
        const aScore =
          (a.card?.entersTappedLikely ? 20 : 0) + (isBasicLandCard(a.name, a.card) ? 10 : 0);
        const bScore =
          (b.card?.entersTappedLikely ? 20 : 0) + (isBasicLandCard(b.name, b.card) ? 10 : 0);
        return bScore - aScore;
      });
    for (const land of mainLands) {
      if (excessLands <= 0) break;
      const avail = getMapCardCount(availableToCut, land.name);
      if (avail <= 0) continue;
      const cutQty = Math.min(avail, excessLands);
      addMapCardCount(availableToCut, land.name, -cutQty);
      addMapCardCount(projectedCounts, land.name, -cutQty);
      landChanges.push({
        id: `land-cut-${landChanges.length}`,
        action: 'cut',
        cardName: land.name,
        quantity: cutQty,
        reason: `Trims excess land(s) down toward the recommended ${recommendedLands}-land target for your ${averageCmcNonLand} average mana value.`,
        cardMeta: land.card,
      });
      excessLands -= cutQty;
    }
  }

  // Identify highest-CMC non-synergy cards for potential swaps/cuts
  const mainNonLands = mainAndCmd
    .filter((c) => c.zone === 'main' && c.card && !c.card.isLand)
    .sort((a, b) => (b.card?.cmc || 0) - (a.card?.cmc || 0));

  const swaps: CardSwapRecommendation[] = [];
  const cuts: CardCutRecommendation[] = [];
  const additions: CardAddRecommendation[] = [];

  // Put active deck color staples first (ordered by highest pip share), followed by universal colorless options
  const candidateUpgrades: Array<{
    name: string;
    role: CardAddRecommendation['role'];
    reason: string;
  }> = [];
  const seenCandidateKeys = new Set<string>();
  const pushCandidate = (u: { name: string; role: CardAddRecommendation['role']; reason: string }) => {
    const key = normalizeDeckCardKey(u.name);
    if (!key || seenCandidateKeys.has(key)) return;
    seenCandidateKeys.add(key);
    candidateUpgrades.push(u);
  };
  for (const c of activeColors) {
    for (const u of STAPLE_UPGRADES_BY_COLOR[c.color] || []) {
      pushCandidate(u);
    }
  }
  for (const u of STAPLE_UPGRADES_BY_COLOR.C) {
    pushCandidate(u);
  }

  const rawAvailableUpgrades = candidateUpgrades.filter((u) => {
    const maxCopies = getMaxCopiesForCard(u.name, detectedFormat, null);
    return getMapCardCount(projectedCounts, u.name) < maxCopies;
  });

  // Resolve upgrade metadata from Scryfall so prices, images, format legality & color identity can be verified
  const upgradeNames = [
    ...rawAvailableUpgrades.map((u) => u.name),
    ...landChanges.map((l) => l.cardName),
  ];
  const uncachedUpgradeNames = upgradeNames.filter(
    (name) => !preResolvedMetaByKey.has(normalizeKey(name))
  );
  const fetchedUpgradeMap =
    uncachedUpgradeNames.length > 0
      ? await resolveFn(uncachedUpgradeNames, detectedFormat)
      : new Map<string, CardMetadata>();
  const upgradeMetaMap = new Map<string, CardMetadata>(preResolvedMetaByKey);
  fetchedUpgradeMap.forEach((meta, k) => {
    upgradeMetaMap.set(k, meta);
  });

  // Strictly enforce format legality, color identity, and format copy limits
  const availableUpgrades = rawAvailableUpgrades.filter((u) => {
    const meta = getUpgradeMeta(u.name, upgradeMetaMap);
    if (meta && meta.legalInFormat === false) return false;
    if (meta) {
      const fitsColors = (meta.colorIdentity || []).every((col) =>
        activeDeckColorSet.has(col as ManaColor)
      );
      if (!fitsColors) return false;
    }
    const maxCopies = getMaxCopiesForCard(meta?.name || u.name, detectedFormat, meta);
    return getMapCardCount(projectedCounts, meta?.name || u.name) < maxCopies;
  });

  for (const lc of landChanges) {
    lc.cardMeta = getUpgradeMeta(lc.cardName, upgradeMetaMap);
  }

  const takeNextAvailableUpgrade = (excludeName?: string) => {
    for (const u of availableUpgrades) {
      const addMeta = getUpgradeMeta(u.name, upgradeMetaMap);
      const canonicalName = addMeta?.name || u.name;
      if (excludeName && isSameCardName(canonicalName, excludeName)) continue;
      const maxCopies = getMaxCopiesForCard(canonicalName, detectedFormat, addMeta);
      const current = getMapCardCount(projectedCounts, canonicalName);
      if (current < maxCopies) {
        return { upgrade: u, canonicalName, addMeta };
      }
    }
    return null;
  };

  const topHeavyCards = mainNonLands.filter((c) => (c.card?.cmc || 0) >= 5);
  for (let i = 0; i < Math.min(3, topHeavyCards.length); i++) {
    const cutTarget = topHeavyCards[i];
    if (getMapCardCount(availableToCut, cutTarget.name) <= 0) continue;
    const picked = takeNextAvailableUpgrade(cutTarget.name);
    if (!picked) break;

    addMapCardCount(availableToCut, cutTarget.name, -1);
    addMapCardCount(projectedCounts, cutTarget.name, -1);
    addMapCardCount(projectedCounts, picked.canonicalName, 1);

    swaps.push({
      id: `swap-${swaps.length}`,
      cutCardName: cutTarget.name,
      addCardName: picked.canonicalName,
      quantity: 1,
      role: picked.upgrade.role,
      cutReason: `High mana cost (MV ${cutTarget.card?.cmc}) raises curve risk when mana is tight.`,
      addReason: picked.upgrade.reason,
      priority: swaps.length === 0 ? 'high' : 'medium',
      cutCardMeta: cutTarget.card,
      addCardMeta: picked.addMeta,
    });
  }

  if (landsDelta > 0) {
    const extraCut = mainNonLands.find(
      (c) => getMapCardCount(availableToCut, c.name) > 0
    );
    if (extraCut) {
      addMapCardCount(availableToCut, extraCut.name, -1);
      addMapCardCount(projectedCounts, extraCut.name, -1);
      cuts.push({
        id: 'cut-0',
        cardName: extraCut.name,
        quantity: 1,
        reason: `Free up a maindeck slot to fit missing lands and hit land drops on curve.`,
        category: 'overcosted',
        priority: 'medium',
        cardMeta: extraCut.card,
      });
    }
  }

  if (deckSizeDelta > 0) {
    const picked = takeNextAvailableUpgrade();
    if (picked) {
      addMapCardCount(projectedCounts, picked.canonicalName, 1);
      additions.push({
        id: 'add-0',
        cardName: picked.canonicalName,
        quantity: 1,
        role: picked.upgrade.role,
        reason: picked.upgrade.reason,
        priority: 'high',
        cardMeta: picked.addMeta,
      });
    }
  }

  // Strictly reconcile swaps, cuts, additions, and landChanges so the resulting deck ALWAYS hits targetDeckSize (40/60/100) and never goes over
  const reconciled = reconcileAnalysisRecommendationsToTargetSize({
    resolvedCards,
    metrics,
    swaps,
    cuts,
    additions,
    landChanges,
    candidateAdditions: availableUpgrades.map((u) => {
      const addMeta = getUpgradeMeta(u.name, upgradeMetaMap);
      return {
        cardName: addMeta?.name || u.name,
        role: u.role,
        reason: u.reason,
        cardMeta: addMeta,
      };
    }),
    lookupMeta: (name) => getUpgradeMeta(name, upgradeMetaMap),
  });

  // Resolve Scryfall metadata for any basic lands added during reconciliation
  const missingReconciledLandNames = Array.from(
    new Set(
      reconciled.landChanges
        .filter((lc) => lc.action === 'add' && !lc.cardMeta)
        .map((lc) => lc.cardName)
    )
  );
  if (missingReconciledLandNames.length > 0) {
    try {
      const extraBasicMap = await resolveFn(missingReconciledLandNames, detectedFormat);
      extraBasicMap.forEach((meta, k) => {
        upgradeMetaMap.set(k, meta);
      });
      for (const lc of reconciled.landChanges) {
        if (lc.action === 'add' && !lc.cardMeta) {
          lc.cardMeta = getUpgradeMeta(lc.cardName, upgradeMetaMap);
        }
      }
    } catch {
      // Non-fatal if Scryfall is unavailable
    }
  }

  const manaPlan: ManaPlanSummary = {
    verdict:
      landsDelta >= 2
        ? 'missing-lands'
        : deficitColors.length > 0
        ? 'missing-colors'
        : tappedLandCount >= 8
        ? 'slow-manabase'
        : landsDelta <= -2
        ? 'too-many-lands'
        : 'balanced',
    headline:
      landsDelta > 0
        ? `Deck is ${landsDelta} land${landsDelta === 1 ? '' : 's'} short of optimal curve consistency`
        : deficitColors.length > 0
        ? `Land count is solid, but ${deficitColors.map((c) => c.label).join('/')} fixing needs reinforcement`
        : 'Mana base count and curve proportions are well balanced',
    plainExplanation: `Your deck runs ${currentLands} lands (+${mdfcLandCount} MDFC lands) with an average non-land mana value of ${averageCmcNonLand}. Karsten-calibrated target is ${recommendedLands} lands and ${recommendedRamp} ramp sources.`,
    currentLands,
    recommendedLands,
    landsMissingOrExcess: landsDelta,
    currentRamp,
    recommendedRamp,
    rampMissing: rampDelta,
    tappedLandsWarning:
      tappedLandCount >= 6
        ? `${tappedLandCount} lands enter the battlefield tapped, which can delay early curve plays by a full turn.`
        : null,
    colorIssues,
    landChanges: reconciled.landChanges,
  };

  const finalTitle =
    params.deckName?.trim() ||
    parsed.deckName ||
    (commanderNames.length > 0 ? `${commanderNames[0]} Commander` : 'Analyzed MTG Deck');

  const baseResult: DeckAnalysisResult = {
    deckName: finalTitle,
    sourceFormat: parsed.sourceFormat,
    goal,
    archetype: `${activeColors.map((c) => c.label).join('/') || 'Colorless'} ${
      averageCmcNonLand <= 2.4 ? 'Aggro / Tempo' : averageCmcNonLand >= 3.4 ? 'Control / Ramp' : 'Midrange'
    }`,
    verdictHeadline: manaPlan.headline,
    verdictSummary: `Analyzed ${currentMainAndCommanderCount} cards (${currentLands} lands, ${currentRamp} ramp, ${currentDraw} draw, ${currentRemoval} removal). ${manaPlan.plainExplanation}`,
    topPriorities: [
      landsDelta > 0
        ? `Add ${landsDelta} land${landsDelta === 1 ? '' : 's'} to reach ${recommendedLands} total lands.`
        : `Maintain ${currentLands} lands and prioritize untapped duals.`,
      rampDelta > 0
        ? `Add ${rampDelta} ramp piece${rampDelta === 1 ? '' : 's'} to reach ${recommendedRamp} mana accelerants.`
        : `Ramp density (${currentRamp}) is on target for your mana curve.`,
      deficitColors.length > 0
        ? `Increase ${deficitColors.map((c) => c.label).join(' and ')} mana sources to match spell pip demand.`
        : `Trim top-of-curve bottlenecks to keep opening hands castable.`,
    ],
    metrics,
    manaPlan,
    swaps: reconciled.swaps,
    cuts: reconciled.cuts,
    additions: reconciled.additions,
    resolvedCards,
  };

  return baseResult;
}

// 4. Client-Side Adaptive Bot Playtest Fallback for Static Hosting
const ARCHETYPE_SAMPLE_PLAYS: Record<string, string[]> = {
  'Mono-Red Aggro / Burn': [
    'Monastery Swiftspear',
    'Eidolon of the Great Revel',
    'Lightning Bolt',
    'Chain Lightning',
    'Goblin Guide',
    'Chandra, Torch of Defiance',
    'Torbran, Thane of Red Fell',
    'Price of Progress',
    'Sol Ring',
    'Jeska\'s Will',
    'Fiery Emancipation',
  ],
  'Azorius Control & Countermagic': [
    'Counterspell',
    'Dovin\'s Veto',
    'Swords to Plowshares',
    'Teferi, Time Raveler',
    'Supreme Verdict',
    'Arcane Signet',
    'Rhystic Study',
    'Dream Trawler',
    'Elspeth, Sun\'s Champion',
    'Approach of the Second Sun',
    'Grand Arbiter Augustin IV',
  ],
  'Dimir Midrange & Removal': [
    'Fatal Push',
    'Baleful Strix',
    'Thoughtseize',
    'Drown in the Loch',
    'Arcane Signet',
    'Rhystic Study',
    'Sheoldred, the Apocalypse',
    'Toxic Deluge',
    'Gray Merchant of Asphodel',
    'Yuriko, the Tiger\'s Shadow',
  ],
  'Simic Landfall & Ramp': [
    'Sol Ring',
    'Cultivate',
    'Kodama\'s Reach',
    'Lotus Cobra',
    'Scute Swarm',
    'Tatyova, Benthic Druid',
    'Beast Within',
    'Rampaging Baloths',
    'Avenger of Zendikar',
    'Aesi, Tyrant of Gyre Strait',
    'Craterhoof Behemoth',
  ],
  'Golgari Graveyard Value': [
    'Stitcher\'s Supplier',
    'Sol Ring',
    'Cultivate',
    'Eternal Witness',
    'Assassin\'s Trophy',
    'Reanimate',
    'Meren of Clan Nel Toth',
    'Gray Merchant of Asphodel',
    'Living Death',
    'Torment of Hailfire',
    'Gravecrawler',
  ],
  'Orzhov Aristocrats & Drain': [
    'Viscera Seer',
    'Blood Artist',
    'Cruel Celebrant',
    'Zulaport Cutthroat',
    'Bitterblossom',
    'Arcane Signet',
    'Swords to Plowshares',
    'Anguished Unmaking',
    'Yawgmoth, Thran Physician',
    'Teysa Karlov',
    'Exsanguinate',
  ],
  'Izzet Spellslinger Combo': [
    'Goblin Electromancer',
    'Young Pyromancer',
    'Third Path Iconoclast',
    'Expressive Iteration',
    'Counterspell',
    'Lightning Bolt',
    'Guttersnipe',
    'Storm-Kiln Artist',
    'Veyran, Voice of Duality',
    'Niv-Mizzet, Parun',
    'Crackle with Power',
  ],
  'Gruul Stompy Aggro': [
    'Llanowar Elves',
    'Sol Ring',
    'Farseek',
    'Rhythm of the Wild',
    'Questing Beast',
    'Beast Within',
    'Xenagos, God of Revels',
    'Embercleave',
    'Elder Gargaroth',
    'Overrun',
    'Craterhoof Behemoth',
  ],
  'Golgari / Simic Toxic & Infect': [
    'Glistener Elf',
    'Blighted Agent',
    'Venerated Rotpriest',
    'Prologue to Phyresis',
    'Experimental Augury',
    'Bloated Contaminator',
    'Inexorable Tide',
    'Skithiryx, the Blight Dragon',
    'Triumph of the Hordes',
    'Atraxa, Praetors\' Voice',
  ],
  'Dimir Mill & Library Denial': [
    'Hedron Crab',
    'Ruin Crab',
    'Glimpse the Unthinkable',
    'Maddening Cacophony',
    'Mindcrank',
    'Mesmeric Orb',
    'Fraying Sanity',
    'Fractured Sanity',
    'Counterspell',
    'Drown in the Loch',
    'Phenax, God of Deception',
  ],
  'Boros / Voltron Commander Damage': [
    'Sol Ring',
    'Arcane Signet',
    'Swiftfoot Boots',
    'Lightning Greaves',
    'Colossus Hammer',
    'Swords to Plowshares',
    'Embercleave',
    'Blackblade Reforged',
    'Slicer, Hired Muscle',
    'Jeska, Thrice Reborn',
    'Akroma\'s Will',
  ],
};

const NON_COMMANDER_ARCHETYPE_PLAYS: Record<string, string[]> = {
  'Mono-Red Aggro / Burn': [
    'Monastery Swiftspear',
    'Kumano Faces Kakkazan',
    'Goblin Guide',
    'Lightning Strike',
    'Lightning Bolt',
    'Eidolon of the Great Revel',
    'Chandra, Torch of Defiance',
    'Embercleave',
  ],
  'Azorius Control & Countermagic': [
    'Opt',
    'Negate',
    'Counterspell',
    'Teferi, Time Raveler',
    'Supreme Verdict',
    'Sunfall',
    'Dream Trawler',
    'Elspeth, Sun\'s Champion',
  ],
  'Dimir Midrange & Removal': [
    'Fatal Push',
    'Thoughtseize',
    'Go for the Throat',
    'Baleful Strix',
    'Negate',
    'Drown in the Loch',
    'Sheoldred, the Apocalypse',
    'Sign in Blood',
  ],
  'Simic Landfall & Ramp': [
    'Llanowar Elves',
    'Rampant Growth',
    'Farseek',
    'Lotus Cobra',
    'Scute Swarm',
    'Opt',
    'Beast Within',
    'Elder Gargaroth',
  ],
  'Golgari Graveyard Value': [
    'Stitcher\'s Supplier',
    'Go for the Throat',
    'Rampant Growth',
    'Eternal Witness',
    'Assassin\'s Trophy',
    'Gravecrawler',
    'Reanimate',
    'Sheoldred, the Apocalypse',
  ],
  'Orzhov Aristocrats & Drain': [
    'Viscera Seer',
    'Blood Artist',
    'Cruel Celebrant',
    'Zulaport Cutthroat',
    'Bitterblossom',
    'Fatal Push',
    'Go for the Throat',
    'Anguished Unmaking',
  ],
  'Izzet Spellslinger Combo': [
    'Opt',
    'Lightning Bolt',
    'Lightning Strike',
    'Expressive Iteration',
    'Young Pyromancer',
    'Third Path Iconoclast',
    'Negate',
    'Guttersnipe',
  ],
  'Gruul Stompy Aggro': [
    'Llanowar Elves',
    'Rampant Growth',
    'Farseek',
    'Monastery Swiftspear',
    'Questing Beast',
    'Embercleave',
    'Elder Gargaroth',
    'Overrun',
  ],
  'Golgari / Simic Toxic & Infect': [
    'Glistener Elf',
    'Blighted Agent',
    'Venerated Rotpriest',
    'Prologue to Phyresis',
    'Experimental Augury',
    'Bloated Contaminator',
    'Go for the Throat',
    'Inexorable Tide',
  ],
  'Dimir Mill & Library Denial': [
    'Hedron Crab',
    'Ruin Crab',
    'Glimpse the Unthinkable',
    'Maddening Cacophony',
    'Fractured Sanity',
    'Drown in the Loch',
    'Go for the Throat',
    'Negate',
  ],
};

function getFormatSafeSamplePlays(
  archetype: string,
  format: Exclude<DeckFormat, 'auto'>
): string[] {
  if (format === 'commander') {
    return (
      ARCHETYPE_SAMPLE_PLAYS[archetype] || [
        'Arcane Signet',
        'Beast Within',
        'Rhystic Study',
        'Cultivate',
        'Wrath of God',
      ]
    );
  }
  if (format === 'brawl') {
    const raw =
      ARCHETYPE_SAMPLE_PLAYS[archetype] ||
      NON_COMMANDER_ARCHETYPE_PLAYS[archetype] || [
        'Arcane Signet',
        'Farseek',
        'Beast Within',
        'Wrath of God',
        'Elder Gargaroth',
      ];
    // Exclude non-Standard/non-Historic-Brawl legacy fast mana like Sol Ring in standard Brawl when possible
    return raw.filter((c) => !/^(Sol Ring|Price of Progress|Chain Lightning)$/i.test(c));
  }
  return (
    NON_COMMANDER_ARCHETYPE_PLAYS[archetype] || [
      'Llanowar Elves',
      'Lightning Strike',
      'Go for the Throat',
      'Opt',
      'Negate',
      'Questing Beast',
      'Sunfall',
    ]
  );
}

function makeSyntheticMeta(
  name: string,
  cmc: number,
  typeLine: string,
  oracleText: string,
  power?: string,
  toughness?: string,
  flags?: Partial<CardMetadata>
): CardMetadata {
  return {
    name,
    manaCost: cmc > 0 ? `{${cmc}}` : '',
    cmc,
    typeLine,
    oracleText,
    colors: [],
    colorIdentity: [],
    producedMana: flags?.producedMana || [],
    isLand: Boolean(flags?.isLand),
    isMdfcLand: false,
    entersTappedLikely: false,
    isRamp: Boolean(flags?.isRamp),
    isDraw: Boolean(flags?.isDraw),
    isRemoval: Boolean(flags?.isRemoval),
    isBoardWipe: Boolean(flags?.isBoardWipe),
    isProtection: Boolean(flags?.isProtection),
    power,
    toughness,
    imageUri: '',
    priceUsd: null,
    scryfallUri: '',
    legalInFormat: true,
    rarity: 'rare',
  };
}

const SYNTHETIC_STAPLE_METADATA = new Map<string, CardMetadata>([
  ['monastery swiftspear', makeSyntheticMeta('Monastery Swiftspear', 1, 'Creature — Human Monk', 'Haste. Prowess', '1', '2')],
  ['goblin guide', makeSyntheticMeta('Goblin Guide', 1, 'Creature — Goblin Scout', 'Haste', '2', '2')],
  ['eidolon of the great revel', makeSyntheticMeta('Eidolon of the Great Revel', 2, 'Enchantment Creature — Spirit', 'Whenever a player casts a spell with mana value 3 or less, Eidolon deals 2 damage to that player.', '2', '2')],
  ['lightning bolt', makeSyntheticMeta('Lightning Bolt', 1, 'Instant', 'Lightning Bolt deals 3 damage to any target.', undefined, undefined, { isRemoval: true })],
  ['chain lightning', makeSyntheticMeta('Chain Lightning', 1, 'Sorcery', 'Chain Lightning deals 3 damage to any target.', undefined, undefined, { isRemoval: true })],
  ['price of progress', makeSyntheticMeta('Price of Progress', 2, 'Instant', 'Price of Progress deals 4 damage to each player.')],
  ['torbran, thane of red fell', makeSyntheticMeta('Torbran, Thane of Red Fell', 4, 'Legendary Creature — Dwarf Noble', 'If a red source you control would deal damage, it deals that much damage plus 2 instead.', '2', '4')],
  ['chandra, torch of defiance', makeSyntheticMeta('Chandra, Torch of Defiance', 4, 'Legendary Planeswalker — Chandra', 'Chandra deals 2 damage to each opponent. Add {R}{R}.', undefined, undefined)],
  ['fiery emancipation', makeSyntheticMeta('Fiery Emancipation', 6, 'Enchantment', 'If a source you control would deal damage, it deals triple that damage instead. Deals 4 damage to each opponent.')],
  ['jeska\'s will', makeSyntheticMeta("Jeska's Will", 3, 'Sorcery', 'Add {R}{R}{R}. Exile the top three cards of your library.', undefined, undefined, { isRamp: true, isDraw: true })],
  ['counterspell', makeSyntheticMeta('Counterspell', 2, 'Instant', 'Counter target spell.', undefined, undefined, { isRemoval: true, isProtection: true })],
  ['dovin\'s veto', makeSyntheticMeta("Dovin's Veto", 2, 'Instant', 'Counter target noncreature spell.', undefined, undefined, { isRemoval: true, isProtection: true })],
  ['swords to plowshares', makeSyntheticMeta('Swords to Plowshares', 1, 'Instant', 'Exile target creature.', undefined, undefined, { isRemoval: true })],
  ['teferi, time raveler', makeSyntheticMeta('Teferi, Time Raveler', 3, 'Legendary Planeswalker — Teferi', 'Draw a card.', undefined, undefined, { isDraw: true })],
  ['supreme verdict', makeSyntheticMeta('Supreme Verdict', 4, 'Sorcery', 'Destroy all creatures.', undefined, undefined, { isBoardWipe: true })],
  ['dream trawler', makeSyntheticMeta('Dream Trawler', 6, 'Creature — Sphinx', 'Flying, lifelink. Whenever you draw a card, Dream Trawler gets +1/+0 until end of turn.', '5', '5')],
  ['elspeth, sun\'s champion', makeSyntheticMeta("Elspeth, Sun's Champion", 6, 'Legendary Planeswalker — Elspeth', 'Create three 1/1 white Soldier creature tokens.', undefined, undefined)],
  ['approach of the second sun', makeSyntheticMeta('Approach of the Second Sun', 7, 'Sorcery', 'You gain 7 life. Each opponent loses 7 life if cast a second time.')],
  ['grand arbiter augustin iv', makeSyntheticMeta('Grand Arbiter Augustin IV', 4, 'Legendary Creature — Human Advisor', 'Spells your opponents cast cost {1} more to cast.', '2', '3')],
  ['fatal push', makeSyntheticMeta('Fatal Push', 1, 'Instant', 'Destroy target creature if it has mana value 2 or less.', undefined, undefined, { isRemoval: true })],
  ['baleful strix', makeSyntheticMeta('Baleful Strix', 2, 'Artifact Creature — Bird', 'Flying, deathtouch. When Baleful Strix enters, draw a card.', '1', '1', { isDraw: true })],
  ['thoughtseize', makeSyntheticMeta('Thoughtseize', 1, 'Sorcery', 'Target player reveals their hand. You lose 2 life.')],
  ['drown in the loch', makeSyntheticMeta('Drown in the Loch', 2, 'Instant', 'Counter target spell or destroy target creature.', undefined, undefined, { isRemoval: true })],
  ['sheoldred, the apocalypse', makeSyntheticMeta('Sheoldred, the Apocalypse', 4, 'Legendary Creature — Phyrexian Praetor', 'Deathtouch. Whenever an opponent draws a card, they lose 2 life. You gain 2 life.', '4', '5')],
  ['toxic deluge', makeSyntheticMeta('Toxic Deluge', 3, 'Sorcery', 'All creatures get -X/-X until end of turn. You lose 3 life.', undefined, undefined, { isBoardWipe: true })],
  ['yuriko, the tiger\'s shadow', makeSyntheticMeta("Yuriko, the Tiger's Shadow", 3, 'Legendary Creature — Human Ninja', 'Each opponent loses 3 life.', '1', '3')],
  ['gray merchant of asphodel', makeSyntheticMeta('Gray Merchant of Asphodel', 5, 'Creature — Zombie', 'Each opponent loses 5 life. You gain 5 life.', '2', '4')],
  ['cultivate', makeSyntheticMeta('Cultivate', 3, 'Sorcery', 'Search your library for up to two basic land cards. Add one mana.', undefined, undefined, { isRamp: true, producedMana: ['W', 'U', 'B', 'R', 'G'] })],
  ['kodama\'s reach', makeSyntheticMeta("Kodama's Reach", 3, 'Sorcery', 'Search your library for up to two basic land cards.', undefined, undefined, { isRamp: true, producedMana: ['W', 'U', 'B', 'R', 'G'] })],
  ['farseek', makeSyntheticMeta('Farseek', 2, 'Sorcery', 'Search your library for a Plains, Island, Swamp, or Mountain card.', undefined, undefined, { isRamp: true, producedMana: ['W', 'U', 'B', 'R', 'G'] })],
  ['lotus cobra', makeSyntheticMeta('Lotus Cobra', 2, 'Creature — Snake', 'Landfall — Whenever a land enters, add one mana of any color.', '2', '1', { isRamp: true, producedMana: ['W', 'U', 'B', 'R', 'G'] })],
  ['scute swarm', makeSyntheticMeta('Scute Swarm', 3, 'Creature — Insect', 'Landfall — Whenever a land enters, create a 1/1 green Insect creature token.', '1', '1')],
  ['tatyova, benthic druid', makeSyntheticMeta('Tatyova, Benthic Druid', 5, 'Legendary Creature — Merfolk Druid', 'Landfall — Whenever a land enters, you gain 1 life and draw a card.', '3', '3', { isDraw: true })],
  ['beast within', makeSyntheticMeta('Beast Within', 3, 'Instant', 'Destroy target permanent.', undefined, undefined, { isRemoval: true })],
  ['rampaging baloths', makeSyntheticMeta('Rampaging Baloths', 6, 'Creature — Beast', 'Trample. Landfall — Whenever a land enters, create a 4/4 green Beast creature token.', '6', '6')],
  ['avenger of zendikar', makeSyntheticMeta('Avenger of Zendikar', 7, 'Creature — Elemental', 'Create four 1/1 green Plant creature tokens.', '5', '5')],
  ['aesi, tyrant of gyre strait', makeSyntheticMeta('Aesi, Tyrant of Gyre Strait', 6, 'Legendary Creature — Serpent', 'Landfall — Whenever a land enters, you may draw a card.', '5', '5', { isDraw: true })],
  ['craterhoof behemoth', makeSyntheticMeta('Craterhoof Behemoth', 8, 'Creature — Beast', 'Haste, trample. Creatures you control get +5/+5 until end of turn.', '5', '5')],
  ['stitcher\'s supplier', makeSyntheticMeta("Stitcher's Supplier", 1, 'Creature — Zombie', 'When Stitcher\'s Supplier enters or dies, mill three cards.', '1', '1')],
  ['eternal witness', makeSyntheticMeta('Eternal Witness', 3, 'Creature — Human Shaman', 'When Eternal Witness enters, return target card from your graveyard.', '2', '1', { isDraw: true })],
  ['assassin\'s trophy', makeSyntheticMeta("Assassin's Trophy", 2, 'Instant', 'Destroy target permanent.', undefined, undefined, { isRemoval: true })],
  ['reanimate', makeSyntheticMeta('Reanimate', 1, 'Sorcery', 'Put target creature card from a graveyard onto the battlefield. You lose 3 life.')],
  ['meren of clan nel toth', makeSyntheticMeta('Meren of Clan Nel Toth', 4, 'Legendary Creature — Human Shaman', 'Return target creature card from your graveyard to the battlefield.', '3', '4')],
  ['living death', makeSyntheticMeta('Living Death', 5, 'Sorcery', 'Destroy all creatures. Each player returns all creature cards from their graveyard to the battlefield.', undefined, undefined, { isBoardWipe: true })],
  ['torment of hailfire', makeSyntheticMeta('Torment of Hailfire', 6, 'Sorcery', 'Repeat X times: each opponent loses 3 life.', undefined, undefined)],
  ['gravecrawler', makeSyntheticMeta('Gravecrawler', 1, 'Creature — Zombie', 'You may cast Gravecrawler from your graveyard.', '2', '1')],
  ['viscera seer', makeSyntheticMeta('Viscera Seer', 1, 'Creature — Vampire Wizard', 'Sacrifice a creature: Scry 1.', '1', '1')],
  ['blood artist', makeSyntheticMeta('Blood Artist', 2, 'Creature — Vampire', 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.', '0', '1')],
  ['cruel celebrant', makeSyntheticMeta('Cruel Celebrant', 2, 'Creature — Vampire', 'Whenever a creature dies, each opponent loses 1 life and you gain 1 life.', '1', '2')],
  ['zulaport cutthroat', makeSyntheticMeta('Zulaport Cutthroat', 2, 'Creature — Human Rogue Ally', 'Whenever a creature dies, each opponent loses 1 life and you gain 1 life.', '1', '1')],
  ['bitterblossom', makeSyntheticMeta('Bitterblossom', 2, 'Tribal Enchantment — Faerie', 'At the beginning of your upkeep, you lose 1 life and create a 1/1 black Faerie Rogue creature token with flying.')],
  ['anguished unmaking', makeSyntheticMeta('Anguished Unmaking', 3, 'Instant', 'Exile target nonland permanent. You lose 3 life.', undefined, undefined, { isRemoval: true })],
  ['yawgmoth, thran physician', makeSyntheticMeta('Yawgmoth, Thran Physician', 4, 'Legendary Creature — Human Cleric', 'Sacrifice a creature: Proliferate. Pay 1 life, draw a card.', '2', '4', { isDraw: true })],
  ['teysa karlov', makeSyntheticMeta('Teysa Karlov', 4, 'Legendary Creature — Human Advisor', 'Vigilance, lifelink. Whenever a creature dies, triggers twice.', '2', '4')],
  ['exsanguinate', makeSyntheticMeta('Exsanguinate', 6, 'Sorcery', 'Each opponent loses X life. You gain life equal to the life lost this way.')],
  ['goblin electromancer', makeSyntheticMeta('Goblin Electromancer', 2, 'Creature — Goblin Wizard', 'Instant and sorcery spells you cast cost {1} less.', '2', '2', { isRamp: true })],
  ['young pyromancer', makeSyntheticMeta('Young Pyromancer', 2, 'Creature — Human Shaman', 'Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.', '2', '1')],
  ['third path iconoclast', makeSyntheticMeta('Third Path Iconoclast', 2, 'Creature — Human Monk', 'Whenever you cast a noncreature spell, create a 1/1 colorless Soldier creature token.', '2', '1')],
  ['expressive iteration', makeSyntheticMeta('Expressive Iteration', 2, 'Sorcery', 'Draw two cards.', undefined, undefined, { isDraw: true })],
  ['guttersnipe', makeSyntheticMeta('Guttersnipe', 3, 'Creature — Goblin Shaman', 'Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.', '2', '2')],
  ['storm-kiln artist', makeSyntheticMeta('Storm-Kiln Artist', 4, 'Creature — Dwarf Shaman', 'Whenever you cast an instant or sorcery spell, create a Treasure token.', '2', '2', { isRamp: true })],
  ['veyran, voice of duality', makeSyntheticMeta('Veyran, Voice of Duality', 3, 'Legendary Creature — Efreet Wizard', 'Magecraft — Whenever you cast an instant or sorcery spell, double triggers.', '2', '2')],
  ['niv-mizzet, parun', makeSyntheticMeta('Niv-Mizzet, Parun', 6, 'Legendary Creature — Dragon Wizard', 'Flying. Whenever you draw a card, deals 1 damage to any target. Whenever a player casts an instant or sorcery, draw a card.', '5', '5', { isDraw: true })],
  ['crackle with power', makeSyntheticMeta('Crackle with Power', 5, 'Sorcery', 'Crackle with Power deals 5 damage to each opponent.')],
  ['llanowar elves', makeSyntheticMeta('Llanowar Elves', 1, 'Creature — Elf Druid', 'Add {G}.', '1', '1', { isRamp: true, producedMana: ['G'] })],
  ['rhythm of the wild', makeSyntheticMeta('Rhythm of the Wild', 3, 'Enchantment', 'Creatures you control have haste.')],
  ['questing beast', makeSyntheticMeta('Questing Beast', 4, 'Legendary Creature — Beast', 'Vigilance, deathtouch, haste.', '4', '4')],
  ['xenagos, god of revels', makeSyntheticMeta('Xenagos, God of Revels', 5, 'Legendary Enchantment Creature — God', 'Indestructible. Another creature you control gains haste and +6/+6 until end of turn.', '6', '5')],
  ['embercleave', makeSyntheticMeta('Embercleave', 4, 'Legendary Artifact — Equipment', 'Double strike, trample. Equipped creature gets +1/+1.')],
  ['elder gargaroth', makeSyntheticMeta('Elder Gargaroth', 5, 'Creature — Beast', 'Vigilance, reach, trample. Whenever Elder Gargaroth attacks, draw a card and create a 3/3 Beast creature token.', '6', '6', { isDraw: true })],
  ['overrun', makeSyntheticMeta('Overrun', 5, 'Sorcery', 'Creatures you control get +3/+3 and gain trample until end of turn.')],
  ['glistener elf', makeSyntheticMeta('Glistener Elf', 1, 'Creature — Phyrexian Elf Warrior', 'Infect', '1', '1')],
  ['blighted agent', makeSyntheticMeta('Blighted Agent', 2, 'Creature — Phyrexian Human Rogue', 'Infect. Blighted Agent can\'t be blocked.', '1', '1')],
  ['venerated rotpriest', makeSyntheticMeta('Venerated Rotpriest', 1, 'Creature — Phyrexian Druid', 'Toxic 1', '1', '2')],
  ['prologue to phyresis', makeSyntheticMeta('Prologue to Phyresis', 2, 'Instant', 'Each opponent gets a poison counter. Draw a card.', undefined, undefined, { isDraw: true })],
  ['experimental augury', makeSyntheticMeta('Experimental Augury', 2, 'Instant', 'Draw a card, then proliferate.', undefined, undefined, { isDraw: true })],
  ['bloated contaminator', makeSyntheticMeta('Bloated Contaminator', 3, 'Creature — Phyrexian Beast', 'Trample, toxic 1. Whenever it deals combat damage, proliferate.', '4', '4')],
  ['inexorable tide', makeSyntheticMeta('Inexorable Tide', 5, 'Enchantment', 'Whenever you cast a spell, proliferate.')],
  ['skithiryx, the blight dragon', makeSyntheticMeta('Skithiryx, the Blight Dragon', 5, 'Legendary Creature — Phyrexian Dragon Skeleton', 'Flying, infect, haste', '4', '4')],
  ['triumph of the hordes', makeSyntheticMeta('Triumph of the Hordes', 4, 'Sorcery', 'Creatures you control get +1/+1 and gain trample and infect until end of turn.')],
  ['atraxa, praetors\' voice', makeSyntheticMeta("Atraxa, Praetors' Voice", 4, 'Legendary Creature — Phyrexian Angel Horror', 'Flying, vigilance, deathtouch, lifelink. Proliferate.', '4', '4')],
  ['hedron crab', makeSyntheticMeta('Hedron Crab', 1, 'Creature — Crab', 'Landfall — Whenever a land enters, target player mills 3 cards.', '0', '2')],
  ['ruin crab', makeSyntheticMeta('Ruin Crab', 1, 'Creature — Crab', 'Landfall — Whenever a land enters, each opponent mills 3 cards.', '0', '3')],
  ['glimpse the unthinkable', makeSyntheticMeta('Glimpse the Unthinkable', 2, 'Sorcery', 'Target player mills 10 cards.')],
  ['maddening cacophony', makeSyntheticMeta('Maddening Cacophony', 2, 'Sorcery', 'Each opponent mills 8 cards.')],
  ['mindcrank', makeSyntheticMeta('Mindcrank', 2, 'Artifact', 'Whenever an opponent loses life, that player mills that many cards.')],
  ['mesmeric orb', makeSyntheticMeta('Mesmeric Orb', 2, 'Artifact', 'Each opponent mills 3 cards.')],
  ['fraying sanity', makeSyntheticMeta('Fraying Sanity', 3, 'Enchantment — Aura', 'Target player mills 6 cards.')],
  ['fractured sanity', makeSyntheticMeta('Fractured Sanity', 3, 'Sorcery', 'Each opponent mills 14 cards.')],
  ['phenax, god of deception', makeSyntheticMeta('Phenax, God of Deception', 5, 'Legendary Enchantment Creature — God', 'Indestructible. Target player mills 6 cards.', '4', '7')],
  ['swiftfoot boots', makeSyntheticMeta('Swiftfoot Boots', 2, 'Artifact — Equipment', 'Equipped creature has hexproof and haste.')],
  ['lightning greaves', makeSyntheticMeta('Lightning Greaves', 2, 'Artifact — Equipment', 'Equipped creature has shroud and haste.')],
  ['colossus hammer', makeSyntheticMeta('Colossus Hammer', 1, 'Artifact — Equipment', 'Equipped creature gets +10/+10.')],
  ['blackblade reforged', makeSyntheticMeta('Blackblade Reforged', 2, 'Legendary Artifact — Equipment', 'Equipped creature gets +4/+4.')],
  ['slicer, hired muscle', makeSyntheticMeta('Slicer, Hired Muscle', 3, 'Legendary Artifact Creature — Robot', 'Double strike, haste', '3', '4')],
  ['jeska, thrice reborn', makeSyntheticMeta('Jeska, Thrice Reborn', 3, 'Legendary Planeswalker — Jeska', 'Double strike damage for commander.', undefined, undefined)],
  ['akroma\'s will', makeSyntheticMeta("Akroma's Will", 4, 'Instant', 'Creatures you control gain flying, vigilance, double strike, lifelink, indestructible, and +3/+3.')],
  ['sol ring', makeSyntheticMeta('Sol Ring', 1, 'Artifact', 'Add {C}{C}.', undefined, undefined, { isRamp: true, producedMana: ['C'] })],
  ['arcane signet', makeSyntheticMeta('Arcane Signet', 2, 'Artifact', 'Add one mana of any color.', undefined, undefined, { isRamp: true, producedMana: ['W', 'U', 'B', 'R', 'G'] })],
  ['rhystic study', makeSyntheticMeta('Rhystic Study', 3, 'Enchantment', 'Whenever an opponent casts a spell, you may draw a card.', undefined, undefined, { isDraw: true })],
  ['lightning strike', makeSyntheticMeta('Lightning Strike', 2, 'Instant', 'Lightning Strike deals 3 damage to any target.', undefined, undefined, { isRemoval: true })],
  ['negate', makeSyntheticMeta('Negate', 2, 'Instant', 'Counter target noncreature spell.', undefined, undefined, { isRemoval: true, isProtection: true })],
  ['opt', makeSyntheticMeta('Opt', 1, 'Instant', 'Scry 1. Draw a card.', undefined, undefined, { isDraw: true })],
  ['go for the throat', makeSyntheticMeta('Go for the Throat', 2, 'Instant', 'Destroy target nonartifact creature.', undefined, undefined, { isRemoval: true })],
  ['rampant growth', makeSyntheticMeta('Rampant Growth', 2, 'Sorcery', 'Search your library for a basic land card.', undefined, undefined, { isRamp: true, producedMana: ['W', 'U', 'B', 'R', 'G'] })],
  ['sunfall', makeSyntheticMeta('Sunfall', 5, 'Sorcery', 'Exile all creatures. Incubate 2.', undefined, undefined, { isBoardWipe: true })],
  ['wrath of god', makeSyntheticMeta('Wrath of God', 4, 'Sorcery', 'Destroy all creatures.', undefined, undefined, { isBoardWipe: true })],
  ['sign in blood', makeSyntheticMeta('Sign in Blood', 2, 'Sorcery', 'Target player draws two cards and loses 2 life.', undefined, undefined, { isDraw: true })],
  ['kumano faces kakkazan', makeSyntheticMeta('Kumano Faces Kakkazan', 1, 'Enchantment — Saga', 'Deals 1 damage to each opponent. Create a 2/2 Human Shaman creature token with haste.', '2', '2')],
]);

function isLikelyBasicOrLandName(name: string): boolean {
  return /\b(plains|island|swamp|mountain|forest|wastes|command tower|exotic orchard|evolving wilds|terramorphic expanse)\b/i.test(
    name
  );
}

interface SimCreaturePermanent {
  name: string;
  cmc: number;
  manaCost?: string;
  meta: CardMetadata | null;
  power: number;
  toughness: number;
  isCommander: boolean;
  commanderName: string;
  isToken?: boolean;
  isProtected?: boolean;
  hasInfect: boolean;
  toxicValue: number;
  hasProliferate: boolean;
  millAmount: number;
  burnOrDrainAmount: number;
  lifegainAmount: number;
  hitsEachOpponent: boolean;
  hasFlying: boolean;
  hasReach: boolean;
  hasMenace: boolean;
  isUnblockable: boolean;
  hasEvasion: boolean;
  hasFirstStrike: boolean;
  hasDoubleStrike: boolean;
  hasHaste: boolean;
  hasVigilance: boolean;
  hasLifelink: boolean;
  hasDeathtouch: boolean;
  hasTrample: boolean;
  isTokenMaker: boolean;
  isAristocratsPayoff: boolean;
  isSacOutlet: boolean;
  isLandfallPayoff: boolean;
  isSpellslingerPayoff: boolean;
  summoningSick: boolean;
  tapped: boolean;
}

interface SimEnginePermanent {
  name: string;
  cmc: number;
  isTokenMaker: boolean;
  tokenCount: number;
  tokenPower: number;
  isAristocratsPayoff: boolean;
  isSacOutlet: boolean;
  isLandfallPayoff: boolean;
  isSpellslingerPayoff: boolean;
  isProtection: boolean;
  extraDrawCount: number;
  burnOrDrainAmount: number;
  selfLifeLossAmount: number;
  hitsEachOpponent: boolean;
  isRamp: boolean;
}

interface SimDeckSlot {
  name: string;
  cmc: number;
  manaCost?: string;
  isLand: boolean;
  entersTapped: boolean;
  isRamp: boolean;
  producedMana: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'>;
  meta: CardMetadata | null;
  mech: CardMechanicFlags;
}

function makeSimDeckSlot(params: {
  name: string;
  cmc: number;
  manaCost?: string;
  isLand: boolean;
  entersTapped: boolean;
  isRamp: boolean;
  producedMana: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'>;
  meta: CardMetadata | null;
}): SimDeckSlot {
  return {
    ...params,
    mech: detectCardMechanics(params.name, params.meta),
  };
}

function resolveSlotProducedMana(
  name: string,
  meta: CardMetadata | null,
  isLand: boolean,
  isRamp: boolean
): Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> {
  const cols = getProducedColorsFromCard(name, meta);
  if (cols.length > 0) return cols;
  if (isLand || isRamp) return ['W', 'U', 'B', 'R', 'G'];
  return [];
}

function buildPermanentFromCard(
  name: string,
  meta: CardMetadata | null,
  isCommander: boolean,
  commanderLabel: string,
  fallbackPower = 2,
  isToken = false,
  precomputedMech?: CardMechanicFlags
): SimCreaturePermanent {
  const mech = precomputedMech || detectCardMechanics(name, meta);
  const power =
    mech.estimatedPower > 0
      ? mech.estimatedPower
      : meta?.power !== undefined
      ? mech.estimatedPower
      : fallbackPower;
  const toughness =
    mech.estimatedToughness > 0
      ? mech.estimatedToughness
      : Math.max(1, power);
  return {
    name,
    cmc: meta?.cmc ?? fallbackPower,
    manaCost: meta?.manaCost,
    meta,
    power,
    toughness,
    isCommander,
    commanderName: commanderLabel,
    isToken,
    isProtected: mech.isProtection,
    hasInfect: mech.hasInfect,
    toxicValue: mech.toxicValue,
    hasProliferate: mech.hasProliferate,
    millAmount: mech.millAmount,
    burnOrDrainAmount: mech.burnOrDrainAmount,
    lifegainAmount: mech.lifegainAmount,
    hitsEachOpponent: mech.hitsEachOpponent,
    hasFlying: mech.hasFlying,
    hasReach: mech.hasReach,
    hasMenace: mech.hasMenace,
    isUnblockable: mech.isUnblockable,
    hasEvasion: mech.hasEvasion,
    hasFirstStrike: mech.hasFirstStrike,
    hasDoubleStrike: mech.hasDoubleStrike,
    hasHaste: mech.hasHaste,
    hasVigilance: mech.hasVigilance,
    hasLifelink: mech.hasLifelink,
    hasDeathtouch: mech.hasDeathtouch,
    hasTrample: mech.hasTrample,
    isTokenMaker: mech.isTokenMaker,
    isAristocratsPayoff: mech.isAristocratsPayoff,
    isSacOutlet: mech.isSacOutlet,
    isLandfallPayoff: mech.isLandfallPayoff,
    isSpellslingerPayoff: mech.isSpellslingerPayoff,
    summoningSick: !mech.hasHaste,
    tapped: false,
  };
}

function createTokenPermanent(name: string, power = 1, toughness = 1): SimCreaturePermanent {
  const isFlier = /spirit|thopter|bird|faerie|drake|angel|dragon/i.test(name);
  return {
    name,
    cmc: 0,
    meta: null,
    power,
    toughness,
    isCommander: false,
    commanderName: '',
    isToken: true,
    hasInfect: false,
    toxicValue: 0,
    hasProliferate: false,
    millAmount: 0,
    burnOrDrainAmount: 0,
    lifegainAmount: 0,
    hitsEachOpponent: false,
    hasFlying: isFlier,
    hasReach: false,
    hasMenace: false,
    isUnblockable: false,
    hasEvasion: isFlier,
    hasFirstStrike: false,
    hasDoubleStrike: false,
    hasHaste: false,
    hasVigilance: false,
    hasLifelink: false,
    hasDeathtouch: false,
    hasTrample: false,
    isTokenMaker: false,
    isAristocratsPayoff: false,
    isSacOutlet: false,
    isLandfallPayoff: false,
    isSpellslingerPayoff: false,
    summoningSick: true,
    tapped: false,
  };
}

function recordCreatureDeparture(
  perm: SimCreaturePermanent,
  cmdTaxMap: Map<string, number>,
  graveyard: SimDeckSlot[]
) {
  if (perm.isCommander) {
    cmdTaxMap.set(perm.commanderName, (cmdTaxMap.get(perm.commanderName) || 0) + 2);
  } else if (!perm.isToken) {
    graveyard.push(
      makeSimDeckSlot({
        name: perm.name,
        cmc: perm.cmc,
        manaCost: perm.manaCost,
        isLand: false,
        entersTapped: false,
        isRamp: false,
        producedMana: [],
        meta: perm.meta,
      })
    );
  }
}

function canBlockerInterceptAttacker(
  atk: SimCreaturePermanent,
  blk: SimCreaturePermanent
): boolean {
  if (atk.isUnblockable) return false;
  if (atk.hasFlying && !(blk.hasFlying || blk.hasReach)) return false;
  return true;
}

interface EndgameAttackEvaluation {
  combatDamage: number;
  poisonDamage: number;
  commanderDamage: number;
  totalLifeDamage: number;
  totalPoisonDamage: number;
  isLethal: boolean;
  lethalGap: number;
}

function evaluateEndgameAttackLine(params: {
  attackers: SimCreaturePermanent[];
  defenderBoard: SimCreaturePermanent[];
  defenderLife: number;
  defenderPoison: number;
  defenderCmdTaken: number;
  defenderLibRemaining: number;
  usesCommanderDamage21?: boolean;
  directLifeLoss?: number;
  directPoison?: number;
  directMill?: number;
  removeBestBlocker?: boolean;
}): EndgameAttackEvaluation {
  const {
    attackers,
    defenderBoard,
    defenderLife,
    defenderPoison,
    defenderCmdTaken,
    defenderLibRemaining,
    usesCommanderDamage21 = true,
    directLifeLoss = 0,
    directPoison = 0,
    directMill = 0,
    removeBestBlocker = false,
  } = params;

  const availableBlockers = defenderBoard.filter((b) => !b.tapped);
  if (removeBestBlocker && availableBlockers.length > 0) {
    let bestIdx = 0;
    let bestBlkScore = -1;
    for (let i = 0; i < availableBlockers.length; i++) {
      const b = availableBlockers[i];
      const sc =
        b.toughness +
        b.power * 0.65 +
        (b.hasFlying || b.hasReach ? 2.5 : 0) +
        (b.hasDeathtouch ? 3.5 : 0) +
        (b.isCommander ? 1.5 : 0);
      if (sc > bestBlkScore) {
        bestBlkScore = sc;
        bestIdx = i;
      }
    }
    availableBlockers.splice(bestIdx, 1);
  }

  const orderedAttackers = [...attackers].sort((a, b) => {
    const aHit = a.power * (a.hasDoubleStrike ? 2 : 1);
    const bHit = b.power * (b.hasDoubleStrike ? 2 : 1);
    const aScore =
      aHit * 2 +
      (a.isUnblockable ? 8 : 0) +
      (a.hasTrample ? 4 : 0) +
      (a.hasFlying ? 3 : 0) +
      (a.isCommander ? 4 : 0) +
      (a.hasInfect ? 7 : 0);
    const bScore =
      bHit * 2 +
      (b.isUnblockable ? 8 : 0) +
      (b.hasTrample ? 4 : 0) +
      (b.hasFlying ? 3 : 0) +
      (b.isCommander ? 4 : 0) +
      (b.hasInfect ? 7 : 0);
    return bScore - aScore;
  });

  const usedBlockers = new Set<SimCreaturePermanent>();
  let combatDamage = 0;
  let poisonDamage = 0;
  let commanderDamage = 0;

  for (const atk of orderedAttackers) {
    const hitPower = atk.power * (atk.hasDoubleStrike ? 2 : 1);
    if (hitPower <= 0) continue;

    const validBlockers = availableBlockers
      .filter((blk) => !usedBlockers.has(blk) && canBlockerInterceptAttacker(atk, blk))
      .sort((a, b) => {
        const aKills = a.power >= atk.toughness || a.hasDeathtouch ? 1 : 0;
        const bKills = b.power >= atk.toughness || b.hasDeathtouch ? 1 : 0;
        if (bKills !== aKills) return bKills - aKills;
        return b.toughness - a.toughness;
      });

    const req = atk.hasMenace ? 2 : 1;
    let throughDmg = hitPower;

    if (validBlockers.length >= req) {
      const assigned = validBlockers.slice(0, req);
      let absorbed = 0;
      let fsBlkKillsAtk = false;
      if (!atk.hasFirstStrike && !atk.hasDoubleStrike) {
        const fsPow = assigned.reduce(
          (s, b) => s + (b.hasFirstStrike || b.hasDoubleStrike ? b.power : 0),
          0
        );
        const fsDeath = assigned.some(
          (b) => (b.hasFirstStrike || b.hasDoubleStrike) && b.hasDeathtouch && b.power > 0
        );
        if (fsPow >= atk.toughness || fsDeath) fsBlkKillsAtk = true;
      }
      if (fsBlkKillsAtk) {
        for (const blk of assigned) usedBlockers.add(blk);
        throughDmg = 0;
      } else {
        for (const blk of assigned) {
          usedBlockers.add(blk);
          absorbed += atk.hasDeathtouch ? 1 : blk.toughness;
        }
        if (atk.hasTrample && hitPower > absorbed) {
          throughDmg = hitPower - absorbed;
        } else {
          throughDmg = 0;
        }
      }
    }

    if (throughDmg > 0) {
      if (atk.hasInfect) {
        poisonDamage += throughDmg;
      } else {
        combatDamage += throughDmg;
        if (atk.toxicValue > 0) poisonDamage += atk.toxicValue;
      }
      if (atk.isCommander) {
        commanderDamage += throughDmg;
      }
    }
  }

  const totalLifeDamage = combatDamage + directLifeLoss;
  const totalPoisonDamage = poisonDamage + directPoison;
  const isLethal =
    (defenderLife > 0 && totalLifeDamage >= defenderLife) ||
    totalPoisonDamage + defenderPoison >= 10 ||
    (usesCommanderDamage21 && commanderDamage > 0 && defenderCmdTaken + commanderDamage >= 21) ||
    (directMill > 0 && defenderLibRemaining <= directMill);

  return {
    combatDamage,
    poisonDamage,
    commanderDamage,
    totalLifeDamage,
    totalPoisonDamage,
    isLethal,
    lethalGap: Math.max(0, defenderLife - totalLifeDamage),
  };
}

function resolveCombatPhaseBetweenBoards(params: {
  attackers: SimCreaturePermanent[];
  defenderBoard: SimCreaturePermanent[];
  defenderLife: number;
  defenderPoison?: number;
  defenderIsPlayer: boolean;
  onDefenderCreatureDied: (perm: SimCreaturePermanent) => void;
  onAttackerCreatureDied: (perm: SimCreaturePermanent) => void;
  attackerBoard: SimCreaturePermanent[];
}): {
  combatDamage: number;
  poisonDealt: number;
  commanderDamageBySource: Map<string, number>;
  millDealt: number;
  lifegainDealt: number;
  defenderLifegain: number;
  proliferateCount: number;
  attackerDeaths: number;
  defenderDeaths: number;
} {
  const {
    attackers,
    defenderBoard,
    defenderLife,
    defenderPoison = 0,
    onDefenderCreatureDied,
    onAttackerCreatureDied,
    attackerBoard,
  } = params;

  const untappedBlockers = defenderBoard.filter((b) => !b.tapped);
  let combatDamage = 0;
  let poisonDealt = 0;
  const commanderDamageBySource = new Map<string, number>();
  let millDealt = 0;
  let lifegainDealt = 0;
  let defenderLifegain = 0;
  let proliferateCount = 0;
  let attackerDeaths = 0;
  let defenderDeaths = 0;

  const orderedAttackers = [...attackers].sort((a, b) => {
    const aHit = a.power * (a.hasDoubleStrike ? 2 : 1);
    const bHit = b.power * (b.hasDoubleStrike ? 2 : 1);
    const aScore = aHit * 2 + (a.isCommander ? 5 : 0) + (a.hasInfect ? 8 : 0) + (a.toxicValue * 2);
    const bScore = bHit * 2 + (b.isCommander ? 5 : 0) + (b.hasInfect ? 8 : 0) + (b.toxicValue * 2);
    return bScore - aScore;
  });

  let remainingPotentialLifeDamage = 0;
  let remainingPotentialPoison = 0;
  for (const atk of orderedAttackers) {
    const hp = atk.power * (atk.hasDoubleStrike ? 2 : 1);
    if (atk.hasInfect) {
      remainingPotentialPoison += hp;
    } else {
      remainingPotentialLifeDamage += hp;
      if (atk.toxicValue > 0) remainingPotentialPoison += atk.toxicValue;
    }
  }

  let unblockedLifeDamageSoFar = 0;
  let unblockedPoisonSoFar = 0;

  const deadAttackers = new Set<SimCreaturePermanent>();
  const deadBlockers = new Set<SimCreaturePermanent>();
  const usedBlockers = new Set<SimCreaturePermanent>();

  for (const atk of orderedAttackers) {
    if (!atk.hasVigilance) {
      atk.tapped = true;
    }

    const hitPower = atk.power * (atk.hasDoubleStrike ? 2 : 1);
    if (atk.hasInfect) {
      remainingPotentialPoison = Math.max(0, remainingPotentialPoison - hitPower);
    } else {
      remainingPotentialLifeDamage = Math.max(0, remainingPotentialLifeDamage - hitPower);
      if (atk.toxicValue > 0) {
        remainingPotentialPoison = Math.max(0, remainingPotentialPoison - atk.toxicValue);
      }
    }

    const candidateBlockers = untappedBlockers.filter(
      (blk) => !usedBlockers.has(blk) && !deadBlockers.has(blk) && canBlockerInterceptAttacker(atk, blk)
    );

    const requiredBlockers = atk.hasMenace ? 2 : 1;
    const assignedBlockers: SimCreaturePermanent[] = [];

    const wouldExceedHalfLife =
      !atk.hasInfect &&
      unblockedLifeDamageSoFar + hitPower + remainingPotentialLifeDamage >= defenderLife * 0.7;
    const isUrgentLethalLife =
      !atk.hasInfect &&
      (unblockedLifeDamageSoFar + hitPower >= defenderLife ||
        unblockedLifeDamageSoFar + hitPower + remainingPotentialLifeDamage >= defenderLife);
    const isUrgentPoison =
      (atk.hasInfect || atk.toxicValue > 0) &&
      (defenderPoison + unblockedPoisonSoFar + (atk.hasInfect ? hitPower : atk.toxicValue) >= 9 ||
        defenderPoison + unblockedPoisonSoFar + remainingPotentialPoison + (atk.hasInfect ? hitPower : atk.toxicValue) >= 10);

    const isDangerToDefender =
      isUrgentLethalLife ||
      isUrgentPoison ||
      wouldExceedHalfLife ||
      hitPower >= Math.max(4, Math.floor(defenderLife * 0.3)) ||
      atk.isCommander ||
      atk.hasInfect ||
      atk.toxicValue > 0;

    if (candidateBlockers.length >= requiredBlockers) {
      const sortedBlockers = [...candidateBlockers].sort((a, b) => {
        const aKills = a.power >= atk.toughness || a.hasDeathtouch ? 1 : 0;
        const bKills = b.power >= atk.toughness || b.hasDeathtouch ? 1 : 0;
        const aSurvives = a.toughness > hitPower && !atk.hasDeathtouch ? 1 : 0;
        const bSurvives = b.toughness > hitPower && !atk.hasDeathtouch ? 1 : 0;
        const aEnginePenalty =
          a.isAristocratsPayoff || a.isLandfallPayoff || a.isSpellslingerPayoff ? -6 : 0;
        const bEnginePenalty =
          b.isAristocratsPayoff || b.isLandfallPayoff || b.isSpellslingerPayoff ? -6 : 0;
        const aTokenChumpBonus = a.isToken && isDangerToDefender ? 4 : 0;
        const bTokenChumpBonus = b.isToken && isDangerToDefender ? 4 : 0;
        const aFirstStrikeKills =
          (a.hasFirstStrike || a.hasDoubleStrike) &&
          !(atk.hasFirstStrike || atk.hasDoubleStrike) &&
          (a.power >= atk.toughness || a.hasDeathtouch)
            ? 14
            : 0;
        const bFirstStrikeKills =
          (b.hasFirstStrike || b.hasDoubleStrike) &&
          !(atk.hasFirstStrike || atk.hasDoubleStrike) &&
          (b.power >= atk.toughness || b.hasDeathtouch)
            ? 14
            : 0;
        const aScore =
          aSurvives * 22 + aKills * 12 + aFirstStrikeKills + aTokenChumpBonus - a.power + aEnginePenalty;
        const bScore =
          bSurvives * 22 + bKills * 12 + bFirstStrikeKills + bTokenChumpBonus - b.power + bEnginePenalty;
        return bScore - aScore;
      });

      if (requiredBlockers === 1) {
        const bestBlk = sortedBlockers[0];
        const atkFirstStrike = atk.hasFirstStrike || atk.hasDoubleStrike;
        const blkFirstStrike = bestBlk.hasFirstStrike || bestBlk.hasDoubleStrike;
        const blkKillsBeforeRegular =
          blkFirstStrike &&
          !atkFirstStrike &&
          (bestBlk.power >= atk.toughness || bestBlk.hasDeathtouch);
        const survivesBlock =
          blkKillsBeforeRegular || (bestBlk.toughness > hitPower && !atk.hasDeathtouch);
        const tradesUp =
          (bestBlk.power >= atk.toughness || bestBlk.hasDeathtouch) &&
          (atk.power >= bestBlk.power || atk.isCommander || atk.hasInfect) &&
          !(atkFirstStrike && !blkFirstStrike && (atk.power >= bestBlk.toughness || atk.hasDeathtouch));
        const worthyChump =
          isDangerToDefender &&
          (!bestBlk.isCommander || isUrgentLethalLife || isUrgentPoison);

        if (survivesBlock || tradesUp || worthyChump) {
          assignedBlockers.push(bestBlk);
          usedBlockers.add(bestBlk);
        } else if (
          sortedBlockers.length >= 2 &&
          (isDangerToDefender || atk.power >= 4) &&
          !(atkFirstStrike && !atk.hasTrample && atk.power >= sortedBlockers[0].toughness + sortedBlockers[1].toughness)
        ) {
          // Smart multi-block (gang-block) to kill dangerous non-trampling/commander/huge threats
          const gang: SimCreaturePermanent[] = [];
          let gangPow = 0;
          for (const candidate of sortedBlockers) {
            if (candidate.isCommander && !isUrgentLethalLife && !isUrgentPoison) continue;
            gang.push(candidate);
            gangPow += candidate.power;
            if (gang.length >= 3 || gangPow >= atk.toughness) break;
          }
          if (gang.length >= 2 && gangPow >= atk.toughness) {
            for (const g of gang) {
              assignedBlockers.push(g);
              usedBlockers.add(g);
            }
          }
        }
      } else {
        // Menace multi-block
        const blkA = sortedBlockers[0];
        const blkB = sortedBlockers[1];
        const combinedKills =
          blkA.power + blkB.power >= atk.toughness || blkA.hasDeathtouch || blkB.hasDeathtouch;
        if (combinedKills || isUrgentLethalLife || isUrgentPoison) {
          assignedBlockers.push(blkA, blkB);
          usedBlockers.add(blkA);
          usedBlockers.add(blkB);
        }
      }
    }

    let unblockedDamage = hitPower;
    let atkLifegainHit = 0;

    if (assignedBlockers.length > 0) {
      const atkStrikesFirst = atk.hasFirstStrike || atk.hasDoubleStrike;
      const firstStrikeBlockers = assignedBlockers.filter(
        (b) => b.hasFirstStrike || b.hasDoubleStrike
      );
      const regularBlockers = assignedBlockers.filter(
        (b) => !b.hasFirstStrike || b.hasDoubleStrike
      );

      // Step 1: First-Strike combat damage step
      const fsAtkDmg = atkStrikesFirst ? atk.power : 0;
      let remainingFsAtk = fsAtkDmg;
      const killedInFirstStrike = new Set<SimCreaturePermanent>();

      if (fsAtkDmg > 0) {
        for (const blk of assignedBlockers) {
          const lethalNeeded = atk.hasDeathtouch ? 1 : blk.toughness;
          if (remainingFsAtk >= lethalNeeded) {
            killedInFirstStrike.add(blk);
            deadBlockers.add(blk);
            defenderDeaths += 1;
            remainingFsAtk -= lethalNeeded;
          }
        }
        if (atk.hasLifelink) {
          atkLifegainHit += fsAtkDmg;
        }
      }

      let fsBlkPow = 0;
      let fsBlkDeath = false;
      for (const blk of firstStrikeBlockers) {
        fsBlkPow += blk.power;
        if (blk.hasDeathtouch && blk.power > 0) fsBlkDeath = true;
        if (blk.hasLifelink && blk.power > 0) defenderLifegain += blk.power;
      }
      const atkDiedInFirstStrike = fsBlkDeath || fsBlkPow >= atk.toughness;
      if (atkDiedInFirstStrike) {
        deadAttackers.add(atk);
        attackerDeaths += 1;
      }

      // Step 2: Regular combat damage step (only creatures still alive strike)
      const atkSurvivesToRegular = !atkDiedInFirstStrike;
      const regAtkDmg =
        atkSurvivesToRegular && !atk.hasFirstStrike ? atk.power : 0;

      if (atkSurvivesToRegular) {
        let regBlkPow = fsBlkPow;
        let regBlkDeath = fsBlkDeath;
        for (const blk of regularBlockers) {
          if (killedInFirstStrike.has(blk)) continue;
          // Note: Double Strike blockers already added first-strike power above; regular step adds their regular hit
          regBlkPow += blk.power;
          if (blk.hasDeathtouch && blk.power > 0) regBlkDeath = true;
          if (blk.hasLifelink && blk.power > 0) defenderLifegain += blk.power;
        }
        if (regBlkDeath || regBlkPow >= atk.toughness) {
          deadAttackers.add(atk);
          attackerDeaths += 1;
        }
      }

      if (regAtkDmg > 0) {
        let remReg = regAtkDmg;
        for (const blk of assignedBlockers) {
          if (killedInFirstStrike.has(blk)) continue;
          const lethalNeeded = atk.hasDeathtouch ? 1 : blk.toughness;
          if (remReg >= lethalNeeded) {
            deadBlockers.add(blk);
            defenderDeaths += 1;
            remReg -= lethalNeeded;
          }
        }
        if (atk.hasLifelink) {
          atkLifegainHit += regAtkDmg;
        }
      }

      // Trample overflow damage (respecting First Strike blocker kills of regular-speed trampler)
      if (!atk.hasTrample) {
        unblockedDamage = 0;
      } else if (atkDiedInFirstStrike && !atkStrikesFirst) {
        unblockedDamage = 0;
      } else {
        let absorbedToughness = 0;
        for (const blk of assignedBlockers) {
          absorbedToughness += atk.hasDeathtouch ? 1 : blk.toughness;
        }
        const effectiveTotalAtkDmg = fsAtkDmg + regAtkDmg;
        unblockedDamage =
          effectiveTotalAtkDmg > absorbedToughness ? effectiveTotalAtkDmg - absorbedToughness : 0;
      }
    } else if (atk.hasLifelink) {
      atkLifegainHit = hitPower;
    }

    if (atkLifegainHit > 0) {
      lifegainDealt += atkLifegainHit;
    }

    if (unblockedDamage > 0) {
      if (atk.hasInfect) {
        poisonDealt += unblockedDamage;
        unblockedPoisonSoFar += unblockedDamage;
        if (atk.isCommander && atk.commanderName) {
          commanderDamageBySource.set(
            atk.commanderName,
            (commanderDamageBySource.get(atk.commanderName) || 0) + unblockedDamage
          );
        }
      } else {
        combatDamage += unblockedDamage;
        unblockedLifeDamageSoFar += unblockedDamage;
        if (atk.isCommander && atk.commanderName) {
          commanderDamageBySource.set(
            atk.commanderName,
            (commanderDamageBySource.get(atk.commanderName) || 0) + unblockedDamage
          );
        }
        if (atk.toxicValue > 0) {
          poisonDealt += atk.toxicValue;
          unblockedPoisonSoFar += atk.toxicValue;
        }
      }
      if (atk.millAmount > 0) {
        millDealt += atk.millAmount;
      }
      if (atk.hasProliferate) {
        proliferateCount += 1;
      }
    }
  }

  for (let i = attackerBoard.length - 1; i >= 0; i--) {
    const c = attackerBoard[i];
    if (deadAttackers.has(c)) {
      onAttackerCreatureDied(c);
      attackerBoard.splice(i, 1);
    }
  }
  for (let i = defenderBoard.length - 1; i >= 0; i--) {
    const c = defenderBoard[i];
    if (deadBlockers.has(c)) {
      onDefenderCreatureDied(c);
      defenderBoard.splice(i, 1);
    }
  }

  return {
    combatDamage,
    poisonDealt,
    commanderDamageBySource,
    millDealt,
    lifegainDealt,
    defenderLifegain,
    proliferateCount,
    attackerDeaths,
    defenderDeaths,
  };
}

export interface BotMatchTacticalDirective {
  priorityTarget?: string;
  posture?: 'aggressive' | 'balanced' | 'defensive';
  manaPlan?: 'hold-interaction' | 'tap-out-pressure';
  winVectorFocus?: 'auto' | 'life' | 'poison' | 'commander' | 'mill';
  keyThreatToAnswer?: string;
  focusTag?: string;
  appliedMemoryReason?: string;
}

interface ClientSimulationEngineResult {
  result: PlaytestResult;
  rawRounds: PlaytestRound[];
  playerOpeningHandSize: number;
  oppOpeningHandSizes: number[];
}

function hydrateBoardFromLibrary<T extends SimDeckSlot>(
  lib: T[],
  count: number
): { pulled: SimCreaturePermanent[]; removed: number } {
  const pulled: SimCreaturePermanent[] = [];
  let removed = 0;
  for (let i = 0; i < count && lib.length > 0; i++) {
    const idx = lib.findIndex(
      (c) => !c.isLand && (c.mech.estimatedPower > 0 || /\bcreature\b/i.test(c.meta?.typeLine || ''))
    );
    if (idx !== -1) {
      const [card] = lib.splice(idx, 1);
      const perm = buildPermanentFromCard(card.name, card.meta, false, '', 2, false, card.mech);
      perm.summoningSick = false;
      pulled.push(perm);
      removed += 1;
    } else {
      pulled.push(createTokenPermanent('Board Creature', 2, 2));
      pulled[pulled.length - 1].summoningSick = false;
    }
  }
  while (pulled.length < count) {
    const tok = createTokenPermanent('Board Token', 2, 2);
    tok.summoningSick = false;
    pulled.push(tok);
  }
  return { pulled, removed };
}

function hydrateHandAndLibrary(
  fullPool: SimDeckSlot[],
  targetHandSize: number,
  targetLandsInPlay: number,
  targetCreaturesInPlay: number,
  targetLibraryRemaining: number
): {
  hand: SimDeckSlot[];
  remainingLibrary: SimDeckSlot[];
  battlefield: SimCreaturePermanent[];
  colorSources: Record<'W' | 'U' | 'B' | 'R' | 'G', number>;
} {
  const working = [...fullPool];
  // Shuffle for fresh draw order on continuation
  for (let i = working.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [working[i], working[j]] = [working[j], working[i]];
  }

  const colorSources: Record<'W' | 'U' | 'B' | 'R' | 'G', number> = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
  };

  let landsRemoved = 0;
  for (let l = 0; l < targetLandsInPlay; l++) {
    const landIdx = working.findIndex((c) => c.isLand);
    if (landIdx !== -1) {
      const [landCard] = working.splice(landIdx, 1);
      landsRemoved += 1;
      for (const col of landCard.producedMana) {
        if (col !== 'C') colorSources[col] += 1;
      }
    } else {
      const cols: Array<'W' | 'U' | 'B' | 'R' | 'G'> = ['W', 'U', 'B', 'R', 'G'];
      colorSources[cols[l % cols.length]] += 1;
    }
  }
  void landsRemoved;

  const { pulled: battlefield } = hydrateBoardFromLibrary(working, targetCreaturesInPlay);

  const hand: SimDeckSlot[] = [];
  for (let h = 0; h < targetHandSize && working.length > 0; h++) {
    hand.push(working.shift()!);
  }

  // Ensure remainingLibrary has exact targetLibraryRemaining length
  while (working.length > targetLibraryRemaining) {
    working.pop();
  }
  let padIdx = 0;
  while (working.length < targetLibraryRemaining && fullPool.length > 0) {
    const template = fullPool[padIdx % fullPool.length];
    working.push({ ...template });
    padIdx += 1;
  }

  return { hand, remainingLibrary: working, battlefield, colorSources };
}

function runClientSimulationCore(params: {
  deckName: string;
  format: Exclude<DeckFormat, 'auto'>;
  resolvedCards: ResolvedDeckCard[];
  overrideDeckText?: string;
  testedListLabel: string;
  mode: PlaytestMode;
  opponents: BotOpponentConfig[];
  botMemoryProfiles?: BotLearningProfile[];
  extraCardMeta?: CardMetadata[];
  resolvedCustomCardsByBotIndex?: Record<number, ResolvedDeckCard[]>;
  botTacticalDirectives?: Record<string, BotMatchTacticalDirective>;
  seedFromRounds?: PlaytestRound[];
}): ClientSimulationEngineResult {
  const {
    deckName,
    format,
    resolvedCards,
    overrideDeckText,
    testedListLabel,
    mode,
    opponents,
    botMemoryProfiles = [],
    extraCardMeta = [],
    resolvedCustomCardsByBotIndex = {},
    botTacticalDirectives = {},
    seedFromRounds,
  } = params;

  const expectedOpponents = mode === '1v1' ? 1 : mode === '1v2' ? 2 : 3;
  const activeOpponents = opponents.slice(0, expectedOpponents);

  const metaByName = new Map<string, CardMetadata>();
  const registerMeta = (name: string, m: CardMetadata | null | undefined) => {
    if (!m) return;
    metaByName.set(normalizeCardLookupKey(name), m);
    if (m.name) {
      metaByName.set(normalizeCardLookupKey(m.name), m);
      if (m.name.includes(' // ')) {
        metaByName.set(normalizeCardLookupKey(m.name.split(' // ')[0]), m);
      }
    }
  };
  for (const [synthKey, synthMeta] of SYNTHETIC_STAPLE_METADATA.entries()) {
    metaByName.set(synthKey, synthMeta);
    registerMeta(synthMeta.name, synthMeta);
  }
  for (const rc of resolvedCards) {
    registerMeta(rc.name, rc.card);
  }
  for (const m of extraCardMeta) {
    if (m?.name) registerMeta(m.name, m);
  }
  for (const customList of Object.values(resolvedCustomCardsByBotIndex)) {
    for (const rc of customList || []) {
      registerMeta(rc.name, rc.card);
    }
  }

  let effectiveCards: ResolvedDeckCard[] = resolvedCards.map((c) => ({ ...c }));
  const explicitIncomingCommanders = new Set(
    effectiveCards
      .filter((c) => c.zone === 'commander')
      .map((c) => normalizeCardLookupKey(c.name))
  );

  if (overrideDeckText && overrideDeckText.trim()) {
    const reparsed = parseDecklistClientSide(overrideDeckText);
    if (reparsed.cards.length > 0) {
      effectiveCards = reparsed.cards.map((c) => {
        const meta = findMetaFromMap(metaByName, c.name) || null;
        return {
          ...c,
          name: meta ? meta.name : c.name,
          card: meta,
        };
      });
      if (
        !effectiveCards.some((c) => c.zone === 'commander') &&
        explicitIncomingCommanders.size > 0
      ) {
        for (const c of effectiveCards) {
          if (explicitIncomingCommanders.has(normalizeCardLookupKey(c.name))) {
            c.zone = 'commander';
          }
        }
      }
    }
  }

  const totalPlayerDeckCards = effectiveCards
    .filter((c) => c.zone === 'main' || c.zone === 'commander')
    .reduce((s, c) => s + c.quantity, 0);

  const formatRules: FormatSimulationRules = getFormatSimulationRules(
    format,
    mode,
    totalPlayerDeckCards
  );
  const startingLife = formatRules.startingLife;
  const maxRounds = 45;
  const defaultDeckSize = formatRules.targetMainDeckSize;

  if (formatRules.allowsCommandZone) {
    autoRecognizeCommandersClientSide(effectiveCards, format);
  } else {
    // Non-Commander/non-Brawl formats have no Command Zone: keep all cards in maindeck/sideboard
    for (const c of effectiveCards) {
      if (c.zone === 'commander') {
        c.zone = 'main';
      }
    }
  }

  const commanderCards = formatRules.allowsCommandZone
    ? effectiveCards.filter((c) => c.zone === 'commander')
    : [];
  const commanderNames = commanderCards.map((c) => c.name);

  const memoryByKey = new Map<string, BotLearningProfile>();
  const memoryByName = new Map<string, BotLearningProfile>();
  for (const m of botMemoryProfiles) {
    memoryByKey.set(m.botKey, m);
    memoryByName.set(m.botName.trim().toLowerCase(), m);
  }

  const lastSeedRound =
    seedFromRounds && seedFromRounds.length > 0
      ? seedFromRounds[seedFromRounds.length - 1]
      : null;
  const lastSeedStatsByName = new Map<string, NonNullable<PlaytestRound['participantStats']>[number]>();
  if (lastSeedRound?.participantStats) {
    for (const ps of lastSeedRound.participantStats) {
      lastSeedStatsByName.set(ps.player.trim().toLowerCase(), ps);
    }
  }

  const oppContexts = activeOpponents.map((opp, idx) => {
    let resolvedCustomCards: ResolvedDeckCard[] = [];
    if (
      Array.isArray(resolvedCustomCardsByBotIndex[idx]) &&
      resolvedCustomCardsByBotIndex[idx].length > 0
    ) {
      resolvedCustomCards = resolvedCustomCardsByBotIndex[idx].map((c) => ({
        ...c,
        card: c.card || findMetaFromMap(metaByName, c.name) || null,
      }));
    } else if (opp.customDeckText && opp.customDeckText.trim()) {
      const parsedBot = parseDecklistClientSide(opp.customDeckText);
      resolvedCustomCards = parsedBot.cards.map((c) => {
        const meta = findMetaFromMap(metaByName, c.name) || null;
        return {
          ...c,
          name: meta ? meta.name : c.name,
          card: meta,
        };
      });
    }

    if (resolvedCustomCards.length > 0) {
      if (formatRules.allowsCommandZone) {
        const botDeckTotal = resolvedCustomCards
          .filter((c) => c.zone === 'main' || c.zone === 'commander')
          .reduce((s, c) => s + c.quantity, 0);
        const botFormat: Exclude<DeckFormat, 'auto'> =
          resolvedCustomCards.some((c) => c.zone === 'commander') || botDeckTotal >= 80
            ? format === 'brawl'
              ? 'brawl'
              : 'commander'
            : format;
        autoRecognizeCommandersClientSide(resolvedCustomCards, botFormat);
      } else {
        for (const c of resolvedCustomCards) {
          if (c.zone === 'commander') c.zone = 'main';
        }
      }
    }

    const bias = detectArchetypeCombatBias(opp, resolvedCustomCards, format);
    const customCommanderCards = formatRules.allowsCommandZone
      ? resolvedCustomCards.filter((c) => c.zone === 'commander')
      : [];
    const customNonLandEntries = resolvedCustomCards.filter((c) => {
      if (c.zone !== 'main') return false;
      const isLand =
        c.card?.isLand !== undefined
          ? Boolean(c.card.isLand)
          : isLikelyBasicOrLandName(c.name);
      return !isLand;
    });

    const botLibraryPool: SimDeckSlot[] = [];
    const syntheticCardsForBlueprint: ResolvedDeckCard[] = [];
    let botLandSlots = 0;

    if (resolvedCustomCards.length > 0) {
      for (const item of resolvedCustomCards) {
        if (item.zone !== 'main') continue;
        const isLand =
          item.card?.isLand !== undefined
            ? Boolean(item.card.isLand)
            : isLikelyBasicOrLandName(item.name);
        const isRamp =
          Boolean(item.card?.isRamp) ||
          /\b(sol ring|arcane signet|fellwar stone|cultivate|kodama's reach|rampant growth|farseek|llanowar elves)\b/i.test(
            item.name
          );
        const producedMana = resolveSlotProducedMana(
          item.name,
          item.card || null,
          isLand,
          isRamp
        );
        if (isLand) botLandSlots += item.quantity;
        for (let q = 0; q < Math.max(1, item.quantity); q++) {
          botLibraryPool.push(
            makeSimDeckSlot({
              name: item.name,
              cmc: item.card?.cmc ?? (isLand ? 0 : isRamp ? 2 : 3),
              manaCost: item.card?.manaCost,
              isLand,
              entersTapped: Boolean(item.card?.entersTappedLikely),
              isRamp,
              producedMana,
              meta: item.card || null,
            })
          );
        }
      }

      if (botLandSlots === 0 && botLibraryPool.length > 0 && botLibraryPool.length < 35) {
        const neededLands = Math.max(12, Math.round(botLibraryPool.length * 0.65));
        for (let l = 0; l < neededLands; l++) {
          botLibraryPool.push(
            makeSimDeckSlot({
              name:
                formatRules.allowsCommandZone && l % 2 === 0
                  ? 'Command Tower'
                  : 'Basic Land',
              cmc: 0,
              isLand: true,
              entersTapped: false,
              isRamp: false,
              producedMana: ['W', 'U', 'B', 'R', 'G'],
              meta: null,
            })
          );
        }
      }
    } else {
      const samplePlays = getFormatSafeSamplePlays(opp.archetype, format);
      const targetLands = formatRules.recommendedLands;
      const targetNonLands = Math.max(10, defaultDeckSize - targetLands);

      for (let l = 0; l < targetLands; l++) {
        botLibraryPool.push(
          makeSimDeckSlot({
            name: l % 4 === 0 ? 'Tapped Dual Land' : 'Basic Land',
            cmc: 0,
            isLand: true,
            entersTapped: l % 4 === 0,
            isRamp: false,
            producedMana: ['W', 'U', 'B', 'R', 'G'],
            meta: null,
          })
        );
      }
      for (let s = 0; s < targetNonLands; s++) {
        const cardName = samplePlays[s % samplePlays.length];
        const cardMeta = findMetaFromMap(metaByName, cardName) || null;
        const isRampCard =
          Boolean(cardMeta?.isRamp) ||
          /\b(sol ring|arcane signet|cultivate|farseek|rampant growth|llanowar elves)\b/i.test(cardName);
        botLibraryPool.push(
          makeSimDeckSlot({
            name: cardName,
            cmc: cardMeta?.cmc ?? (isRampCard ? 2 : 2 + (s % 4)),
            manaCost: cardMeta?.manaCost,
            isLand: false,
            entersTapped: false,
            isRamp: isRampCard,
            producedMana: resolveSlotProducedMana(cardName, cardMeta, false, isRampCard),
            meta: cardMeta,
          })
        );
        if (s < samplePlays.length) {
          syntheticCardsForBlueprint.push({
            name: cardName,
            quantity: 1,
            zone: 'main',
            card: cardMeta,
          });
        }
      }
    }

    const blueprint: DeckSynergyBlueprint = extractDeckSynergyBlueprint(
      resolvedCustomCards.length > 0 ? resolvedCustomCards : syntheticCardsForBlueprint
    );

    const botMulligan = performLondonMulligan({
      library: botLibraryPool,
      freeFirstMulligan: formatRules.freeFirstMulligan,
      maxMulligans: 2,
    });

    const deckSize =
      resolvedCustomCards.reduce(
        (s, c) => s + (c.zone === 'main' ? c.quantity : 0),
        0
      ) || defaultDeckSize;

    const botKey = resolveBotLearningKey(opp);
    const mem =
      memoryByKey.get(botKey) || memoryByName.get(opp.name.trim().toLowerCase());
    const briefing = buildBotPastPlayBriefing(mem, deckName);
    const meta = getBotIndignanceMeta(opp.indignance);

    const seedPs = lastSeedStatsByName.get(opp.name.trim().toLowerCase());
    const seededState = seedPs
      ? hydrateHandAndLibrary(
          botLibraryPool,
          seedPs.handSize,
          seedPs.landsInPlay,
          seedPs.creaturesInPlay,
          seedPs.libraryRemaining
        )
      : null;

    const initialCmdTaken = new Map<string, number>();
    if (seedPs && formatRules.usesCommanderDamage21) {
      for (const cd of seedPs.commanderDamageTaken || []) {
        initialCmdTaken.set(cd.sourceName, cd.totalDamage);
      }
    }

    return {
      opp,
      idx,
      meta,
      mem,
      briefing,
      bias,
      blueprint,
      mulliganVerdict: botMulligan.mulliganVerdict,
      openingHandSize: botMulligan.keptHand.length,
      customCommanderCards,
      customNonLands: customNonLandEntries.map((c) => c.name),
      botLibrary: seededState ? seededState.remainingLibrary : [...botMulligan.remainingLibrary],
      botHand: seededState ? seededState.hand : [...botMulligan.keptHand],
      graveyard: [] as SimDeckSlot[],
      engines: [] as SimEnginePermanent[],
      deckSize,
      life: seedPs ? seedPs.life : (startingLife as number),
      poison: seedPs ? seedPs.poisonCounters : 0,
      cmdTaken: initialCmdTaken,
      libraryRemaining: seedPs
        ? Math.max(0, seedPs.libraryRemaining)
        : Math.max(0, botMulligan.remainingLibrary.length),
      landsInPlay: seedPs ? seedPs.landsInPlay : 0,
      rampBonus: 0,
      openMana: seedPs ? seedPs.manaAvailable : 0,
      colorSources: seededState
        ? seededState.colorSources
        : ({ W: 0, U: 0, B: 0, R: 0, G: 0 } as Record<
            'W' | 'U' | 'B' | 'R' | 'G',
            number
          >),
      cmdTaxMap: new Map<string, number>(),
      battlefield: seededState ? seededState.battlefield : ([] as SimCreaturePermanent[]),
      eliminatedBy: (seedPs ? seedPs.eliminatedBy : null) as
        | 'life'
        | 'poison'
        | 'commander'
        | 'mill'
        | null,
      grudgeByAttacker: new Map<string, number>(),
      lastTargetName: '',
      consecutiveTargetTurns: 0,
      missedLandThisRound: false,
      hadWipeThisGame: false,
      botDamageDealtTotal: 0,
      botRivalDamageTotal: 0,
      recentDamageDealt: 0,
      eliminatedInRound: null as number | null,
      counteredRivalThisRound: '' as string,
      protectedThreatThisRound: '' as string,
    };
  });

  const library: SimDeckSlot[] = [];
  for (const item of effectiveCards) {
    if (item.zone !== 'main') continue;
    const lowerName = item.name.toLowerCase();
    const isLand =
      item.card?.isLand !== undefined
        ? Boolean(item.card.isLand)
        : isLikelyBasicOrLandName(item.name);
    const isRamp =
      Boolean(item.card?.isRamp) ||
      /\b(sol ring|arcane signet|fellwar stone|cultivate|kodama's reach|rampant growth|farseek|llanowar elves)\b/i.test(
        lowerName
      );
    const producedMana = resolveSlotProducedMana(
      item.name,
      item.card || null,
      isLand,
      isRamp
    );
    for (let i = 0; i < item.quantity; i++) {
      library.push(
        makeSimDeckSlot({
          name: item.name,
          cmc: item.card?.cmc ?? (isLand ? 0 : isRamp ? 2 : 3),
          manaCost: item.card?.manaCost,
          isLand,
          entersTapped: Boolean(item.card?.entersTappedLikely),
          isRamp,
          producedMana,
          meta: item.card || null,
        })
      );
    }
  }

  const mainDeckCount = library.length;
  const playerBlueprint = extractDeckSynergyBlueprint(effectiveCards);
  const playerMulligan = performLondonMulligan({
    library,
    freeFirstMulligan: formatRules.freeFirstMulligan,
    maxMulligans: 2,
  });

  const seedYouPs = lastSeedStatsByName.get('you');
  const seededYouState = seedYouPs
    ? hydrateHandAndLibrary(
        library,
        seedYouPs.handSize,
        seedYouPs.landsInPlay,
        seedYouPs.creaturesInPlay,
        seedYouPs.libraryRemaining
      )
    : null;

  const hand = seededYouState ? seededYouState.hand : [...playerMulligan.keptHand];
  const activeLibrary = seededYouState
    ? seededYouState.remainingLibrary
    : [...playerMulligan.remainingLibrary];
  const openingHand = playerMulligan.keptHand.map((c) => c.name);

  let youLife: number = seedYouPs ? seedYouPs.life : startingLife;
  let youPoison = seedYouPs ? seedYouPs.poisonCounters : 0;
  const youCmdTaken = new Map<string, number>();
  if (seedYouPs && formatRules.usesCommanderDamage21) {
    for (const cd of seedYouPs.commanderDamageTaken || []) {
      youCmdTaken.set(cd.sourceName, cd.totalDamage);
    }
  }
  let youLibraryRemaining = seedYouPs
    ? Math.max(0, seedYouPs.libraryRemaining)
    : Math.max(0, activeLibrary.length);
  let youEliminatedBy: 'life' | 'poison' | 'commander' | 'mill' | null =
    seedYouPs?.eliminatedBy ?? null;
  let youDamageDealtLastTurn = 0;

  let landsInPlay = seedYouPs ? seedYouPs.landsInPlay : 0;
  let rampBonus = 0;
  let playerOpenMana = seedYouPs ? seedYouPs.manaAvailable : 0;
  const playerColorSources: Record<'W' | 'U' | 'B' | 'R' | 'G', number> = seededYouState
    ? seededYouState.colorSources
    : {
        W: 0,
        U: 0,
        B: 0,
        R: 0,
        G: 0,
      };
  const playerBattlefield: SimCreaturePermanent[] = seededYouState
    ? seededYouState.battlefield
    : [];
  const playerEngines: SimEnginePermanent[] = [];
  const playerGraveyard: SimDeckSlot[] = [];
  const playerCmdTaxMap = new Map<string, number>();
  const rounds: PlaytestRound[] = seedFromRounds ? [...seedFromRounds] : [];
  const playerTopThreats: string[] = [];

  const checkLiveElimination = (
    life: number,
    poison: number,
    cmdMap: Map<string, number>,
    deckedOut: boolean
  ): 'life' | 'poison' | 'commander' | 'mill' | null => {
    if (poison >= 10) return 'poison';
    if (formatRules.usesCommanderDamage21) {
      for (const d of cmdMap.values()) {
        if (d >= 21) return 'commander';
      }
    }
    if (life <= 0) return 'life';
    if (deckedOut) return 'mill';
    return null;
  };

  const getAliveCount = (): number =>
    (youEliminatedBy ? 0 : 1) + oppContexts.filter((c) => !c.eliminatedBy).length;

  // Active-round trigger hooks so every Aristocrats drain syncs 1:1 with reconcilePlaytestMatchStats
  let activeTurnPhase: 'player' | 'bot' = 'player';
  let activeTurnBotCtx: (typeof oppContexts)[number] | null = null;
  let activeRoundOffTurnDeltas: Record<string, number> = {};
  let activeRoundPlayerGainHook: ((gain: number) => void) | null = null;
  let activeRoundPlayerEachOppHook: ((delta: number) => void) | null = null;
  let activeRoundBotGainHook: ((gain: number) => void) | null = null;
  let activeRoundBotEachOppHook: ((delta: number) => void) | null = null;

  const addOffTurnLifeDelta = (playerName: string, delta: number) => {
    if (delta === 0) return;
    activeRoundOffTurnDeltas[playerName] = (activeRoundOffTurnDeltas[playerName] || 0) + delta;
  };

  // Trigger Aristocrats drain for any living participant whose creatures/engines care about creature deaths
  const triggerAristocratsOnDeath = (
    ownerKind: 'you' | 'bot',
    ownerCtx: (typeof oppContexts)[number] | null,
    deathCount: number
  ) => {
    if (deathCount <= 0) return;
    if (ownerKind === 'you' && !youEliminatedBy) {
      const hasAristocrats =
        playerBattlefield.some((p) => p.isAristocratsPayoff) ||
        playerEngines.some((e) => e.isAristocratsPayoff);
      if (hasAristocrats) {
        const drain = Math.min(4, deathCount);
        if (activeTurnPhase === 'player' && activeRoundPlayerGainHook && activeRoundPlayerEachOppHook) {
          activeRoundPlayerGainHook(drain);
          activeRoundPlayerEachOppHook(-drain);
        } else {
          youLife += drain;
          addOffTurnLifeDelta('You', drain);
          for (const o of oppContexts) {
            if (!o.eliminatedBy) {
              o.life = Math.max(0, o.life - drain);
              addOffTurnLifeDelta(o.opp.name, -drain);
            }
          }
        }
      }
    } else if (ownerKind === 'bot' && ownerCtx && !ownerCtx.eliminatedBy) {
      const hasAristocrats =
        ownerCtx.battlefield.some((p) => p.isAristocratsPayoff) ||
        ownerCtx.engines.some((e) => e.isAristocratsPayoff);
      if (hasAristocrats) {
        const drain = Math.min(4, deathCount);
        if (
          activeTurnPhase === 'bot' &&
          ownerCtx === activeTurnBotCtx &&
          activeRoundBotGainHook &&
          activeRoundBotEachOppHook
        ) {
          activeRoundBotGainHook(drain);
          activeRoundBotEachOppHook(-drain);
        } else {
          ownerCtx.life += drain;
          addOffTurnLifeDelta(ownerCtx.opp.name, drain);
          if (!youEliminatedBy) {
            youLife = Math.max(0, youLife - drain);
            addOffTurnLifeDelta('You', -drain);
          }
          for (const o of oppContexts) {
            if (o !== ownerCtx && !o.eliminatedBy) {
              o.life = Math.max(0, o.life - drain);
              addOffTurnLifeDelta(o.opp.name, -drain);
            }
          }
        }
      }
    }
  };

  // Helper: Attempt to counter a high-impact spell on the stack using actual open mana + Counterspell card in hand (or past-memory instinct)
  const tryBotCounterSpell = (
    spellName: string,
    spellCmc: number,
    spellMeta: CardMetadata | null,
    isSpellCommander: boolean,
    casterLabel: string,
    excludeBotIdx?: number
  ): string | null => {
    const spellMech = detectCardMechanics(spellName, spellMeta);
    const highImpact =
      isSpellCommander ||
      spellCmc >= 4 ||
      spellMech.isBoardWipe ||
      spellMech.isTutor ||
      spellMech.isReanimator ||
      spellMech.isEnginePermanent;

    for (const defender of oppContexts) {
      if (defender.eliminatedBy) continue;
      if (excludeBotIdx !== undefined && defender.idx === excludeBotIdx) continue;
      const defIq = defender.mem?.botIqScore ?? 100;

      // 1. Real counterspell card in hand with held-up openMana
      const counterIdx = defender.botHand.findIndex((c) => {
        if (c.isLand) return false;
        return (
          c.mech.isCounterspell &&
          canPayManaCost(defender.openMana, defender.colorSources, c.cmc, c.manaCost)
        );
      });

      if (counterIdx !== -1 && (highImpact || defender.meta.id === 'vindictive')) {
        const [counterCard] = defender.botHand.splice(counterIdx, 1);
        defender.openMana = Math.max(0, defender.openMana - counterCard.cmc);
        defender.graveyard.push(counterCard);
        defender.counteredRivalThisRound = `${casterLabel}'s "${spellName}" with ${counterCard.name}`;
        return defender.opp.name;
      }

      // 2. Fallback learned memory counter if bot doesn't have custom counterspells loaded or in hand
      if (casterLabel === 'You') {
        const knowsThreat = defender.briefing.knownThreats.some(
          (t) => normalizeCardLookupKey(t) === normalizeCardLookupKey(spellName)
        );
        const coachedForCmd =
          isSpellCommander &&
          (defender.mem?.tacticalDirectives || []).some((d) =>
            /commander|counter|removal/i.test(d)
          );
        const iqBonus = Math.min(0.32, Math.max(0, defIq - 100) / 160);
        const threshold =
          defender.meta.id === 'vindictive'
            ? 0.62
            : defender.meta.id === 'ruthless'
            ? 0.44
            : 0.24;

        if (
          (knowsThreat || coachedForCmd) &&
          defender.briefing.gamesPlayed >= 1 &&
          defender.openMana >= 2 &&
          (defender.bias.usesControl ||
            defender.meta.id === 'ruthless' ||
            defender.meta.id === 'vindictive') &&
          threshold + iqBonus >= 0.68
        ) {
          defender.openMana = Math.max(0, defender.openMana - 2);
          defender.counteredRivalThisRound = `${casterLabel}'s "${spellName}" from past threat memory`;
          return defender.opp.name;
        }
      }
    }
    return null;
  };

  // Helper: Pick highest-threat creature OR noncreature engine on an opponent's board for targeted removal
  const applyTargetedRemovalToBoard = (params: {
    targetBoard: SimCreaturePermanent[];
    targetEngines: SimEnginePermanent[];
    targetCmdTaxMap: Map<string, number>;
    targetGraveyard: SimDeckSlot[];
    defenderBotCtx?: (typeof oppContexts)[number];
    isDefenderYou: boolean;
  }): { removedCount: number; protectedName: string | null } => {
    const {
      targetBoard,
      targetEngines,
      targetCmdTaxMap,
      targetGraveyard,
      defenderBotCtx,
      isDefenderYou,
    } = params;

    // Score creatures + engines together so bots can snipe Rhystic Study / Smothering Tithe!
    const topCreature = [...targetBoard].sort(
      (a, b) =>
        b.power +
        (b.isCommander ? 4 : 0) +
        (b.isAristocratsPayoff || b.isLandfallPayoff || b.isSpellslingerPayoff ? 3 : 0) -
        (a.power +
          (a.isCommander ? 4 : 0) +
          (a.isAristocratsPayoff || a.isLandfallPayoff || a.isSpellslingerPayoff ? 3 : 0))
    )[0];
    const topEngine = [...targetEngines].sort((a, b) => b.cmc - a.cmc)[0];

    const topCreatureScore = topCreature
      ? topCreature.power +
        (topCreature.isCommander ? 4 : 0) +
        (topCreature.isAristocratsPayoff || topCreature.isLandfallPayoff ? 3 : 0)
      : -1;
    const topEngineScore = topEngine
      ? 6 + topEngine.extraDrawCount * 2 + (topEngine.isTokenMaker ? 2 : 0)
      : -1;

    if (topCreatureScore < 0 && topEngineScore < 0) {
      return { removedCount: 0, protectedName: null };
    }

    // Check if defender can protect their Commander / top creature with an instant protection spell or Lightning Greaves/Boots engine
    if (topCreatureScore >= topEngineScore && topCreature) {
      if (defenderBotCtx) {
        const protEngine = defenderBotCtx.engines.find((e) => e.isProtection);
        if (topCreature.isCommander && (protEngine || topCreature.isProtected)) {
          topCreature.isProtected = false;
          defenderBotCtx.protectedThreatThisRound = topCreature.name;
          return { removedCount: 0, protectedName: topCreature.name };
        }
        const protIdx = defenderBotCtx.botHand.findIndex((c) => {
          if (c.isLand) return false;
          return (
            c.mech.isProtection &&
            canPayManaCost(
              defenderBotCtx.openMana,
              defenderBotCtx.colorSources,
              c.cmc,
              c.manaCost
            )
          );
        });
        if (protIdx !== -1 && (topCreature.isCommander || topCreature.power >= 4)) {
          const [protCard] = defenderBotCtx.botHand.splice(protIdx, 1);
          defenderBotCtx.openMana = Math.max(0, defenderBotCtx.openMana - protCard.cmc);
          defenderBotCtx.graveyard.push(protCard);
          defenderBotCtx.protectedThreatThisRound = `${topCreature.name} (${protCard.name})`;
          return { removedCount: 0, protectedName: topCreature.name };
        }
      } else if (isDefenderYou && topCreature.isCommander) {
        const protIdx = hand.findIndex((c) => {
          if (c.isLand) return false;
          return (
            c.mech.isProtection &&
            canPayManaCost(playerOpenMana, playerColorSources, c.cmc, c.manaCost)
          );
        });
        if (protIdx !== -1) {
          const [protCard] = hand.splice(protIdx, 1);
          playerOpenMana = Math.max(0, playerOpenMana - protCard.cmc);
          playerGraveyard.push(protCard);
          return { removedCount: 0, protectedName: `${topCreature.name} via ${protCard.name}` };
        }
      }

      const idxToRemove = targetBoard.indexOf(topCreature);
      if (idxToRemove !== -1) {
        targetBoard.splice(idxToRemove, 1);
        recordCreatureDeparture(topCreature, targetCmdTaxMap, targetGraveyard);
        triggerAristocratsOnDeath(
          isDefenderYou ? 'you' : 'bot',
          defenderBotCtx || null,
          1
        );
        return { removedCount: 1, protectedName: null };
      }
    } else if (topEngine) {
      const engIdx = targetEngines.indexOf(topEngine);
      if (engIdx !== -1) {
        targetEngines.splice(engIdx, 1);
        targetGraveyard.push(
          makeSimDeckSlot({
            name: topEngine.name,
            cmc: topEngine.cmc,
            isLand: false,
            entersTapped: false,
            isRamp: topEngine.isRamp,
            producedMana: [],
            meta: null,
          })
        );
        return { removedCount: 1, protectedName: null };
      }
    }
    return { removedCount: 0, protectedName: null };
  };

  const startRound = seedFromRounds ? seedFromRounds.length + 1 : 1;
  for (let r = startRound; r <= maxRounds; r++) {
    if (getAliveCount() <= 1) {
      break;
    }
    for (const c of oppContexts) {
      c.counteredRivalThisRound = '';
      c.protectedThreatThisRound = '';
    }

    activeTurnPhase = 'player';
    activeTurnBotCtx = null;
    activeRoundOffTurnDeltas = {};

    let cardDrawn = formatRules.playerSkipsTurn1Draw && r === 1
      ? '(On the play — skipped T1 draw)'
      : '(Opening hand)';
    let playedLandName: string | null = null;
    let playedTappedLand = false;
    let tappedLandPendingColors: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> = [];
    let tappedPenalty = 0;
    const cardsPlayed: string[] = [];
    let playedSpellName: string | null = null;
    let extraDrawCount = 0;
    let playerDecked = false;
    let playerLifeGained = 0;
    let playerSelfLifeLoss = 0;
    let playerPoisonDealt = 0;
    let playerMillDealt = 0;
    let playerBurnDealt = 0;
    let playerEachOppLifeDelta = 0;
    let playerEachOppPoison = 0;
    let playerEachOppMill = 0;
    let playerClearedBoard = false;
    let playerSingleRemovalUsed = false;
    let spellCounteredByBot: string | null = null;
    let manaAvailable = Math.max(0, landsInPlay + rampBonus);
    let combatDamageTotal = 0;
    let cmdDamageDealtByPlayer = 0;
    let playerAttackTargetIdx = -1;
    let actualDmgTakenByTarget = 0;

    activeRoundPlayerGainHook = (gain: number) => {
      if (youEliminatedBy) return;
      playerLifeGained += gain;
      youLife += gain;
    };
    activeRoundPlayerEachOppHook = (delta: number) => {
      playerEachOppLifeDelta += delta;
    };

    const tempPlayerCombatBuffs: Array<{
      perm: SimCreaturePermanent;
      dPow: number;
      dTou: number;
      addedTrample: boolean;
      addedInfect: boolean;
    }> = [];

    if (!youEliminatedBy) {
      // Untap player's board and trigger ongoing noncreature engines
      for (const perm of playerBattlefield) {
        perm.tapped = false;
        perm.summoningSick = false;
      }
      for (const eng of playerEngines) {
        if (eng.extraDrawCount > 0) {
          extraDrawCount += 1;
          if (activeLibrary.length > 0 && youLibraryRemaining > 0) {
            const extra = activeLibrary.shift();
            if (extra) {
              hand.push(extra);
              youLibraryRemaining = Math.max(0, youLibraryRemaining - 1);
            }
          } else {
            youLibraryRemaining = 0;
            playerDecked = true;
          }
        }
        if (eng.isTokenMaker) {
          const tCnt = Math.min(3, Math.max(1, eng.tokenCount || 1));
          const tPow = Math.max(1, eng.tokenPower || 1);
          for (let ti = 0; ti < tCnt; ti++) {
            playerBattlefield.push(createTokenPermanent(`${eng.name} Token`, tPow, tPow));
          }
        }
        if (eng.selfLifeLossAmount > 0) {
          playerSelfLifeLoss += eng.selfLifeLossAmount;
        }
        if (eng.burnOrDrainAmount > 0 && eng.hitsEachOpponent) {
          playerEachOppLifeDelta -= Math.min(2, eng.burnOrDrainAmount);
        }
      }

      if (!playerDecked && (r > 1 || !formatRules.playerSkipsTurn1Draw)) {
        if (youLibraryRemaining > 0 && activeLibrary.length > 0) {
          const drawn = activeLibrary.shift()!;
          hand.push(drawn);
          cardDrawn = drawn.name;
          youLibraryRemaining = Math.max(0, youLibraryRemaining - 1);
        } else {
          cardDrawn = '(Empty library)';
          youLibraryRemaining = 0;
          playerDecked = true;
        }
      }

      if (playerDecked) {
        youEliminatedBy = 'mill';
        playerBattlefield.length = 0;
        playerEngines.length = 0;
      }

      if (!youEliminatedBy) {
        const untappedIdx = hand.findIndex((c) => c.isLand && !c.entersTapped);
        const tappedIdx = hand.findIndex((c) => c.isLand && c.entersTapped);
        const hasEarlyPlay = hand.some((c) => !c.isLand && c.cmc <= landsInPlay + rampBonus + 1);
        const chosenLandIdx =
          r === 1 && !hasEarlyPlay && tappedIdx !== -1
            ? tappedIdx
            : untappedIdx !== -1
            ? untappedIdx
            : tappedIdx;

        if (chosenLandIdx !== -1) {
          const [land] = hand.splice(chosenLandIdx, 1);
          playedLandName = land.name;
          landsInPlay += 1;
          if (land.entersTapped) {
            tappedPenalty = 1;
            playedTappedLand = true;
            tappedLandPendingColors = land.producedMana;
          } else {
            for (const col of land.producedMana) {
              if (col !== 'C') playerColorSources[col] += 1;
            }
            if (land.mech.selfLifeLossAmount > 0) {
              playerSelfLifeLoss += land.mech.selfLifeLossAmount;
            }
          }
          // Landfall trigger for player
          if (
            playerBattlefield.some((p) => p.isLandfallPayoff) ||
            playerEngines.some((e) => e.isLandfallPayoff)
          ) {
            playerBattlefield.push(createTokenPermanent('Landfall Token', 2, 2));
          }
        }

        manaAvailable = Math.max(0, landsInPlay + rampBonus - tappedPenalty);
        let remainingMana = manaAvailable;
        if (playedLandName) cardsPlayed.push(playedLandName);

        // Player casts Commander ONLY in formats with a Command Zone
        const castableCommander = formatRules.allowsCommandZone
          ? commanderCards.find((cmd) => {
              const onBoard = playerBattlefield.some(
                (p) => p.isCommander && p.commanderName === cmd.name
              );
              const cost = (cmd.card?.cmc ?? 4) + (playerCmdTaxMap.get(cmd.name) || 0);
              return (
                !onBoard &&
                canPayManaCost(remainingMana, playerColorSources, cost, cmd.card?.manaCost)
              );
            })
          : undefined;

        let castPermanentThisTurn: SimCreaturePermanent | null = null;
        let castSpellMeta: CardMetadata | null = null;
        let castSpellCmc = 0;
        let castIsCommander = false;

        if (castableCommander) {
          const cost =
            (castableCommander.card?.cmc ?? 4) +
            (playerCmdTaxMap.get(castableCommander.name) || 0);
          remainingMana = Math.max(0, remainingMana - cost);
          cardsPlayed.push(castableCommander.name);
          playedSpellName = castableCommander.name;
          castSpellMeta = castableCommander.card || null;
          castSpellCmc = cost;
          castIsCommander = true;

          const counteredBy =
            r >= 2
              ? tryBotCounterSpell(
                  castableCommander.name,
                  cost,
                  castableCommander.card || null,
                  true,
                  'You'
                )
              : null;

          if (counteredBy) {
            spellCounteredByBot = counteredBy;
            playerCmdTaxMap.set(
              castableCommander.name,
              (playerCmdTaxMap.get(castableCommander.name) || 0) + 2
            );
          } else {
            const cmdMech = detectCardMechanics(
              castableCommander.name,
              castableCommander.card
            );
            const perm = buildPermanentFromCard(
              castableCommander.name,
              castableCommander.card,
              true,
              castableCommander.name,
              3,
              false,
              cmdMech
            );
            if (perm.power > 0 || /\bcreature\b/i.test(castableCommander.card?.typeLine || '')) {
              playerBattlefield.push(perm);
              castPermanentThisTurn = perm;
            }
            if (cmdMech.millAmount > 0) {
              if (cmdMech.hitsEachOpponent) playerEachOppMill += cmdMech.millAmount;
              else playerMillDealt += cmdMech.millAmount;
            }
            if (cmdMech.burnOrDrainAmount > 0) {
              if (cmdMech.hitsEachOpponent) playerEachOppLifeDelta -= cmdMech.burnOrDrainAmount;
              else playerBurnDealt += cmdMech.burnOrDrainAmount;
            }
            if (cmdMech.hasProliferate && playerBattlefield.length > 0) {
              playerEachOppPoison += 1;
            }
            playerTopThreats.push(castableCommander.name);
          }
        }

        // Cast up to 4 maindeck spells if mana & colors allow (ramp early, curve out in late game)
        for (let pass = 0; pass < 4; pass++) {
          if (remainingMana <= 0) break;
          const hasCounterInHand = hand.some((c) => !c.isLand && c.mech.isCounterspell);
          const reservedForCounter =
            hasCounterInHand && playerBlueprint.counterspellCount >= 3 && r >= 3 ? 2 : 0;
          const budgetForPass = Math.max(0, remainingMana - reservedForCounter);

          const castableIdx = hand
            .map((c, idx) => ({ c, idx, m: c.mech }))
            .filter(
              ({ c, m }) =>
                !c.isLand &&
                !m.isCounterspell &&
                !m.isProtection &&
                canPayManaCost(budgetForPass, playerColorSources, c.cmc, c.manaCost)
            )
            .sort((a, b) => {
              if (r <= 3 && a.c.isRamp !== b.c.isRamp) return a.c.isRamp ? -1 : 1;
              if (a.m.isReanimator && playerGraveyard.length > 0 && !b.m.isReanimator) return -1;
              if (b.m.isReanimator && playerGraveyard.length > 0 && !a.m.isReanimator) return 1;
              if (a.m.isBoardPump && playerBattlefield.length >= 2 && !b.m.isBoardPump) return -1;
              if (b.m.isBoardPump && playerBattlefield.length >= 2 && !a.m.isBoardPump) return 1;
              return b.c.cmc - a.c.cmc;
            })[0]?.idx;

          if (castableIdx === undefined) break;
          const [spell] = hand.splice(castableIdx, 1);
          const spellMech = spell.mech;
          const xValue = spellMech.isXSpell ? Math.max(2, remainingMana - 2) : 0;
          remainingMana = spellMech.isXSpell ? 0 : Math.max(0, remainingMana - spell.cmc);
          cardsPlayed.push(spell.name);
          if (!playedSpellName) {
            playedSpellName = spell.name;
            castSpellMeta = spell.meta;
            castSpellCmc = spell.cmc;
            castIsCommander = false;
          }

          const counteredBy =
            r >= 2 && !spellCounteredByBot
              ? tryBotCounterSpell(spell.name, spell.cmc, spell.meta, false, 'You')
              : null;

          if (counteredBy) {
            spellCounteredByBot = counteredBy;
            playerGraveyard.push(spell);
            continue;
          }

          if (spellMech.selfLifeLossAmount > 0) {
            playerSelfLifeLoss += spellMech.selfLifeLossAmount;
          }
          if (spell.isRamp) {
            rampBonus += 1;
            for (const col of spell.producedMana) {
              if (col !== 'C') playerColorSources[col] += 1;
            }
          }
          if (spellMech.isTutor && activeLibrary.length > 0) {
            // Tutor strongest key payoff or board answer into hand
            const tutorIdx = activeLibrary
              .map((c, idx) => ({
                idx,
                score:
                  (playerBlueprint.keyPayoffs.includes(c.name) ? 10 : 0) +
                  (!c.isLand ? c.cmc : 0),
              }))
              .sort((a, b) => b.score - a.score)[0]?.idx;
            if (tutorIdx !== undefined) {
              const [tutored] = activeLibrary.splice(tutorIdx, 1);
              hand.push(tutored);
              youLibraryRemaining = Math.max(0, youLibraryRemaining - 1);
            }
          }
          if (spellMech.isReanimator && playerGraveyard.length > 0) {
            playerGraveyard.sort((a, b) => b.cmc - a.cmc);
            const [revived] = playerGraveyard.splice(0, 1);
            if (revived) {
              playerBattlefield.push(
                buildPermanentFromCard(revived.name, revived.meta, false, '', 4, false, revived.mech)
              );
            }
          }
          if (spellMech.extraDrawCount > 0) {
            const toDraw = spellMech.extraDrawCount;
            extraDrawCount += toDraw;
            for (let d = 0; d < toDraw; d++) {
              if (youLibraryRemaining > 0 && activeLibrary.length > 0) {
                const extra = activeLibrary.shift()!;
                hand.push(extra);
                youLibraryRemaining = Math.max(0, youLibraryRemaining - 1);
              } else {
                youLibraryRemaining = 0;
                playerDecked = true;
              }
            }
          }
          if (spellMech.isXSpell) {
            const liveOppsCount = oppContexts.filter((c) => !c.eliminatedBy).length;
            const scaledDmg = Math.max(3, xValue);
            if (spellMech.hitsEachOpponent || /exsanguinate|torment|crackle/i.test(spell.name)) {
              playerEachOppLifeDelta -= scaledDmg;
              if (/exsanguinate/i.test(spell.name)) {
                playerLifeGained += scaledDmg * Math.max(1, liveOppsCount);
              }
            } else {
              playerBurnDealt += scaledDmg;
            }
          } else {
            if (spellMech.lifegainAmount > 0) playerLifeGained += spellMech.lifegainAmount;
            if (spellMech.burnOrDrainAmount > 0) {
              if (spellMech.hitsEachOpponent) playerEachOppLifeDelta -= spellMech.burnOrDrainAmount;
              else playerBurnDealt += spellMech.burnOrDrainAmount;
            }
          }
          if (spellMech.millAmount > 0) {
            if (spellMech.hitsEachOpponent) playerEachOppMill += spellMech.millAmount;
            else playerMillDealt += spellMech.millAmount;
          }
          if (spellMech.isBoardPump && playerBattlefield.length > 0) {
            const isTriumph = /triumph of the hordes/i.test(spell.name);
            const isCraterhoof = /craterhoof/i.test(spell.name);
            const pumpDelta = isTriumph
              ? 1
              : isCraterhoof
              ? Math.max(4, playerBattlefield.length)
              : 3;
            for (const p of playerBattlefield) {
              p.power += pumpDelta;
              p.toughness += pumpDelta;
              const addedTrample = !p.hasTrample;
              const addedInfect = isTriumph && !p.hasInfect;
              p.hasTrample = true;
              if (isTriumph) p.hasInfect = true;
              tempPlayerCombatBuffs.push({
                perm: p,
                dPow: pumpDelta,
                dTou: pumpDelta,
                addedTrample,
                addedInfect,
              });
            }
          } else if (spellMech.isVoltronBuff && playerBattlefield.length > 0) {
            const buffTarget =
              playerBattlefield.find((p) => p.isCommander) || playerBattlefield[0];
            buffTarget.power += 2;
            buffTarget.toughness += 2;
          }
          if (spellMech.isBoardWipe) {
            playerClearedBoard = true;
            playerGraveyard.push(spell);
          } else if (spellMech.isCounterOrRemoval) {
            playerSingleRemovalUsed = true;
            playerGraveyard.push(spell);
          } else if (
            spellMech.estimatedPower > 0 ||
            /\bcreature\b/i.test(spell.meta?.typeLine || '')
          ) {
            const perm = buildPermanentFromCard(spell.name, spell.meta, false, '', 2, false, spellMech);
            playerBattlefield.push(perm);
            if (!castPermanentThisTurn) castPermanentThisTurn = perm;
            if (spellMech.tokenCount > 0) {
              for (let ti = 0; ti < spellMech.tokenCount; ti++) {
                playerBattlefield.push(
                  createTokenPermanent(`${spell.name} Token`, spellMech.tokenPower || 1, spellMech.tokenPower || 1)
                );
              }
            }
          } else if (
            spellMech.isEnginePermanent ||
            spellMech.isTokenMaker ||
            spellMech.isAristocratsPayoff ||
            spellMech.isSacOutlet ||
            spellMech.isLandfallPayoff ||
            spellMech.isSpellslingerPayoff ||
            (/\b(artifact|enchantment|planeswalker)\b/i.test(spell.meta?.typeLine || '') &&
              !spell.isRamp)
          ) {
            playerEngines.push({
              name: spell.name,
              cmc: spell.cmc,
              isTokenMaker: spellMech.isTokenMaker,
              tokenCount: spellMech.tokenCount || 1,
              tokenPower: spellMech.tokenPower || 1,
              isAristocratsPayoff: spellMech.isAristocratsPayoff,
              isSacOutlet: spellMech.isSacOutlet,
              isLandfallPayoff: spellMech.isLandfallPayoff,
              isSpellslingerPayoff: spellMech.isSpellslingerPayoff,
              isProtection: spellMech.isProtection,
              extraDrawCount: spellMech.extraDrawCount,
              burnOrDrainAmount: spellMech.burnOrDrainAmount,
              selfLifeLossAmount: spellMech.selfLifeLossAmount,
              hitsEachOpponent: spellMech.hitsEachOpponent,
              isRamp: spell.isRamp,
            });
            if (spellMech.tokenCount > 0) {
              for (let ti = 0; ti < spellMech.tokenCount; ti++) {
                playerBattlefield.push(
                  createTokenPermanent(`${spell.name} Token`, spellMech.tokenPower || 1, spellMech.tokenPower || 1)
                );
              }
            }
          } else {
            playerGraveyard.push(spell);
            if (spellMech.tokenCount > 0) {
              for (let ti = 0; ti < spellMech.tokenCount; ti++) {
                playerBattlefield.push(
                  createTokenPermanent(`${spell.name} Token`, spellMech.tokenPower || 1, spellMech.tokenPower || 1)
                );
              }
            }
            if (spellMech.hasInfect || spellMech.toxicValue > 0) {
              playerPoisonDealt += Math.max(1, spellMech.toxicValue || 1);
            }
          }
          if (spell.cmc >= 3) playerTopThreats.push(spell.name);
        }

        // Tapped land untaps on Turn r+1 — register its colors now so it wasn't usable on Turn r
        for (const col of tappedLandPendingColors) {
          if (col !== 'C') playerColorSources[col] += 1;
        }
        playerOpenMana = remainingMana;

        // Avoid unused local warning
        void castSpellMeta;
        void castSpellCmc;
        void castIsCommander;

        // Endgame sudden-death fatigue if an extreme stalemate exceeds Round 37
        if (r >= 38) {
          playerSelfLifeLoss += (r - 37) * (startingLife >= 30 ? 3 : 2);
        }

        // Apply Player life gain & self-life-loss identically to reconcilePlaytestMatchStats
        if (playerLifeGained > 0 || playerSelfLifeLoss > 0) {
          youLife = Math.max(0, youLife + playerLifeGained - playerSelfLifeLoss);
        }
        const playerSelfElim = checkLiveElimination(
          youLife,
          youPoison,
          youCmdTaken,
          playerDecked
        );
        if (playerSelfElim && !youEliminatedBy) {
          youEliminatedBy = playerSelfElim;
          playerBattlefield.length = 0;
          playerEngines.length = 0;
        }

        // Player SacOutlet + Aristocrats sacrifice loop (sac up to 2 expendable tokens)
        const playerHasSacOutlet =
          playerBattlefield.some((p) => p.isSacOutlet) || playerEngines.some((e) => e.isSacOutlet);
        const playerHasAristocrats =
          playerBattlefield.some((p) => p.isAristocratsPayoff) ||
          playerEngines.some((e) => e.isAristocratsPayoff);
        if (!youEliminatedBy && playerHasSacOutlet && playerHasAristocrats) {
          let sacsDone = 0;
          for (let si = playerBattlefield.length - 1; si >= 0 && sacsDone < 2; si--) {
            const fodder = playerBattlefield[si];
            if (fodder.isToken && !fodder.isAristocratsPayoff && !fodder.isSacOutlet) {
              playerBattlefield.splice(si, 1);
              sacsDone += 1;
            }
          }
          if (sacsDone > 0) {
            triggerAristocratsOnDeath('you', null, sacsDone);
          }
        }

        // Apply player's removal/wipe to live bots before player combat
        const liveBotsForRemoval = oppContexts.filter((c) => !c.eliminatedBy);
        if (!youEliminatedBy && playerClearedBoard) {
          for (const ctx of liveBotsForRemoval) {
            const deaths = ctx.battlefield.length;
            if (deaths > 0) {
              triggerAristocratsOnDeath('bot', ctx, deaths);
            }
            for (const perm of ctx.battlefield) {
              recordCreatureDeparture(perm, ctx.cmdTaxMap, ctx.graveyard);
            }
            ctx.battlefield.length = 0;
          }
          if (playerBattlefield.length > 0) {
            triggerAristocratsOnDeath('you', null, playerBattlefield.length);
          }
          for (const perm of playerBattlefield) {
            recordCreatureDeparture(perm, playerCmdTaxMap, playerGraveyard);
          }
          playerBattlefield.length = 0;
          // Sweep eliminations triggered by wipe Aristocrats drains
          for (const bCtx of oppContexts) {
            if (bCtx.eliminatedBy) continue;
            const elim = checkLiveElimination(bCtx.life, bCtx.poison, bCtx.cmdTaken, false);
            if (elim) {
              bCtx.eliminatedBy = elim;
              bCtx.eliminatedInRound = r;
              bCtx.battlefield.length = 0;
              bCtx.engines.length = 0;
            }
          }
          if (!youEliminatedBy) {
            const youPostWipeElim = checkLiveElimination(youLife, youPoison, youCmdTaken, playerDecked);
            if (youPostWipeElim) {
              youEliminatedBy = youPostWipeElim;
              playerBattlefield.length = 0;
              playerEngines.length = 0;
            }
          }
        } else if (!youEliminatedBy && playerSingleRemovalUsed && liveBotsForRemoval.length > 0) {
          const biggest = [...liveBotsForRemoval].sort((a, b) => {
            const aThreat =
              a.battlefield.reduce((s, p) => s + p.power, 0) + a.engines.length * 4;
            const bThreat =
              b.battlefield.reduce((s, p) => s + p.power, 0) + b.engines.length * 4;
            return bThreat - aThreat;
          })[0];
          if (biggest) {
            const remRes = applyTargetedRemovalToBoard({
              targetBoard: biggest.battlefield,
              targetEngines: biggest.engines,
              targetCmdTaxMap: biggest.cmdTaxMap,
              targetGraveyard: biggest.graveyard,
              defenderBotCtx: biggest,
              isDefenderYou: false,
            });
            if (remRes.removedCount > 0) {
              biggest.grudgeByAttacker.set(
                'You',
                (biggest.grudgeByAttacker.get('You') || 0) + 6
              );
              const postRemElim = checkLiveElimination(biggest.life, biggest.poison, biggest.cmdTaken, false);
              if (postRemElim && !biggest.eliminatedBy) {
                biggest.eliminatedBy = postRemElim;
                biggest.eliminatedInRound = r;
                biggest.battlefield.length = 0;
                biggest.engines.length = 0;
              }
            }
          }
        }

        // Ready Player attackers (non-summoning-sick or Haste)
        const readyAttackers = youEliminatedBy
          ? []
          : playerBattlefield.filter(
              (p) => !p.tapped && (!p.summoningSick || p.hasHaste) && p.power > 0
            );
        const totalReadyPower = readyAttackers.reduce(
          (s, a) => s + a.power * (a.hasDoubleStrike ? 2 : 1),
          0
        );
        const aliveTargets = oppContexts.filter((c) => !c.eliminatedBy);

        let chosenBotForCombat: (typeof oppContexts)[number] | null = null;
        let playerCombatAttackerDeaths = 0;
        let playerCombatDefenderDeaths = 0;

        if (!youEliminatedBy && aliveTargets.length > 0) {
          const scoredBotTargets = aliveTargets.map((c) => {
            const cBoardPower = c.battlefield.reduce((s, p) => s + p.power, 0);
            const cUntapped = c.battlefield.filter((p) => !p.tapped).length;
            const cHasCmd = c.battlefield.some((p) => p.isCommander);
            const rawAttackSum = totalReadyPower + playerBurnDealt - playerEachOppLifeDelta;
            const canFinish =
              rawAttackSum >= c.life ||
              c.poison + playerPoisonDealt + playerEachOppPoison >= 10 ||
              c.libraryRemaining <= playerMillDealt + playerEachOppMill;
            const threat =
              cBoardPower * 1.45 +
              c.battlefield.length * 1.2 +
              c.engines.length * 3.5 +
              (cHasCmd ? 5 : 0) +
              (cUntapped === 0 ? 4 : -cUntapped * 0.8) +
              (c.poison >= 5 ? 4 : 0) +
              (startingLife - c.life) * 0.25 +
              (canFinish ? 60 : 0);
            return { c, threat };
          });
          scoredBotTargets.sort((a, b) => b.threat - a.threat);
          const chosenBot = scoredBotTargets[0].c;
          chosenBotForCombat = chosenBot;
          playerAttackTargetIdx = chosenBot.idx;

          let combatRes = {
            combatDamage: 0,
            poisonDealt: 0,
            commanderDamageBySource: new Map<string, number>(),
            millDealt: 0,
            lifegainDealt: 0,
            defenderLifegain: 0,
            proliferateCount: 0,
            attackerDeaths: 0,
            defenderDeaths: 0,
          };

          if (readyAttackers.length > 0) {
            combatRes = resolveCombatPhaseBetweenBoards({
              attackers: readyAttackers,
              defenderBoard: chosenBot.battlefield,
              defenderLife: chosenBot.life,
              defenderPoison: chosenBot.poison,
              defenderIsPlayer: false,
              attackerBoard: playerBattlefield,
              onAttackerCreatureDied: (perm) => {
                recordCreatureDeparture(perm, playerCmdTaxMap, playerGraveyard);
              },
              onDefenderCreatureDied: (perm) => {
                recordCreatureDeparture(perm, chosenBot.cmdTaxMap, chosenBot.graveyard);
              },
            });
            playerCombatAttackerDeaths = combatRes.attackerDeaths;
            playerCombatDefenderDeaths = combatRes.defenderDeaths;
          }

          combatDamageTotal = combatRes.combatDamage + playerBurnDealt;
          playerPoisonDealt += combatRes.poisonDealt;
          if (combatRes.proliferateCount > 0 && chosenBot.poison > 0) {
            playerEachOppPoison += combatRes.proliferateCount;
          }
          playerMillDealt += combatRes.millDealt;
          if (combatRes.lifegainDealt > 0) {
            youLife += combatRes.lifegainDealt;
            playerLifeGained += combatRes.lifegainDealt;
          }

          // Reconcile net combat vs defender lifelink cleanly so reconciler Pass 1 stays 100% synced
          if (combatRes.defenderLifegain > 0) {
            if (combatDamageTotal >= combatRes.defenderLifegain) {
              combatDamageTotal -= combatRes.defenderLifegain;
            } else {
              const netGain = combatRes.defenderLifegain - combatDamageTotal;
              combatDamageTotal = 0;
              chosenBot.life += netGain;
              addOffTurnLifeDelta(chosenBot.opp.name, netGain);
            }
          }

          for (const [, dmg] of combatRes.commanderDamageBySource.entries()) {
            cmdDamageDealtByPlayer += dmg;
          }

          actualDmgTakenByTarget = combatDamageTotal;
          chosenBot.life = Math.max(0, chosenBot.life - actualDmgTakenByTarget);
          if (playerPoisonDealt > 0) {
            chosenBot.poison = Math.min(20, chosenBot.poison + playerPoisonDealt);
          }
          if (formatRules.usesCommanderDamage21) {
            for (const [cmdName, dmg] of combatRes.commanderDamageBySource.entries()) {
              chosenBot.cmdTaken.set(
                cmdName,
                (chosenBot.cmdTaken.get(cmdName) || 0) + dmg
              );
            }
          }
          if (playerMillDealt > 0) {
            chosenBot.libraryRemaining = Math.max(
              0,
              chosenBot.libraryRemaining - playerMillDealt
            );
          }

          chosenBot.grudgeByAttacker.set(
            'You',
            (chosenBot.grudgeByAttacker.get('You') || 0) +
              actualDmgTakenByTarget +
              playerPoisonDealt * 3 +
              Math.round(playerMillDealt / 2)
          );
          youDamageDealtLastTurn = actualDmgTakenByTarget + Math.max(0, -playerEachOppLifeDelta);
        }

        // Apply Player's eachOpponent effects (Aristocrats drains, Overrun/Exsanguinate/Proliferate/Mill) across ALL alive bots
        if (
          playerEachOppLifeDelta !== 0 ||
          playerEachOppPoison > 0 ||
          playerEachOppMill > 0
        ) {
          for (const bCtx of oppContexts) {
            if (bCtx.eliminatedBy) continue;
            bCtx.life = Math.max(0, bCtx.life + playerEachOppLifeDelta);
            if (playerEachOppPoison > 0) {
              bCtx.poison = Math.min(20, bCtx.poison + playerEachOppPoison);
            }
            if (playerEachOppMill > 0) {
              bCtx.libraryRemaining = Math.max(0, bCtx.libraryRemaining - playerEachOppMill);
            }
          }
        }

        // Sweep bot eliminations immediately after Player's combat damage (mirrors reconciler Pass 1 before post-combat Aristocrats)
        for (const bCtx of oppContexts) {
          if (bCtx.eliminatedBy) continue;
          const elim = checkLiveElimination(
            bCtx.life,
            bCtx.poison,
            bCtx.cmdTaken,
            false
          );
          if (elim) {
            bCtx.eliminatedBy = elim;
            bCtx.eliminatedInRound = r;
            bCtx.battlefield.length = 0;
            bCtx.engines.length = 0;
          }
        }

        // Trigger Aristocrats only for survivors after combat damage & elimination SBAs
        if (playerCombatAttackerDeaths > 0 && !youEliminatedBy) {
          triggerAristocratsOnDeath('you', null, playerCombatAttackerDeaths);
        }
        if (playerCombatDefenderDeaths > 0 && chosenBotForCombat && !chosenBotForCombat.eliminatedBy) {
          triggerAristocratsOnDeath('bot', chosenBotForCombat, playerCombatDefenderDeaths);
        }

        // Sweep again if Aristocrats drains finished off a player/bot
        for (const bCtx of oppContexts) {
          if (bCtx.eliminatedBy) continue;
          const elim = checkLiveElimination(bCtx.life, bCtx.poison, bCtx.cmdTaken, false);
          if (elim) {
            bCtx.eliminatedBy = elim;
            bCtx.eliminatedInRound = r;
            bCtx.battlefield.length = 0;
            bCtx.engines.length = 0;
          }
        }
        if (!youEliminatedBy) {
          const youPostDrainElim = checkLiveElimination(youLife, youPoison, youCmdTaken, playerDecked);
          if (youPostDrainElim) {
            youEliminatedBy = youPostDrainElim;
            playerBattlefield.length = 0;
            playerEngines.length = 0;
          }
        }
      }
    }

    // Revert EOT combat pumps so Overrun/Triumph don't permanently stick across rounds
    for (const buff of tempPlayerCombatBuffs) {
      buff.perm.power = Math.max(0, buff.perm.power - buff.dPow);
      buff.perm.toughness = Math.max(1, buff.perm.toughness - buff.dTou);
      if (buff.addedTrample) buff.perm.hasTrample = false;
      if (buff.addedInfect) buff.perm.hasInfect = false;
    }

    const missedLand = !playedLandName && r <= 4;

    // 2. Bot Opponents' Turns (each living bot sequences strategically across You + rival bots!)
    const targetedCountThisRound = new Map<string, number>();
    const botPlays: PlaytestBotPlay[] = oppContexts.map((ctx) => {
      const { opp, idx, meta, mem, briefing, bias, blueprint, customNonLands } = ctx;
      const iq = mem?.botIqScore ?? 100;
      const ggufDirective =
        botTacticalDirectives[opp.name] ||
        botTacticalDirectives[(opp.name || '').trim().toLowerCase()];
      const ggufThreatLower = (ggufDirective?.keyThreatToAnswer || '').trim().toLowerCase();

      if (ctx.eliminatedBy) {
        return {
          botName: opp.name,
          archetype: customNonLands.length > 0 ? 'Custom Decklist' : opp.archetype,
          indignance: meta.id as BotIndignanceLevel,
          commanderName: bias.defaultCommanderName,
          targetParticipant: 'You',
          action: `Eliminated (${ctx.eliminatedBy}) — out of the match.`,
          boardThreat: 'Eliminated (0 creatures)',
          lifeChangeToYou: 0,
          poisonToYou: 0,
          commanderDamageToYou: 0,
          millToYou: 0,
          targetLifeDelta: 0,
          targetPoisonDelta: 0,
          targetCommanderDamage: 0,
          targetMillAmount: 0,
          eachOpponentLifeDelta: 0,
          eachOpponentPoison: 0,
          eachOpponentMill: 0,
          creaturesRemovedOnTarget: 0,
          boardWipeCast: false,
          selfLifeGain: 0,
          selfLifeLoss: 0,
          eliminatedThisTurn: true,
          damageTakenFromYou: idx === playerAttackTargetIdx ? actualDmgTakenByTarget : 0,
          poisonTakenFromYou: idx === playerAttackTargetIdx ? playerPoisonDealt : 0,
          commanderDamageTakenFromYou: idx === playerAttackTargetIdx ? cmdDamageDealtByPlayer : 0,
          millTakenFromYou: idx === playerAttackTargetIdx ? playerMillDealt : 0,
          creaturesOnBoard: 0,
          landsInPlay: ctx.landsInPlay,
          manaAvailable: 0,
          handSize: 0,
        };
      }

      if (getAliveCount() <= 1 && !ctx.eliminatedBy) {
        return {
          botName: opp.name,
          archetype: customNonLands.length > 0 ? 'Custom Decklist' : opp.archetype,
          indignance: meta.id as BotIndignanceLevel,
          commanderName: bias.defaultCommanderName,
          targetParticipant: opp.name,
          action: `${opp.name} is the last player standing — match concluded.`,
          boardThreat: `Sole Survivor (${ctx.battlefield.length} creatures)`,
          lifeChangeToYou: 0,
          poisonToYou: 0,
          commanderDamageToYou: 0,
          millToYou: 0,
          targetLifeDelta: 0,
          targetPoisonDelta: 0,
          targetCommanderDamage: 0,
          targetMillAmount: 0,
          eachOpponentLifeDelta: 0,
          eachOpponentPoison: 0,
          eachOpponentMill: 0,
          creaturesRemovedOnTarget: 0,
          boardWipeCast: false,
          selfLifeGain: 0,
          selfLifeLoss: 0,
          eliminatedThisTurn: false,
          damageTakenFromYou: idx === playerAttackTargetIdx ? actualDmgTakenByTarget : 0,
          poisonTakenFromYou: idx === playerAttackTargetIdx ? playerPoisonDealt : 0,
          commanderDamageTakenFromYou: idx === playerAttackTargetIdx ? cmdDamageDealtByPlayer : 0,
          millTakenFromYou: idx === playerAttackTargetIdx ? playerMillDealt : 0,
          creaturesOnBoard: ctx.battlefield.length,
          landsInPlay: ctx.landsInPlay,
          manaAvailable: ctx.openMana,
          handSize: ctx.botHand.length,
        };
      }

      activeTurnPhase = 'bot';
      activeTurnBotCtx = ctx;

      // Untap step for bot & trigger ongoing noncreature engines
      for (const perm of ctx.battlefield) {
        perm.tapped = false;
        perm.summoningSick = false;
        perm.isProtected = false;
      }

      let spellBurn = 0;
      let spellPoison = 0;
      let spellMill = 0;
      let spellEachOppLife = 0;
      let spellEachOppPoison = 0;
      let spellEachOppMill = 0;
      let selfLifeGain = 0;
      let selfLifeLoss = r >= 38 ? (r - 37) * (startingLife >= 30 ? 3 : 2) : 0;

      activeRoundBotGainHook = (gain: number) => {
        selfLifeGain += gain;
      };
      activeRoundBotEachOppHook = (delta: number) => {
        spellEachOppLife += delta;
      };

      const tempBotCombatBuffs: Array<{
        perm: SimCreaturePermanent;
        dPow: number;
        dTou: number;
        addedTrample: boolean;
        addedInfect: boolean;
      }> = [];

      for (const eng of ctx.engines) {
        if (eng.extraDrawCount > 0 && ctx.botLibrary.length > 0 && ctx.libraryRemaining > 0) {
          const extra = ctx.botLibrary.shift();
          if (extra) {
            ctx.botHand.push(extra);
            ctx.libraryRemaining = Math.max(0, ctx.libraryRemaining - 1);
          }
        }
        if (eng.isTokenMaker) {
          const tCnt = Math.min(3, Math.max(1, eng.tokenCount || 1));
          const tPow = Math.max(1, eng.tokenPower || 1);
          for (let ti = 0; ti < tCnt; ti++) {
            ctx.battlefield.push(createTokenPermanent(`${eng.name} Token`, tPow, tPow));
          }
        }
        if (eng.selfLifeLossAmount > 0) {
          selfLifeLoss += eng.selfLifeLossAmount;
        }
        if (eng.burnOrDrainAmount > 0 && eng.hitsEachOpponent) {
          spellEachOppLife -= Math.min(2, eng.burnOrDrainAmount);
        }
      }

      // Draw step for bot: only decks out if attempting to draw when library is already empty (CR 104.3c)
      let botDeckedOut = false;
      if (ctx.libraryRemaining <= 0 || ctx.botLibrary.length === 0) {
        ctx.libraryRemaining = 0;
        botDeckedOut = true;
      } else {
        const botDrawn = ctx.botLibrary.shift()!;
        ctx.botHand.push(botDrawn);
        ctx.libraryRemaining = Math.max(0, ctx.libraryRemaining - 1);
      }
      if (botDeckedOut) {
        ctx.eliminatedBy = 'mill';
        ctx.eliminatedInRound = r;
        ctx.battlefield.length = 0;
        ctx.engines.length = 0;
        return {
          botName: opp.name,
          archetype: customNonLands.length > 0 ? 'Custom Decklist' : opp.archetype,
          indignance: meta.id as BotIndignanceLevel,
          commanderName: bias.defaultCommanderName,
          targetParticipant: 'You',
          action: 'Attempted to draw from an empty library and decked out!',
          boardThreat: 'Eliminated (mill)',
          lifeChangeToYou: 0,
          poisonToYou: 0,
          commanderDamageToYou: 0,
          millToYou: 0,
          targetLifeDelta: 0,
          targetPoisonDelta: 0,
          targetCommanderDamage: 0,
          targetMillAmount: 0,
          eachOpponentLifeDelta: 0,
          eachOpponentPoison: 0,
          eachOpponentMill: 0,
          creaturesRemovedOnTarget: 0,
          boardWipeCast: false,
          selfLifeGain: 0,
          selfLifeLoss: 0,
          eliminatedThisTurn: true,
          damageTakenFromYou: idx === playerAttackTargetIdx ? actualDmgTakenByTarget : 0,
          poisonTakenFromYou: idx === playerAttackTargetIdx ? playerPoisonDealt : 0,
          commanderDamageTakenFromYou: idx === playerAttackTargetIdx ? cmdDamageDealtByPlayer : 0,
          millTakenFromYou: idx === playerAttackTargetIdx ? playerMillDealt : 0,
          creaturesOnBoard: 0,
          landsInPlay: ctx.landsInPlay,
          manaAvailable: 0,
          handSize: 0,
        };
      }

      // Smart Land Drop Sequencing: play tapped land on T1 if no castable 1-drop, otherwise prefer untapped land
      let botTappedPenalty = 0;
      let botTappedLandPendingColors: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> = [];
      const untappedBotLandIdx = ctx.botHand.findIndex((c) => c.isLand && !c.entersTapped);
      const tappedBotLandIdx = ctx.botHand.findIndex((c) => c.isLand && c.entersTapped);
      const hasT1Play = ctx.botHand.some(
        (c) => !c.isLand && c.cmc <= ctx.landsInPlay + ctx.rampBonus + 1
      );
      const anyBotLandIdx =
        r === 1 && !hasT1Play && tappedBotLandIdx !== -1
          ? tappedBotLandIdx
          : untappedBotLandIdx !== -1
          ? untappedBotLandIdx
          : tappedBotLandIdx;

      let botMissedLand = true;
      if (anyBotLandIdx !== -1) {
        const [landCard] = ctx.botHand.splice(anyBotLandIdx, 1);
        ctx.landsInPlay += 1;
        botMissedLand = false;
        if (landCard.entersTapped) {
          botTappedPenalty = 1;
          botTappedLandPendingColors = landCard.producedMana;
        } else {
          for (const col of landCard.producedMana) {
            if (col !== 'C') ctx.colorSources[col] += 1;
          }
          if (landCard.mech.selfLifeLossAmount > 0) {
            selfLifeLoss += landCard.mech.selfLifeLossAmount;
          }
        }
        // Trigger Landfall permanents/engines
        if (
          ctx.battlefield.some((p) => p.isLandfallPayoff) ||
          ctx.engines.some((e) => e.isLandfallPayoff)
        ) {
          ctx.battlefield.push(createTokenPermanent('Landfall Token', 2, 2));
        }
      }
      ctx.missedLandThisRound = botMissedLand;

      const botMana = Math.max(0, ctx.landsInPlay + ctx.rampBonus - botTappedPenalty);
      let botRemainingMana = botMana;

      const myBoardPower = ctx.battlefield.reduce((s, p) => s + p.power, 0);
      const playerTotalPower = playerBattlefield.reduce((s, p) => s + p.power, 0);
      const rivalThreatBoards = [
        {
          name: 'You',
          creatures: youEliminatedBy ? 0 : playerBattlefield.length,
          power: youEliminatedBy ? 0 : playerTotalPower,
          engines: youEliminatedBy ? 0 : playerEngines.length,
          openMana: youEliminatedBy ? 0 : playerOpenMana,
          handSize: youEliminatedBy ? 0 : hand.length,
        },
        ...oppContexts
          .filter((o) => o !== ctx && !o.eliminatedBy)
          .map((o) => ({
            name: o.opp.name,
            creatures: o.battlefield.length,
            power: o.battlefield.reduce((s, p) => s + p.power, 0),
            engines: o.engines.length,
            openMana: o.openMana,
            handSize: o.botHand.length,
          })),
      ];
      const maxOppBoard = [...rivalThreatBoards].sort((a, b) => b.power - a.power)[0];
      const rivalHoldingSweeperMana = rivalThreatBoards.some(
        (rb) => rb.openMana >= 4 && rb.handSize >= 4
      );

      // Evaluate Board Wipe decision using actual color mana & pod board evaluation
      const wipeInHandIdx = ctx.botHand.findIndex((c) => {
        if (c.isLand) return false;
        return (
          c.mech.isBoardWipe &&
          canPayManaCost(botRemainingMana, ctx.colorSources, c.cmc, c.manaCost)
        );
      });
      const trailingBadly =
        maxOppBoard &&
        maxOppBoard.creatures >= 3 &&
        maxOppBoard.power >= 8 &&
        myBoardPower <= maxOppBoard.power * 0.65;

      let boardWipeCast = false;
      const botPlayedThisTurn: string[] = [];
      const creativeNotes: string[] = [];
      let castRemovalCard: SimDeckSlot | null = null;
      let wipeWasCountered = false;

      if (trailingBadly && wipeInHandIdx !== -1) {
        const [wipeCard] = ctx.botHand.splice(wipeInHandIdx, 1);
        botRemainingMana = Math.max(0, botRemainingMana - wipeCard.cmc);
        if (wipeCard.mech.selfLifeLossAmount > 0) {
          selfLifeLoss += wipeCard.mech.selfLifeLossAmount;
        }
        botPlayedThisTurn.push(wipeCard.name);
        ctx.graveyard.push(wipeCard);
        const counteredBy = tryBotCounterSpell(
          wipeCard.name,
          wipeCard.cmc,
          wipeCard.meta,
          false,
          opp.name,
          idx
        );
        if (counteredBy) {
          wipeWasCountered = true;
          creativeNotes.push(`${wipeCard.name} countered by ${counteredBy}`);
        } else {
          boardWipeCast = true;
          ctx.hadWipeThisGame = true;
        }
      } else if (
        trailingBadly &&
        !ctx.hadWipeThisGame &&
        botRemainingMana >= 5 &&
        bias.usesControl &&
        (ctx.customNonLands.length === 0 || bias.wipeCount > 0)
      ) {
        botRemainingMana = Math.max(0, botRemainingMana - 4);
        botPlayedThisTurn.push('Board Sweeper');
        boardWipeCast = true;
        ctx.hadWipeThisGame = true;
      }

      if (boardWipeCast) {
        if (playerBattlefield.length > 0) {
          triggerAristocratsOnDeath('you', null, playerBattlefield.length);
        }
        for (const perm of playerBattlefield) {
          recordCreatureDeparture(perm, playerCmdTaxMap, playerGraveyard);
        }
        playerBattlefield.length = 0;

        for (const o of oppContexts) {
          const wipedCount = o.battlefield.length;
          if (wipedCount > 0) {
            triggerAristocratsOnDeath('bot', o, wipedCount);
            if (o !== ctx) {
              o.grudgeByAttacker.set(
                opp.name,
                (o.grudgeByAttacker.get(opp.name) || 0) + 8 + wipedCount * 3
              );
            }
          }
          for (const perm of o.battlefield) {
            recordCreatureDeparture(perm, o.cmdTaxMap, o.graveyard);
          }
          o.battlefield.length = 0;
        }
      } else {
        // Endgame State Metrics: evaluate opponent vulnerability & remaining threats before reserving mana
        const aliveOppsList: Array<{
          life: number;
          poison: number;
          cmdFromMe: number;
          libRem: number;
          board: SimCreaturePermanent[];
        }> = [];
        const myCmdNameForEndgame =
          ctx.customCommanderCards[0]?.name || bias.defaultCommanderName;
        if (!youEliminatedBy) {
          aliveOppsList.push({
            life: youLife,
            poison: youPoison,
            cmdFromMe: youCmdTaken.get(myCmdNameForEndgame) || 0,
            libRem: youLibraryRemaining,
            board: playerBattlefield,
          });
        }
        for (const o of oppContexts) {
          if (o !== ctx && !o.eliminatedBy) {
            aliveOppsList.push({
              life: o.life,
              poison: o.poison,
              cmdFromMe: o.cmdTaken.get(myCmdNameForEndgame) || 0,
              libRem: o.libraryRemaining,
              board: o.battlefield,
            });
          }
        }
        const minOppLife =
          aliveOppsList.length > 0
            ? Math.min(...aliveOppsList.map((o) => o.life))
            : startingLife;
        const maxOppPoison =
          aliveOppsList.length > 0
            ? Math.max(...aliveOppsList.map((o) => o.poison))
            : 0;
        const maxOppCmd =
          aliveOppsList.length > 0
            ? Math.max(...aliveOppsList.map((o) => o.cmdFromMe))
            : 0;
        const isEndgameState =
          r >= 5 ||
          botMana >= 6 ||
          minOppLife <= startingLife * 0.5 ||
          maxOppPoison >= 6 ||
          maxOppCmd >= 12 ||
          ctx.life <= startingLife * 0.45;

        const readyAttackersNow = ctx.battlefield.filter(
          (p) => !p.tapped && (!p.summoningSick || p.hasHaste) && p.power > 0
        );

        // Lethal-First Mana Override: if spending full mana unlocks a lethal spell/combat swing, don't hold counter mana!
        const hasInstantCounter = ctx.botHand.some(
          (c) =>
            !c.isLand &&
            c.mech.isCounterspell &&
            canPayManaCost(botRemainingMana, ctx.colorSources, c.cmc, c.manaCost)
        );
        const hasInstantProtection = ctx.botHand.some(
          (c) =>
            !c.isLand &&
            c.mech.isProtection &&
            canPayManaCost(botRemainingMana, ctx.colorSources, c.cmc, c.manaCost)
        );

        const canForceLethalWithFullMana =
          isEndgameState &&
          aliveOppsList.some((targetOpp) => {
            const finisherInHand = ctx.botHand.some((c) => {
              if (
                c.isLand ||
                !canPayManaCost(botRemainingMana, ctx.colorSources, c.cmc, c.manaCost)
              ) {
                return false;
              }
              const m = c.mech;
              if (m.isXSpell && botRemainingMana >= 5) {
                const xDmg = Math.max(3, botRemainingMana - 2);
                return xDmg >= targetOpp.life;
              }
              if (m.isBoardPump && readyAttackersNow.length >= 2) {
                const pump = /craterhoof/i.test(c.name)
                  ? Math.max(4, readyAttackersNow.length)
                  : /triumph/i.test(c.name)
                  ? 1
                  : 3;
                const boostedTotal = readyAttackersNow.reduce(
                  (s, a) => s + (a.power + pump) * (a.hasDoubleStrike ? 2 : 1),
                  0
                );
                return /triumph/i.test(c.name)
                  ? boostedTotal + targetOpp.poison >= 10
                  : boostedTotal >= targetOpp.life;
              }
              if (m.burnOrDrainAmount > 0 && m.burnOrDrainAmount >= targetOpp.life) {
                return true;
              }
              if (m.isCounterOrRemoval && !m.isCounterspell) {
                const ev = evaluateEndgameAttackLine({
                  attackers: readyAttackersNow,
                  defenderBoard: targetOpp.board,
                  defenderLife: targetOpp.life,
                  defenderPoison: targetOpp.poison,
                  defenderCmdTaken: targetOpp.cmdFromMe,
                  defenderLibRemaining: targetOpp.libRem,
                  usesCommanderDamage21: formatRules.usesCommanderDamage21,
                  removeBestBlocker: true,
                });
                return ev.isLethal;
              }
              return false;
            });
            return finisherInHand;
          });

        const learnedThreatStillLive =
          Boolean(ggufThreatLower) &&
          (playerBattlefield.some((p) => p.name.toLowerCase().includes(ggufThreatLower)) ||
            playerEngines.some((e) => e.name.toLowerCase().includes(ggufThreatLower)) ||
            !playerGraveyard.some((g) => g.name.toLowerCase().includes(ggufThreatLower)));

        const holdCounterMana =
          !canForceLethalWithFullMana &&
          r < 24 &&
          hasInstantCounter &&
          (ggufDirective?.manaPlan === 'hold-interaction' ||
            (ggufDirective?.manaPlan !== 'tap-out-pressure' &&
              (bias.usesControl ||
                iq >= 98 ||
                blueprint.counterspellCount >= 3 ||
                learnedThreatStillLive))) &&
          r >= 2 &&
          !trailingBadly
            ? 2
            : 0;
        const holdProtMana =
          !canForceLethalWithFullMana &&
          r < 24 &&
          hasInstantProtection &&
          ctx.battlefield.some((p) => p.isCommander) &&
          botRemainingMana >= 3
            ? 1
            : 0;

        const spendableManaBudget = () =>
          Math.max(0, botRemainingMana - holdCounterMana - holdProtMana);

        // Step A: Ramp first on early turns OR if mana-screwed (skip pure ramp in late endgame when finishers are ready)
        if ((r <= 3 || ctx.landsInPlay <= 3) && !canForceLethalWithFullMana) {
          const rampIdx = ctx.botHand.findIndex(
            (c) =>
              !c.isLand &&
              c.isRamp &&
              canPayManaCost(botRemainingMana, ctx.colorSources, c.cmc, c.manaCost)
          );
          if (rampIdx !== -1) {
            const [rampCard] = ctx.botHand.splice(rampIdx, 1);
            botRemainingMana = Math.max(0, botRemainingMana - rampCard.cmc);
            ctx.rampBonus += 1;
            for (const col of rampCard.producedMana) {
              if (col !== 'C') ctx.colorSources[col] += 1;
            }
            botPlayedThisTurn.push(rampCard.name);
            const rMech = rampCard.mech;
            if (rMech.estimatedPower > 0) {
              ctx.battlefield.push(
                buildPermanentFromCard(rampCard.name, rampCard.meta, false, '', 1, false, rMech)
              );
            } else {
              ctx.graveyard.push(rampCard);
            }
          }
        }

        // Step B: Cast Commander ONLY in formats with a Command Zone
        const activeCmdList = formatRules.allowsCommandZone
          ? ctx.customCommanderCards.length > 0
            ? ctx.customCommanderCards.map((c) => ({
                name: c.name,
                meta: c.card,
                cmc: c.card?.cmc ?? 4,
              }))
            : bias.commanderNames.map((name) => ({
                name,
                meta: findMetaFromMap(metaByName, name) || null,
                cmc: findMetaFromMap(metaByName, name)?.cmc ?? 4,
              }))
          : [];

        const castableCmd = activeCmdList.find((cmd) => {
          const onBoard = ctx.battlefield.some(
            (p) => p.isCommander && p.commanderName === cmd.name
          );
          const cost = cmd.cmc + (ctx.cmdTaxMap.get(cmd.name) || 0);
          return (
            !onBoard &&
            canPayManaCost(
              spendableManaBudget(),
              ctx.colorSources,
              cost,
              cmd.meta?.manaCost
            )
          );
        });

        if (castableCmd && !canForceLethalWithFullMana) {
          const cost = castableCmd.cmc + (ctx.cmdTaxMap.get(castableCmd.name) || 0);
          botRemainingMana = Math.max(0, botRemainingMana - cost);
          botPlayedThisTurn.push(castableCmd.name);
          const counteredBy = tryBotCounterSpell(
            castableCmd.name,
            cost,
            castableCmd.meta,
            true,
            opp.name,
            idx
          );
          if (counteredBy) {
            ctx.cmdTaxMap.set(
              castableCmd.name,
              (ctx.cmdTaxMap.get(castableCmd.name) || 0) + 2
            );
            creativeNotes.push(`${castableCmd.name} countered by ${counteredBy}`);
          } else {
            const cmdPerm = buildPermanentFromCard(
              castableCmd.name,
              castableCmd.meta,
              true,
              castableCmd.name,
              bias.usesVoltronCommander ? 4 : 3
            );
            if (
              cmdPerm.power > 0 ||
              /\bcreature\b/i.test(castableCmd.meta?.typeLine || '') ||
              !castableCmd.meta
            ) {
              ctx.battlefield.push(cmdPerm);
            }
            if (cmdPerm.burnOrDrainAmount > 0) {
              if (cmdPerm.hitsEachOpponent) spellEachOppLife -= cmdPerm.burnOrDrainAmount;
              else spellBurn += cmdPerm.burnOrDrainAmount;
            }
            if (cmdPerm.millAmount > 0) {
              if (cmdPerm.hitsEachOpponent) spellEachOppMill += cmdPerm.millAmount;
              else spellMill += cmdPerm.millAmount;
            }
            if (cmdPerm.hasProliferate && poisonExistsOnTable(oppContexts, youPoison)) {
              spellEachOppPoison += 1;
            }
          }
        }

        // Step C: Optimal Mana-Utilization & Endgame Sequencing (up to 4 spells, choosing best 1- or 2-spell curve combinations!)
        const aheadOnBoard =
          maxOppBoard && myBoardPower >= Math.max(7, maxOppBoard.power * 1.25);

        const scoreCardForEndgame = (c: SimDeckSlot): number => {
          const m = c.mech;
          const isCreatureSpell =
            m.estimatedPower > 0 || /\bcreature\b/i.test(c.meta?.typeLine || '');
          if (
            aheadOnBoard &&
            rivalHoldingSweeperMana &&
            isCreatureSpell &&
            !m.hasHaste &&
            ctx.battlefield.length >= 3 &&
            !isEndgameState
          ) {
            return -999;
          }

          let score = Math.min(8, c.cmc * 1.6);
          if (c.isRamp) {
            if (r <= 4 && !isEndgameState) score += 7;
            else if (botMana >= 7) score -= 5;
          }
          if (m.isReanimator && ctx.graveyard.length > 0) {
            const topGy = Math.max(...ctx.graveyard.map((g) => g.cmc));
            score += 10 + topGy;
          }
          if (m.isBoardPump) {
            const curAttackers = ctx.battlefield.filter(
              (p) => !p.tapped && (!p.summoningSick || p.hasHaste)
            ).length;
            if (curAttackers >= 3) score += 18;
            else if (curAttackers === 2) score += 13;
            else if (curAttackers === 0) score -= 8;
          }
          if (m.isXSpell) {
            const budgetNow = spendableManaBudget();
            if (budgetNow >= 6) score += 16 + Math.min(10, budgetNow - 4);
            else if (minOppLife <= Math.max(3, budgetNow - 1)) score += 20;
            else score -= 8; // Hold X-spell until higher mana
          }
          if (m.burnOrDrainAmount > 0) {
            const mult = m.hitsEachOpponent ? Math.max(1, aliveOppsList.length) : 1;
            score += m.burnOrDrainAmount * mult * (isEndgameState ? 1.8 : 1.1);
            if (m.burnOrDrainAmount >= minOppLife) score += 18;
          }
          if (m.isTutor) {
            score += trailingBadly || maxOppBoard.engines > 0 ? 11 : 8;
          }
          if (
            m.isEnginePermanent ||
            m.isAristocratsPayoff ||
            m.isSacOutlet ||
            m.isLandfallPayoff ||
            m.isSpellslingerPayoff ||
            m.isTokenMaker
          ) {
            score += isEndgameState ? 6 : 9;
          }
          if (m.extraDrawCount > 0 && ctx.botHand.length <= 3) {
            score += 6 + m.extraDrawCount * 2;
          }
          if (
            m.isCounterOrRemoval &&
            !m.isCounterspell &&
            (maxOppBoard.power >= 5 ||
              maxOppBoard.engines > 0 ||
              minOppLife <= 18 ||
              (ggufThreatLower &&
                (playerBattlefield.some((p) => p.name.toLowerCase().includes(ggufThreatLower)) ||
                  playerEngines.some((e) => e.name.toLowerCase().includes(ggufThreatLower)))))
          ) {
            score += isEndgameState ? 12 : 9;
            if (ggufThreatLower) score += 6;
          }
          if (isCreatureSpell && isEndgameState && (m.hasHaste || m.hasFlying || m.isUnblockable || m.hasTrample)) {
            score += 6;
          }
          if (blueprint.keyPayoffs.includes(c.name)) score += 5;
          if (m.isVoltronBuff && ctx.battlefield.some((p) => p.isCommander)) {
            score += isEndgameState ? 9 : 6;
            if (ggufDirective?.winVectorFocus === 'commander') score += 7;
          }
          if (
            ggufDirective?.winVectorFocus === 'poison' &&
            (m.hasInfect || m.toxicValue > 0 || m.hasProliferate)
          ) {
            score += 8;
          } else if (ggufDirective?.winVectorFocus === 'mill' && m.millAmount > 0) {
            score += 8;
          } else if (
            ggufDirective?.winVectorFocus === 'life' &&
            (m.burnOrDrainAmount > 0 || m.isBoardPump || m.hasHaste || m.isUnblockable)
          ) {
            score += 5;
          }
          if (ggufDirective?.posture === 'defensive' && m.isBoardWipe && trailingBadly) {
            score += 6;
          }
          return score;
        };

        // Pre-plan best 1- or 2-spell combination on Pass 0 to maximize mana curve efficiency in mid/late game!
        const plannedSpellNames: SimDeckSlot[] = [];
        const initialBudget = spendableManaBudget();
        if (initialBudget > 0) {
          const singleCastables = ctx.botHand
            .map((c, handIdx) => ({ c, handIdx, score: scoreCardForEndgame(c) }))
            .filter(
              (x) =>
                !x.c.isLand &&
                !x.c.mech.isCounterspell &&
                !(x.c.mech.isProtection && !/\bequipment\b/i.test(x.c.meta?.typeLine || '')) &&
                x.score > -100 &&
                canPayManaCost(initialBudget, ctx.colorSources, x.c.cmc, x.c.manaCost)
            );

          let bestComboScore = -Infinity;
          let bestCombo: SimDeckSlot[] = [];

          for (const s of singleCastables) {
            const spent = s.c.mech.isXSpell ? initialBudget : s.c.cmc;
            const utilBonus =
              (spent / Math.max(1, initialBudget)) * (isEndgameState ? 9 : 6) +
              (spent === initialBudget ? 3 : 0);
            const total = s.score + utilBonus;
            if (total > bestComboScore) {
              bestComboScore = total;
              bestCombo = [s.c];
            }
          }

          // Evaluate 2-card combos to fill late-game mana instead of leaving unspent mana stranded
          const topPool = [...singleCastables].sort((a, b) => b.score - a.score).slice(0, 8);
          for (let i = 0; i < topPool.length; i++) {
            const a = topPool[i];
            if (a.c.mech.isXSpell) continue;
            for (let j = i + 1; j < topPool.length; j++) {
              const b = topPool[j];
              const remAfterA = initialBudget - a.c.cmc;
              if (remAfterA <= 0) continue;
              if (!canPayManaCost(remAfterA, ctx.colorSources, b.c.cmc, b.c.manaCost)) continue;
              const combinedSpent = b.c.mech.isXSpell ? initialBudget : a.c.cmc + b.c.cmc;
              if (combinedSpent > initialBudget) continue;
              const utilBonus =
                (combinedSpent / Math.max(1, initialBudget)) * (isEndgameState ? 10 : 7) +
                (combinedSpent === initialBudget ? 3.5 : 0);
              const synergyPairBonus =
                (a.c.mech.isBoardPump && (b.c.mech.hasHaste || b.c.mech.isTokenMaker)) ||
                (b.c.mech.isBoardPump && (a.c.mech.hasHaste || a.c.mech.isTokenMaker))
                  ? 7
                  : (a.c.mech.isCounterOrRemoval || b.c.mech.isCounterOrRemoval) && isEndgameState
                  ? 4
                  : 0;
              const comboTotal = a.score + b.score + utilBonus + synergyPairBonus;
              if (comboTotal > bestComboScore) {
                bestComboScore = comboTotal;
                bestCombo = [a.c, b.c];
              }
            }
          }

          // Sequence optimal pair: Ramp/Haste/Tokens/Removal BEFORE BoardPump; X-Spells LAST
          if (bestCombo.length === 2) {
            const [first, second] = bestCombo;
            const seqRank = (slot: SimDeckSlot): number => {
              if (slot.isRamp) return 0;
              if (slot.mech.hasHaste || slot.mech.isTokenMaker) return 1;
              if (slot.mech.isCounterOrRemoval) return 2;
              if (slot.mech.isBoardPump) return 4;
              if (slot.mech.isXSpell) return 5;
              return 3;
            };
            if (seqRank(second) < seqRank(first)) {
              plannedSpellNames.push(second, first);
            } else {
              plannedSpellNames.push(first, second);
            }
          } else if (bestCombo.length === 1) {
            plannedSpellNames.push(bestCombo[0]);
          }
        }

        for (let castPass = 0; castPass < 4; castPass++) {
          const budget = spendableManaBudget();
          if (budget <= 0) break;

          let chosenHandIdx = -1;
          while (plannedSpellNames.length > 0 && chosenHandIdx === -1) {
            const nextPlanned = plannedSpellNames.shift()!;
            const foundIdx = ctx.botHand.indexOf(nextPlanned);
            if (
              foundIdx !== -1 &&
              canPayManaCost(budget, ctx.colorSources, nextPlanned.cmc, nextPlanned.manaCost)
            ) {
              chosenHandIdx = foundIdx;
            }
          }

          if (chosenHandIdx === -1) {
            const scoredCandidates = ctx.botHand
              .map((c, handIdx) => {
                if (c.isLand) return null;
                const m = c.mech;
                if (m.isCounterspell || (m.isProtection && !/\bequipment\b/i.test(c.meta?.typeLine || ''))) {
                  return null;
                }
                if (!canPayManaCost(budget, ctx.colorSources, c.cmc, c.manaCost)) {
                  return null;
                }
                const sc = scoreCardForEndgame(c);
                if (sc <= -100) return null;
                const util = ((m.isXSpell ? budget : c.cmc) / Math.max(1, budget)) * 6;
                return { c, handIdx, m, priority: sc + util };
              })
              .filter((x): x is NonNullable<typeof x> => x !== null)
              .sort((a, b) => b.priority - a.priority);

            if (!scoredCandidates[0]) break;
            chosenHandIdx = scoredCandidates[0].handIdx;
          }

          const [spell] = ctx.botHand.splice(chosenHandIdx, 1);
          const sMech = spell.mech;
          const xValue = sMech.isXSpell ? Math.max(2, budget - 2) : 0;
          botRemainingMana = sMech.isXSpell
            ? Math.max(0, botRemainingMana - budget)
            : Math.max(0, botRemainingMana - spell.cmc);
          botPlayedThisTurn.push(spell.name);

          // Rival bot can counter a big play!
          const counteredBy =
            !wipeWasCountered && spell.cmc >= 3
              ? tryBotCounterSpell(spell.name, spell.cmc, spell.meta, false, opp.name, idx)
              : null;
          if (counteredBy) {
            ctx.graveyard.push(spell);
            creativeNotes.push(`${spell.name} countered by ${counteredBy}`);
            continue;
          }

          if (sMech.selfLifeLossAmount > 0) {
            selfLifeLoss += sMech.selfLifeLossAmount;
          }

          // Trigger bot's own Spellslinger engines if casting an Instant/Sorcery
          const isInstantOrSorcery = /\b(instant|sorcery)\b/i.test(
            spell.meta?.typeLine || ''
          );
          if (isInstantOrSorcery) {
            const slingerCount =
              ctx.battlefield.filter((p) => p.isSpellslingerPayoff).length +
              ctx.engines.filter((e) => e.isSpellslingerPayoff).length;
            if (slingerCount > 0) {
              spellEachOppLife -= slingerCount;
              ctx.battlefield.push(createTokenPermanent('Spellslinger Token', 1, 1));
            }
          }

          if (spell.isRamp) {
            ctx.rampBonus += 1;
            for (const col of spell.producedMana) {
              if (col !== 'C') ctx.colorSources[col] += 1;
            }
          }

          // Dynamic Tutor: search botLibrary for highest situational silver bullet!
          if (sMech.isTutor && ctx.botLibrary.length > 0) {
            const scoredTutorTargets = ctx.botLibrary
              .map((libCard, libIdx) => {
                const lm = libCard.mech;
                let tScore = 0;
                if (trailingBadly && lm.isBoardWipe) tScore += 25;
                if ((maxOppBoard.engines > 0 || maxOppBoard.power >= 6) && lm.isCounterOrRemoval) {
                  tScore += 18;
                }
                if (ggufThreatLower && lm.isCounterOrRemoval) tScore += 7;
                if (ggufDirective?.winVectorFocus === 'poison' && (lm.hasInfect || lm.toxicValue > 0 || lm.hasProliferate)) {
                  tScore += 10;
                } else if (ggufDirective?.winVectorFocus === 'mill' && lm.millAmount > 0) {
                  tScore += 10;
                } else if (ggufDirective?.winVectorFocus === 'commander' && lm.isVoltronBuff) {
                  tScore += 10;
                }
                if (ctx.landsInPlay <= 3 && libCard.isRamp) tScore += 15;
                if (ctx.graveyard.length > 0 && lm.isReanimator) tScore += 16;
                if (blueprint.keyPayoffs.includes(libCard.name)) tScore += 14;
                if (lm.isEnginePermanent || lm.isProtection) tScore += 10;
                if (!libCard.isLand) tScore += Math.min(6, libCard.cmc);
                return { libCard, libIdx, tScore };
              })
              .sort((a, b) => b.tScore - a.tScore);

            if (scoredTutorTargets[0]) {
              const [tutored] = ctx.botLibrary.splice(scoredTutorTargets[0].libIdx, 1);
              ctx.botHand.push(tutored);
              ctx.libraryRemaining = Math.max(0, ctx.libraryRemaining - 1);
              creativeNotes.push(`tutored ${tutored.name} via ${spell.name}`);
            }
          }

          // Graveyard Reanimation: pull strongest creature from graveyard onto battlefield!
          if (sMech.isReanimator && ctx.graveyard.length > 0) {
            const creatureGyIdx = ctx.graveyard
              .map((g, gi) => {
                const gm = g.mech;
                const isCreat =
                  gm.estimatedPower > 0 || /\bcreature\b/i.test(g.meta?.typeLine || '');
                return {
                  gi,
                  score: isCreat ? gm.estimatedPower * 2 + g.cmc : -1,
                };
              })
              .filter((x) => x.score > 0)
              .sort((a, b) => b.score - a.score)[0]?.gi;

            if (creatureGyIdx !== undefined) {
              const [reanimated] = ctx.graveyard.splice(creatureGyIdx, 1);
              const reanimPerm = buildPermanentFromCard(
                reanimated.name,
                reanimated.meta,
                false,
                '',
                4,
                false,
                reanimated.mech
              );
              ctx.battlefield.push(reanimPerm);
              creativeNotes.push(`reanimated ${reanimated.name}`);
            }
          }

          if (sMech.extraDrawCount > 0) {
            for (let d = 0; d < sMech.extraDrawCount; d++) {
              const drawnExtra = ctx.botLibrary.shift();
              if (drawnExtra) {
                ctx.botHand.push(drawnExtra);
                ctx.libraryRemaining = Math.max(0, ctx.libraryRemaining - 1);
              }
            }
          }
          if (sMech.isXSpell) {
            const liveBotOppsCount =
              (youEliminatedBy ? 0 : 1) +
              oppContexts.filter((o) => o !== ctx && !o.eliminatedBy).length;
            const scaledDmg = Math.max(3, xValue);
            if (sMech.hitsEachOpponent || /exsanguinate|torment|crackle/i.test(spell.name)) {
              spellEachOppLife -= scaledDmg;
              if (/exsanguinate/i.test(spell.name)) {
                selfLifeGain += scaledDmg * Math.max(1, liveBotOppsCount);
              }
            } else {
              spellBurn += scaledDmg;
            }
          } else {
            if (sMech.lifegainAmount > 0) selfLifeGain += sMech.lifegainAmount;
            if (sMech.burnOrDrainAmount > 0) {
              if (sMech.hitsEachOpponent) {
                spellEachOppLife -= sMech.burnOrDrainAmount;
              } else {
                spellBurn += sMech.burnOrDrainAmount;
              }
            }
          }
          if (sMech.millAmount > 0) {
            if (sMech.hitsEachOpponent) {
              spellEachOppMill += sMech.millAmount;
            } else {
              spellMill += sMech.millAmount;
            }
          }
          if (sMech.isBoardPump && ctx.battlefield.length > 0) {
            const isTriumph = /triumph of the hordes/i.test(spell.name);
            const isCraterhoof = /craterhoof/i.test(spell.name);
            const pumpDelta = isTriumph
              ? 1
              : isCraterhoof
              ? Math.max(4, ctx.battlefield.length)
              : 3;
            for (const p of ctx.battlefield) {
              p.power += pumpDelta;
              p.toughness += pumpDelta;
              const addedTrample = !p.hasTrample;
              const addedInfect = isTriumph && !p.hasInfect;
              p.hasTrample = true;
              if (isTriumph) p.hasInfect = true;
              tempBotCombatBuffs.push({
                perm: p,
                dPow: pumpDelta,
                dTou: pumpDelta,
                addedTrample,
                addedInfect,
              });
            }
            creativeNotes.push(`team pump +${pumpDelta}/+${pumpDelta}`);
          } else if (sMech.isVoltronBuff && ctx.battlefield.length > 0) {
            const cmdTarget =
              ctx.battlefield.find((p) => p.isCommander) || ctx.battlefield[0];
            cmdTarget.power += 2;
            cmdTarget.toughness += 2;
            if (/double strike/i.test(spell.meta?.oracleText || spell.name)) {
              cmdTarget.hasDoubleStrike = true;
            }
          }
          if (sMech.isCounterOrRemoval && !sMech.isCounterspell) {
            castRemovalCard = spell;
          }

          if (
            sMech.estimatedPower > 0 ||
            /\bcreature\b/i.test(spell.meta?.typeLine || '')
          ) {
            ctx.battlefield.push(
              buildPermanentFromCard(spell.name, spell.meta, false, '', 2, false, sMech)
            );
            if (sMech.tokenCount > 0) {
              for (let ti = 0; ti < sMech.tokenCount; ti++) {
                ctx.battlefield.push(
                  createTokenPermanent(`${spell.name} Token`, sMech.tokenPower || 1, sMech.tokenPower || 1)
                );
              }
            }
          } else if (
            sMech.isEnginePermanent ||
            sMech.isTokenMaker ||
            sMech.isAristocratsPayoff ||
            sMech.isSacOutlet ||
            sMech.isLandfallPayoff ||
            sMech.isSpellslingerPayoff ||
            (/\b(artifact|enchantment|planeswalker)\b/i.test(spell.meta?.typeLine || '') &&
              !spell.isRamp)
          ) {
            ctx.engines.push({
              name: spell.name,
              cmc: spell.cmc,
              isTokenMaker: sMech.isTokenMaker,
              tokenCount: sMech.tokenCount || 1,
              tokenPower: sMech.tokenPower || 1,
              isAristocratsPayoff: sMech.isAristocratsPayoff,
              isSacOutlet: sMech.isSacOutlet,
              isLandfallPayoff: sMech.isLandfallPayoff,
              isSpellslingerPayoff: sMech.isSpellslingerPayoff,
              isProtection: sMech.isProtection,
              extraDrawCount: sMech.extraDrawCount,
              burnOrDrainAmount: sMech.burnOrDrainAmount,
              selfLifeLossAmount: sMech.selfLifeLossAmount,
              hitsEachOpponent: sMech.hitsEachOpponent,
              isRamp: spell.isRamp,
            });
            if (sMech.tokenCount > 0) {
              for (let ti = 0; ti < sMech.tokenCount; ti++) {
                ctx.battlefield.push(
                  createTokenPermanent(`${spell.name} Token`, sMech.tokenPower || 1, sMech.tokenPower || 1)
                );
              }
            }
          } else {
            ctx.graveyard.push(spell);
            if (sMech.tokenCount > 0) {
              for (let ti = 0; ti < sMech.tokenCount; ti++) {
                ctx.battlefield.push(
                  createTokenPermanent(`${spell.name} Token`, sMech.tokenPower || 1, sMech.tokenPower || 1)
                );
              }
            }
            if (sMech.hasInfect || sMech.toxicValue > 0) {
              spellPoison += Math.max(1, sMech.toxicValue || 1);
            }
          }
          if (sMech.hasProliferate && poisonExistsOnTable(oppContexts, youPoison)) {
            spellEachOppPoison += 1;
          }
        }
      }

      // Bot SacOutlet + Aristocrats token sacrifice loop (sac up to 2 expendable tokens)
      const botHasSacOutlet =
        ctx.battlefield.some((p) => p.isSacOutlet) || ctx.engines.some((e) => e.isSacOutlet);
      const botHasAristocrats =
        ctx.battlefield.some((p) => p.isAristocratsPayoff) ||
        ctx.engines.some((e) => e.isAristocratsPayoff);
      if (botHasSacOutlet && botHasAristocrats) {
        let sacsDone = 0;
        for (let si = ctx.battlefield.length - 1; si >= 0 && sacsDone < 2; si--) {
          const fodder = ctx.battlefield[si];
          if (fodder.isToken && !fodder.isAristocratsPayoff && !fodder.isSacOutlet) {
            ctx.battlefield.splice(si, 1);
            sacsDone += 1;
          }
        }
        if (sacsDone > 0) {
          triggerAristocratsOnDeath('bot', ctx, sacsDone);
          creativeNotes.push(`sacrificed ${sacsDone} token${sacsDone > 1 ? 's' : ''} to Aristocrats engine`);
        }
      }

      // Register tapped land color sources after casting completes so tapped lands don't fund same-turn pips
      for (const col of botTappedLandPendingColors) {
        if (col !== 'C') ctx.colorSources[col] += 1;
      }

      // Record remaining mana so bot can hold up interaction on opponents' turns!
      ctx.openMana = botRemainingMana;
      if (ctx.openMana >= 2 && ctx.botHand.some((c) => c.mech.isCounterspell)) {
        creativeNotes.push(`held ${ctx.openMana} open mana for interaction`);
      }

      const playedBotCard = botPlayedThisTurn[0] || 'Land / Hold Interaction';

      // Build ALL active opposing targets in the pod (You + alive rival bots) with rich threat metrics
      interface PodTargetCandidate {
        kind: 'you' | 'bot';
        name: string;
        life: number;
        poison: number;
        cmdFromMe: number;
        libraryRemaining: number;
        creatures: number;
        untappedBlockers: number;
        boardPower: number;
        engineCount: number;
        handSize: number;
        rampAdvantage: number;
        openMana: number;
        commanderActive: boolean;
        recentThreatDmg: number;
        botRef?: typeof ctx;
      }

      const primaryBotCmdName =
        ctx.customCommanderCards[0]?.name || bias.defaultCommanderName;

      const candidates: PodTargetCandidate[] = [];
      if (!youEliminatedBy) {
        candidates.push({
          kind: 'you',
          name: 'You',
          life: youLife,
          poison: youPoison,
          cmdFromMe: youCmdTaken.get(primaryBotCmdName) || 0,
          libraryRemaining: youLibraryRemaining,
          creatures: playerBattlefield.length,
          untappedBlockers: playerBattlefield.filter((p) => !p.tapped).length,
          boardPower: playerBattlefield.reduce((s, p) => s + p.power, 0),
          engineCount: playerEngines.length,
          handSize: hand.length,
          rampAdvantage: landsInPlay + rampBonus,
          openMana: playerOpenMana,
          commanderActive: playerBattlefield.some((p) => p.isCommander),
          recentThreatDmg: youDamageDealtLastTurn,
        });
      }
      for (const other of oppContexts) {
        if (other === ctx || other.eliminatedBy) continue;
        candidates.push({
          kind: 'bot',
          name: other.opp.name,
          life: other.life,
          poison: other.poison,
          cmdFromMe: other.cmdTaken.get(primaryBotCmdName) || 0,
          libraryRemaining: other.libraryRemaining,
          creatures: other.battlefield.length,
          untappedBlockers: other.battlefield.filter((p) => !p.tapped).length,
          boardPower: other.battlefield.reduce((s, p) => s + p.power, 0),
          engineCount: other.engines.length,
          handSize: other.botHand.length,
          rampAdvantage: other.landsInPlay + other.rampBonus,
          openMana: other.openMana,
          commanderActive: other.battlefield.some((p) => p.isCommander),
          recentThreatDmg: other.recentDamageDealt,
          botRef: other,
        });
      }

      // Ready attackers + Blocker-Aware Endgame Lethal & Crackback Defense Evaluation
      const readyBotAttackersAll = ctx.battlefield.filter(
        (p) => !p.tapped && (!p.summoningSick || p.hasHaste) && p.power > 0
      );

      const getCandBoard = (cand: PodTargetCandidate): SimCreaturePermanent[] =>
        cand.kind === 'you' ? playerBattlefield : cand.botRef?.battlefield || [];

      const evalAllInByCand = new Map<PodTargetCandidate, EndgameAttackEvaluation>();
      for (const cand of candidates) {
        evalAllInByCand.set(
          cand,
          evaluateEndgameAttackLine({
            attackers: readyBotAttackersAll,
            defenderBoard: getCandBoard(cand),
            defenderLife: cand.life,
            defenderPoison: cand.poison,
            defenderCmdTaken: cand.cmdFromMe,
            defenderLibRemaining: cand.libraryRemaining,
            usesCommanderDamage21: formatRules.usesCommanderDamage21,
            directLifeLoss: spellBurn - spellEachOppLife,
            directPoison: spellPoison + spellEachOppPoison,
            directMill: spellMill + spellEachOppMill,
            removeBestBlocker: Boolean(!boardWipeCast && castRemovalCard),
          })
        );
      }

      const anyTrueLethalCand = candidates.find((c) => evalAllInByCand.get(c)?.isLethal);
      const maxOppBoardPowerNow = maxOppBoard?.power ?? 0;
      const postureDefenseRatio =
        ggufDirective?.posture === 'aggressive'
          ? 0.88
          : ggufDirective?.posture === 'defensive'
          ? 0.54
          : 0.72;
      const crackbackDangerous =
        r < 12 &&
        (maxOppBoardPowerNow >= Math.max(4, Math.floor(ctx.life * postureDefenseRatio)) ||
          (ctx.life <= startingLife * (briefing.lossCount > 0 ? 0.58 : 0.45) &&
            maxOppBoardPowerNow >= 4));
      const allInWinsOrEliminatesTopThreat =
        anyTrueLethalCand !== undefined &&
        (candidates.length === 1 || anyTrueLethalCand.boardPower >= maxOppBoardPowerNow * 0.8);

      const nonVigilantReady = readyBotAttackersAll.filter((a) => !a.hasVigilance);
      const shouldHoldBlocker =
        crackbackDangerous && !allInWinsOrEliminatesTopThreat && nonVigilantReady.length >= 2;

      let candidateAttackers: SimCreaturePermanent[];
      if (boardWipeCast) {
        candidateAttackers = [];
      } else if (shouldHoldBlocker) {
        // Keep vigilance, evasion, and high-impact attackers swinging; hold just enough non-evasive/low-power blockers to survive crackback
        const vigilantOrEvasive = readyBotAttackersAll.filter(
          (a) => a.hasVigilance || a.hasEvasion || a.isUnblockable || a.hasFlying
        );
        const groundPool = nonVigilantReady
          .filter((a) => !a.hasEvasion && !a.isUnblockable && !a.hasFlying)
          .sort((a, b) => b.power - a.power);
        const holdCount = maxOppBoardPowerNow >= ctx.life && groundPool.length >= 2 ? 2 : 1;
        const keptGround =
          groundPool.length > holdCount
            ? groundPool.slice(0, groundPool.length - holdCount)
            : vigilantOrEvasive.length > 0
            ? []
            : groundPool.slice(0, Math.max(0, groundPool.length - 1));
        candidateAttackers = [...vigilantOrEvasive, ...keptGround];
        if (candidateAttackers.length === 0 && readyBotAttackersAll.length >= 2) {
          candidateAttackers = [...readyBotAttackersAll]
            .sort((a, b) => b.power - a.power)
            .slice(0, readyBotAttackersAll.length - 1);
        }
      } else {
        candidateAttackers = readyBotAttackersAll;
      }

      let chosenTarget: PodTargetCandidate | null = null;
      let chosenEndgameEval: EndgameAttackEvaluation | null = null;

      if (candidates.length > 0) {
        // Evaluate table-leader standing symmetrically across You + all living rival bots
        const candLeadScores = candidates.map(
          (c) =>
            c.boardPower * 1.5 +
            c.engineCount * 4 +
            c.rampAdvantage * 0.9 +
            c.life * 0.2 +
            (c.commanderActive ? 5 : 0)
        );
        const maxCandLeadScore = Math.max(...candLeadScores, 1);

        const scored = candidates.map((cand, cIdx) => {
          const postEval = evaluateEndgameAttackLine({
            attackers: candidateAttackers,
            defenderBoard: getCandBoard(cand),
            defenderLife: cand.life,
            defenderPoison: cand.poison,
            defenderCmdTaken: cand.cmdFromMe,
            defenderLibRemaining: cand.libraryRemaining,
            usesCommanderDamage21: formatRules.usesCommanderDamage21,
            directLifeLoss: spellBurn - spellEachOppLife,
            directPoison: spellPoison + spellEachOppPoison,
            directMill: spellMill + spellEachOppMill,
            removeBestBlocker: Boolean(!boardWipeCast && castRemovalCard),
          });
          const allInEval = evalAllInByCand.get(cand);
          const lethalBonus = postEval.isLethal
            ? 180
            : allInEval?.isLethal
            ? 145
            : postEval.lethalGap <= 5
            ? 32
            : 0;

          const threatScore =
            cand.boardPower * 1.45 +
            cand.creatures * 1.2 +
            cand.engineCount * 3.5 +
            (cand.handSize >= 6 ? 2.5 : 0) +
            Math.max(0, cand.rampAdvantage - (ctx.landsInPlay + ctx.rampBonus)) * 1.1 +
            (cand.commanderActive ? 5 : 0) +
            cand.recentThreatDmg * 0.45;

          const evasionPressureScore =
            postEval.totalLifeDamage * 1.15 + postEval.totalPoisonDamage * 3.2;

          const vulnerabilityScore =
            (cand.untappedBlockers === 0 ? 6.5 : -Math.min(5.5, cand.untappedBlockers * 1.25)) +
            (cand.life <= startingLife * 0.45 ? 5 : 0);

          const grudgeScore = (ctx.grudgeByAttacker.get(cand.name) || 0) * 0.85;
          const learnedRivalScore =
            cand.kind === 'bot'
              ? (briefing.rivalThreatByName[cand.name.trim().toLowerCase()] || 0) * 0.65
              : 0;

          const clockMomentum =
            cand.poison * 2.2 +
            (formatRules.usesCommanderDamage21 ? cand.cmdFromMe * 0.75 : 0) +
            (cand.libraryRemaining <= 15 ? 8 : 0);

          // Multiplayer pod politics: untouched table-leader bounty & anti-dogpile spread
          const isTableLeader =
            candLeadScores[cIdx] >= maxCandLeadScore - 1.5 && maxCandLeadScore >= 12;
          const timesTargetedThisRound = targetedCountThisRound.get(cand.name) || 0;
          const leaderBounty =
            candidates.length >= 2 && isTableLeader && timesTargetedThisRound === 0
              ? meta.id === 'ruthless'
                ? 9
                : 6.5
              : 0;
          const antiDogpilePenalty =
            candidates.length >= 2 &&
            lethalBonus < 100 &&
            meta.id !== 'vindictive' &&
            timesTargetedThisRound > 0
              ? timesTargetedThisRound * 8.0
              : 0;

          // Calibrated indignance & symmetric anti-tunneling (Measured & Ruthless have 0 blind player bias!)
          let indignanceBias = 0;
          if (cand.kind === 'you') {
            if (meta.id === 'vindictive') indignanceBias = 11;
            else if (meta.id === 'ruthless') indignanceBias = 0;
            else if (meta.id === 'measured') indignanceBias = 0;
            else indignanceBias = -4;
          }
          if (ctx.lastTargetName === cand.name && lethalBonus < 100 && candidates.length >= 2) {
            const streak = Math.max(1, ctx.consecutiveTargetTurns || 1);
            if (meta.id === 'forgiving') {
              indignanceBias -= 10 * streak;
            } else if (meta.id === 'measured' && !isTableLeader) {
              indignanceBias -= 5.5 * streak;
            } else if (meta.id === 'ruthless' && !isTableLeader) {
              indignanceBias -= 3.0 * streak;
            }
          }
          if (
            meta.id === 'forgiving' &&
            cand.life <= startingLife * 0.5 &&
            cand.boardPower <= 3 &&
            lethalBonus < 100
          ) {
            indignanceBias -= 5;
          }

          // Symmetric stumble exploitation (applies to ANY stumbling seat, You or rival bot!)
          const candStumbled =
            cand.kind === 'you'
              ? missedLand || playedTappedLand
              : Boolean(cand.botRef?.missedLandThisRound);
          const stumbleExploit =
            candStumbled && (meta.id === 'ruthless' || meta.id === 'vindictive')
              ? 3 + (cand.kind === 'you' && briefing.manaWeaknesses.length > 0 ? 1.5 : 0)
              : 0;

          const ggufTargetRaw = (ggufDirective?.priorityTarget || '').trim().toLowerCase();
          const ggufTargetMatch =
            ggufTargetRaw &&
            (cand.name.trim().toLowerCase() === ggufTargetRaw ||
              (ggufTargetRaw === 'table-leader' && isTableLeader));
          const candHasGgufThreat =
            Boolean(ggufThreatLower) &&
            (getCandBoard(cand).some((p) => p.name.toLowerCase().includes(ggufThreatLower)) ||
              (cand.kind === 'you'
                ? playerEngines.some((e) => e.name.toLowerCase().includes(ggufThreatLower))
                : Boolean(
                    cand.botRef?.engines.some((e) => e.name.toLowerCase().includes(ggufThreatLower))
                  )));
          const ggufVectorBias =
            ggufDirective?.winVectorFocus === 'poison' && cand.poison > 0
              ? 6
              : ggufDirective?.winVectorFocus === 'commander' &&
                formatRules.usesCommanderDamage21 &&
                cand.cmdFromMe > 0
              ? 5
              : ggufDirective?.winVectorFocus === 'mill' && cand.libraryRemaining <= 40
              ? 5
              : 0;
          const ggufDirectiveBias =
            (ggufTargetMatch ? (ggufTargetRaw === 'you' && candidates.length >= 2 ? 6 : 11) : 0) +
            (candHasGgufThreat ? 9 : 0) +
            ggufVectorBias +
            (ggufDirective?.posture === 'aggressive' ? 4 : 0);

          const tieBreaker = ((r + idx + cand.name.length) % 3) * 0.4 + Math.random() * 2.2;
          const score =
            lethalBonus +
            evasionPressureScore +
            threatScore +
            vulnerabilityScore +
            grudgeScore +
            learnedRivalScore +
            clockMomentum +
            leaderBounty -
            antiDogpilePenalty +
            indignanceBias +
            ggufDirectiveBias +
            stumbleExploit +
            tieBreaker;

          return { cand, postEval, allInEval, score };
        });

        scored.sort((a, b) => b.score - a.score);
        chosenTarget = scored[0].cand;
        chosenEndgameEval = scored[0].postEval;
        if (ctx.lastTargetName === chosenTarget.name) {
          ctx.consecutiveTargetTurns = (ctx.consecutiveTargetTurns || 1) + 1;
        } else {
          ctx.consecutiveTargetTurns = 1;
        }
        ctx.lastTargetName = chosenTarget.name;
        targetedCountThisRound.set(
          chosenTarget.name,
          (targetedCountThisRound.get(chosenTarget.name) || 0) + 1
        );

        // If all-in guarantees lethal on the selected endgame target, upgrade candidateAttackers to all ready attackers
        if (!chosenEndgameEval.isLethal && scored[0].allInEval?.isLethal) {
          candidateAttackers = readyBotAttackersAll;
          chosenEndgameEval = scored[0].allInEval;
        }
      }

      const targetName = chosenTarget?.name || (oppContexts.find((o) => o !== ctx && !o.eliminatedBy)?.opp.name || 'You');
      const targetingYou = Boolean(chosenTarget && chosenTarget.kind === 'you');

      // Smart Attack Filter: push all attackers on lethal/wide/late-game swings; avoid bad trades early otherwise
      const defBoardForFilter = chosenTarget
        ? chosenTarget.kind === 'you'
          ? playerBattlefield
          : chosenTarget.botRef?.battlefield || []
        : [];
      const untappedDefBlockers = defBoardForFilter.filter((p) => !p.tapped);
      const isSwingingWide = candidateAttackers.length >= untappedDefBlockers.length + 2 || r >= 10;
      const isLethalSwing = Boolean(chosenEndgameEval?.isLethal);

      const botAttackers = candidateAttackers.filter((atk) => {
        if (isSwingingWide || isLethalSwing || atk.hasEvasion || atk.hasVigilance || atk.hasTrample) {
          return true;
        }
        if (atk.isAristocratsPayoff || atk.isLandfallPayoff || atk.isSpellslingerPayoff) {
          return untappedDefBlockers.length === 0;
        }
        if (untappedDefBlockers.length === 0) return true;
        const brickWalled = untappedDefBlockers.some(
          (blk) =>
            blk.toughness > atk.power * (atk.hasDoubleStrike ? 2 : 1) &&
            (blk.power >= atk.toughness || blk.hasDeathtouch) &&
            !atk.hasDeathtouch
        );
        return !brickWalled || atk.power >= 4;
      });
      if (isLethalSwing && chosenTarget) {
        creativeNotes.push(`endgame lethal line targeted ${chosenTarget.name}`);
      }

      // Spot removal evaluates the ENTIRE table (You + all rival bots) to snipe the biggest threat!
      let creaturesRemovedOnTarget = 0;
      if (!boardWipeCast && castRemovalCard && candidates.length > 0) {
        const removalPool = candidates
          .filter((c) => {
            const b = c.kind === 'you' ? playerBattlefield : c.botRef?.battlefield || [];
            const e = c.kind === 'you' ? playerEngines : c.botRef?.engines || [];
            return b.length > 0 || e.length > 0;
          })
          .map((c) => {
            const gr = ctx.grudgeByAttacker.get(c.name) || 0;
            const remScore =
              c.boardPower * 1.35 +
              c.engineCount * 5 +
              (c.commanderActive ? 7 : 0) +
              gr * 0.35 +
              (c === chosenTarget ? 3.5 : 0) +
              (c.kind === 'you' && meta.id === 'vindictive' ? 4 : 0);
            return { c, remScore };
          })
          .sort((a, b) => b.remScore - a.remScore);

        const removalTarget = removalPool[0]?.c || chosenTarget;
        if (removalTarget) {
          const targetBoard =
            removalTarget.kind === 'you'
              ? playerBattlefield
              : removalTarget.botRef?.battlefield;
          const targetEngines =
            removalTarget.kind === 'you'
              ? playerEngines
              : removalTarget.botRef?.engines;
          const targetTaxMap =
            removalTarget.kind === 'you'
              ? playerCmdTaxMap
              : removalTarget.botRef?.cmdTaxMap;
          const targetGy =
            removalTarget.kind === 'you'
              ? playerGraveyard
              : removalTarget.botRef?.graveyard;

          if (targetBoard && targetEngines && targetTaxMap && targetGy) {
            const remRes = applyTargetedRemovalToBoard({
              targetBoard,
              targetEngines,
              targetCmdTaxMap: targetTaxMap,
              targetGraveyard: targetGy,
              defenderBotCtx: removalTarget.botRef,
              isDefenderYou: removalTarget.kind === 'you',
            });
            if (removalTarget === chosenTarget) {
              creaturesRemovedOnTarget += remRes.removedCount;
            } else if (remRes.removedCount > 0) {
              creativeNotes.push(`sniped threat on ${removalTarget.name}`);
            }
            if (remRes.protectedName) {
              creativeNotes.push(`${removalTarget.name} protected ${remRes.protectedName}`);
            } else if (remRes.removedCount > 0 && removalTarget.botRef) {
              removalTarget.botRef.grudgeByAttacker.set(
                opp.name,
                (removalTarget.botRef.grudgeByAttacker.get(opp.name) || 0) + 8
              );
            }
          }
        }
      }

      // Resolve combat against chosenTarget's real blockers
      let targetLifeDelta = 0;
      let targetPoisonDelta = 0;
      let targetCommanderDamage = 0;
      let targetMillAmount = 0;
      let eachOpponentLifeDelta = spellEachOppLife;
      let eachOpponentPoison = spellEachOppPoison;
      let eachOpponentMill = spellEachOppMill;
      let lifeChangeToYou = 0;
      let poisonToYou = 0;
      let commanderDamageToYou = 0;
      let millToYou = 0;
      let botCombatAttackerDeaths = 0;
      let botCombatDefenderDeaths = 0;
      let combatDefenderLifegain = 0;

      if (!boardWipeCast && chosenTarget) {
        if (botAttackers.length > 0) {
          const defBoard =
            chosenTarget.kind === 'you'
              ? playerBattlefield
              : chosenTarget.botRef?.battlefield || [];
          const botCombat = resolveCombatPhaseBetweenBoards({
            attackers: botAttackers,
            defenderBoard: defBoard,
            defenderLife: chosenTarget.life,
            defenderPoison: chosenTarget.poison,
            defenderIsPlayer: chosenTarget.kind === 'you',
            attackerBoard: ctx.battlefield,
            onAttackerCreatureDied: (perm) => {
              recordCreatureDeparture(perm, ctx.cmdTaxMap, ctx.graveyard);
            },
            onDefenderCreatureDied: (perm) => {
              if (chosenTarget!.kind === 'you') {
                recordCreatureDeparture(perm, playerCmdTaxMap, playerGraveyard);
              } else if (chosenTarget!.botRef) {
                recordCreatureDeparture(
                  perm,
                  chosenTarget!.botRef.cmdTaxMap,
                  chosenTarget!.botRef.graveyard
                );
              }
            },
          });

          botCombatAttackerDeaths = botCombat.attackerDeaths;
          botCombatDefenderDeaths = botCombat.defenderDeaths;
          combatDefenderLifegain = botCombat.defenderLifegain;

          creaturesRemovedOnTarget += botCombat.defenderDeaths;
          targetLifeDelta -= botCombat.combatDamage;
          targetPoisonDelta += botCombat.poisonDealt;
          targetMillAmount += botCombat.millDealt;
          selfLifeGain += botCombat.lifegainDealt;
          if (botCombat.proliferateCount > 0 && poisonExistsOnTable(oppContexts, youPoison)) {
            eachOpponentPoison += botCombat.proliferateCount;
          }
          if (formatRules.usesCommanderDamage21) {
            for (const [, dmg] of botCombat.commanderDamageBySource.entries()) {
              targetCommanderDamage += dmg;
            }
          }
        }

        // Include eachOpponent deltas on target so target takes single-target + each-opp effects identically to reconciler!
        targetLifeDelta += -spellBurn + spellEachOppLife;
        targetPoisonDelta += spellPoison + spellEachOppPoison;
        targetMillAmount += spellMill + spellEachOppMill;
        eachOpponentLifeDelta = spellEachOppLife;
        eachOpponentPoison = spellEachOppPoison;
        eachOpponentMill = spellEachOppMill;

        // Fold defenderLifegain into targetLifeDelta cleanly (avoiding cmdDmgToYou === -lifeDelta fallback collision when sum === 0)
        if (combatDefenderLifegain > 0) {
          if (targetCommanderDamage > 0 && targetLifeDelta + combatDefenderLifegain === 0) {
            if (chosenTarget.kind === 'you') {
              youLife += combatDefenderLifegain;
            } else if (chosenTarget.botRef) {
              chosenTarget.botRef.life += combatDefenderLifegain;
            }
            addOffTurnLifeDelta(chosenTarget.name, combatDefenderLifegain);
          } else {
            targetLifeDelta += combatDefenderLifegain;
          }
        }
      }

      // Revert temporary EOT pumps after combat
      for (const buff of tempBotCombatBuffs) {
        buff.perm.power = Math.max(0, buff.perm.power - buff.dPow);
        buff.perm.toughness = Math.max(1, buff.perm.toughness - buff.dTou);
        if (buff.addedTrample) buff.perm.hasTrample = false;
        if (buff.addedInfect) buff.perm.hasInfect = false;
      }

      ctx.life = Math.max(0, ctx.life + selfLifeGain - selfLifeLoss);
      ctx.recentDamageDealt =
        Math.max(0, -targetLifeDelta) + targetPoisonDelta * 3 + Math.round(targetMillAmount / 2);

      if (targetingYou) {
        lifeChangeToYou = targetLifeDelta;
        poisonToYou = targetPoisonDelta;
        commanderDamageToYou = targetCommanderDamage;
        millToYou = targetMillAmount;

        if (!youEliminatedBy) {
          youLife = Math.max(0, youLife + lifeChangeToYou);
          if (poisonToYou > 0) youPoison = Math.min(20, youPoison + poisonToYou);
          if (commanderDamageToYou > 0 && formatRules.usesCommanderDamage21) {
            youCmdTaken.set(
              primaryBotCmdName,
              (youCmdTaken.get(primaryBotCmdName) || 0) + commanderDamageToYou
            );
          }
          if (millToYou > 0) {
            youLibraryRemaining = Math.max(0, youLibraryRemaining - millToYou);
          }
          const youElim = checkLiveElimination(
            youLife,
            youPoison,
            youCmdTaken,
            false
          );
          if (youElim) {
            youEliminatedBy = youElim;
            playerBattlefield.length = 0;
            playerEngines.length = 0;
          }
        }
        ctx.botDamageDealtTotal += Math.max(0, -targetLifeDelta);
      } else if (chosenTarget?.botRef) {
        const rival = chosenTarget.botRef;
        rival.life = Math.max(0, rival.life + targetLifeDelta);
        if (targetPoisonDelta > 0) {
          rival.poison = Math.min(20, rival.poison + targetPoisonDelta);
        }
        if (targetCommanderDamage > 0 && formatRules.usesCommanderDamage21) {
          rival.cmdTaken.set(
            primaryBotCmdName,
            (rival.cmdTaken.get(primaryBotCmdName) || 0) + targetCommanderDamage
          );
        }
        if (targetMillAmount > 0) {
          rival.libraryRemaining = Math.max(0, rival.libraryRemaining - targetMillAmount);
        }

        if (
          (eachOpponentLifeDelta !== 0 ||
            eachOpponentPoison > 0 ||
            eachOpponentMill > 0) &&
          !youEliminatedBy
        ) {
          lifeChangeToYou = eachOpponentLifeDelta;
          poisonToYou = eachOpponentPoison;
          millToYou = eachOpponentMill;
          youLife = Math.max(0, youLife + lifeChangeToYou);
          if (poisonToYou > 0) youPoison = Math.min(20, youPoison + poisonToYou);
          if (millToYou > 0) {
            youLibraryRemaining = Math.max(0, youLibraryRemaining - millToYou);
          }
          const youElim = checkLiveElimination(
            youLife,
            youPoison,
            youCmdTaken,
            false
          );
          if (youElim) {
            youEliminatedBy = youElim;
            playerBattlefield.length = 0;
            playerEngines.length = 0;
          }
        }

        const rivalPressure =
          Math.max(0, -targetLifeDelta) +
          targetPoisonDelta * 3 +
          Math.round(targetMillAmount / 2);
        rival.grudgeByAttacker.set(
          opp.name,
          (rival.grudgeByAttacker.get(opp.name) || 0) + rivalPressure
        );
        ctx.botRivalDamageTotal += rivalPressure;

        const rivalElim = checkLiveElimination(
          rival.life,
          rival.poison,
          rival.cmdTaken,
          false
        );
        if (rivalElim && !rival.eliminatedBy) {
          rival.eliminatedBy = rivalElim;
          rival.eliminatedInRound = r;
          rival.battlefield.length = 0;
          rival.engines.length = 0;
        }
      }

      if (eachOpponentLifeDelta !== 0 || eachOpponentPoison > 0 || eachOpponentMill > 0) {
        for (const otherBot of oppContexts) {
          if (otherBot === ctx || otherBot.opp.name === targetName || otherBot.eliminatedBy)
            continue;
          otherBot.life = Math.max(0, otherBot.life + eachOpponentLifeDelta);
          if (eachOpponentPoison > 0) {
            otherBot.poison = Math.min(20, otherBot.poison + eachOpponentPoison);
          }
          if (eachOpponentMill > 0) {
            otherBot.libraryRemaining = Math.max(
              0,
              otherBot.libraryRemaining - eachOpponentMill
            );
          }
          const drainGrudge =
            3 +
            Math.max(0, -eachOpponentLifeDelta) +
            eachOpponentPoison * 2 +
            Math.ceil(eachOpponentMill / 3);
          otherBot.grudgeByAttacker.set(
            opp.name,
            (otherBot.grudgeByAttacker.get(opp.name) || 0) + drainGrudge
          );
          const otherElim = checkLiveElimination(
            otherBot.life,
            otherBot.poison,
            otherBot.cmdTaken,
            false
          );
          if (otherElim) {
            otherBot.eliminatedBy = otherElim;
            otherBot.eliminatedInRound = r;
            otherBot.battlefield.length = 0;
            otherBot.engines.length = 0;
          }
        }
      }

      const selfElimAfterTurn = checkLiveElimination(
        ctx.life,
        ctx.poison,
        ctx.cmdTaken,
        false
      );
      if (selfElimAfterTurn && !ctx.eliminatedBy) {
        ctx.eliminatedBy = selfElimAfterTurn;
        ctx.eliminatedInRound = r;
        ctx.battlefield.length = 0;
        ctx.engines.length = 0;
      }

      // Now trigger Aristocrats ONLY for survivors whose deaths resolved in combat
      if (botCombatAttackerDeaths > 0 && !ctx.eliminatedBy) {
        const preGain = selfLifeGain;
        const preEach = spellEachOppLife;
        triggerAristocratsOnDeath('bot', ctx, botCombatAttackerDeaths);
        const drainGain = selfLifeGain - preGain;
        const drainEach = preEach - spellEachOppLife; // positive drain amount
        if (drainGain > 0) {
          ctx.life += drainGain;
        }
        if (drainEach > 0) {
          if (!youEliminatedBy) {
            youLife = Math.max(0, youLife - drainEach);
            lifeChangeToYou -= drainEach;
            if (targetingYou) targetLifeDelta -= drainEach;
          }
          eachOpponentLifeDelta -= drainEach;
          for (const otherBot of oppContexts) {
            if (otherBot === ctx || otherBot.eliminatedBy) continue;
            otherBot.life = Math.max(0, otherBot.life - drainEach);
          }
          if (chosenTarget?.botRef && !chosenTarget.botRef.eliminatedBy) {
            targetLifeDelta -= drainEach;
          }
        }
      }
      if (botCombatDefenderDeaths > 0 && chosenTarget) {
        const defAlive =
          chosenTarget.kind === 'you'
            ? !youEliminatedBy
            : Boolean(chosenTarget.botRef && !chosenTarget.botRef.eliminatedBy);
        if (defAlive) {
          triggerAristocratsOnDeath(
            chosenTarget.kind,
            chosenTarget.botRef || null,
            botCombatDefenderDeaths
          );
        }
      }

      // Final sweep after post-combat Aristocrats drains
      if (!youEliminatedBy) {
        const youDrainElim = checkLiveElimination(youLife, youPoison, youCmdTaken, false);
        if (youDrainElim) {
          youEliminatedBy = youDrainElim;
          playerBattlefield.length = 0;
          playerEngines.length = 0;
        }
      }
      for (const bCtx of oppContexts) {
        if (bCtx.eliminatedBy) continue;
        const bDrainElim = checkLiveElimination(bCtx.life, bCtx.poison, bCtx.cmdTaken, false);
        if (bDrainElim) {
          bCtx.eliminatedBy = bDrainElim;
          bCtx.eliminatedInRound = r;
          bCtx.battlefield.length = 0;
          bCtx.engines.length = 0;
        }
      }

      const appliedMemoryNote =
        spellCounteredByBot === opp.name
          ? `Countered "${playedSpellName}" on the stack (${ctx.counteredRivalThisRound || `IQ ${iq}`})`
          : ctx.counteredRivalThisRound
          ? `Stack interaction: countered ${ctx.counteredRivalThisRound}`
          : ctx.protectedThreatThisRound
          ? `Protected key threat (${ctx.protectedThreatThisRound}) from targeted removal`
          : ggufDirective?.appliedMemoryReason
          ? `GGUF Learning: ${ggufDirective.appliedMemoryReason.slice(0, 90)}${creativeNotes.length > 0 ? ` (${creativeNotes[0]})` : ''}`
          : creativeNotes.length > 0
          ? `Strategic sequence: ${creativeNotes.slice(0, 2).join('; ')}`
          : boardWipeCast && briefing.lossCount > 0
          ? `Applied past-loss discipline: cast board wipe when trailing on board`
          : shouldHoldBlocker
          ? `Held blocker back after past defeat lesson while at ${ctx.life} HP`
          : briefing.gamesPlayed > 0 &&
            targetingYou &&
            (missedLand || playedTappedLand) &&
            briefing.manaWeaknesses.length > 0
          ? `Exploited recurring mana stumble seen in ${briefing.gamesPlayed} past game(s)`
          : ggufDirective?.focusTag
          ? `GGUF Plan: ${ggufDirective.focusTag.slice(0, 80)}`
          : mem?.tacticalDirectives?.[0]
          ? mem.tacticalDirectives[0].slice(0, 85)
          : '';

      const statTags: string[] = [];
      if (boardWipeCast) statTags.push('swept all creatures');
      if (targetLifeDelta < 0) statTags.push(`${Math.abs(targetLifeDelta)} HP damage to ${targetName}`);
      if (targetPoisonDelta > 0)
        statTags.push(`+${targetPoisonDelta} poison to ${targetName}`);
      if (targetCommanderDamage > 0)
        statTags.push(`${targetCommanderDamage} Cmdr dmg to ${targetName}`);
      if (targetMillAmount > 0)
        statTags.push(`milled ${targetMillAmount} from ${targetName}`);
      if (creaturesRemovedOnTarget > 0)
        statTags.push(`removed ${creaturesRemovedOnTarget} permanent on ${targetName}`);
      if (eachOpponentLifeDelta < 0)
        statTags.push(`${Math.abs(eachOpponentLifeDelta)} each-opp drain`);
      if (selfLifeGain > 0) statTags.push(`gained ${selfLifeGain} life`);
      if (botMissedLand) statTags.push('missed land drop');

      const creativeTag = creativeNotes.length > 0 ? ` [${creativeNotes.join(', ')}]` : '';
      const actionDesc =
        spellCounteredByBot === opp.name
          ? `Targeted ${targetName}: cast ${botPlayedThisTurn.join(', ') || playedBotCard}, countered your "${playedSpellName}" on the stack${statTags.length > 0 ? `, and ${statTags.join(', ')}` : ''}${creativeTag} (IQ ${iq}).`
          : `Targeted ${targetName}: played ${botPlayedThisTurn.join(', ') || playedBotCard}${creativeTag} (${statTags.join(', ') || 'board development'}) at ${botMana} mana (IQ ${iq}).`;

      const botHasCmdOnBoard = ctx.battlefield.some((p) => p.isCommander);
      const botTotalPow = ctx.battlefield.reduce((s, p) => s + p.power, 0);
      const engineSuffix =
        ctx.engines.length > 0 ? `, ${ctx.engines.length} engine${ctx.engines.length > 1 ? 's' : ''}` : '';

      return {
        botName: opp.name,
        archetype: customNonLands.length > 0 ? 'Custom Decklist' : opp.archetype,
        indignance: meta.id as BotIndignanceLevel,
        commanderName: bias.defaultCommanderName,
        targetParticipant: targetName,
        action: actionDesc,
        boardThreat: `${botHasCmdOnBoard ? `${primaryBotCmdName} + ` : ''}${playedBotCard} (${ctx.battlefield.length} creatures, ${botTotalPow} total Pwr${engineSuffix})`,
        lifeChangeToYou,
        poisonToYou,
        commanderDamageToYou,
        millToYou,
        targetLifeDelta,
        targetPoisonDelta,
        targetCommanderDamage,
        targetMillAmount,
        eachOpponentLifeDelta,
        eachOpponentPoison,
        eachOpponentMill,
        creaturesRemovedOnTarget,
        boardWipeCast,
        selfLifeGain,
        selfLifeLoss,
        eliminatedThisTurn: Boolean(ctx.eliminatedBy),
        damageTakenFromYou: idx === playerAttackTargetIdx ? actualDmgTakenByTarget : 0,
        poisonTakenFromYou: idx === playerAttackTargetIdx ? playerPoisonDealt : 0,
        commanderDamageTakenFromYou: idx === playerAttackTargetIdx ? cmdDamageDealtByPlayer : 0,
        millTakenFromYou: idx === playerAttackTargetIdx ? playerMillDealt : 0,
        creaturesOnBoard: ctx.battlefield.length,
        landsInPlay: ctx.landsInPlay,
        manaAvailable: botMana,
        handSize: ctx.botHand.length,
        appliedPastMemory: appliedMemoryNote || undefined,
      };
    });

    const roundChanges: RoundDeckChange[] = missedLand
      ? [
          {
            action: 'add',
            addCardName: formatRules.allowsCommandZone ? 'Command Tower' : 'Untapped Dual Land',
            reason: `Missed land drop on Round ${r} with ${landsInPlay} lands in play.`,
            urgency: 'critical',
          },
        ]
      : playedTappedLand && r <= 3
      ? [
          {
            action: 'swap',
            cutCardName: playedLandName || undefined,
            addCardName: 'Untapped Dual / Fetchland',
            reason: `${playedLandName} entered tapped on Turn ${r}, delaying curve play by a full turn.`,
            urgency: 'recommended',
          },
        ]
      : [];

    const attackedBotName =
      playerAttackTargetIdx >= 0 ? oppContexts[playerAttackTargetIdx]?.opp.name : undefined;

    rounds.push({
      roundNumber: r,
      cardDrawn,
      landsInPlay,
      manaAvailable,
      handSnapshot: hand.map((c) => c.name),
      playerAction: youEliminatedBy
        ? `Eliminated (${youEliminatedBy}) — out of the match.`
        : cardsPlayed.length > 0
        ? spellCounteredByBot
          ? `Played ${cardsPlayed.join(' and ')} (${playedSpellName} countered on stack by ${spellCounteredByBot}).`
          : `Played ${cardsPlayed.join(' and ')} with ${manaAvailable} available mana${combatDamageTotal > 0 ? `, dealing ${combatDamageTotal} damage${attackedBotName ? ` to ${attackedBotName}` : ''}` : ''}.`
        : `No castable spells at ${manaAvailable} mana; passed turn holding ${hand.length} cards.`,
      cardsPlayed,
      playerStats: {
        combatDamageDealt: combatDamageTotal,
        commanderDamageDealt: cmdDamageDealtByPlayer,
        poisonDealt: playerPoisonDealt,
        millDealt: playerMillDealt,
        lifeGained: playerLifeGained,
        selfLifeLoss: playerSelfLifeLoss,
        eachOpponentLifeDelta: playerEachOppLifeDelta,
        eachOpponentPoison: playerEachOppPoison,
        eachOpponentMill: playerEachOppMill,
        cardsDrawnExtra: extraDrawCount,
        creaturesOnBoard: playerBattlefield.length,
        targetBot: attackedBotName,
      },
      botPlays,
      offTurnLifeDeltas:
        Object.keys(activeRoundOffTurnDeltas).length > 0 ? activeRoundOffTurnDeltas : undefined,
      lifeTotals: [],
      manaOrTempoIssue: missedLand
        ? `Missed land drop on Round ${r} (${landsInPlay} lands in play).`
        : tappedPenalty > 0
        ? `Tapped land reduced available mana on Round ${r}.`
        : 'Smooth mana progression.',
      roundChanges,
    });

    // Continue playing (even if You are knocked out in a multiplayer pod) until only ONE sole survivor remains!
    if (getAliveCount() <= 1) {
      break;
    }
  }

  const playerOpeningHandSize = playerMulligan.keptHand.length;
  const oppOpeningHandSizes = oppContexts.map((c) => c.openingHandSize);

  const reconciled = reconcilePlaytestMatchStats({
    rounds,
    startingLife,
    format,
    mode,
    playerMainDeckCount: mainDeckCount,
    playerOpeningHandSize,
    playerCommanderNames: commanderNames,
    opponents: oppContexts.map((ctx) => ({
      name: ctx.opp.name,
      archetype: ctx.customNonLands.length > 0 ? 'Custom Decklist' : ctx.opp.archetype,
      commanderName: ctx.bias.defaultCommanderName,
      deckSize: ctx.deckSize,
      openingHandSize: ctx.openingHandSize,
    })),
  });

  const youFinal = reconciled.finalStats.participants.find((p) => p.player === 'You');
  const winningLower = (reconciled.finalStats.winningPlayer || '').trim().toLowerCase();
  const keyThreatName =
    playerTopThreats[0] || commanderNames[0] || `${deckName} primary threat`;

  const botLearnings: BotMatchLearningInsight[] = oppContexts.map((ctx) => {
    const { opp, mem, customNonLands, blueprint } = ctx;
    const botFinal = reconciled.finalStats.participants.find(
      (p) => (p?.player || '').trim().toLowerCase() === (opp?.name || '').trim().toLowerCase()
    );
    const isBotElim = Boolean(botFinal?.eliminatedBy);
    const isBotWinner = winningLower === (opp?.name || '').trim().toLowerCase() && reconciled.outcome === 'loss';
    const topThreatOrRival =
      reconciled.finalStats.winningPlayer !== opp.name &&
      reconciled.finalStats.winningPlayer !== 'You'
        ? `rival ${reconciled.finalStats.winningPlayer}`
        : keyThreatName;

    const ownLabel =
      customNonLands.length > 0
        ? `Custom Decklist (${blueprint.primaryPlan}: ${customNonLands.slice(0, 3).join(', ')})`
        : `${opp.archetype} (${blueprint.primaryPlan})`;

    return {
      botName: opp.name,
      lessonFromPlayerDeck: isBotElim
        ? `Knocked out via ${botFinal?.eliminatedBy}${ctx.eliminatedInRound ? ` on Round ${ctx.eliminatedInRound}` : ''} while facing ${deckName} (${playerBlueprint.primaryPlan}, ${keyThreatName}) and rival pod pressure.`
        : `Faced ${deckName} (${playerBlueprint.primaryPlan}): tracked ${keyThreatName} (${youFinal?.poisonCounters ? `${youFinal.poisonCounters} poison applied` : `${youFinal?.life ?? startingLife} HP left`})${ctx.botRivalDamageTotal > 0 ? ` while trading ${ctx.botRivalDamageTotal} pressure with rival bots` : ''}.`,
      lessonFromOwnDeck: isBotElim
        ? `Piloting ${ownLabel}: fell to ${botFinal?.life ?? 0} HP — overextended or lacked blockers/sweeper timing.`
        : `Piloting ${ownLabel}: sequenced ${blueprint.synergyPackages.slice(0, 3).join(', ') || 'pod combat & removal'} cleanly in ${mode}.`,
      tacticalAdjustment: isBotElim
        ? `Save instant removal/protection & keep defensive blockers against ${topThreatOrRival} (${botFinal?.eliminatedBy} KO R${ctx.eliminatedInRound ?? reconciled.rounds.length}).`
        : isBotWinner
        ? `Continue balancing threat-pivoting, open-mana interaction, and tutor targets between ${keyThreatName} and rival pod threats to close via ${reconciled.finalStats.winCondition}.`
        : `Hold instant-speed counter/protection mana earlier and snipe ${topThreatOrRival}'s noncreature engines before they snowball.`,
      adaptationSummary:
        mem && mem.matchesPlayed > 0
          ? `Built on ${mem.matchesPlayed} prior simulated game${mem.matchesPlayed === 1 ? '' : 's'} (IQ ${mem.botIqScore}, ${mem.wins}W-${mem.losses}L) and ${mem.userFeedbackNotes.length} coaching note${mem.userFeedbackNotes.length === 1 ? '' : 's'}.`
          : `Initialized baseline matchup profile against ${deckName}.`,
    };
  });

  const winConditionText =
    reconciled.finalStats.winCondition === 'poison'
      ? '10+ Poison (Toxic/Infect)'
      : reconciled.finalStats.winCondition === 'commander'
      ? '21+ Commander Damage'
      : reconciled.finalStats.winCondition === 'mill'
      ? 'Library Mill-Out'
      : reconciled.finalStats.winCondition === 'life'
      ? '0 Life Elimination'
      : 'Sole Survivor Elimination';

  const botKOList = reconciled.finalStats.participants
    .filter((p) => p.player !== 'You' && p.eliminatedBy)
    .map((p) => `${p.player} (${p.eliminatedBy} KO)`);

  const cmdSummaryPart = formatRules.usesCommanderDamage21
    ? `, ${youFinal?.maxCommanderDamage ?? 0}/21 Max Cmdr Dmg`
    : '';

  return {
    rawRounds: rounds,
    playerOpeningHandSize,
    oppOpeningHandSizes,
    result: {
      mode,
      testedListLabel,
      startingLife,
      outcome: reconciled.outcome,
      totalRounds: reconciled.rounds.length,
      matchSummary: `Simulated ${reconciled.rounds.length} rounds in ${mode} ${format.toUpperCase()} (${winConditionText}) using paper London mulligans and color-pip mana sequencing. Winner: ${reconciled.finalStats.winningPlayer}. Final: You at ${youFinal?.life ?? startingLife} HP, ${youFinal?.poisonCounters ?? 0}/10 Poison${cmdSummaryPart}.${botKOList.length > 0 ? ` Eliminated bots: ${botKOList.join(', ')}.` : ''}`,
      openingHand,
      mulliganVerdict: playerMulligan.mulliganVerdict,
      opponentsUsed: oppContexts.map((c) => ({
        name: c.opp.name,
        archetype: c.customNonLands.length > 0 ? 'Custom Decklist' : c.opp.archetype,
        indignance: c.meta.id as BotIndignanceLevel,
      })),
      rounds: reconciled.rounds,
      keyTakeaways: [
        {
          action: 'add',
          addCardName: formatRules.allowsCommandZone ? 'Arcane Signet' : 'Fabled Passage',
          reason: formatRules.allowsCommandZone
            ? 'Smooths early colored mana pips in commander pods.'
            : `Improves colored mana consistency and tempo in ${format} games.`,
          urgency: 'recommended',
        },
      ],
      botLearnings,
      finalStats: reconciled.finalStats,
    },
  };
}

export function simulatePlaytestClientSideFallback(params: {
  deckName: string;
  format: Exclude<DeckFormat, 'auto'>;
  resolvedCards: ResolvedDeckCard[];
  overrideDeckText?: string;
  testedListLabel: string;
  mode: PlaytestMode;
  opponents: BotOpponentConfig[];
  botMemoryProfiles?: BotLearningProfile[];
  extraCardMeta?: CardMetadata[];
  resolvedCustomCardsByBotIndex?: Record<number, ResolvedDeckCard[]>;
  botTacticalDirectives?: Record<string, BotMatchTacticalDirective>;
}): PlaytestResult {
  return runClientSimulationCore(params).result;
}

export function continueSimulationToSoleWinner(params: {
  deckName: string;
  format: Exclude<DeckFormat, 'auto'>;
  resolvedCards: ResolvedDeckCard[];
  overrideDeckText?: string;
  testedListLabel: string;
  mode: PlaytestMode;
  opponents: BotOpponentConfig[];
  botMemoryProfiles?: BotLearningProfile[];
  extraCardMeta?: CardMetadata[];
  resolvedCustomCardsByBotIndex?: Record<number, ResolvedDeckCard[]>;
  botTacticalDirectives?: Record<string, BotMatchTacticalDirective>;
  initialRounds: PlaytestRound[];
}): {
  rounds: PlaytestRound[];
  finalStats: PlaytestFinalStatsSummary;
  outcome: 'win' | 'loss' | 'close';
  matchSummary: string;
  botLearnings: BotMatchLearningInsight[];
} {
  const core = runClientSimulationCore({
    ...params,
    seedFromRounds: params.initialRounds,
  });
  return {
    rounds: core.result.rounds,
    finalStats: core.result.finalStats!,
    outcome: core.result.outcome,
    matchSummary: core.result.matchSummary,
    botLearnings: core.result.botLearnings || [],
  };
}

function poisonExistsOnTable(
  oppContexts: Array<{ poison: number; eliminatedBy: string | null }>,
  youPoison: number
): boolean {
  return youPoison > 0 || oppContexts.some((o) => !o.eliminatedBy && o.poison > 0);
}
