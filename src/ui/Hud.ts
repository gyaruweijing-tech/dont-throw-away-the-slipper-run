import { fmtCount, fmtLog } from '../entities/gateOps';
/**
 * HUD（2026-08-22 全面改訂）。
 *
 * **前は9要素あった。** 題字・綴じ札・敵の人数・コイン・距離・人数・draw数・矢印・進捗バー。
 * 一個ずつは全部「理由がある」が、**全部に理由があるものは、何にも寄っていない**。
 * 本人の「AIライクなUI」「ダッシュボードでゲーム画面じゃない」はこれを指していた。
 *
 * **常時出るのは6つだけにした**（2026-08-27 に 4→5、2026-09-11 に 5→6。どちらも本人決定）**:**
 *  1. **人数** — このゲームで唯一ずっと見る数字。だから一番大きい
 *  2. **進捗** — あとどれくらいで終わるか
 *  3. **ステージ** — 何本目か（押すと移動できる。本人のテスト用）
 *  4. **敵の人数** — **出ているときだけ**。常時ではないので画面を汚さない
 *  5. **コイン** — 9d802da で本人の指示により復活。★**上限を4から5へ引き上げた**のであって、
 *     「4つと言いながら5つある」ではない（2026-08-27・§15 の予算表も 5 に直した）
 *  6. **レベル番号** — 2026-09-07 に追加。★**上限は 5 → 6 になった**（2026-09-11・本人が
 *     「空いてる所へ動かす」を選んだ ＝ 本番に出す側を選んだ。開発用に隠す案は不採用）。
 *     ★**§15 の予算表も 6 に直すこと。** 数え方が2か所にあると、また「5つと言いながら6つある」になる
 *
 * 消したもの: 題字（毎フレーム読む物ではない）／距離の数字（進捗バーと二重）／
 * draw数（開発用なので隠した）。
 * ※コインは一度消したが、本人の指示で戻した（9d802da）。
 *
 * 配色も変えた。**§4-I の「虹色を使わない」は廃止**（`PLAN.md`）。
 * 紙は明るい白、線は真っ黒でなく濃い茶、コインは金、敵は朱。
 */

/** 濃い茶。真っ黒より柔らかい（任天堂系の定石） */
const INK = '#3a2f27';
const PAPER = '#fffdf6';
const STAMP = '#e0453a';
/** コインの金。**世界の常識に逆らわない**（藍にして本人に怒られた） */
const GOLD = '#f2b632';
const GOLD_DARK = '#c8892a';

/** ★人数が減ったときの赤（判子の朱と同じ系統。新しい色は増やさない） */
const LOSS_RED = '#c8352b';
/** 赤く見せている時間（秒）。短すぎると気づかず、長いと「ずっと損している」ように見える */
const LOSS_HOLD = 0.26;

export class Hud {
  private readonly stampNum: HTMLElement;
  private readonly stamp: HTMLElement;
  private readonly drawnNote: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly tabs: HTMLElement;
  /** ★レベル番号（2026-09-07・本人「今どのレベルか分からない。開発に不便」） */
  private readonly lvNum: HTMLElement;
  private readonly boss: HTMLElement;
  private readonly bossNum: HTMLElement;
  /**
   * コインの総量（左上）。
   *
   * ★**一度これを消したのは私の判断ミス。**（2026-08-23 本人が指摘）
   * 「走行中に見ても行動が変わらないから結果画面で見せればよい」と考えて
   * `setCoins` を空にしたが、本人は前から**「たまったコインは数値表現した方がいい」**と
   * 言っていた。**貯まっていくのを見ること自体が目的**なので、行動が変わるかは関係なかった。
   */
  private readonly coins: HTMLElement;
  private readonly coinNum: HTMLElement;
  private dispCoins = -1;

  private acc = 0;
  private frames = 0;
  private dispCount = 0;
  /** 増えた瞬間だけ弾ませる */
  private punch = 0;
  /** ★減った合図（赤く弾ませる）の残り秒 */
  private loss = 0;
  private lastShown = -1;
  /** ★表示中の人数の桁（log₁₀(人数+1)）。桁が大きいときはこちらで転がす（理系用は 10³⁰⁰ を越える） */
  private dispL = 0;
  /** 最後に書いた文字。同じなら DOM を触らない */
  private lastText = '';

