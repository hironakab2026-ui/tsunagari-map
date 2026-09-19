import { useState } from "react";
import { DEPT_LABEL, KAIZEN_STATUS_LABEL, detectPii, routeKaizen, type Branch, type KaizenStatus, type Post, type PostKind } from "@tsunagari/shared";
import { api } from "../lib/api";
import { useApp } from "../lib/context";
import { useAsync } from "../lib/useAsync";
import { AuthImage } from "../components/AuthImage";
import { AuthVideo } from "../components/AuthVideo";
import { fileToDataUrl } from "../lib/image";
import { Avatar, ErrorBox, Loading, Segmented, Sheet, Switch } from "../components/common";

const STATUSES: KaizenStatus[] = ["received", "reviewing", "inProgress", "done"];
const CATEGORIES: Record<PostKind, string[]> = {
  hitokoto: ["できごと", "ありがとう", "レース・イベント", "お客様の笑顔"],
  kaizen: ["業務の手間", "お客様対応", "設備", "安全", "その他"],
  official: ["お知らせ", "安全運転", "イベント", "社内制度"],
};
const TAB_LABEL: Record<PostKind, string> = { hitokoto: "ひとこと", kaizen: "改善の声", official: "公式" };

export function Voices({ composeOpen, setComposeOpen }: { composeOpen: boolean; setComposeOpen: (v: boolean) => void }) {
  const [kind, setKind] = useState<PostKind>("hitokoto");
  const { me, dataVersion } = useApp();
  const posts = useAsync(() => api.posts(kind), [kind, dataVersion]);
  const branches = useAsync(() => api.branches(), []);
  const branchName = new Map((branches.data ?? []).map((b) => [b.id, b.name]));
  const isPR = !!me.roles?.some((r) => r === "PR" || r === "Admin");

  return (
    <>
      <Segmented value={kind} onChange={setKind} options={(Object.keys(TAB_LABEL) as PostKind[]).map((k) => [k, TAB_LABEL[k]])} />
      {posts.loading ? <Loading /> : <ErrorBox error={posts.error} />}
      {posts.data?.length === 0 && <div className="panel muted">{kind === "official" ? "まだ公式ニュースはありません。" : "まだ投稿がありません。右下の「投稿する」から最初のひとことをどうぞ。"}</div>}
      {posts.data?.map((p) => <PostItem key={p.id} post={p} branchName={branchName} onChanged={posts.reload} />)}
      <Sheet open={composeOpen} onClose={() => setComposeOpen(false)} label="投稿作成">
        {kind === "official" && !isPR ? (
          <p className="muted">公式ニュースの投稿は広報担当（PRロール）のみ行えます。</p>
        ) : (
          <Composer kind={kind} branches={branches.data ?? []} onDone={() => { setComposeOpen(false); void posts.reload(); }} />
        )}
      </Sheet>
    </>
  );
}

