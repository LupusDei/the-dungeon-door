import { randomInt } from 'node:crypto';
import { renderImage, SCENE_STYLE } from './ai.ts';
import { runInBackground } from './background.ts';
import { archetype, DEFAULT_DUNGEON_MASTER, isValid, nameOf } from './catalog.ts';
import { homecoming, ownCharacter, storable, upgradeCharacter } from './characters.ts';
import { deathIn, newlyFallen } from './fallen.ts';
import { attackStartsFight, isPersonalCheck, knownActionIds, rulingForAbility, rulingForSkill, settleRuling, UNREADABLE } from './play/actions.ts';
import { foesNamed, startsFight } from './play/hooks.ts';
import { dieForAction, dieForCheck, rollPending, type PlayerDie } from './play/dice.ts';
import { TURN_SECONDS, turnWindow } from './play/turn-clock.ts';
import { COMBAT_CHOICES } from './play/fight.ts';
import { foeLevels } from './play/delve.ts';
import { choiceView, dungeonMode, endingOf, endQuest, engineStep, type EngineStep, newRules, rulesStateOf, storedChoice, writeBack } from './play/table.ts';
import type { PartyState } from './play/state.ts';
import { markRoadEnd, sceneProgress } from './play/progress.ts';
import { questClosed, questOpen, towardTheGoal } from './play/quest.ts';
import { TREK_SCENES } from './play/trek.ts';
import { confrontationChoices, type RulesState } from './play/turn.ts';
import { rulesContext, rulesView, type RulesView } from './play/view.ts';
import { checkVote, legalActions } from './play/legal.ts';
import { anyonesChoices, canAct, yourChoices } from './play/your-turn.ts';
import { sceneHeading } from './dm/pacing.ts';
import { getDungeonMaster } from './dm/registry.ts';
import { canSee, chatLines, interpretChat, oneEmoji, parseMentions, quoteOf, replyIdOf, TYPING_MS, voiceOf } from './chat.ts';
import { hasStolenHeroSpeech, keptWords, stripHeroSpeech, type HeroLine } from './dm/playerVoice.ts';
import { pushChat, pushForget, pushSceneReady, pushSeen } from './push/notify.ts';
import type { DMChoice, DMContext, NextScene, OpeningScene, PartyMember, PastScene, Resolution, ResolvedTurn, SceneText, VoteRecord } from './dm/types.ts';
import { parseMove, validateMove } from './rules/bands.ts';
import type { CharacterSheet } from './rules/sheet.ts';
import { paceOf } from './rules/inventory.ts';
import { ensureGrid } from './rules/scene.ts';
import { RuleViolation } from './rules/violation.ts';
import { appVersionOf, isOutdated, partyOutdated } from './app-version.ts';
import { badRequest, conflict, forbidden, gameCodeOf, HttpError, notFound, requirePlayer } from './http.ts';
import { OUT_OF_CREDIT, outOfCredit } from './ai-errors.ts';
import { castBrief, castOf } from './scene-art.ts';
import { FEWEST_SCENES, hasNoSetLength, MOST_SCENES, NO_SET_LENGTH, scenesLeft } from './length.ts';
import { getImageStore, type StoredImage } from './images/index.ts';
import { defaultNarrator, narrate, narratorOf, spokenText } from './voice.ts';
import { getStore } from './store/index.ts';
import type { GamePatch, NewMessage } from './store/types.ts';
import { CHOICE_IDS, type Character, type ChoiceId, type Game, type GamePlayer, type GameState, type LegalAction, type Mention, type Message, type RoleplayLine, type SceneView, type StoredChoice, type StoredScene, type TurnResult, type TypingNotice, type Vote } from './types.ts';

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

/** The fight as it is read: a stored fight with no squares is laid onto a grid that keeps its bands. */
function liveCombat(game: Game): Game['combat'] {
  if (!game.combat) return null;
  const speeds = game.party ? Object.fromEntries(Object.entries(game.party.sheets).map(([id, s]) => [id, paceOf(s)])) : {};
  return ensureGrid(game.combat, speeds);
}

/** A combat round's choices are written for the caller's own hero (play/your-turn.ts); a resolved scene keeps what was stored. */
function choicesFor(game: Game, current: StoredScene, playerId: string): SceneView['choices'] {
  const levels = game.party ? foeLevels(game.party, game.dungeon) : undefined;
  const combat = liveCombat(game);
  if (!combat || !game.party || current.outcome !== null || current.isFinale) return current.choices.map((c) => choiceView(c, levels));
  return canAct(combat, playerId) ? yourChoices(combat, game.party.sheets[playerId], playerId) : anyonesChoices();
}

const choosing = (votes: StoredScene['votes']) => votes.filter((v) => !isPersonalCheck(v));

/** A vote as the app sees it: the check's ruling stays off the wire, and intent is the words beside an action. */
function presentVote(vote: StoredScene['votes'][number], label?: string): SceneView['votes'][number] {
  const { freeform, die, revealed: _revealed, roll, ...rest } = vote;
  const pending = rollPending(vote);
  const intent = freeform && !freeform.ruling ? freeform.text : undefined;
  return {
    ...rest,
    roll: pending ? null : roll,
    ...(die ? { formula: die.formula, total: pending ? null : roll + die.modifier } : {}),
    ...(pending ? { pending: true } : {}),
    ...(label ? { label } : {}),
    ...(intent ? { intent } : {}),
  };
}

const shownDie = (vote: StoredScene['votes'][number] | undefined): PlayerDie | null =>
  (vote && rollPending(vote) ? vote.die ?? null : null);

function callerAction(vote: StoredScene['votes'][number] | undefined): SceneView['myAction'] {
  if (!vote || (isPersonalCheck(vote) && !vote.actionId)) return null;
  const intent = vote.freeform?.text;
  return {
    id: vote.actionId ?? `choice:${vote.choiceId}`,
    targets: vote.targets ?? [],
    ...(intent ? { intent } : {}),
  };
}

/** The same turn as one list: the sheet's actions, and the scene's choices. Empty once the scene is settled. */
function actionsFor(game: Game, current: StoredScene, playerId: string): LegalAction[] {
  if (current.outcome !== null || current.isFinale) return [];
  const sheet = game.party && Object.hasOwn(game.party.sheets, playerId) ? game.party.sheets[playerId] : null;
  const combat = liveCombat(game);
  return legalActions({ combat, sheet, playerId, choices: choicesFor(game, current, playerId), canAct: canAct(combat, playerId) });
}

