import { fmtBig } from '../entities/gateOps';
/**
 * ★★**リザルト**（2026-09-16 作り直し・本人指定）。
 *
 * 参考画像（`assets/ref/11-result-roulette.png`）の形:
 * **青いリボンの VICTORY ＋ 獲得コイン → 横一列の倍率バー（×2 ×3 ×5 ×3 ×2）→ CONTINUE**。
 * 本家の倍率は**動画広告と引き換え**だが、こちらは広告なし（本人）。
 * ★**往復する針をタップで止める運試し**（本人が選択）。★**針はスリッパ**（本人）。★**損はしない**（最低×2）。
 *
 * ★**文字を使う**（2026-09-16・本人「リザルトはわかりづらいから文字を足していこう」）。
 * 前の版は §4-I の「文字ゼロ」で数字とアイコンだけだった。
 *
 * ★**コインは出した時点で基本ぶんを保存済み**（`Game.showResult`）。
 * ルーレットは**上乗せぶんだけ**を後から足す ＝ 止める前に閉じても、基本ぶんは消えない
 */
const INK = '#3a2f27';
const PAPER = '#fffdf6';
const STAMP = '#e0453a';
const GOLD = '#f2b632';
const GOLD_DARK = '#c8892a';

/** 倍率の並びと、それぞれの幅（合計 1）。★真ん中の×5 は狭い ＝ 狙って止めるご褒美 */
const SEGS: readonly { mult: number; w: number; color: string }[] = [
  { mult: 2, w: 0.24, color: '#e4573f' },
  { mult: 3, w: 0.2, color: '#f2c53a' },
  { mult: 5, w: 0.12, color: '#5cb85c' },
  { mult: 3, w: 0.2, color: '#f2c53a' },
  { mult: 2, w: 0.24, color: '#e4573f' },
];
/** 針が端から端まで行く秒数 */
const SWEEP = 0.62;

export interface ResultData {
  /** 勝ったか（ボスを倒した／ゴールに人を連れてきた）。**負けた回はルーレットを出さない** */
  won: boolean;
  /** ボス回か */
  boss: boolean;
  /** 集めた人数 */
  count: number;
  /** ★10³⁰⁰ を越えた桁（理系用）。省略は 0 */
  countOver?: number;
  /** 非ボス回の扉の人数（ボス回は null） */
  target: number | null;
  door: boolean;
  /** 基本のコイン（拾ったぶん込み）。**保存済み** */
  base: number;
  picked: number;
  /** 基本ぶんを足したあとの所持コイン */
  total: number;
  level: number;
  levels: number;
  best: boolean;
  /** 下駄箱で買えるものがあるか（ボタンを光らせる） */
  canShop: boolean;
}

