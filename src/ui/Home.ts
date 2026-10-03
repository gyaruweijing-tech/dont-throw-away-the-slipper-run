/**
 * ★★**ホーム画面（＝タイトル画面）**（2026-09-16・本人が設計を採用）。
 *
 * 醸し出す感じ: **「くだらない使命に、大まじめで出発する朝」**。
 * 背景は止めた 3D のまま（下駄箱の廊下・主人公の後ろ姿・掲げたスリッパ）。ここは**上に乗る DOM だけ**。
 *
 * 決めたこと（本人）:
 *  - ホームはタイトルを兼ねる（1枚）
 *  - **文字は普通に使う**
 *  - スリッパを買う／履き替える場所は「**下駄箱**」（「工房」はやめた。本人「工房って何」）
 *  - ステージ選びは**普通に「ステージ」**（下駄箱に見立てない）
 */
import { mathHelpSections, MODE_LIST, type GameMode } from '../config';
import { gateLabel, MATH_HELP, MATH_USES_V } from '../entities/gateOps';

const INK = '#3a2f27';
const PAPER = '#fffdf6';
const STAMP = '#e0453a';
const GOLD = '#f2b632';
const GOLD_DARK = '#c8892a';

export interface HomeData {
  /** つづきから始めるステージ（0 始まり） */
  level: number;
  /** 選べる最後のステージ（0 始まり） */
  maxLevel: number;
  levels: number;
  coins: number;
  /** 下駄箱で買えるものがあるか */
  canShop: boolean;
  /** いま選んでいるモード（2026-09-20） */
  mode: GameMode;
  /** ★まだ1本もクリアしていない（2026-09-29）。「つづきから」ではなく「はじめる」を出す */
  fresh: boolean;
  /** 音を切っているか（2026-09-29） */
  muted: boolean;
}

/** 説明書の例に使うつまみ。**実機で出る値**にする（`gcd(n,7)` のように） */
const EXAMPLE_V: Partial<Record<string, number>> = {
  pow: 2, log: 2, deriv: 2, integ: 1, gcd: 7, lcm: 7, mod2: 7, xor: 7, and: 7, or: 7, shl: 1, shr: 1,
};

/** 札の字をそのまま HTML に入れるので、記号を逃がす */
const esc = (v: string): string => v.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));

/** 音の札。★押すと「いまの状態」が変わるので、字は状態そのものを書く（🔊 音あり／🔇 音なし） */
const muteLabel = (muted: boolean): string => (muted ? '🔇 音なし' : '🔊 音あり');
const muteBtn = (muted: boolean): string =>
  `<button class="hm-mute" type="button" aria-pressed="${muted}" aria-label="音">${muteLabel(muted)}</button>`;

export class Home {
  private readonly root: HTMLElement;
  onPlay?: () => void;
  onPickStage?: (index: number) => void;
  onShop?: () => void;
  onPickMode?: (mode: GameMode) => void;
  /** 音の入り切り（2026-09-29）。新しい状態を返す */
  onToggleMute?: () => boolean;
  /** 押したときの音（Game が鳴らす） */
  onTap?: () => void;

