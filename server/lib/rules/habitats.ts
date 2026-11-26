/**
 * Which monsters live in which kind of dungeon: by creature type, less a short list of creatures that do
 * not belong underground (mounts, livestock, sea creatures, birds of the open sky, townsfolk). A room's
 * encounter is drawn from its dungeon's habitat (rules/encounter.ts). See docs/rules-design.md (Phase 5).
 */
import { dungeonTables } from './dungeonTables.ts';
import { monsters } from './monsters.ts';
import { lookup } from './violation.ts';

const TYPES: Readonly<Record<string, readonly string[]>> = {
  crypt: ['undead', 'ooze', 'swarm of tiny beasts', 'beast'],
  caves: ['beast', 'monstrosity', 'ooze', 'plant', 'swarm of tiny beasts', 'aberration', 'humanoid', 'fey', 'dragon', 'giant'],
  stronghold: ['humanoid', 'fey', 'beast', 'construct', 'giant', 'monstrosity', 'dragon'],
  mine: ['humanoid', 'fey', 'dragon', 'aberration', 'ooze', 'elemental', 'construct', 'beast', 'swarm of tiny beasts', 'giant'],
  temple: ['undead', 'fiend', 'humanoid', 'construct', 'celestial', 'ooze', 'swarm of tiny beasts'],
  laboratory: ['construct', 'ooze', 'elemental', 'fiend', 'aberration', 'plant', 'monstrosity', 'humanoid'],
  prison: ['humanoid', 'undead', 'fiend', 'aberration', 'beast', 'swarm of tiny beasts', 'monstrosity', 'ooze'],
  ruins: ['undead', 'construct', 'monstrosity', 'beast', 'swarm of tiny beasts', 'humanoid', 'fey', 'plant', 'ooze', 'giant', 'dragon'],
};

/** Never met in a dungeon room, whatever their type. */
const OUT_OF_PLACE = new Set([
  'camel', 'mule', 'pony', 'draft-horse', 'riding-horse', 'warhorse', 'elk', 'deer', 'goat', 'giant-goat', 'mammoth', 'elephant',
  'eagle', 'giant-eagle', 'hawk', 'blood-hawk', 'vulture', 'giant-vulture', 'pteranodon', 'axe-beak', 'hippogriff', 'roc',
  'merfolk-skirmisher', 'reef-shark', 'hunter-shark', 'giant-shark', 'killer-whale', 'giant-octopus', 'seahorse', 'giant-seahorse',
  'piranha', 'swarm-of-piranhas', 'sahuagin-warrior', 'plesiosaurus', 'commoner', 'noble',
]);

/** The ids of the monsters that live in this kind of dungeon. */
export function habitat(kindId: string): string[] {
  const types = lookup(new Map(Object.entries(TYPES)), kindId, 'dungeon kind');
  return [...monsters().values()].filter((m) => types.includes(m.type.toLowerCase()) && !OUT_OF_PLACE.has(m.id)).map((m) => m.id);
}

/** A dungeon's kind id from the name its map carries ("Crypt" → crypt). */
export const kindIdOf = (name: string): string => dungeonTables().kinds.rows.find((r) => r.value.name === name)!.value.id;
