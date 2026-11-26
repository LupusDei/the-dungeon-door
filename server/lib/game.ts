import { randomInt } from 'node:crypto';
import { renderImage, SCENE_STYLE } from './ai.ts';
import { runInBackground } from './background.ts';
import { archetype, DEFAULT_DUNGEON_MASTER, isValid, nameOf } from './catalog.ts';
import { ownCharacter } from './characters.ts';
import { COMBAT_CHOICES } from './play/fight.ts';
import { choiceView, dungeonMode, engineStep, newRules, rulesStateOf, sceneCountAfter, storedChoice, writeBack } from './play/table.ts';
import type { RulesState } from './play/turn.ts';
import { rulesContext, rulesView, type RulesView } from './play/view.ts';
import { getDungeonMaster } from './dm/registry.ts';
import type { DMChoice, DMContext, NextScene, PartyMember, PastScene, Resolution, ResolvedTurn, SceneText, VoteRecord } from './dm/types.ts';
import { badRequest, conflict, forbidden, notFound } from './http.ts';
import { getImageStore, type StoredImage } from './images/index.ts';
import { getStore } from './store/index.ts';
import type { GamePatch, NewMessage } from './store/types.ts';
import { CHOICE_IDS, type ChoiceId, type Game, type GamePlayer, type GameState, type Message, type SceneView, type StoredChoice, type StoredScene } from './types.ts';

export const MAX_PLAYERS = 6;
export const DEFAULT_SCENE_COUNT = 4;
/** Join codes: 6 characters, uppercase, no 0/O/1/I. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export function newCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

const clip = (text: string, max = 500) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The game's dice: each vote's d20, and the seed of a rules game's dice. Tests may set their own. */
export interface Dice { d20(): number; seed(): number }
const RANDOM_DICE: Dice = { d20: () => randomInt(1, 21), seed: () => randomInt(2 ** 31) };
let dice = RANDOM_DICE;
export function setDice(next: Dice = RANDOM_DICE): void {
  dice = next;
}

// ---------------------------------------------------------------------------------------------------------
// Views

function sceneView(game: Game, current: StoredScene, playerId: string): SceneView {
  return {
    index: current.index,
    title: current.title,
    narration: current.narration,
    imageUrl: current.imageUrl,
    choices: current.choices.map(choiceView),
    combat: game.combat !== null,
    isFinale: current.isFinale,
    votes: current.votes,
    myVote: current.votes.find((v) => v.playerId === playerId)?.choiceId ?? null,
    outcome: current.outcome,
  };
}

function rulesOf(game: Game): RulesView | null {
  const state = rulesStateOf(game);
  if (!state) return null;
  const { results = [] } = state.party;
  return rulesView(state, results);
}

export function toState(game: Game, playerId: string, messages: Message[]): GameState {
  const current = game.scenes.find((s) => s.index === game.sceneIndex) ?? null;
  return {
    code: game.code,
    hostId: game.hostId,
    status: game.status,
    dungeonMaster: game.dungeonMaster,
    title: game.title,
    sceneCount: game.sceneCount,
    players: game.players.map((p) => ({ playerId: p.playerId, character: p.character, isHost: p.playerId === game.hostId, joinedAt: p.joinedAt })),
    scene: current && sceneView(game, current, playerId),
    chronicle: game.scenes
      .filter((s) => s.outcome !== null)
      .map((s) => ({
        index: s.index,
        title: s.title,
        imageUrl: s.imageUrl,
        choiceLabel: s.choices.find((c) => c.id === s.chosenChoiceId)?.label ?? '',
        outcome: s.outcome as string,
      })),
    messages,
    rules: rulesOf(game),
    updatedAt: game.updatedAt,
  };
}

async function loadGame(code: string): Promise<Game> {
  if (!CODE_PATTERN.test(code)) throw notFound('no such game');
  const game = await getStore().getGame(code);
  if (!game) throw notFound('no such game');
  return game;
}

function member(game: Game, playerId: string): GamePlayer {
  const player = game.players.find((p) => p.playerId === playerId);
  if (!player) throw forbidden('you are not in this game');
  return player;
}