  constructor(private readonly host: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = `
      /* ★ホーム・下駄箱が出ているあいだは走行の HUD を隠す */
      .sr-menu .hud { visibility:hidden; }
      .hm-root { position:absolute; inset:0; z-index:60; display:flex; flex-direction:column;
                 justify-content:space-between; align-items:center; padding:18px 16px 22px;
                 box-sizing:border-box; font-family:"Segoe UI",system-ui,sans-serif; color:${INK};
                 pointer-events:none; opacity:0; transition:opacity .35s;
                 background:linear-gradient(rgba(239,233,220,.0) 55%, rgba(58,47,39,.28)); }
      .hm-root.on { opacity:1; }
      .hm-root.on > * { pointer-events:auto; }

      /* ============ 題字（紙に刷ったタイトル＋判子）============ */
      .hm-title { position:relative; width:min(100%,440px); box-sizing:border-box; padding:16px 18px 14px;
                  background:${PAPER}; border:5px solid ${INK}; border-radius:6px;
                  box-shadow:0 8px 0 rgba(58,47,39,.25); transform:rotate(-1.2deg);
                  animation:hm-in .5s cubic-bezier(.2,1.2,.3,1) both; }
      .hm-title h1 { margin:0; font-size:clamp(26px,7.4vw,40px); line-height:.95; font-weight:900;
                     letter-spacing:.5px; }
      .hm-title h1 span { display:block; font-size:.62em; color:${STAMP}; margin-top:4px; }
      /* ★右下の判子（86px・右に -14px はみ出す）の下に副題が潜らないよう、判子の幅ぶん空ける（2026-09-29） */
      .hm-title p { margin:8px 0 0; padding-right:66px; font-size:14px; font-weight:800; opacity:.75; }
      .hm-seal { position:absolute; right:-14px; bottom:-26px; width:86px; height:86px; border-radius:50%;
                 border:5px solid ${STAMP}; color:${STAMP}; background:rgba(224,69,58,.08);
                 display:flex; align-items:center; justify-content:center; text-align:center;
                 font-size:19px; font-weight:900; line-height:1.05; transform:rotate(-16deg);
                 animation:hm-seal .45s .55s cubic-bezier(.2,.9,.25,1) both; }
      .hm-seal::before { content:''; position:absolute; inset:6px; border-radius:50%;
                         border:2px solid ${STAMP}; opacity:.5; }
      @keyframes hm-in { 0% { transform:translateY(-30px) rotate(-6deg); opacity:0 }
                         100% { transform:rotate(-1.2deg); opacity:1 } }
      @keyframes hm-seal { 0% { transform:rotate(-30deg) scale(2.4); opacity:0 }
                           60% { transform:rotate(-16deg) scale(.9); opacity:1 }
                           100% { transform:rotate(-16deg) scale(1); opacity:.95 } }

      /* ============ 下の操作盤 ============ */
      .hm-panel { width:min(100%,440px); display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      .hm-btn { cursor:pointer; font-family:inherit; color:${INK}; background:${PAPER};
                border:4px solid ${INK}; border-radius:14px; box-shadow:0 6px 0 rgba(58,47,39,.32);
                padding:10px 8px; font-size:20px; font-weight:900; line-height:1.1;
                transition:transform .08s, box-shadow .08s; }
      .hm-btn:active { transform:translateY(5px); box-shadow:0 1px 0 rgba(58,47,39,.32); }
      .hm-btn small { display:block; font-size:12px; font-weight:800; opacity:.72; margin-top:3px; }
      .hm-play { grid-column:1 / -1; background:${GOLD}; font-size:30px; padding:16px 8px;
                 animation:hm-pulse 1.4s ease-in-out infinite; }
      .hm-play small { font-size:15px; opacity:.8; }
      .hm-shop.glow { background:#ffe7a3; }
      .hm-coin { display:inline-block; width:14px; height:14px; box-sizing:border-box; border-radius:50%;
                 background:${GOLD}; border:3px solid ${GOLD_DARK}; vertical-align:-2px; margin-right:3px; }
      @keyframes hm-pulse { 50% { transform:scale(1.025) } }

      /* ============ ステージ選び ============ */
      .hm-stages { position:absolute; inset:0; z-index:2; display:flex; align-items:center; justify-content:center;
                   background:rgba(58,47,39,.4); padding:0 16px; }
      .hm-stages[hidden] { display:none; }
      .hm-sheet { width:min(100%,420px); background:${PAPER}; border:5px solid ${INK}; border-radius:16px;
                  padding:16px; box-sizing:border-box; box-shadow:0 8px 0 rgba(58,47,39,.3); }
      .hm-sheet h2 { margin:0 0 12px; font-size:24px; font-weight:900; text-align:center; }
      .hm-grid { display:grid; grid-template-columns:repeat(5, 1fr); gap:8px; }
      .hm-st { position:relative; aspect-ratio:1; cursor:pointer; font-family:inherit; font-size:20px; font-weight:900;
               color:${INK}; background:${PAPER}; border:3px solid ${INK}; border-radius:10px; padding:0;
               box-shadow:0 3px 0 rgba(58,47,39,.3); }
      .hm-st.done { background:#e9e1cf; }
      .hm-st.now { background:${GOLD}; }
      .hm-st.boss::after { content:'BOSS'; position:absolute; left:50%; bottom:-7px; transform:translateX(-50%);
                           font-size:9px; padding:1px 4px; border-radius:4px; background:${STAMP}; color:${PAPER}; }
      .hm-st:disabled { opacity:.35; cursor:default; box-shadow:none; }
      .hm-back { display:block; width:100%; margin-top:16px; }
      /* ★モードの3枚札（2026-09-20）。横1列・親指で押せる高さ */
      /*
       * ★★**見出しと札を横いっぱいに**（2026-09-29）。前は操作盤の2列グリッドの1マスずつに入っていて、
       * 札が右半分に3枚押し込まれていた ＝ 960×540 で説明文が読めない大きさだった
       */
      .hm-modes { grid-column:1 / -1; display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
      .hm-mode { cursor:pointer; font-family:inherit; font-weight:900; font-size:16px;
        color:${INK}; background:${PAPER}; border:2px solid ${INK}; border-radius:10px;
        padding:8px 4px; line-height:1.25; text-align:center;
        box-shadow:0 3px 0 rgba(58,47,39,.32); }
      .hm-mode small { display:block; font-size:12px; font-weight:800; opacity:.72; margin-top:2px; }
      .hm-mode[aria-pressed="true"] { background:${STAMP}; color:${PAPER}; border-color:${STAMP}; }
      /* ★準備中は押せない。押せる見た目のまま押せないのが一番たちが悪い */
      .hm-mode[disabled] { cursor:default; opacity:.42; box-shadow:none; }
      .hm-modes-cap { grid-column:1 / -1; display:flex; justify-content:space-between; align-items:center;
                      font-size:13px; font-weight:800; margin-top:2px; }
      /* 見出しは道（暗い床）の上に乗るので、紙の札にして読めるようにする */
      .hm-modes-cap > span { background:${PAPER}; border:2px solid ${INK}; border-radius:999px; padding:3px 10px; }
      /* ★音の入り切り（2026-09-29）。見出しの行の右端に置き、操作盤の高さを増やさない */
      .hm-mute { cursor:pointer; font-family:inherit; font-size:13px; font-weight:900; color:${INK};
                 background:${PAPER}; border:2px solid ${INK}; border-radius:999px; padding:4px 12px;
                 box-shadow:0 2px 0 rgba(58,47,39,.32); }
      .hm-mute[aria-pressed="true"] { background:#e9e1cf; }
      /* ★説明書（2026-09-21）。理系用を選んでいるときだけ出す */
      .hm-help-btn { display:block; width:100%; margin-top:8px; }
      /*
       * ★hm-back を付け回さない（2026-09-21）。q() は querySelector なので
       * 最初の1つしか返さない。説明書はステージ表より前に置かれるため、
       * ★hm-back を共有すると「ステージをえらぶ」の「もどる」が動かなくなる
       */
      .hm-help-close { display:block; width:100%; margin-top:16px; }
      .hm-help { position:fixed; inset:0; background:rgba(58,47,39,.55); z-index:40;
        display:flex; align-items:center; justify-content:center; padding:16px; }
      /*
       * ★★★これが無いと、説明書が画面全体を覆ったまま消えない（2026-09-21・本人の実機）。
       *
       * hidden 属性が付ける display:none は「ブラウザ既定のスタイル」なので、
       * ★こちらが書いた display:flex のほうが強い。属性は付いているのに見えたままになる。
       * ★position:fixed + inset:0 なので画面全部を塞ぎ、「ゲームすら始められない」状態だった。
       * ★すぐ上の .hm-stages[hidden] は同じ対策を最初から書いてある ――
       * 同じ罠が同じファイルの 40行上にあったのに、真似しなかった。
       */
      .hm-help[hidden] { display:none; }
      .hm-help-sheet { background:${PAPER}; border:3px solid ${INK}; border-radius:14px;
        width:100%; max-width:520px; max-height:82vh; overflow-y:auto; padding:18px 16px 16px;
        -webkit-overflow-scrolling:touch; }
      .hm-help-sheet h2 { font-size:17px; font-weight:900; color:${INK}; text-align:center; margin-bottom:4px; }
      .hm-help-sheet p.lead { font-size:11px; font-weight:700; opacity:.66; text-align:center; margin-bottom:12px; }
      .hm-help-sheet h3 { font-size:13px; font-weight:900; color:${PAPER}; background:${INK};
        border-radius:6px; padding:4px 8px; margin:14px 0 8px; }
      .hm-help-sheet h3 span { font-weight:800; opacity:.7; font-size:11px; }
      .hm-card { border-bottom:1px dashed rgba(58,47,39,.26); padding:7px 2px; }
      .hm-card:last-child { border-bottom:0; }
      .hm-card b { display:inline-block; font-size:15px; font-weight:900; color:${STAMP};
        min-width:96px; margin-right:6px; }
      .hm-card i { font-style:normal; font-size:12px; font-weight:800; color:${INK}; }
      .hm-card u { display:block; text-decoration:none; font-size:11px; font-weight:700;
        opacity:.72; margin-top:2px; }
      .hm-card u em { font-style:normal; color:${STAMP}; font-weight:900; }
      @media (prefers-reduced-motion: reduce) {
        .hm-title, .hm-seal, .hm-play { animation:none; }
      }
    `;
    host.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'hm-root';
    host.appendChild(this.root);
  }

