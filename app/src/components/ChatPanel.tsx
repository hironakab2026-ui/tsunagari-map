import { useEffect, useRef, useState } from "react";
import { CHAT_MAX_LENGTH, type ChatMessage } from "@tsunagari/shared";
import { api } from "../lib/api";
import { useApp } from "../lib/context";
import { openTeamsChat } from "../lib/teams";
import { useAsync } from "../lib/useAsync";
import { Avatar, ErrorBox } from "./common";

const timeLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
};

/** アプリ内チャット。相手を指定すると会話、指定しないと会話の一覧（と新しい相手の選択） */
export function ChatPanel({ initialPeer }: { initialPeer?: string }) {
  const [peer, setPeer] = useState<string | null>(initialPeer ?? null);
  return peer ? <Thread peerId={peer} onBack={initialPeer ? undefined : () => setPeer(null)} /> : <ThreadList onOpen={setPeer} />;
}

function ThreadList({ onOpen }: { onOpen: (id: string) => void }) {
  const { me, people } = useApp();
  const threads = useAsync(() => api.chatThreads(), []);
  const [pick, setPick] = useState("");
  const others = [...people.values()].filter((p) => p.id !== me.id).sort((a, b) => a.fullName.localeCompare(b.fullName, "ja"));

  return (
    <>
      <div style={{ fontWeight: 800, fontSize: 15 }}>チャット</div>
      <p className="muted" style={{ marginTop: 2 }}>社内の人と、1対1でメッセージをやり取りできます。</p>
      <div className="chat-new">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="チャットを始める相手">
          <option value="">新しくチャットを始める相手を選ぶ</option>
          {others.map((p) => <option key={p.id} value={p.id}>{p.fullName}（{p.unit}）</option>)}
        </select>
        <button type="button" className="text-btn" disabled={!pick} onClick={() => onOpen(pick)}>開く</button>
      </div>
      {threads.loading && !threads.data && <div className="muted">読み込んでいます…</div>}
      <ErrorBox error={threads.error} />
      {threads.data?.length === 0 && <div className="panel muted" style={{ marginTop: 10 }}>まだチャットはありません。名刺の「チャットする」からも始められます。</div>}
      <div className="chat-list">
        {(threads.data ?? []).map((t) => {
          const p = people.get(t.personId);
          return (
            <button key={t.personId} type="button" className="chat-row" onClick={() => onOpen(t.personId)}>
              <Avatar person={p ?? null} size={40} />
              <span className="chat-row-body">
                <b>{p?.fullName ?? "退職・削除された人"}</b>
                <span className="muted">{t.last.fromId === me.id ? "あなた：" : ""}{t.last.body}</span>
              </span>
              <span className="chat-row-meta">
                <span className="muted">{timeLabel(t.last.createdAt)}</span>
                {t.unread > 0 && <span className="badge pink">{t.unread}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Thread({ peerId, onBack }: { peerId: string; onBack?: () => void }) {
  const { me, people, refreshChats } = useApp();
  const peer = people.get(peerId);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // 開いている間は数秒おきに新着を確認する
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = await api.chatMessages(peerId);
        if (alive) { setMessages(list); refreshChats(); }
      } catch (e) { if (alive) setError(e); }
    };
    void load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [peerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = messages?.length ?? 0;
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [count]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setError(null);
    try {
      const msg = await api.sendChat(peerId, body);
      setMessages((prev) => [...(prev ?? []), msg]);
      setText("");
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <div className="chat">
      <div className="chat-head">
        {onBack && <button type="button" className="text-btn" onClick={onBack} aria-label="チャット一覧に戻る">‹ 一覧</button>}
        <Avatar person={peer ?? null} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{peer?.fullName ?? "相手"}</b>
          <div className="muted">{peer ? (peer.online ? "オンライン" : "オフライン") : ""}{peer ? ` ・ ${peer.unit}` : ""}</div>
        </div>
        {peer && <button type="button" className="text-btn" onClick={() => openTeamsChat(peer.email, `${peer.fullName}さん、`)}>Teamsで開く</button>}
      </div>
      <div className="chat-body" role="log" aria-live="polite">
        {messages === null && <div className="muted">読み込んでいます…</div>}
        {messages?.length === 0 && <div className="muted" style={{ textAlign: "center", padding: "18px 0" }}>まだメッセージはありません。最初の一言を送ってみましょう。</div>}
        {messages?.map((m) => (
          <div key={m.id} className={`bubble ${m.fromId === me.id ? "mine" : "theirs"}`}>
            <div className="bubble-text">{m.body}</div>
            <div className="bubble-time">{timeLabel(m.createdAt)}{m.fromId === me.id && m.readAt ? " ・ 既読" : ""}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <ErrorBox error={error} />
      <div className="chat-input">
        <textarea
          rows={2} maxLength={CHAT_MAX_LENGTH} value={text} placeholder="メッセージを入力（Ctrl+Enterで送信）" aria-label="メッセージ"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }}
        />
        <button type="button" className="primary" onClick={send} disabled={busy || !text.trim()}>送信</button>
      </div>
      <p className="muted" style={{ marginTop: 6 }}>お客様の個人情報は書かないでください。</p>
    </div>
  );
}
