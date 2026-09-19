import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Person } from "@tsunagari/shared";
import { api } from "./lib/api";
import { Ctx, type AppCtx } from "./lib/context";
import { initHost } from "./lib/teams";
import { ErrorBox, Loading, Sheet } from "./components/common";
import { ChatPanel } from "./components/ChatPanel";
import { PersonCard } from "./components/PersonCard";
import { QrCheckin } from "./components/QrCheckin";
import { Home } from "./screens/Home";
import { Seats } from "./screens/Seats";
import { Voices } from "./screens/Voices";
import { VoiceMap } from "./screens/VoiceMap";
import { MyCard } from "./screens/MyCard";

type Tab = "home" | "seat" | "voice" | "map" | "card";
const TITLES: Record<Tab, string> = { home: "ホーム", seat: "座席", voice: "声", map: "声マップ", card: "わたしの名刺" };

/** 下のタブのアイコンは、トヨタユナイテッドのマスコット（チャウピー＝緑、チャウニー＝ピンク）。交互に並べる */
const MASCOT: Record<Tab, "chaupy" | "chaunee"> = { home: "chaupy", seat: "chaunee", voice: "chaupy", map: "chaunee", card: "chaupy" };

/** 在席の目安：この間隔で「開いている」ことを伝え、みんなのオンライン状況を取り直す */
const PRESENCE_MS = 60_000;
const CHAT_POLL_MS = 15_000;

