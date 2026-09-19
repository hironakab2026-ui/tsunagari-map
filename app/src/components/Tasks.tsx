import { useState } from "react";
import { api, type TaskView } from "../lib/api";
import { useApp } from "../lib/context";
import { useAsync } from "../lib/useAsync";
import { ErrorBox, Sheet } from "./common";

/** 期限までの日数（当日は0、過ぎていれば負） */
const daysLeft = (due: string) => Math.ceil((new Date(`${due}T23:59:59`).getTime() - Date.now()) / 86400_000) - 1;

function dueLabel(t: TaskView) {
  if (!t.dueDate) return null;
  const d = daysLeft(t.dueDate);
  const date = t.dueDate.slice(5).replace("-", "/");
  if (t.done) return { text: `期限 ${date}`, tone: "" };
  if (d < 0) return { text: `期限切れ（${date}）`, tone: "late" };
  if (d === 0) return { text: "今日まで", tone: "soon" };
  if (d <= 3) return { text: `あと${d}日（${date}）`, tone: "soon" };
  return { text: `期限 ${date}`, tone: "" };
}

/** ホームの共有タスク。全体へのアナウンスとして、全員に表示される。完了は自分の分だけつけ外しできる */
export function Tasks() {
  const { me, dataVersion, bumpData, toast } = useApp();
  const q = useAsync(() => api.tasks(), [dataVersion]);
  const [adding, setAdding] = useState(false);
  const canCreate = !!me.roles?.some((r) => r === "PR" || r === "Admin");
  const list = q.data ?? [];
  if (q.loading && !q.data) return null;
  if (list.length === 0 && !canCreate) return null;

  const toggle = async (t: TaskView) => {
    const done = !t.done;
    // すぐ画面に反映し、失敗したら元に戻す
    q.setData(list.map((x) => (x.id === t.id ? { ...x, done, doneCount: x.doneCount + (done ? 1 : -1) } : x)));
    try { await api.setTaskDone(t.id, done); } catch (e) { q.setData(list); toast(e instanceof Error ? e.message : "更新できませんでした"); }
  };
  const remove = async (t: TaskView) => {
    if (!window.confirm(`「${t.title}」を削除しますか？`)) return;
    try { await api.deleteTask(t.id); bumpData(); } catch (e) { toast(e instanceof Error ? e.message : "削除できませんでした"); }
  };

  return (
    <>
      <div className="sec-head">
        <div className="sec-title">共有タスク<span className="sec-sub">全体へのアナウンス</span></div>
        {canCreate && <button type="button" className="text-btn" onClick={() => setAdding(true)}>＋ 追加</button>}
      </div>
      <div className="panel tasks">
        {list.length === 0 && <div className="muted">共有しているタスクはありません。</div>}
        {list.map((t) => {
          const due = dueLabel(t);
          const pct = t.total ? Math.round((t.doneCount / t.total) * 100) : 0;
          return (
            <div key={t.id} className={`task ${t.done ? "done" : ""}`}>
              <button type="button" className="check" role="checkbox" aria-checked={t.done} aria-label={`${t.title}を完了にする`} onClick={() => toggle(t)}>
                <svg viewBox="0 0 24 24" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </button>
              <div className="task-main">
                <div className="task-title">{t.title}</div>
                {t.body && <div className="muted task-body">{t.body}</div>}
                <div className="task-meta">
                  {due && <span className={`due ${due.tone}`}>{due.text}</span>}
                  <span className="muted">{t.doneCount}/{t.total}人が完了</span>
                </div>
                <div className="bar thin" aria-hidden><div style={{ width: `${pct}%`, background: "var(--brand)" }} /></div>
              </div>
              {canCreate && <button type="button" className="text-btn task-del" onClick={() => remove(t)} aria-label={`${t.title}を削除`}>削除</button>}
            </div>
          );
        })}
      </div>
      <Sheet open={adding} onClose={() => setAdding(false)} label="共有タスクの追加">
        <TaskForm onDone={() => { setAdding(false); bumpData(); toast("共有タスクを追加しました"); }} />
      </Sheet>
    </>
  );
}

function TaskForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await api.createTask({ title, body, dueDate: dueDate || undefined }); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <>
      <div style={{ fontWeight: 800 }}>共有タスクを追加</div>
      <p className="muted" style={{ marginTop: 2 }}>全員のホーム画面に表示されます。完了は、それぞれが自分でつけます。</p>
      <div className="field"><label htmlFor="tk-title">タイトル（60字まで）</label><input id="tk-title" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="例：安全運転講習の受講報告を提出してください" /></div>
      <div className="field"><label htmlFor="tk-body">詳細（任意・300字まで）</label><textarea id="tk-body" rows={3} maxLength={300} value={body} onChange={(e) => setBody(e.target.value)} /></div>
      <div className="field"><label htmlFor="tk-due">期限（任意）</label><input id="tk-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      <ErrorBox error={error} />
      <button type="button" className="primary" onClick={submit} disabled={busy || !title.trim()}>{busy ? "追加中…" : "追加する"}</button>
    </>
  );
}
