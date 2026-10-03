/**
 * Node で描画コードを読み込むための最小スタブ。
 * このリポジトリはプレビューペインが表示できない環境で開発しているので、
 * **実機と同じコードをヘッドレスで回して数字だけ検証する**（PROGRESS §13 Phase 2）。
 * 描いた中身は使わないので、呼ばれても落ちなければよい。
 *
 * ★**「落ちなければよい」の例外が2つある**（2026-08-23 の検品で追加）。
 * 紙の切り抜きに移した夜の変更で、**5本の sim のうち4本が起動できなくなっていた**。
 * 原因はどちらもこのファイルの穴で、ゲーム側の不具合ではない:
 *
 *  1. `paperGrain()` が `createImageData()` の**戻り値を読む**（`img.data`）。
 *     何でも noop を返す Proxy だと `undefined.data` で落ちる。
 *     → 2D コンテキストのうち**戻り値を使うものだけ**は本物らしい形を返す。
 *  2. `charAtlas()` が `THREE.TextureLoader` を使う。
 *     three の `ImageLoader` は `document.createElementNS` で img を作る。
 *     → 画像は読めなくてよい（sim は描画しない）ので、**イベントが飛ばない img** を返す。
 *
 * **中身は返さない。** ここで本物の画像を用意すると「絵が出ているか」を
 * ヘッドレスで検証できる気になってしまうが、それは別の道具（`tools/look.js`）の仕事。
 */
const noop = (): void => {};

/** 2D コンテキスト。**戻り値を使うものだけ**実体を返し、残りは noop */
function makeCtx2d(): unknown {
  const imageData = (w: number, h: number) => ({
    width: w, height: h,
    data: new Uint8ClampedArray(Math.max(0, w) * Math.max(0, h) * 4),
    colorSpace: 'srgb',
  });
  const real: Record<string, unknown> = {
    createImageData: (w: number, h: number) => imageData(w, h),
    getImageData: (_x: number, _y: number, w: number, h: number) => imageData(w, h),
    measureText: (t: string) => ({ width: String(t).length * 8 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    getLineDash: () => [],
  };
  return new Proxy(real, {
    get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : noop),
    set: () => true,
  });
}

/** 読み込みが一生完了しない `<img>`。sim は描かないので中身は要らない */
function makeImage(): unknown {
  return {
    width: 0, height: 0, complete: false, src: '',
    addEventListener: noop, removeEventListener: noop,
    setAttribute: noop, removeAttribute: noop, style: {},
  };
}

function makeCanvas(): unknown {
  return { width: 0, height: 0, getContext: () => makeCtx2d(), style: {}, toDataURL: () => '' };
}

(globalThis as any).document = {
  createElement: (tag?: string) => (tag === 'img' ? makeImage() : makeCanvas()),
  // three の ImageLoader が使う。HTML 名前空間で img を作りに来る
  createElementNS: (_ns: string, tag?: string) => (tag === 'img' ? makeImage() : makeCanvas()),
};
(globalThis as any).window = globalThis;