/** In a combat round each vote says what that hero is doing: the label of their own action, which differs hero to hero. */
function votesFor(game: Game, current: StoredScene): SceneView['votes'] {
  const votes = choosing(current.votes);
  const { combat, party } = game;
  if (!combat || !party || current.outcome !== null || current.isFinale) return votes.map((v) => presentVote(v));
  return votes.map((v) => {
    if (!canAct(combat, v.playerId) || !Object.hasOwn(party.sheets, v.playerId)) return presentVote(v);
    const actions = actionsFor(game, current, v.playerId);
    const named = v.actionId ? actions.find((a) => a.id === v.actionId) : undefined;
    const label = named?.label ?? actions.find((a) => a.id === `choice:${v.choiceId}`)?.label;
    return presentVote(v, label);
  });
}

function freeformsFor(current: StoredScene): SceneView['freeforms'] {
  return current.votes.flatMap((v) => {
    if (!isPersonalCheck(v) || !v.freeform) return [];
    const pending = rollPending(v);
    return [{ playerId: v.playerId, text: v.freeform.text, roll: pending ? null : v.roll, ...(pending ? { pending: true } : {}) }];
  });
}

/**
 * The turn's result shows once the engine has played it: while the DM writes, and ever after. It never shows
 * while the table is choosing: a turn the DM fumbled is voted on again, and its old dice are put away
 * (dmFumbled), but until they are, this keeps them off the screen.
 */
const resultFor = (game: Game, current: StoredScene): TurnResult | null =>
  (game.status === 'voting' && current.outcome === null ? null : current.result ?? null);

