/**
 * レベル導入 ＝ **書類の1枚がめくれて出る**（PROGRESS §4-I）。
 *
 * レッドライン（§4-I / §4-D）をここで全部守る:
 *  - **文字を1文字も出さない。** 宛先・日付・品名は塗りつぶしの帯、罪状は**アイコン＋横線**
 *    （＝翻訳不要・特定性ゼロ・審査に強いの三得）
 *  - 実際の出来事の具体（物品名・金額・場所・機関名）を入れない。実在の様式・紋章も模さない
 *  - 外部フォント・外部画像を読み込まない。図形はすべて CSS（初回DL 8MB 目標・§6）
 *
 * 遊びを止めないこと:
 *  走行は**裏で始まっている**。この紙は overlay で、最初の入力か 1.8 秒で自分から消える。
 *  ハイパーカジュアルで最初の数秒を奪うのが一番損（§3「最初の10秒」）。
 */
/**
 * CSS は**1回だけ**入れる。`Intro` は Hud/Result と違ってステージごとに `new` されるので、
 * コンストラクタで style を足すと5本を周回するたび同じ CSS のタグが増え続ける（クラウド側の検品が発見）。
 * 中身は不変なのでインスタンスに紐づける必要がない
 */
let styled = false;
function ensureStyle(parent: HTMLElement): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = `
      .in-root { position:absolute; inset:0; display:flex; align-items:center;
                 justify-content:center; pointer-events:none;
                 perspective:900px; z-index:3; }
      .in-sheet { position:relative; width:min(74vw,320px); padding:20px 22px 16px; background:#efe9dc;
                  color:#2b2a28; border:3px solid #2b2a28;
                  box-shadow:0 12px 30px rgba(43,42,40,.32);
                  transform-origin:50% 0%;
                  animation:in-flip .52s cubic-bezier(.15,.85,.3,1) both; }
      /* 綴じ穴。リザルトの調書と同じ様式に見せて、同じ書類の束だと分からせる */
      .in-sheet::before, .in-sheet::after { content:""; position:absolute; left:9px;
                  width:9px; height:9px; border-radius:50%; background:#cdc4b2; }
      .in-sheet::before { top:15px; } .in-sheet::after { bottom:15px; }
      .in-root.out .in-sheet { animation:in-away .34s ease-in forwards; }

      /* 宛先・日付は塗りつぶし（§4-I: 特定性を入れない） */
      .in-fill { height:8px; background:#2b2a28; opacity:.22; margin-bottom:6px; }
      .in-fill.w1 { width:62%; } .in-fill.w2 { width:38%; }
      .in-rule { height:3px; background:#2b2a28; margin:12px 0 14px; }

      /**
       * **被害品 ＝ スリッパ。ここで形を教える（2026-08-22 本人指摘）。**
       *
       * 3Dの棒人間は最小12pxで描かれ、カメラは真後ろ。
       * **その条件では、履いているスリッパも掲げているスリッパも、原理的に形が読めない**
       * （靴は横から見ないと分からない物なので）。実機で「持っているのが分かりづらい」と言われた。
       *
       * → 3Dで説明しようとするのをやめ、**レベルの頭に出るこの紙に大きく1回描く。**
       * ここは CSS なので 100px 以上で描けるし、文字も要らない（§4-I）。
       * 一度この形を見せておけば、走行中の3Dは「同じ物だ」と分かればよくなる。
       */
      .in-item { position:relative; width:132px; height:74px; margin:2px auto 14px; }
      /* 判子の輪。書類に押された「これが被害品」の印 */
      .in-item u { position:absolute; left:50%; top:50%; width:104px; height:104px;
                   margin:-52px 0 0 -52px; border:3px solid #c8352b; border-radius:50%;
                   opacity:.55; }
      /* 底。かかと側（右）は薄く、つま先側（左）へ向かって少し反り上がる */
      .in-item i { position:absolute; left:14px; bottom:14px; width:104px; height:15px;
                   background:#2b2a28; border-radius:9px 5px 4px 9px; }
      /* 甲。**前半分を大きく覆う。ここが小さいと履物に見えない** */
      .in-item b { position:absolute; left:14px; bottom:26px; width:56px; height:30px;
                   background:#2b2a28; border-radius:28px 22px 0 0; }

      /* 綴じ札 ＝ 何件目の書類か。HUD・調書と同じ様式（§4-I: 文字を使わない） */
      /* ★5個ずつ折り返す（§11-10）。20本だと1列で収まらない。
         width = 5*15 + 4*4 = 91px。書類の右肩から下へ垂れる索引札の形になる */
      .in-tabs { position:absolute; top:-11px; right:16px; display:flex; flex-wrap:wrap;
                 width:91px; gap:4px; row-gap:4px; justify-content:flex-end; }
      .in-tabs i { display:block; width:15px; height:11px; border:2px solid #2b2a28;
                   background:#efe9dc; opacity:.4;
                   clip-path:polygon(0 0, 74% 0, 100% 34%, 100% 100%, 0 100%); }
      .in-tabs i.done { background:#2b2a28; opacity:.55; }
      .in-tabs i.now  { background:#b3271e; border-color:#b3271e; opacity:1; }

      /* 罪状の行 ＝ アイコン ＋ 横線。文字は使わない */
      .in-charge { display:flex; align-items:center; gap:10px; margin:11px 0; }
      .in-charge s { flex:1; height:6px; background:#2b2a28; opacity:.30;
                     text-decoration:none; display:block; }
      .in-charge em { width:18px; height:18px; flex:0 0 18px; border:2px solid #2b2a28;
                      opacity:.8; font-style:normal; }
      .in-charge.a em { border-radius:50%; }
      .in-charge.b em { border-radius:2px; transform:rotate(45deg); }
      .in-charge.c em { border-radius:2px 2px 9px 9px; }
      .in-charge.b s { flex:.78; } .in-charge.c s { flex:.55; }

      /* 受理印。紙が出きったあとに小さく押す */
      .in-seal { position:absolute; right:-10px; bottom:-12px; width:54px; height:54px;
                 border-radius:50%; border:3px solid #c8352b; opacity:0;
                 animation:in-seal .3s ease-out .46s forwards; }
      .in-seal::before { content:""; position:absolute; inset:4px; border-radius:50%;
                 border:1px solid #c8352b; opacity:.6; }

      @keyframes in-flip {
        from { transform:rotateX(-88deg) translateY(-14px); opacity:0; }
        to   { transform:rotateX(0) translateY(0); opacity:1; }
      }
      @keyframes in-away {
        to { transform:rotateX(62deg) translateY(-26px) scale(.94); opacity:0; }
      }
      @keyframes in-seal {
        from { opacity:0; transform:rotate(-28deg) scale(1.9); }
        to   { opacity:.9; transform:rotate(-12deg) scale(1); }
      }
      @media (prefers-reduced-motion: reduce) {
        .in-sheet { animation:none; }
        .in-seal  { animation:none; opacity:.9; transform:rotate(-12deg); }
      }`;
  parent.appendChild(style);
}

