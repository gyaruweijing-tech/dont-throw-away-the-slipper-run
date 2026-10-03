/**
 * ★★**下駄箱 ＝ スリッパを買う／履き替える画面**（2026-09-16・本人指定）。
 *
 * 本人の言葉:「**スリッパ工房については、買う画面みたいな感じで分けてほしい。リザルトからその画面に飛べる**」
 * 「**工房って何…？ 下駄箱を、スリッパかえるショップにしよう**」。
 *
 * ★★**60種の図鑑にした**（2026-09-16・本人「1種類につき3色。最低10種類」）。**デザインごとの行に3色**を並べる。
 * ★「もっとやりたい」を作る仕掛け（本人「人間心理を考えて」）:
 *  - **次の1足まで あと ○○**（いちばん安い未所持までの進み具合を棒で出す ＝ ゴールが近いほど人は頑張る）
 *  - **集めた数 12 / 59**（コレクションの穴が見える）
 *  - **3色そろうと「コンプ！」**（あと1色、が残るのが気になる）
 *  - 図鑑の最後に**100万の「ホワイトアウト」**が見えている（ほかの値段が安く見える）
 *
 * ★**板は画面の上側だけ**（主人公は画面の下寄りに立っているので、下に置くと隠れた・実機で確認）。
 * 選ぶとその場で履き替わるので、**買ったらどう見えるかを買う前に確かめられる**。
 * ★買う前に「本当に購入する？」を挟む。持っているものを履くときは挟まない
 */
const INK = '#3a2f27';
const PAPER = '#fffdf6';
const STAMP = '#e0453a';
const GOLD = '#f2b632';
const GOLD_DARK = '#c8892a';

export interface ShopItem {
  id: string;
  design: string;
  name: string;
  colorName: string;
  /** 絵（data URL） */
  img: string;
  price: number;
  owned: boolean;
  /** いま履いている */
  on: boolean;
  /** 買える（持っていなくて、コインが足りている） */
  can: boolean;
  /** 光る（伝説） */
  glow: boolean;
  /** 言い値（開くたびに値段が変わる） */
  iine: boolean;
  blurb: string;
}

export class Shop {
  private readonly root: HTMLElement;
  onPick?: (id: string) => void;
  onBack?: () => void;
  /** 確認を開いた／閉じた音 */
  onTap?: () => void;
  private items: ShopItem[] = [];
  private coins = 0;
  private scrollTop = 0;

