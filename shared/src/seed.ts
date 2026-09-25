import type { Branch, Person, Post } from "./types.js";
import { DEFAULT_SEAT_CONFIG } from "./types.js";
import { buildSeatsFromConfig } from "./lottery.js";

/** ローカル開発・デモ用の架空データ。実在の人物・拠点とは関係ありません */
export const SEED_BRANCHES: Branch[] = [
  { id: "hq", name: "本社", mapX: 170, mapY: 95, seatConfig: { groups: [{ capacity: 4, count: 3 }], privateCount: 4 }, seatAdminIds: ["u05"] },
  { id: "a", name: "A店", mapX: 115, mapY: 70, seatConfig: DEFAULT_SEAT_CONFIG, seatAdminIds: [] },
  { id: "b", name: "B店", mapX: 215, mapY: 140, seatConfig: DEFAULT_SEAT_CONFIG, seatAdminIds: [] },
  { id: "c", name: "C店", mapX: 120, mapY: 175, seatConfig: DEFAULT_SEAT_CONFIG, seatAdminIds: [] },
  { id: "d", name: "D店", mapX: 230, mapY: 230, seatConfig: DEFAULT_SEAT_CONFIG, seatAdminIds: [] },
  { id: "e", name: "E店", mapX: 160, mapY: 320, seatConfig: DEFAULT_SEAT_CONFIG, seatAdminIds: [] },
];

const P = (
  id: string, fullName: string, nickname: string, dept: Person["dept"], unit: string,
  skills: string[], hobby: string, askMe: string, talkOk = true,
): Person => ({
  id, fullName, email: `${id}@example.co.jp`, nickname, dept, unit, branchId: "hq", skills, hobby, askMe, talkOk,
  showOnSeatMap: true, showPrivate: true, profileCompleted: true,
});

export const SEED_PEOPLE: Person[] = [
  P("u01", "山本 健太", "けんた", "sales", "法人営業", ["法人リース", "見積り"], "週末は吉野川で釣り", "社用車の入れ替え相談、いつでもどうぞ"),
  P("u02", "井上 美咲", "みさき", "eng", "サービス部", ["ハイブリッド診断", "点検説明"], "サーキット走行（社内チームで参戦）", "お客様への整備説明、一緒に考えます"),
  P("u03", "森 悠斗", "ゆうと", "eng", "板金", ["板金", "保険修理"], "キャンプ", "事故車の見積り、写真を送ってくれたら見ます"),
  P("u04", "清水 彩", "あや", "sales", "店舗営業", ["初めての車選び", "ファミリー層"], "パン屋めぐり", "若いお客様への提案資料を作っています"),
  P("u05", "松田 翔平", "しょうへい", "office", "本部 広報", ["社内ニュース", "写真撮影"], "奈良の古墳めぐり", "ネタ募集中です。写真1枚でも大歓迎"),
  P("u06", "岡田 奈緒", "なお", "office", "業務部", ["保険手続き", "登録業務"], "ヨガ", "名義変更の書類で迷ったら聞いてください", false),
  P("u07", "藤原 大輝", "だいき", "eng", "サービス部", ["EV充電", "電装"], "レース参戦、ミニ四駆", "EVの質問、お客様対応前に確認したい時に"),
  P("u08", "石田 遥", "はるか", "sales", "U-Car", ["中古車", "査定"], "映画", "下取り相場の感覚、共有します"),
  P("u09", "長谷川 拓也", "たくや", "office", "本部 人事", ["研修", "採用"], "マラソン", "新人さんの受け入れで困ったら"),
  P("u10", "村上 亮", "りょう", "eng", "サービス部", ["ADAS校正", "診断機"], "ゲーム", "安全装備の説明、営業さん向けに話せます"),
  P("u11", "近藤 麻衣", "まい", "sales", "店舗営業", ["リース・サブスク", "高齢のお客様"], "料理", "免許返納を考えるお客様の相談事例あります"),
  P("u12", "坂本 浩二", "こうじ", "office", "経理", ["経費精算"], "家庭菜園", "精算の締め切り前に一声かけます", false),
  // 初回ログインのデモ用：名刺が未入力の新人
  {
    id: "u13", fullName: "小林 蒼", email: "u13@example.co.jp", nickname: "", dept: "office", unit: "本部",
    branchId: "hq", skills: [], talkOk: true, showOnSeatMap: true, showPrivate: false,
    profileCompleted: false,
  },
];

export const SEED_SEATS = buildSeatsFromConfig("hq", "2F", { groups: [{ capacity: 4, count: 3 }], privateCount: 4 });

