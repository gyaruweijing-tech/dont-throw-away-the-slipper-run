/*
 * 仮のキャラアトラスを作る道具（**ランタイムではない**）。
 *
 * ブラウザのコンソールにこのファイルの中身を貼って実行すると、
 * `.shots/atlas.png` に 2048×2048 の PNG が落ちる。それを
 * `assets/v2/char/atlas.png` へコピーして使う。
 *
 * **これは本番の絵ではない。** 本番は外部の絵（AIか人）に差し替える。
 * ゲーム側は PNG をファイルとして読むだけなので、**差し替えは上書きだけ**で済む。
 * ここで作るのは「関節の折れ方・Zの重なり・シルエット」を検証するための仮素材。
 *
 * マス割りは `src/entities/cutoutLayout.ts` の SLOT と一致させること。
 *   行0: allyHead  allyBody  allyArm   allyLeg
 *   行1: allyPaper heroArmUp heroSlip  -
 *   行2: hrHead    hrBody    hrArm     hrLeg
 *   行3: syainHead syainBody syainArm syainLeg
 */
(async () => {
  const S = 2048, C = S / 4;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);

  const INK = '#3a2f27';
  const SKIN = '#e6cfae';
    /*
   * ★**実験3（2026-08-23）: 群衆だけ明るく・鮮やかにする。**
   * 参考の実プレイ画面を実測すると 群衆は 明度55 / 彩度66。
   * こちらは 明度37 / 彩度33 で、**画面で一番暗い塊**になっていた。
   * 一番暗い物は主役ではなく「穴」として読まれる。
   */
  const SUIT = '#35a8e0';       // 明るい青。旧 #4a6a86 は暗すぎた
  /*
   * ★**役所の来客用スリッパ**（本人決定 2026-08-23）。
   * 「正体不明の黄色い履物」をやめ、**日本人なら0.5秒で分かる物**にする。
   * 青にするので**＋×ゲートの藍 `gain #3f7fc4` とぶつかる**が、
   * こちらは**明度をはっきり上げて**分ける（同じ青系でも明暗が離れれば混ざらない）。
   */
  const SLIP = '#6fc3e0';       // 甲バンドの青ビニール
  const SLIP_SOLE = '#f4f1e6';  // ゴム底。生成りの白
  const SLIP_HOLE = '#8a7d6e';  // 足を入れる穴の影
  const PAPER = '#fffdf6';
  const NAVY = '#2f3f6b';       // 人事部
  const SYAIN = '#c1553f';     // 社員。人事部と混ざらない色

  /*
   * セル(col,row) の中に「絵の座標系 0..1」で描く。
   *
   * ★**セルいっぱいには描かない。** 周囲に PAD ぶんの余白を残す。
   * ミップマップの縮小で隣のマスの色が混ざる（にじみ）のを防ぐため。
   * UV 側も内側へ寄せてあるが（cutoutLayout.ts の INSET）、
   * **絵がセルの端まで描かれていると、UVを寄せてもミップ段では混ざる。**
   * 両方やって初めて効く。
   */
  const PAD = 0.06;
  const inCell = (col, row, fn) => {
    g.save();
    g.translate(col * C + C * PAD, row * C + C * PAD);
    const inner = C * (1 - PAD * 2);
    g.beginPath(); g.rect(0, 0, inner, inner); g.clip();
    fn((x) => x * inner, (y) => y * inner);
    g.restore();
  };
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
  /**
   * 輪郭線。**ATLAS.md §5 のとおり太さはセル幅の 3.5% で統一する。**
   * 呼ぶ側で毎回太さを変えると、最小表示(16px)で線が面積を食う所と食わない所が出る。
   */
  const LW = 0.035;
  const line = (X) => { g.strokeStyle = INK; g.lineWidth = X(LW); g.lineJoin = 'round'; g.stroke(); };

  /**
   * 頭。**首を足す。** 首が無いと頭が胴の上に乗っているだけに見えて、
   * 24px に縮めたとき「四角が2つ積んである」にしか読めない。
   * 角は大きく丸める（ATLAS.md の方向性: 丸い・柔らかい）。
   */
  const head = (col, row, fill) => inCell(col, row, (X, Y) => {
    g.fillStyle = fill;
    // 首（胴に隠れる前提で少しだけ出す）
    g.beginPath(); g.roundRect(X(0.40), Y(0.62), X(0.20), Y(0.30), X(0.06)); g.fill(); line(X);
    // 頭。**縦より横をわずかに狭く**すると人の頭に見える
    g.beginPath(); g.roundRect(X(0.19), Y(0.10), X(0.62), Y(0.64), X(0.26)); g.fill(); line(X);
    // 耳。輪郭の外に小さく出すだけで「顔が無い」不気味さが減る
    g.beginPath(); g.roundRect(X(0.13), Y(0.36), X(0.10), Y(0.16), X(0.05)); g.fill(); line(X);
    g.beginPath(); g.roundRect(X(0.77), Y(0.36), X(0.10), Y(0.16), X(0.05)); g.fill(); line(X);
  });

  /**
   * 胴。**肩を丸め、裾に向かって細くする。**
   * 前は直線の台形で「バケツ」に見えていた。肩の角を落とすだけで人に見える。
   */
  const body = (col, row, fill, extra) => inCell(col, row, (X, Y) => {
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(X(0.12), Y(0.26));
    // 肩を丸める。ここが角ばっていると「箱」に戻る
    g.quadraticCurveTo(X(0.14), Y(0.10), X(0.34), Y(0.08));
    g.lineTo(X(0.66), Y(0.08));
    g.quadraticCurveTo(X(0.86), Y(0.10), X(0.88), Y(0.26));
    g.lineTo(X(0.80), Y(0.88));
    g.quadraticCurveTo(X(0.50), Y(0.95), X(0.20), Y(0.88));
    g.closePath(); g.fill(); line(X);
    if (extra) extra(X, Y);
  });

  /**
   * 腕。**袖口と手を足す。**
   * ただの棒だと、群れの中で胴と見分けがつかず「肩から布が垂れている」ように見える。
   */
  const arm = (col, row, fill) => inCell(col, row, (X, Y) => {
    g.fillStyle = fill;
    g.beginPath(); g.roundRect(X(0.30), Y(0.06), X(0.40), Y(0.72), X(0.20)); g.fill(); line(X);
    // 袖口（明るい線）
    g.strokeStyle = PAPER; g.lineWidth = X(0.05);
    g.beginPath(); g.moveTo(X(0.32), Y(0.70)); g.lineTo(X(0.68), Y(0.70)); g.stroke();
    // 手
    g.fillStyle = SKIN;
    g.beginPath(); g.roundRect(X(0.32), Y(0.72), X(0.36), Y(0.22), X(0.11)); g.fill(); line(X);
  });

  /**
   * 脚＋スリッパ。**足だけ横向きに描く**（PLAN.md / ASSETS.md）。
   *
   * 来客用スリッパの見分けは**3つ揃って初めて成立する**。
   * どれか欠けると「靴」か「靴下」に見える:
   *   1. **平らな白いゴム底**（つま先だけ少し反る）
   *   2. **甲を覆う幅広の一枚バンド**（青ビニール）
   *   3. **かかとが開いている**（バンドの後ろに何も無い）
   */
  const leg = (col, row, fill) => inCell(col, row, (X, Y) => {
    g.fillStyle = fill;
    g.beginPath(); g.roundRect(X(0.34), Y(0.04), X(0.32), Y(0.72), X(0.14)); g.fill(); line(X);
    // 1. 底（横向き・つま先は左）。**底は白。** 色を底に置くと「長靴」に見える
    g.fillStyle = SLIP_SOLE;
    g.beginPath();
    g.moveTo(X(0.05), Y(0.84));
    g.quadraticCurveTo(X(0.02), Y(0.74), X(0.20), Y(0.75));
    g.lineTo(X(0.76), Y(0.77));
    g.quadraticCurveTo(X(0.86), Y(0.82), X(0.76), Y(0.90));
    g.lineTo(X(0.13), Y(0.92));
    g.closePath(); g.fill(); line(X);
    // 2. 甲のバンド。前半分を大きく覆う。3. その後ろは開けたまま
    g.fillStyle = SLIP;
    g.beginPath();
    g.moveTo(X(0.07), Y(0.79));
    g.quadraticCurveTo(X(0.22), Y(0.51), X(0.49), Y(0.74));
    g.lineTo(X(0.43), Y(0.81));
    g.quadraticCurveTo(X(0.24), Y(0.61), X(0.13), Y(0.83));
    g.closePath(); g.fill(); line(X);
    // ビニールのテカリ。**これが無いと布のスリッパに見える**
    g.strokeStyle = '#ffffff'; g.lineWidth = X(0.022); g.lineCap = 'round';
    g.beginPath(); g.moveTo(X(0.15), Y(0.72)); g.quadraticCurveTo(X(0.26), Y(0.59), X(0.38), Y(0.70)); g.stroke();
  });

  // --- 行0: 味方 ---
  head(0, 0, SKIN);
  body(1, 0, SUIT, (X, Y) => {
    // 襟。**背中から見えるのは襟の後ろ側**なので、横一文字に近い形にする
    g.fillStyle = PAPER;
    g.beginPath();
    g.moveTo(X(0.34), Y(0.11));
    g.quadraticCurveTo(X(0.50), Y(0.26), X(0.66), Y(0.11));
    g.quadraticCurveTo(X(0.50), Y(0.18), X(0.34), Y(0.11));
    g.closePath(); g.fill(); line(X);
    // 背中の縫い目。**1本入れるだけで「服」になる**（のっぺり対策）
    g.strokeStyle = 'rgba(58,47,39,.30)';
    g.lineWidth = X(0.016);
    g.beginPath(); g.moveTo(X(0.50), Y(0.20)); g.lineTo(X(0.50), Y(0.86)); g.stroke();
  });
  arm(2, 0, SUIT);
  leg(3, 0, SUIT);

  // --- 行1: 主人公まわり ---
  inCell(0, 1, (X, Y) => { // 書類
    g.fillStyle = PAPER;
    g.beginPath(); g.roundRect(X(0.22), Y(0.16), X(0.56), Y(0.68), X(0.04)); g.fill(); line(X);
    g.strokeStyle = 'rgba(58,47,39,.35)'; g.lineWidth = X(0.018);
    for (let i = 0; i < 4; i++) {
      g.beginPath(); g.moveTo(X(0.30), Y(0.30 + i * 0.13)); g.lineTo(X(0.70), Y(0.30 + i * 0.13)); g.stroke();
    }
  });
  arm(1, 1, SUIT); // 掲げる腕（同じ絵でよい）
  /*
   * ★**掲げるスリッパ。縦持ち。**（本人指摘 2026-08-23）
   *
   * 前は横向き＝**寝かせて**持たせていた。これは「ハンマーに見える」問題を直すときに
   * **行き過ぎて逆へ倒した**結果で、今度は「持ち上げた板」に見えていた。
   *
   * かかと側を握り、つま先を上へ。**甲の側から見た形**にするので
   * 「幅広バンド」と「かかとの開き」が同時に見える ＝ スリッパだと分かる。
   * 縦横比は実物どおり約1:2.2（26cm × 10cm）。
   */
  inCell(2, 1, (X, Y) => {
    /*
     * 外周（＝底の形）。
     * ★**つま先を尖らせない。** 最初これを尖らせたら**サーフボードに見えた**（実機・2026-08-23）。
     * 実物の来客用スリッパは**つま先が丸くて広く**、土踏まずで少しくびれ、かかとが締まる。
     * 縦横比も 1:3 まで細くすると板に見える。**1:2.3 あたりが「履物」の限界**。
     */
    g.fillStyle = SLIP_SOLE;
    g.beginPath();
    g.moveTo(X(0.50), Y(0.06));
    g.bezierCurveTo(X(0.86), Y(0.06), X(0.89), Y(0.26), X(0.85), Y(0.42)); // 右つま先→一番広い所
    g.bezierCurveTo(X(0.82), Y(0.62), X(0.80), Y(0.74), X(0.78), Y(0.90)); // 土踏まずのくびれ→かかと
    g.quadraticCurveTo(X(0.50), Y(0.98), X(0.22), Y(0.90));
    g.bezierCurveTo(X(0.20), Y(0.74), X(0.18), Y(0.62), X(0.15), Y(0.42));
    g.bezierCurveTo(X(0.11), Y(0.26), X(0.14), Y(0.06), X(0.50), Y(0.06));
    g.closePath(); g.fill(); line(X);
    // 足を入れる穴。**かかと側にぽっかり開いている**のが来客用スリッパの証拠
    g.fillStyle = SLIP_HOLE;
    g.beginPath(); g.ellipse(X(0.50), Y(0.72), X(0.27), Y(0.19), 0, 0, Math.PI * 2); g.fill();
    // 甲の幅広バンド。**端から端まで届かせる。** 細い弧にすると靴のロゴに見える
    g.fillStyle = SLIP;
    g.beginPath();
    g.moveTo(X(0.145), Y(0.29));
    g.quadraticCurveTo(X(0.50), Y(0.21), X(0.855), Y(0.29));
    g.lineTo(X(0.835), Y(0.55));
    g.quadraticCurveTo(X(0.50), Y(0.45), X(0.165), Y(0.55));
    g.closePath(); g.fill(); line(X);
    // ビニールのテカリ。**短く・まっすぐ寄りに。** 大きな弧にすると靴のマークに見える
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = X(0.026); g.lineCap = 'round';
    g.beginPath(); g.moveTo(X(0.24), Y(0.32)); g.quadraticCurveTo(X(0.37), Y(0.27), X(0.50), Y(0.265)); g.stroke();
  });

  // 接地影（3,1）。**暗い穴に見えないよう、黒ではなく暖かい灰にする**
  inCell(3, 1, (X, Y) => {
    g.fillStyle = "#9a9086";
    g.beginPath(); g.ellipse(X(0.5), Y(0.5), X(0.44), Y(0.30), 0, 0, Math.PI * 2); g.fill();
  });

  // --- 行2: 人事部（濃紺・腕章） ---
  head(0, 2, '#cbb69c');
  body(1, 2, NAVY, (X, Y) => {
    g.fillStyle = '#e8c020'; // 腕章
    rr(X(0.62), Y(0.30), X(0.26), Y(0.16), X(0.03)); line(X);
  });
  inCell(2, 2, (X, Y) => { // 腕組み（横長の帯）
    g.fillStyle = NAVY;
    g.beginPath(); g.roundRect(X(0.04), Y(0.30), X(0.92), Y(0.40), X(0.18)); g.fill(); line(X);
  });
  leg(3, 2, NAVY);

  // --- 行3: 社員（別色・でかい口） ---
  inCell(0, 3, (X, Y) => {
    g.fillStyle = '#d8c0a4';
    g.beginPath(); g.roundRect(X(0.14), Y(0.12), X(0.72), Y(0.74), X(0.22)); g.fill(); line(X);
    g.fillStyle = '#8e2b22'; // **口が頭の半分**（§4-D）
    g.beginPath(); g.ellipse(X(0.50), Y(0.62), X(0.28), Y(0.20), 0, 0, Math.PI * 2); g.fill(); line(X);
  });
  body(1, 3, SYAIN, null);
  inCell(2, 3, (X, Y) => {
    g.fillStyle = SYAIN;
    g.beginPath(); g.roundRect(X(0.04), Y(0.30), X(0.92), Y(0.40), X(0.18)); g.fill(); line(X);
  });
  leg(3, 3, SYAIN);

  /*
   * ★**外周の複製（dilation）。ATLAS.md §1 の3層目。**
   *
   * 透明な画素に、隣の不透明な画素の**色だけ**をコピーする（アルファは0のまま）。
   * これが無いと、ミップマップの縮小で「絵の色」と「透明（＝黒）」が混ざり、
   * **輪郭に暗い縁が出る**。PAD（絵の余白）と INSET（UVの内寄せ）だけでは防げない種類のにじみ。
   *
   * アルファを増やさないので、シルエットは1ピクセルも変わらない。
   */
  const DILATE = 6;
  {
    const img = g.getImageData(0, 0, S, S);
    const d = img.data;
    // **すでに色を入れた画素も、次の段では「元」として使う。**
    // これが無いと何回まわしても1画素しか広がらない
    const filled = new Uint8Array(S * S);
    for (let p = 0; p < S * S; p++) filled[p] = d[p * 4 + 3] > 0 ? 1 : 0;
    for (let pass = 0; pass < DILATE; pass++) {
      const src = new Uint8ClampedArray(d);
      const was = filled.slice();
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const i = (y * S + x) * 4;
          if (was[y * S + x]) continue;           // すでに色があるならそのまま
          let r = 0, gg = 0, b = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
              const j = (yy * S + xx) * 4;
              if (!was[yy * S + xx]) continue;
              r += src[j]; gg += src[j + 1]; b += src[j + 2]; n++;
            }
          }
          if (!n) continue;
          d[i] = r / n; d[i + 1] = gg / n; d[i + 2] = b / n;  // 色だけ入れる
          d[i + 3] = 0;                                        // **アルファは0のまま**
          filled[y * S + x] = 1;
        }
      }
    }
    g.putImageData(img, 0, 0);
  }
  const url = cv.toDataURL('image/png');
  const r = await fetch('/__shot', { method: 'POST', body: JSON.stringify({ name: 'atlas', dataUrl: url }) });
  console.log('atlas', r.status, url.length);
  return 'ok';
})();