function PostItem({ post, branchName, onChanged }: { post: Post; branchName: Map<string, string>; onChanged: () => void }) {
  const { me, people, openCard } = useApp();
  const canManage = !!me.roles?.some((r) => r === "KaizenOwner" || r === "Admin");
  const author = post.authorId ? people.get(post.authorId) ?? null : null;
  const cross = post.kind === "kaizen" && (() => {
    const ds = new Set([post.authorId, ...(post.coAuthorIds ?? [])].map((id) => (id ? people.get(id)?.dept : undefined)));
    return ds.has("sales") && ds.has("eng");
  })();
  const react = async () => { await api.react(post.id); onChanged(); };
  const setStatus = async (s: KaizenStatus) => { await api.updateKaizenStatus(post.id, s); onChanged(); };

  return (
    <article className="post">
      <div className="post-head">
        {post.kind === "official" ? (
          <div className="av" style={{ background: "var(--ai)" }}>公式</div>
        ) : (
          <button onClick={() => author && openCard(author.id)} aria-label={author ? `${author.nickname}さんの名刺` : "匿名"}><Avatar person={author} size={30} /></button>
        )}
        <div>
          <b>{post.kind === "official" ? "本部広報" : author ? `${author.nickname}さん` : "匿名"}</b><br />
          <span className="muted">
            {post.kind === "official" ? "公式アカウント" : author ? DEPT_LABEL[author.dept] : "部門非表示"} ・ {new Date(post.createdAt).toLocaleDateString("ja-JP")}
            {post.kind === "kaizen" && branchName.get(post.branchId) && ` ・ ${branchName.get(post.branchId)}`}
          </span>
        </div>
        {post.pickedForNews && <span className="picked" style={{ marginLeft: "auto" }}>社内ニュース採用</span>}
        {cross && <span className="chip" style={{ marginLeft: "auto" }}>営業×エンジニア</span>}
      </div>
      {post.kind !== "hitokoto" && <span className="chip" style={{ background: "#EEF0F2", color: "var(--ink)" }}>{post.category}</span>}
      <div style={{ marginTop: 6 }}>{post.body}</div>
      {post.photoUrl && <div className="photo"><AuthImage src={post.photoUrl} alt="投稿写真" /></div>}
      {post.mediaUrl && <PostMedia post={post} />}
      {post.kind === "kaizen" && post.status && (
        <>
          <div className="status">{STATUSES.map((s, i) => <span key={s} className={i <= STATUSES.indexOf(post.status!) ? "done" : ""}>{KAIZEN_STATUS_LABEL[s]}</span>)}</div>
          <div className="muted" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>担当：{post.assignedTo}</span>
            {canManage && <select className="status-select" value={post.status} onChange={(e) => setStatus(e.target.value as KaizenStatus)} aria-label="ステータス変更（担当者用）">
              {STATUSES.map((s) => <option key={s} value={s}>{KAIZEN_STATUS_LABEL[s]}</option>)}
            </select>}
          </div>
        </>
      )}
      {post.kind !== "official" && <div className="post-foot"><button onClick={react}>{post.kind === "kaizen" ? "応援" : "👏"} {post.reactions}</button></div>}
    </article>
  );
}

const VIDEO_LINK = /\.(mp4|webm|mov)(\?.*)?$/i;

/** 公式ニュースの動画・画像。動画ファイルとして再生できるものはその場で再生し、それ以外の外部リンクは開くリンクにする */
function PostMedia({ post }: { post: Post }) {
  const url = post.mediaUrl!;
  const playable = post.mediaType === "video" && (url.startsWith("/api/") || url.startsWith("data:") || VIDEO_LINK.test(url));
  if (playable) return <div className="post-media"><AuthVideo src={url} /></div>;
  if (post.mediaType === "image" && (url.startsWith("/api/") || url.startsWith("data:"))) {
    return <div className="photo"><AuthImage src={url} alt="添付画像" /></div>;
  }
  return (
    <a className="chip" style={{ marginTop: 8, display: "inline-block" }} href={url} target="_blank" rel="noreferrer">
      {post.mediaType === "video" ? "動画を見る" : "画像を見る"} →
    </a>
  );
}

const MEDIA_MAX_MB = 30;

