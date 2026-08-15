import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AppStateCookie {
  key: string;
  value: string;
  domain: string;
  path: string;
  expires?: number | string;
  secure?: boolean;
  httpOnly?: boolean;
}

export interface AppStateValidationResult {
  userId: string;
  cookies: AppStateCookie[];
}

export function loadAppState(filePath: string): AppStateValidationResult {
  const candidatePaths = [
    resolve(filePath),
    resolve('/etc/secrets', filePath),
    resolve('/etc/secrets/appstate.json'),
  ];

  const absolutePath = candidatePaths.find((p) => existsSync(p));

  if (!absolutePath) {
    throw new Error(
      `AppState cookie file not found at: ${filePath}. Export your browser session cookies into this path or mount as a Secret File on Render.`,
    );
  }

  let rawContent: string;
  try {
    rawContent = readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new Error(
      `Failed to read AppState file at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    throw new Error(
      `AppState content contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      `AppState file at ${absolutePath} must be a non-empty array of cookie objects.`,
    );
  }

  const cookies: AppStateCookie[] = [];
  let userId = '';

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const cookieObj = item as Record<string, unknown>;
    const key = String(cookieObj.key ?? cookieObj.name ?? '').trim();
    const value = String(cookieObj.value ?? '').trim();
    const domain = String(cookieObj.domain ?? '.facebook.com').trim();
    const path = String(cookieObj.path ?? '/').trim();

    if (!key || !value) continue;

    if (key === 'c_user') {
      userId = value;
    }

    const cookie: AppStateCookie = {
      key,
      value,
      domain,
      path,
      secure: typeof cookieObj.secure === 'boolean' ? cookieObj.secure : true,
      httpOnly:
        typeof cookieObj.httpOnly === 'boolean' ? cookieObj.httpOnly : false,
    };

    if (
      typeof cookieObj.expires === 'number' ||
      typeof cookieObj.expires === 'string'
    ) {
      cookie.expires = cookieObj.expires;
    }

    cookies.push(cookie);
  }

  if (!userId) {
    throw new Error(
      `AppState is missing the 'c_user' cookie. Ensure you export cookies while logged into Facebook/Messenger.`,
    );
  }

  const hasXs = cookies.some((c) => c.key === 'xs');
  if (!hasXs) {
    throw new Error(
      `AppState is missing the 'xs' session cookie. The session is incomplete.`,
    );
  }

  return { userId, cookies };
}
