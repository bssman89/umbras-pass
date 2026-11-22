import type {
  CardMetadata,
  DeckFormat,
  ParsedDeckResult,
  ResolvedDeckCard,
  SavedCustomBotDeck,
} from '../types/deck';
import {
  autoRecognizeCommandersClientSide,
  importDeckFromUrlClientSide,
  parseDecklistClientSide,
  safeParseApiJson,
} from './clientFallbackAnalyzer';

const SAVED_CUSTOM_BOT_DECKS_KEY = 'umbras-pass-custom-bot-decks-v1';

export function loadSavedCustomBotDecks(): SavedCustomBotDeck[] {
  try {
    const raw = window.localStorage.getItem(SAVED_CUSTOM_BOT_DECKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is SavedCustomBotDeck =>
          Boolean(item) &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          typeof item.deckText === 'string' &&
          item.deckText.trim().length > 0
      )
      .slice(0, 40);
  } catch {
    return [];
  }
}

function persistSavedCustomBotDecks(decks: SavedCustomBotDeck[]): SavedCustomBotDeck[] {
  const trimmed = decks.slice(0, 40);
  try {
    window.localStorage.setItem(SAVED_CUSTOM_BOT_DECKS_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore localStorage quota/private-mode errors
  }
  return trimmed;
}

export function saveCustomBotDeck(input: {
  id?: string;
  name: string;
  deckText: string;
  commanderName?: string;
  cardCount: number;
}): SavedCustomBotDeck[] {
  const cleanText = input.deckText.trim();
  const cleanName = input.name.trim() || input.commanderName?.trim() || 'Custom Bot Deck';
  if (!cleanText) return loadSavedCustomBotDecks();

  const existing = loadSavedCustomBotDecks();
  const now = new Date().toISOString();
  const normalizedTargetName = cleanName.toLowerCase();

  const matchIdx = existing.findIndex(
    (d) =>
      (input.id && d.id === input.id) ||
      d.name.trim().toLowerCase() === normalizedTargetName
  );

  const entry: SavedCustomBotDeck = {
    id: matchIdx >= 0 ? existing[matchIdx].id : `botdeck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    commanderName: input.commanderName?.trim() || undefined,
    cardCount: Math.max(0, input.cardCount),
    deckText: cleanText,
    updatedAt: now,
  };

  if (matchIdx >= 0) {
    const next = existing.filter((_, i) => i !== matchIdx);
    return persistSavedCustomBotDecks([entry, ...next]);
  }
  return persistSavedCustomBotDecks([entry, ...existing]);
}

export function deleteSavedCustomBotDeck(id: string): SavedCustomBotDeck[] {
  const existing = loadSavedCustomBotDecks();
  const next = existing.filter((d) => d.id !== id);
  return persistSavedCustomBotDecks(next);
}

export async function importBotDeckFromUrl(url: string): Promise<{
  rawText: string;
  deckName?: string;
  sourceFormat?: string;
}> {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error('Paste a deck URL first.');
  }

  let importedRawText = '';
  let importedDeckName: string | undefined;
  let importedSourceFormat = 'URL';

  let data: {
    rawText?: string;
    parsed?: ParsedDeckResult;
    error?: string;
  } | null = null;
  let resOk = false;

  try {
    const res = await fetch('/api/import-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: trimmed }),
    });
    resOk = res.ok;
    data = await safeParseApiJson<{
      rawText?: string;
      parsed?: ParsedDeckResult;
      error?: string;
    }>(res);
  } catch {
    data = null;
  }

  if (data && resOk && data.rawText) {
    importedRawText = data.rawText;
    importedDeckName = data.parsed?.deckName;
    importedSourceFormat = data.parsed?.sourceFormat || 'URL';
  } else if (
    data &&
    data.error &&
    /valid http|only http|could not find a|make sure the deck is (?:set to )?public|returned http 404|isn't available without|no cards were found|no magic cards/i.test(
      data.error
    )
  ) {
    throw new Error(data.error);
  } else {
    try {
      const clientImported = await importDeckFromUrlClientSide(trimmed);
      importedRawText = clientImported.rawText;
      importedDeckName = clientImported.parsed.deckName;
      importedSourceFormat = clientImported.parsed.sourceFormat || 'URL';
    } catch (clientErr) {
      if (data?.error) {
        throw new Error(data.error);
      }
      throw clientErr;
    }
  }

  if (!importedRawText.trim()) {
    throw new Error('No cards were returned from that deck URL.');
  }

  return {
    rawText: importedRawText,
    deckName: importedDeckName,
    sourceFormat: importedSourceFormat,
  };
}

export interface CustomBotDeckSummary {
  totalQty: number;
  cmdQty: number;
  mainQty: number;
  commanders: string[];
  candidates: string[];
  suggestedName: string;
}

export function summarizeCustomBotDeck(
  rawText: string,
  format: string,
  findMeta?: (name: string) => CardMetadata | null
): CustomBotDeckSummary {
  if (!rawText || !rawText.trim()) {
    return {
      totalQty: 0,
      cmdQty: 0,
      mainQty: 0,
      commanders: [],
      candidates: [],
      suggestedName: '',
    };
  }

  const parsed = parseDecklistClientSide(rawText);
  const resolved: ResolvedDeckCard[] = parsed.cards.map((c) => ({
    ...c,
    card: findMeta ? findMeta(c.name) : null,
  }));

  const normalizedFmt = format.trim().toLowerCase();
  const isBrawl = normalizedFmt === 'brawl';
  const totalNonSide = resolved
    .filter((c) => c.zone === 'main' || c.zone === 'commander')
    .reduce((sum, c) => sum + c.quantity, 0);

  if (resolved.length > 0 && (normalizedFmt === 'commander' || isBrawl || resolved.some((c) => c.zone === 'commander') || totalNonSide >= 85)) {
    const targetFmt: Exclude<DeckFormat, 'auto'> = isBrawl ? 'brawl' : 'commander';
    autoRecognizeCommandersClientSide(resolved, targetFmt);
  }

  const cmdCards = resolved.filter((c) => c.zone === 'commander');
  const mainCards = resolved.filter((c) => c.zone === 'main');
  const cmdQty = cmdCards.reduce((sum, c) => sum + c.quantity, 0);
  const mainQty = mainCards.reduce((sum, c) => sum + c.quantity, 0);
  const totalQty = cmdQty + mainQty;
  const commanders = cmdCards.map((c) => c.name);
  const candidates = Array.from(
    new Set(
      resolved
        .filter((c) => c.zone === 'commander' || c.zone === 'main')
        .map((c) => c.name)
    )
  );
  const suggestedName =
    parsed.deckName?.trim() ||
    (commanders.length > 0 ? commanders.join(' & ') : '') ||
    (totalQty > 0 ? `Custom Deck (${totalQty} cards)` : '');

  return {
    totalQty,
    cmdQty,
    mainQty,
    commanders,
    candidates,
    suggestedName,
  };
}
