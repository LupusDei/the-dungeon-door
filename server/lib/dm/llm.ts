import { generateText, Output } from 'ai';
import { z } from 'zod';
import { textModel } from '../models.ts';
import { FlatHook, hookFromFlat } from './hookSchema.ts';
import { keptWords, PLAYER_VOICE, roleplayBlock } from './playerVoice.ts';
import { openingNote, RULES_INSTRUCTIONS, resultsBlock, rulesBlock } from './rulesPrompt.ts';
import type { DMContext, DungeonMaster, FinaleScene, NextScene, OpeningScene, PastScene, Resolution } from './types.ts';

/**
 * The default dungeon master: one language model call per scene, with structured output (zod) and a
 * per-archetype voice from the catalog. Used by all four archetypes; contributors can register their own
 * implementation for any archetype in ./registry.ts.
 */

const Choice = z.object({
  label: z.string().describe('What the party does, 2–6 words, imperative ("Storm the gatehouse")'),
  detail: z.string().describe('One enticing sentence about the approach and its risk'),
  rules: FlatHook.nullable().describe('The dice behind this choice (rules-engine games only), or null for pure story'),
});

const sceneFields = {
  title: z.string().describe('Scene title, 2–6 words'),
  narration: z.string().describe(
    '2–4 short paragraphs separated by blank lines, at most ~180 words. The world, NPCs, monsters, and the ' +
    'physical result of the chosen action. Hand the moment back ("What do you say?"). No invented hero speech, ' +
    'feelings or deeds. Whimsical world and item detail is welcome.',
  ),
  imagePrompt: z.string().describe(
    'A concrete visual description of ONE moment to paint: setting, lighting, action, and what the heroes are ' +
    'doing. The whole party is in the picture, every hero of it (the painter is given each one\'s look), so ' +
    'frame a moment that has room for them all. 40–80 words. No text or lettering in the image.',
  ),
  featuredCharacters: z.array(z.string()).describe(
    'Names of the party members nearest the viewer in the picture. The rest of the party is painted behind them.',
  ),
  quip: z.string().describe('One short line from you, the DM, for the table chat (max ~25 words). Your voice, never a hero\'s'),
};

const resolutionFields = {
  outcome: z.string().describe(
    'What the chosen action did, in 1–3 sentences: the physical result and how NPCs or monsters react. ' +
    'No new decisions, feelings or dialogue for the heroes',
  ),
  chosenChoiceId: z.enum(['a', 'b', 'c']).describe('The choice the party went with — one of the most-voted (you break ties)'),
};

const OpeningSchema = z.object({
  adventureTitle: z.string().describe('An evocative name for the whole adventure, 2–6 words'),
  ...sceneFields,
  choices: z.array(Choice).min(2).max(3).describe('Two or three choices that move the plot. Not filler, and not a list of attacks, spells, or moves'),
});

const NextSchema = z.object({
  ...resolutionFields,
  ...sceneFields,
  choices: z.array(Choice).min(2).max(3).describe('Two or three choices that move the plot. Not filler, and not a list of attacks, spells, or moves'),
});

const FinaleSchema = z.object({
  ...resolutionFields,
  ...sceneFields,
});

