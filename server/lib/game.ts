import { randomInt } from 'node:crypto';
import { renderImage, SCENE_STYLE } from './ai.ts';
import { runInBackground } from './background.ts';
import { archetype, DEFAULT_DUNGEON_MASTER, isValid, nameOf } from './catalog.ts';
import { ownCharacter, storable, upgradeCharacter } from './characters.ts';
import { COMBAT_CHOICES } from './play/fight.ts';
import { choiceView, dungeonMode, engineStep, type EngineStep, newRules, rulesStateOf, sceneCountAfter, storedChoice, writeBack } from './play/table.ts';
import type { RulesState } from './play/turn.ts';
import { rulesContext, rulesView, type RulesView } from './play/view.ts';
import { anyonesChoices, canAct, yourChoices } from './play/your-turn.ts';
import { getDungeonMaster } from './dm/registry.ts';
import type { DMChoice, DMContext, NextScene, PartyMember, PastScene, Resolution, ResolvedTurn, SceneText, VoteRecord } from './dm/types.ts';
import { badRequest, conflict, forbidden, HttpError, notFound } from './http.ts';
import { getImageStore, type StoredImage } from './images/index.ts';
import { narrate, spokenText } from './voice.ts';
import { getStore } from './store/index.ts';
import type { GamePatch, NewMessage } from './store/types.ts';
import { CHOICE_IDS, type Character, type ChoiceId, type Game, type GamePlayer, type GameState, type Message, type SceneView, type StoredChoice, type StoredScene } from './types.ts';

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
/** DD_SEED fixes a rules game's dice (local dev: the same map and the same fights every time). */
const RANDOM_DICE: Dice = { d20: () => randomInt(1, 21), seed: () => Number(process.env.DD_SEED) || randomInt(2 ** 31) };
let dice = RANDOM_DICE;
export function setDice(next: Dice = RANDOM_DICE): void {
  dice = next;
}

// ---------------------------------------------------------------------------------------------------------
// Views

/** A combat round's choices are written for the caller's own hero (play/your-turn.ts); a resolved scene keeps what was stored. */
function choicesFor(game: Game, current: StoredScene, playerId: string): SceneView['choices'] {
  if (!game.combat || !game.party || current.outcome !== null || current.isFinale) return current.choices.map(choiceView);
  return canAct(game.combat, playerId) ? yourChoices(game.combat, game.party.sheets[playerId], playerId) : anyonesChoices();
}

/** In a combat round each vote says what that hero is doing: the label of their own choice, which differs hero to hero. */
function votesFor(game: Game, current: StoredScene): SceneView['votes'] {
  const { combat, party } = game;
  if (!combat || !party || current.outcome !== null || current.isFinale) return current.votes;
  return current.votes.map((v) => {
    if (!canAct(combat, v.playerId) || !Object.hasOwn(party.sheets, v.playerId)) return v;
    const label = yourChoices(combat, party.sheets[v.playerId], v.playerId).find((c) => c.id === v.choiceId)?.label;
    return label ? { ...v, label } : v;
  });
}

