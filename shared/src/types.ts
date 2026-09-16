/** 部門区分。要件定義書 16章 No.7 で最終確定する */
export type Dept = "sales" | "eng" | "office";

export const DEPT_LABEL: Record<Dept, string> = {
  sales: "営業",
  eng: "エンジニア",
  office: "事務・本部",
};

/** パートナー（社員）とデジタル名刺 */
export interface Person {
  id: string;            // Entra ID のオブジェクトID
  fullName: string;      // 氏名（Entra ID から自動入力）
  email: string;         // UPN。Teams チャットを開くのに使う
  nickname: string;      // 呼ばれたい名前
  dept: Dept;
  unit: string;          // 所属（例：サービス部）
  branchId: string;
  skills: string[];      // 得意なこと
  hobby?: string;        // 最近ハマっていること（任意）
  askMe?: string;        // こんなこと聞いてください
  talkOk: boolean;       // 気軽に話しかけてOK
  showOnSeatMap: boolean;
  showPrivate: boolean;
  acceptWish: boolean;   // 話したい人リクエストを受け付けるか
  /** 名刺を一度でも保存したか。false の間は初回ログイン案内を表示する */
  profileCompleted: boolean;
  /** /me のときだけ返る。Entra のアプリロール */
  roles?: string[];
  /** /me のときだけ返る。所属支社の座席設定を編集できるか */
  isSeatAdmin?: boolean;
}

export type SeatType = "normal" | "focus" | "care" | "fixed";
export type SeatKind = "group" | "private";

export interface Seat {
  id: string;         // 例: HQ2F-4
  branchId: string;
  floor: string;
  kind: SeatKind;      // group: 複数人が座れる円形の席／private: 1人用の席
  number: number;      // 表示番号。グループ席から若い番号を振る
  label: string;       // 表示ラベル（番号の文字列）
  capacity: number;    // group: 管理者が設定した人数。private: 常に1
  type: SeatType;      // group は常に normal。private のみ focus/care/fixed を取りうる
  fixedPersonId?: string;
}

export interface SeatGroupDef {
  capacity: number; // 1島あたりの人数（例：4人用）
  count: number;    // その人数のグループ席をいくつ作るか
}

export interface SeatConfig {
  groups: SeatGroupDef[];
  privateCount: number;
}

export const DEFAULT_SEAT_CONFIG: SeatConfig = {
  groups: [{ capacity: 4, count: 3 }],
  privateCount: 4,
};

export interface Branch {
  id: string;
  name: string;
  /** 声マップ用の模式図座標（0〜360, 0〜420） */
  mapX: number;
  mapY: number;
  seatConfig: SeatConfig;
  /** この支社の座席設定を編集できる人（SeatManager/Admin ロールに加えて個別に付与） */
  seatAdminIds: string[];
}

/** 座席の占有レコード。着席時に作成、退席時に削除する */
export interface SeatOccupancy {
  branchId: string;
  seatId: string;
  date: string;         // YYYY-MM-DD（拠点タイムゾーン）
  personIds: string[];  // group 席は複数人になりうる
}

export interface Wish {
  fromId: string;
  toId: string;
}

export type PostKind = "hitokoto" | "kaizen" | "official";
export type KaizenStatus = "received" | "reviewing" | "inProgress" | "done";

export const KAIZEN_STATUS_LABEL: Record<KaizenStatus, string> = {
  received: "受付",
  reviewing: "検討中",
  inProgress: "対応中",
  done: "対応済み",
};

export interface Post {
  id: string;
  kind: PostKind;
  authorId: string | null;   // 匿名の改善の声は null で返す
  authorDept: Dept | null;
  branchId: string;
  category: string;
  body: string;
  photoUrl?: string;
  createdAt: string;
  reactions: number;
  pickedForNews?: boolean;
  // 公式ニュース（official）のみ。動画部門向けの動画リンク
  mediaType?: "image" | "video";
  mediaUrl?: string;
  // 改善の声のみ
  status?: KaizenStatus;
  assignedTo?: string;
  coAuthorIds?: string[];
}
