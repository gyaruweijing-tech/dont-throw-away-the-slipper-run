/*
 * sim ツールを型検査するための最小の宣言（2026-08-27 新設）。
 *
 * `tools/` は node で走るが、`@types/node` を入れると本体の依存が増える。
 * ここで使っている API は `process.argv`・`process.env`・`process.exit` だけなので、
 * **使っているぶんだけ手で宣言する。**
 */
declare const process: {
  readonly argv: readonly string[];
  readonly env: Record<string, string | undefined>;
  exit(code?: number): never;
};
