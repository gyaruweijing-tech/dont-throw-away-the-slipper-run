import { Game } from './core/Game';
import { initPhysics } from './core/Physics';

const host = document.getElementById('app');
if (!host) throw new Error('#app not found');

/*
 * ★★**当たり判定の WebAssembly を先に読む**（2026-09-19）。
 *
 * Rapier は WebAssembly（約1.2MB）なので、**読み終わるまで当たり判定が作れない**。
 * ★**フォールバックは置かない。** 「読めなかったら前の判定で動かす」にすると
 * 判定が2系統になり、**どちらで遊んでいるのか誰にも分からなくなる**
 * （`collision-basics.md` の「同じ判断が2か所」）。読めなければ画面に出して止める。
 */
async function boot(): Promise<void> {
  await initPhysics();
  const game = new Game(host as HTMLElement);
  void game.start();
  // 開発時だけ外から触れるようにする。**この環境は rAF が止まって画面が動かない**ので、
  // 手で1フレーム進めて描かせ、canvas を .shots/ に落として目視確認するために要る（§13）。
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
}

void boot().catch((e: unknown) => {
  host.innerHTML = '<p style="color:#fff;font:16px/1.6 system-ui;padding:24px">'
    + '当たり判定エンジンを読み込めませんでした。通信状況を確かめて、ページを開き直してください。</p>';
  console.error(e);
});