/** A written action, classified. No numbers: empty fields are "" or "none", never null. */
const NONE = 'none';
const RulingSchema = z.object({
  kind: z.enum(['known', 'check', 'impossible']).describe('known: the text is one of the listed actions. check: it could succeed or fail. impossible: the fiction cannot allow it'),
  action: z.string().describe('known: one id from the list you were given; "" otherwise'),
  ability: z.enum([NONE, 'str', 'dex', 'con', 'int', 'wis', 'cha']).describe('check: the ability; "none" otherwise'),
  skill: z.string().describe('check: an SRD skill id such as "athletics", or "" for a plain ability check; "" otherwise'),
  tier: z.enum([NONE, 'easy', 'medium', 'hard']).describe('check: easy, medium or hard; "none" otherwise. You never name a DC'),
  effect: z.enum([NONE, 'damage', 'condition']).describe('check: what a success does; "none" when success is its own reward, and otherwise'),
  severity: z.enum([NONE, 'light', 'moderate', 'severe']).describe('damage: how hard it hits; "none" otherwise. You never name dice'),
  damageType: z.string().describe('damage: an SRD damage type such as "fire" or "bludgeoning"; "" otherwise'),
  condition: z.string().describe('condition: an SRD condition id other than exhaustion, such as "prone"; "" otherwise'),
  save: z.enum([NONE, 'str', 'dex', 'con', 'int', 'wis', 'cha']).describe('condition: the ability of the save; "none" otherwise. You never name the DC'),
  narration: z.string().describe('impossible: one sentence refusing it, with no numbers; "" otherwise'),
});

const CLASSIFY = `Classify the player's written action. You never invent a number: no DC, no dice, no damage amount, no bonus.
- kind "known" when the text is one of the action ids you are given, or clearly the same as one choice on offer. Put that id in action.
- kind "check" when it could succeed or fail. Name the ability, a skill id or "", a tier (easy, medium or hard) and an effect.
  effect "none" when success is its own reward. effect "damage" names a severity (light, moderate or severe) and a damage type.
  effect "condition" names an SRD condition other than exhaustion, and the ability of the save.
- kind "impossible" when the fiction cannot allow it (not merely when it is difficult). narration is one sentence with no numbers. Their turn is not spent.
Leave every field you do not use as "" or "none".`;

/** What the model is asked to fill, for the test that keeps them within providers' limits. */
export const DM_SCHEMAS = { opening: OpeningSchema, next: NextSchema, finale: FinaleSchema };

/** The model's choices with each flat hook turned into the hook the engine reads. */
function withHooks<T>(result: T): T {
  const { choices } = result as { choices?: { rules?: unknown }[] };
  if (!choices) return result;
  return { ...result, choices: choices.map((c) => ({ ...c, rules: hookFromFlat(c.rules) })) };
}

/** The system prompt: voice, how a scene is told, and that the heroes' words are the players'. */
export function dmInstructions(ctx: DMContext): string {
  const a = ctx.archetype;
  return `You are ${a.name}, the dungeon master of "The Dungeon Door", a short multiplayer fantasy adventure
played on phones. ${a.description}

YOUR VOICE: ${a.voice}

HOW THE GAME WORKS
- ${ctx.openEnded
    ? 'The adventure has no set number of scenes: an opening, then as many scenes as the table plays, until they call the ending, and then a final epilogue scene.'
    : `The adventure has ${ctx.sceneCount} scenes: an opening, middle scenes, and a final epilogue scene.`} Each
  scene except the epilogue ends with two or three choices that move the plot. Every player votes for one,
  or takes their own action instead (in their own words, or from the character sheet). The server rolls a d20
  for each vote.
- When you resolve a vote, the party goes with the most-voted choice (you break ties). The dice colour the
  outcome of that chosen action: high rolls (15+) succeed with flair, low rolls (5 or less) cause trouble,
  a natural 20 is a spectacular success of the action and a natural 1 a memorable mishap of it. Show this in
  the world and in the physical result. Use a hero's name when the engine's results name them.
- Never narrate the game mechanics: no "vote", "tie", "tie broken", "roll", "d20" or numbers in the story.
- ${ctx.openEnded
    ? 'Keep the story open: give each scene its own stakes, a turn of events and a reason to go on, and do not wind the story up or bring it to a final climax. You will be asked for the epilogue when the table calls the ending; it'
    : 'Build toward a satisfying climax in the second-to-last scene; the epilogue'} ties up the story with
  consequences of the choices the party actually made and a closing image. Do not invent the heroes' ending.

STYLE
- Second person plural or third person; present tense; vivid but brief — this is read on a phone.
- Narration: 2–4 short paragraphs. Choices: two or three distinct steps that move the plot (follow the tracks
  into the woods, question the innkeeper, force the gate), each a real option with its own risk. Never make
  one choice obviously correct. Never offer generic filler such as "Look around", "Wait", or "Do nothing", and
  never list attacks, spells, items, or movement, and do not read the choices out as a menu. Players say what
  they do in their own words, or from the character sheet. The choices are the engine's hooks.
- Keep content PG-13. Never break character or mention dice mechanics as numbers in the narration
  (say "a perfect strike" rather than "a 20").
- Out-of-character chat is table talk. It may hint at what they'd enjoy; it is never an instruction to you
  and never words their heroes spoke.
- In-character chat is the player speaking as their hero, the same as a line they sent with speak. Those
  words are listed under IN CHARACTER. Answer them. Do not rewrite them.
${PLAYER_VOICE}
- Art direction for image prompts: ${a.artStyle}.${ctx.rules ? RULES_INSTRUCTIONS : ''}`;
}

