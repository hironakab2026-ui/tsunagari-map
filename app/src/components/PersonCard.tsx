import { DEPT_LABEL, type Person } from "@tsunagari/shared";
import { openTeamsChat } from "../lib/teams";
import { Avatar, DEPT_COLOR, DeptDot } from "./common";

export function PersonCard({ person, mine }: { person: Person; mine: boolean }) {
  const color = DEPT_COLOR[person.dept];
  return (
    <div className="bizcard">
      <div className="band" style={{ background: color }} />
      <div className="body">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Avatar person={person} size={56} />
          <div>
            <div className="muted">{person.fullName} ・ {person.unit}</div>
            <h2>{person.nickname || person.fullName}さん</h2>
            <div className="muted"><DeptDot dept={person.dept} />{DEPT_LABEL[person.dept]}</div>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          {person.talkOk ? <span className="talk">● 気軽に話しかけてOK</span> : <span className="chip" style={{ background: "#EEF0F2", color: "#697180" }}>集中モード中</span>}
        </div>
        <dl className="kv">
          <dt>得意なこと</dt>
          <dd>{person.skills.length ? person.skills.map((s) => <span key={s} className="chip" style={{ margin: "0 4px 4px 0" }}>{s}</span>) : <span className="muted">未入力</span>}</dd>
          {(mine || person.showPrivate) && person.hobby && (<><dt>最近ハマっていること</dt><dd>{person.hobby}</dd></>)}
        </dl>
        {person.askMe && (
          <div className="ask"><b style={{ fontSize: 11, color: "var(--ai)" }}>こんなこと聞いてください</b><br />{person.askMe}</div>
        )}
        {!mine && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="primary" style={{ margin: 0 }} onClick={() => openTeamsChat(person.email, `${person.nickname}さん、名刺を見て連絡しました`)}>Teamsで話しかける</button>
          </div>
        )}
      </div>
    </div>
  );
}
