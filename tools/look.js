/*
 * 見た目を**測る**道具（ランタイムではない）。`DESIGN.md` 2節の方法をここに固定する。
 *
 * 使い方: ブラウザのコンソールにこのファイルの中身を貼って実行する。
 *   `.shots/S1_lv1_d40.png` などが落ち、数値が返る。
 *
 * ★**なぜ道具にするのか。**
 * 手で測ると、測るたびに領域も統計量も変わって比較にならない。
 * 実際、最初の測定は**宣伝用のキー画像とゲーム画面を比べていて**、
 * そこから立てた「背景を明るく」という規則は**実行していたら悪化していた**。
 * 条件を固定しない測定は、印象より危険（数字の見た目をしているから）。
 *
 * ---------------------------------------------------------------
 * 固定条件（これを変えたら過去の数値と比較できない。変えるときは記録する）
 * ---------------------------------------------------------------
 *   画面        1280 x 720
 *   カメラ      既定（CameraRig のまま。手で動かさない）
 *   操作        targetX = 0（左右に動かさない）
 *   場面        S1: Lv1 距離40 / S2: Lv1 距離110 / S3: Lv3 距離40
 *
 *   ★**Lv1 を基準にする理由。** Lv1 には障害物が無い。
 *   障害物のあるレベルで自動走行すると**ぶつかって全滅し、毎回違う絵になる**
 *   （実際 Lv3 で距離96で死んでゴール画面を測っていた）。
 *   S3 は Lv3 の障害物が出る距離50より手前なので、これも必ず同じ絵になる。
 *
 * ---------------------------------------------------------------
 * 測り方
 * ---------------------------------------------------------------
 *   色空間    sRGB を 0..1 に正規化した**最終ピクセル**
 *             （ライティング・影・アンチエイリアスを通った後。プレイヤーが見る物）
 *   明度      **sRGB のまま**の 0.2126R+0.7152G+0.0722B。
 *               ★ これは厳密には相対輝度ではない（外部レビュー1番・正しい）。
 *               相対輝度は**線形化してから**重みを掛ける必要がある。
 *               ただし "画面上でどのくらい明るく見えるか" の順序付けには使えるので、
 *               過去の記録との比較のために残す。
 *     輝度      **線形化した**相対輝度（sRGB → 線形 → 0.2126R+0.7152G+0.0722B）。
 *               こちらが本物。**新しい判断はこちらを使う。**
 *               ※ どちらも HSV の V や HSL の L ではない。青と黄で食い違うあれとは別物
 *   彩度      HSV の S = (max-min)/max
 *   統計量    平均と中央値の両方（外れ値の影響を見るため）
 *   色相の種類 S>0.30 かつ V>0.20 の画素を色相30度ごと12個の箱に入れ、
 *             領域の面積の1%以上を占める箱の数
 *             ※小さくて細かい物（群衆など）はアンチエイリアスで数が増えがち。
 *               この指標は**広い面**でのみ意味がある
 */