const today = new Date().toISOString();
export const SEED_POSTS: Post[] = [
  { id: "p1", kind: "hitokoto", authorId: "u07", authorDept: "eng", branchId: "c", category: "レース・イベント", body: "週末のレース、完走しました。ピットで使った工具の話、明日の朝礼でします。", createdAt: today, reactions: 24, pickedForNews: true },
  { id: "p2", kind: "hitokoto", authorId: "u11", authorDept: "sales", branchId: "hq", category: "お客様の笑顔", body: "免許返納を迷っていたお客様、サポカー試乗のあと笑顔で帰られました。りょうさんの安全装備の説明が効きました。", createdAt: today, reactions: 31 },
  { id: "p3", kind: "hitokoto", authorId: "u03", authorDept: "eng", branchId: "a", category: "できごと", body: "店の前の花壇、お客様のお子さんと一緒に植え替えました。", createdAt: today, reactions: 12, photoUrl: "/gallery/sakura.jpg" },
  { id: "p4", kind: "hitokoto", authorId: "u05", authorDept: "office", branchId: "hq", category: "できごと", body: "朝礼のあと、休憩スペースの飾りつけをしました。", createdAt: today, reactions: 8, photoUrl: "/gallery/room.jpg" },
  { id: "p6", kind: "hitokoto", authorId: "u09", authorDept: "office", branchId: "d", category: "できごと", body: "交通安全ポスターを貼りました。止まろう、横断歩道！", createdAt: today, reactions: 9, photoUrl: "/gallery/poster.jpg" },
  { id: "p5", kind: "hitokoto", authorId: "u01", authorDept: "sales", branchId: "hq", category: "お客様の笑顔", body: "展示コーナーの模様替え。ミニカーも並べました。", createdAt: today, reactions: 6, photoUrl: "/gallery/shelf.jpg" },
  { id: "k1", kind: "kaizen", authorId: null, authorDept: null, branchId: "b", category: "業務の効率化", body: "代車の空き状況を営業が電話で確認している。サービスと同じ画面で見られないか。", createdAt: today, reactions: 18, status: "inProgress", assignedTo: "サービス部", coAuthorIds: ["u08", "u10"] },
  { id: "k2", kind: "kaizen", authorId: "u01", authorDept: "sales", branchId: "hq", category: "お客様対応", body: "点検の説明をエンジニアから直接聞きたいお客様が多い。短い動画で送れると良い。", createdAt: today, reactions: 9, status: "reviewing", assignedTo: "サービス部", coAuthorIds: ["u02"] },
  { id: "k3", kind: "kaizen", authorId: "u06", authorDept: "office", branchId: "hq", category: "設備・環境", body: "2Fの複合機の用紙切れが多い。補充当番を決めたい。", createdAt: today, reactions: 5, status: "done", assignedTo: "総務" },
  { id: "n1", kind: "official", authorId: "u05", authorDept: "office", branchId: "hq", category: "お知らせ", body: "今月の安全運転講習は10月3日（金）に実施します。参加登録は各店の責任者まで。", createdAt: today, reactions: 7 },
  { id: "r1", kind: "report", authorId: "u04", authorDept: "sales", branchId: "hq", category: "お客様対応", body: "初めてのお客様向けの案内：説明の順番をそろえ、1枚にまとめた。", effect: "同じ質問が半分になった", createdAt: today, reactions: 11,
    report: { title: "初めてのお客様向けの案内資料の作成について", target: "本社 店舗営業", periodStart: "2026-08-01", periodEnd: "2026-08-20", categories: ["業務改善", "品質改善"],
      background: "初めてご来店のお客様から、同じ質問（保証・点検・支払い方法）を何度もいただき、説明に時間がかかっていた。", cause: "説明の順番と内容が、担当者ごとに違っていた。",
      measures: "よくある質問と答えを1枚にまとめ、商談の最初にお渡しする形にした。", implementedOn: "2026-08-20", implementer: "",
      result: "同じ質問が半分ほどに減り、商談の時間が短くなった。", followUp: "お客様の声を聞いて、半年ごとに内容を見直す。" } },
  { id: "r2", kind: "report", authorId: "u02", authorDept: "eng", branchId: "hq", category: "品質・整備", body: "点検結果を写真つきで見せるようにした。", effect: "お客様の納得が早くなった", createdAt: today, reactions: 15, coAuthorIds: ["u01"] },
  { id: "r3", kind: "report", authorId: "u06", authorDept: "office", branchId: "hq", category: "業務の効率化", body: "名義変更の書類のチェック表を作った。", effect: "書類の戻りが減った", createdAt: today, reactions: 8 },
  { id: "r4", kind: "report", authorId: "u07", authorDept: "eng", branchId: "c", category: "安全", body: "ピットの通路に足元のラインを引いた。", effect: "つまずきそうになる場面が減った", createdAt: today, reactions: 10 },
  { id: "r5", kind: "report", authorId: "u03", authorDept: "eng", branchId: "a", category: "設備・環境", body: "板金ブースに送風機を追加した。", effect: "夏場の作業の負担が減った", createdAt: today, reactions: 6 },];
