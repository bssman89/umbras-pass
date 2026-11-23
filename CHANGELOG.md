# Changelog — Umbra's Pass

## [v1.1.0] — Version 1.1.0 (2026-11-22)
### Live Stack & Trigger Queue, Analysis Lock & Cancel Flow, WotC Comprehensive Rules Engine

### ⚡ New Features & Enhancements

#### 1. Real-Time Visual Stack & Trigger Resolution Queue (Live Playtest Arena)
- **LIFO Stack Resolution Tower (`CR 405`)**: Added an MTG Arena / MTGO-style visual Stack panel displaying every spell, triggered ability, and activated ability in strict Last-In, First-Out resolution order (`#1 NEXT UP / RESOLVES FIRST` at the top down to `#N LAST` at the bottom) with directional resolution flow connectors.
- **Smooth CSS Entry Animation**: Added GPU-accelerated slide-and-fade entry animations (`stackItemSlideIn` and `stackFlowSlideIn`) so newly cast spells and triggered abilities smoothly slide into view when pushed onto the Stack, while respecting `@media (prefers-reduced-motion: reduce)`.
- **Automatic Triggered Ability Detection (`CR 603`)**:
  - Automatically detects and pushes **ETB (Enters-the-Battlefield)**, **Landfall**, **On-Cast (`Whenever you cast...`)**, **Upkeep**, **Attack**, and **Dies / Graveyard** triggers from oracle text onto the Stack alongside spells.
  - Distinct color-coded badges differentiate **`SPELL`**, **`TRIGGERED ABILITY`**, and **`ACTIVATED ABILITY`** entries, complete with trigger condition clauses and resolution effect summaries.
- **Simultaneous Trigger Ordering (`CR 603.3b`)**: When multiple player-controlled triggered abilities are on the Stack simultaneously, players can reorder adjacent triggers with `↑` / `↓` controls to choose which resolves first.
- **Manual Trigger Builder & Resolution Controls**:
  - Added a **`+ Trigger Ability`** drawer to manually push ETB, Landfall, Attack, Upkeep, Dies, or Activated abilities from any battlefield permanent onto `#1 Top of Stack`.
  - Added step-by-step **`Resolve Top (#1)`** and **`Pass Priority (Resolve All)`** actions, plus a collapsible **Resolved Stack History** log even when the Stack is empty.

#### 2. Top Navigation Lock During Deck Analysis & Cancel Analysis Control
- **Navigation Lock While Analyzing**: Top navigation tabs (**Deck Overview**, **Mana, Changes & List**, and **Bot Playtest**) now stay locked and greyed out while deck analysis is running so users cannot enter partial states before analysis finishes.
- **Hover-Only Navigation Guidance Popover**: Hovering or focusing a locked top navigation button displays a contextual warning tooltip advising whether to import a deck first or wait for the current analysis to complete (or cancel it).
- **Cancel Analysis Button**: Added a **`Cancel Analysis`** button directly inside the top operation progress bar and inside the Deck Importer panel to immediately abort an in-progress deck analysis (`AbortController`) and reset the workspace cleanly.

#### 3. Import Deck Safety Warning & Clean Playtest Reset
- **Import Deck Reset Warning**: Added a persistent caution note in the Deck Importer and a confirmation dialog (**"Stop Bot Playtest & Reset Program?"**) when clicking **Import Deck** while an active deck or Bot Playtest session is running.
- **Full Program State Reset on Re-Import**: Confirming a new import cleanly halts any running Bot Playtest simulation, clears stale analysis caches and playtest logs, and loads the newly imported deck fresh.

#### 4. Official WotC Magic: The Gathering Comprehensive Rules (CR) Engine
- **Format Legality & Construction Rules (All 10 Formats)**:
  - **Vintage (`CR 100.2a`)**: Enforces 1-copy maximum for Vintage Restricted List cards, banned list checks, and 60-card minimum maindeck + 15-card maximum sideboard.
  - **Standard Brawl**: Enforces 60-card exact singleton deck construction (`59 maindeck + 1 commander`) vs. 100-card Historic Brawl / Commander.
  - **Combined Maindeck + Sideboard Copy Limits**: Validates the 4-copy (or 1-copy singleton) rule across combined maindeck and sideboard totals, with exemptions for basic lands, snow basics, Wastes, and boundless-copy cards (*Relentless Rats*, *Hare Apparent*, *Dragon's Approach*, *Nazgûl*, etc.).
- **Combat & State-Based Actions (`CR 510` & `CR 704`)**:
  - **Two-Step First Strike & Double Strike Combat (`CR 510.4` / `CR 702.4` / `CR 702.7`)**: First Strike and Double Strike damage resolves before normal combat damage; creatures destroyed in the First Strike step do not deal normal combat damage back.
  - **Deathtouch + Trample Assignment (`CR 702.19b`)**: Attackers with both Deathtouch and Trample assign 1 lethal damage per blocker and trample remaining damage over to the defending player.
  - **Keyword Enforcement**: Enforces **Defender** (`CR 702.3b` — cannot attack unless granted an override), **Indestructible** (`CR 702.12b` — immune to lethal damage and destroy effects), **Menace** (`CR 702.110b` — requires 2+ blockers), **Flying / Reach** (`CR 702.9b`), **Vigilance**, and **Lifelink**.
  - **Legend Rule (`CR 704.5j`)**: Controlling two or more legendary permanents with the same name automatically keeps one and puts the duplicate into the graveyard.
  - **Empty-Library Draw Loss (`CR 704.5b`)**: Attempting to draw from an empty library triggers a game loss state-based action instead of silently failing.
- **Turn Structure, Commander Tax & London Mulligan**:
  - **1v1 Starting Player Draw Skip (`CR 103.8a`)**: In 2-player 1v1 games, the starting player skips their Turn 1 draw step; in 4-player Commander pods, Turn 1 draw is preserved.
  - **Cast-Only Commander Tax (`CR 903.8`)**: Commander tax (`+{2}` per previous cast from the Command Zone) increments strictly when cast from the Command Zone.
  - **Interactive London Mulligan (`CR 103.5`)**: Draw 7 cards on every mulligan and select exactly *N* cards from your hand to put on the bottom of your library when keeping.

### 🐛 Bug Fixes & Copy Cleanup
- Removed the phrase `"under your private account."` from the Bot Playtest Arena header and Playtest Tutorial modal.
- Fixed an issue where top navigation buttons could be clicked before deck analysis finished.
