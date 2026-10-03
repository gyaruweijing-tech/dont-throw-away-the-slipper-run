/**
 * ★**種つき乱数を1か所にする**（2026-09-15 新設）。
 *
 * **なぜ要ったか**: 検品（`59490ca`）が「**12本のうち4本に種が無く、毎回ちがう数字が出る**」と指摘した。
 * 実害も出ていて、`sim:density` を前日と並べたときに全20レベルで数字が違い、
 * **「人の列の変更が密度を動かした」と誤読しかけた**（実際は無関係）。
 *
 * ★**同じ mulberry32 が、種のある6本に「コピペで6回」書かれている**のが今の状態。
 * このリポジトリが何度も踏んでいる「**同じ判断が2か所にある**」の型なので、
 * ★**新しく種を入れる4本は、最初からここを読む**。
 *
 * ★**既存の6本（`pacing` / `trap-check` / `wind` / `phase4-sim` / `skill` / `boss-hp`）は
 * 今回いっさい触っていない。** 触れば乱数列が変わりかねず、
 * 「**版どうしを比べる**」という種の目的そのものを壊すため。
 * 寄せるのは「**数字が1文字も変わらない**」と実測できた日にする。
 */

/** 空回しの回数。mulberry32 は隣り合う種の1発目が強く相関するので捨てる（`pacing.ts:50` と同じ理由） */
const WARMUP = 16;

/**
 * `Math.random` を種つきに差し替える。**ファイルの先頭で1回だけ呼ぶ。**
 * @param base 種の下敷き。`SEED_BASE=7 npm run sim:density` で外から変えられる
 * @returns 種を置き直す関数（走行ごとに対応をとりたいときだけ使う）
 */
export function seedRandom(base = Number(process.env.SEED_BASE ?? 1)): (run: number) => void {
  let seed = base | 0;
  Math.random = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const setSeed = (run: number): void => {
    seed = (base * 1000 + run) | 0;
    for (let i = 0; i < WARMUP; i++) Math.random();
  };
  setSeed(0);
  return setSeed;
}