export class Result {
  private readonly root: HTMLElement;
  private readonly sheet: HTMLElement;
  onRetry?: () => void;
  onNext?: () => void;
  onHome?: () => void;
  onShop?: () => void;
  /** ★ルーレットが止まった。**上乗せぶん（base × (mult−1)）を足すのは Game** */
  onRoulette?: (mult: number) => void;
  onStamp?: () => void;
  onTick?: () => void;
  private raf = 0;
  private spinning = false;
  private p = 0;
  private dir = 1;
  private last = 0;
  private data: ResultData | null = null;

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = `
      /* ★背の低い画面でもボタンまで届くように、はみ出したら縦に流す（sheet の margin:auto で中央寄せ） */
      .rs-root { position:absolute; inset:0; display:flex; z-index:70; overflow-y:auto;
                 background:rgba(58,47,39,.30); padding-block:48px 16px; box-sizing:border-box;
                 opacity:0; pointer-events:none; transition:opacity .3s;
                 font-family:"Segoe UI",system-ui,sans-serif; padding-inline:16px; }
      .rs-root.on { opacity:1; pointer-events:auto; }
      .rs-sheet { position:relative; margin:auto; width:min(100%,380px); padding:84px 20px 18px;
                  background:${PAPER}; color:${INK}; border:5px solid ${INK}; border-radius:16px;
                  box-shadow:0 10px 0 rgba(58,47,39,.28);
                  transform:translateY(14px) scale(.97); transition:transform .3s cubic-bezier(.2,.9,.3,1); }
      .rs-root.on .rs-sheet { transform:none; }

      /* ============ リボン ============ */
      .rs-ribbon { position:absolute; left:50%; top:-34px; transform:translateX(-50%);
                   width:min(108%,400px); text-align:center; padding:10px 0 12px;
                   background:${STAMP}; color:${PAPER}; border:5px solid ${INK}; border-radius:12px;
                   box-shadow:0 6px 0 rgba(58,47,39,.3); animation:rs-drop .45s cubic-bezier(.2,1.4,.3,1) both; }
      .rs-ribbon.door { background:linear-gradient(${GOLD}, #e0a93a); color:${INK}; }
      .rs-ribbon.lost { background:#8d8173; }
      .rs-ribbon b { display:block; font-size:40px; font-weight:900; letter-spacing:2px; line-height:1;
                     -webkit-text-stroke:2px ${INK}; paint-order:stroke fill; }
      .rs-ribbon.door b { -webkit-text-stroke:0; }
      .rs-ribbon span { display:inline-flex; align-items:center; gap:6px; margin-top:4px;
                        font-size:24px; font-weight:900; font-variant-numeric:tabular-nums; }
      @keyframes rs-drop { 0% { transform:translate(-50%,-40px) scale(1.3); opacity:0 }
                           100% { transform:translate(-50%,0) scale(1); opacity:1 } }

      .rs-coin { display:inline-block; width:22px; height:22px; box-sizing:border-box; border-radius:50%;
                 background:${GOLD}; border:4px solid ${GOLD_DARK}; vertical-align:middle; }

      .rs-stage { text-align:center; font-size:15px; font-weight:800; opacity:.7; margin-bottom:8px; }

      /* ============ 行 ============ */
      .rs-row { display:flex; align-items:baseline; gap:10px; padding:7px 2px;
                border-bottom:2px dashed rgba(58,47,39,.22); font-size:16px; font-weight:800; }
      .rs-row b { margin-left:auto; font-size:24px; font-weight:900; font-variant-numeric:tabular-nums; }
      .rs-row span small { display:block; font-size:11px; font-weight:800; opacity:.7; margin-top:1px; }
      .rs-row em { font-style:normal; font-size:13px; padding:2px 8px; border-radius:6px;
                   background:${STAMP}; color:${PAPER}; }
      .rs-row.gold em { background:${GOLD}; color:${INK}; }

      /* ============ ルーレット ============ */
      .rs-roul { margin:16px 0 4px; }
      .rs-bar { position:relative; display:flex; height:44px; border:4px solid ${INK}; border-radius:10px;
                overflow:visible; cursor:pointer; margin-top:46px; }
      .rs-seg { display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:900;
                color:${INK}; border-right:3px solid ${INK}; transition:filter .2s, transform .2s; }
      .rs-seg:first-child { border-radius:6px 0 0 6px; }
      .rs-seg:last-child { border-right:0; border-radius:0 6px 6px 0; }
      .rs-bar.done .rs-seg { filter:saturate(.35) brightness(1.1); }
      .rs-bar.done .rs-seg.hit { filter:none; transform:scaleY(1.18); z-index:1; box-shadow:0 0 0 3px ${INK}; }
      /* 針 ＝ スリッパ（上から差す）。つま先が下 */
      /* ★針は**履いているスリッパの絵そのもの**（2026-09-16・スリッパ60種）。かかとを下にして差す */
      .rs-needle { position:absolute; top:-46px; left:0; width:26px; height:56px; margin-left:-13px;
                   pointer-events:none; }
      .rs-needle i { position:absolute; inset:0; background:var(--sl) center / contain no-repeat;
                     transform:rotate(180deg); }
      .rs-stop { display:block; width:100%; margin-top:12px; padding:14px 0; cursor:pointer;
                 font-family:inherit; font-size:22px; font-weight:900; color:${INK}; background:${GOLD};
                 border:4px solid ${INK}; border-radius:12px; box-shadow:0 5px 0 rgba(58,47,39,.3);
                 animation:rs-pulse .9s ease-in-out infinite; }
      .rs-stop[hidden] { display:none; }
      .rs-stop:active { transform:translateY(4px); box-shadow:0 1px 0 rgba(58,47,39,.3); }
      .rs-stop small { display:block; font-size:12px; font-weight:800; opacity:.7; margin-top:2px; }
      @keyframes rs-pulse { 50% { transform:scale(1.03) } }
      .rs-mult { text-align:center; font-size:34px; font-weight:900; color:${STAMP}; height:0; margin-top:8px;
                 opacity:0; transform:scale(2); transition:opacity .2s, transform .3s cubic-bezier(.2,1.4,.3,1); }
      .rs-mult.on { opacity:1; height:auto; transform:scale(1); }

      /* ============ ボタン ============ */
      .rs-btns { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:16px; }
      .rs-btns[hidden] { display:none; }
      .rs-btn { padding:12px 0; cursor:pointer; border:4px solid ${INK}; border-radius:12px;
                font-family:inherit; font-size:18px; font-weight:900; line-height:1.1; color:${INK};
                background:${PAPER}; box-shadow:0 5px 0 rgba(58,47,39,.3);
                transition:transform .08s, box-shadow .08s; }
      .rs-btn:active { transform:translateY(4px); box-shadow:0 1px 0 rgba(58,47,39,.3); }
      .rs-next { grid-column:1 / -1; background:${GOLD}; font-size:24px; padding:14px 0; }
      .rs-shop.glow { background:#ffe7a3; animation:rs-pulse .9s ease-in-out infinite; }
      .rs-shop small { display:block; font-size:11px; font-weight:800; color:${STAMP}; }
      @media (prefers-reduced-motion: reduce) {
        .rs-sheet, .rs-ribbon, .rs-stop, .rs-shop.glow { transition:none; animation:none; }
      }
    `;
    parent.appendChild(style);

