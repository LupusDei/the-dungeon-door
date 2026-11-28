/**
 * A real-model check of the dungeon master with the rules engine in its prompt: an opening for a story game,
 * an opening for a mapped dungeon, the next scene after the engine resolved a choice, and two written actions
 * classified (an attack outside a fight, which is the choice that starts one, and a look around, which is not).
 * Text only (five calls, about six cents of the owner's AI Gateway credit), no paintings.
 *
 * Run it before a release whenever lib/dm/ or what the DM is told has changed: the fake DM cannot tell you
 * that the real one refuses the schema or ignores the hooks.
 *
 *   npm run dm:check        # needs .env.local (vercel env pull) for the gateway
 */
delete process.env.DD_FAKE_AI;
import { archetype } from '../lib/catalog.ts';
import { heroSheet } from '../lib/characters.ts';
import { llmDungeonMaster } from '../lib/dm/llm.ts';
import type { DMContext, PartyMember, Resolution } from '../lib/dm/types.ts';
import { attackStartsFight, settleRuling } from '../lib/play/actions.ts';
import { hookLabel, parseHook } from '../lib/play/hooks.ts';
import { engineStep, newRules } from '../lib/play/table.ts';
import { rulesContext } from '../lib/play/view.ts';
import type { GamePlayer, StoredScene } from '../lib/types.ts';

const who = [
  { id: 'p1', name: 'Bryn Ashgrove', race: 'dwarf', characterClass: 'fighter' },
  { id: 'p2', name: 'Mirel', race: 'elf', characterClass: 'wizard' },
];
const players: GamePlayer[] = who.map((h) => ({
  playerId: h.id, joinedAt: '2026-01-01T00:00:00Z',
  character: {
    id: `c-${h.id}`, ownerId: h.id, name: h.name, race: h.race, characterClass: h.characterClass, gender: 'female', temperament: 'stoic', alignment: 'neutral-good',
    backstory: '', description: '', appearance: null, portraitUrl: null, createdAt: '', updatedAt: '', sheet: heroSheet(h),
  },
}));
const party: PartyMember[] = who.map((h) => ({
  playerId: h.id, name: h.name, race: h.race, characterClass: h.characterClass, gender: 'Female', temperament: 'Stoic', alignment: 'Neutral Good',
  backstory: '', description: '', appearance: `a ${h.race} ${h.characterClass}`,
}));

let hooks = 0;
let dropped = 0;
function show(title: string, scene: { title?: string; narration: string; choices?: { label: string; rules?: unknown }[]; outcome?: string }): void {
  console.log(`\n=== ${title}: ${scene.title ?? ''}`);
  if (scene.outcome) console.log(`OUTCOME: ${scene.outcome}`);
  console.log(scene.narration.slice(0, 400) + (scene.narration.length > 400 ? '…' : ''));
  for (const c of scene.choices ?? []) {
    const hook = parseHook(c.rules);
    if (hook) hooks++; else if (c.rules) dropped++;
    console.log(`  - ${c.label}  =>  ${hook ? hookLabel(hook) : c.rules ? `DROPPED ${JSON.stringify(c.rules)}` : 'pure story'}`);
  }
}

