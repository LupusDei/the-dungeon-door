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
-- on; dungeon: DungeonState (the map, where the party is, what it has seen).
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

CREATE TABLE IF NOT EXISTS votes (
  game_code  text NOT NULL REFERENCES games (code) ON DELETE CASCADE,
  scene_idx  int  NOT NULL,
  player_id  text NOT NULL,
  choice_id  text NOT NULL CHECK (choice_id IN ('a', 'b', 'c')),
  roll       int  NOT NULL CHECK (roll BETWEEN 1 AND 20),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (game_code, scene_idx, player_id)
);

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

-- The quest log (website /quest-log): JSON documents, kind 'task' or 'meta'. See lib/quests.ts.
CREATE TABLE IF NOT EXISTS quest_docs (
  kind       text NOT NULL,
  id         text NOT NULL,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
);
