import React, { useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  ClipboardPaste,
  Copy,
  Crown,
  FileUp,
  Link2,
  Loader2,
  Sparkles,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type { DeckFormat, DeckGoal, ParsedDeckResult } from '../types/deck';
import { SAMPLE_DECKS } from '../data/sampleDecks';
import { copyTextToClipboard, readTextFromClipboard } from '../utils/clipboard';
import {
  importDeckFromUrlClientSide,
  parseDecklistClientSide,
  safeParseApiJson,
  setDecklistCommanderClientSide,
} from '../utils/clientFallbackAnalyzer';
import {
  detectFormatFromParsedCards,
  getTargetDeckSizeForFormat,
} from '../utils/deckRules';

interface DeckImporterProps {
  deckText: string;
  deckName: string;
  format: DeckFormat;
  goal: DeckGoal;
  isAnalyzing: boolean;
  error: string | null;
  accountStatusNotice: string | null;
  onDismissAccountNotice: () => void;
  onDeckTextChange: (text: string) => void;
  onDeckNameChange: (name: string) => void;
  onFormatChange: (format: DeckFormat) => void;
  onGoalChange: (goal: DeckGoal) => void;
  onAnalyze: () => void;
  onAnalyzeLocalFallback?: () => void;
  onQuickPlaytest?: (sampleOverride?: {
    deckText: string;
    deckName: string;
    format: DeckFormat;
    goal: DeckGoal;
  }) => void;
  onQuickMultiplayer?: (sampleOverride?: {
    deckText: string;
    deckName: string;
    format: DeckFormat;
    goal: DeckGoal;
  }) => void;
}

type InputTab = 'paste' | 'url' | 'file';

export const DeckImporter: React.FC<DeckImporterProps> = ({
  deckText,
  deckName,
  format,
  goal,
  isAnalyzing,
  error,
  accountStatusNotice,
  onDismissAccountNotice,
  onDeckTextChange,
  onDeckNameChange,
  onFormatChange,
  onGoalChange,
  onAnalyze,
  onAnalyzeLocalFallback,
  onQuickPlaytest,
  onQuickMultiplayer,
}) => {
  const [activeTab, setActiveTab] = useState<InputTab>('paste');
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<'url' | 'text' | null>(null);
  const [pastedTarget, setPastedTarget] = useState<'url' | 'text' | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const deckTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const lineCount = deckText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('#')).length;

  const livePreview = useMemo(() => {
    const parsed = parseDecklistClientSide(deckText);
    const commanders = parsed.cards.filter((c) => c.zone === 'commander');
    const mainCards = parsed.cards.filter((c) => c.zone === 'main');
    const sideCards = parsed.cards.filter(
      (c) => c.zone === 'sideboard' || c.zone === 'companion'
    );
    const commanderQty = commanders.reduce((sum, c) => sum + c.quantity, 0);
    const mainQty = mainCards.reduce((sum, c) => sum + c.quantity, 0);
    const sideQty = sideCards.reduce((sum, c) => sum + c.quantity, 0);
    const totalMainAndCmd = commanderQty + mainQty;
    const effectiveFormat = detectFormatFromParsedCards(parsed.cards, format);
    const targetSize = getTargetDeckSizeForFormat(effectiveFormat, totalMainAndCmd);
    const sizeDelta = totalMainAndCmd - targetSize;
    const isLikelyCommander =
      effectiveFormat === 'commander' ||
      effectiveFormat === 'brawl' ||
      commanderQty > 0;

    const uniqueCandidateNames = Array.from(
      new Set(
        parsed.cards
          .filter((c) => c.zone === 'commander' || c.zone === 'main')
          .map((c) => c.name)
      )
    );

    return {
      parsed,
      commanders,
      commanderQty,
      mainQty,
      sideQty,
      totalMainAndCmd,
      effectiveFormat,
      targetSize,
      sizeDelta,
      isLikelyCommander,
      uniqueCandidateNames,
    };
  }, [deckText, format]);

  const applyImportedDeck = (
    rawText: string,
    explicitDeckName: string | undefined,
    fallbackSourceLabel: string
  ) => {
    const parsed = parseDecklistClientSide(rawText);
    if (parsed.cards.length === 0) {
      throw new Error(
        `No valid Magic cards could be recognized from ${fallbackSourceLabel}. Try copying the plain-text / MTGA export and pasting it into Paste Decklist.`
      );
    }
    const commanders = parsed.cards.filter((c) => c.zone === 'commander');
    const commanderNames = commanders.map((c) => c.name);
    const mainAndCmdCards = parsed.cards
      .filter((c) => c.zone === 'main' || c.zone === 'commander')
      .reduce((sum, c) => sum + c.quantity, 0);
    const sideAndCompCards = parsed.cards
      .filter((c) => c.zone === 'sideboard' || c.zone === 'companion')
      .reduce((sum, c) => sum + c.quantity, 0);

    onDeckTextChange(rawText);

    const resolvedName =
      explicitDeckName?.trim() ||
      parsed.deckName?.trim() ||
      (commanderNames.length > 0 ? `${commanderNames.join(' & ')} Commander` : undefined);

    if (resolvedName) {
      onDeckNameChange(resolvedName);
    }

    const detectedImportedFormat = detectFormatFromParsedCards(parsed.cards, 'auto');
    const currentTarget = format === 'auto'
      ? getTargetDeckSizeForFormat(detectedImportedFormat, mainAndCmdCards)
      : getTargetDeckSizeForFormat(format, mainAndCmdCards);
    const detectedTarget = getTargetDeckSizeForFormat(detectedImportedFormat, mainAndCmdCards);

    // Automatically sync format when auto-detect is active OR when importing a deck of a clearly different deck-size class (e.g. 60-card after 100-card Commander)
    if (format === 'auto' || currentTarget !== detectedTarget) {
      onFormatChange(
        detectedImportedFormat === 'casual60' ? 'auto' : detectedImportedFormat
      );
    }

    const cmdSummary =
      commanderNames.length > 0
        ? ` · Commander: ${commanderNames.join(' & ')}`
        : mainAndCmdCards >= 85
          ? ' · Commander will auto-detect from Legendary Creatures on Analyze'
          : '';
    const sizeNote =
      mainAndCmdCards === detectedTarget
        ? `${mainAndCmdCards} / ${detectedTarget} cards`
        : mainAndCmdCards > detectedTarget
        ? `${mainAndCmdCards} / ${detectedTarget} cards (${mainAndCmdCards - detectedTarget} over — Analyze trims to ${detectedTarget})`
        : `${mainAndCmdCards} / ${detectedTarget} cards (${detectedTarget - mainAndCmdCards} short — Analyze fills to ${detectedTarget})`;

    setImportNotice(
      `Imported ${sizeNote}${sideAndCompCards > 0 ? ` + ${sideAndCompCards} side/comp` : ''} (${parsed.sourceFormat || fallbackSourceLabel})${cmdSummary}.`
    );
    setActiveTab('paste');
  };

  const handleUrlImport = async (e: React.FormEvent) => {
    e.preventDefault();
    let trimmed = urlInput.trim().replace(/^<+|>+$/g, '').trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed) && /^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(trimmed)) {
      trimmed = `https://${trimmed}`;
      setUrlInput(trimmed);
    }

    setUrlLoading(true);
    setImportError(null);
    setImportNotice(null);

    try {
      let importedRawText: string | null = null;
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

      applyImportedDeck(importedRawText, importedDeckName, importedSourceFormat);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'URL import failed.');
    } finally {
      setUrlLoading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setImportError(null);
    setImportNotice(null);
    try {
      const text = await file.text();
      const cleanFileName = file.name.replace(/\.[^.]+$/, '');
      applyImportedDeck(text, deckName.trim() ? deckName : cleanFileName, file.name);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not read the selected file.');
    }
  };

  const handleCopyField = async (target: 'url' | 'text', value: string) => {
    if (!value) return;
    const ok = await copyTextToClipboard(value);
    if (ok) {
      setCopiedTarget(target);
      window.setTimeout(() => {
        setCopiedTarget((prev) => (prev === target ? null : prev));
      }, 2000);
    } else {
      setImportError('Unable to copy to clipboard automatically. Select the field and press Ctrl+C (Cmd+C on Mac).');
    }
  };

  const handlePasteField = async (target: 'url' | 'text') => {
    setImportError(null);
    const { ok, text } = await readTextFromClipboard();
    if (!ok) {
      if (target === 'url') {
        urlInputRef.current?.focus();
      } else {
        deckTextareaRef.current?.focus();
      }
      setImportError('Clipboard paste permission was blocked by this browser. Click inside the box and press Ctrl+V (Cmd+V on Mac).');
      return;
    }
    const clean = target === 'url' ? text.trim() : text;
    if (!clean.trim()) {
      setImportError('Your clipboard does not contain any text to paste.');
      return;
    }
    if (target === 'url') {
      setUrlInput(clean);
    } else {
      onDeckTextChange(clean);
    }
    setPastedTarget(target);
    window.setTimeout(() => {
      setPastedTarget((prev) => (prev === target ? null : prev));
    }, 2000);
  };

  return (
    <section className="mx-auto max-w-[1360px] px-6 py-8 space-y-5">
      {accountStatusNotice && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-sky-300 bg-sky-50 px-4 py-2.5 text-xs text-sky-900">
          <span>{accountStatusNotice}</span>
          <button
            type="button"
            onClick={onDismissAccountNotice}
            aria-label="Dismiss account notice"
            className="rounded p-1 text-sky-800 hover:bg-white cursor-pointer shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px] lg:items-start">
        {/* Main Input Card */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="border-b border-zinc-100 pb-5">
            <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-900">
              Deck Import
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Import a Magic: The Gathering deck from any platform to see exact cuts, additions, replacements, and missing lands.
            </p>
          </div>

          {/* Source Switcher Tabs */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
              <button
                type="button"
                onClick={() => setActiveTab('paste')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'paste'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Paste Decklist
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('url')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'url'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <Link2 className="h-3.5 w-3.5" />
                Import from URL
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('file')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'file'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <Upload className="h-3.5 w-3.5" />
                Upload File
              </button>
            </div>

            <div className="text-xs text-zinc-500">
              <span>Arena</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span>Moxfield</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span>Archidekt</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span>MTGGoldfish</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span>ManaBox CSV</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span>MTGO / Cockatrice</span>
            </div>
          </div>

          {importNotice && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
              {importNotice}
            </div>
          )}
          {(importError || error) && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 space-y-2">
              <div>{importError || error}</div>
              {!importError &&
                error &&
                onAnalyzeLocalFallback &&
                /credit|quota|rate limit|api key/i.test(error) && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={onAnalyzeLocalFallback}
                      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 cursor-pointer"
                    >
                      Run Local Scryfall Analysis (No AI)
                    </button>
                  </div>
                )}
            </div>
          )}

          {/* Tab Content */}
          {activeTab === 'url' && (
            <form onSubmit={handleUrlImport} className="mt-5 space-y-4">
              <div>
                <label htmlFor="deck-url-input" className="block text-sm font-medium text-zinc-800">
                  Public Deck URL
                </label>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Supports Archidekt, Moxfield, MTGGoldfish, Scryfall, Deckstats, TappedOut, CubeCobra, MTGTop8, Pastebin, GitHub Gist, and raw text links.
                </p>
                <div className="mt-2 flex flex-col gap-2.5 sm:flex-row sm:items-stretch">
                  <div className="flex flex-1 items-stretch gap-2 min-w-0">
                    <input
                      ref={urlInputRef}
                      id="deck-url-input"
                      type="text"
                      inputMode="url"
                      required
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="https://archidekt.com/decks/... or mtggoldfish.com/deck/..."
                      className="flex-1 min-w-0 rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                    />
                    <button
                      type="button"
                      onClick={() => void handlePasteField('url')}
                      title="Paste deck URL from clipboard"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {pastedTarget === 'url' ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-700" />
                          <span>Pasted</span>
                        </>
                      ) : (
                        <>
                          <ClipboardPaste className="h-3.5 w-3.5 text-sky-700" />
                          <span>Paste</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={!urlInput.trim()}
                      onClick={() => void handleCopyField('url', urlInput)}
                      title="Copy deck URL to clipboard"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {copiedTarget === 'url' ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-700" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5 text-sky-700" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                    {urlInput && (
                      <button
                        type="button"
                        onClick={() => setUrlInput('')}
                        title="Clear URL input"
                        aria-label="Clear URL input"
                        className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-2.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 cursor-pointer shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={urlLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {urlLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    {urlLoading ? 'Fetching Deck...' : 'Fetch Decklist'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {activeTab === 'file' && (
            <div className="mt-5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.dec,.dek,.cod,.csv,.tsv,.mwdeck,.json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50/70 px-6 py-12 text-center hover:border-sky-500 hover:bg-sky-50/30 transition-colors cursor-pointer"
              >
                <FileUp className="h-8 w-8 text-zinc-400" />
                <span className="mt-3 text-sm font-medium text-zinc-900">
                  Choose a deck file to import
                </span>
                <span className="mt-1 text-xs text-zinc-500">
                  Supports .txt (Arena/Moxfield), .csv/.tsv (ManaBox/Deckbox/TCGplayer), .json, .cod (Cockatrice), .dek (MTGO), .mwdeck, and .dec
                </span>
              </button>
            </div>
          )}

          {activeTab === 'paste' && (
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="deck-name" className="block text-xs font-medium text-zinc-700">
                    Deck Name (Optional)
                  </label>
                  <input
                    id="deck-name"
                    type="text"
                    value={deckName}
                    onChange={(e) => onDeckNameChange(e.target.value)}
                    placeholder="e.g. Wilhelt Zombies"
                    className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                  />
                </div>

                <div>
                  <label htmlFor="deck-format" className="block text-xs font-medium text-zinc-700">
                    Format
                  </label>
                  <select
                    id="deck-format"
                    value={format}
                    onChange={(e) => onFormatChange(e.target.value as DeckFormat)}
                    className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                  >
                    <option value="auto">Auto-Detect (60 / 100 / 40)</option>
                    <option value="commander">Commander / EDH (100)</option>
                    <option value="standard">Standard (60)</option>
                    <option value="modern">Modern (60)</option>
                    <option value="pioneer">Pioneer (60)</option>
                    <option value="pauper">Pauper (60)</option>
                    <option value="legacy">Legacy (60)</option>
                    <option value="brawl">Brawl (100 / 60)</option>
                    <option value="limited">Limited / Draft (40)</option>
                    <option value="casual60">Kitchen Table / Casual (60)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="deck-goal" className="block text-xs font-medium text-zinc-700">
                    Target Bracket (Official 1–5)
                  </label>
                  <select
                    id="deck-goal"
                    value={goal}
                    onChange={(e) => onGoalChange(e.target.value as DeckGoal)}
                    className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                  >
                    <option value="bracket-1">Bracket 1: Exhibition</option>
                    <option value="bracket-2">Bracket 2: Core (Precon Level)</option>
                    <option value="bracket-3">Bracket 3: Upgraded</option>
                    <option value="bracket-4">Bracket 4: Optimized</option>
                    <option value="bracket-5">Bracket 5: cEDH</option>
                  </select>
                </div>
              </div>

              <div className="text-xs text-zinc-500">
                {goal === 'bracket-1' &&
                  'Bracket 1 (Exhibition): Theme-first & ultra-casual · 0 Game Changers · No mass land denial, extra-turn chains, or 2-card combos.'}
                {goal === 'bracket-2' &&
                  'Bracket 2 (Core): Modern precon power · 0 Game Changers · Few tutors, no mass land denial, no intentional 2-card combos.'}
                {goal === 'bracket-3' &&
                  'Bracket 3 (Upgraded): Focused & synergistic · Up to 3 Game Changers · Late-game 2-card combos only · No mass land denial.'}
                {goal === 'bracket-4' &&
                  'Bracket 4 (Optimized): High-power & unrestricted · Unlimited Game Changers, fast mana, tutors, and combos outside tournament cEDH.'}
                {goal === 'bracket-5' &&
                  'Bracket 5 (cEDH): Tournament metagame optimization · Maximum mana efficiency, free interaction, and compact win conditions.'}
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="decklist-textarea" className="text-xs font-medium text-zinc-700">
                    Decklist Text
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs tabular-nums text-zinc-500">
                      {lineCount} lines ·{' '}
                      <span
                        className={
                          livePreview.totalMainAndCmd === 0
                            ? 'text-zinc-500'
                            : livePreview.sizeDelta === 0
                            ? 'font-semibold text-emerald-700'
                            : 'font-semibold text-amber-700'
                        }
                      >
                        {livePreview.totalMainAndCmd} / {livePreview.targetSize} cards
                        {livePreview.totalMainAndCmd > 0 && livePreview.sizeDelta > 0
                          ? ` (${livePreview.sizeDelta} over)`
                          : livePreview.totalMainAndCmd > 0 && livePreview.sizeDelta < 0
                          ? ` (${Math.abs(livePreview.sizeDelta)} short)`
                          : ''}
                      </span>
                      {livePreview.sideQty > 0 ? ` · ${livePreview.sideQty} sideboard` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handlePasteField('text')}
                      title="Paste decklist text from clipboard"
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                    >
                      {pastedTarget === 'text' ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-700" />
                          <span>Pasted</span>
                        </>
                      ) : (
                        <>
                          <ClipboardPaste className="h-3 w-3 text-sky-700" />
                          <span>Paste</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={!deckText.trim()}
                      onClick={() => void handleCopyField('text', deckText)}
                      title="Copy decklist text to clipboard"
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                    >
                      {copiedTarget === 'text' ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-700" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3 text-sky-700" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <textarea
                  ref={deckTextareaRef}
                  id="decklist-textarea"
                  rows={14}
                  value={deckText}
                  onChange={(e) => onDeckTextChange(e.target.value)}
                  placeholder={`Paste your decklist in any format, for example:\n\nCommander\n1 Wilhelt, the Rotcleaver\n\nDeck\n1 Sol Ring (CMM) 410\n1x Arcane Signet\n4 Lightning Bolt\n18 Island`}
                  className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-zinc-50/40 p-3.5 font-mono text-xs leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                />

                {livePreview.parsed.cards.length > 0 && (
                  <div className="mt-3 flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-900">
                        <Crown className="h-3.5 w-3.5 text-sky-600" />
                        Recognized Commander:
                      </span>
                      {livePreview.commanders.length > 0 ? (
                        livePreview.commanders.map((cmd) => (
                          <span
                            key={cmd.name}
                            className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2 py-0.5 font-semibold text-sky-900"
                          >
                            {cmd.name}
                          </span>
                        ))
                      ) : livePreview.isLikelyCommander ? (
                        <span className="text-zinc-600">
                          Auto-detects Legendary Creature on Analyze (or pick below)
                        </span>
                      ) : (
                        <span className="text-zinc-500">None (60-card / Non-Commander format)</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="commander-override-select"
                        className="text-xs font-medium text-zinc-600 whitespace-nowrap"
                      >
                        Set Commander:
                      </label>
                      <select
                        id="commander-override-select"
                        value={livePreview.commanders[0]?.name || ''}
                        onChange={(e) => {
                          const chosen = e.target.value;
                          if (!chosen) return;
                          const updatedText = setDecklistCommanderClientSide(deckText, chosen);
                          onDeckTextChange(updatedText);
                          if (format === 'auto') {
                            onFormatChange('commander');
                          }
                          if (!deckName.trim()) {
                            onDeckNameChange(`${chosen} Commander`);
                          }
                        }}
                        className="max-w-[220px] rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-900 focus:border-sky-600 focus:outline-none"
                      >
                        <option value="">
                          {livePreview.commanders.length > 0
                            ? 'Change commander...'
                            : 'Select card from list...'}
                        </option>
                        {livePreview.uniqueCandidateNames.map((cardName) => (
                          <option key={cardName} value={cardName}>
                            {cardName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onDeckTextChange('');
                    onDeckNameChange('');
                    setImportNotice(null);
                    setImportError(null);
                  }}
                  disabled={!deckText}
                  className="text-sm font-medium text-zinc-600 hover:text-zinc-900 disabled:opacity-40 cursor-pointer"
                >
                  Clear input
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  {onQuickPlaytest && (
                    <button
                      type="button"
                      onClick={() => onQuickPlaytest()}
                      disabled={isAnalyzing}
                      title="Jump straight to Bot Playtest without waiting for full deck analysis (uses your pasted decklist or a ready Commander pod deck if blank)"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                    >
                      <Bot className="h-4 w-4 text-sky-700 shrink-0" />
                      <span>Play vs Bots (Skip Analysis)</span>
                    </button>
                  )}

                  {onQuickMultiplayer && (
                    <button
                      type="button"
                      onClick={() => onQuickMultiplayer()}
                      disabled={isAnalyzing}
                      title="Open the 1–4 player LAN & Self-Hosted Online Multiplayer Lobby right away without analyzing a deck first"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-sky-600 bg-sky-50 px-3.5 py-2.5 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                    >
                      <Users className="h-4 w-4 text-sky-700 shrink-0" />
                      <span>Multiplayer Lobby (LAN / Online)</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onAnalyze}
                    disabled={isAnalyzing || !deckText.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Analyzing Cards &amp; Mana...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Analyze Deck
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Quick Sample Decks & Supported Sources */}
        <aside className="space-y-6">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-display text-base font-semibold text-zinc-900">
              Try a Sample Deck
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Load a real deck to analyze mana &amp; curve, or jump straight into Bot Playtest &amp; Multiplayer with zero wait.
            </p>

            <div className="mt-4 divide-y divide-zinc-100">
              {SAMPLE_DECKS.map((sample) => (
                <div
                  key={sample.id}
                  className="py-3 first:pt-1 last:pb-1 space-y-2"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onDeckTextChange(sample.deckText);
                      onDeckNameChange(sample.title);
                      onFormatChange(sample.format);
                      onGoalChange(sample.goal);
                      setImportNotice(`Loaded sample: ${sample.title}`);
                      setImportError(null);
                      setActiveTab('paste');
                    }}
                    className="block w-full text-left hover:bg-zinc-50 -mx-2 px-2 py-1 rounded-lg transition-colors cursor-pointer"
                  >
                    <div className="text-sm font-semibold text-zinc-900">{sample.title}</div>
                    <div className="mt-0.5 text-xs text-zinc-600">{sample.subtitle}</div>
                  </button>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onDeckTextChange(sample.deckText);
                        onDeckNameChange(sample.title);
                        onFormatChange(sample.format);
                        onGoalChange(sample.goal);
                        setImportNotice(`Loaded sample: ${sample.title}`);
                        setImportError(null);
                        setActiveTab('paste');
                      }}
                      className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-zinc-100 cursor-pointer"
                    >
                      Load into Editor
                    </button>
                    {onQuickPlaytest && (
                      <button
                        type="button"
                        onClick={() =>
                          onQuickPlaytest({
                            deckText: sample.deckText,
                            deckName: sample.title,
                            format: sample.format,
                            goal: sample.goal,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer"
                      >
                        <Bot className="h-3 w-3 text-sky-700" />
                        <span>Instant Playtest</span>
                      </button>
                    )}
                    {onQuickMultiplayer && (
                      <button
                        type="button"
                        onClick={() =>
                          onQuickMultiplayer({
                            deckText: sample.deckText,
                            deckName: sample.title,
                            format: sample.format,
                            goal: sample.goal,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100 cursor-pointer"
                      >
                        <Users className="h-3 w-3 text-sky-700" />
                        <span>Multiplayer</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-display text-base font-semibold text-zinc-900">
              What the Report Tells You
            </h2>
            <ul className="mt-3 space-y-2.5 text-sm text-zinc-600">
              <li>
                <span className="font-semibold text-zinc-900">Exact Land &amp; Mana Count:</span> How many lands or mana rocks you are missing (or have too many of) for your curve.
              </li>
              <li>
                <span className="font-semibold text-zinc-900">Color Fixing Check:</span> Whether you have enough White, Blue, Black, Red, or Green sources to cast spells on time.
              </li>
              <li>
                <span className="font-semibold text-zinc-900">Take Out &amp; Put In:</span> Clear cards to cut, stronger replacements, and direct 1-for-1 swaps with prices.
              </li>
              <li>
                <span className="font-semibold text-zinc-900">Ready-to-Copy List:</span> Toggle the changes you like and export your updated 60 or 100-card decklist.
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
};