(async () => {
  const g = window.__game;
  if (!g) { console.error('window.__game が無い（開発ビルドで開くこと）'); return; }

  /**
   * 測る領域。画面比で指定する。**基準の絵 S2 を見て決めた。**
   *
   * ★**配置を変えたら領域も見直すこと。**（2026-08-23 に一度やらかした）
   * 下駄箱を廊下の壁から点在に変えたあと、
   * 「背景の物体」の領域が**実際には地面を測っていた**。
   * それに気づかず「彩度が上がらない」と何度も実験してしまった。
   * 領域を変えたときは、それ以前の数値とは比較できない。ここに日付を書く。
   *
   * 2026-08-23 更新: 背景の物体を、左手前に立つ台に当たる位置へ移した。
   */
  const AREAS = {
    '空':               [0.42, 0.02, 0.58, 0.10],
    '床（群衆の手前）': [0.30, 0.85, 0.45, 0.99],
    '群衆':             [0.42, 0.45, 0.58, 0.72],
    '背景の物体（左）': [0.00, 0.16, 0.11, 0.52],
  };

  const SCENES = [
    { name: 'S1_lv1_d40',  lv: 0, dist: 40 },
    { name: 'S2_lv1_d110', lv: 0, dist: 110 },
    { name: 'S3_lv3_d40',  lv: 2, dist: 40 },
  ];

  /** sRGB の 0..1 を線形に戻す。**相対輝度はこれをやってから重みを掛ける** */
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

  const med = (a) => { const b = a.slice().sort((p, q) => p - q); return b[b.length >> 1]; };
  const avg = (a) => a.reduce((p, q) => p + q, 0) / a.length;

  function stat(ctx, W, H, [x0, y0, x1, y1]) {
    const d = ctx.getImageData(
      Math.round(x0 * W), Math.round(y0 * H),
      Math.round((x1 - x0) * W), Math.round((y1 - y0) * H)).data;
    const ls = [], ys = [], ss = [];
    const hues = new Array(12).fill(0);
    let n = 0;
    for (let p = 0; p < d.length; p += 4) {
      const r = d[p] / 255, gg = d[p + 1] / 255, b = d[p + 2] / 255;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      ls.push(0.2126 * r + 0.7152 * gg + 0.0722 * b);
      ys.push(0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b));
      const s = mx === 0 ? 0 : (mx - mn) / mx;
      ss.push(s); n++;
      if (s > 0.30 && mx > 0.20) {
        let h;
        if (mx === mn) h = 0;
        else if (mx === r) h = 60 * (((gg - b) / (mx - mn)) % 6);
        else if (mx === gg) h = 60 * (((b - r) / (mx - mn)) + 2);
        else h = 60 * (((r - gg) / (mx - mn)) + 4);
        hues[Math.floor(((h + 360) % 360) / 30)]++;
      }
    }
    return {
      明度平均: Math.round(avg(ls) * 100), 明度中央: Math.round(med(ls) * 100),
      輝度中央: Math.round(med(ys) * 100),
      彩度平均: Math.round(avg(ss) * 100), 彩度中央: Math.round(med(ss) * 100),
      色相の種類: hues.filter((v) => v > n * 0.01).length,
    };
  }

  /**
   * 色覚多様性の確認（外部レビュー8番を採用）。
   * **色を捨てて明度だけにしたとき、領域どうしが区別できるか**を見る。
   * 色だけに意味を運ばせていると、ここで差が消える。
   */
  function greyGap(res) {
    const k = Object.keys(res);
    const out = {};
    for (let i = 0; i < k.length; i++) {
      for (let j = i + 1; j < k.length; j++) {
        out[`${k[i]} ↔ ${k[j]}`] = Math.abs(res[k[i]].明度中央 - res[k[j]].明度中央);
      }
    }
    return out;
  }

  /*
   * ★**乱数を固定する。**（外部レビュー8番 —— 指摘のとおりだった）
   *
   * 当初「障害物の無い Lv1 なら必ず同じ絵になる」と書いたが、**言い過ぎだった。**
   * 再現性の検査を入れたら、群衆の明度が2回で**21も違った**。
   * 原因はゲートの数値が `Math.random()` で決まること。
   * 走るたびに人数が変わり、群衆の領域の埋まり方が変わる。
   *
   * ゲーム側の乱数を全部差し替えるのは影響が大きいので、
   * **測定の間だけ `Math.random` を種つきの列に置き換える**。
   * 測り終わったら必ず元に戻す。
   */
  const realRandom = Math.random;
  const seedRandom = (seed) => {
    let t = seed >>> 0;
    Math.random = () => {
      t = (t + 0x6D2B79F5) >>> 0;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  };

  const report = {};
  for (const sc of SCENES) {
    seedRandom(12345);
    g.enter(sc.lv);
    let guard = 0;
    while (g.distance < sc.dist && g.state === 'RUN' && guard++ < 20000) {
      g.input.targetX = 0;
      g.update(1 / 60);
    }
    g.renderer.render(g.scene, g.rig.camera);
    const url = g.renderer.domElement.toDataURL('image/png');
    await fetch('/__shot', { method: 'POST', body: JSON.stringify({ name: sc.name, dataUrl: url }) });

    const im = new Image(); im.src = url; await im.decode();
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0);

    const res = {};
    for (const a in AREAS) res[a] = stat(ctx, c.width, c.height, AREAS[a]);
    report[sc.name] = {
      条件: { 距離: Math.round(g.distance), 状態: g.state, 人数: g.stats?.count ?? null },
      領域: res,
      明度だけにしたときの差: greyGap(res),
    };
  }
  /*
   * ★**再現性の検査**（外部レビュー8番）。
   * 「障害物が無いレベルなら必ず同じ絵」と書いたが、それは言い過ぎだった。
   * 群衆の初期乱数・アニメーションの位相・カメラの補間などが揺れれば絵は変わる。
   * **言うのではなく測る。** 同じ場面を2回撮って、領域の明度がどれだけずれるかを見る。
   */
  {
    const twice = [];
    for (let t = 0; t < 2; t++) {
      seedRandom(12345);
      g.enter(0);
      let guard = 0;
      while (g.distance < 110 && g.state === 'RUN' && guard++ < 20000) { g.input.targetX = 0; g.update(1 / 60); }
      g.renderer.render(g.scene, g.rig.camera);
      const im = new Image(); im.src = g.renderer.domElement.toDataURL('image/png'); await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0);
      const r = {}; for (const k in AREAS) r[k] = stat(ctx, c.width, c.height, AREAS[k]).明度中央;
      twice.push(r);
    }
    const diff = {};
    for (const k in twice[0]) diff[k] = Math.abs(twice[0][k] - twice[1][k]);
    report['再現性（同じ場面を2回撮った明度の差）'] = diff;
  }

  /*
   * ★**ゲートがコースの外へ出ていないかの自動検査**（外部レビュー6番）。
   * 一度直したが、「直したつもり」を残さないために毎回測る。
   * 通常時・通過演出中・最大まで広がった時を全部通す。
   */
  {
    seedRandom(12345);
    g.enter(2);
    const half = 11 / 2;
    let worst = 0, when = null;
    for (let i = 0; i < 3000 && g.state === 'RUN'; i++) {
      g.input.targetX = 0; g.update(1 / 60);
      for (const row of g.gates.rows) {
        if (!row || !row.panels) continue;
        for (const p of row.panels) {
          const m = p.mesh || p;
          if (!m.visible) continue;
          const edge = Math.abs(m.position.x) + m.scale.x / 2;
          if (edge > worst) { worst = edge; when = Math.round(g.distance); }
        }
      }
    }
    report['ゲートの外側の端'] = {
      コースの半幅: half, 実測の最大: +worst.toFixed(3), そのときの距離: when,
      判定: worst <= half + 0.001 ? 'OK（外に出ていない）' : 'NG（はみ出している）',
    };
  }

  /*
   * ★**HUD の重なり検査**（2026-08-23）。
   * コインの表示を左上に足したとき、ステージ選択の札が同じ座標にあって
   * **完全に重なった**（両方 top:18-20px left:18px）。本人が実機で見つけた。
   * 自分では気づけなかった。新しい要素の位置だけ考えて、既にそこに何があるか見なかった。
   * **目で見るより、矩形を突き合わせるほうが速くて確実。**
   */
  {
    const els = [...document.querySelectorAll('.hud')]
      .filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed')
      .map((e) => ({ 名: e.className.replace('hud ', ''), r: e.getBoundingClientRect() }))
      .filter((o) => o.r.width > 0 && o.r.height > 0);
    const bad = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a2 = els[i].r, b2 = els[j].r;
        // 進捗バーは画面の幅いっぱいなので、他と重なって当然。除外する
        if (els[i].名.includes('bar') || els[j].名.includes('bar')) continue;
        if (a2.left < b2.right && b2.left < a2.right && a2.top < b2.bottom && b2.top < a2.bottom) {
          bad.push(els[i].名 + ' × ' + els[j].名);
        }
      }
    }
    report['HUD の重なり'] = bad.length ? { 判定: '★NG', 重なり: bad } : { 判定: 'OK', 数: els.length };
  }

  Math.random = realRandom;   // **必ず戻す。** 戻さないと以後のプレイが同じ展開になる
  console.log(JSON.stringify(report, null, 1));
  return report;
})();
