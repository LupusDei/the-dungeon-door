# Push notifications

The server tells a player's phone when the game needs them. The code is in `server/lib/push/`; the app's
side is `ios/DungeonDoor/Core/PushCenter.swift`.

## What is pushed, and to whom

| When | Who hears | The push |
| --- | --- | --- |
| A scene is ready for votes | Every player in the game | "The Sunken Crypt. What will Bryn do?" |
| A combat round begins | Every player whose hero can act (not down, not dead) | "Round 2: Bryn, choose your action. Facing Zombie, Giant Rat ×2." |
| A player chats | The rest of the party, not the one who spoke | "Corin: Are we going in?" |
| A player whispers | Only the players it names, not the one who spoke and not the rest of the party | "Bryn whispers: The door is trapped." |
| A player emotes | The rest of the party, not the one who acted | "*Bryn draws her sword*" |
| A companion invites them | The invited player | "Justin invites you to a new adventure, and asks for Brannoch. Door code ABCDEF." |

A player who is looking at the game hears nothing about it. The app fetches the game every two seconds
while it is open, so a push about a game waits eight seconds before it goes, and a fetch by that player in
the meantime cancels it. An invitation does not wait: the home screen does not watch for them.

An invitation names whoever sent it as the invited player knows them: the name they gave themselves, else
the invited player's nickname for them, else their hero in the party (docs/api.md, Companion). "and asks for …" is
there only when the invitation asks for one of the invited player's heroes.

Only players with a registered device are pushed (`POST /api/devices`, docs/api.md).

## How often

Per player, three limits hold together (`throttle.ts`):

- at most **2 pushes in any minute**;
- at most **5 in any ten minutes**;
- after each push the player does not answer, **the wait before the next doubles**: 30 seconds, then 1, 2,
  4, 8, 16 minutes and so on, up to six hours. Opening the game ends it.

A player who stays away from a busy game is pushed at 0:00, 0:30, 1:30, 3:30 and 7:30, then 15:30, 31:30
and so on: two in the first minute and five in the first ten.

What may not go yet waits, one push per subject (a game's turn, a game's chat, an invitation), newest
content kept:

- A new scene or round replaces the turn push still waiting for that game, so a player comes back to the
  current one. On the lock screen a newer turn push also replaces the older (they share a collapse id).
- Chat waiting becomes one push: "Corin: Three (and 2 more messages)".
- **Turns go first.** A combat round, then a turn, then an invitation, then chat. Chat is never the last
  push of a minute or of ten minutes (that one is kept for a turn), and a player with three unanswered
  pushes gets no more chat until they come back.
- What waits goes at the next opening: within the request that made it if that is under two and a half
  minutes away, else when someone next fetches that game. A turn push is dropped after six hours, chat
  after half an hour, an invitation after a day. Leaving a game, or its end, drops what waited about it.

## Turning it on

Nothing is sent unless the server holds an APNs key. `GET /api/catalog` says so (`push`), and the app asks
leave to notify only when it is true. It asks the first time it opens (an invitation has to reach a player
who is in no party yet), and again on entering a game if iOS has not been asked. iOS shows its question
once; after a "Don't Allow" the lobby's row sends the player to Settings. Three things make it work, and
all three are in place:

1. **A push key.** An APNs auth key (`.p8`) from the Apple Developer portal (Certificates, Identifiers &
   Profiles, Keys, with "Apple Push Notifications service (APNs)" ticked). One key serves every app of the
   team; this server uses the team's existing one.
2. **The app may take pushes.** The App ID `com.jmm.the-dungeon-door` has the Push Notifications
   capability, the App Store provisioning profile carries `aps-environment: production`, and
   `ios/project.yml` gives the app the entitlement: `development` for a build run from Xcode,
   `production` for a Release build (`APS_ENVIRONMENT`).
3. **The server holds the key.** On Vercel: `APNS_KEY_ID` (the key's id), `APNS_TEAM_ID` (`2BRYAM5Q52`),
   `APNS_KEY` (the `.p8` file's text, or that text base64-encoded) and, only for another bundle id,
   `APNS_TOPIC`. They take effect at the next deploy. Removing `APNS_KEY` and deploying turns pushes off.

Builds run from Xcode register as `sandbox`, TestFlight and App Store builds as `production`; the server
sends each to the right Apple host. The simulator on an Intel Mac gets no device token.

A push to a made-up token tells whether Apple accepts the key for this app without needing a phone: Apple
answers `BadDeviceToken` when the key, team and bundle id are right, and a 403 when they are not.

## Checking it

- `npm test` covers the limits, who hears what, and the request Apple is sent (no network).
- On a simulator, `xcrun simctl push <device> com.jmm.the-dungeon-door payload.json` delivers a push by
  hand; the app's launch argument `-pushOpen <kind>:<CODE>` acts as a tap on one.
- A real push needs a real phone, a build with the entitlement and the key on the server.
