import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { DeckZone, ParsedCardEntry, ParsedDeckResult } from '../src/types/deck.ts';
import { mergeParsedCardEntries } from '../src/utils/deckRules.ts';
import { withGeminiRetry } from './geminiRetry.ts';
import {
  generateJsonWithLocalGguf,
  shouldUseCloudGemini,
  shouldUseLocalGguf,
} from './localAi.ts';

const SECTION_CATEGORY_HEADERS = new Set([
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
  'Card Advantage',
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

  // Detect Moxfield / Archidekt / TappedOut / MTGGoldfish commander & board markers:
  // *CMDR*, *COMMANDER*, [Commander], [Commander{top}], (Commander), #Commander, #!Commander, <Commander>
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

  // Extract #Category tags (Archidekt / Moxfield)
  const tagMatches = text.match(/#!?[A-Za-z0-9_/-]+/g);
  if (tagMatches && tagMatches.length > 0) {
    categoryTag = tagMatches.map((t) => t.replace(/^#!?/, '')).join(', ');
    text = text.replace(/#!?[A-Za-z0-9_/-]+/g, ' ');
  }

  // Extract ^Tag^ (Archidekt color/custom tags) and ~Status~ markers
  text = text.replace(/\^[^^]+\^/g, ' ').replace(/~[^~]+~/g, ' ');

  // Unwrap Reddit/Discord double-bracket card links like [[Sol Ring]] -> Sol Ring
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1');

  // Remove foil/etched/alter markers, price annotations, and collector glyphs anywhere at end
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

  // If line contains "(SET) collectorNumber" followed by trailing categories/tags/foil/notes
  // (e.g. "Cancel (m21) 46 [Removal] {top}", "Doubling Cube (plst) 10E-321 F", "Island (vow) 399 ★"),
  // strip from "(SET) collectorNumber" onward cleanly while capturing category tags if present.
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

  // Strip remaining trailing [Category{top}] / {tag} before checking bare "(SET)" or "[SET] collector"
  const strippedTagsBeforeSet = text
    .replace(/\[[^\]]+\]/g, (m) => {
      // Preserve [SET] / [SET:123] if it's the only set tag at the end or start
      return /^\s*\[[A-Za-z0-9]{2,6}(?::[A-Za-z0-9-]+)?\]\s*$/.test(m) ? m : ' ';
    })
    .replace(/\{[^}]+\}/g, ' ')
    .trim();
  if (strippedTagsBeforeSet) {
    text = strippedTagsBeforeSet;
  }

  text = stripTrailingAnnotations(text);

  // Extract set code & optional collector number: (CMM) 410 or (CMM) or (CMM) 410★
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

  // Strip any remaining [Category] / {tag} if doing so leaves a non-empty card name
  const strippedTags = text.replace(/\[[^\]]+\]/g, ' ').replace(/\{[^}]+\}/g, ' ').trim();
  if (strippedTags) {
    text = strippedTags;
  } else {
    text = text.replace(/^\[+|\]+$/g, '').replace(/^\{+|\}+$/g, '').trim();
  }

  // Final pass in case stripping tags revealed another trailing "(SET) collector"
  text = stripTrailingAnnotations(text);
  const lateParenMatch = text.match(
    /\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([0-9]+[A-Za-z0-9-]*|[A-Za-z0-9]{2,5}-[A-Za-z0-9-]+))?\s*$/
  );
  if (lateParenMatch && lateParenMatch.index !== undefined && lateParenMatch.index > 0) {
    if (!setCode) setCode = lateParenMatch[1].toUpperCase();
    if (!collectorNumber && lateParenMatch[2]) collectorNumber = lateParenMatch[2];
    text = text.slice(0, lateParenMatch.index).trim();
  }

  // Normalize smart apostrophes and whitespace
  text = text.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();

  return { name: text, zoneOverride, setCode, collectorNumber, categoryTag };
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
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

function extractXmlAttr(tag: string, attrName: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${attrName}\\s*=\\s*"([^"]*)"`, 'i'))
    || tag.match(new RegExp(`\\b${attrName}\\s*=\\s*'([^']*)'`, 'i'));
  return m?.[1]
    ?.replace(/&amp;/g, '&')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function parseXmlDeck(raw: string): ParsedDeckResult | null {
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
        const rawName = extractXmlAttr(tagMatch[0], 'name');
        const numStr = extractXmlAttr(tagMatch[0], 'number') || '1';
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
      return { sourceFormat: 'Cockatrice (.cod XML)', deckName, cards: mergeEntries(cards), warnings: [] };
    }
  }

  if (raw.includes('<Deck') && raw.includes('<Cards')) {
    const cards: ParsedCardEntry[] = [];
    const cardTagRegex = /<Cards\b[^>]*\/?>/gi;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = cardTagRegex.exec(raw)) !== null) {
      const rawName = extractXmlAttr(tagMatch[0], 'Name');
      const qtyStr = extractXmlAttr(tagMatch[0], 'Quantity') || '1';
      const sbStr = (extractXmlAttr(tagMatch[0], 'Sideboard') || 'false').toLowerCase();
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

function parseCsvDeck(lines: string[]): ParsedDeckResult | null {
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

  const headers = parseDelimitedLine(lines[headerIdx], delimiter).map((h) =>
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
    const cols = parseDelimitedLine(line, delimiter);
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

function parseJsonDeck(raw: string): ParsedDeckResult | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return null;

    if (Array.isArray(data.cards)) {
      const converted = formatArchidektCards(
        data as Parameters<typeof formatArchidektCards>[0]
      );
      if (converted.parsed.cards.length > 0) return converted.parsed;
    }

    if (data.boards || data.mainboard || data.commanders) {
      const converted = formatMoxfieldDeck(
        data as Parameters<typeof formatMoxfieldDeck>[0]
      );
      if (converted.parsed.cards.length > 0) return converted.parsed;
    }

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
    }
  } catch {
    return null;
  }
  return null;
}

