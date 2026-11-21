export type DeckZone = 'main' | 'commander' | 'sideboard' | 'companion' | 'maybeboard';

export type DeckFormat =
  | 'auto'
  | 'commander'
  | 'standard'
  | 'modern'
  | 'pioneer'
  | 'pauper'
  | 'legacy'
  | 'vintage'
  | 'brawl'
  | 'limited'
  | 'casual60';

export type DeckGoal =
  | 'bracket-1'
  | 'bracket-2'
  | 'bracket-3'
  | 'bracket-4'
  | 'bracket-5';

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

export interface ParsedCardEntry {
  name: string;
  quantity: number;
  zone: DeckZone;
  setCode?: string;
  collectorNumber?: string;
  categoryTag?: string;
}

export interface ParsedDeckResult {
  sourceFormat: string;
  deckName?: string;
  cards: ParsedCardEntry[];
  warnings: string[];
}

export interface CardMetadata {
  name: string;
  manaCost: string;
  cmc: number;
  typeLine: string;
  oracleText: string;
  colors: string[];
  colorIdentity: string[];
  producedMana: string[];
  isLand: boolean;
  isMdfcLand: boolean;
  entersTappedLikely: boolean;
  isRamp: boolean;
  isDraw: boolean;
  isRemoval: boolean;
  isBoardWipe: boolean;
  isProtection: boolean;
  power?: string;
  toughness?: string;
  imageUri: string;
  backImageUri?: string;
  priceUsd: number | null;
  priceFoilUsd?: number | null;
  priceEur?: number | null;
  priceTix?: number | null;
  cardKingdomPriceUsd?: number | null;
  cardKingdomUrl?: string;
  tcgplayerUrl?: string;
  cardmarketUrl?: string;
  cardhoarderUrl?: string;
  ebayUrl?: string;
  setCode?: string;
  setName?: string;
  collectorNumber?: string;
  scryfallUri: string;
  legalInFormat: boolean;
  rarity: string;
}

export interface CardPrinting {
  scryfallId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  releasedAt: string;
  rarity: string;
  imageUri: string;
  backImageUri?: string;
  scryfallUri: string;
  prices: {
    tcgplayerUsd: number | null;
    tcgplayerFoilUsd: number | null;
    tcgplayerEtchedUsd: number | null;
    cardKingdomUsd: number | null;
    cardKingdomFoilUsd: number | null;
    cardKingdomBuyUsd: number | null;
    cardKingdomQty: number | null;
    cardmarketEur: number | null;
    cardmarketFoilEur: number | null;
    cardhoarderTix: number | null;
  };
  urls: {
    tcgplayer: string;
    cardKingdom: string;
    ebayListings: string;
    ebaySold: string;
    cardmarket: string;
    cardhoarder: string;
  };
}

export interface CardPrintingsResponse {
  cardName: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  cmc: number;
  totalPrintings: number;
  printings: CardPrinting[];
}

export interface ResolvedDeckCard extends ParsedCardEntry {
  card: CardMetadata | null;
  notFound?: boolean;
}

export interface ColorBreakdownItem {
  color: ManaColor;
  label: string;
  pips: number;
  pipSharePct: number;
  currentSources: number;
  recommendedSources: number;
  deltaSources: number;
  status: 'ok' | 'low' | 'critical' | 'unused';
}

export interface CurveBucket {
  cmcLabel: string;
  cmc: number;
  currentCount: number;
}

export interface DeckMetrics {
  detectedFormat: Exclude<DeckFormat, 'auto'>;
  targetDeckSize: number;
  currentMainAndCommanderCount: number;
  sideboardCount: number;
  deckSizeDelta: number; // positive = missing cards, negative = over limit
  commanderNames: string[];
  commanderColorIdentity: string[];
  currentLands: number;
  mdfcLandCount: number;
  tappedLandCount: number;
  recommendedLands: number;
  landsDelta: number; // positive = missing lands, negative = too many lands
  recommendedRamp: number;
  currentRamp: number;
  rampDelta: number;
  currentDraw: number;
  recommendedDraw: number;
  currentRemoval: number;
  recommendedRemoval: number;
  currentBoardWipes: number;
  averageCmcNonLand: number;
  averageCmcWithLands: number;
  curve: CurveBucket[];
  colorBreakdown: ColorBreakdownItem[];
  formatViolations: string[];
  singletonViolations: string[];
  colorIdentityViolations: string[];
  unresolvedCards: string[];
}

export interface CardCutRecommendation {
  id: string;
  cardName: string;
  quantity: number;
  reason: string;
  category: 'land' | 'off-plan' | 'overcosted' | 'outclassed' | 'illegal' | 'excess';
  priority: 'high' | 'medium' | 'low';
  cardMeta?: CardMetadata | null;
}

export interface CardAddRecommendation {
  id: string;
  cardName: string;
  quantity: number;
  role: 'Land' | 'Mana Ramp' | 'Card Draw' | 'Removal' | 'Board Wipe' | 'Protection' | 'Synergy' | 'Finisher';
  reason: string;
  priority: 'high' | 'medium' | 'low';
  cardMeta?: CardMetadata | null;
}

