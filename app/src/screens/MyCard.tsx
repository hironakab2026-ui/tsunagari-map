import { useState } from "react";
import type { Person } from "@tsunagari/shared";
import { api } from "../lib/api";
import { useApp } from "../lib/context";
import { cropToSquareDataUrl } from "../lib/image";
import { Avatar, ErrorBox, Switch } from "../components/common";
import { PersonCard } from "../components/PersonCard";

export function MyCard() {
  const { me, refreshMe, toast } = useApp();
  const [editing, setEditing] = useState(!me.profileCompleted);
  const save = async (patch: Partial<Person>) => {
    const next = await api.updateMe(patch);
    refreshMe(next);
    toast("名刺を保存しました");
  };
  return (
    <>
      {editing ? <EditCard me={me} onSave={async (p) => { await save(p); setEditing(false); }} onCancel={() => setEditing(false)} /> : (
        <>
          <PersonCard person={me} mine />
          <button className="secondary" onClick={() => setEditing(true)}>名刺を編集する</button>
        </>
      )}
      <div className="sec-title">公開範囲</div>
      <div className="panel" style={{ padding: "4px 14px" }}>
        <div className="opt"><div>座席マップに表示<small>着席中・勤務時間内のみ。退勤で自動消去</small></div><Switch on={me.showOnSeatMap} label="座席マップに表示" onChange={(v) => save({ showOnSeatMap: v })} /></div>
        <div className="opt"><div>趣味・プライベート項目<small>オフにすると仕事の項目だけ表示</small></div><Switch on={me.showPrivate} label="趣味を表示" onChange={(v) => save({ showPrivate: v })} /></div>
        <div className="opt"><div>気軽に話しかけてOK<small>オフにすると「集中モード中」と表示</small></div><Switch on={me.talkOk} label="話しかけてOK" onChange={(v) => save({ talkOk: v })} /></div>
      </div>
    </>
  );
}

function EditCard({ me, onSave, onCancel }: { me: Person; onSave: (p: Partial<Person>) => Promise<void>; onCancel: () => void }) {
  const [fullName, setFullName] = useState(me.fullName);
  const [nickname, setNickname] = useState(me.nickname);
  const [skills, setSkills] = useState(me.skills.join("、"));
  const [hobby, setHobby] = useState(me.hobby ?? "");
  const [askMe, setAskMe] = useState(me.askMe ?? "");
  const [avatarUrl, setAvatarUrl] = useState(me.avatarUrl ?? "");
  const [error, setError] = useState<unknown>(null);
  const pickAvatar = async (file?: File) => {
    if (!file) return;
    setError(null);
    try { setAvatarUrl(await cropToSquareDataUrl(file)); } catch (e) { setError(e); }
  };
  const submit = async () => {
    if (!fullName.trim()) return setError(new Error("氏名を入力してください"));
    try {
      await onSave({ fullName: fullName.trim(), nickname: nickname.trim(), skills: skills.split(/[、,]/).map((s) => s.trim()).filter(Boolean).slice(0, 5), hobby: hobby.trim(), askMe: askMe.trim(), avatarUrl });
    } catch (e) { setError(e); }
  };
  return (
    <div className="panel">
      <div className="muted">{me.unit}（所属は社員情報から自動入力）</div>
      <div className="field">
        <label>アイコン</label>
        <div className="avatar-edit">
          <Avatar person={{ fullName: fullName || me.fullName, dept: me.dept, avatarUrl }} size={64} />
          <div>
            <label className="secondary avatar-pick">
              {avatarUrl ? "写真を変更" : "顔写真を選ぶ"}
              <input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { void pickAvatar(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {avatarUrl && <button type="button" className="text-btn" onClick={() => setAvatarUrl("")}>写真を外す（頭文字のアイコンに戻す）</button>}
          </div>
        </div>
      </div>
      <div className="field"><label htmlFor="fn">氏名（座席表・投稿などに表示されます）</label><input id="fn" value={fullName} maxLength={30} onChange={(e) => setFullName(e.target.value)} placeholder="例：山本 健太" /></div>
      <div className="field"><label htmlFor="nn">呼ばれたい名前（自己紹介・任意）</label><input id="nn" value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} placeholder="例：けんた" /></div>
      <div className="field"><label htmlFor="sk">得意なこと（「、」区切りで5つまで）</label><input id="sk" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="例：ハイブリッド診断、点検説明" /></div>
      <div className="field"><label htmlFor="hb">最近ハマっていること（任意）</label><input id="hb" value={hobby} maxLength={40} onChange={(e) => setHobby(e.target.value)} /></div>
      <div className="field"><label htmlFor="ak">こんなこと聞いてください</label><textarea id="ak" rows={3} value={askMe} maxLength={60} onChange={(e) => setAskMe(e.target.value)} /></div>
      <ErrorBox error={error} />
      <button className="primary" onClick={submit}>保存する</button>
      <button className="text-btn" onClick={onCancel}>キャンセル</button>
    </div>
  );
}
