/**
 * Phase 0: Security Rules Verification Spec for /userProfiles, /userDecks, and /botMemory
 * Verifies all 12 Dirty Dozen payloads are rejected with PERMISSION_DENIED.
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: {
    uid: string;
    email_verified: boolean;
    sign_in_provider?: string;
  } | null;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

const VALID_BASE_DECK_PAYLOAD = {
  ownerId: 'user_1',
  deckName: 'Atraxa Superfriends',
  label: 'Original Import · 37 Lands',
  format: 'commander',
  goal: 'bracket-3',
  originalDeckText: "1 Atraxa, Praetors' Voice\n1 Command Tower",
  exportedDeckText: "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Command Tower",
  exportedCsvText: 'Count,Name,Section\n1,"Atraxa, Praetors\' Voice",commander',
  resultingLandCount: 37,
  totalMainCount: 100,
  averageCmcNonLand: 3.12,
  tappedLandCount: 4,
  activeColorSummary: 'W:18 · U:20 · B:17 · G:19',
  activeChangeCount: 5,
  verdictHeadline: 'Mana base is well balanced',
  verdictSummary: 'Sufficient color sources across all four colors.',
  archetype: 'Midrange / Superfriends',
  commanderName: "Atraxa, Praetors' Voice",
  isAutoSaved: false,
  createdAt: 'REQUEST_TIME',
  updatedAt: 'REQUEST_TIME',
};

const VALID_BOT_MEMORY_PAYLOAD = {
  ownerId: 'user_1',
  botKey: 'bot-1-vex__mono-red-aggro-burn',
  botName: 'Bot 1 (Vex)',
  archetype: 'Mono-Red Aggro / Burn',
  matchesPlayed: 3,
  wins: 2,
  losses: 1,
  closes: 0,
  botIqScore: 135,
  lastDeckFaced: 'Atraxa Superfriends',
  lastOwnDeckSummary: 'Mono-Red Aggro / Burn',
  learnedFromFacedDecks: ['Save burn spells for Atraxa or planeswalkers before proliferate triggers.'],
  learnedFromOwnDecks: ['Keep 2+ mountain opening hands with early haste threats.'],
  userFeedbackNotes: ['Good aggression on turn 3.'],
  tacticalDirectives: ['Hold Lightning Bolt for early mana dorks or Commander.'],
  createdAt: 'REQUEST_TIME',
  updatedAt: 'REQUEST_TIME',
};

export const DIRTY_DOZEN_TEST_CASES: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Create',
    operation: 'create',
    path: '/userDecks/deck_1',
    auth: null,
    payload: VALID_BASE_DECK_PAYLOAD,
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Create',
    operation: 'create',
    path: '/userDecks/deck_1',
    auth: { uid: 'user_1', email_verified: false, sign_in_provider: 'google.com' },
    payload: VALID_BASE_DECK_PAYLOAD,
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Non-Google Provider Read Spoof',
    operation: 'get',
    path: '/userProfiles/user_1',
    auth: { uid: 'user_1', email_verified: true, sign_in_provider: 'anonymous' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Identity Spoofing on Create (ownerId != auth.uid)',
    operation: 'create',
    path: '/userDecks/deck_1',
    auth: { uid: 'user_1', email_verified: true, sign_in_provider: 'google.com' },
    payload: { ...VALID_BASE_DECK_PAYLOAD, ownerId: 'user_2' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow / Ghost Field Injection',
    operation: 'create',
    path: '/userDecks/deck_1',
    auth: { uid: 'user_1', email_verified: true, sign_in_provider: 'google.com' },
    payload: { ...VALID_BASE_DECK_PAYLOAD, isVerifiedAdmin: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Path ID Poisoning (Invalid Characters)',
    operation: 'create',
    path: '/userDecks/invalid$id!with*spaces',
    auth: { uid: 'user_1', email_verified: true, sign_in_provider: 'google.com' },
    payload: VALID_BASE_DECK_PAYLOAD,
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Denial-of-Wallet Oversized Deck Name (> 120 chars)',
    operation: 'create',
    path: '/userDecks/deck_1',
    auth: { uid: 'user_1', email_verified: true, sign_in_provider: 'google.com' },
    payload: { ...VALID_BASE_DECK_PAYLOAD, deckName: 'A'.repeat(125) },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Invalid Enum Injection on Format',
    operation: 'create',
    path: '/userDecks/deck_1',
    auth: { uid: 'user_1', email_verified: true, sign_in_provider: 'google.com' },
    payload: { ...VALID_BASE_DECK_PAYLOAD, format: 'custom-unrestricted' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Cross-User Read (get)',
    operation: 'get',
    path: '/userDecks/deck_owned_by_user_1',
    auth: { uid: 'user_2', email_verified: true, sign_in_provider: 'google.com' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Cross-User List Scraping (resource.data.ownerId != auth.uid)',
    operation: 'list',
    path: '/botMemory',
    auth: { uid: 'user_2', email_verified: true, sign_in_provider: 'google.com' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Timestamp Forgery (createdAt != request.time)',
    operation: 'create',
    path: '/userDecks/deck_1',
    auth: { uid: 'user_1', email_verified: true, sign_in_provider: 'google.com' },
    payload: { ...VALID_BASE_DECK_PAYLOAD, createdAt: '1999-01-01T00:00:00Z' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'BotMemory Array Exhaustion / Element Type Poisoning',
    operation: 'create',
    path: '/botMemory/user_1_bot_1',
    auth: { uid: 'user_1', email_verified: true, sign_in_provider: 'google.com' },
    payload: { ...VALID_BOT_MEMORY_PAYLOAD, learnedFromFacedDecks: [12345] },
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