function sceneView(game: Game, current: StoredScene, playerId: string): SceneView {
  return {
    index: current.index,
    title: current.title,
    narration: current.narration,
    imageUrl: current.imageUrl,
    voiceUrl: current.voiceUrl,
    choices: choicesFor(game, current, playerId),
    combat: game.combat !== null,
    canAct: canAct(game.combat, playerId),
    isFinale: current.isFinale,
    votes: votesFor(game, current),
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

/** A stored scene that was a combat round: its choices are the three fixed actions. */
const wasRound = (scene: StoredScene): boolean =>
  scene.choices.length === COMBAT_CHOICES.length && scene.choices.every((c, i) => c.label === COMBAT_CHOICES[i].label && !c.hook);

/** The player's character as it stands in this game: its live sheet once the rules engine holds one. */
function heroInGame(game: Game, { playerId, character }: GamePlayer): Character {
  const live = game.party && Object.hasOwn(game.party.sheets, playerId) ? game.party.sheets[playerId] : character.sheet;
  return upgradeCharacter({ ...character, sheet: live });
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
    players: game.players.map((p) => ({ playerId: p.playerId, character: heroInGame(game, p), isHost: p.playerId === game.hostId, joinedAt: p.joinedAt })),
    scene: current && sceneView(game, current, playerId),
    chronicle: game.scenes
      .filter((s) => s.outcome !== null)
      .map((s) => {
        const combat = wasRound(s);
        return {
          index: s.index,
          title: s.title,
          imageUrl: s.imageUrl,
          voiceUrl: s.voiceUrl,
          // In a round each hero took their own action: there is no one choice the party made.
          choiceLabel: combat ? '' : (s.choices.find((c) => c.id === s.chosenChoiceId)?.label ?? ''),
          outcome: s.outcome as string,
          combat,
        };
      }),
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

/** One of your heroes who is fit to go: the dead stay dead until revived. */
async function livingCharacter(playerId: string, characterId: unknown): Promise<Character> {
  const character = await ownCharacter(playerId, characterId);
  if (character.sheet.dead) throw conflict(`${character.name} is dead`);
  return character;
}

/** POST /api/games */
export async function createGame(playerId: string, characterId: unknown, dungeonMaster: unknown): Promise<GameState> {
  if (dungeonMaster !== undefined && dungeonMaster !== null && !isValid('dungeonMaster', dungeonMaster)) {
    throw badRequest('unknown dungeonMaster');
  }
  const character = await livingCharacter(playerId, characterId);
  const store = getStore();
  const host: GamePlayer = { playerId, character: storable(character), joinedAt: new Date().toISOString() };
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
  const character = await livingCharacter(playerId, characterId);
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
  const joined = await getStore().upsertPlayer(code, { playerId, character: storable(character), joinedAt: new Date().toISOString() }, MAX_PLAYERS);
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
  if (!canAct(game.combat, playerId)) return viewGame(code, playerId); // a fallen hero has no action: nothing to record
  const vote = await getStore().castVote(code, sceneIndex, playerId, choiceId as ChoiceId, dice.d20());
  if (!vote) throw conflict('voting on that scene has closed');
  await resolveIfAllVoted(code, sceneIndex, origin);
  return viewGame(code, playerId);
}

/** Who reads a scene aloud. Tests may set their own (to count readings, or to fail). */
let narrator = narrate;
export function setNarrator(next: typeof narrate = narrate): void {
  narrator = next;
}

/** How long a claim on a scene's narration lasts with no voice to show for it: its maker is taken for dead. */
const NARRATION_CLAIM_MS = 3 * 60_000;
/** How long the request that started a reading waits for it, to answer with the file (or the failure) itself. */
const NARRATION_WAIT_MS = 20_000;

/**
 * What the narrator reads for a scene, as the app shows it: what came of the scene before, then this scene's
 * telling. A round of a fight is its telling alone (the screen shows the dice in between, not the outcome).
 */
export function narrationText(game: Game, scene: StoredScene): string {
  const before = wasRound(scene) ? null : game.scenes.find((s) => s.index === scene.index - 1)?.outcome;
  return spokenText(before, scene.narration);
}

export interface Narration {
  sceneIndex: number;
  /** "ready": `voiceUrl` is the audio. "making": the narrator is speaking; it will appear on the scene (`scene.voiceUrl`). */
  status: 'ready' | 'making';
  voiceUrl: string | null;
}

/**
 * POST /api/games/{code}/narration — a scene read aloud, on demand and once: the first player to ask has
 * the narrator speak it; the file is kept and every later request gets the same one. The request that
 * started the reading waits for it (up to `waitMs`) and answers with the file, or with a 502 if the reading
 * failed; anyone else asking meanwhile is told it is being made, and finds it on the scene when it is.
 */
export async function requestNarration(code: string, playerId: string, sceneIndex: unknown, origin: string, waitMs = NARRATION_WAIT_MS): Promise<Narration> {
  if (typeof sceneIndex !== 'number' || !Number.isInteger(sceneIndex)) throw badRequest('sceneIndex must be a whole number');
  const game = await loadGame(code);
  member(game, playerId);
  const scene = game.scenes.find((s) => s.index === sceneIndex);
  if (!scene) throw notFound('no such scene');
  if (scene.voiceUrl) return { sceneIndex, status: 'ready', voiceUrl: scene.voiceUrl };
  const text = narrationText(game, scene);
  if (!text) throw conflict('that scene has nothing to read');
  const store = getStore();
  if (!(await store.claimSceneVoice(code, sceneIndex, NARRATION_CLAIM_MS))) return { sceneIndex, status: 'making', voiceUrl: null };

  const reading = (async () => {
    try {
      const url = await getImageStore().save(await narrator(text), 'voices', origin);
      await store.setSceneVoice(code, sceneIndex, url);
      return url;
    } catch (error) {
      await store.setSceneVoice(code, sceneIndex, null); // give the claim back: the next request tries again
      throw error;
    }
  })();
  // The reading outlives this request if it takes longer than the wait.
  runInBackground(`narrate ${code}#${sceneIndex}`, async () => { await reading; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const patience = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
  try {
    const voiceUrl = await Promise.race([reading, patience]);
    return voiceUrl ? { sceneIndex, status: 'ready', voiceUrl } : { sceneIndex, status: 'making', voiceUrl: null };
  } catch {
    throw new HttpError(502, 'the narrator could not read that scene; ask again');
  } finally {
    clearTimeout(timer);
  }
}

/** POST /api/games/{code}/advance — host resolves now with the votes that are in. */
export async function advanceGame(code: string, playerId: string, origin: string): Promise<GameState> {
  const game = await loadGame(code);
  requireHost(game, playerId);
  if (game.status !== 'voting') throw conflict(`can't advance: the game is ${game.status}`);
  const scene = game.scenes.find((s) => s.index === game.sceneIndex);
  // A combat round needs no votes: a hero without one dodges.
  if (!game.combat && !scene?.votes.length) throw conflict('nobody has voted yet');
  await beginResolve(code, game.sceneIndex, origin);
  return viewGame(code, playerId);
}

async function resolveIfAllVoted(code: string, sceneIndex: number, origin: string): Promise<void> {
  const game = await getStore().getGame(code);
  if (!game || game.status !== 'voting' || game.sceneIndex !== sceneIndex || !game.players.length) return;
  const scene = game.scenes.find((s) => s.index === sceneIndex);
  if (!scene) return;
  const voted = new Set(scene.votes.map((v) => v.playerId));
  // A combat round waits only for the heroes that can act.
  const awaited = game.players.filter((p) => canAct(game.combat, p.playerId));
  if (awaited.every((p) => voted.has(p.playerId))) await beginResolve(code, sceneIndex, origin);
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
  /** The next scene is a later round of a fight already under way: it carries the fight's picture instead of a new one. */
  sharesPicture: boolean;
}

/**
 * The engine threw. A table must never be stranded by a rules error (the game would sit in "resolving" for
 * good), so the scene resolves without the engine: a fight under way breaks off, a choice is settled
 * without dice, the chat says so, and the error is logged for whoever maintains the engine.
 */
function withoutTheEngine(state: RulesState, resolution: Resolution, error: unknown): EngineStep {
  console.error('rules engine failed; resolving the scene without it:', error);
  const inFight = state.combat !== null;
  const lines = [inFight ? 'The rules engine stumbled: the fight breaks off.' : 'The rules engine stumbled: this choice is settled without dice.'];
  const chosen = inFight ? null : (resolution.leaders[0] ?? null);
  return {
    state: { party: { ...state.party, results: lines }, combat: null, dungeon: state.dungeon },
    resolution: { ...resolution, leaders: chosen ? [chosen] : [], rules: { chosen, lines, success: null, fight: null } },
    fight: null,
    round: inFight,
  };
}

function safeStep(state: RulesState, scene: StoredScene, resolution: Resolution): EngineStep {
  try {
    return engineStep(state, scene, resolution);
  } catch (error) {
    return withoutTheEngine(state, resolution, error);
  }
}

function planOf(game: Game, scene: StoredScene): Plan {
  const resolution = resolutionOf(game, scene);
  const next = scene.index + 1;
  const state = rulesStateOf(game);
  if (!state) return { resolution, next, isFinale: next >= game.sceneCount - 1, rules: null, patch: {}, lines: [], sharesPicture: false };
  const step = safeStep(state, scene, resolution);
  const sceneCount = sceneCountAfter(step, next, game.sceneCount);
  const { party } = step.state;
  const sharesPicture = step.round && step.state.combat !== null;
  return { resolution: step.resolution, next, isFinale: next >= sceneCount - 1, rules: step.state, patch: { ...step.state, sceneCount }, lines: party.results!, sharesPicture };
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
    imagePrompt: plan.sharesPicture ? SHARED_PICTURE : draft.imagePrompt,
    imageUrl: plan.sharesPicture ? scene.imageUrl : null,
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
  if (plan.sharesPicture) await catchUpPicture(code, sceneIndex, plan.next);
  else await paintScene(code, plan.next, draft, origin);
}

/**
 * One picture per fight: paintings are most of what a game costs, and a fight is one place. The round that
 * begins it is painted; each later round is stored with this in place of an image prompt and carries the
 * same picture.
 */
const SHARED_PICTURE = '';

/** Sets a scene's picture and hands it on to the later rounds of the same fight that are waiting for it. */
export async function shareSceneImage(code: string, index: number, url: string): Promise<void> {
  const store = getStore();
  await store.setSceneImage(code, index, url);
  const later = ((await store.getGame(code))?.scenes ?? []).filter((s) => s.index > index).sort((a, b) => a.index - b.index);
  for (const s of later) {
    if (s.imagePrompt !== SHARED_PICTURE || s.isFinale) return;
    if (s.imageUrl === null) await store.setSceneImage(code, s.index, url);
  }
}

/** The fight's picture landed between reading the last round and writing this one: take it now. */
async function catchUpPicture(code: string, from: number, to: number): Promise<void> {
  const store = getStore();
  const scenes = (await store.getGame(code))?.scenes ?? [];
  const url = scenes.find((s) => s.index === from)?.imageUrl;
  if (url && scenes.find((s) => s.index === to)?.imageUrl === null) await store.setSceneImage(code, to, url);
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
    await shareSceneImage(code, index, url);
  } catch (error) {
    console.error(`painting ${code}#${index} failed:`, error);
  }
}
