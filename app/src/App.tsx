import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Person } from "@tsunagari/shared";
import { api } from "./lib/api";
import { Ctx, type AppCtx } from "./lib/context";
import { initHost } from "./lib/teams";
import { ErrorBox, Loading, Sheet } from "./components/common";
import { PersonCard } from "./components/PersonCard";
import { QrCheckin } from "./components/QrCheckin";
import { Home } from "./screens/Home";
import { Seats } from "./screens/Seats";
import { Voices } from "./screens/Voices";
import { VoiceMap } from "./screens/VoiceMap";
import { MyCard } from "./screens/MyCard";

type Tab = "home" | "seat" | "voice" | "map" | "card";
const TITLES: Record<Tab, string> = { home: "ホーム", seat: "座席", voice: "声", map: "声マップ", card: "わたしの名刺" };

const ICONS: Record<Tab, JSX.Element> = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  seat: <><rect x="3" y="4" width="8" height="7" rx="1.5" /><rect x="13" y="4" width="8" height="7" rx="1.5" /><rect x="3" y="13" width="8" height="7" rx="1.5" /><rect x="13" y="13" width="8" height="7" rx="1.5" /></>,
  voice: <path d="M4 5h16v11H9l-5 4z" />,
  map: <><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2.2" /><path d="M6 16c.8-1.6 5.2-1.6 6 0M14 10h4M14 13h3" /></>,
};

export function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [me, setMe] = useState<Person | null>(null);
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [error, setError] = useState<unknown>(null);
  const [toastMsg, setToastMsg] = useState("");
  const [cardId, setCardId] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
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
    setPeople((prev) => new Map(prev).set(p.id, p));
  }, []);

  const ctx = useMemo<AppCtx | null>(() => me && {
    me, people, toast: setToastMsg, openCard: setCardId, refreshMe,
    dataVersion, bumpData: () => setDataVersion((v) => v + 1),
    workBranch: workBranch ?? me.branchId, setWorkBranch,
  }, [me, people, refreshMe, dataVersion, workBranch, setWorkBranch]);

  if (error) return <div style={{ padding: 20 }}><ErrorBox error={error} /></div>;
  if (!ctx) return <Loading />;
  const cardPerson = cardId ? people.get(cardId) : undefined;

  return (
    <Ctx.Provider value={ctx}>
      <div className="phone">
        <header className="top">
          <div><small>トヨタユナイテッド 社内アプリ</small><h1>{TITLES[tab]}</h1></div>
          <button className="qr-btn" onClick={() => setQrOpen(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM20 14v7M14 20h3" /></svg>
            QRで着席
          </button>
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
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)} aria-current={tab === t ? "page" : undefined}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>{ICONS[t]}</svg>
              {t === "card" ? "名刺" : TITLES[t]}
            </button>
          ))}
        </nav>
        <Sheet open={!!cardPerson} onClose={() => setCardId(null)} label="名刺">
          {cardPerson && <PersonCard person={cardPerson} mine={cardPerson.id === me!.id} />}
        </Sheet>
        <Sheet open={qrOpen} onClose={() => setQrOpen(false)} label="QR着席">
          <QrCheckin onDone={() => setQrOpen(false)} />
        </Sheet>
        <Sheet open={showOnboarding} onClose={() => { setShowOnboarding(false); setTab("card"); }} label="ようこそ">
          <div style={{ textAlign: "center", padding: "16px 10px" }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>ようこそ、{me?.fullName}さん</div>
            <p className="muted" style={{ marginTop: 8 }}>まずは名刺を入力しましょう。まもなく名刺の編集画面に移動します。</p>
          </div>
        </Sheet>
        {toastMsg && <div className="toast on" role="status">{toastMsg}</div>}
      </div>
    </Ctx.Provider>
  );
}