export interface CardSwapRecommendation {
  id: string;
  cutCardName: string;
  addCardName: string;
  quantity: number;
  role: string;
  cutReason: string;
  addReason: string;
  priority: 'high' | 'medium' | 'low';
  cutCardMeta?: CardMetadata | null;
  addCardMeta?: CardMetadata | null;
}

export interface LandPlanItem {
  id: string;
  action: 'add' | 'cut';
  cardName: string;
  quantity: number;
  reason: string;
  cardMeta?: CardMetadata | null;
}

export interface ManaPlanSummary {
  verdict: 'missing-lands' | 'missing-colors' | 'too-many-lands' | 'slow-manabase' | 'balanced';
  headline: string;
  plainExplanation: string;
  currentLands: number;
  recommendedLands: number;
  landsMissingOrExcess: number; // + = missing, - = excess
  currentRamp: number;
  recommendedRamp: number;
  rampMissing: number;
  tappedLandsWarning: string | null;
  colorIssues: string[];
  landChanges: LandPlanItem[];
}

export interface DeckAnalysisResult {
  deckName: string;
  sourceFormat: string;
  goal?: DeckGoal;
  archetype: string;
  verdictHeadline: string;
  verdictSummary: string;
  topPriorities: string[];
  metrics: DeckMetrics;
  manaPlan: ManaPlanSummary;
  swaps: CardSwapRecommendation[];
  cuts: CardCutRecommendation[];
  additions: CardAddRecommendation[];
  resolvedCards: ResolvedDeckCard[];
}

export type PlaytestMode = '1v1' | '1v2' | '1v3';

export type PlaytestDeckVersion = 'original' | 'mana-optimized' | 'full-optimized';

export type BotIndignanceLevel = 'forgiving' | 'measured' | 'ruthless' | 'vindictive';

export interface BotOpponentConfig {
  id: string;
  name: string;
  archetype: string;
  indignance?: BotIndignanceLevel;
  customDeckText?: string;
}

export interface RoundDeckChange {
  action: 'cut' | 'add' | 'swap';
  cutCardName?: string;
  addCardName?: string;
  reason: string;
  urgency: 'critical' | 'recommended';
}

export type WinConditionType =
  | 'life'
  | 'poison'
  | 'commander'
  | 'mill'
  | 'points-lead';

export interface CommanderDamageEntry {
  sourceName: string;
  totalDamage: number;
  delta: number;
}

export interface PlayerRoundCombatStats {
  player: string;
  life: number;
  lifeDelta: number;
  poisonCounters: number;
  poisonDelta: number;
  commanderDamageTaken: CommanderDamageEntry[];
  maxCommanderDamage: number;
  libraryRemaining: number;
  cardsMilledTotal: number;
  cardsMilledThisRound: number;
  graveyardCount: number;
  handSize: number;
  landsInPlay: number;
  manaAvailable: number;
  creaturesInPlay: number;
  extraCountersLabel?: string;
  eliminatedBy?: 'life' | 'poison' | 'commander' | 'mill' | null;
}

export interface PlaytestBotPlay {
  botName: string;
  archetype: string;
  indignance?: BotIndignanceLevel;
  action: string;
  boardThreat: string;
  commanderName?: string;
  targetParticipant?: string;
  lifeChangeToYou?: number;
  poisonToYou?: number;
  commanderDamageToYou?: number;
  millToYou?: number;
  targetLifeDelta?: number;
  targetPoisonDelta?: number;
  targetCommanderDamage?: number;
  targetMillAmount?: number;
  eachOpponentLifeDelta?: number;
  eachOpponentPoison?: number;
  eachOpponentMill?: number;
  creaturesRemovedOnTarget?: number;
  boardWipeCast?: boolean;
  selfLifeGain?: number;
  selfLifeLoss?: number;
  eliminatedThisTurn?: boolean;
  damageTakenFromYou?: number;
  poisonTakenFromYou?: number;
  commanderDamageTakenFromYou?: number;
  millTakenFromYou?: number;
  cardsMilledThisTurn?: number;
  creaturesOnBoard?: number;
  landsInPlay?: number;
  manaAvailable?: number;
  handSize?: number;
  appliedPastMemory?: string;
}

export interface PlaytestLifeEntry {
  player: string;
  life: number;
}

export interface PlayerRoundActionStats {
  targetBot?: string;
  combatDamageDealt: number;
  commanderDamageDealt: number;
  poisonDealt: number;
  millDealt: number;
  lifeGained: number;
  selfLifeLoss?: number;
  eachOpponentLifeDelta?: number;
  eachOpponentPoison?: number;
  eachOpponentMill?: number;
  cardsDrawnExtra: number;
  creaturesOnBoard: number;
}

