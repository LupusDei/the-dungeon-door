-- The Dungeon Door — Postgres schema. Idempotent: `npm run migrate` applies it with DATABASE_URL set.

CREATE TABLE IF NOT EXISTS characters (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  data        jsonb NOT NULL,          -- the Character as the API returns it
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS characters_owner_idx ON characters (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS games (
  code           text PRIMARY KEY,
  host_id        text NOT NULL,
  status         text NOT NULL DEFAULT 'lobby'
                 CHECK (status IN ('lobby', 'preparing', 'voting', 'resolving', 'ended')),
  dungeon_master text NOT NULL,
  title          text,
  scene_count    int  NOT NULL DEFAULT 4,
  scene_index    int  NOT NULL DEFAULT -1,   -- current scene; -1 before the opening scene exists
  message_seq    int  NOT NULL DEFAULT 0,    -- last message id handed out
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Rules engine state (lib/play/state.ts). Null for games from before the engine, which play as before.
-- party: PartyState (the heroes' sheets in this game, dice state); combat: CombatState while a fight is
-- on (a battlefield of 5-foot squares, and a square on each combatant — a fight stored without them is
-- placed when it is read); dungeon: DungeonState (the map, where the party is, what it has seen).
ALTER TABLE games ADD COLUMN IF NOT EXISTS party jsonb;
ALTER TABLE games ADD COLUMN IF NOT EXISTS combat jsonb;
ALTER TABLE games ADD COLUMN IF NOT EXISTS dungeon jsonb;

CREATE TABLE IF NOT EXISTS game_players (
  game_code  text NOT NULL REFERENCES games (code) ON DELETE CASCADE,
  player_id  text NOT NULL,
  character  jsonb NOT NULL,             -- snapshot of the Character at join time
  joined_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (game_code, player_id)
);

-- Last x-dd-app-version seen from this player (`marketing+build`). Null when the client never sent one.
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS app_version text;

CREATE TABLE IF NOT EXISTS scenes (
  game_code        text NOT NULL REFERENCES games (code) ON DELETE CASCADE,
  idx              int  NOT NULL,
  title            text NOT NULL,
  narration        text NOT NULL,
  image_prompt     text NOT NULL DEFAULT '',
  image_url        text,
  choices          jsonb NOT NULL DEFAULT '[]',
  is_finale        boolean NOT NULL DEFAULT false,
  outcome          text,
  chosen_choice_id text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_code, idx)
);

-- In-character lines for the turn (no roll): what the players said and did, oldest first.
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS roleplay jsonb NOT NULL DEFAULT '[]';

-- How the scene's turn came out, in numbers (lib/play/result.ts, a TurnResult): the choice and who picked it,
-- what each hero did, and each d20. Written when the engine has played the turn, before the DM writes the
-- outcome. Null until then, in a game without the engine, and on scenes resolved before this.
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS result jsonb;

-- The narrators' readings of scenes (lib/voice.ts, lib/game.ts requestNarration): one audio file per scene
-- per narrator, made when a player first asks for it. A row with no url is the claim of whoever is making it
-- (started_at); a failed try clears started_at so the next request can claim it again.
CREATE TABLE IF NOT EXISTS scene_voices (
  game_code  text NOT NULL REFERENCES games (code) ON DELETE CASCADE,
  scene_idx  int  NOT NULL,
  voice      text NOT NULL,           -- a narrator id
  url        text,
  started_at timestamptz,
  PRIMARY KEY (game_code, scene_idx, voice)
);

-- Before there were several narrators, a scene's one reading (always by "charon") was kept on the scene.
-- Those columns are no longer read or written; their readings are carried over once.
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS voice_url text;
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS voice_started_at timestamptz;
INSERT INTO scene_voices (game_code, scene_idx, voice, url)
  SELECT game_code, idx, 'charon', voice_url FROM scenes WHERE voice_url IS NOT NULL
  ON CONFLICT (game_code, scene_idx, voice) DO NOTHING;

CREATE TABLE IF NOT EXISTS votes (
  game_code  text NOT NULL REFERENCES games (code) ON DELETE CASCADE,
  scene_idx  int  NOT NULL,
  player_id  text NOT NULL,
  choice_id  text NOT NULL CHECK (choice_id IN ('a', 'b', 'c')),
  roll       int  NOT NULL CHECK (roll BETWEEN 1 AND 20),
  action_id  text,                    -- a legal action named by the vote; null for a letter vote
  targets    jsonb,
  freeform   jsonb,                   -- a written check: { text, ruling }
  move       jsonb,                   -- a combat move with the vote: {x, y, dash?, disengage?} or {to, engage?, dash?, disengage?}
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (game_code, scene_idx, player_id)
);

-- A vote may name a legal action (docs/api.md) as well as a choice letter. Null for a letter vote.
ALTER TABLE votes ADD COLUMN IF NOT EXISTS action_id text;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS targets jsonb;
-- A written check on a vote (play/actions.ts): { text, ruling }. Null on an ordinary vote.
-- The choice_id of such a row is ignored. Added without rewriting existing votes.
ALTER TABLE votes ADD COLUMN IF NOT EXISTS freeform jsonb;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS move jsonb;
-- A d20 the player throws (play/dice.ts). `die` is the formula; `revealed` stays false until they
-- throw or the choice window ends. Existing votes are already revealed. Needs `npm run migrate`.
ALTER TABLE votes ADD COLUMN IF NOT EXISTS die jsonb;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS revealed boolean DEFAULT true;
-- The server threw that hidden die for the player (the window ran out, or the host advanced first): the hero
-- was idle that scene and earns half its XP (play/xp.ts). Existing votes were thrown by their players.
ALTER TABLE votes ADD COLUMN IF NOT EXISTS auto_rolled boolean DEFAULT false;

CREATE TABLE IF NOT EXISTS messages (
  game_code      text NOT NULL REFERENCES games (code) ON DELETE CASCADE,
  id             int  NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('chat', 'system', 'dm')),
  player_id      text,
  character_name text,
  text           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_code, id)
);

-- Party chat: in/out of character, a quoted reply, @mentions, and when reactions last changed the line.
-- revised_at stays null until a reaction, so the poll can send that line again without a new id.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS voice text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to int;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mentions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS revised_at timestamptz;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_voice_check;
ALTER TABLE messages ADD CONSTRAINT messages_voice_check CHECK (voice IS NULL OR voice IN ('in', 'out'));

-- A third-person emote, and who a whisper is for. whisper_to is null when the whole party may read
-- the line. A whisper is never returned to anyone else, and never given to the narrator.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS emote boolean NOT NULL DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS whisper_to jsonb;

-- One row per player per emoji. Toggling deletes the row. The message id does not change.
CREATE TABLE IF NOT EXISTS message_reactions (
  game_code  text NOT NULL,
  message_id int  NOT NULL,
  player_id  text NOT NULL,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (game_code, message_id, player_id, emoji),
  FOREIGN KEY (game_code, message_id) REFERENCES messages (game_code, id) ON DELETE CASCADE
);

-- Who is composing. `until` is a few seconds out; the poll drops anyone past it.
CREATE TABLE IF NOT EXISTS typing (
  game_code text NOT NULL REFERENCES games (code) ON DELETE CASCADE,
  player_id text NOT NULL,
  name      text NOT NULL,
  until     timestamptz NOT NULL,
  PRIMARY KEY (game_code, player_id)
);

-- The quest log (website /quest-log): JSON documents, kind 'task' or 'meta'. See lib/quests.ts.
CREATE TABLE IF NOT EXISTS quest_docs (
  kind       text NOT NULL,
  id         text NOT NULL,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
);

-- Push notifications (lib/push, docs/push.md). A device token belongs to the last player to register it.
CREATE TABLE IF NOT EXISTS push_devices (
  token       text PRIMARY KEY,
  player_id   text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_devices_player_idx ON push_devices (player_id);

-- One row per player who has been pushed: when, how many they have not answered, and what waits to go
-- (lib/push/throttle.ts PushState). unanswered and waiting repeat what is in state, for cheap lookups;
-- version makes each change a compare-and-set.
CREATE TABLE IF NOT EXISTS push_state (
  player_id  text PRIMARY KEY,
  state      jsonb NOT NULL,
  unanswered int  NOT NULL DEFAULT 0,
  waiting    int  NOT NULL DEFAULT 0,
  version    int  NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Invitations to a party still in its lobby, from someone the invited player has played with.
CREATE TABLE IF NOT EXISTS invites (
  game_code   text NOT NULL REFERENCES games (code) ON DELETE CASCADE,
  to_player   text NOT NULL,
  from_player text NOT NULL,
  from_name   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_code, to_player)
);
CREATE INDEX IF NOT EXISTS invites_to_idx ON invites (to_player, created_at DESC);
CREATE INDEX IF NOT EXISTS game_players_player_idx ON game_players (player_id);