    this.root = document.createElement('div');
    this.root.className = 'rs-root';
    this.sheet = document.createElement('div');
    this.sheet.className = 'rs-sheet';
    this.root.appendChild(this.sheet);
    parent.appendChild(this.root);
    addEventListener('keydown', (e) => {
      if (!this.spinning) return;
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.stop(); }
    });
  }

  /** @param slipperImg 針にする、いま履いているスリッパの絵（data URL） */
  show(d: ResultData, slipperImg = ''): void {
    this.data = d;
    const ribbonCls = !d.won ? 'lost' : d.door ? 'door' : '';
    const title = d.won ? 'VICTORY' : 'GAME OVER';
    const rows: string[] = [];
    rows.push(`<div class="rs-row"><span>${d.boss ? '残った仲間' : '集めた人数'}</span>` +
      `${d.best ? '<em>自己ベスト！</em>' : ''}<b>${fmtBig(d.count, d.countOver ?? 0)}人</b></div>`);
    if (d.boss) {
      rows.push(`<div class="rs-row ${d.won ? 'gold' : ''}"><span>ボス</span>` +
        `<b>${d.won ? 'たおした！' : 'あと少し…'}</b></div>`);
    } else if (d.target !== null && d.won) {
      /*
       * ★**「扉」→「窓口」**（2026-09-29）。ゴールは 9/26 に「巨大な窓口」になり、開くのはシャッター。
       * 「扉まで」だと、はじめての人には何の扉か分からなかった（Lv1 で説明なしに出る）。
       * ★開かなかった回は**何人で開くか**も書く ―― 「あと40人」だけだと、何を目指せばいいかが分からない
       */
      rows.push(d.door
        ? `<div class="rs-row gold"><span>窓口（${d.target.toLocaleString()}人）</span><em>ひらいた！</em><b>ボーナス</b></div>`
        : `<div class="rs-row"><span>窓口が開くまで<small>${d.target.toLocaleString()}人つれていくとボーナス</small></span>`
          + `<b>あと ${(d.target - d.count).toLocaleString()}人</b></div>`);
    }
    rows.push(`<div class="rs-row"><span>拾ったコイン</span><b>+${d.picked}</b></div>`);
    rows.push(`<div class="rs-row"><span>持っているコイン</span><b class="rs-total">${d.total.toLocaleString()}</b></div>`);

    const bar = SEGS.map((s, i) =>
      `<div class="rs-seg" data-i="${i}" style="flex:${s.w};background:${s.color}">×${s.mult}</div>`).join('');

    this.sheet.innerHTML = `
      <div class="rs-ribbon ${ribbonCls}"><b>${title}</b>
        <span>+<span class="rs-gain">${d.base.toLocaleString()}</span><i class="rs-coin"></i></span></div>
      <div class="rs-stage">STAGE ${d.level + 1} / ${d.levels}${d.boss ? '（ボス）' : ''}</div>
      ${rows.join('')}
      ${d.won && d.base > 0 ? `
      <div class="rs-roul">
        <div class="rs-bar">${bar}<div class="rs-needle" style="--sl:url(${slipperImg})"><i></i></div></div>
        <div class="rs-mult"></div>
        <button class="rs-stop" type="button">STOP<small>（タップ／スペース）</small></button>
      </div>` : ''}
      <div class="rs-btns" ${d.won && d.base > 0 ? 'hidden' : ''}>
        ${d.won ? '<button class="rs-btn rs-next" type="button">つぎのステージへ ▶</button>' : ''}
        <button class="rs-btn rs-retry" type="button">↻ もう一回</button>
        <button class="rs-btn rs-home" type="button">ホーム</button>
        <button class="rs-btn rs-shop ${d.canShop ? 'glow' : ''}" type="button" style="grid-column:1 / -1">
          下駄箱でスリッパを履き替える${d.canShop ? '<small>買えるスリッパがある！</small>' : ''}</button>
      </div>
    `;
    const q = (s: string) => this.sheet.querySelector(s) as HTMLElement | null;
    q('.rs-next')?.addEventListener('click', () => this.onNext?.());
    q('.rs-retry')?.addEventListener('click', () => this.onRetry?.());
    q('.rs-home')?.addEventListener('click', () => this.onHome?.());
    q('.rs-shop')?.addEventListener('click', () => this.onShop?.());
    q('.rs-stop')?.addEventListener('click', () => this.stop());
    q('.rs-bar')?.addEventListener('click', () => this.stop());
    this.root.classList.add('on');
    window.setTimeout(() => this.onStamp?.(), 300);

    cancelAnimationFrame(this.raf);
    this.spinning = d.won && d.base > 0;
    if (this.spinning) {
      this.p = 0;
      this.dir = 1;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.spin);
    }
  }

  /** ★下駄箱から戻ってきたとき、所持コインとボタンの光りだけ書き換える */
  refresh(total: number, canShop: boolean): void {
    const t = this.sheet.querySelector('.rs-total');
    if (t) t.textContent = total.toLocaleString();
    const b = this.sheet.querySelector('.rs-shop');
    if (b) {
      b.classList.toggle('glow', canShop);
      const s = b.querySelector('small');
      if (!canShop) s?.remove();
    }
  }

  private spin = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.p += (this.dir * dt) / SWEEP;
    if (this.p >= 1) { this.p = 1; this.dir = -1; }
    if (this.p <= 0) { this.p = 0; this.dir = 1; }
    const needle = this.sheet.querySelector('.rs-needle') as HTMLElement | null;
    if (needle) needle.style.left = `${this.p * 100}%`;
    if (this.spinning) this.raf = requestAnimationFrame(this.spin);
  };

  private stop(): void {
    if (!this.spinning || !this.data) return;
    this.spinning = false;
    cancelAnimationFrame(this.raf);
    let acc = 0;
    let hit = SEGS.length - 1;
    for (let i = 0; i < SEGS.length; i++) {
      acc += SEGS[i].w;
      if (this.p <= acc) { hit = i; break; }
    }
    const mult = SEGS[hit].mult;
    this.sheet.querySelector('.rs-bar')?.classList.add('done');
    this.sheet.querySelector(`.rs-seg[data-i="${hit}"]`)?.classList.add('hit');
    const m = this.sheet.querySelector('.rs-mult') as HTMLElement | null;
    if (m) { m.textContent = `×${mult}！`; m.classList.add('on'); }
    const stopBtn = this.sheet.querySelector('.rs-stop') as HTMLElement | null;
    if (stopBtn) stopBtn.hidden = true;
    this.onRoulette?.(mult);

    // コインを数え上げる（基本 → 倍率後）
    const d = this.data;
    const gain = this.sheet.querySelector('.rs-gain') as HTMLElement | null;
    const total = this.sheet.querySelector('.rs-total') as HTMLElement | null;
    const to = d.base * mult;
    const t0 = performance.now();
    let ticks = 0;
    const frame = (now: number): void => {
      const u = Math.min(1, (now - t0) / 900);
      const k = 1 - (1 - u) * (1 - u);
      const v = Math.round(d.base + (to - d.base) * k);
      if (gain) gain.textContent = v.toLocaleString();
      if (total) total.textContent = Math.round(d.total + (to - d.base) * k).toLocaleString();
      if (Math.floor(u * 10) > ticks) { ticks = Math.floor(u * 10); this.onTick?.(); }
      if (u < 1) this.raf = requestAnimationFrame(frame);
      else {
        const btns = this.sheet.querySelector('.rs-btns') as HTMLElement | null;
        if (btns) btns.hidden = false;
      }
    };
    this.raf = requestAnimationFrame(frame);
  }

  hide(): void {
    this.root.classList.remove('on');
    this.spinning = false;
    // ★数え終わる前に閉じられることがある（リトライ連打）。**止めないと次の回の数字に混ざる**
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