function sceneView(game: Game, current: StoredScene, playerId: string): SceneView {
  const mine = choosing(current.votes).find((v) => v.playerId === playerId);
  const mineCheck = current.votes.find((v) => v.playerId === playerId && isPersonalCheck(v));
  const mineWritten = freeformsFor(current).find((a) => a.playerId === playerId) ?? null;
  const choices = choicesFor(game, current, playerId);
  const actions = actionsFor(game, current, playerId);
  return {
    index: current.index,
    title: current.title,
    narration: current.narration,
    imageUrl: current.imageUrl,
    voices: current.voices,
    voiceUrl: current.voices[defaultNarrator().id] ?? null,
    choices,
    actions,
    combat: game.combat !== null,
    canAct: canAct(game.combat, playerId),
    battlefield: liveCombat(game)?.battlefield ?? null,
    isFinale: current.isFinale,
    votes: votesFor(game, current),
    myVote: mine?.choiceId ?? null,
    myAction: callerAction(mine) ?? callerAction(mineCheck),
    myDie: shownDie(mine) ?? shownDie(mineCheck),
    freeforms: freeformsFor(current),
    myFreeform: mineWritten,
    outcome: current.outcome,
    result: resultFor(game, current),
    roleplay: current.roleplay ?? [],
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

function playerView(game: Game, p: GamePlayer) {
  const appVersion = p.appVersion ?? null;
  return {
    playerId: p.playerId,
    character: heroInGame(game, p),
    isHost: p.playerId === game.hostId,
    joinedAt: p.joinedAt,
    appVersion,
    outdated: isOutdated(appVersion),
  };
}

/** The player's character as it stands in this game: its live sheet once the rules engine holds one. */
function heroInGame(game: Game, { playerId, character }: GamePlayer): Character {
  const live = game.party && Object.hasOwn(game.party.sheets, playerId) ? game.party.sheets[playerId] : character.sheet;
  return upgradeCharacter({ ...character, sheet: live });
}

/** How long the adventure is, and where the current scene falls in it, the road counted apart (play/progress.ts). */
/** The quest still open on the planned last scene or after it: no count of scenes left (play/quest.ts). */
const pastThePlan = (game: Game): boolean => questOpen(game.party?.quest) && game.sceneIndex >= game.sceneCount - 2;

function lengthOf(game: Game, current: StoredScene | null): Pick<GameState, 'sceneCount' | 'openEnded' | 'scenesLeft' | 'progress'> {
  const open = hasNoSetLength(game.sceneCount);
  const begun = game.status !== 'lobby' && game.status !== 'preparing';
  return {
    sceneCount: open ? 0 : game.sceneCount,
    openEnded: open,
    scenesLeft: begun && !pastThePlan(game) ? scenesLeft(game.sceneCount, game.sceneIndex) : null,
    progress: current && sceneProgress(game.party, current.index, game.sceneCount),
  };
}

export function toState(game: Game, playerId: string, messages: Message[], messageUpdates: Message[] = [], typing: TypingNotice[] = []): GameState {
  const current = game.scenes.find((s) => s.index === game.sceneIndex) ?? null;
  return {
    code: game.code,
    hostId: game.hostId,
    status: game.status,
    dungeonMaster: game.dungeonMaster,
    title: game.title,
    ...lengthOf(game, current),
    players: game.players.map((p) => playerView(game, p)),
    scene: current && sceneView(game, current, playerId),
    chronicle: game.scenes
      .filter((s) => s.outcome !== null)
      .map((s) => {
        const combat = wasRound(s);
        return {
          index: s.index,
          title: s.title,
          imageUrl: s.imageUrl,
          voices: s.voices,
          voiceUrl: s.voices[defaultNarrator().id] ?? null,
          // In a round each hero took their own action: there is no one choice the party made.
          choiceLabel: combat ? '' : (s.choices.find((c) => c.id === s.chosenChoiceId)?.label ?? ''),
          outcome: s.outcome as string,
          result: s.result ?? null,
          combat,
          roleplay: s.roleplay ?? [],
        };
      }),
    messages,
    messageUpdates,
    typing,
    rules: rulesOf(game),
    turn: turnWindow(game.status, current),
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
  const now = new Date().toISOString();
  const [game, messages, messageUpdates, typing] = await Promise.all([
    loadGame(code),
    store.listMessages(code, since),
    since === undefined ? Promise.resolve([] as Message[]) : store.listUpdatedMessages(code, since),
    store.listTyping(code, now),
  ]);
  member(game, playerId);
  pushSeen(game, playerId); // they are looking: nothing about this game need be pushed to them
  // A whisper is omitted here, on the poll and on every other view. The store still holds it.
  const visible = (list: Message[]) => list.filter((message) => canSee(message, playerId));
  return toState(game, playerId, visible(messages), visible(messageUpdates), typing.filter((notice) => notice.playerId !== playerId));
}

/** Writes the version on this request onto the player's seat, when they are already in the game. */
export async function notePlayerAppVersion(code: string, playerId: string, appVersion: string | null): Promise<void> {
  await getStore().noteAppVersion(code, playerId, appVersion);
}

/** The caller, and the version their app sent, recorded against the game in the URL. */
export async function rememberPlayer(request: Request): Promise<{ playerId: string; code: string; appVersion: string | null }> {
  const playerId = requirePlayer(request);
  const code = gameCodeOf(request);
  const appVersion = appVersionOf(request);
  await notePlayerAppVersion(code, playerId, appVersion);
  return { playerId, code, appVersion };
}

// ---------------------------------------------------------------------------------------------------------
// Lobby

/** One of your heroes who is fit to go: the dead stay dead until revived, and the retired until un-retired. */
async function livingCharacter(playerId: string, characterId: unknown): Promise<Character> {
  const character = await ownCharacter(playerId, characterId);
  if (character.sheet.dead) throw conflict(`${character.name} is dead`);
  if (character.retiredAt) throw conflict(`${character.name} is retired`);
  return character;
}

/** POST /api/games */
export async function createGame(playerId: string, characterId: unknown, dungeonMaster: unknown, appVersion: string | null = null): Promise<GameState> {
  if (dungeonMaster !== undefined && dungeonMaster !== null && !isValid('dungeonMaster', dungeonMaster)) {
    throw badRequest('unknown dungeonMaster');
  }
  const character = await livingCharacter(playerId, characterId);
  const store = getStore();
  const host: GamePlayer = { playerId, character: storable(character), joinedAt: new Date().toISOString(), appVersion };
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
export async function joinGame(code: string, playerId: string, characterId: unknown, appVersion: string | null = null): Promise<GameState> {
  const character = await livingCharacter(playerId, characterId);
  const game = await loadGame(code);
  const existing = game.players.find((p) => p.playerId === playerId);
  if (game.status !== 'lobby') {
    // Re-joining a game you're already in (e.g. after an app restart) just returns it.
    if (existing) {
      await notePlayerAppVersion(code, playerId, appVersion);
      return viewGame(code, playerId);
    }
    throw conflict('this adventure has already begun');
  }
  if (!existing && game.players.length >= MAX_PLAYERS) throw conflict(`the party is full (${MAX_PLAYERS} players)`);
  if (existing?.character.id === character.id && existing.character.updatedAt === character.updatedAt) {
    await notePlayerAppVersion(code, playerId, appVersion);
    return viewGame(code, playerId);
  }
  const joined = await getStore().upsertPlayer(code, { playerId, character: storable(character), joinedAt: new Date().toISOString(), appVersion }, MAX_PLAYERS);
  if (!joined) throw conflict('could not join: the game started or the party is full');
  await getStore().removeInvite(code, playerId);
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
  pushForget(code, [playerId]);
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

/** The players who heard a whisper, other than the one now answering it, so the answer stays private. */
function whisperAudience(quoted: Message, party: { playerId: string; name: string }[], senderId: string): Mention[] {
  const out: Mention[] = [];
  const seen = new Set<string>();
  const add = (id: string | null, name: string, target: Mention['target']) => {
    if (!id || id === senderId || seen.has(id)) return;
    seen.add(id);
    const known = party.find((person) => person.playerId === id);
    out.push({ playerId: id, name: known?.name || name, target });
  };
  for (const target of quoted.whisperTo ?? []) add(target.playerId, target.name, target.target);
  add(quoted.playerId, quoted.characterName ?? '', 'hero');
  return out;
}

/** POST /api/games/{code}/messages */
export async function postMessage(code: string, playerId: string, text: unknown, options: { voice?: unknown; replyTo?: unknown; emote?: unknown; whisperTo?: unknown } = {}): Promise<Message> {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed || trimmed.length > 500) throw badRequest('text must be 1–500 characters');
  let voice;
  let replyTo: number | null;
  try {
    voice = voiceOf(options.voice);
  } catch {
    throw badRequest('voice must be "in" or "out"');
  }
  try {
    replyTo = replyIdOf(options.replyTo);
  } catch {
    throw badRequest('replyTo must be a message id');
  }
  const game = await loadGame(code);
  const player = member(game, playerId);
  const party = game.players.map((p) => ({ playerId: p.playerId, name: p.character.name }));
  let interpreted;
  try {
    interpreted = interpretChat(trimmed, party, { emote: options.emote, whisperTo: options.whisperTo });
  } catch (error) {
    if (error instanceof Error) throw badRequest(error.message);
    throw error;
  }
  const body = interpreted.text;
  if (!body || body.length > 500) throw badRequest('text must be 1–500 characters');
  let whisperTo: Mention[] | null = null;
  if (interpreted.whisperTo) {
    whisperTo = interpreted.whisperTo.filter((target) => target.playerId !== playerId);
    if (whisperTo.length === 0) throw badRequest('whisper to someone else at the table');
  }

  const quoted = replyTo === null ? null : await getStore().getMessage(code, replyTo);
  if (replyTo !== null && (!quoted || !canSee(quoted, playerId))) throw badRequest('replyTo must be a message in this game');
  if (quoted?.whisperTo?.length) {
    const allowed = new Set<string>([quoted.playerId, ...quoted.whisperTo.map((target) => target.playerId)].filter((id): id is string => !!id));
    if (!whisperTo) whisperTo = whisperAudience(quoted, party, playerId);
    else if (whisperTo.some((target) => !allowed.has(target.playerId))) throw badRequest('a reply to a whisper stays with those who heard it');
    if (!whisperTo.length) throw badRequest('whisper to someone else at the table');
  }

  const mentions = parseMentions(body, party);
  const message = await getStore().addMessage(code, {
    kind: 'chat', playerId, characterName: player.character.name, text: body,
    voice, replyTo, reply: quoted ? quoteOf(quoted) : null, mentions,
    emote: interpreted.emote, whisperTo,
  });
  pushChat(game, message);
  return message;
}

/** POST /api/games/{code}/reactions — toggles the caller's emoji. The line keeps its id. */
export async function react(code: string, playerId: string, messageId: unknown, emoji: unknown): Promise<Message> {
  const game = await loadGame(code);
  member(game, playerId);
  if (typeof messageId !== 'number' || !Number.isInteger(messageId) || messageId < 1) throw badRequest('messageId must be a message id');
  const mark = oneEmoji(emoji);
  if (!mark) throw badRequest('emoji must be a single emoji');
  const existing = await getStore().getMessage(code, messageId);
  // The same answer as a missing line, so a guessed id does not reveal a whisper.
  if (!existing || !canSee(existing, playerId)) throw notFound('no such message');
  const message = await getStore().toggleReaction(code, messageId, playerId, mark);
  if (!message) throw notFound('no such message');
  return message;
}

/** POST /api/games/{code}/typing. A ping lasts TYPING_MS; false clears it. */
export async function setTyping(code: string, playerId: string, typing: unknown): Promise<{ ok: true }> {
  const game = await loadGame(code);
  const player = member(game, playerId);
  if (typing !== undefined && typing !== null && typeof typing !== 'boolean') throw badRequest('typing must be true or false');
  const until = typing === false ? new Date(0).toISOString() : new Date(Date.now() + TYPING_MS).toISOString();
  await getStore().setTyping(code, playerId, player.character.name, until);
  return { ok: true };
}

const ROLEPLAY_LIMIT = 20;

/**
 * POST /api/games/{code}/speak — a line or a deed in character. No roll. Kept on the current scene,
 * and given to the dungeon master when the turn resolves. Not a freeform action: nothing is adjudicated.
 */
export async function speakInCharacter(code: string, playerId: string, text: unknown): Promise<GameState> {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed || trimmed.length > 500) throw badRequest('text must be 1–500 characters');
  const game = await loadGame(code);
  const player = member(game, playerId);
  if (game.status !== 'voting') throw conflict(`can't speak in character: the game is ${game.status}`);
  const scene = game.scenes.find((s) => s.index === game.sceneIndex);
  if (!scene) throw conflict('there is no scene to speak in');
  if ((scene.roleplay?.length ?? 0) >= ROLEPLAY_LIMIT) throw badRequest('this turn already holds as many in-character lines as it can');
  const stored = await getStore().appendRoleplay(code, scene.index, { playerId, characterName: player.character.name, text: trimmed });
  if (!stored) throw conflict('that scene is no longer open');
  return viewGame(code, playerId);
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
  // 0 asks for no set length: the adventure goes on until its host calls the ending (lib/length.ts).
  const open = sceneCount === 0;
  const count = open ? MOST_SCENES : sceneCount === undefined || sceneCount === null ? DEFAULT_SCENE_COUNT : sceneCount;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < FEWEST_SCENES || count > MOST_SCENES) {
    throw badRequest(`sceneCount must be a whole number from ${FEWEST_SCENES} to ${MOST_SCENES}, or 0 for no set length`);
  }
  const mode = dungeonMode(dungeon);
  const game = await loadGame(code);
  const host = requireHost(game, playerId);
  if (game.status !== 'lobby') throw conflict(`can't start: the game is ${game.status}`);
  const rules = newRules(game.players, mode, dice.seed(), count, !open); // the map is sized for the scenes asked for (the most, with no set length)
  const scenes = open ? NO_SET_LENGTH : count + TREK_SCENES; // every game opens with the road from the tavern
  const blocking = game.players.filter((p) => isOutdated(p.appVersion ?? null));
  if (blocking.length > 0) throw partyOutdated(blocking.map((p) => p.character.name));
  if (!(await getStore().updateGame(code, { status: 'lobby' }, { status: 'preparing', sceneCount: scenes, ...rules }))) {
    throw conflict('the game is already starting');
  }
  await system(code, `${host.character.name} opened the dungeon door. ${archetype(game.dungeonMaster).name} is preparing the adventure…`);
  runInBackground(`opening ${code}`, () => writeOpening(code, origin));
  return viewGame(code, playerId);
}

const MAX_ACTION = 280;

/** `targets` on a vote that names an action: an array of ids, or none. */
function targetsOf(body: Record<string, unknown>): string[] {
  if (body.targets === undefined) return [];
  if (!Array.isArray(body.targets) || body.targets.some((t) => typeof t !== 'string' || t === '')) throw badRequest('targets must be an array of ids');
  return body.targets as string[];
}

/** Words sent with a vote: intent beside an action, or what a skill from the sheet is attempting. */
function wordsOf(body: Record<string, unknown>): string | null {
  const raw = body.text !== undefined ? body.text : body.intent;
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw badRequest('text must be a string');
  const text = raw.trim();
  if (text.length > MAX_ACTION) throw badRequest(`text must be at most ${MAX_ACTION} characters`);
  return text.length ? text : null;
}

/** A skill or ability vote is stored as that check. Any other vote may keep the words as intent, with no ruling. */
function noteFor(actionId: string | undefined, actions: LegalAction[], sheet: CharacterSheet | null, text: string | null): NonNullable<Vote['freeform']> | null {
  const label = actions.find((a) => a.id === actionId)?.label ?? actionId;
  if (actionId?.startsWith('skill:')) {
    const ruling = sheet && rulingForSkill(sheet, actionId.slice('skill:'.length));
    if (!ruling) throw badRequest('unknown skill');
    return { text: text ?? label ?? actionId, ruling };
  }
  if (actionId?.startsWith('ability:')) {
    const ruling = rulingForAbility(actionId.slice('ability:'.length));
    if (!ruling) throw badRequest('unknown ability');
    return { text: text ?? label ?? actionId, ruling };
  }
  return text ? { text } : null;
}

/** The d20 this declaration asks the player to throw, or null. */
function dieOf(sheet: CharacterSheet | null, action: LegalAction | undefined, note: NonNullable<Vote['freeform']> | null): PlayerDie | null {
  if (!sheet) return null;
  if (note?.ruling) return dieForCheck(sheet, note.ruling, action?.label);
  return action ? dieForAction(sheet, action) : null;
}

/**
 * A vote is a choice letter, or an action id from this hero's list (and its targets).
 * A letter is stored as itself. An action is stored with that id, and a letter so older reads still see a, b or c.
 */
function ballotOf(body: Record<string, unknown>, actions: LegalAction[]): { choiceId: ChoiceId; named: { actionId: string; targets: string[] } | null } {
  if (body.actionId !== undefined) {
    if (typeof body.actionId !== 'string' || body.actionId === '') throw badRequest('actionId must be the id of one of your actions');
    const checked = checkVote(actions, body.actionId, targetsOf(body));
    if (!checked.ok) throw badRequest(checked.error);
    const named = checked.action.kind === 'choice' ? null : { actionId: checked.action.id, targets: checked.targets };
    return { choiceId: checked.choiceId, named };
  }
  if (!CHOICE_IDS.includes(body.choiceId as ChoiceId)) throw badRequest('choiceId must be "a", "b" or "c"');
  return { choiceId: body.choiceId as ChoiceId, named: null };
}

/** POST /api/games/{code}/vote */
export async function castVote(code: string, playerId: string, body: Record<string, unknown>, origin: string): Promise<GameState> {
  const { sceneIndex } = body;
  if (typeof sceneIndex !== 'number' || !Number.isInteger(sceneIndex)) throw badRequest('sceneIndex must be a whole number');
  const game = await loadGame(code);
  member(game, playerId);
  if (game.status !== 'voting') throw conflict(`can't vote: the game is ${game.status}`);
  if (sceneIndex !== game.sceneIndex) throw conflict('that scene is not the current one');
  if (!canAct(game.combat, playerId)) return viewGame(code, playerId); // a fallen hero has no action: nothing to record
  let move: ReturnType<typeof parseMove> = undefined;
  if (body.move !== undefined) {
    try {
      move = parseMove(body.move);
      if (move && !game.combat) throw badRequest('there is no fight to move in');
      if (move && game.combat) validateMove(liveCombat(game)!, playerId, move);
    } catch (e) {
      if (e instanceof RuleViolation) throw badRequest(e.message);
      throw e;
    }
  }
  const scene = game.scenes.find((s) => s.index === sceneIndex);
  if (!scene) throw conflict('voting on that scene has closed');
  const actions = actionsFor(game, scene, playerId);
  const ballot = ballotOf(body, actions);
  const sheet = game.party && Object.hasOwn(game.party.sheets, playerId) ? game.party.sheets[playerId] : null;
  const note = noteFor(ballot.named?.actionId, actions, sheet, wordsOf(body));
  const namedAction = ballot.named ? actions.find((a) => a.id === ballot.named!.actionId) : undefined;
  const vote = await getStore().castVote(code, sceneIndex, playerId, ballot.choiceId, dice.d20(), ballot.named, move, note, dieOf(sheet, namedAction, note));
  if (!vote) throw conflict('voting on that scene has closed');
  await settleDice(code, origin);
  await resolveIfAllVoted(code, sceneIndex, origin);
  return viewGame(code, playerId);
}

export interface ActionOutcome {
  spent: boolean;
  text: string;
  ruling: 'known' | 'check' | 'impossible';
  roll: number | null;
  choiceId: ChoiceId | null;
  narration: string | null;
}

const outcome = (text: string, settled: { spent: boolean; ruling: { kind: ActionOutcome['ruling'] }; choiceId: ChoiceId | null; narration: string | null }, roll: number | null): ActionOutcome =>
  ({ spent: settled.spent, text, ruling: settled.ruling.kind, roll, choiceId: settled.choiceId, narration: settled.narration });

/**
 * POST /api/games/{code}/action — the player writes what they do. The DM classifies it; the engine checks
 * that and rolls, the same d20 a vote keeps. Impossible (and a classification that cannot be read) does
 * not spend the turn.
 */
export async function castAction(code: string, playerId: string, sceneIndex: unknown, text: unknown, origin: string): Promise<GameState & { action: ActionOutcome }> {
  if (typeof sceneIndex !== 'number' || !Number.isInteger(sceneIndex)) throw badRequest('sceneIndex must be a whole number');
  if (typeof text !== 'string' || text.trim().length === 0 || text.trim().length > MAX_ACTION) throw badRequest(`text must be from 1 to ${MAX_ACTION} characters`);
  const written = text.trim();
  const game = await loadGame(code);
  const player = member(game, playerId);
  if (game.status !== 'voting') throw conflict(`can't act: the game is ${game.status}`);
  if (sceneIndex !== game.sceneIndex) throw conflict('that scene is not the current one');
  const idle: ActionOutcome = { spent: false, text: written, ruling: 'impossible', roll: null, choiceId: null, narration: 'You cannot act.' };
  if (!canAct(game.combat, playerId)) return { ...(await viewGame(code, playerId)), action: idle };
  const scene = game.scenes.find((s) => s.index === sceneIndex);
  if (!scene) throw conflict('that scene is not the current one');
  const inCombat = game.combat !== null;
  const legal = actionsFor(game, scene, playerId);
  const allowed = knownActionIds(legal);
  // The choices that start a fight if the party takes them. Outside a fight, a written attack is a pick of the first.
  const fights = new Map(inCombat ? [] : scene.choices.flatMap((c): [string, string][] =>
    (startsFight(c.hook) && allowed.includes(`choice:${c.id}`) ? [[`choice:${c.id}`, foesNamed(c.hook.monsters)]] : [])));
  let raw: unknown = null;
  const dm = getDungeonMaster(game.dungeonMaster);
  if (dm.classifyAction) {
    try {
      raw = await dm.classifyAction(await contextFor(game, sceneIndex), {
        characterName: player.character.name,
        text: written,
        inCombat,
        actions: allowed,
        choices: legal.filter((a) => a.available).map((a) => ({ id: a.id, label: a.label, ...(fights.has(a.id) ? { fight: fights.get(a.id)! } : {}) })),
      });
    } catch (error) {
      console.warn(`classifying an action in ${code} failed:`, error);
    }
  }
  const settled = attackStartsFight(settleRuling(raw, allowed), [...fights.keys()], inCombat);
  if (!settled.spent) {
    await system(code, `${player.character.name}: ${settled.narration}`);
    return { ...(await viewGame(code, playerId)), action: outcome(written, settled, null) };
  }
  const ruling = settled.ruling;
  const sheet = game.party && Object.hasOwn(game.party.sheets, playerId) ? game.party.sheets[playerId] : null;
  if (ruling.kind === 'known' && (ruling.action.startsWith('skill:') || ruling.action.startsWith('ability:'))) {
    const check = ruling.action.startsWith('skill:')
      ? sheet && rulingForSkill(sheet, ruling.action.slice('skill:'.length))
      : rulingForAbility(ruling.action.slice('ability:'.length));
    if (!check || !sheet) {
      await system(code, `${player.character.name}: ${UNREADABLE}`);
      return { ...(await viewGame(code, playerId)), action: { spent: false, text: written, ruling: 'impossible', roll: null, choiceId: null, narration: UNREADABLE } };
    }
    const die = dieForCheck(sheet, check);
    const vote = await getStore().castVote(code, sceneIndex, playerId, 'c', dice.d20(), { actionId: ruling.action, targets: [] }, null, { text: written, ruling: check }, die);
    if (!vote) throw conflict('voting on that scene has closed');
    await settleDice(code, origin);
    await resolveIfAllVoted(code, sceneIndex, origin);
    return { ...(await viewGame(code, playerId)), action: { spent: true, text: written, ruling: 'check', roll: null, choiceId: null, narration: null } };
  }
  if (ruling.kind === 'known' && settled.choiceId) {
    const named = legal.find((a) => a.id === ruling.action);
    // TODO: a written line that names a target should pass that target. Until then an action that
    // needs one is stored as its letter, which still plays today's default (best weapon, best spell, Dodge).
    const asAction = named && named.picks === 'none' && named.kind !== 'choice' ? { actionId: named.id, targets: [] } : null;
    const die = sheet && named ? dieForAction(sheet, named) : null;
    // The words stay with the pick: the table sees them beside it, and the DM reads them when the scene is told.
    const vote = await getStore().castVote(code, sceneIndex, playerId, settled.choiceId, dice.d20(), asAction, null, { text: written }, die);
    if (!vote) throw conflict('voting on that scene has closed');
    await settleDice(code, origin);
    await resolveIfAllVoted(code, sceneIndex, origin);
    return { ...(await viewGame(code, playerId)), action: outcome(written, settled, die ? null : vote.roll) };
  }
  if (ruling.kind !== 'check') throw new Error('a spent action is a known action or a check');
  const die = sheet ? dieForCheck(sheet, ruling) : null;
  const vote = await getStore().setFreeform(code, sceneIndex, playerId, dice.d20(), { text: written, ruling }, die);
  if (!vote?.freeform) throw conflict('voting on that scene has closed');
  await settleDice(code, origin);
  await resolveIfAllVoted(code, sceneIndex, origin);
  return { ...(await viewGame(code, playerId)), action: outcome(written, settled, die ? null : vote.roll) };
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
  /** The narrator whose reading this is (a catalog narrators id). */
  voice: string;
  /** "ready": `voiceUrl` is the audio. "making": the narrator is speaking; it will appear on the scene (`scene.voices`). */
  status: 'ready' | 'making';
  voiceUrl: string | null;
}

/**
 * POST /api/games/{code}/narration — a scene read aloud, on demand: the first player to ask for it in a
 * narrator's voice has that narrator speak it; the file is kept and every later request for that voice gets
 * the same one. The request that started the reading waits for it (up to `waitMs`) and answers with the
 * file, or with a 502 if the reading failed; anyone else asking meanwhile is told it is being made, and
 * finds it on the scene when it is. `voice` is a narrator id; without one it is the default narrator.
 */
export async function requestNarration(code: string, playerId: string, sceneIndex: unknown, voice: unknown, origin: string, waitMs = NARRATION_WAIT_MS): Promise<Narration> {
  if (typeof sceneIndex !== 'number' || !Number.isInteger(sceneIndex)) throw badRequest('sceneIndex must be a whole number');
  const reader = voice === undefined || voice === null ? defaultNarrator() : typeof voice === 'string' ? narratorOf(voice) : null;
  if (!reader) throw badRequest('voice must be a narrator id from the catalog');
  const game = await loadGame(code);
  member(game, playerId);
  const scene = game.scenes.find((s) => s.index === sceneIndex);
  if (!scene) throw notFound('no such scene');
  const answer = (status: Narration['status'], voiceUrl: string | null): Narration => ({ sceneIndex, voice: reader.id, status, voiceUrl });
  if (scene.voices[reader.id]) return answer('ready', scene.voices[reader.id]);
  const text = narrationText(game, scene);
  if (!text) throw conflict('that scene has nothing to read');
  const store = getStore();
  if (!(await store.claimSceneVoice(code, sceneIndex, reader.id, NARRATION_CLAIM_MS))) return answer('making', null);

  const reading = (async () => {
    try {
      const url = await getImageStore().save(await narrator(text, reader), 'voices', origin);
      await store.setSceneVoice(code, sceneIndex, reader.id, url);
      return url;
    } catch (error) {
      await store.setSceneVoice(code, sceneIndex, reader.id, null); // give the claim back: the next request tries again
      throw error;
    }
  })();
  // The reading outlives this request if it takes longer than the wait.
  runInBackground(`narrate ${code}#${sceneIndex} (${reader.id})`, async () => { await reading; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const patience = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
  try {
    const voiceUrl = await Promise.race([reading, patience]);
    return voiceUrl ? answer('ready', voiceUrl) : answer('making', null);
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
  if (scene) await revealPending(code, scene.index, scene.votes);
  await beginResolve(code, game.sceneIndex, origin);
  return viewGame(code, playerId);
}

/** The choice window has closed: hidden dice become the server's roll. */
export async function settleDice(code: string, origin: string): Promise<void> {
  const game = await getStore().getGame(code);
  if (!game || game.status !== 'voting') return;
  const scene = game.scenes.find((s) => s.index === game.sceneIndex);
  if (!scene) return;
  const deadline = Date.parse(scene.createdAt) + TURN_SECONDS * 1000;
  if (!Number.isFinite(deadline) || Date.now() < deadline) return;
  if (await revealPending(code, scene.index, scene.votes)) await resolveIfAllVoted(code, scene.index, origin);
}

async function revealPending(code: string, index: number, votes: StoredScene['votes']): Promise<boolean> {
  let any = false;
  for (const vote of votes) {
    if (rollPending(vote)) any = await getStore().revealRoll(code, index, vote.playerId, true) || any;
  }
  return any;
}

/** POST /api/games/{code}/roll — reveal the caller's hidden d20. The face was rolled when they declared. */
export async function throwDie(code: string, playerId: string, sceneIndex: unknown, origin: string): Promise<GameState> {
  if (typeof sceneIndex !== 'number' || !Number.isInteger(sceneIndex)) throw badRequest('sceneIndex must be a whole number');
  const game = await loadGame(code);
  member(game, playerId);
  if (game.status !== 'voting') throw conflict(`can't throw: the game is ${game.status}`);
  if (sceneIndex !== game.sceneIndex) throw conflict('that scene is not the current one');
  const scene = game.scenes.find((s) => s.index === sceneIndex);
  const vote = scene?.votes.find((v) => v.playerId === playerId);
  if (!vote?.die) throw conflict('there is no die to throw');
  if (rollPending(vote)) {
    await getStore().revealRoll(code, sceneIndex, playerId);
    await resolveIfAllVoted(code, sceneIndex, origin);
  }
  return viewGame(code, playerId);
}

/**
 * POST /api/games/{code}/ending. Host only: the scene being played becomes the last, and the epilogue
 * follows it (after the fight, if one is on). This is how an adventure with no set length ends, and it
 * cuts a longer one short. Calling it again, or on a scene that is already the last, changes nothing.
 */
export async function callEnding(code: string, playerId: string): Promise<GameState> {
  const game = await loadGame(code);
  const host = requireHost(game, playerId);
  if (game.status !== 'voting') throw conflict(`can't call the ending: the game is ${game.status}`);
  const last = game.sceneIndex + 2; // this scene, then the epilogue
  const closed = game.party && questClosed(game.party);
  const called = closed && closed !== game.party ? { party: closed } : {}; // no overtime (play/quest.ts)
  const cuts = game.sceneCount > last || 'party' in called;
  if (cuts && (await getStore().updateGame(code, { status: 'voting', sceneIndex: game.sceneIndex }, { sceneCount: Math.min(last, game.sceneCount), ...called }))) {
    await system(code, game.combat
      ? `${host.character.name} has called the ending. When this fight is over, the epilogue follows.`
      : `${host.character.name} has called the ending. This is the last scene; the epilogue follows it.`);
  }
  return viewGame(code, playerId);
}

async function resolveIfAllVoted(code: string, sceneIndex: number, origin: string): Promise<void> {
  const game = await getStore().getGame(code);
  if (!game || game.status !== 'voting' || game.sceneIndex !== sceneIndex || !game.players.length) return;
  const scene = game.scenes.find((s) => s.index === sceneIndex);
  if (!scene) return;
  const ready = (id: string) => {
    const vote = scene.votes.find((v) => v.playerId === id);
    return !!vote && !rollPending(vote);
  };
  // A combat round waits only for the heroes that can act. A hidden die is not thrown yet.
  const awaited = game.players.filter((p) => canAct(game.combat, p.playerId));
  if (awaited.every((p) => ready(p.playerId))) await beginResolve(code, sceneIndex, origin);
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
    roleplay: [...(scene.roleplay ?? []), ...writtenLines(game, scene)],
  };
}

/** A written action is the player's own words, the same as an in-character line. */
function writtenLines(game: Game, scene: StoredScene): RoleplayLine[] {
  return scene.votes.flatMap((v) => {
    if (!v.freeform?.text) return [];
    const name = game.players.find((p) => p.playerId === v.playerId)?.character.name ?? 'A departed adventurer';
    return [{ playerId: v.playerId, characterName: name, text: v.freeform.text }];
  });
}

/** What the DM is told to write scene `sceneIndex` of a game of `sceneCount` scenes (after the resolved scene's dice, if `rules`). */
async function contextFor(game: Game, sceneIndex: number, rules: RulesState | null = rulesStateOf(game), sceneCount = game.sceneCount): Promise<DMContext> {
  const messages = await getStore().listMessages(game.code, undefined, 20);
  return {
    archetype: archetype(game.dungeonMaster),
    adventureTitle: game.title,
    party: partyOf(game),
    history: game.scenes.filter((s) => s.index < sceneIndex).map((s) => pastScene(game, s)),
    sceneIndex,
    sceneCount,
    openEnded: hasNoSetLength(sceneCount),
    progress: sceneProgress(rules?.party ?? null, sceneIndex, sceneCount),
    recentChat: chatLines(messages),
    rules: rules && rulesContext(rules),
  };
}

export function resolutionOf(game: Game, scene: StoredScene): Resolution {
  // Votes from players still at the table (everyone's, if nobody is left). A written check has acted,
  // so it is not an abstention, but it is not a vote for a, b or c.
  const present = scene.votes.filter((v) => game.players.some((p) => p.playerId === v.playerId));
  const acting = present.length ? present : scene.votes;
  const votes = voteRecords(game, { ...scene, votes: acting.filter((v) => !isPersonalCheck(v)) });
  const tally = { a: 0, b: 0, c: 0 } as Record<ChoiceId, number>;
  for (const v of votes) tally[v.choiceId]++;
  const top = Math.max(...CHOICE_IDS.map((id) => tally[id]));
  const voted = new Set(acting.map((v) => v.playerId));
  return {
    scene: pastScene(game, scene),
    votes,
    tally,
    leaders: CHOICE_IDS.filter((id) => tally[id] === top && top > 0),
    abstained: game.players.filter((p) => !voted.has(p.playerId)).map((p) => p.character.name),
    rules: null,
  };
}

/** The DM's two or three plot choices, clipped. In a rules game each keeps its hook if the hook holds up. */
function choicesOf(choices: DMChoice[], rules: Pick<RulesState, 'dungeon'> | null): StoredChoice[] {
  if (choices.length < 2) throw new Error(`the DM wrote ${choices.length} choices, not 2 or 3`);
  return choices.slice(0, 3).map((c, i) => {
    const choice = { id: CHOICE_IDS[i], label: clip(c.label.trim(), 80), detail: clip(c.detail.trim(), 300) };
    return rules ? storedChoice(choice, c.rules, rules.dungeon, c.reward) : choice;
  });
}

/** The DM's choices, or Engage, Run and Parley when foes bar the road as the game starts. */
function openingChoices(draft: OpeningScene, game: Game): StoredChoice[] {
  const rules = rulesStateOf(game);
  return (rules && confrontationChoices(rules)) ?? choicesOf(draft.choices, rules);
}

const sceneTitle = (text: SceneText, fallback: string) => clip(text.title?.trim() || fallback, 120);

async function writeOpening(code: string, origin: string): Promise<void> {
  const store = getStore();
  const game = await store.getGame(code);
  if (!game || game.status !== 'preparing') return;
  let draft;
  try {
    draft = await inTheirOwnWords(game, async () => getDungeonMaster(game.dungeonMaster).openingScene(await contextFor(game, 0)));
    const scene = {
      index: 0,
      title: sceneTitle(draft, 'The Dungeon Door'),
      narration: draft.narration.trim(),
      imagePrompt: draft.imagePrompt,
      imageUrl: null,
      choices: openingChoices(draft, game),
      isFinale: false,
    };
    await store.saveScene(code, scene);
  } catch (error) {
    console.error(`DM failed to open ${code}:`, error);
    if (await store.updateGame(code, { status: 'preparing' }, { status: 'lobby' })) {
      await system(code, outOfCredit(error)
        ? `The dungeon master could not begin. ${OUT_OF_CREDIT} Starting again will not work until then; the party can stay at the door.`
        : `The dungeon master lost their notes and couldn't begin. The host can press start to try again.`);
    }
    return;
  }
  const title = clip(draft.adventureTitle?.trim() || 'An Untold Adventure', 120);
  if (!(await store.updateGame(code, { status: 'preparing' }, { status: 'voting', sceneIndex: 0, title }))) return;
  pushSceneReady(code);
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
  /** The turn in numbers, for the app's result screen; null without the engine, and when the engine threw. */
  result: TurnResult | null;
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
    result: null,
  };
}

function safeStep(state: RulesState, scene: StoredScene, resolution: Resolution, players: readonly GamePlayer[]): EngineStep {
  try {
    return engineStep(state, scene, resolution, players);
  } catch (error) {
    return withoutTheEngine(state, resolution, error);
  }
}

function planOf(game: Game, scene: StoredScene): Plan {
  const resolution = resolutionOf(game, scene);
  const next = scene.index + 1;
  const state = rulesStateOf(game);
  if (!state) return { resolution, next, isFinale: next >= game.sceneCount - 1, rules: null, patch: {}, lines: [], result: null, sharesPicture: false };
  const stepped = safeStep(state, scene, resolution, game.players);
  const played = { ...stepped, state: { ...stepped.state, party: markRoadEnd(state.party, stepped.state.party, next) } };
  const { isFinale, sceneCount } = endingOf(played, next, game.sceneCount);
  const step = isFinale ? endQuest(played) : played; // the heroes level up for the epilogue
  const { party } = step.state;
  const sharesPicture = step.round && step.state.combat !== null;
  return { resolution: step.resolution, next, isFinale, rules: step.state, patch: { ...step.state, sceneCount }, lines: party.results!, result: step.result, sharesPicture };
}

/**
 * The next scene's choices: a fight's Attack, Cast and Dodge, Engage/Run/Parley when foes bar the way, or the
 * DM's, the first facing the quest's goal in a tale told past its plan (play/quest.ts).
 */
function nextChoices(plan: Plan, draft: NextScene, sceneCount: number): StoredChoice[] {
  if (plan.rules?.combat) return COMBAT_CHOICES.map((c, i) => ({ id: CHOICE_IDS[i], ...c }));
  const face = plan.rules && confrontationChoices(plan.rules);
  if (face) return face;
  const offered = choicesOf(draft.choices, plan.rules);
  return plan.rules ? towardTheGoal(offered, plan.rules, plan.next, sceneCount) : offered;
}

async function spokenBy(game: Game): Promise<HeroLine[]> {
  const messages = await getStore().listMessages(game.code, undefined, 200);
  const fromPlay = game.scenes.flatMap((s) => [...(s.roleplay ?? []), ...writtenLines(game, s)]);
  return keptWords(fromPlay, messages).map((line) => ({ name: line.characterName, text: line.text }));
}

/** The heroes' own words. A draft that speaks for them is asked for once more, then the stolen sentences are cut. */
async function inTheirOwnWords<T extends SceneText & { outcome?: string }>(game: Game, ask: () => Promise<T>): Promise<T> {
  const heroes = game.players.map((p) => p.character.name);
  const lines = await spokenBy(game);
  const steals = (draft: T) => [draft.narration, draft.outcome ?? '', draft.quip ?? ''].some((text) => hasStolenHeroSpeech(text, heroes, lines));
  let draft = await ask();
  if (steals(draft)) draft = await ask();
  const narration = stripHeroSpeech(draft.narration, heroes, lines).trim() || 'What do you do?';
  const quip = draft.quip ? stripHeroSpeech(draft.quip, heroes, lines).trim() : '';
  if (draft.outcome === undefined) return { ...draft, narration, quip: quip || undefined };
  const outcome = stripHeroSpeech(draft.outcome, heroes, lines).trim() || 'The action plays out.';
  return { ...draft, narration, outcome, quip: quip || undefined };
}

async function writeNext(game: Game, scene: StoredScene, plan: Plan) {
  const dm = getDungeonMaster(game.dungeonMaster);
  const ctx = await contextFor(game, plan.next, plan.rules, plan.patch.sceneCount ?? game.sceneCount); // history ends with the scene being resolved
  const draft = await inTheirOwnWords(game, () => plan.isFinale ? dm.finale(ctx, plan.resolution) : dm.nextScene(ctx, plan.resolution));
  const { leaders } = plan.resolution;
  const chosen = leaders.includes(draft.chosenChoiceId) ? draft.chosenChoiceId : (leaders[0] ?? null);
  const store = getStore();
  await store.setSceneOutcome(game.code, scene.index, clip(draft.outcome.trim(), 1000), chosen);
  await store.saveScene(game.code, {
    index: plan.next,
    title: sceneTitle(draft, plan.isFinale ? 'Epilogue' : sceneHeading(ctx)),
    narration: draft.narration.trim(),
    imagePrompt: plan.sharesPicture ? SHARED_PICTURE : draft.imagePrompt,
    imageUrl: plan.sharesPicture ? scene.imageUrl : null,
    choices: plan.isFinale ? [] : nextChoices(plan, draft as NextScene, plan.patch.sceneCount ?? game.sceneCount),
    isFinale: plan.isFinale,
  });
  return draft;
}

/** The adventure is over: each hero's sheet goes home to its character, the dead with how and where they fell. */
async function sendHeroesHome(game: Game, rules: RulesState | null): Promise<void> {
  if (!rules) return;
  const store = getStore();
  const now = new Date().toISOString();
  const lastScene = game.scenes.filter((s) => !s.isFinale).at(-1) ?? null;
  for (const { characterId, sheet } of writeBack(rules.party, game.players)) {
    const character = await store.getCharacter(characterId);
    if (!character) continue;
    const death = sheet.dead ? (character.death ?? deathIn(game, lastScene, sheet.name, rules.party.results ?? [], now)) : null;
    await store.saveCharacter({ ...character, sheet: homecoming(characterId, character.sheet, sheet), death, updatedAt: now });
  }
}

/**
 * The heroes this resolution killed get their death on the character now, while the scene and the engine's
 * lines are known. It shows once the hero goes home dead; one raised before the end goes home without it.
 */
async function recordFalls(game: Game, scene: StoredScene, after: PartyState, lines: readonly string[]): Promise<void> {
  const store = getStore();
  const at = new Date().toISOString();
  for (const p of newlyFallen(game.party, after, game.players)) {
    const character = await store.getCharacter(p.character.id);
    if (character) await store.saveCharacter({ ...character, death: deathIn(game, scene, after.sheets[p.playerId].name, lines, at) });
  }
}

/**
 * The turn's result is stored as soon as the engine has played it, which is many seconds before the DM's
 * outcome. It is for show: a store that cannot keep it is logged and the turn goes on, so the table is never
 * left resolving for the sake of it.
 */
async function keepResult(code: string, sceneIndex: number, result: TurnResult | null): Promise<void> {
  try {
    await getStore().setSceneResult(code, sceneIndex, result);
  } catch (error) {
    console.error(`storing the result of ${code}#${sceneIndex} failed:`, error);
  }
}

async function resolveScene(code: string, sceneIndex: number, origin: string): Promise<void> {
  const store = getStore();
  const game = await store.getGame(code);
  const scene = game?.scenes.find((s) => s.index === sceneIndex);
  if (!game || !scene || game.status !== 'resolving' || game.sceneIndex !== sceneIndex) return;
  const plan = planOf(game, scene);
  await keepResult(code, sceneIndex, plan.result); // before the DM is asked: the table reads its dice while the DM writes
  let draft;
  try {
    draft = await writeNext(game, scene, plan);
  } catch (error) {
    await dmFumbled(code, sceneIndex, error);
    return;
  }
  const status = plan.isFinale ? 'ended' : 'voting';
  if (!(await store.updateGame(code, { status: 'resolving', sceneIndex }, { status, sceneIndex: plan.next, ...plan.patch }))) return;
  if (plan.isFinale) pushForget(code, game.players.map((p) => p.playerId));
  else pushSceneReady(code);
  if (plan.rules) await recordFalls(game, scene, plan.rules.party, plan.lines);
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
    await keepResult(code, sceneIndex, null); // the turn will be played again, and the votes may change first
    await system(code, outOfCredit(error)
      ? `The dungeon master could not go on. ${OUT_OF_CREDIT} Your votes are kept; the host can advance once that is done.`
      : `The dungeon master fumbled their dice. Votes are still open; the host can advance to try again.`);
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
    // The whole party, the dungeon master's featured heroes nearest the viewer (lib/scene-art.ts).
    const cast = castOf(game, text.featuredCharacters);

    const images = getImageStore();
    const references: StoredImage[] = [];
    const portrait: boolean[] = [];
    for (const { character: c } of cast) {
      const image = c.portraitUrl ? await images.load(c.portraitUrl).catch(() => null) : null;
      if (image) references.push(image);
      portrait.push(image !== null);
    }
    const prompt = `${SCENE_STYLE} Art direction: ${dmArchetype.artStyle}.\n\nThe scene: ${text.imagePrompt}\n\n` +
      castBrief(cast, portrait);
    const image = await renderImage({ prompt, references, aspectRatio: '3:2', seed: `${code}#${index}:${text.title}` });
    const url = await images.save(image, 'scenes', origin);
    await shareSceneImage(code, index, url);
  } catch (error) {
    console.error(`painting ${code}#${index} failed:`, error);
  }
}