for (const mode of ['none', 'fixed'] as const) {
  const state = newRules(players, mode, 11, 6);
  const ctx: DMContext = { archetype: archetype('chronicler'), adventureTitle: null, party, history: [], sceneIndex: 0, sceneCount: 6, recentChat: [], rules: rulesContext(state) };
  const opening = await llmDungeonMaster.openingScene(ctx);
  show(`OPENING (dungeon: ${mode})`, opening);
  if (mode === 'none') continue;

  // Both heroes vote for the first choice whose hook the engine accepts; the engine resolves it; the DM narrates.
  const choices = opening.choices.slice(0, 3).map((c, i) => ({ id: (['a', 'b', 'c'] as const)[i], label: c.label, detail: c.detail, hook: parseHook(c.rules) }));
  const pick = choices.find((c) => c.hook) ?? choices[0];
  const scene = { index: 0, title: opening.title, narration: opening.narration, imagePrompt: '', imageUrl: null, choices, isFinale: false, votes: [], outcome: null, chosenChoiceId: null } as unknown as StoredScene;
  const votes = who.map((h, i) => ({ playerId: h.id, characterName: h.name, choiceId: pick.id, choiceLabel: pick.label, roll: 12 + i * 5 }));
  const past = { index: 0, title: scene.title, narration: scene.narration, choices, votes, outcome: null, chosenChoiceId: null };
  const resolution: Resolution = { scene: past, votes, tally: { a: 0, b: 0, c: 0, [pick.id]: votes.length }, leaders: [pick.id], abstained: [], rules: null };
  const step = engineStep(state, scene, resolution);
  console.log(`\nTHE ENGINE (${pick.label}): ${step.resolution.rules!.lines.join(' | ') || 'no dice'}`);
  const next = await llmDungeonMaster.nextScene({ ...ctx, adventureTitle: opening.adventureTitle, sceneIndex: 1, history: [past], rules: rulesContext(step.state) }, step.resolution);
  show('NEXT SCENE', next);
}

console.log(`\nThe dungeon master answered three times. ${hooks} choices carry a hook the engine accepts; ${dropped} hooks were dropped.`);
if (hooks === 0) { console.error('No choice carried a usable hook: the DM is not driving the engine.'); process.exit(1); }

// Written actions (classifyAction), as game.ts asks: outside a fight, with one choice that starts a fight.
const ids = ['choice:a', 'choice:b', 'choice:c', 'skill:perception', 'skill:athletics', 'ability:str'];
const offer = [
  { id: 'choice:a', label: 'Calm the hungry wolf' },
  { id: 'choice:b', label: 'Slip past through the mist' },
  { id: 'choice:c', label: 'Strike before they stir', fight: 'Wolf, Giant Rat' },
  { id: 'skill:perception', label: 'Perception' }, { id: 'skill:athletics', label: 'Athletics' }, { id: 'ability:str', label: 'Strength' },
];
const table: DMContext = { archetype: archetype('chronicler'), adventureTitle: 'The Ford', party, history: [], sceneIndex: 1, sceneCount: 6, recentChat: [], rules: rulesContext(newRules(players, 'none', 11, 6)) };
let misread = 0;
for (const { text, fight } of [{ text: 'I hurl a fire bolt at the wolf', fight: true }, { text: 'I look for tracks in the mud', fight: false }]) {
  const raw = await llmDungeonMaster.classifyAction!(table, { characterName: 'Mirel', text, inCombat: false, actions: ids, choices: offer });
  const read = settleRuling(raw, ids);
  const settled = attackStartsFight(read, ['choice:c'], false);
  const said = read.ruling.kind === 'known' ? `known ${read.ruling.action}` : read.ruling.kind === 'check' ? `check (${read.ruling.skill ?? read.ruling.ability}, ${read.ruling.tier}, effect ${read.ruling.effect.category})` : 'impossible';
  const picked = settled.ruling.kind === 'known' && settled.ruling.action === 'choice:c';
  const ok = settled.spent && picked === fight;
  if (!ok) misread++;
  console.log(`\n=== WRITTEN ACTION: "${text}"\n  the DM: ${said}\n  the engine: ${picked ? 'a pick of "Strike before they stir"' : settled.spent ? 'the hero\'s own action' : 'not spent'}${picked && read.ruling.kind !== 'known' ? ' (the engine\'s own rule: the DM called it a check)' : ''}  =>  ${ok ? 'as it should be' : 'WRONG'}`);
}
if (misread) { console.error('A written action was not read as the rules say: an attack outside a fight is the choice that starts one, and nothing else is.'); process.exit(1); }
