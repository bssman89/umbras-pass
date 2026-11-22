import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  CardAddRecommendation,
  CardCutRecommendation,
  CardMetadata,
  CardSwapRecommendation,
  DeckAnalysisResult,
  DeckGoal,
  DeckMetrics,
  LandPlanItem,
  ManaPlanSummary,
  ResolvedDeckCard,
} from '../src/types/deck.ts';
import { analyzeDeckClientSideFallback } from '../src/utils/clientFallbackAnalyzer.ts';
import {
  addMapCardCount,
  findMatchingCardMapKey,
  getMapCardCount,
  getMaxCopiesForCard,
  isBasicLandCard,
  isSameCardName,
  normalizeDeckCardKey,
  reconcileAnalysisRecommendationsToTargetSize,
} from '../src/utils/deckRules.ts';
import {
  generateJsonWithLocalGguf,
  getActiveLocalModelInfo,
  getActiveLocalModelLabel,
  shouldUseCloudGemini,
  shouldUseDeterministicOnly,
  shouldUseLocalGguf,
} from './localAi.ts';
import { resolveCardNamesWithScryfall } from './scryfall.ts';
import { withGeminiRetry } from './geminiRetry.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment variables.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface RawGeminiAnalysis {
  deckName: string;
  archetype: string;
  verdictHeadline: string;
  verdictSummary: string;
  topPriorities: string[];
  manaPlan: {
    verdict: 'missing-lands' | 'missing-colors' | 'too-many-lands' | 'slow-manabase' | 'balanced';
    headline: string;
    plainExplanation: string;
    tappedLandsWarning: string;
    colorIssues: string[];
    landChanges: Array<{
      action: 'add' | 'cut';
      cardName: string;
      quantity: number;
      reason: string;
    }>;
  };
  swaps: Array<{
    cutCardName: string;
    addCardName: string;
    quantity: number;
    role: string;
    cutReason: string;
    addReason: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  cuts: Array<{
    cardName: string;
    quantity: number;
    reason: string;
    category: 'land' | 'off-plan' | 'overcosted' | 'outclassed' | 'illegal' | 'excess';
    priority: 'high' | 'medium' | 'low';
  }>;
  additions: Array<{
    cardName: string;
    quantity: number;
    role: 'Land' | 'Mana Ramp' | 'Card Draw' | 'Removal' | 'Board Wipe' | 'Protection' | 'Synergy' | 'Finisher';
    reason: string;
    priority: 'high' | 'medium' | 'low';
  }>;
}

const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    deckName: { type: Type.STRING, description: 'Concise descriptive deck title.' },
    archetype: { type: Type.STRING, description: 'Deck archetype, e.g. Dimir Zombies Midrange or Mono-Red Burn.' },
    verdictHeadline: { type: Type.STRING, description: 'Short 6-12 word plain-English main takeaway.' },
    verdictSummary: { type: Type.STRING, description: 'Clear 2-3 sentence overview in simple everyday language.' },
    topPriorities: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Exactly 3 short, concrete next steps for the player.',
    },
    manaPlan: {
      type: Type.OBJECT,
      properties: {
        verdict: {
          type: Type.STRING,
          description: 'One of: missing-lands, missing-colors, too-many-lands, slow-manabase, balanced',
        },
        headline: { type: Type.STRING, description: 'Short plain-English mana verdict headline.' },
        plainExplanation: {
          type: Type.STRING,
          description: 'Clear explanation of how many lands or mana pieces are missing or excess and why.',
        },
        tappedLandsWarning: {
          type: Type.STRING,
          description: 'Empty string if fine, or clear warning about enters-tapped lands slowing the deck.',
        },
        colorIssues: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Specific color fixing deficits (e.g. "Missing ~3 Blue sources for turn-2 double-blue spells").',
        },
        landChanges: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, description: 'add or cut' },
              cardName: { type: Type.STRING, description: 'Exact Magic card name.' },
              quantity: { type: Type.INTEGER },
              reason: { type: Type.STRING, description: 'Simple plain-English reason.' },
            },
            required: ['action', 'cardName', 'quantity', 'reason'],
          },
        },
      },
      required: ['verdict', 'headline', 'plainExplanation', 'tappedLandsWarning', 'colorIssues', 'landChanges'],
    },
    swaps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          cutCardName: { type: Type.STRING, description: 'Exact card name from the submitted deck.' },
          addCardName: { type: Type.STRING, description: 'Exact real Magic card name to put in instead.' },
          quantity: { type: Type.INTEGER },
          role: { type: Type.STRING, description: 'Role like Mana Ramp, Card Draw, Removal, Synergy, Land.' },
          cutReason: { type: Type.STRING, description: 'Why the old card should come out (plain English).' },
          addReason: { type: Type.STRING, description: 'Why the new card is better here (plain English).' },
          priority: { type: Type.STRING, description: 'high, medium, or low' },
        },
        required: ['cutCardName', 'addCardName', 'quantity', 'role', 'cutReason', 'addReason', 'priority'],
      },
    },
    cuts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          cardName: { type: Type.STRING, description: 'Exact card name from the submitted deck.' },
          quantity: { type: Type.INTEGER },
          reason: { type: Type.STRING, description: 'Why this card should be taken out.' },
          category: { type: Type.STRING, description: 'One of: land, off-plan, overcosted, outclassed, illegal, excess' },
          priority: { type: Type.STRING, description: 'high, medium, or low' },
        },
        required: ['cardName', 'quantity', 'reason', 'category', 'priority'],
      },
    },
    additions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          cardName: { type: Type.STRING, description: 'Exact real Magic card name to add.' },
          quantity: { type: Type.INTEGER },
          role: {
            type: Type.STRING,
            description: 'One of: Land, Mana Ramp, Card Draw, Removal, Board Wipe, Protection, Synergy, Finisher',
          },
          reason: { type: Type.STRING, description: 'Why this card should be put in.' },
          priority: { type: Type.STRING, description: 'high, medium, or low' },
        },
        required: ['cardName', 'quantity', 'role', 'reason', 'priority'],
      },
    },
  },
  required: [
    'deckName',
    'archetype',
    'verdictHeadline',
    'verdictSummary',
    'topPriorities',
    'manaPlan',
    'swaps',
    'cuts',
    'additions',
  ],
};