export class Intro {
  private readonly root: HTMLElement;
  private timer = 0;
  private done = false;

  /** @param level 何本目か（0 始まり） @param levels 全本数 */
  constructor(parent: HTMLElement, level = 0, levels = 1) {
    ensureStyle(parent);
    this.root = document.createElement('div');
    this.root.className = 'in-root';
    this.root.innerHTML = `
      <div class="in-sheet">
        <div class="in-tabs">${Array.from(
          { length: levels },
          (_, i) => `<i class="${i < level ? 'done' : i === level ? 'now' : ''}"></i>`,
        ).join('')}</div>
        <div class="in-item"><u></u><i></i><b></b></div>
        <div class="in-fill w1"></div>
        <div class="in-fill w2"></div>
        <div class="in-rule"></div>
        <div class="in-charge a"><em></em><s></s></div>
        <div class="in-charge b"><em></em><s></s></div>
        <div class="in-charge c"><em></em><s></s></div>
        <div class="in-seal"></div>
      </div>
    `;
    parent.appendChild(this.root);
    this.timer = window.setTimeout(this.dismiss, 1800);
    // 最初の操作で即座に引っ込む。読ませる物ではなく「場を示す」だけの紙
    addEventListener('pointerdown', this.dismiss, { passive: true, once: true });
    addEventListener('keydown', this.dismiss, { once: true });
  }

  /** 二重に呼ばれても安全。タイマーと入力の両方から来る */
  dismiss = (): void => {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.timer);
    // `once` だけに任せると**鳴らなかった側が残る**（タイマーで消えた回・キーが来なかった回）。
    // ステージごとに new されるので、外し忘れは周回で積み上がる
    removeEventListener('pointerdown', this.dismiss);
    removeEventListener('keydown', this.dismiss);
    this.root.classList.add('out');
    // アニメが終わってから外す。すぐ remove すると閉じる画が出ない
    window.setTimeout(() => this.root.remove(), 400);
  };
}
