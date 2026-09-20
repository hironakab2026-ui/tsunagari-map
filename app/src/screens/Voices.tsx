import { useMemo, useState } from "react";
import { DEPT_LABEL, EMPTY_POST_FILTER, IMPROVEMENT_FIELDS, fieldOf, KAIZEN_STATUS_LABEL, detectPii, filterPosts, routeKaizen, type Branch, type KaizenStatus, type Post, type PostFilter, type PostKind } from "@tsunagari/shared";
import { PostFilterBar } from "../components/PostFilterBar";
import { api } from "../lib/api";
import { useApp } from "../lib/context";
import { useAsync } from "../lib/useAsync";
import { AuthImage } from "../components/AuthImage";
import { AuthVideo } from "../components/AuthVideo";
import { fileToDataUrl } from "../lib/image";
import { Avatar, ErrorBox, FieldChip, Loading, Segmented, Sheet, Switch } from "../components/common";

const STATUSES: KaizenStatus[] = ["received", "reviewing", "inProgress", "done"];
const CATEGORIES: Record<PostKind, string[]> = {
  hitokoto: ["できごと", "ありがとう", "レース・イベント", "お客様の笑顔"],
  kaizen: IMPROVEMENT_FIELDS.map((f) => f.label),
  report: IMPROVEMENT_FIELDS.map((f) => f.label),
  official: ["お知らせ", "安全運転", "イベント", "社内制度"],
};
const TAB_LABEL: Record<PostKind, string> = { hitokoto: "ひとこと", kaizen: "要改善事項", report: "業務改善報告", official: "公式" };

const PAGE_SIZE = 10;

