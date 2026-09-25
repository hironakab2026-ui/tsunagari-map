import { createContext, useContext } from "react";
import type { Person, Post } from "@tsunagari/shared";

export interface AppCtx {
  me: Person;
  people: Map<string, Person>;
  toast: (msg: string) => void;
  openCard: (personId: string) => void;
  refreshMe: (p: Person) => void;
  dataVersion: number;
  bumpData: () => void;
  /** アプリ内チャットを開く。相手を指定するとその人との会話、省略すると会話の一覧 */
  openChat: (personId?: string) => void;
  /** 投稿の作成画面を開く（写真をギャラリーに追加するときなど） */
  startPost: () => void;
  /** 業務改善報告を、会社の改善報告書の形で表示する（Wordでダウンロードもできる） */
  openReport: (post: Post) => void;
  /** 未読メッセージの数を取り直す */
  refreshChats: () => void;
  /** 今日働く支店。ホームの抽選と座席画面で共通 */
  workBranch: string;
  setWorkBranch: (id: string) => void;
}

export const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("AppCtx missing");
  return c;
};
