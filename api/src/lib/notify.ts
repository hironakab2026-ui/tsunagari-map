import { graph } from "./graph.js";

/**
 * Teams のアクティビティフィードに通知する（要件定義書 F-03）。
 * 必要: アプリ権限 TeamsActivity.Send、manifest の activities 定義、利用者へのアプリのインストール
 */
export async function notifyUsers(userIds: string[], activityType: "seatConfirmed" | "kaizenUpdated", previewText: string, templateParams: Record<string, string>) {
  if (process.env.STORE !== "sharepoint") {
    console.log(`[通知（開発モードのため送信しない）] ${activityType} → ${userIds.length}人: ${previewText}`);
    return;
  }
  const appId = process.env.TEAMS_APP_ID!;
  const webUrl = `https://teams.microsoft.com/l/entity/${appId}/tsunagari`;
  // 1人ずつ送る。大量送信時は Graph の一括エンドポイント（/teamwork/sendActivityNotificationToRecipients）を検討
  await Promise.allSettled(
    userIds.map((id) =>
      graph(`/users/${id}/teamwork/sendActivityNotification`, {
        method: "POST",
        body: JSON.stringify({
          topic: { source: "text", value: "つながりマップ", webUrl },
          activityType,
          previewText: { content: previewText },
          templateParameters: Object.entries(templateParams).map(([name, value]) => ({ name, value })),
        }),
      }),
    ),
  );
}
