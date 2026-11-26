/**
 * The rules hook as the language model writes it. Structured-output providers limit how many union-typed
 * (nullable) fields a schema may carry (Anthropic: 16, and a hook has more than that), so nothing here is
 * nullable: the model fills the fields its hook's kind uses and leaves the rest empty ("", 0, [], "none").
 * hookFromFlat turns that back into the hook the engine checks (play/hooks.ts parseHook).
 */
import { z } from 'zod';

const NONE = 'none';

export const FlatHook = z.object({
  kind: z.enum(['check', 'save', 'fight', 'rest', 'move', 'buy', 'sell', 'use', 'trap', 'hazard', 'parley']),
  ability: z.enum([NONE, 'str', 'dex', 'con', 'int', 'wis', 'cha']).describe('check or save: the ability; "none" otherwise'),
  skill: z.string().describe('check: an SRD skill id such as "athletics"; "" for a plain ability check and for other kinds'),
  tool: z.string().describe('check: a tool id such as "thieves-tools" when a tool does the work; "" otherwise'),
  dc: z.number().int().describe('check or save: 5, 10, 15, 20, 25 or 30; 0 for a check against a monster and for other kinds'),
  against: z.string().describe('check: a monster id when the check is against that creature (sneak past, persuade); "" otherwise'),
  mode: z.enum([NONE, 'group', 'best']).describe('check: "group" (everyone rolls) or "best" (the best hero rolls, the others help); "none" otherwise'),
  advantage: z.boolean().describe('check or save: true when circumstances favour the heroes'),
  disadvantage: z.boolean().describe('check or save: true when circumstances hinder the heroes'),
  damage: z.string().describe('save: damage dice on a failure, e.g. "2d6"; "" for none'),
  damageType: z.string().describe('save: e.g. "fire"; "" for none'),
  monsters: z.array(z.string()).describe('fight: monster ids from the list you are given; parley: the creatures to talk to ([] for the foes waiting in the room); [] otherwise'),
  rest: z.enum([NONE, 'short', 'long']).describe('rest: "short" or "long"; "none" otherwise'),
  exit: z.string().describe('move: an exit id from the dungeon block; "" otherwise'),
  items: z.array(z.string()).describe('buy or sell: SRD item ids, e.g. ["potion-of-healing"]; [] otherwise'),
  item: z.string().describe('use: a potion id, e.g. "potion-of-healing"; "" otherwise'),
  trap: z.string().describe('trap: an SRD 5.2 trap id, e.g. "poisoned-needle"; "" otherwise'),
  hazard: z.enum([NONE, 'falling', 'burning', 'suffocation', 'extreme-cold', 'extreme-heat', 'dehydration', 'malnutrition']).describe('hazard: which one; "none" otherwise'),
  feet: z.number().describe('hazard falling: how far; 0 otherwise'),
  minutes: z.number().describe('hazard suffocation: how long without air; 0 otherwise'),
  hours: z.number().describe('hazard extreme-cold or extreme-heat: hours exposed; 0 otherwise'),
  days: z.number().describe('hazard malnutrition: days without food; 0 otherwise'),
});

const empty = (value: unknown): boolean =>
  value === null || value === '' || value === NONE || value === 0 || (Array.isArray(value) && value.length === 0);

/** The model's flat hook with its empty fields dropped: what parseHook expects. Anything else is no hook. */
export function hookFromFlat(flat: unknown): unknown {
  if (!flat || typeof flat !== 'object') return null;
  return Object.fromEntries(Object.entries(flat).filter(([, value]) => !empty(value)));
}