function requireHost(game: Game, playerId: string): GamePlayer {
  const player = member(game, playerId);
  if (game.hostId !== playerId) throw forbidden('only the host can do that');
  return player;
}

const system = (code: string, text: string) => say(code, { kind: 'system', playerId: null, characterName: null, text });
const dmSays = (code: string, game: Pick<Game, 'dungeonMaster'>, text: string) =>
  say(code, { kind: 'dm', playerId: null, characterName: archetype(game.dungeonMaster).name, text });

async function say(code: string, message: NewMessage): Promise<Message> {
  return getStore().addMessage(code, { ...message, text: clip(message.text.trim() || '…') });
}

/** GET /api/games/{code}?since= */
export async function viewGame(code: string, playerId: string, since?: number): Promise<GameState> {
  const store = getStore();
  const [game, messages] = await Promise.all([loadGame(code), store.listMessages(code, since)]);
  member(game, playerId);
  return toState(game, playerId, messages);
}

// ---------------------------------------------------------------------------------------------------------
// Lobby

/** POST /api/games */
export async function createGame(playerId: string, characterId: unknown, dungeonMaster: unknown): Promise<GameState> {
  if (dungeonMaster !== undefined && dungeonMaster !== null && !isValid('dungeonMaster', dungeonMaster)) {
    throw badRequest('unknown dungeonMaster');
  }
  const character = await ownCharacter(playerId, characterId);
  const store = getStore();
  const host: GamePlayer = { playerId, character, joinedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = newCode();
    const created = await store.createGame({
      code,
      hostId: playerId,
      dungeonMaster: (dungeonMaster as string | undefined) ?? DEFAULT_DUNGEON_MASTER,
      sceneCount: DEFAULT_SCENE_COUNT,
      host,
    });
    if (created) {
      await system(code, `${character.name} found the dungeon door. Share the code ${code} to invite the party.`);
      return viewGame(code, playerId);
    }
  }
  throw new Error('could not find a free game code');
}

/** POST /api/games/{code}/join */
export async function joinGame(code: string, playerId: string, characterId: unknown): Promise<GameState> {
  const character = await ownCharacter(playerId, characterId);
  const game = await loadGame(code);
  const existing = game.players.find((p) => p.playerId === playerId);
  if (game.status !== 'lobby') {
    // Re-joining a game you're already in (e.g. after an app restart) just returns it.
    if (existing) return viewGame(code, playerId);
    throw conflict('this adventure has already begun');
  }
  if (!existing && game.players.length >= MAX_PLAYERS) throw conflict(`the party is full (${MAX_PLAYERS} players)`);
  if (existing?.character.id === character.id && existing.character.updatedAt === character.updatedAt) {
    return viewGame(code, playerId);
  }
  const joined = await getStore().upsertPlayer(code, { playerId, character, joinedAt: new Date().toISOString() }, MAX_PLAYERS);
  if (!joined) throw conflict('could not join: the game started or the party is full');
  if (!existing) await system(code, `${character.name} joined the party.`);
  else if (existing.character.id !== character.id) await system(code, `${character.name} takes ${existing.character.name}'s place.`);
  return viewGame(code, playerId);
}

/** POST /api/games/{code}/leave */
export async function leaveGame(code: string, playerId: string, origin: string): Promise<void> {
  const game = await loadGame(code);
  const leaving = game.players.find((p) => p.playerId === playerId);
  if (!leaving) return; // already gone
  const store = getStore();
  await store.removePlayer(code, playerId);
  const remaining = game.players.filter((p) => p.playerId !== playerId);
  let text = `${leaving.character.name} left the party.`;
  if (game.hostId === playerId && remaining.length) {
    const next = [...remaining].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0];
    await store.updateGame(code, {}, { hostId: next.playerId });
    text += ` ${next.character.name} now leads the table.`;
  }
  await system(code, text);
  if (game.status === 'voting' && remaining.length) await resolveIfAllVoted(code, game.sceneIndex, origin);
}

