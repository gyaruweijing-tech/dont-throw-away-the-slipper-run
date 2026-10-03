import { fmtCount, fmtLog } from '../entities/gateOps';
/**
 * ★★**ゴールのお祝い**（2026-09-16・本人指定）。
 *
 * 本人の言葉:「**普通に積みあがっていって、数をバーンとだして、紙吹雪。
 * キャラがみんなで万歳している感じ。もし扉も開いたらそれがさらに豪華になる感じ**」。
 *
 * ★**勝ち負けを出さない。** 「集めた数」だけを大きく出す（本人「成功か失敗かみたいなのになっている」）。
 * 扉が開いた回は**金の帯と紙吹雪の量**で上乗せするだけで、開かなかった回に「失敗」の絵は出さない。
 * ★万歳（`uCheer`）と主人公の掲げは `Game` 側。ここは画面の上に乗る DOM だけ
 */
const INK = '#3a2f27';
const PAPER = '#fffdf6';
const STAMP = '#e0453a';
const GOLD = '#f2b632';

let styled = false;
function ensureStyle(parent: HTMLElement): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = `
    .cb-root { position:absolute; inset:0; z-index:65; pointer-events:none; overflow:hidden;
               font-family:"Segoe UI",system-ui,sans-serif; color:${INK}; }
    .cb-box { position:absolute; left:50%; top:14%; transform:translateX(-50%);
              display:flex; flex-direction:column; align-items:center; gap:6px; }
    .cb-num { font-size:clamp(64px, 16vw, 128px); font-weight:900; line-height:.9;
              font-variant-numeric:tabular-nums; color:${PAPER};
              -webkit-text-stroke:6px ${INK}; paint-order:stroke fill;
              text-shadow:0 8px 0 rgba(58,47,39,.35);
              animation:cb-bang .5s cubic-bezier(.2,1.4,.3,1) both; }
    .cb-num small { font-size:.42em; margin-left:6px; -webkit-text-stroke:4px ${INK}; }
    .cb-label { font-size:clamp(20px, 5vw, 30px); font-weight:900; padding:6px 18px;
                background:${PAPER}; border:4px solid ${INK}; border-radius:999px;
                animation:cb-pop .35s .25s cubic-bezier(.2,1.4,.3,1) both; }
    .cb-root.door .cb-label { background:${GOLD}; }
    .cb-best { font-size:18px; font-weight:900; color:${PAPER}; background:${STAMP};
               padding:4px 12px; border-radius:8px; transform:rotate(-6deg);
               animation:cb-pop .35s .5s cubic-bezier(.2,1.4,.3,1) both; }
    .cb-door { font-size:clamp(22px, 6vw, 36px); font-weight:900; color:${INK};
               background:linear-gradient(${GOLD}, #e0a93a); border:5px solid ${INK}; border-radius:14px;
               padding:6px 20px; box-shadow:0 6px 0 rgba(58,47,39,.3);
               animation:cb-bang .55s .35s cubic-bezier(.2,1.4,.3,1) both; }
    .cb-bit { position:absolute; top:-6vh; width:12px; height:18px; border:2px solid ${INK};
              border-radius:2px; animation:cb-fall linear forwards; }
    @keyframes cb-bang { 0% { transform:scale(2.6); opacity:0 } 60% { transform:scale(.9); opacity:1 }
                         100% { transform:scale(1) } }
    @keyframes cb-pop { 0% { transform:scale(0) } 100% { transform:scale(1) } }
    @keyframes cb-fall { to { transform:translate(var(--dx), 112vh) rotate(var(--rot)); } }
    @media (prefers-reduced-motion: reduce) {
      .cb-num, .cb-label, .cb-best, .cb-door { animation:none; }
      .cb-bit { display:none; }
    }
  `;
  parent.appendChild(style);
}

export class Celebrate {
  private root: HTMLElement | null = null;
  private raf = 0;

  constructor(private readonly parent: HTMLElement) {
    ensureStyle(parent);
  }

  /**
   * @param count 集まった人数
   * @param door 扉まで開いたか（＝豪華版）
   * @param best 自己ベストを超えたか（**超えたときだけ**出す。下回ったときは何も出さない）
   */
  /** @param over ★10³⁰⁰ を越えた桁（理系用）。0 ならふつうの人数 */
  show(count: number, door: boolean, best: boolean, over = 0): void {
    this.hide();
    const root = document.createElement('div');
    root.className = `cb-root${door ? ' door' : ''}`;
    root.innerHTML = `
      <div class="cb-box">
        <div class="cb-num"><span>0</span><small>人</small></div>
        <div class="cb-label">${door ? '全員で扉を開けた！' : 'CONGRATULATIONS!'}</div>
        ${door ? '<div class="cb-door">扉がひらいた！</div>' : ''}
        ${best ? '<div class="cb-best">自己ベスト！</div>' : ''}
      </div>`;
    // ★紙吹雪。扉が開いた回は量を倍にして金を混ぜる
    const colors = door ? [GOLD, GOLD, STAMP, PAPER, '#e0a93a'] : [PAPER, STAMP, GOLD, '#9fc1d9'];
    const n = door ? 150 : 70;
    for (let i = 0; i < n; i++) {
      const b = document.createElement('i');
      b.className = 'cb-bit';
      b.style.left = `${Math.random() * 100}%`;
      b.style.background = colors[i % colors.length];
      b.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
      b.style.animationDelay = `${Math.random() * (door ? 1.2 : 0.6)}s`;
      b.style.setProperty('--dx', `${(Math.random() - 0.5) * 30}vw`);
      b.style.setProperty('--rot', `${(Math.random() - 0.5) * 1440}deg`);
      root.appendChild(b);
    }
    this.parent.appendChild(root);
    this.root = root;

    // 数は 0.6 秒で数え上げる（§5「即表示は禁止」）
    const el = root.querySelector('.cb-num span') as HTMLElement;
    const t0 = performance.now();
    const frame = (now: number): void => {
      const u = Math.min(1, (now - t0) / 600);
      const e = 1 - (1 - u) * (1 - u);
      // ★桁が大きいときは桁で数え上げる（10³⁰⁰ を越えると数として持てない）
      const L = Math.log10(count + 1) + over;
      el.textContent = L > 6 ? fmtLog(L * e) : fmtCount(count * e);
      if (u < 1) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  hide(): void {
    cancelAnimationFrame(this.raf);
    this.root?.remove();
    this.root = null;
  }
}