function Composer({ kind, branches, onDone }: { kind: PostKind; branches: Branch[]; onDone: () => void }) {
  const { me, toast, bumpData } = useApp();
  const [category, setCategory] = useState(CATEGORIES[kind][0]);
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [photo, setPhoto] = useState<string>();
  const [branchId, setBranchId] = useState(me.branchId);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaDataUrl, setMediaDataUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const maxLen = kind === "official" ? 500 : 140;
  const pii = detectPii(body);
  const route = kind === "kaizen" && body ? routeKaizen(body, category) : null;

  const onPhoto = (file?: File) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setPhoto(String(r.result));
    r.readAsDataURL(file);
  };
  const onMediaFile = async (file?: File) => {
    if (!file) return;
    setError(null);
    if (!/^video\/(mp4|webm)$/.test(file.type)) return setError(new Error("動画は MP4 または WebM のファイルを選んでください"));
    if (file.size > MEDIA_MAX_MB * 1024 * 1024) return setError(new Error(`ファイルは${MEDIA_MAX_MB}MB以下にしてください（選んだファイル：${(file.size / 1024 / 1024).toFixed(1)}MB）`));
    try { setMediaDataUrl(await fileToDataUrl(file)); setMediaFile(file); } catch (e) { setError(e); }
  };
  const submit = async () => {
    if (pii.length && !window.confirm(`${pii.join("・")}が含まれている可能性があります。このまま送信しますか？`)) return;
    setBusy(true); setError(null);
    try {
      await api.createPost({
        kind, category, body, anonymous, photoDataUrl: photo,
        branchId: kind === "kaizen" ? branchId : undefined,
        mediaDataUrl: kind === "official" ? mediaDataUrl : undefined,
        mediaUrl: kind === "official" && !mediaDataUrl && mediaUrl.trim() ? mediaUrl.trim() : undefined,
        mediaType: "video",
      });
      bumpData();
      toast(kind === "kaizen" ? "改善の声を送りました。進み具合はこの画面で見られます" : "投稿しました");
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <>
      <div style={{ fontWeight: 700 }}>{kind === "hitokoto" ? "ひとこと投稿" : kind === "kaizen" ? "改善の声を出す" : "公式ニュースを投稿"}</div>
      <div className="field">
        <label>種類</label>
        <div className="cats">{CATEGORIES[kind].map((c) => <button key={c} className={c === category ? "on" : ""} onClick={() => setCategory(c)}>{c}</button>)}</div>
      </div>
      {kind === "kaizen" && (
        <div className="field">
          <label htmlFor="branch">支店</label>
          <select id="branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="body">{kind === "hitokoto" ? "ひとこと（140字まで）" : kind === "kaizen" ? "困っていること・こうしたいこと" : "お知らせの本文（500字まで）"}</label>
        <textarea id="body" rows={4} maxLength={maxLen} value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === "hitokoto" ? "例：今日の納車、ご家族みんなで来てくださいました" : kind === "kaizen" ? "例：代車の空きが営業から見えない" : "例：今月の安全運転講習の様子を動画で公開しました"} />
        <div className="muted" style={{ textAlign: "right" }}>{body.length}/{maxLen}</div>
      </div>
      {kind === "hitokoto" && (
        <label className="secondary" style={{ display: "block", textAlign: "center" }}>
          {photo ? "写真を変更" : "写真を1枚追加"}
          <input type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
        </label>
      )}
      {kind === "kaizen" && (
        <>
          <div className="opt"><div>匿名で出す<small>担当部署にも名前は表示されません</small></div><Switch on={anonymous} onChange={setAnonymous} label="匿名で出す" /></div>
          <div className="route">
            {route ? <><b>振り分け先の候補：{route.department}</b><br /><span className="muted">{route.isFallback ? "該当するキーワードがないため総務が受け付け、担当を決めます。" : "キーワードと種類から自動で判定。担当者があとで変更できます。"}</span></> : "入力すると、振り分け先の候補が表示されます。"}
          </div>
        </>
      )}
      {kind === "official" && (
        <>
          <div className="field">
            <label>動画をアップロード（MP4・WebM、{MEDIA_MAX_MB}MBまで）</label>
            {mediaFile ? (
              <div className="media-picked">
                <span>{mediaFile.name}（{(mediaFile.size / 1024 / 1024).toFixed(1)}MB）</span>
                <button type="button" className="text-btn" onClick={() => { setMediaFile(null); setMediaDataUrl(undefined); }}>外す</button>
              </div>
            ) : (
              <label className="secondary" style={{ display: "block", textAlign: "center" }}>
                動画ファイルを選ぶ
                <input id="media-file" type="file" accept="video/mp4,video/webm" hidden onChange={(e) => { void onMediaFile(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            )}
          </div>
          {!mediaFile && (
            <div className="field">
              <label htmlFor="media">または、動画・画像のリンク（https:// から始まるURL）</label>
              <input id="media" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="例：https://.../safety-training.mp4" />
            </div>
          )}
        </>
      )}
      {pii.length > 0 && <div className="warn">{pii.join("・")}が含まれている可能性があります。お客様の個人情報は書かないでください。</div>}
      <p className="muted" style={{ marginTop: 10 }}>お客様の氏名・車両番号など個人情報は書かないでください。</p>
      <ErrorBox error={error} />
      <button className="primary" onClick={submit} disabled={busy || !body.trim()}>{kind === "hitokoto" ? "投稿する" : kind === "kaizen" ? "送信する" : "公開する"}</button>
    </>
  );
}