export interface PlaytestRound {
  roundNumber: number;
  cardDrawn: string;
  landsInPlay: number;
  manaAvailable: number;
  libraryRemaining?: number;
  graveyardCount?: number;
  cardsMilledToYou?: number;
  handSnapshot: string[];
  playerAction: string;
  cardsPlayed: string[];
  playerStats?: PlayerRoundActionStats;
  botPlays: PlaytestBotPlay[];
  lifeTotals: PlaytestLifeEntry[];
  participantStats?: PlayerRoundCombatStats[];
  offTurnLifeDeltas?: Record<string, number>;
  manaOrTempoIssue: string;
  roundChanges: RoundDeckChange[];
}

export interface BotMatchLearningInsight {
  botName: string;
  lessonFromPlayerDeck: string;
  lessonFromOwnDeck: string;
  tacticalAdjustment: string;
  adaptationSummary: string;
  identifiedThreats?: string[];
  observedWeakness?: string;
  sourceEngine?: 'local-gguf' | 'cloud-gemini' | 'deterministic';
}

export interface BotMatchTelemetryRecord {
  dateIso: string;
  playerDeckName: string;
  mode: PlaytestMode;
  outcomeForBot: 'win' | 'loss' | 'close';
  winVector: WinConditionType;
  roundsPlayed: number;
  endingPlayerLife: number;
  endingBotLife: number;
  poisonInflictedToPlayer: number;
  maxCommanderDamageToPlayer: number;
  cardsMilledToPlayer: number;
  keyThreatsSeen: string[];
  playerManaStumbled: boolean;
  eliminatedBy?: 'life' | 'poison' | 'commander' | 'mill' | null;
  rivalsFaced?: string[];
  damageDealtToRivals?: number;
}

export interface BotLearningProfile {
  botKey: string;
  botName: string;
  archetype: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  closes: number;
  botIqScore: number;
  lastDeckFaced: string;
  lastOwnDeckSummary: string;
  learnedFromFacedDecks: string[];
  learnedFromOwnDecks: string[];
  userFeedbackNotes: string[];
  tacticalDirectives: string[];
  updatedAtIso: string;
  knownPlayerThreats?: string[];
  observedPlayerWeaknesses?: string[];
  winVectorStats?: {
    life: number;
    poison: number;
    commander: number;
    mill: number;
  };
  cumulativeStats?: {
    totalDamageDealt: number;
    totalPoisonDealt: number;
    totalCommanderDamageDealt: number;
    totalCardsMilled: number;
    totalGamesFinished: number;
  };
  recentMatchHistory?: BotMatchTelemetryRecord[];
}

export interface UserBotFeedbackInput {
  botKey: string;
  botName: string;
  archetype: string;
  rating: 'strong' | 'mistake' | 'needs-adjustment';
  quickTags: string[];
  customNote: string;
}

export interface PlaytestFinalStatsSummary {
  winCondition: WinConditionType;
  winningPlayer: string;
  roundsPlayed: number;
  participants: PlayerRoundCombatStats[];
}

export interface PlaytestResult {
  mode: PlaytestMode;
  testedListLabel: string;
  startingLife: number;
  outcome: 'win' | 'loss' | 'close';
  totalRounds: number;
  matchSummary: string;
  openingHand: string[];
  mulliganVerdict: string;
  aiEngineUsed?: 'local-gguf' | 'cloud-gemini' | 'deterministic';
  aiModelLabel?: string;
  ggufLearningApplied?: boolean;
  opponentsUsed?: Array<{
    name: string;
    archetype: string;
    indignance: BotIndignanceLevel;
  }>;
  rounds: PlaytestRound[];
  keyTakeaways: RoundDeckChange[];
  botLearnings?: BotMatchLearningInsight[];
  finalStats?: PlaytestFinalStatsSummary;
}

export interface LiveSimulationExportStats {
  mode: PlaytestMode;
  testedListLabel: string;
  liveBotMode: boolean;
  turn: number;
  activePhase: string;
  turnsPassed: number;
  cardsDrawn: number;
  avgTurnDurationMs: number;
  totalTurnTimeMs: number;
  turnsTimed: number;
  outcome: 'victory' | 'defeat' | 'manual-end' | 'in-progress';
  startingLife: number;
  yourLife: number;
  yourPoison: number;
  landsInPlay: number;
  creaturesInPlay: number;
  handSize: number;
  libraryRemaining: number;
  opponents: Array<{
    name: string;
    archetype: string;
    life: number;
    eliminated?: boolean;
  }>;
}

export interface DeckExportSimulationStats {
  botMatchResult?: PlaytestResult | null;
  liveSessionStats?: LiveSimulationExportStats | null;
}

export interface DeckSelectionState {
  swapIds: string[];
  cutIds: string[];
  addIds: string[];
  landChangeIds: string[];
}

export interface DeckVersionSnapshot {
  id: string;
  label: string;
  createdAt: string;
  isAutoSaved?: boolean;
  deckName: string;
  format: DeckFormat;
  goal: DeckGoal;
  originalDeckText: string;
  resultingDeckText: string;
  resultingLandCount: number;
  totalMainCount: number;
  averageCmcNonLand: number;
  tappedLandCount: number;
  activeColorSummary: string;
  activeChangeCount: number;
  selection: DeckSelectionState;
  analysis: DeckAnalysisResult;
}
