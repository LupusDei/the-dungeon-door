/**
 * The SRD 5.2 text behind the ids on a character sheet (GET /api/reference): what a spell, a species trait,
 * a feat, a class feature, a skill or a condition says, so the app can name them and explain them on a tap. Static data,
 * built once per process.
 */
import { z } from 'zod';
import classesJson from '../data/srd/5.2/classes.json' with { type: 'json' };
import conditionsJson from '../data/srd/5.2/conditions.json' with { type: 'json' };
import featsJson from '../data/srd/5.2/feats.json' with { type: 'json' };
import skillsJson from '../data/srd/5.2/skills.json' with { type: 'json' };
import spellsJson from '../data/srd/5.2/spells.json' with { type: 'json' };
import subclassesJson from '../data/srd/5.2/subclasses.json' with { type: 'json' };
import traitsJson from '../data/srd/5.2/traits.json' with { type: 'json' };
import { once, parseTable } from './rules/srd.ts';

export interface Entry { name: string; description: string }
export interface SpellEntry extends Entry {
  /** 0 for a cantrip. */
  level: number;
  school: string;
  castingTime: string;
  range: string;
  duration: string;
  /** "V, S, M". */
  components: string;
  concentration: boolean;
  ritual: boolean;
}
export interface Reference {
  spells: Record<string, SpellEntry>;
  traits: Record<string, Entry>;
  feats: Record<string, Entry>;
  /** Class and subclass features, by class id and then by the name a sheet lists them under (sheet.features). */
  features: Record<string, Record<string, Entry>>;
  skills: Record<string, Entry & { ability: string }>;
  conditions: Record<string, Entry>;
  /** The SRD's CC-BY-4.0 notice, to show wherever this text is shown. */
  attribution: string;
}

const entry = z.object({ index: z.string(), name: z.string(), description: z.string() });
const spell = entry.extend({
  level: z.number(), schoolName: z.string(), castingTime: z.string(), range: z.string(), duration: z.string(),
  components: z.array(z.string()), concentration: z.boolean(), ritual: z.boolean(),
});
const skill = entry.extend({ abilityScore: z.object({ index: z.string() }) });
const feature = z.object({ name: z.string(), description: z.string() });
const classFeatures = z.object({ index: z.string(), levels: z.array(z.object({ features: z.array(feature) })) });
const subclassFeatures = z.object({ class: z.object({ index: z.string() }), features: z.array(feature) });

/** Every class's features and its subclasses', by name. A name the class gains again at a later level keeps its first text. */
function featuresByClass(): Record<string, Record<string, Entry>> {
  const all: Record<string, Record<string, Entry>> = {};
  const add = (classId: string, list: z.infer<typeof feature>[]) => {
    all[classId] ??= {};
    for (const f of list) all[classId][f.name] ??= { name: f.name, description: f.description };
  };
  for (const c of parseTable('classes', classFeatures, classesJson)) add(c.index, c.levels.flatMap((l) => l.features));
  for (const s of parseTable('subclasses', subclassFeatures, subclassesJson)) add(s.class.index, s.features);
  return all;
}

const meta = z.object({ meta: z.object({ attribution: z.string() }) });

const plain = (records: z.infer<typeof entry>[]): Record<string, Entry> =>
  Object.fromEntries(records.map((r) => [r.index, { name: r.name, description: r.description }]));

export const reference: () => Reference = once(() => ({
  spells: Object.fromEntries(parseTable('spells', spell, spellsJson).map((s) => [s.index, {
    name: s.name, level: s.level, school: s.schoolName, castingTime: s.castingTime, range: s.range, duration: s.duration,
    components: s.components.join(', '), concentration: s.concentration, ritual: s.ritual, description: s.description,
  }])),
  traits: plain(parseTable('traits', entry, traitsJson)),
  feats: plain(parseTable('feats', entry, featsJson)),
  features: featuresByClass(),
  skills: Object.fromEntries(parseTable('skills', skill, skillsJson).map((s) => [s.index, { name: s.name, ability: s.abilityScore.index, description: s.description }])),
  conditions: plain(parseTable('conditions', entry, conditionsJson)),
  attribution: meta.parse(spellsJson).meta.attribution,
}));
