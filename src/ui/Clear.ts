const INK = '#3a2f27';
const PAPER = '#fffdf6';
const STAMP = '#e0453a';

/**
 * ★**達成感の判子**（2026-09-06 夜・本人指定）。
 *
 * 本人の言葉:「**倒した後、だいたい「達成感」を味合わせるために、例えば、城の門をくぐって
 * 「CLEAR」みたいな文字が出るゴール演出みたいなのがないと、やっぱり「達成感」が出ないと思う。
 * モンハンだっていつもあの音楽と「目標を達成しました」みたいな文字が出るからこそ達成感がでる。
 * そういう達成感が出る演出っていうのがゲームの本質**」。
 *
 * ★**この作品で唯一の「文字」。** §4-I は「文字を出すな」（Poki/CrazyGames のグローバル配信で
 * 翻訳が要るものを作らない、というレッドライン）だが、
 *  1. **本人が名指しで要求した**
 *  2. `CLEAR` は**どの国のゲームにも出る5文字**で、意味を知らなくても
 *     「終わった・勝った」以外に読みようがない
 *  3. ★**意味を運んでいるのは文字ではなく判子**（朱の丸に押される ＝ 承認された）。
 *     文字を全部消しても、この画面は「認められた」と読める
 * ので、**ここだけ例外にする**。逆に言うと、**判子の絵を外して文字だけにしてはいけない。**
 *
 * ★**演出の順番は「間 → 動き → 音 → 文字」。**
 * 勝った瞬間にこれを出すと、**ボスが消えたことに気づく前に紙が出る**（8/28 までの形がそれ）。
 * `Game` の `CLEAR` 状態が、間と門くぐりを済ませてからここを呼ぶ。
 */
export class Clear {
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = `
      /*
       * ★**上に寄せる**（2026-09-06 夜・実機で直した）。真ん中に置いたら
       * **門の前に立っている主人公と群れが、帯と判子で完全に隠れた**（.shots で確認）。
       * ※このコメントはテンプレートリテラルの中なので**バッククォートを書かない**
       *   （書いた瞬間に文字列が切れて、起動時 TypeError で真っ白になる。実際にやらかした）
       * 隠してはいけないのは「**自分がどこに立っているか**」——それが見えないと、
       * 「門をくぐった」ではなく「画面に紙が出た」になる
       */
      .cl-root { position:absolute; inset:0; display:flex; align-items:flex-start;
                 justify-content:center; pointer-events:none; opacity:0;
                 transition:opacity .35s ease-out;
                 font-family:"Segoe UI",system-ui,sans-serif; }
      .cl-root.on { opacity:1; }

      /* 白い閃光。門をくぐった瞬間だけ、画面が一度飛ぶ */
      .cl-flash { position:absolute; inset:0; background:${PAPER}; opacity:0; }
      .cl-root.on .cl-flash { animation:cl-flash .55s ease-out forwards; }

      /* 判子。**紙に押される**ので、回りながら落ちてきて、跳ねて止まる */
      .cl-stamp { position:relative; margin-top:4vh; width:min(42vw,220px); aspect-ratio:1;
                  border:min(2.6vw,13px) solid ${STAMP}; border-radius:50%;
                  display:flex; align-items:center; justify-content:center;
                  background:rgba(224,69,58,.08); color:${STAMP};
                  opacity:0; transform:rotate(-34deg) scale(2.6); }
      .cl-root.on .cl-stamp { animation:cl-press .5s cubic-bezier(.2,.9,.25,1) .18s forwards; }
      .cl-stamp::before { content:''; position:absolute; inset:min(2.4vw,12px);
                          border-radius:50%; border:3px solid currentColor; opacity:.5; }
      .cl-stamp b { font-size:min(8vw,42px); font-weight:900; letter-spacing:.10em;
                    line-height:1; text-indent:.10em; }

      /* 衝撃の輪。押した勢いを外へ逃がす（判子だけだと「置いた」に見える） */
      .cl-ring { position:absolute; top:4vh; width:min(42vw,220px); aspect-ratio:1;
                 border:6px solid ${STAMP}; border-radius:50%; opacity:0; }
      .cl-root.on .cl-ring { animation:cl-ring .6s ease-out .30s forwards; }

      /* 下に敷く帯。文字が背景に負けないための「紙」。**判子のぶんだけ**にする */
      .cl-band { position:absolute; left:0; right:0; top:2vh; height:min(48vw,250px);
                 background:${PAPER}; opacity:0; border-top:5px solid ${INK};
                 border-bottom:5px solid ${INK}; }
      .cl-root.on .cl-band { animation:cl-band .5s cubic-bezier(.2,.9,.3,1) forwards; }

      @keyframes cl-flash { 0% { opacity:.92; } 100% { opacity:0; } }
      @keyframes cl-band {
        0%   { opacity:0; transform:scaleY(.1); }
        100% { opacity:.92; transform:scaleY(1); }
      }
      @keyframes cl-press {
        0%   { opacity:0;  transform:rotate(-34deg) scale(2.6); }
        55%  { opacity:1;  transform:rotate(-9deg)  scale(.88); }
        72%  { opacity:1;  transform:rotate(-9deg)  scale(1.06); }
        100% { opacity:1;  transform:rotate(-9deg)  scale(1); }
      }
      @keyframes cl-ring {
        0%   { opacity:.85; transform:scale(.9); }
        100% { opacity:0;   transform:scale(2.1); }
      }
      @media (prefers-reduced-motion: reduce) {
        .cl-root.on .cl-flash, .cl-root.on .cl-ring { animation:none; opacity:0; }
        .cl-root.on .cl-stamp { animation:none; opacity:1; transform:rotate(-9deg) scale(1); }
        .cl-root.on .cl-band { animation:none; opacity:.92; }
      }
    `;
    parent.appendChild(style);

    this.root = document.createElement('div');
    this.root.className = 'cl-root';
    this.root.innerHTML = `
      <div class="cl-flash"></div>
      <div class="cl-band"></div>
      <div class="cl-ring"></div>
      <div class="cl-stamp"><b>CLEAR</b></div>
    `;
    parent.appendChild(this.root);
  }

  /**
   * 押す。**CSS のアニメーションは class を付け直さないと再生されない**ので、
   * 一度外して再流し込みする（2周目に何も出ない、を防ぐ）
   */
  show(): void {
    this.root.classList.remove('on');
    // レイアウトを1回強制して animation を巻き戻す。**これが無いと2回目が無音・無動作になる**
    void this.root.offsetWidth;
    this.root.classList.add('on');
  }

  hide(): void {
    this.root.classList.remove('on');
  }
}