export function Voices({ composeOpen, setComposeOpen }: { composeOpen: boolean; setComposeOpen: (v: boolean) => void }) {
  const [kind, setKind] = useState<PostKind>("hitokoto");
  const { me, people, dataVersion } = useApp();
  const posts = useAsync(() => api.posts(kind), [kind, dataVersion]);
  const branches = useAsync(() => api.branches(), []);
  const [filter, setFilter] = useState<PostFilter>(EMPTY_POST_FILTER);
  const [panelOpen, setPanelOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const branchName = new Map((branches.data ?? []).map((b) => [b.id, b.name]));
  const isPR = !!me.roles?.some((r) => r === "PR" || r === "Admin");

  const change = (patch: Partial<PostFilter>) => { setFilter((f) => ({ ...f, ...patch })); setLimit(PAGE_SIZE); };
  const clear = () => { setFilter(EMPTY_POST_FILTER); setLimit(PAGE_SIZE); };
  const changeKind = (k: PostKind) => { setKind(k); clear(); setPanelOpen(false); };

  const all = posts.data ?? [];
  const filtered = useMemo(() => filterPosts(all, filter, {
    meId: me.id,
    authorName: (id) => { const p = id ? people.get(id) : undefined; return p ? p.fullName : "匿名"; },
    branchName: (id) => branchName.get(id) ?? id,
  }), [all, filter, me.id, people, branches.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = filtered.slice(0, limit);

  return (
    <>
      <div className="sticky-head">
        <Segmented value={kind} onChange={changeKind} options={(Object.keys(TAB_LABEL) as PostKind[]).map((k) => [k, TAB_LABEL[k]])} />
        <PostFilterBar
          kind={kind} categories={CATEGORIES[kind]} branches={branches.data ?? []} filter={filter}
          open={panelOpen} onOpenChange={setPanelOpen} onChange={change} onClear={clear} shown={filtered.length} total={all.length}
        />
      </div>
      {posts.loading && !posts.data ? <Loading /> : <ErrorBox error={posts.error} />}
      {!posts.loading && all.length === 0 && <div className="panel muted">{kind === "official" ? "まだ公式ニュースはありません。" : kind === "report" ? "まだ業務改善報告はありません。右下の「投稿する」から、改善した事例を共有しましょう。" : kind === "kaizen" ? "まだ要改善事項はありません。困っていること・直したいことは、右下の「投稿する」から。" : "まだ投稿がありません。右下の「投稿する」から最初のひとことをどうぞ。"}</div>}
      {!posts.loading && all.length > 0 && filtered.length === 0 && (
        <div className="panel empty-state">
          <b>条件に合う投稿がありません</b>
          <p className="muted">キーワードや条件を変えてみてください。</p>
          <button type="button" className="secondary" onClick={clear}>条件をクリアする</button>
        </div>
      )}
      {shown.map((p) => <PostItem key={p.id} post={p} branchName={branchName} onChanged={posts.reload} />)}
      {filtered.length > shown.length && (
        <button type="button" className="secondary more-btn" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
          さらに{Math.min(PAGE_SIZE, filtered.length - shown.length)}件を表示（残り{filtered.length - shown.length}件）
        </button>
      )}
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
  const together = (post.coAuthorIds ?? []).map((id) => people.get(id)?.fullName).filter(Boolean);
  const react = async () => { await api.react(post.id); onChanged(); };
  const setStatus = async (s: KaizenStatus) => { await api.updateKaizenStatus(post.id, s); onChanged(); };

  return (
    <article className="post">
      <div className="post-head">
        {post.kind === "official" ? (
          <div className="av av-official">公式</div>
        ) : (
          <button onClick={() => author && openCard(author.id)} aria-label={author ? `${author.fullName}さんの名刺` : "匿名"}><Avatar person={author} size={30} /></button>
        )}
        <div>
          <b>{post.kind === "official" ? "本部広報" : author ? `${author.fullName}さん` : "匿名"}</b><br />
          <span className="muted">
            {post.kind === "official" ? "公式アカウント" : author ? DEPT_LABEL[author.dept] : "部門非表示"} ・ {new Date(post.createdAt).toLocaleDateString("ja-JP")}
            {(post.kind === "kaizen" || post.kind === "report") && branchName.get(post.branchId) && ` ・ ${branchName.get(post.branchId)}`}
          </span>
        </div>
        {post.pickedForNews && <span className="picked" style={{ marginLeft: "auto" }}>社内ニュース採用</span>}
        {post.kind === "report" && <span className="st-pill done" style={{ marginLeft: "auto" }}>改善済み</span>}
      </div>
      {(post.kind === "kaizen" || post.kind === "report") && <FieldChip category={post.category} />}
      {post.kind === "official" && <span className="chip" style={{ background: "#EEF0F2", color: "var(--ink)" }}>{post.category}</span>}
      <div style={{ marginTop: 6 }}>{post.body}</div>
      {post.photoUrl && <div className="photo"><AuthImage src={post.photoUrl} alt="投稿写真" /></div>}
      {post.effect && <div className="effect"><b>効果</b>{post.effect}</div>}
      {together.length > 0 && <div className="muted" style={{ marginTop: 4 }}>一緒に取り組んだ人：{together.join("・")}</div>}
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
  const { me, people, toast, bumpData } = useApp();
  const [effect, setEffect] = useState("");
  const [coAuthors, setCoAuthors] = useState<string[]>([]);
  const isVoice = kind === "kaizen" || kind === "report"; // 声マップの対象（要改善事項・業務改善報告）
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
  const maxLen = kind === "official" ? 500 : kind === "report" ? 200 : 140;
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
        branchId: isVoice ? branchId : undefined,
        effect: kind === "report" ? effect.trim() || undefined : undefined,
        coAuthorIds: isVoice && coAuthors.length ? coAuthors : undefined,
        mediaDataUrl: kind === "official" ? mediaDataUrl : undefined,
        mediaUrl: kind === "official" && !mediaDataUrl && mediaUrl.trim() ? mediaUrl.trim() : undefined,
        mediaType: "video",
      });
      bumpData();
      toast(kind === "kaizen" ? "要改善事項を送りました。進み具合はこの画面で見られます" : kind === "report" ? "業務改善報告を共有しました。ありがとうございます" : "投稿しました");
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <>
      <div style={{ fontWeight: 700 }}>{kind === "hitokoto" ? "ひとこと投稿" : kind === "kaizen" ? "要改善事項を出す" : kind === "report" ? "業務改善報告を共有する" : "公式ニュースを投稿"}</div>
      <div className="field">
        <label>{isVoice ? "分野" : "種類"}</label>
        <div className="cats">{CATEGORIES[kind].map((c) => <button key={c} className={c === category ? "on" : ""} onClick={() => setCategory(c)}>{isVoice && <i className="dot" style={{ background: fieldOf(c).color }} />}{c}</button>)}</div>
      </div>
      {isVoice && (
        <div className="field">
          <label htmlFor="branch">支店</label>
          <select id="branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="body">{kind === "hitokoto" ? "ひとこと（140字まで）" : kind === "kaizen" ? "困っていること・こうしたいこと（140字まで）" : kind === "report" ? "何が課題で、どう改善したか（200字まで）" : "お知らせの本文（500字まで）"}</label>
        <textarea id="body" rows={4} maxLength={maxLen} value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === "hitokoto" ? "例：今日の納車、ご家族みんなで来てくださいました" : kind === "kaizen" ? "例：代車の空きが営業から見えない" : kind === "report" ? "例：納車の説明で漏れが出るため、チェックシート1枚にまとめた" : "例：今月の安全運転講習の様子を動画で公開しました"} />
        <div className="muted" style={{ textAlign: "right" }}>{body.length}/{maxLen}</div>
      </div>
      {kind === "report" && (
        <div className="field">
          <label htmlFor="effect">効果（任意・80字まで）</label>
          <input id="effect" value={effect} maxLength={80} onChange={(e) => setEffect(e.target.value)} placeholder="例：説明漏れの指摘がなくなった" />
        </div>
      )}
      {isVoice && (
        <div className="field">
          <label htmlFor="coauthor">一緒に取り組んだ人（任意・3人まで）</label>
          <select id="coauthor" value="" disabled={coAuthors.length >= 3} onChange={(e) => { if (e.target.value) setCoAuthors((c) => [...c, e.target.value]); }}>
            <option value="">人を選んで追加</option>
            {[...people.values()].filter((p) => p.id !== me.id && !coAuthors.includes(p.id)).sort((a, b) => a.fullName.localeCompare(b.fullName, "ja")).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
          {coAuthors.length > 0 && (
            <div className="filter-tags" style={{ marginTop: 8 }}>
              {coAuthors.map((id) => <button key={id} type="button" className="ftag" onClick={() => setCoAuthors((c) => c.filter((x) => x !== id))} aria-label={`${people.get(id)?.fullName}さんを外す`}>{people.get(id)?.fullName}<span aria-hidden>×</span></button>)}
            </div>
          )}
          <p className="muted" style={{ marginTop: 6 }}>別の支店の人と取り組んだ事例は、声マップで拠点どうしがつながります。</p>
        </div>
      )}
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
      <button className="primary" onClick={submit} disabled={busy || !body.trim()}>{kind === "hitokoto" ? "投稿する" : kind === "kaizen" ? "送信する" : kind === "report" ? "共有する" : "公開する"}</button>
    </>
  );
}