export async function analyzeDeckWithGemini(params: {
  deckText?: string;
  deckName?: string;
  sourceFormat: string;
  goal: DeckGoal;
  resolvedCards: ResolvedDeckCard[];
  metrics: DeckMetrics;
  onProgress?: (percent: number, stage: string, detail?: string) => void;
}): Promise<DeckAnalysisResult> {
  const { deckText, deckName, sourceFormat, goal, resolvedCards, metrics, onProgress } = params;

  const fallbackSerializedText =
    deckText?.trim() ||
    resolvedCards.map((c) => `${c.quantity} ${c.name}`).join('\n');

  const runDeterministicAnalysis = () => {
    onProgress?.(78, 'Running deterministic mana & synergy engine...');
    return analyzeDeckClientSideFallback({
      deckText: fallbackSerializedText,
      deckName,
      format: metrics.detectedFormat,
      goal,
      preResolvedCards: resolvedCards,
      precomputedMetrics: metrics,
      resolveCardsFn: (names, fmt) =>
        resolveCardNamesWithScryfall(names, fmt, { skipMarketPrices: false }),
    });
  };

  if (shouldUseDeterministicOnly()) {
    return runDeterministicAnalysis();
  }

  onProgress?.(44, 'Building mana curve & color identity summary...');

  const mainCards = resolvedCards.filter(
    (c) => c.zone === 'main' || c.zone === 'commander'
  );
  const sideboardCards = resolvedCards.filter(
    (c) => c.zone === 'sideboard' || c.zone === 'companion'
  );

  const deckLines = mainCards.map((c) => {
    const zoneTag = c.zone === 'commander' ? '[COMMANDER] ' : c.zone === 'companion' ? '[COMPANION] ' : '';
    const m = c.card;
    if (!m) return `${c.quantity}x ${zoneTag}${c.name} (unresolved)`;
    const tags: string[] = [];
    if (m.isLand) tags.push('Land');
    if (m.isMdfcLand) tags.push('MDFC Land');
    if (m.entersTappedLikely) tags.push('EntersTapped');
    if (m.isRamp) tags.push('Ramp');
    if (m.isDraw) tags.push('Draw');
    if (m.isRemoval) tags.push('Removal');
    if (m.isBoardWipe) tags.push('Wipe');
    const tagStr = tags.length > 0 ? ` | Roles: ${tags.join(', ')}` : '';
    return `${c.quantity}x ${zoneTag}${m.name} | Cost: ${m.manaCost || '0'} (MV ${m.cmc}) | Type: ${m.typeLine}${tagStr}`;
  });

  const activeColorItems = metrics.colorBreakdown.filter((c) => c.status !== 'unused');
  const allowedColors =
    metrics.commanderColorIdentity.length > 0
      ? metrics.commanderColorIdentity
      : activeColorItems.map((c) => c.color);
  const allowedColorSet = new Set<string>(allowedColors);
  const allFiveColors = ['W', 'U', 'B', 'R', 'G'];
  const forbiddenColors = allFiveColors.filter((c) => !allowedColorSet.has(c));

  const isCardAllowedInDeckColors = (meta: CardMetadata | null): boolean => {
    if (!meta) return true;
    const cid = meta.colorIdentity || [];
    if (cid.some((c) => !allowedColorSet.has(c))) {
      return false;
    }
    if (meta.isLand) {
      const coloredProduced = (meta.producedMana || []).filter(
        (c) => c === 'W' || c === 'U' || c === 'B' || c === 'R' || c === 'G'
      );
      // If a land produces specific colors (1 to 3 colors, not 5-color Command Tower/Exotic Orchard),
      // at least one produced color (and for basic/dual lands with color identity, all) must be in allowedColorSet
      if (coloredProduced.length > 0 && coloredProduced.length <= 3) {
        if (!coloredProduced.some((c) => allowedColorSet.has(c))) {
          return false;
        }
      }
    }
    return true;
  };

  const colorSummary = activeColorItems
    .map(
      (c) =>
        `${c.label} (${c.color}): ${c.pips} pips (${c.pipSharePct}% of colored pips), ${c.currentSources} current sources vs ${c.recommendedSources} recommended (${c.deltaSources > 0 ? `missing ${c.deltaSources}` : `${Math.abs(c.deltaSources)} surplus`})`
    )
    .join('\n');

  const goalInstructions: Record<DeckGoal, string> = {
    'bracket-1':
      'Bracket 1 (Exhibition): Ultra-casual, theme-first deckbuilding. Recommend ZERO Game Changers, no mass land denial, no chaining extra turns, no 2-card infinite combos, and minimal tutors. Focus purely on fixing lands/mana smoothness and fun thematic cards.',
    'bracket-2':
      'Bracket 2 (Core): Precon-level casual balance. Recommend ZERO Game Changers, no mass land denial, no chaining extra turns, and no intentional 2-card infinite combos. Focus on clean curve, reliable lands/ramp, and accessible upgrades.',
    'bracket-3':
      'Bracket 3 (Upgraded): Focused, synergistic deckbuilding beyond precon level. Respect the cap of at most 3 Game Changers total (flag if the deck already exceeds 3), no mass land denial, no chaining extra turns, and avoid early-game 2-card combos.',
    'bracket-4':
      'Bracket 4 (Optimized): High-power, unrestricted tuning. Unlimited Game Changers, efficient tutors, strong staples, and fast mana are fair game while preserving the deck archetype.',
    'bracket-5':
      'Bracket 5 (cEDH): Tournament-level competitive optimization. Prioritize maximum mana efficiency, lowest possible mana curve, free/cheap interaction, and compact competitive win conditions.',
  };

  const prompt = `Analyze this Magic: The Gathering deck and give the player a crystal-clear, simple-to-understand action plan.

DECK CONTEXT:
- Provided Name: ${deckName || 'Untitled Deck'}
- Format: ${metrics.detectedFormat} (Target main+commander size: ${metrics.targetDeckSize})
- Target Official Bracket: ${goal} — ${goalInstructions[goal]}
- Current Main+Commander Count: ${metrics.currentMainAndCommanderCount} (${metrics.deckSizeDelta > 0 ? `${metrics.deckSizeDelta} cards SHORT of ${metrics.targetDeckSize}` : metrics.deckSizeDelta < 0 ? `${Math.abs(metrics.deckSizeDelta)} cards OVER ${metrics.targetDeckSize}` : `Exact ${metrics.targetDeckSize} cards`})
- Commanders: ${metrics.commanderNames.length > 0 ? metrics.commanderNames.join(', ') : 'None'}
- STRICT ALLOWED DECK COLORS: ${allowedColors.length > 0 ? allowedColors.join(', ') : 'Colorless (C) ONLY'}
- FORBIDDEN OFF-COLORS (DO NOT SUGGEST ANY CARDS OR LANDS WITH THESE COLORS): ${forbiddenColors.length > 0 ? forbiddenColors.join(', ') : 'None'}
- Lands: ${metrics.currentLands} lands (+ ${metrics.mdfcLandCount} MDFC spell-lands, ${metrics.tappedLandCount} tapped lands). Recommended Lands: ${metrics.recommendedLands} (${metrics.landsDelta > 0 ? `MISSING ${metrics.landsDelta} lands` : metrics.landsDelta < 0 ? `${Math.abs(metrics.landsDelta)} EXCESS lands` : 'Land count is on target'}).
- Ramp / Mana Acceleration: ${metrics.currentRamp} pieces (Recommended: ${metrics.recommendedRamp}, ${metrics.rampDelta > 0 ? `missing ${metrics.rampDelta}` : 'sufficient'}).
- Card Draw: ${metrics.currentDraw} (Target: ~${metrics.recommendedDraw}).
- Removal: ${metrics.currentRemoval} (Target: ~${metrics.recommendedRemoval}), Board Wipes: ${metrics.currentBoardWipes}.
- Avg Non-Land Mana Value: ${metrics.averageCmcNonLand}
- Legal / Rules Issues: ${[...metrics.formatViolations, ...metrics.singletonViolations, ...metrics.colorIdentityViolations].join('; ') || 'None detected'}

COLOR PIP DEMAND VS MANA SOURCES:
${colorSummary || 'Colorless / No colored pips'}

SUBMITTED DECKLIST:
${deckLines.join('\n')}
${sideboardCards.length > 0 ? `\nSIDEBOARD:\n${sideboardCards.map((s) => `${s.quantity}x ${s.name}`).join('\n')}` : ''}

STRICT RULES FOR YOUR RECOMMENDATIONS:
1. NEVER suggest cutting a card that is NOT in the Submitted Decklist above. Every card in "swaps[].cutCardName", "cuts[].cardName", and "manaPlan.landChanges" (with action="cut") MUST be spelled identically to a card in the decklist above.
2. NEVER recommend any card, spell, mana rock, or land whose color identity includes any forbidden color (${forbiddenColors.join(', ') || 'none'}). Every recommended card MUST strictly fit within [${allowedColors.join(', ') || 'Colorless'}].
3. Make the card math add up!
   - If the deck has ${metrics.landsDelta > 0 ? `${metrics.landsDelta} missing lands` : metrics.landsDelta < 0 ? `${Math.abs(metrics.landsDelta)} excess lands` : '0 missing lands'}, put the specific lands/mana rocks to add or cut in "manaPlan.landChanges".
   - Put direct 1-for-1 spell or land upgrades in "swaps" (5 to 8 high-impact swaps).
   - If the deck needs to free up slots for missing lands (or is over ${metrics.targetDeckSize} cards), list the weakest non-land cards to take out in "cuts" so the player knows exactly what to remove to fit the missing lands!
   - If the deck is under ${metrics.targetDeckSize} cards (or needs extra lands/spells after cuts), list what to put in under "additions" (and/or "manaPlan.landChanges").
   - Do NOT repeat the same cut card across both "swaps" and "cuts".
   - NEVER recommend adding a card in "swaps[].addCardName", "additions[].cardName", or "manaPlan.landChanges" (non-basic land) that is already at its format copy limit in the Submitted Decklist (${metrics.detectedFormat === 'commander' || metrics.detectedFormat === 'brawl' ? '1 copy max per non-basic card in Commander/Brawl' : metrics.detectedFormat === 'vintage' ? '4 copies max per non-basic card, or 1 copy max for Vintage Restricted cards across Main + Sideboard' : metrics.detectedFormat === 'limited' ? 'avoid duplicate non-basic staples' : '4 copies max per non-basic card across Main + Sideboard'}), and NEVER suggest the same non-basic card twice across swaps, additions, and landChanges.
4. Write all reasons in clear, approachable, plain English so even a newer MTG player immediately understands why a card comes out and why the replacement goes in.`;

  const systemInstruction =
    'You are an expert Magic: The Gathering deck doctor and mana base mathematician. Output ONLY valid JSON with keys: deckName, archetype, verdictHeadline, verdictSummary, topPriorities (array of 3 strings), manaPlan ({verdict, headline, plainExplanation, tappedLandsWarning, colorIssues, landChanges}), swaps, cuts, additions.';

  let parsed: RawGeminiAnalysis | null = null;

  if (shouldUseLocalGguf()) {
    const modelLabel = getActiveLocalModelLabel() || 'Local GGUF';
    const modelInfo = getActiveLocalModelInfo();

    const LOCAL_ANALYSIS_SCHEMA: Record<string, unknown> = {
      type: 'object',
      properties: {
        deckName: { type: 'string' },
        archetype: { type: 'string' },
        verdictHeadline: { type: 'string' },
        verdictSummary: { type: 'string' },
        topPriorities: {
          type: 'array',
          maxItems: 3,
          items: { type: 'string' },
        },
        manaPlan: {
          type: 'object',
          properties: {
            verdict: { enum: ['solid', 'needs-tuning', 'critical'] },
            headline: { type: 'string' },
            plainExplanation: { type: 'string' },
            tappedLandsWarning: { type: 'string' },
            colorIssues: { type: 'array', maxItems: 4, items: { type: 'string' } },
            landChanges: {
              type: 'array',
              maxItems: 6,
              items: {
                type: 'object',
                properties: {
                  action: { enum: ['add', 'cut', 'swap'] },
                  cardName: { type: 'string' },
                  replaceCardName: { type: 'string' },
                  quantity: { type: 'integer' },
                  reason: { type: 'string' },
                },
              },
            },
          },
        },
        swaps: {
          type: 'array',
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              cutCardName: { type: 'string' },
              addCardName: { type: 'string' },
              reason: { type: 'string' },
              category: { type: 'string' },
              priority: { enum: ['high', 'medium', 'low'] },
            },
          },
        },
        cuts: {
          type: 'array',
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              cardName: { type: 'string' },
              quantity: { type: 'integer' },
              reason: { type: 'string' },
              category: { type: 'string' },
              priority: { enum: ['high', 'medium', 'low'] },
            },
          },
        },
        additions: {
          type: 'array',
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              cardName: { type: 'string' },
              quantity: { type: 'integer' },
              role: { type: 'string' },
              reason: { type: 'string' },
              priority: { enum: ['high', 'medium', 'low'] },
            },
          },
        },
      },
    };

    try {
      // Compact card roster sized safely for 4k-6k local GGUF context windows
      const tappedLandNames = mainCards
        .filter((c) => c.card?.isLand && c.card?.entersTappedLikely)
        .slice(0, 10)
        .map((c) => c.name);
      const cutCandidates = mainCards
        .filter((c) => c.zone === 'main' && !c.card?.isLand)
        .sort((a, b) => (b.card?.cmc ?? 0) - (a.card?.cmc ?? 0))
        .slice(0, 22)
        .map((c) => `${c.quantity}x ${c.name} (MV ${c.card?.cmc ?? '?'})`);
      const coreLowCurve = mainCards
        .filter((c) => c.zone === 'main' && !c.card?.isLand && (c.card?.cmc ?? 0) <= 3)
        .slice(0, 20)
        .map((c) => c.name);

      const compactLocalPrompt = `/no_think
Analyze this MTG deck and output strict JSON matching the schema.
Deck: "${deckName || 'Untitled Deck'}" | Format: ${metrics.detectedFormat} (Target ${metrics.targetDeckSize}, Current ${metrics.currentMainAndCommanderCount}, Delta ${metrics.deckSizeDelta})
Bracket Goal: ${goal} — ${goalInstructions[goal]}
Commanders: ${metrics.commanderNames.join(', ') || 'None'}
STRICT ALLOWED COLORS: ${allowedColors.join(', ') || 'Colorless'} | FORBIDDEN COLORS: ${forbiddenColors.join(', ') || 'None'}
Counts: Lands ${metrics.currentLands}/${metrics.recommendedLands} (${metrics.tappedLandCount} tapped), Ramp ${metrics.currentRamp}/${metrics.recommendedRamp}, Draw ${metrics.currentDraw}/${metrics.recommendedDraw}, Removal ${metrics.currentRemoval}/${metrics.recommendedRemoval}, Wipes ${metrics.currentBoardWipes}, Avg MV ${metrics.averageCmcNonLand}
Colors: ${colorSummary || 'Colorless'}
Tapped Lands in Deck: [${tappedLandNames.join(', ') || 'None'}]
High-MV / Cut Candidates in Deck: [${cutCandidates.join(', ')}]
Low-Curve / Synergy Pieces: [${coreLowCurve.join(', ')}]

RULES:
1. cutCardName / cuts[].cardName / replaceCardName MUST be spelled identically to cards listed above.
2. NEVER recommend any card or land with forbidden colors (${forbiddenColors.join(', ') || 'none'}).
3. NEVER suggest a non-basic card already in the deck at its format cap (${metrics.detectedFormat === 'commander' || metrics.detectedFormat === 'brawl' ? '1 copy' : '4 copies'}), and NEVER repeat the same non-basic addition across swaps, additions, and landChanges.
4. Suggest 4-5 swaps, ${metrics.landsDelta > 0 ? `${metrics.landsDelta} land/mana fixes` : 'top mana refinements'}, and cuts/additions to match ${metrics.targetDeckSize} cards cleanly (use "" for optional unused string fields).`;

      parsed = await generateJsonWithLocalGguf<RawGeminiAnalysis>({
        systemInstruction,
        prompt: compactLocalPrompt,
        maxTokens: 1200,
        temperature: 0.25,
        jsonSchema: LOCAL_ANALYSIS_SCHEMA,
        schemaCacheKey: 'deck-analysis-v1',
        disableThinking: true,
        timeoutMs: modelInfo.tier === '27b' && modelInfo.isCpuOnly ? 120000 : 70000,
        onProgress: ({ phase, charsGenerated, estimatedMaxChars }) => {
          if (phase === 'loading') {
            onProgress?.(50, `Loading ${modelLabel} into memory...`);
          } else {
            const ratio = Math.min(1, charsGenerated / Math.max(600, estimatedMaxChars * 0.65));
            const pct = Math.min(84, Math.round(54 + ratio * 30));
            onProgress?.(
              pct,
              `Evaluating deck & cuts with ${modelLabel}...`,
              charsGenerated > 0 ? `${charsGenerated.toLocaleString()} chars generated` : undefined
            );
          }
        },
      });
    } catch (localErr) {
      console.warn('[Analyzer] Local GGUF inference failed, falling back to deterministic engine:', localErr);
      if (!shouldUseCloudGemini()) {
        return runDeterministicAnalysis();
      }
    }
  }

  if (!parsed) {
    if (!shouldUseCloudGemini()) {
      return runDeterministicAnalysis();
    }
    onProgress?.(54, 'Analyzing synergies, cuts & replacements with AI...');
    const ai = getGeminiClient();
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: ANALYSIS_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        },
      })
    );

    const rawText = (response.text ?? '{}').trim();
    parsed = JSON.parse(rawText) as RawGeminiAnalysis;
  }

  onProgress?.(86, 'Verifying suggested cards & color identity on Scryfall...');

  // Build lookup of submitted card names (normalized + DFC front-face fallback) to validate cuts & caps
  const submittedNameMap = new Map<string, ResolvedDeckCard>();
  const availableToCut = new Map<string, number>();
  const projectedCounts = new Map<string, number>();

  for (const c of mainCards) {
    const key = normalizeDeckCardKey(c.name);
    if (!key) continue;
    if (!submittedNameMap.has(key)) {
      submittedNameMap.set(key, c);
    }
    addMapCardCount(projectedCounts, c.name, c.quantity);
    if (c.zone !== 'commander') {
      addMapCardCount(availableToCut, c.name, c.quantity);
    }
  }

  const asCleanString = (val: unknown): string =>
    typeof val === 'string' ? val.trim() : '';
  const asArray = <T>(val: unknown): T[] => (Array.isArray(val) ? (val as T[]) : []);

  const findSubmittedCard = (name: unknown): ResolvedDeckCard | undefined => {
    const clean = asCleanString(name);
    if (!clean) return undefined;
    const matchedKey = findMatchingCardMapKey(submittedNameMap, clean);
    return matchedKey ? submittedNameMap.get(matchedKey) : undefined;
  };

  const rawSwaps = asArray<NonNullable<RawGeminiAnalysis['swaps']>[number]>(parsed.swaps);
  const rawCuts = asArray<NonNullable<RawGeminiAnalysis['cuts']>[number]>(parsed.cuts);
  const rawAdditions = asArray<NonNullable<RawGeminiAnalysis['additions']>[number]>(parsed.additions);
  const rawLandChanges = asArray<NonNullable<NonNullable<RawGeminiAnalysis['manaPlan']>['landChanges']>[number]>(
    parsed.manaPlan?.landChanges
  );

  // Collect all newly suggested card names to resolve via Scryfall
  const suggestedNames: string[] = [];
  for (const s of rawSwaps) {
    const addName = asCleanString(s?.addCardName);
    if (addName) suggestedNames.push(addName);
  }
  for (const a of rawAdditions) {
    const addName = asCleanString(a?.cardName);
    if (addName) suggestedNames.push(addName);
  }
  for (const lc of rawLandChanges) {
    if (lc?.action === 'add') {
      const landName = asCleanString(lc.cardName);
      if (landName) suggestedNames.push(landName);
    }
  }

  const resolvedSuggestedMap = await resolveCardNamesWithScryfall(
    suggestedNames,
    metrics.detectedFormat
  );
  const normSuggestedMap = new Map<string, CardMetadata>();
  for (const [k, meta] of resolvedSuggestedMap.entries()) {
    const nk = normalizeDeckCardKey(k);
    if (nk && !normSuggestedMap.has(nk)) normSuggestedMap.set(nk, meta);
    if (meta?.name) {
      const mk = normalizeDeckCardKey(meta.name);
      if (mk && !normSuggestedMap.has(mk)) normSuggestedMap.set(mk, meta);
    }
  }
  onProgress?.(95, 'Finalizing mana plan & export decklist...');

  const lookupMeta = (name: unknown): CardMetadata | null => {
    const clean = asCleanString(name);
    if (!clean) return null;
    const normKey = findMatchingCardMapKey(normSuggestedMap, clean);
    if (normKey) return normSuggestedMap.get(normKey) || null;
    return findSubmittedCard(clean)?.card || null;
  };

  const computeAddHeadroom = (
    cardName: string,
    meta: CardMetadata | null,
    requestedQty: number
  ): number => {
    const maxCopies = getMaxCopiesForCard(cardName, metrics.detectedFormat, meta);
    const currentProjected = getMapCardCount(projectedCounts, cardName);
    if (!Number.isFinite(maxCopies)) {
      if (metrics.detectedFormat === 'limited' && !isBasicLandCard(cardName, meta)) {
        return Math.max(0, Math.min(requestedQty, 2 - currentProjected));
      }
      return requestedQty;
    }
    return Math.max(0, Math.min(requestedQty, maxCopies - currentProjected));
  };

  // Build validated swaps (strictly rejecting off-color, illegal, self-swaps, and over-limit duplicates)
  const swaps: CardSwapRecommendation[] = [];
  rawSwaps.forEach((s, idx) => {
    const cutName = asCleanString(s?.cutCardName);
    const addName = asCleanString(s?.addCardName);
    if (!cutName || !addName) return;
    const existing = findSubmittedCard(cutName);
    if (!existing || existing.zone === 'commander') return;

    const cutAvail = getMapCardCount(availableToCut, existing.name);
    if (cutAvail <= 0) return;

    const addMeta = lookupMeta(addName);
    if (!isCardAllowedInDeckColors(addMeta)) return;
    if (addMeta && addMeta.legalInFormat === false) return;

    const finalAddName = addMeta ? addMeta.name : addName;
    if (isSameCardName(existing.name, finalAddName)) return;

    const requestedQty = Math.max(1, Math.round(Number(s.quantity) || 1));
    const addHeadroom = computeAddHeadroom(finalAddName, addMeta, requestedQty);
    const effectiveQty = Math.min(requestedQty, cutAvail, addHeadroom);
    if (effectiveQty <= 0) return;

    addMapCardCount(availableToCut, existing.name, -effectiveQty);
    addMapCardCount(projectedCounts, existing.name, -effectiveQty);
    addMapCardCount(projectedCounts, finalAddName, effectiveQty);

    swaps.push({
      id: `swap-${idx}`,
      cutCardName: existing.name,
      addCardName: finalAddName,
      quantity: effectiveQty,
      role: asCleanString(s.role) || 'Upgrade',
      cutReason: asCleanString(s.cutReason),
      addReason: asCleanString(s.addReason),
      priority: s.priority || 'medium',
      cutCardMeta: existing.card,
      addCardMeta: addMeta,
    });
  });

  // Build validated standalone cuts
  const cuts: CardCutRecommendation[] = [];
  rawCuts.forEach((c, idx) => {
    const cardName = asCleanString(c?.cardName);
    if (!cardName) return;
    const existing = findSubmittedCard(cardName);
    if (!existing || existing.zone === 'commander') return;

    const cutAvail = getMapCardCount(availableToCut, existing.name);
    if (cutAvail <= 0) return;

    const requestedQty = Math.max(1, Math.round(Number(c.quantity) || 1));
    const effectiveQty = Math.min(requestedQty, cutAvail);
    if (effectiveQty <= 0) return;

    addMapCardCount(availableToCut, existing.name, -effectiveQty);
    addMapCardCount(projectedCounts, existing.name, -effectiveQty);

    cuts.push({
      id: `cut-${idx}`,
      cardName: existing.name,
      quantity: effectiveQty,
      reason: asCleanString(c.reason),
      category: c.category || 'off-plan',
      priority: c.priority || 'medium',
      cardMeta: existing.card,
    });
  });

  // Build validated land plan changes (enforcing color identity, legality & format copy limits)
  const landChanges: LandPlanItem[] = [];
  rawLandChanges.forEach((lc, idx) => {
    const cardName = asCleanString(lc?.cardName);
    if (!cardName) return;
    const requestedQty = Math.max(1, Math.round(Number(lc.quantity) || 1));

    if (lc.action === 'cut') {
      const existing = findSubmittedCard(cardName);
      if (!existing || existing.zone === 'commander') return;
      const cutAvail = getMapCardCount(availableToCut, existing.name);
      const effectiveQty = Math.min(requestedQty, cutAvail);
      if (effectiveQty <= 0) return;

      addMapCardCount(availableToCut, existing.name, -effectiveQty);
      addMapCardCount(projectedCounts, existing.name, -effectiveQty);

      landChanges.push({
        id: `land-cut-${idx}`,
        action: 'cut',
        cardName: existing.name,
        quantity: effectiveQty,
        reason: asCleanString(lc.reason),
        cardMeta: existing.card,
      });
    } else {
      const meta = lookupMeta(cardName);
      if (!isCardAllowedInDeckColors(meta)) return;
      if (meta && meta.legalInFormat === false) return;

      const finalName = meta ? meta.name : cardName;
      const addHeadroom = computeAddHeadroom(finalName, meta, requestedQty);
      if (addHeadroom <= 0) return;

      addMapCardCount(projectedCounts, finalName, addHeadroom);

      landChanges.push({
        id: `land-add-${idx}`,
        action: 'add',
        cardName: finalName,
        quantity: addHeadroom,
        reason: asCleanString(lc.reason),
        cardMeta: meta,
      });
    }
  });

  // Build validated additions (strictly rejecting off-color, illegal, and duplicate/over-limit additions)
  const additions: CardAddRecommendation[] = [];
  rawAdditions.forEach((a, idx) => {
    const cardName = asCleanString(a?.cardName);
    if (!cardName) return;
    const meta = lookupMeta(cardName);
    if (!isCardAllowedInDeckColors(meta)) return;
    if (meta && meta.legalInFormat === false) return;

    const finalName = meta ? meta.name : cardName;
    const requestedQty = Math.max(1, Math.round(Number(a.quantity) || 1));
    const addHeadroom = computeAddHeadroom(finalName, meta, requestedQty);
    if (addHeadroom <= 0) return;

    addMapCardCount(projectedCounts, finalName, addHeadroom);

    additions.push({
      id: `add-${idx}`,
      cardName: finalName,
      quantity: addHeadroom,
      role: (asCleanString(a.role) || 'Synergy') as CardAddRecommendation['role'],
      reason: asCleanString(a.reason),
      priority: a.priority || 'medium',
      cardMeta: meta,
    });
  });

  // Strictly reconcile swaps, cuts, additions, and landChanges so resulting deck ALWAYS hits targetDeckSize and never goes over
  const reconciled = reconcileAnalysisRecommendationsToTargetSize({
    resolvedCards,
    metrics,
    swaps,
    cuts,
    additions,
    landChanges,
    lookupMeta,
  });

  // Resolve Scryfall metadata for any basic lands or cards added during reconciliation
  const missingReconciledNames = Array.from(
    new Set([
      ...reconciled.landChanges
        .filter((lc) => lc.action === 'add' && !lc.cardMeta)
        .map((lc) => lc.cardName),
      ...reconciled.additions
        .filter((a) => !a.cardMeta)
        .map((a) => a.cardName),
    ])
  );
  if (missingReconciledNames.length > 0) {
    try {
      const extraMetaMap = await resolveCardNamesWithScryfall(
        missingReconciledNames,
        metrics.detectedFormat
      );
      const findExtra = (name: string): CardMetadata | null => {
        const key = normalizeDeckCardKey(name);
        for (const [k, v] of extraMetaMap.entries()) {
          if (normalizeDeckCardKey(k) === key || normalizeDeckCardKey(v.name) === key) {
            return v;
          }
        }
        return null;
      };
      for (const lc of reconciled.landChanges) {
        if (lc.action === 'add' && !lc.cardMeta) {
          lc.cardMeta = findExtra(lc.cardName);
        }
      }
      for (const add of reconciled.additions) {
        if (!add.cardMeta) {
          add.cardMeta = findExtra(add.cardName);
        }
      }
    } catch {
      // Non-fatal if Scryfall is rate-limited
    }
  }

  const manaPlan: ManaPlanSummary = {
    verdict: parsed.manaPlan?.verdict || (metrics.landsDelta > 0 ? 'missing-lands' : 'balanced'),
    headline: asCleanString(parsed.manaPlan?.headline) || 'Mana Base Assessment',
    plainExplanation:
      asCleanString(parsed.manaPlan?.plainExplanation) ||
      `Your deck currently has ${metrics.currentLands} lands. Recommended target is ${metrics.recommendedLands} lands.`,
    currentLands: metrics.currentLands,
    recommendedLands: metrics.recommendedLands,
    landsMissingOrExcess: metrics.landsDelta,
    currentRamp: metrics.currentRamp,
    recommendedRamp: metrics.recommendedRamp,
    rampMissing: metrics.rampDelta,
    tappedLandsWarning: asCleanString(parsed.manaPlan?.tappedLandsWarning) || null,
    colorIssues: asArray<string>(parsed.manaPlan?.colorIssues),
    landChanges: reconciled.landChanges,
  };

  return {
    deckName: asCleanString(deckName) || asCleanString(parsed.deckName) || 'Analyzed Deck',
    sourceFormat,
    goal,
    archetype: asCleanString(parsed.archetype) || `${metrics.detectedFormat} Deck`,
    verdictHeadline: asCleanString(parsed.verdictHeadline) || 'Deck Analysis Complete',
    verdictSummary: asCleanString(parsed.verdictSummary),
    topPriorities: Array.isArray(parsed.topPriorities) ? parsed.topPriorities.slice(0, 4) : [],
    metrics,
    manaPlan,
    swaps: reconciled.swaps,
    cuts: reconciled.cuts,
    additions: reconciled.additions,
    resolvedCards,
  };
}