  /** 札を押してステージを選べる。★開発ビルドだけ（Game.ts で DEV のときしか繋がない・2026-10-03） */
  onPickLevel?: (index: number) => void;

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = `
      .hud { position:absolute; pointer-events:none; color:${INK};
             font-family:"Segoe UI",system-ui,sans-serif; }

      /* ============ 1. 人数（右上）============
         **画面で一番大きい数字。** これだけはどんな状況でも読めなければならない。
         判子の丸は残す（世界観）が、前より明るく・太く・大きくした */
      .hud-count { top:18px; right:18px; display:flex; align-items:center; gap:9px;
                   padding:7px 16px 7px 12px; border-radius:999px;
                   background:${PAPER}; border:4px solid ${INK};
                   box-shadow:0 4px 0 rgba(58,47,39,.22);
                   transform-origin:50% 50%; }
      /* 人のアイコン。頭と胴だけ。丸みをつける */
      .hud-count i { display:block; position:relative; width:15px; height:22px; }
      .hud-count i::before { content:''; position:absolute; left:3px; top:0;
                   width:9px; height:9px; border-radius:50%; background:${INK}; }
      .hud-count i::after { content:''; position:absolute; left:0; bottom:0;
                   width:15px; height:12px; border-radius:6px 6px 3px 3px; background:${INK}; }
      .hud-count b { font-size:34px; font-weight:900; line-height:1;
                     font-variant-numeric:tabular-nums; letter-spacing:-.01em; }

      /* ============ 2. 進捗（上端）============
         前は「綴じ紐」で細く目立たなかった。太くして上端に貼る */
      .hud-bar { top:0; left:0; right:0; height:9px; background:rgba(58,47,39,.14); }
      .hud-bar i { display:block; height:100%; width:0%; background:${INK};
                   border-radius:0 5px 5px 0; transition:width .1s linear; }

      /* ============ 3. ステージの札（左上）============ */
      /*
       * ★**コイン(左上)の下へ動かした**（2026-08-23 本人が実機で発見）。
       * コインを左上に足したとき、ここが top:20px left:18px のままで**完全に重なっていた**。
       * 新しい要素を足すときは、**同じ角に既に何があるかを見る**。
       * 札はテスト用なので、常時見る数字（コイン）より下でよい。
       */
      /*
       * ★**5個ずつ4段に折り返す**（2026-08-24 本人決定・§11-10）。
       * レベルが5本→20本になり、1列だと 20*20px + 19*6px ≒ 514px で携帯幅を確実に超えた。
       * **段を5個で折るのは「5本ごとにボス」という区切りを札の形そのものに出すため。**
       * width は 5*20 + 4*6 = 124px（ここを変えたら1段の枚数が変わる）。
       */
      .hud-tabs { top:66px; left:18px; display:flex; flex-wrap:wrap;
                  width:124px; gap:6px; row-gap:7px;
                  pointer-events:auto; cursor:pointer; }
      .hud-tabs i { display:block; width:20px; height:14px; box-sizing:border-box;
                  border:3px solid ${INK}; border-radius:3px 6px 3px 3px;
                  background:${PAPER}; opacity:.45; }
      .hud-tabs i.done { background:${INK}; opacity:.55; }
      .hud-tabs i.now  { background:${STAMP}; border-color:${INK}; opacity:1;
                         transform:translateY(-3px) scale(1.16); }

      /* ★**レベル番号**（2026-09-07）。札は「何本目か」を位置でしか示さないので、数字を1つ足す。
       *
       * ★★**札の「上」から「下」へ動かした**（2026-09-11 本人指定「空いてる所へ動かす」）。
       * 置いた当初の top:45px は**コイン札（top:18px・高さ約40px＝下端58px）の下敷き**で、
       * 携帯幅（top:38px）では**1文字も見えていなかった**。append の順もコインが後なので上に乗る。
       * ★**このコメントは CSS のテンプレートリテラルの中**なので、バッククォートを書くと
       *   そこで文字列が終わる（2026-09-11 に実際にやって typecheck が赤になった）。使わないこと。
       * ★**2026-08-23 に札そのものが同じ事故を起こした場所**で、すぐ上のコメントがそれを警告している。
       * 2度目をやったので、**今度は数字で空きを出してから置いた**:
       *   札 = 20本 ÷ 5個 = 4段、1段14px・段間7px → 高さ 4*14 + 3*7 = 77px
       *   PC   札 top:66px → 下端 143px → **150px は空き**
       *   携帯 札 top:58px → 下端 135px → **142px は空き**
       * （右上は人数、上中央は敵の人数で埋まっている。左の縦一列だけが空いている）
       */
      .hud-lvnum { top:150px; left:19px; font-size:15px; font-weight:900;
                   color:${INK}; letter-spacing:.06em; }

      /* ============ 4. 敵の人数（上中央・出ているときだけ）============ */
      .hud-boss { top:22px; left:50%; transform:translateX(-50%);
                  display:none; align-items:center; gap:8px;
                  padding:5px 14px 5px 11px; border-radius:999px;
                  background:${STAMP}; border:4px solid ${INK}; color:${PAPER};
                  box-shadow:0 4px 0 rgba(58,47,39,.22); }
      .hud-boss.on { display:flex; }
      .hud-boss i { display:block; position:relative; width:13px; height:19px; }
      .hud-boss i::before { content:''; position:absolute; left:2px; top:0;
                  width:8px; height:8px; border-radius:50%; background:${PAPER}; }
      .hud-boss i::after { content:''; position:absolute; left:0; bottom:0;
                  width:13px; height:11px; border-radius:5px 5px 2px 2px; background:${PAPER}; }
      .hud-boss b { font-size:26px; font-weight:900; line-height:1;
                    font-variant-numeric:tabular-nums; }

      /* ============ 5. コインの総量（左上）============
         人数（右上）と**左右に離す**。同じ側に置くと数字が2つ並んで、
         どちらが「今の人数」か一瞬迷う。役割が違う数字は離す。
         人数より一回り小さく、金色を面で入れて「別の種類の数字」だと分からせる */
      .hud-coins { top:18px; left:18px; display:flex; align-items:center; gap:7px;
                   padding:5px 14px 5px 8px; border-radius:999px;
                   background:${PAPER}; border:4px solid ${INK};
                   box-shadow:0 4px 0 rgba(58,47,39,.22); }
      .hud-coins i { display:block; width:19px; height:19px; border-radius:50%;
                     background:${GOLD}; border:3px solid ${GOLD_DARK}; box-sizing:border-box; }
      .hud-coins b { font-size:22px; font-weight:900; line-height:1;
                     font-variant-numeric:tabular-nums; }

      /* --- 操作のヒント。最初の入力で消える（§3: 文章のチュートリアルは出さない） --- */
      .hud-hint { bottom:34px; left:50%; transform:translateX(-50%);
                  font-size:26px; opacity:.34; letter-spacing:1.4em;
                  transition:opacity .4s; }

      /* --- 開発用。既定では隠す（本番の画面に出す物ではない） --- */
      .hud-dev { display:none; }
      .hud.dev { display:block; }
      .hud-fps { bottom:6px; left:8px; font-size:10px; opacity:.3; }
      .hud-drawn { bottom:6px; left:60px; font-size:10px; opacity:.3; }

      @media (max-width: 560px) {
        .hud-count { padding:5px 12px 5px 9px; }
        .hud-count b { font-size:27px; }
        .hud-boss b { font-size:21px; }
        .hud-tabs { top:58px; }
        .hud-lvnum { top:142px; font-size:13px; }
        .hud-coins { padding:4px 11px 4px 7px; }
        .hud-coins b { font-size:18px; }
      }
    `;
    parent.appendChild(style);

