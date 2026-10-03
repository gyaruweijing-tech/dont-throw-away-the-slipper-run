import * as THREE from 'three';
import { noteAssetError } from '../core/diagnostics';

/**
 * キャラのアトラスを**外部 PNG として読む**。
 *
 * ★**ここが「絵」と「ロジック」の境目。**
 * ゲームのコードは絵を1ピクセルも描かない。読むだけ。
 * だから本番の絵に差し替えるときは **`public/assets/atlas.png` を上書きするだけ**で終わる
 * （外部レビューの「アセットとロジックを疎結合に保て」を採用した形）。
 *
 * 仮の絵は `tools/gen-atlas.js`（**ランタイムではなく道具**）で作って書き出してある。
 *
 * マス割りは `src/entities/cutoutLayout.ts` の `SLOT` が唯一の定義。
 * 絵を差し替える人はそちらの表に従うこと。
 */

let cached: THREE.Texture | null = null;

export function charAtlas(): THREE.Texture {
  if (cached) return cached;
  // load() は Texture を即座に返し、読み込み完了後に自動で差し替わる。
  // だから**初期化を非同期にしなくてよい**（1フレーム目だけ空になるが実害はない）
  /*
   * **読み込みに失敗したときの保険。**
   * 外部ファイルに切り替えたことで「404 でキャラが全部消える」という新しい壊れ方が生まれた。
   * 失敗したら**目立つ色の1枚絵**に差し替えて、少なくとも「絵が無い」と分かる状態にする
   * （真っ白や透明で消えると、また原因の切り分けに時間を溶かす）。
   */
  const onFail = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = '#c8352b';
    g.fillRect(0, 0, 64, 64);
    t.image = c;
    t.needsUpdate = true;
    console.error('[atlas] assets/atlas.png を読めませんでした。仮の色で代替しています');
    noteAssetError('assets/atlas.png');
  };
  const t = new THREE.TextureLoader().load('assets/atlas.png', undefined, undefined, onFail);
  t.colorSpace = THREE.SRGBColorSpace;
  // アトラスなので**必ず ClampToEdge**。Repeat だと隣のマスの色が滲む
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  /*
   * **読めた後も検証する。** 404 以外にも壊れ方はある:
   * 大文字小文字違い・MIME・破損・想定外のサイズ。
   * ここで「読めたつもりで実は違う絵」を早く見つける
   */
  t.addEventListener?.('dispose', () => {});
  const check = () => {
    const img = t.image as { width?: number; height?: number } | undefined;
    if (!img?.width) return;
    if (img.width !== img.height || img.width % 4 !== 0) {
      console.error(`[atlas] 想定外のサイズです: ${img.width}x${img.height}（正方形・4の倍数が前提）`);
      noteAssetError(`atlas size ${img.width}x${img.height}`);
    }
  };
  setTimeout(check, 1500);
  cached = t;
  return t;
}
