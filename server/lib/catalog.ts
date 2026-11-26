import { srd } from './rules/srd.ts';

/**
 * The option lists the character forge and lobby show (GET /api/catalog). Server-owned so the DM team
 * can add archetypes without an app release. Dungeon-master archetypes also carry server-only fields
 * (`voice`, `artStyle`, `ttsVoice`) that the DM and the painter use; `publicCatalog()` strips them.
 */

export interface Option {
  id: string;
  name: string;
  blurb: string;
}

export interface ClassOption extends Option {
  /** SF Symbol name. */
  symbol: string;
}

export interface DungeonMasterArchetype {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** SF Symbol name. */
  symbol: string;
  /** Hex colour. */
  accent: string;
  // ---- server-only ----
  /** How this DM narrates: tone, pacing, humour, danger. Fed to the DM model. */
  voice: string;
  /** Art direction added to every scene image this DM paints. */
  artStyle: string;
  /** A description of the narrator voice, for future text-to-speech. */
  ttsVoice: string;
}

export const RACES: Option[] = [
  { id: 'human', name: 'Human', blurb: 'Short-lived and restless, humans make up for it with ambition — found in every tavern, army and royal court.' },
  { id: 'elf', name: 'Elf', blurb: 'Graceful and long-remembering, elves walk between starlit forests and ancient courts, slow to trust and slower to forget.' },
  { id: 'dwarf', name: 'Dwarf', blurb: 'Stone-stubborn, ale-proud and as tough as the mountains they carve, dwarves keep their grudges and their oaths alike.' },
  { id: 'halfling', name: 'Halfling', blurb: 'Small, quick and uncannily lucky, halflings love a full pantry and a good story — and somehow survive both.' },
  { id: 'gnome', name: 'Gnome', blurb: 'Bright-eyed tinkerers and illusionists who treat the world as one enormous, fascinating puzzle box.' },
  { id: 'goliath', name: 'Goliath', blurb: 'Towering mountain-born wanderers with the blood of giants, goliaths prize a fair contest and never back down from a climb.' },
  { id: 'orc', name: 'Orc', blurb: 'Big-hearted, hard-hitting and hard to put down, orcs push on through wounds that would stop anyone else.' },
  { id: 'tiefling', name: 'Tiefling', blurb: 'Horned, tailed and marked by an infernal bargain they never made, tieflings carve their own destiny out of distrust.' },
  { id: 'dragonborn', name: 'Dragonborn', blurb: 'Proud, scaled descendants of dragons, honour-bound and able to breathe the elemental fury of their ancestors.' },
];

export const CLASSES: ClassOption[] = [
  { id: 'barbarian', name: 'Barbarian', symbol: 'bolt.fill', blurb: 'A storm of muscle and fury who shrugs off blows that would fell anyone else.' },
  { id: 'bard', name: 'Bard', symbol: 'music.note', blurb: 'A silver-tongued performer whose songs and stories bend hearts — and reality.' },
  { id: 'cleric', name: 'Cleric', symbol: 'sun.max.fill', blurb: 'A chosen servant of the gods, mending wounds and smiting the unholy with divine light.' },
  { id: 'druid', name: 'Druid', symbol: 'leaf.fill', blurb: 'A keeper of the wild who speaks with beasts, calls the storm and wears the shapes of animals.' },
  { id: 'fighter', name: 'Fighter', symbol: 'figure.fencing', blurb: 'A master of arms and armour, disciplined, versatile and always first into the breach.' },
  { id: 'monk', name: 'Monk', symbol: 'figure.martial.arts', blurb: 'A disciplined wanderer whose fists, feet and inner calm strike faster than any blade.' },
  { id: 'paladin', name: 'Paladin', symbol: 'checkmark.shield.fill', blurb: 'A holy knight bound by a sacred oath, shining in armour and terrible to evil.' },
  { id: 'ranger', name: 'Ranger', symbol: 'scope', blurb: 'A tracker and hunter of the borderlands, deadly with a bow and at home in the wilds.' },
  { id: 'rogue', name: 'Rogue', symbol: 'eye.slash.fill', blurb: 'A shadow with quick fingers and a quicker knife — locks, traps and secrets are all fair game.' },
  { id: 'sorcerer', name: 'Sorcerer', symbol: 'sparkles', blurb: 'Magic runs wild in their blood; raw, unpredictable power waiting for a spark.' },
  { id: 'warlock', name: 'Warlock', symbol: 'flame.fill', blurb: 'Power bought from something old and hungry beyond the stars. The bill always comes due.' },
  { id: 'wizard', name: 'Wizard', symbol: 'wand.and.stars', blurb: 'A scholar of the arcane whose spellbook holds the keys to fire, time and the minds of others.' },
];

