import * as THREE from 'three';

/**
 * 開発中の診断（2026-08-22 新設）。
 *
 * ★**この日、シェーダのコンパイル失敗で「ゲート・コイン・丸影」が全部消えた。**
 * WebGL のシェーダ失敗は**例外を投げない**。マテリアルが静かに描画されなくなるだけ。
 * その結果、レンダリング設定（深度・合成・描画順）ばかりを疑って長時間を溶かした。
 *
 * **コメントで「気をつける」と書いても再発する。** だから仕組みで止める:
 *  1. シェーダが落ちたら**画面に赤い帯を出す**（コンソールを見ていなくても気づく）
 *  2. 起動時に \`renderer.compile()\` で**先にコンパイルしておく**
 *     （最初に描かれる瞬間まで失敗が分からない、という遅れを無くす）
 *
 * 本番ビルドでは何もしない（`import.meta.env.DEV` で切る）。
 */

let banner: HTMLElement | null = null;
let count = 0;
let assetErrors = 0;

/** アセットの読み込み失敗を数える。テクスチャ側から呼ぶ */
export function noteAssetError(what: string): void {
  assetErrors++;
  if (import.meta.env.DEV) show(`アセットを読めませんでした: ${what}`);
}

function show(text: string): void {
  if (!banner) {
    banner = document.createElement('div');
    banner.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:9999',
      'background:#c8352b', 'color:#fff', 'font:12px/1.5 monospace',
      'padding:8px 12px', 'white-space:pre-wrap', 'max-height:40vh', 'overflow:auto',
    ].join(';');
    document.body.appendChild(banner);
  }
  banner.textContent = `⚠ シェーダのコンパイルに失敗しています（${++count}件）\n${text}`;
}

/**
 * シェーダの失敗を画面に出す。**開発時だけ。**
 * @param renderer 監視するレンダラ
 */
export function watchShaderErrors(renderer: THREE.WebGLRenderer): void {
  if (!import.meta.env.DEV) return;
  // 既定で true だが、明示しておく（誰かが切ったときに気づける）
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (_gl, program, vs, fs) => {
    const mat = (program as unknown as { name?: string }).name ?? '(不明)';
    // どちらが落ちたかだけ出す。全文はコンソール側に出ている
    const vsOk = _gl.getShaderParameter(vs, _gl.COMPILE_STATUS);
    const log = (!vsOk ? _gl.getShaderInfoLog(vs) : _gl.getShaderInfoLog(fs)) ?? '';
    show(`material=${mat} / ${vsOk ? 'fragment' : 'vertex'} が落ちた\n${log.trim().slice(0, 400)}`);
  };
}

/**
 * 起動時にシーン内のマテリアルを**先にコンパイルする**。
 *
 * これをやらないと、失敗が「そのマテリアルが初めて画面に入った瞬間」まで分からない。
 * 今回のゲートは**最初のゲートが視界に入るまで**気づけなかった。
 */
/**
 * 開発用の小さな計器。
 *
 * ★**「赤い帯が出ていない ＝ 正常」ではない**（外部レビューの指摘・正しい）。
 * `onShaderError` は WebGL2 でしか期待どおり動かないし、
 * そもそも**まだ描かれていないマテリアルの失敗は検出しようがない**。
 * だから「出ていない」ではなく、**実際に何が描かれているか**を数字で見る。
 *
 * ここに出す数字が 0 になったら、それは「静かに消えた」ということ。
 */
export function statsOverlay(renderer: THREE.WebGLRenderer): (info: string) => void {
  if (!import.meta.env.DEV) return () => {};
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'left:6px', 'bottom:6px', 'z-index:9998',
    'background:rgba(58,47,39,.72)', 'color:#fff', 'font:11px/1.45 monospace',
    'padding:5px 8px', 'border-radius:4px', 'pointer-events:none', 'white-space:pre',
  ].join(';');
  document.body.appendChild(el);
  const gl = renderer.getContext();
  const ver = (gl as WebGL2RenderingContext).drawBuffers ? 'WebGL2' : 'WebGL1';
  return (extra: string) => {
    const r = renderer.info.render;
    const m = renderer.info.memory;
    el.textContent =
      `${ver}  calls ${r.calls}  tris ${r.triangles}
` +
      `tex ${m.textures}  geo ${m.geometries}
` +
      `shaderErr ${count}  assetErr ${assetErrors}
${extra}`;
  };
}

/**
 * WebGL のコンテキスト喪失に備える。
 *
 * ブラウザは GPU が詰まると**予告なくコンテキストを捨てる**（タブ復帰時やドライバ更新時）。
 * 何もしないと**画面が真っ白になったまま無反応**になり、ユーザーには原因が分からない。
 * 最低限、**止めて・伝えて・戻す**の3つだけやる。
 */
export function guardContextLoss(canvas: HTMLCanvasElement, onLost: () => void, onRestored: () => void): void {
  let timer = 0;

  canvas.addEventListener('webglcontextlost', (e) => {
    // **preventDefault しないと復元イベントが来ない**
    e.preventDefault();
    onLost();

    const note = document.createElement('div');
    note.id = 'ctx-lost';
    note.style.cssText = 'position:fixed;inset:0;z-index:9997;display:flex;flex-direction:column;'
      + 'gap:16px;align-items:center;justify-content:center;background:rgba(255,253,246,.96);'
      + 'color:#3a2f27;font:16px/1.6 system-ui;text-align:center;padding:24px';
    note.innerHTML = '<div id="ctx-msg">描画が中断されました。復旧しています…</div>';
    document.body.appendChild(note);

    /*
     * ★**復元は当てにしない。**
     * `forceContextLoss()` → `restoreContext()` で実測したところ、
     * **`webglcontextrestored` が来なかった**（喪失の検出と停止は効いた）。
     * ブラウザは復元を保証しないし、来たとしても
     * こちらの GPU リソース（テクスチャ・自前シェーダ）を作り直す必要がある。
     *
     * ここで全部を作り直す仕組みを持つのは、このゲームには重すぎる。
     * **数秒待って戻らなければ、再読み込みを案内する。**
     * 「止めて・伝えて・戻す」のうち、**戻すは再読み込みに委ねる**という割り切り。
     */
    timer = window.setTimeout(() => {
      const msg = document.getElementById('ctx-msg');
      if (!msg) return;
      msg.textContent = '描画を復旧できませんでした。';
      const btn = document.createElement('button');
      btn.textContent = '再読み込み';
      btn.style.cssText = 'margin-top:14px;padding:12px 28px;font:16px system-ui;cursor:pointer;'
        + 'background:#f2b632;color:#3a2f27;border:4px solid #3a2f27;border-radius:12px';
      btn.onclick = () => location.reload();
      msg.parentElement?.appendChild(btn);
    }, 4000);
  }, false);

  canvas.addEventListener('webglcontextrestored', () => {
    clearTimeout(timer);
    document.getElementById('ctx-lost')?.remove();
    onRestored();
  }, false);
}

export function precompile(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
): void {
  if (!import.meta.env.DEV) return;
  renderer.compile(scene, camera);
}
