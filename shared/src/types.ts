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
  fullName: string;      // 氏名（初回は Entra ID から自動入力。本人が編集できる）
  email: string;         // UPN。Teams チャットを開くのに使う
  /** 呼ばれたい名前。自己紹介の一項目（任意）。座席表・投稿などの表示には使わず、氏名（fullName）を使う */
  nickname: string;
  dept: Dept;
  unit: string;          // 所属（例：サービス部）
  branchId: string;
  skills: string[];      // 得意なこと
  hobby?: string;        // 最近ハマっていること（任意）
  askMe?: string;        // こんなこと聞いてください
  talkOk: boolean;       // 気軽に話しかけてOK
  showOnSeatMap: boolean;
  showPrivate: boolean;
  /** アイコン（顔写真など）。小さく切り抜いた画像の data URL。未設定なら頭文字の丸アイコン */
  avatarUrl?: string;
  /** 最後にアプリを開いていた時刻（ISO）。オンライン判定に使う */
  lastSeenAt?: string;
  /** /people のときだけ返る。オンライン（最近アプリを開いている、または今日着席中）なら true */
  online?: boolean;
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

/**
 * 投稿の種類。
 * kaizen = 要改善事項（これから改善したいこと。対応の進み具合を公開する）
 * report = 業務改善報告（すでに改善した事例の簡略版。共有して、ほかの拠点でも使えるようにする）
 */
export type PostKind = "hitokoto" | "kaizen" | "report" | "official";
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
  // 業務改善報告（report）のみ。改善した結果どうなったか（一覧に出す短い版）
  effect?: string;
  // 業務改善報告（report）のみ。会社の「改善報告書」にそのまま転記できる詳細。無い古い投稿は、本文などから自動で埋める
  report?: ReportDetail;
  // 要改善事項（kaizen）のみ
  status?: KaizenStatus;
  assignedTo?: string;
  /** 要改善事項・業務改善報告。一緒に取り組んだ人。拠点をまたぐと、声マップで拠点どうしが線で結ばれる */
  coAuthorIds?: string[];
}

/** 共有タスク。全体へのアナウンスとして、ホーム画面に表示する */
export interface SharedTask {
  id: string;
  title: string;
  body?: string;
  dueDate?: string;      // YYYY-MM-DD
  createdBy: string;
  createdAt: string;
  doneBy: string[];      // 完了した人の id
}

/** アプリ内チャットのメッセージ（1対1） */
export interface ChatMessage {
  id: string;
  threadId: string;
  fromId: string;
  toId: string;
  body: string;
  createdAt: string;
  readAt?: string;
}

/** チャット一覧の1行 */
export interface ChatThread {
  personId: string;      // 相手
  last: ChatMessage;
  unread: number;
}

/** 改善区分（会社の改善報告書のチェック欄） */
export const REPORT_CATEGORIES = ["業務改善", "品質改善", "クレーム対応", "事故・トラブル対応", "その他"] as const;

/** 業務改善報告の詳細。会社の「改善報告書」の記載項目に対応する */
export interface ReportDetail {
  title: string;          // 件名
  target: string;         // 対象業務・部署
  periodStart?: string;   // 改善実施期間（YYYY-MM-DD）
  periodEnd?: string;
  categories: string[];   // 改善区分
  background: string;     // 1. 背景・現状（問題点）
  cause: string;          // 2. 原因分析（直接原因・根本原因）
  measures: string;       // 3. 改善策・実施した対策
  implementedOn?: string; // 実施日（YYYY-MM-DD）
  implementer?: string;   // 実施担当
  result: string;         // 4. 実施結果・効果
  followUp: string;       // 5. 考察・再発防止・今後の対応
}