  constructor(private readonly host: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = `
      .sh-root { position:absolute; inset:0; z-index:80; display:flex; flex-direction:column;
                 justify-content:flex-start; align-items:center; padding:12px 12px 0; box-sizing:border-box;
                 font-family:"Segoe UI",system-ui,sans-serif; color:${INK};
                 background:linear-gradient(rgba(58,47,39,.4), rgba(58,47,39,0) 70%);
                 opacity:0; pointer-events:none; transition:opacity .25s; }
      .sh-root.on { opacity:1; pointer-events:auto; }
      .sh-sheet { width:min(100%,620px); box-sizing:border-box; background:${PAPER}; border:5px solid ${INK};
                  border-radius:16px; padding:12px 12px 10px; box-shadow:0 8px 0 rgba(58,47,39,.3);
                  display:flex; flex-direction:column; max-height:58vh; }
      .sh-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      .sh-head h2 { margin:0; font-size:24px; font-weight:900; }
      .sh-count { font-size:13px; font-weight:900; padding:2px 8px; border-radius:6px; background:${INK}; color:${PAPER}; }
      .sh-coins { margin-left:auto; font-size:20px; font-weight:900; white-space:nowrap; font-variant-numeric:tabular-nums; }
      .sh-coin { display:inline-block; width:15px; height:15px; box-sizing:border-box; border-radius:50%;
                 background:${GOLD}; border:3px solid ${GOLD_DARK}; vertical-align:-2px; margin-right:3px; }
      .sh-goal { margin:8px 0 8px; font-size:13px; font-weight:800; }
      .sh-goal i { display:block; height:10px; margin-top:4px; border:3px solid ${INK}; border-radius:6px;
                   background:linear-gradient(90deg, ${GOLD} var(--p), rgba(58,47,39,.1) var(--p)); }
      .sh-goal b { color:${STAMP}; }
      .sh-list { overflow-y:auto; flex:1 1 auto; min-height:0; margin:0 -4px; padding:0 4px; }
      .sh-row { display:grid; grid-template-columns:54px 1fr; gap:8px; align-items:center; padding:8px 2px;
                border-top:2px dashed rgba(58,47,39,.2); }
      .sh-row img.big { width:54px; height:117px; object-fit:contain; }
      .sh-row h3 { margin:0; font-size:16px; font-weight:900; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .sh-row h3 em { font-style:normal; font-size:11px; padding:1px 6px; border-radius:5px; background:${STAMP}; color:${PAPER}; }
      .sh-row h3 em.legend { background:linear-gradient(90deg,#ffe07a,#f2b632); color:${INK}; }
      .sh-row p { margin:2px 0 6px; font-size:12px; font-weight:700; opacity:.7; }
      .sh-chips { display:flex; gap:6px; flex-wrap:wrap; }
      .sh-chip { cursor:pointer; font-family:inherit; color:${INK}; background:${PAPER}; border:3px solid ${INK};
                 border-radius:10px; padding:4px 8px 4px 4px; display:flex; align-items:center; gap:4px;
                 font-size:12px; font-weight:900; box-shadow:0 3px 0 rgba(58,47,39,.25); }
      .sh-chip img { width:20px; height:44px; object-fit:contain; }
      .sh-chip span { display:flex; flex-direction:column; align-items:flex-start; line-height:1.15; text-align:left; }
      .sh-chip small { font-size:11px; font-weight:900; white-space:nowrap; }
      .sh-chip.on { background:${GOLD}; }
      .sh-chip.own small { opacity:.65; }
      .sh-chip.can small { color:${STAMP}; }
      .sh-chip.no { opacity:.55; }
      .sh-chip.glow { box-shadow:0 0 0 2px #ffe07a, 0 3px 0 rgba(58,47,39,.25); }
      .sh-back { display:block; width:100%; margin-top:8px; padding:10px 0; cursor:pointer; font-family:inherit;
                 font-size:19px; font-weight:900; color:${INK}; background:${PAPER}; border:4px solid ${INK};
                 border-radius:12px; box-shadow:0 5px 0 rgba(58,47,39,.3); }
      .sh-back:active, .sh-chip:active { transform:translateY(3px); }

      /* ============ 本当に購入する？ ============ */
      .sh-ask { position:absolute; inset:0; z-index:2; display:flex; align-items:center; justify-content:center;
                background:rgba(58,47,39,.45); padding-inline:16px; }
      .sh-ask[hidden] { display:none; }
      .sh-box { width:min(100%,320px); box-sizing:border-box; background:${PAPER}; border:5px solid ${INK};
                border-radius:16px; padding:16px 16px 14px; text-align:center; box-shadow:0 8px 0 rgba(58,47,39,.3);
                animation:sh-pop .22s cubic-bezier(.2,1.4,.3,1) both; }
      @keyframes sh-pop { 0% { transform:scale(.8); opacity:0 } 100% { transform:scale(1); opacity:1 } }
      .sh-box img { width:56px; height:122px; object-fit:contain; }
      .sh-box h3 { margin:6px 0 0; font-size:20px; font-weight:900; }
      .sh-box p { margin:6px 0 12px; font-size:15px; font-weight:800; }
      .sh-box p b { font-variant-numeric:tabular-nums; }
      .sh-box p.no { color:${STAMP}; }
      .sh-yes, .sh-no { display:block; width:100%; margin-top:8px; padding:12px 0; cursor:pointer; font-family:inherit;
                        font-size:20px; font-weight:900; color:${INK}; border:4px solid ${INK}; border-radius:12px;
                        box-shadow:0 5px 0 rgba(58,47,39,.3); }
      .sh-yes { background:${GOLD}; }
      .sh-no { background:${PAPER}; }
      .sh-yes:active, .sh-no:active { transform:translateY(4px); box-shadow:0 1px 0 rgba(58,47,39,.3); }
    `;
    host.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'sh-root';
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const chip = t.closest('.sh-chip') as HTMLElement | null;
      if (chip?.dataset.id) {
        const item = this.items.find((s) => s.id === chip.dataset.id);
        // ★持っているものはそのまま履く。持っていないものだけ確認を出す
        if (item && !item.owned) this.ask(item);
        else this.onPick?.(chip.dataset.id);
        return;
      }
      const yes = t.closest('.sh-yes') as HTMLElement | null;
      if (yes?.dataset.id) { this.onPick?.(yes.dataset.id); return; }
      if (t.closest('.sh-no')) { this.onTap?.(); this.closeAsk(); return; }
      if (t.closest('.sh-back')) this.onBack?.();
    });
    host.appendChild(this.root);
  }

  show(items: ShopItem[], coins: number): void {
    this.scrollTop = 0;
    this.render(items, coins, false);
    this.root.classList.add('on');
    this.host.classList.add('sr-menu');
  }

  /** 買った／履き替えたあとに描き直す。**スクロール位置は保つ**（買うたびに一番上へ戻ると探し直しになる） */
  render(items: ShopItem[], coins: number, keepScroll = true): void {
    const list = this.root.querySelector('.sh-list');
    if (list && keepScroll) this.scrollTop = list.scrollTop;
    this.items = items;
    this.coins = coins;
    const n = (v: number) => v.toLocaleString();

    // ── 次の1足（言い値は除く）──
    const rest = items.filter((s) => !s.owned && !s.iine).sort((a, b) => a.price - b.price);
    const next = rest[0];
    const goal = !next
      ? '<div class="sh-goal">全部そろった！ ……本当に？</div>'
      : coins >= next.price
        ? `<div class="sh-goal">いま <b>「${next.name}」</b> が買える！<i style="--p:100%"></i></div>`
        : `<div class="sh-goal">次の1足「${next.name}」まで <b>あと ${n(next.price - coins)}</b><i style="--p:${Math.floor((coins / next.price) * 100)}%"></i></div>`;

    // ── デザインごとの行 ──
    const designs: string[] = [];
    for (const it of items) if (!designs.includes(it.design)) designs.push(it.design);
    const rows = designs.map((d) => {
      const group = items.filter((s) => s.design === d);
      const shown = group.find((s) => s.on) ?? group.find((s) => s.owned) ?? group[0];
      const title = group.length > 1 ? shown.name.replace(/（.*）$/, '') : shown.name;
      const comp = group.length > 1 && group.every((s) => s.owned);
      const chips = group.map((s) => {
        const cls = [s.on ? 'on' : s.owned ? 'own' : s.can ? 'can' : 'no', s.glow ? 'glow' : ''].join(' ');
        const label = s.on ? 'はいている' : s.owned ? 'はく' : `<i class="sh-coin"></i>${n(s.price)}`;
        return `<button class="sh-chip ${cls}" data-id="${s.id}" type="button"><img src="${s.img}" alt="">` +
          `<span>${s.colorName}<small>${label}</small></span></button>`;
      }).join('');
      const tag = comp ? '<em>コンプ！</em>' : shown.glow ? '<em class="legend">伝説</em>' : shown.iine ? '<em>開くたびに値段が変わる</em>' : '';
      return `<div class="sh-row"><img class="big" src="${shown.img}" alt="">` +
        `<div><h3>${title}${tag}</h3><p>${shown.blurb}</p><div class="sh-chips">${chips}</div></div></div>`;
    }).join('');

    const got = items.filter((s) => s.owned).length;
    this.root.innerHTML = `
      <div class="sh-sheet">
        <div class="sh-head"><h2>下駄箱</h2><span class="sh-count">集めた ${got} / ${items.length}</span>
          <div class="sh-coins"><i class="sh-coin"></i>${n(coins)}</div></div>
        ${goal}
        <div class="sh-list">${rows}</div>
        <button class="sh-back" type="button">もどる</button>
      </div>
      <div class="sh-ask" hidden></div>`;
    const nl = this.root.querySelector('.sh-list');
    if (nl) nl.scrollTop = this.scrollTop;
  }

  /** ★「本当に購入する？」。足りないときは理由を出して「やめる」だけにする */
  private ask(item: ShopItem): void {
    this.onTap?.();
    const box = this.root.querySelector('.sh-ask') as HTMLElement | null;
    if (!box) return;
    const after = this.coins - item.price;
    const n = (v: number) => v.toLocaleString();
    box.innerHTML = `
      <div class="sh-box">
        <img src="${item.img}" alt="">
        <h3>「${item.name}」を購入する？</h3>
        ${after >= 0
          ? `<p><i class="sh-coin"></i><b>${n(this.coins)}</b> → <b>${n(after)}</b></p>
             <button class="sh-yes" type="button" data-id="${item.id}">購入する（${n(item.price)}）</button>`
          : `<p class="no">コインが足りない（あと ${n(-after)}）</p>`}
        <button class="sh-no" type="button">やめる</button>
      </div>`;
    box.hidden = false;
  }

  private closeAsk(): void {
    const box = this.root.querySelector('.sh-ask') as HTMLElement | null;
    if (box) box.hidden = true;
  }

  get visible(): boolean {
    return this.root.classList.contains('on');
  }

  /** @param keepMenu ホームへ戻るときは HUD を隠したままにする */
  hide(keepMenu = false): void {
    this.root.classList.remove('on');
    if (!keepMenu) this.host.classList.remove('sr-menu');
  }
}
