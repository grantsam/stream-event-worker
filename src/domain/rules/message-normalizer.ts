const TERMINAL_PUNCTUATION = /[.!?。！？]+$/u;

export function normalizeMessage(body: string): string {
  return body
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(TERMINAL_PUNCTUATION, '')
    .trim();
}
