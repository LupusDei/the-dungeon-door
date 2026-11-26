/**
 * Sending a push to Apple (APNs): a token signed with the team's push key, and one HTTP/2 request per
 * device. Nothing is sent unless the key is configured (docs/push.md): until then every push is logged and
 * dropped, so the rest of the server runs the same with or without it.
 *
 *   APNS_KEY_ID    the key's id (10 characters)
 *   APNS_TEAM_ID   the Apple developer team id
 *   APNS_KEY       the .p8 file's contents (PEM), or that text base64-encoded
 *   APNS_TOPIC     the app's bundle id; "com.jmm.the-dungeon-door" unless set
 */
import { createPrivateKey, type KeyObject, sign } from 'node:crypto';
import { connect } from 'node:http2';
import type { PushKind } from './throttle.ts';

export type PushEnvironment = 'sandbox' | 'production';
export interface Device { token: string; environment: PushEnvironment }

export interface PushMessage {
  kind: PushKind;
  /** The game it is about; the app opens it (or the way in, for an invitation). */
  code: string;
  title: string;
  body: string;
}

/** sent; gone: the token is dead and should be forgotten; failed: anything else (logged). */
export type SendResult = 'sent' | 'gone' | 'failed';

export interface PushSender {
  /** One result per device, in order. Never throws. */
  send(devices: readonly Device[], message: PushMessage): Promise<SendResult[]>;
}

export interface ApnsConfig { keyId: string; teamId: string; key: KeyObject; topic: string }

const DEFAULT_TOPIC = 'com.jmm.the-dungeon-door';