export function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [me, setMe] = useState<Person | null>(null);
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [error, setError] = useState<unknown>(null);
  const [toastMsg, setToastMsg] = useState("");
  const [cardId, setCardId] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [chat, setChat] = useState<{ peer?: string } | null>(null);
  const [unread, setUnread] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [workBranch, setWorkBranchState] = useState<string | null>(() => {
    try { return localStorage.getItem("workBranch"); } catch { return null; }
  });
  const setWorkBranch = useCallback((id: string) => {
    setWorkBranchState(id);
    try { localStorage.setItem("workBranch", id); } catch { /* 保存できなくても動く */ }
  }, []);
  const onboardingShown = useRef(false);
  const mainRef = useRef<HTMLElement>(null);

  // タブを切り替えたら、画面の先頭から見せる
  useEffect(() => { mainRef.current?.scrollTo({ top: 0, behavior: "instant" }); }, [tab]);

  useEffect(() => {
    (async () => {
      try {
        await initHost();
        const [m, ps] = await Promise.all([api.me(), api.people()]);
        setMe(m);
        setPeople(new Map(ps.map((p) => [p.id, p])));
      } catch (e) {
        setError(e);
      }
    })();
  }, []);

  // 開いている間は「オンライン」を伝え、みんなのオンライン状況を定期的に取り直す
  const signedIn = !!me;
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        await api.heartbeat();
        const ps = await api.people();
        if (alive) setPeople(new Map(ps.map((p) => [p.id, p])));
      } catch { /* 通信できないときは次の機会に */ }
    };
    void api.heartbeat().catch(() => undefined);
    const t = setInterval(tick, PRESENCE_MS);
    return () => { alive = false; clearInterval(t); };
  }, [signedIn]);

  const refreshChats = useCallback(async () => {
    try { setUnread((await api.chatThreads()).reduce((n, t) => n + t.unread, 0)); } catch { /* 次の機会に */ }
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    void refreshChats();
    const t = setInterval(() => { if (!document.hidden) void refreshChats(); }, CHAT_POLL_MS);
    return () => clearInterval(t);
  }, [signedIn, refreshChats]);

  // 初回ログイン（名刺が未入力）の場合は案内を表示し、しばらくして名刺タブへ自動的に移動する
  useEffect(() => {
    if (!me || me.profileCompleted || onboardingShown.current) return;
    onboardingShown.current = true;
    setShowOnboarding(true);
    const t = setTimeout(() => { setShowOnboarding(false); setTab("card"); }, 2200);
    return () => clearTimeout(t);
  }, [me]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(""), 2600);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const refreshMe = useCallback((p: Person) => {
    setMe(p);
    setPeople((prev) => new Map(prev).set(p.id, { ...prev.get(p.id), ...p, online: true }));
  }, []);

  const ctx = useMemo<AppCtx | null>(() => me && {
    me, people, toast: setToastMsg, openCard: setCardId, refreshMe,
    dataVersion, bumpData: () => setDataVersion((v) => v + 1),
    workBranch: workBranch ?? me.branchId, setWorkBranch,
    openChat: (peer?: string) => { setCardId(null); setChat({ peer }); },
    startPost: () => { setTab("voice"); setComposeOpen(true); },
    refreshChats: () => { void refreshChats(); },
  }, [me, people, refreshMe, dataVersion, workBranch, setWorkBranch, refreshChats]);

  if (error) return <div style={{ padding: 20 }}><ErrorBox error={error} /></div>;
  if (!ctx) return <Loading />;
  const cardPerson = cardId ? people.get(cardId) : undefined;
  const base = import.meta.env.BASE_URL;

  return (
    <Ctx.Provider value={ctx}>
      <div className="phone">
        <header className="top">
          <div><small>トヨタユナイテッド 社内アプリ</small><h1>{TITLES[tab]}</h1></div>
          <div className="hdr-actions">
            <button className="hdr-btn chat-btn" onClick={() => setChat({})} aria-label={unread > 0 ? `チャット（未読${unread}件）` : "チャット"}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden><path d="M4 5h16v11H9l-5 4z" /></svg>
              {unread > 0 && <span className="badge pink">{unread > 9 ? "9+" : unread}</span>}
            </button>
            <button className="hdr-btn qr-btn" onClick={() => setQrOpen(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM20 14v7M14 20h3" /></svg>
              QRで着席
            </button>
          </div>
        </header>
        <main ref={mainRef}>
          <div key={tab} className="screen-in">
            {tab === "home" && <Home />}
            {tab === "seat" && <Seats />}
            {tab === "voice" && <Voices composeOpen={composeOpen} setComposeOpen={setComposeOpen} />}
            {tab === "map" && <VoiceMap />}
            {tab === "card" && <MyCard />}
          </div>
        </main>
        {tab === "voice" && !composeOpen && <button className="fab" onClick={() => setComposeOpen(true)}>＋ 投稿する</button>}
        <nav className="tabs">
          {(Object.keys(TITLES) as Tab[]).map((t) => (
            <button key={t} className={`${tab === t ? "on" : ""} m-${MASCOT[t]}`} onClick={() => setTab(t)} aria-current={tab === t ? "page" : undefined}>
              <img src={`${base}mascot/${MASCOT[t]}.png`} alt="" width={40} height={40} draggable={false} />
              <span>{t === "card" ? "名刺" : TITLES[t]}</span>
            </button>
          ))}
        </nav>
        <Sheet open={!!cardPerson} onClose={() => setCardId(null)} label="名刺">
          {cardPerson && <PersonCard person={cardPerson} mine={cardPerson.id === me!.id} />}
        </Sheet>
        <Sheet open={qrOpen} onClose={() => setQrOpen(false)} label="QR着席">
          <QrCheckin onDone={() => setQrOpen(false)} />
        </Sheet>
        <Sheet open={!!chat} onClose={() => { setChat(null); void refreshChats(); }} label="チャット">
          {chat && <ChatPanel key={chat.peer ?? "list"} initialPeer={chat.peer} />}
        </Sheet>
        <Sheet open={showOnboarding} onClose={() => { setShowOnboarding(false); setTab("card"); }} label="ようこそ">
          <div style={{ textAlign: "center", padding: "16px 10px" }}>
            <img src={`${base}mascot/chaupy.png`} alt="" width={72} height={72} />
            <div style={{ fontWeight: 700, fontSize: 16, marginTop: 6 }}>ようこそ、{me?.fullName}さん</div>
            <p className="muted" style={{ marginTop: 8 }}>まずは名刺を入力しましょう。まもなく名刺の編集画面に移動します。</p>
          </div>
        </Sheet>
        {toastMsg && <div className="toast on" role="status">{toastMsg}</div>}
      </div>
    </Ctx.Provider>
  );
}
