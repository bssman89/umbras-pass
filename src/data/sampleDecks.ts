import type { DeckFormat, DeckGoal } from '../types/deck';

export interface SampleDeck {
  id: string;
  title: string;
  subtitle: string;
  format: DeckFormat;
  goal: DeckGoal;
  sourceLabel: string;
  deckText: string;
}

export const SAMPLE_DECKS: SampleDeck[] = [
  {
    id: 'dimir-under-landed',
    title: 'Wilhelt Zombies (Under-Landed EDH)',
    subtitle: 'Commander · 100 cards · Only 30 lands & too many slow 6-drops',
    format: 'commander',
    goal: 'bracket-3',
    sourceLabel: 'Moxfield / Arena Format',
    deckText: `Commander
1 Wilhelt, the Rotcleaver

Deck
1 Sol Ring
1 Arcane Signet
1 Dimir Signet
1 Talisman of Dominance
1 Carrion Feeder
1 Gravecrawler
1 Cryptbreaker
1 Champion of the Perished
1 Headless Rider
1 Diregraf Colossus
1 Death Baron
1 Cemetery Reaper
1 Lord of the Accursed
1 Undead Warchief
1 Zombie Master
1 Noxious Ghoul
1 Gray Merchant of Asphodel
1 Mikaeus, the Unhallowed
1 Rooftop Storm
1 Endless Ranks of the Dead
1 Army of the Damned
1 Liliana, Dreadhorde General
1 Liliana, Death's Majesty
1 Zombie Apocalypse
1 Open the Graves
1 Necroduality
1 Cleaver Skaab
1 Hordewing Skaab
1 Poppet Stitcher
1 Gisa and Geralf
1 Acererak the Archlich
1 Diregraf Captain
1 Bladestitched Skaab
1 Gleaming Overseer
1 Vizier of the Scorpion
1 Eternal Skylord
1 Fleshbag Marauder
1 Plaguecrafter
1 Ravenous Rotbelly
1 Warren Soultrader
1 Phyrexian Altar
1 Ashnod's Altar
1 Rhystic Study
1 Mystic Remora
1 Midnight Reaper
1 Undead Augur
1 Kindred Discovery
1 Distant Melody
1 Counterspell
1 Negate
1 Arcane Denial
1 Infernal Grasp
1 Go for the Throat
1 Feed the Swarm
1 Deadly Rollick
1 Toxic Deluge
1 Decree of Pain
1 Living Death
1 Reanimate
1 Animate Dead
1 Victimize
1 Buried Alive
1 Entomb
1 Dark Ritual
1 Caged Sun
1 Diabolic Tutor
1 Increasing Ambition
1 Curse of Unbinding
1 Mind Stone
1 Command Tower
1 Watery Grave
1 Drowned Catacomb
1 Sunken Hollow
1 Choked Estuary
1 Dimir Aqueduct
1 Temple of Deceit
1 Dismal Backwater
1 Evolving Wilds
1 Terramorphic Expanse
1 Unclaimed Territory
1 Path of Ancestry
1 Bojuka Bog
1 Reliquary Tower
9 Swamp
7 Island`,
  },
  {
    id: 'rakdos-modern-curve',
    title: 'Rakdos Midrange (60-Card Mana Fix)',
    subtitle: 'Modern · 60 cards · Heavy double-pip spells on 20 lands',
    format: 'modern',
    goal: 'bracket-4',
    sourceLabel: 'MTG Arena / MTGO Format',
    deckText: `Deck
4 Ragavan, Nimble Pilferer
4 Orcish Bowmasters
4 Dauthi Voidwalker
4 Grief
4 Seasoned Pyromancer
4 Fable of the Mirror-Breaker
4 Thoughtseize
4 Fatal Push
4 Lightning Bolt
3 Terminate
3 Kolaghan's Command
2 Kroxa, Titan of Death's Hunger
2 Sheoldred, the Apocalypse
4 Bloodstained Mire
4 Blackcleave Cliffs
2 Blood Crypt
2 Dragonskull Summit
2 Temple of Malice
2 Mountain
2 Swamp
2 Ghost Quarter`,
  },
  {
    id: 'simic-budget-ramp',
    title: 'Aesi Landfall (Budget EDH Upgrade)',
    subtitle: 'Commander · 96 cards · Missing 4 cards & low on removal',
    format: 'commander',
    goal: 'bracket-2',
    sourceLabel: 'Archidekt / Plain Format',
    deckText: `Commander
1 Aesi, Tyrant of Gyre Strait

Deck
1x Rampant Growth
1x Cultivate
1x Kodama's Reach
1x Harrow
1x Roiling Regrowth
1x Explore
1x Growth Spiral
1x Urban Evolution
1x Coiling Oracle
1x Llanowar Elves
1x Elvish Mystic
1x Sakura-Tribe Elder
1x Wood Elves
1x Tireless Provisioner
1x Lotus Cobra
1x Scute Swarm
1x Avenger of Zendikar
1x Rampaging Baloths
1x Tatyova, Benthic Druid
1x Meloku the Clouded Mirror
1x Multani, Yavimaya's Avatar
1x Nezahal, Primal Tide
1x Simic Sky Swallower
1x Trench Behemoth
1x Spitting Image
1x Whelming Wave
1x Counterspell
1x Beast Within
1x Reality Shift
1x Negate
1x Harmonize
1x Fact or Fiction
1x Sol Ring
1x Simic Signet
1x Swiftfoot Boots
1x Retreat to Coralhelm
1x Retreat to Kazandu
1x Khalni Heart Expedition
1x Zendikar's Roil
1x Garruk's Uprising
1x Scaled Herbalist
1x Murkfiend Liege
1x Verdant Sun's Avatar
1x Stormtide Leviathan
1x Terastodon
1x Kodama of the East Tree
1x Eternal Witness
1x Acidic Slime
1x Reclamation Sage
1x Command Tower
1x Simic Growth Chamber
1x Thornwood Falls
1x Woodland Stream
1x Temple of Mystery
1x Evolving Wilds
1x Terramorphic Expanse
1x Blighted Woodland
1x Myriad Landscape
1x Reliquary Tower
1x Jungle Basin
1x Coral Atoll
18 Forest
16 Island`,
  },
];