/** The push key from the environment; null when it is not (all) there, or does not read as a key. */
export function apnsConfig(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const { APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId, APNS_KEY: raw } = env;
  if (!keyId || !teamId || !raw) return null;
  const pem = raw.includes('BEGIN') ? raw.replaceAll('\\n', '\n') : Buffer.from(raw, 'base64').toString('utf8');
  try {
    return { keyId, teamId, key: createPrivateKey(pem), topic: env.APNS_TOPIC || DEFAULT_TOPIC };
  } catch {
    console.error('APNS_KEY is set but is not a private key; pushes are off');
    return null;
  }
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** The provider token APNs asks for: an ES256 JWT naming the team and the key. */
export function providerToken(config: ApnsConfig, now: number): string {
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }));
  const claims = b64url(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) }));
  const signature = sign('sha256', Buffer.from(`${head}.${claims}`), { key: config.key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${claims}.${b64url(signature)}`;
}

const HOSTS: Record<PushEnvironment, string> = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };
/** A push about a turn is worth delivering for hours; chat for half an hour. */
const EXPIRES_AFTER_S: Record<PushKind, number> = { combat: 6 * 3600, turn: 6 * 3600, invite: 24 * 3600, chat: 1800 };

/**
 * The request for one push. Pushes on the same subject share a collapse id, so a newer one takes the
 * older one's place on the lock screen; a game's pushes share a thread, so they stack together.
 */
export function apnsRequest(message: PushMessage, topic: string, now: number): { headers: Record<string, string>; payload: Record<string, unknown> } {
  const subject = message.kind === 'combat' ? 'turn' : message.kind;
  return {
    headers: {
      'apns-topic': topic,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-collapse-id': `${subject}-${message.code}`,
      'apns-expiration': String(Math.floor(now / 1000) + EXPIRES_AFTER_S[message.kind]),
    },
    payload: {
      aps: { alert: { title: message.title, body: message.body }, sound: 'default', 'thread-id': message.code },
      kind: message.kind,
      code: message.code,
    },
  };
}

/** Reasons that mean the token will never work again for this app. */
const DEAD = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken']);

const TOKEN_LIFE_MS = 45 * 60_000; // Apple accepts a token for an hour, and refuses ones refreshed more than every 20 minutes
const REQUEST_TIMEOUT_MS = 10_000;

export class ApnsSender implements PushSender {
  private readonly config: ApnsConfig;
  private token: { value: string; madeAt: number } | null = null;

  constructor(config: ApnsConfig) {
    this.config = config;
  }

  private bearer(now: number): string {
    if (!this.token || now - this.token.madeAt > TOKEN_LIFE_MS) this.token = { value: providerToken(this.config, now), madeAt: now };
    return this.token.value;
  }

  async send(devices: readonly Device[], message: PushMessage): Promise<SendResult[]> {
    const results: SendResult[] = devices.map(() => 'failed');
    for (const environment of ['production', 'sandbox'] as const) {
      const mine = devices.map((d, i) => ({ d, i })).filter(({ d }) => d.environment === environment);
      if (mine.length === 0) continue;
      const sent = await this.sendTo(environment, mine.map(({ d }) => d.token), message).catch((error) => {
        console.error(`push to APNs (${environment}) failed:`, error instanceof Error ? error.message : error);
        return mine.map((): SendResult => 'failed');
      });
      mine.forEach(({ i }, n) => { results[i] = sent[n]; });
    }
    return results;
  }

  /** One connection for all of an environment's devices. */
  private sendTo(environment: PushEnvironment, tokens: readonly string[], message: PushMessage): Promise<SendResult[]> {
    const now = Date.now();
    const { headers, payload } = apnsRequest(message, this.config.topic, now);
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const session = connect(HOSTS[environment]);
      session.once('error', reject);
      session.setTimeout(REQUEST_TIMEOUT_MS, () => session.destroy(new Error('timed out')));
      const one = (token: string) => new Promise<SendResult>((done) => {
        const request = session.request({ ':method': 'POST', ':path': `/3/device/${token}`, authorization: `bearer ${this.bearer(now)}`, ...headers, 'content-type': 'application/json' });
        let status = 0;
        let text = '';
        request.setEncoding('utf8');
        request.on('response', (h) => { status = Number(h[':status']); });
        request.on('data', (chunk: string) => { text += chunk; });
        request.on('error', () => done('failed'));
        request.on('end', () => {
          if (status === 200) return done('sent');
          let reason = '';
          try { reason = (JSON.parse(text) as { reason?: string }).reason ?? ''; } catch { /* no body */ }
          if (status === 410 || DEAD.has(reason)) return done('gone');
          console.error(`APNs refused a push: ${status} ${reason}`);
          done('failed');
        });
        request.end(body);
      });
      Promise.all(tokens.map(one)).then((all) => { session.close(); resolve(all); }, reject);
    });
  }
}

/** With no push key: says so once, and sends nothing. */
class NoSender implements PushSender {
  private said = false;
  async send(devices: readonly Device[], message: PushMessage): Promise<SendResult[]> {
    if (!this.said) console.warn(`push not sent (no APNS_KEY): "${message.title}: ${message.body}". Later ones are dropped silently.`);
    this.said = true;
    return devices.map(() => 'failed');
  }
}

/** Tests and local runs: keeps what would have been sent. */
export class RecordingSender implements PushSender {
  readonly sent: { device: Device; message: PushMessage }[] = [];
  /** Tokens to answer "gone" for. */
  readonly dead = new Set<string>();
  async send(devices: readonly Device[], message: PushMessage): Promise<SendResult[]> {
    return devices.map((device) => {
      if (this.dead.has(device.token)) return 'gone';
      this.sent.push({ device, message });
      return 'sent';
    });
  }
}

let sender: PushSender | undefined;

/** The APNs sender when the key is configured, else one that sends nothing. */
export function getSender(): PushSender {
  if (!sender) {
    const config = apnsConfig();
    sender = config ? new ApnsSender(config) : new NoSender();
  }
  return sender;
}

/** Tests: replace (or with no argument, reset) the sender. */
export function setSender(next?: PushSender): void {
  sender = next;
}
