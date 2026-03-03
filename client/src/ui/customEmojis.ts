export type CustomEmoji = {
  name: string; // without colons
  url: string;
};

const STORAGE_KEY = 'tt:customEmojis';

export function loadCustomEmojis(): CustomEmoji[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x.name === 'string' && typeof x.url === 'string')
      .map((x) => ({ name: String(x.name).trim(), url: String(x.url).trim() }))
      .filter((x) => x.name && x.url);
  } catch {
    return [];
  }
}

export function saveCustomEmojis(list: CustomEmoji[]) {
  const cleaned = list
    .map((x) => ({ name: x.name.trim(), url: x.url.trim() }))
    .filter((x) => x.name && x.url);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
}

export function toCustomToken(name: string) {
  const n = name.trim().replace(/^:+|:+$/g, '');
  return `:${n}:`;
}

export function isCustomToken(token: string) {
  return /^:[a-zA-Z0-9_\-]{1,32}:$/.test(token);
}

export function tokenToName(token: string) {
  return token.replace(/^:/, '').replace(/:$/, '');
}

export function customEmojiUrlForToken(token: string, custom: CustomEmoji[]) {
  if (!isCustomToken(token)) return null;
  const name = tokenToName(token).toLowerCase();
  const found = custom.find((c) => c.name.toLowerCase() === name);
  return found?.url ?? null;
}