/** POST /api/games/{code}/messages */
export async function postMessage(code: string, playerId: string, text: unknown): Promise<Message> {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed || trimmed.length > 500) throw badRequest('text must be 1–500 characters');
  const game = await loadGame(code);
  const player = member(game, playerId);
  return getStore().addMessage(code, { kind: 'chat', playerId, characterName: player.character.name, text: trimmed });
}

/** POST /api/games/{code}/dungeon-master */
export async function setDungeonMaster(code: string, playerId: string, dungeonMaster: unknown): Promise<GameState> {
  if (!isValid('dungeonMaster', dungeonMaster)) throw badRequest('unknown dungeonMaster');
  const game = await loadGame(code);
  requireHost(game, playerId);
  if (game.status !== 'lobby') throw conflict('the dungeon master can only change in the lobby');
  if (game.dungeonMaster !== dungeonMaster) {
    if (!(await getStore().updateGame(code, { status: 'lobby' }, { dungeonMaster }))) throw conflict('the adventure has already begun');
    await system(code, `${archetype(dungeonMaster).name} will be the dungeon master.`);
  }
  return viewGame(code, playerId);
}

// ---------------------------------------------------------------------------------------------------------
// Play

/** POST /api/games/{code}/start — lobby → preparing; the DM writes scene 0 in the background. */
export async function startGame(code: string, playerId: string, sceneCount: unknown, origin: string, dungeon?: unknown): Promise<GameState> {
  const count = sceneCount === undefined || sceneCount === null ? DEFAULT_SCENE_COUNT : sceneCount;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 2 || count > 8) {
    throw badRequest('sceneCount must be a whole number from 2 to 8');
  }
  const mode = dungeonMode(dungeon);
  const game = await loadGame(code);
  const host = requireHost(game, playerId);
  if (game.status !== 'lobby') throw conflict(`can't start: the game is ${game.status}`);
  const rules = newRules(game.players, mode, dice.seed(), count);
  if (!(await getStore().updateGame(code, { status: 'lobby' }, { status: 'preparing', sceneCount: count, ...rules }))) {
    throw conflict('the game is already starting');
  }
  await system(code, `${host.character.name} opened the dungeon door. ${archetype(game.dungeonMaster).name} is preparing the adventure…`);
  runInBackground(`opening ${code}`, () => writeOpening(code, origin));
  return viewGame(code, playerId);
}

/** POST /api/games/{code}/vote */
export async function castVote(code: string, playerId: string, sceneIndex: unknown, choiceId: unknown, origin: string): Promise<GameState> {
  if (typeof sceneIndex !== 'number' || !Number.isInteger(sceneIndex)) throw badRequest('sceneIndex must be a whole number');
  if (!CHOICE_IDS.includes(choiceId as ChoiceId)) throw badRequest('choiceId must be "a", "b" or "c"');
  const game = await loadGame(code);
  member(game, playerId);
  if (game.status !== 'voting') throw conflict(`can't vote: the game is ${game.status}`);
  if (sceneIndex !== game.sceneIndex) throw conflict('that scene is not the current one');
  const vote = await getStore().castVote(code, sceneIndex, playerId, choiceId as ChoiceId, dice.d20());
  if (!vote) throw conflict('voting on that scene has closed');
  await resolveIfAllVoted(code, sceneIndex, origin);
  return viewGame(code, playerId);
}

/** POST /api/games/{code}/advance — host resolves now with the votes that are in. */
export async function advanceGame(code: string, playerId: string, origin: string): Promise<GameState> {
  const game = await loadGame(code);
  requireHost(game, playerId);
  if (game.status !== 'voting') throw conflict(`can't advance: the game is ${game.status}`);
  const scene = game.scenes.find((s) => s.index === game.sceneIndex);
  if (!scene?.votes.length) throw conflict('nobody has voted yet');
  await beginResolve(code, game.sceneIndex, origin);
  return viewGame(code, playerId);
}