export const TEMPERAMENTS: Option[] = [
  { id: 'brave', name: 'Brave', blurb: 'Steps forward when everyone else steps back.' },
  { id: 'cunning', name: 'Cunning', blurb: 'Always three moves ahead, and rarely says which three.' },
  { id: 'kind', name: 'Kind', blurb: 'Leads with an open hand, even when it costs.' },
  { id: 'brooding', name: 'Brooding', blurb: 'Carries a dark past and a darker cloak.' },
  { id: 'reckless', name: 'Reckless', blurb: 'Acts first, plans never, regrets occasionally.' },
  { id: 'scholarly', name: 'Scholarly', blurb: 'Has read about this. Has, in fact, written footnotes about this.' },
  { id: 'jovial', name: 'Jovial', blurb: 'The loudest laugh in the tavern and the first to buy a round.' },
  { id: 'stoic', name: 'Stoic', blurb: 'Says little, endures much, and never flinches.' },
];

export const GENDERS: { id: string; name: string }[] = [
  { id: 'female', name: 'Female' },
  { id: 'male', name: 'Male' },
  { id: 'nonbinary', name: 'Nonbinary' },
];

export const ALIGNMENTS: { id: string; name: string }[] = [
  { id: 'lawful-good', name: 'Lawful Good' },
  { id: 'neutral-good', name: 'Neutral Good' },
  { id: 'chaotic-good', name: 'Chaotic Good' },
  { id: 'lawful-neutral', name: 'Lawful Neutral' },
  { id: 'true-neutral', name: 'True Neutral' },
  { id: 'chaotic-neutral', name: 'Chaotic Neutral' },
  { id: 'lawful-evil', name: 'Lawful Evil' },
  { id: 'neutral-evil', name: 'Neutral Evil' },
  { id: 'chaotic-evil', name: 'Chaotic Evil' },
];

export const DUNGEON_MASTERS: DungeonMasterArchetype[] = [
  {
    id: 'chronicler',
    name: 'The Chronicler',
    tagline: 'A classic tale of heroes, told true.',
    description:
      'An old keeper of histories who has seen a thousand parties walk through the dungeon door. ' +
      'The Chronicler runs a fair, sweeping high-fantasy adventure: lost kingdoms, ancient magic, honest danger ' +
      'and rewards earned. Bold plans are rewarded, foolish ones are punished — but never cruelly.',
    symbol: 'book.closed',
    accent: '#C9A227',
    voice:
      'Warm, measured and grand, like a beloved storyteller by a hearth. Classic high fantasy in the spirit of ' +
      'Tolkien and the great tabletop campaigns: wonder, courage, ancient ruins, noble and wicked foes. Fair to ' +
      'the players: consequences follow logically from choices and dice, danger is real but survivable, and every ' +
      'character gets a moment to shine. Light humour is welcome; mockery is not.',
    artStyle:
      'classic high-fantasy oil painting, golden-hour light, sweeping vistas, rich warm palette of gold, deep green and crimson',
    ttsVoice:
      'An older, warm baritone with a gentle British lilt; unhurried, resonant, like an audiobook narrator reading an epic by firelight.',
  },
  {
    id: 'trickster',
    name: 'The Trickster',
    tagline: 'Nothing is what it seems. Especially the door.',
    description:
      'A grinning fey spirit who thinks the rules are more of a suggestion. Expect talking hats, bargains with ' +
      'riddling goblins, staircases that change their minds and outcomes nobody saw coming. Chaotic, whimsical ' +
      'and very funny — though the fey always keep their word, to the letter.',
    symbol: 'wand.and.rays',
    accent: '#7BC96F',
    voice:
      'Mischievous, playful and quick-witted, like a fey creature from a fairy tale who finds mortals adorable. ' +
      'Whimsical and surreal: enchanted forests, impossible bargains, riddles, sentient objects, wordplay and ' +
      'absurd but internally consistent logic. Twists are frequent but should feel delightful, not unfair. Keep ' +
      'it family-friendly and genuinely funny; poke gentle fun at the characters\' quirks.',
    artStyle:
      'whimsical fairy-tale illustration, luminous jewel tones, glowing mushrooms and will-o-wisps, slightly surreal perspective, storybook charm',
    ttsVoice:
      'A light, lilting, androgynous voice with a sly smile in it; quick, musical and teasing, occasionally dropping to a conspiratorial whisper.',
  },
  {
    id: 'grim-warden',
    name: 'The Grim Warden',
    tagline: 'Few return. Fewer return unchanged.',
    description:
      'A hooded gaoler of crypts and cursed places who speaks softly and keeps a long ledger of the dead. ' +
      'The Grim Warden runs a dark, gothic adventure of dread and hard choices, where every lantern matters and ' +
      'victories are bought dearly. For parties who want real danger.',
    symbol: 'moon.stars',
    accent: '#8B1E2D',
    voice:
      'Low, solemn and foreboding, like gothic horror: cursed villages, haunted crypts, things that should not ' +
      'wake. Atmosphere first — cold, smell, sound, the dark. Danger is real and choices carry lasting costs ' +
      '(wounds, curses, lost allies), though the party is never wiped out on a single roll. Dread over gore: ' +
      'imply horror rather than dwelling on it. Victories are grim, hard-won and bittersweet.',
    artStyle:
      'dark gothic fantasy painting, deep shadows and chiaroscuro, cold moonlight and guttering torchlight, desaturated palette with blood-red accents, mist',
    ttsVoice:
      'A deep, gravelly, slow voice, almost a whisper at times; grave and deliberate, with long pauses, like a crypt-keeper reciting the names of the dead.',
  },
  {
    id: 'bard',
    name: 'The Bard',
    tagline: 'Swords, songs and spectacular entrances!',
    description:
      'A flamboyant showman who narrates every adventure as if a packed theatre were watching. Daring rescues, ' +
      'rooftop duels, pirate ships and villains with magnificent moustaches. Big, theatrical and comedic — ' +
      'the bolder your plan, the louder the applause.',
    symbol: 'theatermasks.fill',
    accent: '#E0662F',
    voice:
      'Flamboyant, theatrical and comedic, like a swashbuckling stage play narrated by a showman who adores his ' +
      'audience. Swashbuckling adventure: duels, chases, heists, pirates, grand villains, dramatic reversals. ' +
      'Reward bold and stylish choices; treat failures as comic set-pieces rather than disasters. Use playful ' +
      'asides to the audience, vivid action verbs and a sense of spectacle.',
    artStyle:
      'vibrant swashbuckling adventure painting, dynamic diagonal composition, theatrical stage lighting, saturated warm colours, motion and flair',
    ttsVoice:
      'A rich, booming, expressive tenor with theatrical flair; fast and playful, rising to grand crescendos, with comic timing and the occasional flourish of song.',
  },
];

