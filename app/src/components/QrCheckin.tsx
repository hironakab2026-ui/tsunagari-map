import { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/context";
import { getHost, scanSeatQr } from "../lib/teams";
import { ErrorBox } from "./common";

/** QR着席（F-04）。Teams モバイルではネイティブスキャナ、それ以外は席番号の手入力 */
export function QrCheckin({ onDone }: { onDone: () => void }) {
  const { toast, bumpData } = useApp();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const canScan = getHost().inTeams && getHost().isMobile;

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const { seat } = await api.checkIn(value.trim());
      bumpData();
      toast(`${seat.label} にチェックインしました。退勤時に自動で解除されます`);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    try {
      const v = await scanSeatQr();
      if (v) await submit(v);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>机のQRコードで着席</div>
      {canScan ? (
        <>
          <div className="scan"><div className="frame" /><div className="laser" /></div>
          <button className="primary" onClick={scan} disabled={busy}>カメラで読み取る</button>
        </>
      ) : (
        <p className="muted">この端末ではカメラを使えません。机のQRコードの下にある席番号を入力してください。</p>
      )}
      <div className="field">
        <label htmlFor="seatcode">席番号で着席</label>
        <input id="seatcode" value={code} onChange={(e) => setCode(e.target.value)} placeholder="例：B-2" autoComplete="off" />
      </div>
      <ErrorBox error={error} />
      <button className="secondary" onClick={() => submit(code)} disabled={busy || !code.trim()}>この席に着席する</button>
      <button className="text-btn" style={{ marginTop: 8 }} onClick={async () => { await api.checkOut(); bumpData(); toast("着席を解除しました"); onDone(); }}>着席を解除する</button>
    </div>
  );
}