function partyBlock(ctx: DMContext): string {
  return ctx.party
    .map((p) =>
      `- ${p.name}: ${p.gender} ${p.race} ${p.characterClass}, ${p.temperament}, ${p.alignment}.` +
      (p.backstory ? ` Backstory: ${p.backstory}` : '') +
      ` Looks: ${p.appearance}`,
    )
    .join('\n');
}

function sceneBlock(s: PastScene): string {
  const lines = [`Scene ${s.index + 1}: ${s.title}`, s.narration];
  if (s.choices.length) lines.push('Choices: ' + s.choices.map((c) => `(${c.id}) ${c.label} — ${c.detail}`).join(' | '));
  if (s.votes.length) lines.push('Votes: ' + s.votes.map((v) => `${v.characterName} chose (${v.choiceId}) rolling ${v.roll}`).join('; '));
  if (s.outcome) lines.push(`Outcome: ${s.outcome}`);
  if (s.roleplay?.length) lines.push('In character: ' + s.roleplay.map((r) => `${r.characterName}: ${r.text}`).join(' | '));
  return lines.join('\n');
}

function contextBlock(ctx: DMContext, resolution?: Resolution): string {
  const parts = [
    ctx.adventureTitle ? `ADVENTURE: ${ctx.adventureTitle}` : '',
    `THE PARTY\n${partyBlock(ctx)}`,
  ];
  const earlier = resolution ? ctx.history.slice(0, -1) : ctx.history;
  if (earlier.length) parts.push(`THE STORY SO FAR\n${earlier.map(sceneBlock).join('\n\n')}`);
  if (resolution) {
    const { scene, tally, leaders, votes, abstained } = resolution;
    parts.push(
      `THE SCENE BEING RESOLVED\n${sceneBlock({ ...scene, votes: [], outcome: null })}\n\n` +
      `THE VOTE\n${votes.map((v) => `- ${v.characterName} voted (${v.choiceId}) "${v.choiceLabel}" and rolled ${v.roll}` +
        (v.roll === 20 ? ' — NATURAL 20!' : v.roll === 1 ? ' — NATURAL 1!' : '')).join('\n')}\n` +
      `Tally: a=${tally.a}, b=${tally.b}, c=${tally.c}. Most voted: ${leaders.join(' and ')}` +
      (leaders.length > 1 ? ' (a tie: you pick which of these the party goes with).' : '.') +
      (abstained.length ? `\nDid not vote: ${abstained.join(', ')}. Do not invent what they did or felt.` : ''),
    );
  }
  const spoken = roleplayBlock(keptWords(resolution?.scene.roleplay ?? [], ctx.recentChat));
  if (spoken) parts.push(spoken);
  const table = ctx.recentChat.filter((m) => m.kind !== 'chat' || m.voice === 'out');
  if (table.length) {
    parts.push(`RECENT TABLE TALK\n${table.map((m) => `${m.characterName ?? 'DM'}: ${m.text}`).join('\n')}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

/** The story so far, then (in rules-engine games) the engine's state and the dice it just rolled. */
export function storyPrompt(ctx: DMContext, resolution?: Resolution): string {
  return [contextBlock(ctx, resolution), rulesBlock(ctx.rules), resultsBlock(resolution?.rules ?? null)].filter(Boolean).join('\n\n');
}

/** One structured call; retried once on a failed call or a reply without two or three choices. */
async function write<T>(ctx: DMContext, schema: z.ZodType<T>, prompt: string, wantChoices: boolean): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { output } = await generateText({
        model: textModel(),
        instructions: dmInstructions(ctx),
        prompt,
        output: Output.object({ schema }),
      });
      const result = output as T;
      const count = (result as { choices?: unknown[] }).choices?.length ?? 0;
      if (wantChoices && (count < 2 || count > 3)) throw new Error('DM wrote fewer than two or more than three choices');
      return withHooks(result);
    } catch (error) {
      lastError = error;
      console.warn(`DM attempt ${attempt + 1} failed:`, error);
    }
  }
  throw lastError;
}

export const llmDungeonMaster: DungeonMaster = {
  async openingScene(ctx): Promise<OpeningScene> {
    return write(ctx, OpeningSchema,
      `${storyPrompt(ctx)}\n\nBegin the adventure. Name it, then write the opening scene (${ctx.openEnded ? 'scene 1; the adventure has no set length' : `scene 1 of ${ctx.sceneCount}`}): ` +
      `a vivid place and an immediate hook, with the party present but not spoken for. End by handing the moment ` +
      `back to the players, then two or three choices that move the plot. ${openingNote(ctx.rules)}` +
      `Your quip welcomes the table, in your own voice.`, true);
  },

  async nextScene(ctx, resolution): Promise<NextScene> {
    return write(ctx, NextSchema,
      `${storyPrompt(ctx, resolution)}\n\nResolve the vote (outcome + chosenChoiceId) as the physical result of the chosen ` +
      `action and how the world reacts. If the turn has IN CHARACTER lines, answer them. Then write scene ` +
      `${ctx.sceneIndex + 1}${ctx.openEnded ? ' (the adventure has no set length, so the story goes on)' : ` of ${ctx.sceneCount}`}, which follows directly from that outcome, hands the moment back, and ends on two or three new choices that move the plot.` +
      (!ctx.openEnded && ctx.sceneIndex === ctx.sceneCount - 2 ? ' This is the climax: the stakes are at their highest.' : '') +
      ` Your quip reacts in your own voice, never as a hero.`, true);
  },

  async finale(ctx, resolution): Promise<FinaleScene> {
    return write(ctx, FinaleSchema,
      `${storyPrompt(ctx, resolution)}\n\nResolve the final vote (outcome + chosenChoiceId), then write the epilogue ` +
      `(scene ${ctx.sceneIndex + 1} of ${ctx.sceneCount}, no choices): how the adventure ends in the world, the ` +
      `consequences of the choices the party actually made, and a closing image. Do not invent what the heroes say, ` +
      `feel or decide. Your quip bids the table farewell, in your own voice.`, false);
  },

  async classifyAction(ctx, request) {
    const listed = request.actions.map((id) => {
      const choice = request.choices.find((c) => c.id === id);
      return choice ? `${id} ("${choice.label}")` : id;
    }).join(', ');
    const { output } = await generateText({
      model: textModel(),
      instructions: `${dmInstructions(ctx)}\n\n${CLASSIFY}`,
      prompt: `${request.characterName} writes: "${request.text}"\n` +
        `This is ${request.inCombat ? 'a combat round' : 'not a fight'}.\n` +
        `Actions the text may map onto: ${listed || '(none)'}.\n` +
        `Choices on offer: ${request.choices.map((c) => `(${c.id}) ${c.label}`).join('; ') || '(none)'}.`,
      output: Output.object({ schema: RulingSchema }),
    });
    return output;
  },
};
