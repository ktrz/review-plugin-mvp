import * as vscode from 'vscode';

const AVATAR_SIZE = 48;

const cache = new Map<string, vscode.Uri>();
const inflight = new Map<string, Promise<vscode.Uri | undefined>>();

export function githubAvatarUri(login: string): vscode.Uri {
  return vscode.Uri.parse(`https://github.com/${encodeURIComponent(login)}.png?size=${AVATAR_SIZE}`);
}

// Synchronous lookup for the circular avatar; undefined until ensureRoundAvatar
// has fetched and cached it. Callers fall back to the square githubAvatarUri.
export function cachedRoundAvatar(login: string): vscode.Uri | undefined {
  return cache.get(login);
}

// GitHub serves a square PNG, and VS Code does not clip comment avatars, so we
// fetch the bytes once and re-wrap them in an SVG with a circular clip path.
// Concurrent calls for the same login share a single fetch.
export async function ensureRoundAvatar(login: string): Promise<vscode.Uri | undefined> {
  const cached = cache.get(login);
  if (cached !== undefined) {
    return cached;
  }
  let pending = inflight.get(login);
  if (pending === undefined) {
    pending = loadRoundAvatar(login);
    inflight.set(login, pending);
  }
  try {
    return await pending;
  } finally {
    inflight.delete(login);
  }
}

export function clearAvatarCache(): void {
  cache.clear();
  inflight.clear();
}

async function loadRoundAvatar(login: string): Promise<vscode.Uri | undefined> {
  const source = githubAvatarUri(login).toString();
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`GitHub avatar fetch for @${login} failed with status ${response.status}`);
  }
  const pngBase64 = Buffer.from(await response.arrayBuffer()).toString('base64');
  const uri = vscode.Uri.parse(roundSvgDataUri(pngBase64));
  cache.set(login, uri);
  return uri;
}

function roundSvgDataUri(pngBase64: string): string {
  const radius = AVATAR_SIZE / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" ` +
    `viewBox="0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}">` +
    `<defs><clipPath id="r"><circle cx="${radius}" cy="${radius}" r="${radius}"/></clipPath></defs>` +
    `<image href="data:image/png;base64,${pngBase64}" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" ` +
    `preserveAspectRatio="xMidYMid slice" clip-path="url(#r)"/>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