  show(d: HomeData): void {
    const boss = (i: number) => (i + 1) % 5 === 0;
    const cells = Array.from({ length: d.levels }, (_, i) => {
      const cls = [i === d.level ? 'now' : i < d.maxLevel ? 'done' : '', boss(i) ? 'boss' : ''].join(' ');
      return `<button class="hm-st ${cls}" data-i="${i}" type="button" ${i > d.maxLevel ? 'disabled' : ''}>${i + 1}</button>`;
    }).join('');
    /*
     * ★**モードの札**（2026-09-20）。**3枚を必ず出す。**
     * 準備中の「数学ボケ」も出すのは、**何が来るかが見えているほうが期待が持てる**ため。
     * ただし `disabled` にして押せなくする ―― 押せる見た目で押せないのが一番たちが悪い
     */
    const modes = MODE_LIST.map((m) => {
      const on = m.id === d.mode;
      return `<button class="hm-mode" type="button" data-m="${m.id}" aria-pressed="${on}"`
        + `${m.ready ? '' : ' disabled'}>${m.name}<small>${m.blurb}</small></button>`;
    }).join('');
    /*
     * ★**説明書の中身**（2026-09-21・本人「next pってなんだ...? ってなることがある」）。
     * ★**区画の定義からそのまま作る**ので、区画を変えれば説明書も自動で変わる。
     * ★**情報科学の札は区画に入っていない**ので、ここにも出ない
     */
    const help = d.mode !== 'math' ? '' : mathHelpSections().map((sec) => {
      const rows = sec.ops.map((op) => {
        const h = MATH_HELP[op];
        // 札の見た目は実物と同じ関数で作る（説明書と実機で別の字が出ないように）
        const label = gateLabel({ op, v: MATH_USES_V.has(op) ? EXAMPLE_V[op] ?? 7 : 0 });
        return `<div class="hm-card"><b>${esc(label)}</b><i>${esc(h.name)}</i>`
          + `<u>${esc(h.desc)}<br><em>例</em> ${esc(h.ex)}</u></div>`;
      }).join('');
      return `<h3>${esc(sec.name)} <span>${esc(sec.range)}</span></h3>${rows}`;
    }).join('');

    this.root.innerHTML = `
      <div class="hm-title">
        <h1>DON'T THROW AWAY THE SLIPPER<span>-run-</span></h1>
        <p>スリッパを捨てるな。仲間を集めて、城まで走れ。</p>
        <div class="hm-seal">捨て<br>るな</div>
      </div>
      <div class="hm-panel">
        <button class="hm-btn hm-play" type="button">▶ ${d.fresh ? 'はじめる' : 'つづきから'}<small>STAGE ${d.level + 1}${boss(d.level) ? '（ボス）' : ''}</small></button>
        <button class="hm-btn hm-shop ${d.canShop ? 'glow' : ''}" type="button">下駄箱<small><i class="hm-coin"></i>${d.coins.toLocaleString()}${d.canShop ? '・買える！' : ''}</small></button>
        <button class="hm-btn hm-stage" type="button">ステージ<small>${d.maxLevel + 1} / ${d.levels}</small></button>
        <div class="hm-modes-cap"><span>むずかしさ</span>${muteBtn(d.muted)}</div>
        <div class="hm-modes">${modes}</div>
        ${d.mode === 'math' ? '<button class="hm-btn hm-help-btn" type="button">説明書<small>出てくる数式の意味</small></button>' : ''}
      </div>
      ${d.mode === 'math' ? `<div class="hm-help" hidden><div class="hm-help-sheet">
        <h2>数式の説明書</h2>
        <p class="lead">ゲートの札に出てくる式。n ＝ いまの人数</p>
        ${help}
        <button class="hm-btn hm-help-close" type="button">とじる</button>
      </div></div>` : ''}
      <div class="hm-stages" hidden>
        <div class="hm-sheet">
          <h2>ステージをえらぶ</h2>
          <div class="hm-grid">${cells}</div>
          <button class="hm-btn hm-back" type="button">もどる</button>
        </div>
      </div>
    `;
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    const stages = q('.hm-stages');
    q('.hm-play').addEventListener('click', () => { this.onTap?.(); this.onPlay?.(); });
    q('.hm-shop').addEventListener('click', () => { this.onTap?.(); this.onShop?.(); });
    q('.hm-stage').addEventListener('click', () => { this.onTap?.(); stages.hidden = false; });
    q('.hm-back').addEventListener('click', () => { this.onTap?.(); stages.hidden = true; });
    if (d.mode === 'math') {
      const help = q('.hm-help');
      q('.hm-help-btn').addEventListener('click', () => { this.onTap?.(); help.hidden = false; });
      q('.hm-help-close').addEventListener('click', () => { this.onTap?.(); help.hidden = true; });
      // ★幕の外を押しても閉じる（スマホで「とじる」まで指を伸ばさなくていい）
      help.addEventListener('click', (e) => { if (e.target === help) help.hidden = true; });
    }
    const mute = q('.hm-mute');
    mute.addEventListener('click', () => {
      const m = this.onToggleMute?.() ?? false;
      mute.setAttribute('aria-pressed', String(m));
      mute.textContent = muteLabel(m);
      // 入れたときだけ鳴らす（「音が戻った」が耳で分かる）
      if (!m) this.onTap?.();
    });
    q('.hm-modes').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('.hm-mode') as HTMLButtonElement | null;
      if (!b || b.disabled) return;
      this.onTap?.();
      this.onPickMode?.(b.dataset.m as GameMode);
    });
    q('.hm-grid').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('.hm-st') as HTMLButtonElement | null;
      if (!b || b.disabled) return;
      this.onTap?.();
      this.onPickStage?.(Number(b.dataset.i));
    });
    this.root.classList.add('on');
    this.host.classList.add('sr-menu');
  }

  get visible(): boolean {
    return this.root.classList.contains('on');
  }

  hide(): void {
    this.root.classList.remove('on');
    this.root.innerHTML = '';
    this.host.classList.remove('sr-menu');
  }
}