async function resolveIfAllVoted(code: string, sceneIndex: number, origin: string): Promise<void> {
  const game = await getStore().getGame(code);
  if (!game || game.status !== 'voting' || game.sceneIndex !== sceneIndex || !game.players.length) return;
  const scene = game.scenes.find((s) => s.index === sceneIndex);
  if (!scene) return;
  const voted = new Set(scene.votes.map((v) => v.playerId));
  if (game.players.every((p) => voted.has(p.playerId))) await beginResolve(code, sceneIndex, origin);
}

/** voting → resolving, exactly once per scene (compare-and-set); the winner kicks off the DM. */
async function beginResolve(code: string, sceneIndex: number, origin: string): Promise<boolean> {
  const won = await getStore().updateGame(code, { status: 'voting', sceneIndex }, { status: 'resolving' });
  if (won) runInBackground(`resolve ${code}#${sceneIndex}`, () => resolveScene(code, sceneIndex, origin));
  return won;
}

// ---------------------------------------------------------------------------------------------------------
// Background: the DM writes, the painter paints

function partyOf(game: Game): PartyMember[] {
  return game.players.map(({ playerId, character: c }) => ({
    playerId,
    name: c.name,
    race: nameOf('race', c.race),
    characterClass: nameOf('characterClass', c.characterClass),
    gender: nameOf('gender', c.gender),
    temperament: nameOf('temperament', c.temperament),
    alignment: nameOf('alignment', c.alignment),
    backstory: c.backstory,
    description: c.description,
    appearance: c.appearance || c.description || `a ${nameOf('race', c.race)} ${nameOf('characterClass', c.characterClass)}`,
  }));
}

function voteRecords(game: Game, scene: StoredScene): VoteRecord[] {
  return scene.votes.map((v) => ({
    playerId: v.playerId,
    characterName: game.players.find((p) => p.playerId === v.playerId)?.character.name ?? 'A departed adventurer',
    choiceId: v.choiceId,
    choiceLabel: scene.choices.find((c) => c.id === v.choiceId)?.label ?? v.choiceId,
    roll: v.roll,
  }));
}

function pastScene(game: Game, scene: StoredScene): PastScene {
  return {
    index: scene.index,
    title: scene.title,
    narration: scene.narration,
    choices: scene.choices,
    votes: voteRecords(game, scene),
    outcome: scene.outcome,
    chosenChoiceId: scene.chosenChoiceId,
  };
}

async function contextFor(game: Game, sceneIndex: number, rules: RulesState | null = rulesStateOf(game)): Promise<DMContext> {
  const messages = await getStore().listMessages(game.code, undefined, 20);
  return {
    archetype: archetype(game.dungeonMaster),
    adventureTitle: game.title,
    party: partyOf(game),
    history: game.scenes.filter((s) => s.index < sceneIndex).map((s) => pastScene(game, s)),
    sceneIndex,
    sceneCount: game.sceneCount,
    recentChat: messages
      .filter((m) => m.kind !== 'system')
      .map((m) => ({ characterName: m.characterName, kind: m.kind as 'chat' | 'dm', text: m.text })),
    rules: rules && rulesContext(rules),
  };
}

export function resolutionOf(game: Game, scene: StoredScene): Resolution {
  // Votes from players still at the table (everyone's, if nobody is left).
  const present = scene.votes.filter((v) => game.players.some((p) => p.playerId === v.playerId));
  const votes = voteRecords(game, { ...scene, votes: present.length ? present : scene.votes });
  const tally = { a: 0, b: 0, c: 0 } as Record<ChoiceId, number>;
  for (const v of votes) tally[v.choiceId]++;
  const top = Math.max(...CHOICE_IDS.map((id) => tally[id]));
  const voted = new Set(votes.map((v) => v.playerId));
  return {
    scene: pastScene(game, scene),
    votes,
    tally,
    leaders: CHOICE_IDS.filter((id) => tally[id] === top && top > 0),
    abstained: game.players.filter((p) => !voted.has(p.playerId)).map((p) => p.character.name),
    rules: null,
  };
}

