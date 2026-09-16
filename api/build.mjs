// Azure Functions へのデプロイは api/ フォルダだけを zip する（func azure functionapp publish）。
// このリポジトリは npm workspaces で、依存パッケージはリポジトリ直下の node_modules に集約されている
// （api/node_modules は存在しない）ため、tsc でトランスパイルしただけの dist を deploy すると
// 実行時に依存解決に失敗する（"Cannot find package '@azure/functions'" 等）。
// esbuild で依存関係ごと1ファイルにバンドルすることで、api/ フォルダ単体で自己完結させる。
import { build } from "esbuild";

await build({
  entryPoints: ["src/functions/index.ts"],
  outfile: "dist/functions/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  // node: プレフィックスの組み込みモジュール（node:sqlite 等）は自動的に外部扱いになる。
  // @azure/functions-core は Azure Functions のホスト（ワーカープロセス）が実行時に注入するモジュールで、
  // ローカルの node_modules には存在しない・バンドルもできないため、明示的に外部参照のままにする
  external: ["@azure/functions-core"],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
console.log("dist/functions/index.js を作成しました");
