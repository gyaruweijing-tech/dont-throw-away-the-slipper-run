import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 開発専用。ブラウザから canvas の PNG を受け取って .shots/ に保存する。
 * プレビューペインが表示できない環境でも描画結果を目視確認するための足場。
 * apply:'serve' なので本番ビルドには一切含まれない。
 */
function shotSink(): Plugin {
  return {
    name: 'shot-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { name, dataUrl } = JSON.parse(body) as { name: string; dataUrl: string };
            const dir = path.resolve('.shots');
            fs.mkdirSync(dir, { recursive: true });
            const safe = name.replace(/[^a-z0-9_-]/gi, '_');
            fs.writeFileSync(path.join(dir, `${safe}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
            res.end('ok');
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  // CrazyGames は相対パス必須（PROGRESS §6）。Poki / itch.io でも相対のほうが安全。
  base: './',
  server: { port: 5180 },
  build: { target: 'es2020', assetsInlineLimit: 8192 },
  plugins: [shotSink()],
});
