/**
 * ヘッドレス実行の足場。`node tools/run.mjs tools/xxx.ts`
 *
 * プレビューペインが表示できない環境なので、**実機と同じソースを Node で回して
 * 数字だけ検証する**（PROGRESS §13 Phase 2）。Vite の `?raw` インポートだけ自前で解決する。
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = process.argv[2];
if (!entry) throw new Error('usage: node tools/run.mjs <entry.ts>');

const raw = {
  name: 'vite-raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (a) => ({
      path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')),
      namespace: 'raw',
    }));
    build.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({
      contents: await fs.readFile(a.path, 'utf8'),
      loader: 'text',
    }));
  },
};

/*
 * ★**出力の名前は入口ごとに分ける**（2026-09-27・検品）。`run.mjs` 固定だと
 * `sim:*` を2本以上**同時に**走らせたとき、後から始まった側の esbuild が
 * 相手の束を上書きして `SyntaxError: Unexpected end of input` で落ちる
 * （9/27 の検品で `sim:skill` が実際にこれで落ちた。最悪、別の sim の束を
 * 読んで**もっともらしい数字を印字する**）。
 */
const out = path.resolve('.shots', `run-${path.basename(entry).replace(/\.[^.]+$/, '')}.mjs`);
await fs.mkdir(path.dirname(out), { recursive: true });
await esbuild.build({
  entryPoints: [entry], bundle: true, platform: 'node', format: 'esm',
  outfile: out, plugins: [raw], logLevel: 'error',
});
await import(pathToFileURL(out).href);
