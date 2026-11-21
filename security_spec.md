# Phase 0: Payload-First Security TDD Specification (`security_spec.md`)

## 1. Data Invariants
1. **Per-User Ownership & Zero Cross-User Sharing**: Every deck document in `/userDecks/{deckId}` and every adaptive bot profile in `/botMemory/{memoryId}` must have an `ownerId` strictly matching `request.auth.uid`. Every profile in `/userProfiles/{userId}` must match `userId == request.auth.uid` and `uid == request.auth.uid`. No user may read (`get` or `list`), create, update, or delete another user's documents.
2. **Verified Google Identity Guard (Reads & Writes)**: Every single read (`get`, `list`) and write (`create`, `update`, `delete`) across `/userProfiles/{userId}`, `/userDecks/{deckId}`, and `/botMemory/{memoryId}` strictly requires an authenticated user with `request.auth.token.email_verified == true` AND `request.auth.token.firebase.sign_in_provider == 'google.com'`.
3. **Strict Key & Schema Blueprint**: `isValidUserAccountProfile`, `isValidUserDeck`, and `isValidBotLearningMemory` enforce exact required keys (`hasAll` and `hasOnly`), strict string length boundaries matching `firebase-blueprint.json`, numeric ranges, bounded array limits (`<= 15` items with string element type check), and enum constraints on `format` and `goal`.
4. **Path Variable Hardening**: `isValidId(id)` (`id is string && id.size() >= 1 && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$')`) is enforced on all single-document operations (`get`, `create`, `update`, `delete`) and omitted on `list`.
5. **Temporal & Identity Immutability**: On `create`, `createdAt == request.time` and `updatedAt == request.time`. On `update`, `ownerId`/`uid == existing().ownerId`/`uid`, `createdAt == existing().createdAt`, and `updatedAt == request.time`.
6. **Action-Based Update Whitelisting**: Updates must pass `isValid[Entity](incoming())` and match one of the explicit action branches using `incoming().diff(existing()).affectedKeys().hasOnly(...)`.

## 2. The "Dirty Dozen" Payloads (All Must Return `PERMISSION_DENIED`)
1. **Unauthenticated Create**: `auth = null` attempting to create `/userDecks/deck-1`.
2. **Unverified Email Create**: `auth = { uid: 'user_1', token: { email_verified: false, firebase: { sign_in_provider: 'google.com' } } }` attempting to create `/userDecks/deck-1`.
3. **Non-Google Provider Spoof Read/Write**: `auth = { uid: 'user_1', token: { email_verified: true, firebase: { sign_in_provider: 'password' } } }` attempting `get` or `create` on `/userProfiles/user_1`.
4. **Identity Spoofing on Create**: `auth.uid = 'user_1'` creating a deck with `ownerId: 'user_2'`.
5. **Shadow / Ghost Field Injection**: Creating `/userDecks/deck-1` or `/botMemory/mem-1` with an extra unlisted key `isAdmin: true`.
6. **Path ID Poisoning**: Creating `/userDecks/invalid$id!with*spaces` or a 200-char ID.
7. **Denial-of-Wallet Oversized Deck Text**: Creating `/userDecks/deck-1` with `originalDeckText` > 25,000 characters or `deckName` > 120 characters.
8. **Invalid Enum Injection**: Creating `/userDecks/deck-1` with `format: 'vintage-hacked'` or `goal: 'infinite-power'`.
9. **Cross-User Read (`get`)**: `user_2` attempting `getDoc(doc(db, 'userDecks', 'deck_owned_by_user_1'))`.
10. **Cross-User Blanket List (`list`)**: `user_2` attempting to list `/userDecks` or `/botMemory` without filtering `where('ownerId', '==', 'user_2')`.
11. **Owner Transfer & Timestamp Forgery**: `user_1` updating `ownerId` from `'user_1'` to `'user_2'` or sending forged `createdAt`/`updatedAt`.
12. **Array Exhaustion / Element Type Poisoning on `/botMemory`**: `user_1` writing `learnedFromFacedDecks` with 20 entries (`> 15`) or inserting an integer `[123]` at index 0.
