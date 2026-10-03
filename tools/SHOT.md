# 実機の絵を見る方法（この環境向け）

**この環境はプレビューの合成が止まっていて、画面が動きません。** だが**描画自体は動く**ので、
手で1フレーム進めて描かせれば絵は取れる。**「見えないから確認できない」は成立しない。**

`src/main.ts` が dev 限定で `window.__game` を公開している。ブラウザのコンソールから叩く。

## ① 3Dの画面を撮る

```js
const g = window.__game; g.onResize();
for (let i = 0; i < 400; i++) { g.input.targetX = 0; g.update(1/60); }
g.renderer.render(g.scene, g.rig.camera);
const url = g.renderer.domElement.toDataURL('image/png');
await fetch('/__shot', { method:'POST', body: JSON.stringify({ name:'shot', dataUrl:url }) });
```

`.shots/shot.png` に落ちる。カメラを動かしたいときは `g.rig.camera` を直接 set して
`updateMatrixWorld()` してから render する。

## ② HUD・リザルト（DOM）を撮る ★

**canvas の toDataURL では DOM は写らない。** SVG の `foreignObject` に DOM を流し込んで
画像化する。`<style>` は外部参照が効かないので**全部インラインで持ち込む**のが肝。

```js
const W = 1280, H = 720;
const styles = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
const huds = [...document.querySelectorAll('.hud')].map(e => e.outerHTML).join('');
const html = `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${W}px;height:${H}px;background:#efe9dc;overflow:hidden">`
  + `<style>${styles.replace(/&/g,'&amp;')}</style>${huds}</div>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  + `<foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
const img = new Image();
img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
await img.decode();
const c = document.createElement('canvas'); c.width = W; c.height = H;
const cx = c.getContext('2d'); cx.fillStyle = '#efe9dc'; cx.fillRect(0,0,W,H); cx.drawImage(img,0,0);
await fetch('/__shot', { method:'POST', body: JSON.stringify({ name:'ui', dataUrl:c.toDataURL('image/png') }) });
```

### 注意
- **アニメーション中の状態は写らない**（判子の押印など）。最終状態を見たいときはクラスを手で付ける
- 外部画像は写らない（同一オリジンでも data: にしないと駄目なことがある）
- `.rs-root` のように `position:absolute; inset:0` の要素は、**サイズを持つ親でくるむ**必要がある