/** The DM's three choices, clipped; in a rules game each keeps its hook if the hook holds up. */
function choicesOf(choices: DMChoice[], rules: boolean): StoredChoice[] {
  if (choices.length < 3) throw new Error(`the DM wrote ${choices.length} choices, not 3`);
  return choices.slice(0, 3).map((c, i) => {
    const choice = { id: CHOICE_IDS[i], label: clip(c.label.trim(), 80), detail: clip(c.detail.trim(), 300) };
    return rules ? storedChoice(choice, c.rules) : choice;
  });
}

const sceneTitle = (text: SceneText, fallback: string) => clip(text.title?.trim() || fallback, 120);

async function writeOpening(code: string, origin: string): Promise<void> {
  const store = getStore();
  const game = await store.getGame(code);
  if (!game || game.status !== 'preparing') return;
  let draft;
  try {
    draft = await getDungeonMaster(game.dungeonMaster).openingScene(await contextFor(game, 0));
    const scene = {
      index: 0,
      title: sceneTitle(draft, 'The Dungeon Door'),
      narration: draft.narration.trim(),
      imagePrompt: draft.imagePrompt,
      imageUrl: null,
      choices: choicesOf(draft.choices, game.party !== null),
      isFinale: false,
    };
    await store.saveScene(code, scene);
  } catch (error) {
    console.error(`DM failed to open ${code}:`, error);
    if (await store.updateGame(code, { status: 'preparing' }, { status: 'lobby' })) {
      await system(code, `The dungeon master lost their notes and couldn't begin. The host can press start to try again.`);
    }
    return;
  }
  const title = clip(draft.adventureTitle?.trim() || 'An Untold Adventure', 120);
  if (!(await store.updateGame(code, { status: 'preparing' }, { status: 'voting', sceneIndex: 0, title }))) return;
  if (draft.quip) await dmSays(code, game, draft.quip);
  await paintScene(code, 0, draft, origin);
}

/** What resolving a scene will do: the engine's step (rules games), the resolution the DM gets, what comes next. */
interface Plan {
  resolution: Resolution;
  next: number;
  isFinale: boolean;
  /** The engine's state after its step; null for a game from before the engine. */
  rules: RulesState | null;
  /** Saved with the move to the next scene. */
  patch: GamePatch;
  /** The engine's dice lines, posted to the chat. */
  lines: string[];
}

function planOf(game: Game, scene: StoredScene): Plan {
  const resolution = resolutionOf(game, scene);
  const next = scene.index + 1;
  const state = rulesStateOf(game);
  if (!state) return { resolution, next, isFinale: next >= game.sceneCount - 1, rules: null, patch: {}, lines: [] };
  const step = engineStep(state, scene, resolution);
  const sceneCount = sceneCountAfter(step, next, game.sceneCount);
  const { party } = step.state;
  return { resolution: step.resolution, next, isFinale: next >= sceneCount - 1, rules: step.state, patch: { ...step.state, sceneCount }, lines: party.results! };
}

/** The next scene's choices: a fight's Attack, Cast and Dodge, or the DM's. */
function nextChoices(plan: Plan, draft: NextScene): StoredChoice[] {
  if (plan.rules?.combat) return COMBAT_CHOICES.map((c, i) => ({ id: CHOICE_IDS[i], ...c }));
  return choicesOf(draft.choices, plan.rules !== null);
}

async function writeNext(game: Game, scene: StoredScene, plan: Plan) {
  const dm = getDungeonMaster(game.dungeonMaster);
  const ctx = await contextFor(game, plan.next, plan.rules); // history ends with the scene being resolved
  const draft = plan.isFinale ? await dm.finale(ctx, plan.resolution) : await dm.nextScene(ctx, plan.resolution);
  const { leaders } = plan.resolution;
  const chosen = leaders.includes(draft.chosenChoiceId) ? draft.chosenChoiceId : (leaders[0] ?? null);
  const store = getStore();
  await store.setSceneOutcome(game.code, scene.index, clip(draft.outcome.trim(), 1000), chosen);
  await store.saveScene(game.code, {
    index: plan.next,
    title: sceneTitle(draft, plan.isFinale ? 'Epilogue' : `Scene ${plan.next + 1}`),
    narration: draft.narration.trim(),
    imagePrompt: draft.imagePrompt,
    imageUrl: null,
    choices: plan.isFinale ? [] : nextChoices(plan, draft as NextScene),
    isFinale: plan.isFinale,
  });
  return draft;
}