    const bar = el('hud hud-bar', '<i></i>');
    this.bar = bar.querySelector('i') as HTMLElement;

    this.lvNum = el('hud hud-lvnum', 'Lv 1');
    this.tabs = el('hud hud-tabs', '');
    // 公開版では札は「いまどこか」を見せるだけ。押せる見た目にもしない
    if (!import.meta.env.DEV) this.tabs.style.pointerEvents = 'none';
    this.tabs.addEventListener('pointerdown', (e) => {
      const lv = (e.target as HTMLElement)?.dataset?.lv;
      if (lv !== undefined) { e.stopPropagation(); this.onPickLevel?.(Number(lv)); }
    });

    this.stamp = el('hud hud-count', '<i></i><b>0</b>');
    this.stampNum = this.stamp.querySelector('b') as HTMLElement;

    this.boss = el('hud hud-boss', '<i></i><b>0</b>');
    this.bossNum = this.boss.querySelector('b') as HTMLElement;

    this.coins = el('hud hud-coins', '<i></i><b>0</b>');
    this.coinNum = this.coins.querySelector('b') as HTMLElement;

    // §3: テキストチュートリアル禁止。矢印だけで「左右」を教える
    this.hint = el('hud hud-hint', '◀ ▶');

    this.fps = el('hud hud-dev hud-fps', '');
    this.drawnNote = el('hud hud-dev hud-drawn', '');