function mergeEntries(entries: ParsedCardEntry[]): ParsedCardEntry[] {
  return mergeParsedCardEntries(entries);
}

/**
 * Classifies a raw line as a deck section header if applicable.
 * Handles headers with counts like "Commander (1):", "Deck [99]", "// Mainboard", "Creatures (24):", etc.
 */
function classifySectionHeader(line: string): DeckZone | 'ignore' | null {
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
    [
      'deck',
      'main',
      'mainboard',
      'maindeck',
      'main deck',
      'library',
      'cards',
    ].includes(stripped) ||
    SECTION_CATEGORY_HEADERS.has(stripped)
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

export function parseUniversalDecklist(rawInput: string): ParsedDeckResult {
  const trimmed = (rawInput || '')
    .replace(/[\uFEFF\u200B-\u200D]/g, '')
    .replace(/[\u00A0\u2009\u202F]/g, ' ')
    .trim();
  if (!trimmed) {
    return { sourceFormat: 'Empty', cards: [], warnings: ['No decklist text provided.'] };
  }

  if (trimmed.startsWith('<')) {
    const xmlParsed = parseXmlDeck(trimmed);
    if (xmlParsed) return xmlParsed;
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const jsonParsed = parseJsonDeck(trimmed);
    if (jsonParsed) return jsonParsed;
  }

  let lines = trimmed.split(/\r?\n/);

  // Support single-line comma-separated decklists like "1 Sol Ring, 1 Urza, Powerstone Prodigy, 1 Command Tower"
  if (lines.length === 1 && trimmed.includes(',')) {
    const commaParts = trimmed.split(/\s*,\s*(?=\d+\s*[xX]?\s+\S)/).filter(Boolean);
    if (commaParts.length >= 3 && commaParts.filter((p) => /^\d+\s*[xX]?\s*\S+/.test(p)).length >= 2) {
      lines = commaParts;
    }
  }

  if (lines.length >= 2) {
    const csvParsed = parseCsvDeck(lines);
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

  // Track paragraph blocks (separated by blank lines) to detect 1-card Commander blocks in plain .txt lists
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
      // If we were inside a "Commander" header section and already parsed 1-2 commander cards,
      // a blank line transitions to the main deck (handles Moxfield/MTGA/TappedOut .txt exports without a "Deck" header)
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

    // Optional deck title lines: "Name: My Deck", "// Name: My Deck", "Deck Name: My Deck"
    if (/^(?:\/\/\s*|#\s*)?(?:Name|Deck\s*Name|Title)\s*[:=-]\s*(.+)$/i.test(line)) {
      deckName = line
        .replace(/^(?:\/\/\s*|#\s*)?(?:Name|Deck\s*Name|Title)\s*[:=-]\s*/i, '')
        .trim();
      continue;
    }

    // Inline Commander line: e.g. "Commander: 1x Atraxa, Praetors' Voice" or "Commander: Atraxa, Praetors' Voice"
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

    // Check section header (including "// Commander", "Commander (1):", "Creatures (24)", etc.)
    const headerZone = classifySectionHeader(line);
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

    // Skip pure comments that weren't section headers
    if (line.startsWith('//') || line.startsWith('#')) {
      continue;
    }

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

    // Strip leading bullets or list numbers like "- 1 Sol Ring" or "1. 2x Sol Ring"
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
      // Check trailing quantity: "Sol Ring x1", "Lightning Bolt 4x", "Sol Ring (1)"
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

    // Skip lines that look like pure category headers with counts e.g. "Lands - 37"
    if (!qtyMatch && /^(?:lands|creatures|artifacts|enchantments|instants|sorceries|planeswalkers|spells)\s*[-–:]\s*\d+$/i.test(cleaned.name)) {
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

    // If we are in a Commander section and already collected 2 commander cards, subsequent cards default to main unless tagged
    if (currentZone === 'commander' && commanderCardsInCurrentBlock >= 2) {
      currentZone = 'main';
    }
  }

  // Heuristic for plain .txt Commander exports (e.g. Moxfield "Copy Plain Text" or MTGO .txt)
  // where 1 card (or 2 partner cards) is separated by a blank line at the top or bottom of a ~100-card list
  const totalMainCards = cards
    .filter((c) => c.zone === 'main' || c.zone === 'commander')
    .reduce((acc, c) => acc + c.quantity, 0);

  if (!explicitCommanderHeaderSeen && !cards.some((c) => c.zone === 'commander') && totalMainCards >= 85) {
    const firstParaCards = cards.filter((_, i) => cardParagraphIndices[i] === 0 && cards[i].zone === 'main');
    const firstParaQty = firstParaCards.reduce((s, c) => s + c.quantity, 0);

    const maxPara = Math.max(0, ...cardParagraphIndices);
    const lastParaCards =
      maxPara > 0
        ? cards.filter((_, i) => cardParagraphIndices[i] === maxPara && cards[i].zone === 'main')
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

function normalizeDeckUrl(rawUrl: string): URL {
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

async function fetchWithTimeout(
  targetUrl: string,
  init: RequestInit = {},
  timeoutMs = 12000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(targetUrl, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function isBotChallengePage(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('just a moment...') ||
    lower.includes('attention required! | cloudflare') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('enable javascript and cookies to continue') ||
    lower.includes('verify you are human')
  );
}

function extractDeckTextFromHtml(html: string): { rawText: string; parsed: ParsedDeckResult } | null {
  // 1. Check <textarea> blocks (used by MTGGoldfish, TappedOut, Deckstats, pastebin clones)
  const textareaMatches = html.matchAll(/<textarea[^>]*>([\s\S]*?)<\/textarea>/gi);
  for (const m of textareaMatches) {
    const candidate = decodeHtmlEntities(m[1] || '').trim();
    if (!candidate) continue;
    const parsed = parseUniversalDecklist(candidate);
    if (parsed.cards.length >= 5) {
      return { rawText: candidate, parsed };
    }
  }

  // 2. Check <pre> blocks
  const preMatches = html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi);
  for (const m of preMatches) {
    const stripped = decodeHtmlEntities((m[1] || '').replace(/<[^>]+>/g, '')).trim();
    if (!stripped) continue;
    const parsed = parseUniversalDecklist(stripped);
    if (parsed.cards.length >= 5) {
      return { rawText: stripped, parsed };
    }
  }

  return null;
}

function formatArchidektCards(data: {
  name?: string;
  categories?: Array<{ name?: string; isPremier?: boolean; includedInDeck?: boolean }>;
  cards?: Array<{
    quantity: number;
    categories?: string[];
    card?: {
      oracleCard?: { name?: string; superTypes?: string[]; types?: string[] };
      displayName?: string;
    };
  }>;
}): { rawText: string; parsed: ParsedDeckResult } {
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
      .filter((c) => c.includedInDeck === false && !premierCategories.has((c.name || '').toLowerCase()))
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
  const parsed = parseUniversalDecklist(rawText);
  if (parsed.cards.length === 0) {
    throw new Error('The Archidekt deck appears empty or only contains excluded/maybeboard cards.');
  }
  parsed.sourceFormat = 'Archidekt URL';
  parsed.deckName = data.name || parsed.deckName;
  return { rawText, parsed };
}

function formatMoxfieldDeck(data: {
  name?: string;
  commanders?: Record<string, { quantity: number; card?: { name?: string } }>;
  companions?: Record<string, { quantity: number; card?: { name?: string } }>;
  mainboard?: Record<string, { quantity: number; card?: { name?: string } }>;
  sideboard?: Record<string, { quantity: number; card?: { name?: string } }>;
  boards?: Record<
    string,
    { cards?: Record<string, { quantity: number; card?: { name?: string } }> }
  >;
}): { rawText: string; parsed: ParsedDeckResult } {
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
  const parsed = parseUniversalDecklist(rawText);
  if (parsed.cards.length === 0) {
    throw new Error('The Moxfield deck appears empty or has no mainboard/commander cards.');
  }
  parsed.sourceFormat = 'Moxfield URL';
  parsed.deckName = data.name || parsed.deckName;
  return { rawText, parsed };
}

async function extractDeckTextWithGeminiFromHtml(
  html: string,
  pageUrl: string
): Promise<{ rawText: string; parsed: ParsedDeckResult } | null> {
  if (isBotChallengePage(html)) return null;

  const visibleText = decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style[\s\S]*?<\/style>/gi, '\n')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '\n')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '\n')
      .replace(/<[^>]+>/g, '\n')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, 24000);

  if (visibleText.length < 80) return null;

  if (shouldUseLocalGguf()) {
    try {
      const EXTRACT_SCHEMA: Record<string, unknown> = {
        type: 'object',
        properties: {
          deckName: { type: 'string' },
          commanderLines: { type: 'array', maxItems: 2, items: { type: 'string' } },
          mainLines: { type: 'array', maxItems: 110, items: { type: 'string' } },
          sideboardLines: { type: 'array', maxItems: 20, items: { type: 'string' } },
        },
      };
      const extracted = await generateJsonWithLocalGguf<{
        deckName?: string;
        commanderLines?: string[];
        mainLines?: string[];
        sideboardLines?: string[];
      }>({
        systemInstruction: 'Extract MTG card lines from webpage text into strict JSON. Do not invent cards.',
        prompt: `/no_think\nExtract the MTG decklist from (${pageUrl}). Use "<qty> <exact card name>" strings. Return empty arrays if none found.\n\nText:\n${visibleText.slice(0, 6500)}`,
        maxTokens: 1100,
        temperature: 0.1,
        jsonSchema: EXTRACT_SCHEMA,
        schemaCacheKey: 'url-extract-v1',
        disableThinking: true,
        timeoutMs: 45000,
      });

      const sections: string[] = [];
      if (extracted.deckName?.trim()) sections.push(`// Name: ${extracted.deckName.trim()}`);
      if (Array.isArray(extracted.commanderLines) && extracted.commanderLines.length > 0) {
        sections.push('Commander', ...extracted.commanderLines.filter(Boolean));
      }
      if (Array.isArray(extracted.mainLines) && extracted.mainLines.length > 0) {
        sections.push('Deck', ...extracted.mainLines.filter(Boolean));
      }
      if (Array.isArray(extracted.sideboardLines) && extracted.sideboardLines.length > 0) {
        sections.push('Sideboard', ...extracted.sideboardLines.filter(Boolean));
      }
      const cleanText = sections.join('\n').trim();
      if (!cleanText) return null;
      const parsed = parseUniversalDecklist(cleanText);
      if (parsed.cards.length < 8) return null;
      return { rawText: cleanText, parsed };
    } catch {
      if (!shouldUseCloudGemini()) return null;
    }
  }

  if (!shouldUseCloudGemini()) return null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Extract the Magic: The Gathering decklist from the webpage text below (${pageUrl}).
Output ONLY plain-text decklist lines in standard format (optional "// Name: <Deck Name>", optional "Commander" section, "Deck" section, optional "Sideboard" section, with each card line as "<quantity> <exact card name>").
Do NOT invent cards that are not in the page. If no Magic: The Gathering decklist is present, output ONLY "NO_DECK_FOUND".

Webpage text:
${visibleText}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          temperature: 0,
        },
      })
    );

    const text = (response.text || '').trim();
    if (!text || text.includes('NO_DECK_FOUND')) return null;

    const cleanText = text
      .replace(/^```(?:txt|text)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    const parsed = parseUniversalDecklist(cleanText);
    if (parsed.cards.length < 8) return null;
    return { rawText: cleanText, parsed };
  } catch {
    return null;
  }
}

export async function importDeckFromUrl(rawUrl: string): Promise<{ rawText: string; parsed: ParsedDeckResult }> {
  const url = normalizeDeckUrl(rawUrl);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, text/html, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // 1. Archidekt: https://archidekt.com/decks/123456/slug
  if (host === 'archidekt.com') {
    const match = url.pathname.match(/\/decks\/(\d+)/);
    if (!match) throw new Error('Could not find an Archidekt deck ID in that URL (expected archidekt.com/decks/<id>).');
    const deckId = match[1];
    const apiUrl = `https://archidekt.com/api/decks/${deckId}/`;

    let lastStatus = 0;
    try {
      const res = await fetchWithTimeout(apiUrl, { headers });
      lastStatus = res.status;
      if (res.ok) {
        const data = (await res.json()) as Parameters<typeof formatArchidektCards>[0];
        if (data?.cards && data.cards.length > 0) {
          return formatArchidektCards(data);
        }
      }
    } catch {
      // fall through to HTML __NEXT_DATA__ extraction
    }

    // Fallback to Next.js __NEXT_DATA__ embedded state on webpage (redux.deck.cardMap)
    try {
      const pageRes = await fetchWithTimeout(`https://archidekt.com/decks/${deckId}`, { headers });
      if (!lastStatus) lastStatus = pageRes.status;
      if (pageRes.ok) {
        const html = await pageRes.text();
        const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
        if (nextMatch?.[1]) {
          const nextJson = JSON.parse(nextMatch[1]) as {
            props?: {
              pageProps?: {
                deck?: Parameters<typeof formatArchidektCards>[0];
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
            return formatArchidektCards(legacyDeck);
          }

          const reduxDeck = nextJson?.props?.pageProps?.redux?.deck;
          if (reduxDeck?.cardMap) {
            const catList = Array.isArray(reduxDeck.categories)
              ? reduxDeck.categories
              : Object.values(reduxDeck.categories || {});
            const adapted: Parameters<typeof formatArchidektCards>[0] = {
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
            if (adapted.cards && adapted.cards.length > 0) {
              return formatArchidektCards(adapted);
            }
          }
        }
      }
    } catch {
      // fall through to error
    }

    throw new Error(
      `Archidekt returned HTTP ${lastStatus || 'error'}. Make sure the deck is set to Public, or copy its text export into Paste Decklist.`
    );
  }

  // 2. Moxfield: https://www.moxfield.com/decks/<publicId>
  if (host === 'moxfield.com') {
    const match = url.pathname.match(/\/decks\/([A-Za-z0-9_-]+)/);
    if (!match) throw new Error('Could not find a Moxfield deck ID in that URL.');
    const deckId = match[1];
    const endpoints = [
      `https://api2.moxfield.com/v3/decks/all/${deckId}`,
      `https://api2.moxfield.com/v2/decks/all/${deckId}`,
      `https://api.moxfield.com/v2/decks/all/${deckId}`,
    ];

    let data: Parameters<typeof formatMoxfieldDeck>[0] | null = null;

    for (const ep of endpoints) {
      try {
        const res = await fetchWithTimeout(ep, {
          headers: {
            ...headers,
            Accept: 'application/json',
            Referer: 'https://www.moxfield.com/',
            Origin: 'https://www.moxfield.com',
          },
        });
        if (res.ok) {
          const parsedJson = (await res.json()) as Parameters<typeof formatMoxfieldDeck>[0];
          if (parsedJson && (parsedJson.boards || parsedJson.mainboard)) {
            data = parsedJson;
            break;
          }
        }
      } catch {
        // try next endpoint
      }
    }

    if (!data) {
      throw new Error(
        'Moxfield blocked automated fetching with Cloudflare protection. On Moxfield, click "Export" -> "Copy for MTGA" or "Copy Plain Text" and paste it into the Paste Decklist tab!'
      );
    }

    return formatMoxfieldDeck(data);
  }

  // 3. MTGGoldfish: https://www.mtggoldfish.com/deck/123456 or /archetype/...
  if (host === 'mtggoldfish.com') {
    let deckId = url.pathname.match(/\/deck\/(?:custom\/|visual\/)?(\d+)/)?.[1] || null;

    // If an archetype or other MTGGoldfish page was pasted, discover the underlying /deck/download/<id> link
    if (!deckId) {
      try {
        const pageRes = await fetchWithTimeout(url.toString(), { headers });
        if (pageRes.ok) {
          const html = await pageRes.text();
          const dlMatch = html.match(/\/deck\/(?:arena_)?download\/(\d+)/i);
          if (dlMatch?.[1]) {
            deckId = dlMatch[1];
          } else {
            const htmlExtracted = extractDeckTextFromHtml(html);
            if (htmlExtracted) {
              htmlExtracted.parsed.sourceFormat = 'MTGGoldfish URL';
              return htmlExtracted;
            }
          }
        }
      } catch {
        // handled below
      }
    }

    if (!deckId) {
      throw new Error(
        'Could not find a downloadable deck ID on that MTGGoldfish URL. Open the deck and copy the mtggoldfish.com/deck/<id> link or paste its Export text.'
      );
    }

    const arenaUrl = `https://www.mtggoldfish.com/deck/arena_download/${deckId}`;
    const downloadUrl = `https://www.mtggoldfish.com/deck/download/${deckId}`;

    let rawText = '';
    try {
      const arenaRes = await fetchWithTimeout(arenaUrl, { headers });
      if (arenaRes.ok) {
        const html = await arenaRes.text();
        const textareaMatch = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
        if (textareaMatch?.[1]?.trim()) {
          rawText = decodeHtmlEntities(textareaMatch[1]).trim();
        }
      }
    } catch {
      // fallback to downloadUrl
    }

    if (!rawText) {
      const res = await fetchWithTimeout(downloadUrl, { headers });
      if (!res.ok) {
        throw new Error(`MTGGoldfish returned HTTP ${res.status}. Try copying the text export instead.`);
      }
      rawText = await res.text();
    }

    if (isBotChallengePage(rawText) || rawText.includes('<!DOCTYPE html')) {
      const extracted = extractDeckTextFromHtml(rawText);
      if (extracted) {
        extracted.parsed.sourceFormat = 'MTGGoldfish URL';
        return extracted;
      }
      throw new Error('MTGGoldfish returned a webpage instead of deck text. Please paste the exported decklist text.');
    }

    const parsed = parseUniversalDecklist(rawText);
    if (parsed.cards.length === 0) {
      throw new Error('No cards were found in the MTGGoldfish deck export.');
    }
    parsed.sourceFormat = 'MTGGoldfish URL';
    return { rawText, parsed };
  }

  // 4. Deckstats: https://deckstats.net/decks/123/456-slug/en
  if (host === 'deckstats.net') {
    const cleanUrl = new URL(url.toString());
    cleanUrl.searchParams.set('export_txt', '1');
    const res = await fetchWithTimeout(cleanUrl.toString(), { headers });
    if (!res.ok) throw new Error(`Deckstats returned HTTP ${res.status}. Make sure the deck is public.`);
    const rawText = await res.text();
    if (rawText.includes('<!DOCTYPE html') || rawText.includes('<html')) {
      const extracted = extractDeckTextFromHtml(rawText);
      if (extracted) {
        extracted.parsed.sourceFormat = 'Deckstats URL';
        return extracted;
      }
      throw new Error('Deckstats returned a web page instead of plain text. Copy the text export from Deckstats and paste it.');
    }
    const parsed = parseUniversalDecklist(rawText);
    if (parsed.cards.length === 0) {
      throw new Error('No cards were found in the Deckstats export.');
    }
    parsed.sourceFormat = 'Deckstats URL';
    return { rawText, parsed };
  }

  // 5. TappedOut: https://tappedout.net/mtg-decks/slug/
  if (host === 'tappedout.net') {
    const cleanPath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    const cleanUrl = `${url.origin}${cleanPath}?fmt=txt`;
    const res = await fetchWithTimeout(cleanUrl, { headers });
    if (!res.ok) throw new Error(`TappedOut returned HTTP ${res.status}. Make sure the deck is public.`);
    const rawText = await res.text();
    if (rawText.includes('<!DOCTYPE html') || rawText.includes('<html')) {
      const extracted = extractDeckTextFromHtml(rawText);
      if (extracted) {
        extracted.parsed.sourceFormat = 'TappedOut URL';
        return extracted;
      }
      throw new Error('TappedOut returned a web page instead of plain text. Please copy & paste the decklist text.');
    }
    const parsed = parseUniversalDecklist(rawText);
    if (parsed.cards.length === 0) {
      throw new Error('No cards were found in the TappedOut export.');
    }
    parsed.sourceFormat = 'TappedOut URL';
    return { rawText, parsed };
  }

  // 6. Scryfall: https://scryfall.com/@user/decks/<uuid> or /decks/<uuid>
  if (host === 'scryfall.com' || host === 'api.scryfall.com') {
    const match = url.pathname.match(/\/decks\/([0-9a-f-]{36})/i);
    if (!match) throw new Error('Could not find a Scryfall deck UUID in that URL.');
    const deckId = match[1];
    const exportUrl = `https://api.scryfall.com/decks/${deckId}/export/text`;
    const res = await fetchWithTimeout(exportUrl, { headers });
    if (res.ok) {
      const rawText = await res.text();
      const parsed = parseUniversalDecklist(rawText);
      if (parsed.cards.length > 0) {
        parsed.sourceFormat = 'Scryfall URL';
        return { rawText, parsed };
      }
    }

    // Fallback to JSON Scryfall deck endpoint
    const jsonRes = await fetchWithTimeout(`https://api.scryfall.com/decks/${deckId}`, {
      headers: { ...headers, Accept: 'application/json' },
    });
    if (!jsonRes.ok) {
      throw new Error(`Scryfall returned HTTP ${jsonRes.status}. Make sure the deck is public.`);
    }
    const deckJson = (await jsonRes.json()) as {
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
    const parsed = parseUniversalDecklist(rawText);
    parsed.sourceFormat = 'Scryfall URL';
    parsed.deckName = deckJson.name || parsed.deckName;
    return { rawText, parsed };
  }

  // 7. CubeCobra: https://cubecobra.com/cube/list/<id>
  if (host === 'cubecobra.com') {
    const match = url.pathname.match(/\/cube\/(?:list|overview|playtest|analysis|about)\/([A-Za-z0-9_-]+)/i);
    if (!match) {
      throw new Error('Could not find a CubeCobra cube ID in that URL.');
    }
    const dlUrl = `https://cubecobra.com/cube/download/plaintext/${match[1]}`;
    const res = await fetchWithTimeout(dlUrl, { headers });
    if (!res.ok) throw new Error(`CubeCobra returned HTTP ${res.status}. Make sure the cube is public.`);
    const rawText = await res.text();
    const parsed = parseUniversalDecklist(rawText);
    if (parsed.cards.length === 0) throw new Error('No cards were found in that CubeCobra list.');
    parsed.sourceFormat = 'CubeCobra URL';
    return { rawText, parsed };
  }

  // 8. MTGTop8: https://www.mtgtop8.com/event?e=...&d=123456
  if (host === 'mtgtop8.com') {
    const deckId = url.searchParams.get('d');
    if (deckId && /^\d+$/.test(deckId)) {
      const dlUrl = `https://www.mtgtop8.com/mtgo?d=${deckId}`;
      const res = await fetchWithTimeout(dlUrl, { headers });
      if (!res.ok) throw new Error(`MTGTop8 returned HTTP ${res.status}.`);
      const rawText = await res.text();
      const parsed = parseUniversalDecklist(rawText);
      if (parsed.cards.length > 0) {
        parsed.sourceFormat = 'MTGTop8 URL';
        return { rawText, parsed };
      }
    }
  }

  // 9. Pastebin: rewrite pastebin.com/<id> -> pastebin.com/raw/<id>
  if (host === 'pastebin.com' && !url.pathname.startsWith('/raw/')) {
    const idMatch = url.pathname.match(/^\/([A-Za-z0-9]+)$/);
    if (idMatch) {
      const res = await fetchWithTimeout(`https://pastebin.com/raw/${idMatch[1]}`, { headers });
      if (!res.ok) throw new Error(`Pastebin returned HTTP ${res.status}.`);
      const rawText = await res.text();
      const parsed = parseUniversalDecklist(rawText);
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
      const apiRes = await fetchWithTimeout(`https://api.github.com/gists/${gistId}`, {
        headers: {
          ...headers,
          Accept: 'application/vnd.github+json',
        },
      });
      if (apiRes.ok) {
        const gist = (await apiRes.json()) as {
          description?: string;
          files?: Record<string, { filename?: string; content?: string }>;
        };
        for (const file of Object.values(gist.files || {})) {
          if (!file.content) continue;
          const parsed = parseUniversalDecklist(file.content);
          if (parsed.cards.length > 0) {
            parsed.sourceFormat = 'GitHub Gist URL';
            if (!parsed.deckName && gist.description) parsed.deckName = gist.description;
            return { rawText: file.content, parsed };
          }
        }
      }
    }
  }

  // 11. Generic URL fallback (raw text links or extractable HTML deck pages)
  const res = await fetchWithTimeout(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch URL from ${host} (HTTP ${res.status}). Try copying and pasting the decklist text.`);
  }
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const text = await res.text();

  if (isBotChallengePage(text)) {
    throw new Error(
      `${host} blocked automated fetching with bot/Cloudflare protection. Export or copy the decklist text on ${host} and paste it in the Paste Decklist tab!`
    );
  }

  const looksHtml =
    contentType.includes('text/html') ||
    /<!doctype\s+html/i.test(text) ||
    /<html[\s>]/i.test(text);

  if (looksHtml) {
    const htmlExtracted = extractDeckTextFromHtml(text);
    if (htmlExtracted) {
      htmlExtracted.parsed.sourceFormat = `URL Import (${host})`;
      return htmlExtracted;
    }

    const aiExtracted = await extractDeckTextWithGeminiFromHtml(text, url.toString());
    if (aiExtracted) {
      aiExtracted.parsed.sourceFormat = `URL Import (${host})`;
      return aiExtracted;
    }

    throw new Error(
      `Direct URL import from ${host} isn't available without their export button. Export or copy the decklist text from ${host} and paste it in the Paste Decklist tab!`
    );
  }

  const parsed = parseUniversalDecklist(text);
  if (parsed.cards.length === 0) {
    throw new Error('Could not find any Magic cards at that URL. Try copying and pasting the decklist text.');
  }
  parsed.sourceFormat = `URL Import (${host})`;
  return { rawText: text, parsed };
}
