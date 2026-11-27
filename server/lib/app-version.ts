import { HttpError } from './http.ts';

/**
 * Oldest CFBundleVersion (the iOS build number) this server will begin a tale or a dungeon with.
 *
 * The app sends it on `x-dd-app-version` as `{marketing}+{build}` (for example `0.2+47`). A bare
 * build number (`47`) or `0.2 (47)` is accepted too. A client that sends no build is older than
 * every minimum: those builds predate this header.
 *
 * How to bump it:
 * - `ios/fastlane` (`bump_build`) sets CFBundleVersion to one past the newest TestFlight build at
 *   upload time, in the temporary worktree. It does not write that number back. `ios/project.yml`
 *   keeps `CURRENT_PROJECT_VERSION: "1"` for local Xcode builds, and `MARKETING_VERSION` (`0.2`)
 *   is not bumped by the ship script.
 * - Ship the build, read its number in TestFlight, then set this constant to that number (and
 *   deploy the server). Or set `DD_MIN_APP_VERSION` to the build number, or to `marketing+build`,
 *   without a code change. Setting the constant in the same commit as the app races the +1
 *   fastlane assigns.
 */
export const MIN_APP_BUILD = 1;

export const UPDATE_REQUIRED_CODE = 'update_required';
export const UPDATE_REQUIRED_MESSAGE = 'Update the app to keep playing. This version of The Dungeon Door is no longer supported.';
export const PARTY_OUTDATED_CODE = 'party_outdated';

const HEADER_MAX = 64;
const PLUS = /^(\d+(?:\.\d+)*)\+(\d+)$/;
const PAREN = /^(\d+(?:\.\d+)*)\s*\((\d+)\)$/;
const BUILD = /^\d{1,10}$/;
const MARKETING = /^\d+(?:\.\d+)*$/;

export interface ParsedAppVersion {
  raw: string;
  marketing: string | null;
  build: number | null;
}

/** The header value, trimmed and capped. Null when the client sent none. */
export function appVersionOf(request: Request): string | null {
  const raw = request.headers.get('x-dd-app-version')?.trim() ?? '';
  if (!raw) return null;
  return raw.slice(0, HEADER_MAX);
}

export function parseAppVersion(header: string | null | undefined): ParsedAppVersion | null {
  if (header == null) return null;
  const raw = header.trim();
  if (!raw || raw.length > HEADER_MAX) return null;
  let marketing: string | null = null;
  let buildText: string | null = null;
  const plus = PLUS.exec(raw);
  const paren = PAREN.exec(raw);
  if (plus) {
    marketing = plus[1];
    buildText = plus[2];
  } else if (paren) {
    marketing = paren[1];
    buildText = paren[2];
  } else if (BUILD.test(raw)) {
    buildText = raw;
  } else if (MARKETING.test(raw)) {
    marketing = raw;
  } else {
    return null;
  }
  const build = buildText === null ? null : Number(buildText);
  if (build !== null && (!Number.isSafeInteger(build) || build < 0 || build > 1_000_000_000)) return null;
  return { raw, marketing, build };
}

/** The build a party must have, from `DD_MIN_APP_VERSION` when that sets one, otherwise `MIN_APP_BUILD`. */
export function minAppBuild(): number {
  const override = process.env.DD_MIN_APP_VERSION?.trim();
  if (override) {
    const parsed = parseAppVersion(override);
    if (parsed?.build != null) return parsed.build;
  }
  return MIN_APP_BUILD;
}

/** A header this server accepts. Dev tools and tests send it so they count as a current build. */
export function supportedAppVersionHeader(marketing = '0.0'): string {
  return `${marketing}+${minAppBuild()}`;
}

/** A header just below the minimum: a lower build, or a marketing version with no build when the minimum is 0. */
export function outdatedAppVersionHeader(): string {
  const min = minAppBuild();
  return min > 0 ? `0.0+${min - 1}` : '0.0';
}

/** True when the header is missing, has no build number, or the build is below the minimum. */
export function isOutdated(header: string | null | undefined): boolean {
  const parsed = parseAppVersion(header ?? null);
  if (!parsed || parsed.build === null) return true;
  return parsed.build < minAppBuild();
}

export function partyOutdatedMessage(names: readonly string[]): string {
  const who = names.length === 0 ? 'Someone'
    : names.length === 1 ? names[0]!
    : names.length === 2 ? `${names[0]} and ${names[1]}`
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const verb = names.length === 1 ? 'needs' : 'need';
  return `${who} ${verb} to update the app before the adventure can begin.`;
}

export function updateRequired(): HttpError {
  return new HttpError(426, UPDATE_REQUIRED_MESSAGE, UPDATE_REQUIRED_CODE);
}

export function partyOutdated(names: readonly string[]): HttpError {
  return new HttpError(409, partyOutdatedMessage(names), PARTY_OUTDATED_CODE);
}

export function requireCurrentApp(appVersion: string | null): void {
  if (isOutdated(appVersion)) throw updateRequired();
}
