// node:sqlite は Node.js 22.5+ の組み込みモジュール（本プロジェクトの @types/node は Node 20 系のため型定義を持たない）。
// ここでは SqliteStore が使う最小限の形だけを宣言する。
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
  export class StatementSync {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  }
}

declare namespace NodeJS {
  interface Process {
    // Node.js 20.16+ / 22+。バンドラー（Vite/Vitest）が新しい組み込みモジュールを
    // 外部化対象と認識できず解決に失敗することがあるため、静的 import ではなくこちらを使う
    getBuiltinModule(id: "node:sqlite"): typeof import("node:sqlite");
  }
}