export const DEFAULT_DUNGEON_MASTER = 'chronicler';

/** What the forge says about each SRD 5.2 background. One without a line here still shows, by name alone. */
const BACKGROUND_BLURBS: Readonly<Record<string, string>> = {
  acolyte: 'Raised in a temple among rites and old books. You know the gods\' business, and how to keep a vigil.',
  criminal: 'You made your living in back alleys: quick hands, quiet feet, and a nose for trouble before it arrives.',
  sage: 'Years among scrolls and strange lore. If it was ever written down, you have read it or know who did.',
  soldier: 'Trained for war and tested in it. You know drill, discipline, and what a shield wall is worth.',
};

/** The kinds of game a host can start, by the `dungeon` of POST …/start (lib/play/table.ts DUNGEON_MODES). */
export const DUNGEONS: (Option & { symbol: string })[] = [
  { id: 'none', name: 'A tale told', symbol: 'book.pages.fill', blurb: 'The dungeon master spins a short adventure, scene by scene. Your skills decide how each choice goes, and a fight can break out.' },
  { id: 'fixed', name: 'Delve a dungeon', symbol: 'map.fill', blurb: 'A mapped dungeon of rooms and doors, with monsters, traps and treasure behind them. Longer adventures get bigger maps. Not every monster attacks on sight. Deadly: a hero who dies stays dead unless the party can pay to raise them.' },
  { id: 'explore', name: 'Explore the deep', symbol: 'flashlight.on.fill', blurb: 'A dungeon that grows where you go: each door opens on a room nobody has seen, the dungeon master included. Deadly: a hero who dies stays dead unless the party can pay to raise them.' },
];

export function publicCatalog() {
  return {
    races: RACES,
    classes: CLASSES,
    temperaments: TEMPERAMENTS,
    genders: GENDERS,
    alignments: ALIGNMENTS,
    backgrounds: [...srd().backgrounds.values()].map(({ id, name, abilities }) => ({ id, name, blurb: BACKGROUND_BLURBS[id] ?? '', abilities })),
    dungeons: DUNGEONS,
    dungeonMasters: DUNGEON_MASTERS.map(({ id, name, tagline, description, symbol, accent }) => ({
      id, name, tagline, description, symbol, accent,
    })),
  };
}

const ids = (list: { id: string }[]) => new Set(list.map((o) => o.id));
const VALID = {
  race: ids(RACES),
  characterClass: ids(CLASSES),
  temperament: ids(TEMPERAMENTS),
  gender: ids(GENDERS),
  alignment: ids(ALIGNMENTS),
  dungeonMaster: ids(DUNGEON_MASTERS),
};

export function isValid(kind: keyof typeof VALID, id: unknown): id is string {
  return typeof id === 'string' && VALID[kind].has(id);
}

export function archetype(id: string): DungeonMasterArchetype {
  return DUNGEON_MASTERS.find((d) => d.id === id) ?? DUNGEON_MASTERS[0];
}

/** Display name for a catalog id ("dragonborn" → "Dragonborn"), or the id itself. */
export function nameOf(kind: 'race' | 'characterClass' | 'temperament' | 'gender' | 'alignment', id: string): string {
  const list = { race: RACES, characterClass: CLASSES, temperament: TEMPERAMENTS, gender: GENDERS, alignment: ALIGNMENTS }[kind];
  return list.find((o) => o.id === id)?.name ?? id;
}
