export const CHAT_MAX_LENGTH = 500;

/** 2人の会話を1つにまとめるための識別子。相手の順序によらず同じ値になる */
export function threadIdOf(a: string, b: string): string {
  return [a, b].sort().join("~");
}