    parent.append(bar, this.lvNum, this.tabs, this.stamp, this.boss, this.coins, this.hint, this.fps, this.drawnNote);
  }

  /** 何本目かを札で示す。押すとそのステージへ飛べる */
  setLevel(index: number, total: number): void {
    this.lvNum.textContent = `Lv ${index + 1}`;
    this.tabs.innerHTML = Array.from({ length: total }, (_, i) =>
      `<i data-lv="${i}" class="${i < index ? 'done' : i === index ? 'now' : ''}"></i>`,
    ).join('');
  }

  /** ボスの残り人数。**null ＝ 出ていない**（§4-F） */
  setBoss(hp: number | null): void {
    this.boss.classList.toggle('on', hp !== null);
    if (hp !== null) this.bossNum.textContent = `${Math.ceil(hp)}`;
  }

  /**
   * コインの総量。**貯まっている総数 ＋ この走行で拾った分**を出す。
   *
   * ★ 一度これを空にしたのは私の判断ミス（2026-08-23 本人が指摘）。
   * 「走行中に見ても行動が変わらない」と考えて消したが、
   * 本人は前から「たまったコインは数値表現した方がいい」と言っていた。
   * **貯まっていくのを見ること自体が目的**なので、行動が変わるかは関係なかった。
   *
   * 同じ値で呼ばれたら DOM を触らない（毎フレーム呼ばれるので）。
   */
  setCoins(n: number): void {
    const v = Math.max(0, Math.round(n));
    if (v === this.dispCoins) return;
    this.dispCoins = v;
    this.coinNum.textContent = `${v}`;
  }

  update(dt: number, distance: number, touched: boolean, count: number, drawn: number, length: number, over = 0): void {
    this.bar.style.width = `${(Math.min(1, distance / length) * 100).toFixed(1)}%`;

    // 瞬間ワープ禁止（§5）: 数フレームかけて転がるように追従させる
    const k = Math.min(1, dt * 24);
    /*
     * ★**桁が大きいときは「桁」で転がす**（2026-09-26・理系用の上限撤廃）。
     * 10³⁰⁰ → 5 人をそのまま線形に寄せると、1フレームに 4割ずつしか縮まず**20秒以上**数字が落ち続ける。
     * ★10³⁰⁰ を越えた人数（`over > 0`）は数として持てないので、**表示は桁（`dispL`）だけで持つ**
     */
    const targetL = Math.log10(Math.max(0, count) + 1) + over;
    let shownL: number;
    let text: string;
    if (Math.max(targetL, this.dispL) > 6) {
      this.dispL += (targetL - this.dispL) * k;
      if (Math.abs(targetL - this.dispL) < Math.max(1e-4, Math.abs(targetL) * 1e-6)) this.dispL = targetL;
      this.dispCount = this.dispL > 300 ? 1e300 : 10 ** this.dispL - 1;
      shownL = this.dispL;
      text = this.dispL > 6 ? fmtLog(this.dispL) : fmtCount(this.dispCount);
    } else {
      this.dispCount += (count - this.dispCount) * k;
      if (Math.abs(count - this.dispCount) < 0.5) this.dispCount = count;
      this.dispL = Math.log10(Math.max(0, this.dispCount) + 1);
      shownL = Math.log10(Math.round(this.dispCount) + 1);
      text = fmtCount(this.dispCount);
    }
    if (text !== this.lastText) {
      const had = this.lastShown >= 0;
      const prevL = this.lastShown;
      // 増えたときだけ弾む。減るのは祝う場面ではない（§4-G）
      if (had && shownL > prevL) this.punch = 0.11;
      /*
       * ★★**減ったときは赤く弾ませる**（2026-09-15・本人指定）。
       * 本人:「**HUD の人数を、減った瞬間に赤く弾ませる。これはありかな。
       * 画面全体だとうるさいけど、これくらいならいい**」。
       * ★**画面全体のフラッシュは入れない**（うるさい）。**減った数も出さない**（本人が「やめて」と言った）。
       * ★§4-G の「減るのは祝う場面ではない」は今も正しいので、
       * **祝う弾み方（膨らむ）ではなく、赤くして少し縮める**。
       */
      if (had && shownL < prevL) this.loss = LOSS_HOLD;
      this.stampNum.textContent = text;
      this.lastText = text;
      // ★比べるのは桁（log₁₀(人数+1)）。0人でも 0 なので「まだ書いていない」(−1) と区別できる
      this.lastShown = shownL;
    }
    if (this.loss > 0) {
      this.loss -= dt;
      const u = Math.max(0, this.loss / LOSS_HOLD);
      this.stampNum.style.color = LOSS_RED;
      this.stamp.style.transform = `scale(${(1 - 0.055 * u).toFixed(3)})`;
    } else if (this.punch > 0) {
      this.punch -= dt;
      if (this.stampNum.style.color !== '') this.stampNum.style.color = '';
      this.stamp.style.transform = 'scale(1.10)';
    } else {
      if (this.stampNum.style.color !== '') this.stampNum.style.color = '';
      this.stamp.style.transform = 'scale(1)';
    }

    this.drawnNote.textContent = drawn < count ? `draw ${drawn}` : '';
    if (touched) this.hint.style.opacity = '0';

    this.acc += dt;
    this.frames++;
    if (this.acc >= 0.5) {
      this.fps.textContent = `${Math.round(this.frames / this.acc)} fps`;
      this.acc = 0;
      this.frames = 0;
    }
  }
}

function el(cls: string, html: string): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  return d;
}