/** The adventure is over: each hero's sheet goes home to its character. */
async function sendHeroesHome(game: Game, rules: RulesState | null): Promise<void> {
  if (!rules) return;
  const store = getStore();
  for (const { characterId, sheet } of writeBack(rules.party, game.players)) {
    const character = await store.getCharacter(characterId);
    if (character) await store.saveCharacter({ ...character, sheet, updatedAt: new Date().toISOString() });
  }
}

async function resolveScene(code: string, sceneIndex: number, origin: string): Promise<void> {
  const store = getStore();
  const game = await store.getGame(code);
  const scene = game?.scenes.find((s) => s.index === sceneIndex);
  if (!game || !scene || game.status !== 'resolving' || game.sceneIndex !== sceneIndex) return;
  const plan = planOf(game, scene);
  let draft;
  try {
    draft = await writeNext(game, scene, plan);
  } catch (error) {
    await dmFumbled(code, sceneIndex, error);
    return;
  }
  const status = plan.isFinale ? 'ended' : 'voting';
  if (!(await store.updateGame(code, { status: 'resolving', sceneIndex }, { status, sceneIndex: plan.next, ...plan.patch }))) return;
  await announce(game, plan, draft);
  await paintScene(code, plan.next, draft, origin);
}

/** The DM threw: votes reopen (once) and the table hears about it. */
async function dmFumbled(code: string, sceneIndex: number, error: unknown): Promise<void> {
  console.error(`DM failed to resolve ${code}#${sceneIndex}:`, error);
  if (await getStore().updateGame(code, { status: 'resolving', sceneIndex }, { status: 'voting' })) {
    await system(code, `The dungeon master fumbled their dice. Votes are still open; the host can advance to try again.`);
  }
}

/** The dice, then the DM's outcome and quip; at the end, the heroes go home. */
async function announce(game: Game, plan: Plan, draft: ResolvedTurn & SceneText): Promise<void> {
  for (const line of plan.lines) await system(game.code, line);
  await dmSays(game.code, game, draft.outcome);
  if (draft.quip) await dmSays(game.code, game, draft.quip);
  if (!plan.isFinale) return;
  await sendHeroesHome(game, plan.rules);
  await system(game.code, 'The adventure has ended. Thanks for playing!');
}

/** Paints a scene and fills in its imageUrl. Failures leave the image null (the text is already live). */
async function paintScene(code: string, index: number, text: SceneText, origin: string): Promise<void> {
  try {
    const store = getStore();
    const game = await store.getGame(code);
    if (!game) return;
    const dmArchetype = archetype(game.dungeonMaster);
    const featuredNames = new Set((text.featuredCharacters ?? []).map((n) => n.toLowerCase()));
    let featured = game.players.filter((p) => featuredNames.has(p.character.name.toLowerCase()));
    if (!featured.length) featured = game.players;
    featured = featured.slice(0, 4);

    const images = getImageStore();
    const references: StoredImage[] = [];
    const castLines: string[] = [];
    for (const { character: c } of featured) {
      const image = c.portraitUrl ? await images.load(c.portraitUrl).catch(() => null) : null;
      if (image) references.push(image);
      const look = c.appearance || c.description || `a ${nameOf('race', c.race)} ${nameOf('characterClass', c.characterClass)}`;
      castLines.push(`- ${c.name}${image ? ` (reference portrait ${references.length})` : ''}: ${look}`);
    }
    const cast = castLines.join('\n');
    const prompt = `${SCENE_STYLE} Art direction: ${dmArchetype.artStyle}.\n\nThe scene: ${text.imagePrompt}\n\n` +
      `The characters who appear:\n${cast}`;
    const image = await renderImage({ prompt, references, aspectRatio: '3:2', seed: `${code}#${index}:${text.title}` });
    const url = await images.save(image, 'scenes', origin);
    await store.setSceneImage(code, index, url);
  } catch (error) {
    console.error(`painting ${code}#${index} failed:`, error);
  }
}
