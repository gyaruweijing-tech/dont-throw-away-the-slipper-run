import * as THREE from 'three';
import { CFG } from '../config';

/**
 * ★**ボスの巨体**（2026-08-28・参考画像 `assets/ref/02-boss1-colossus.jpg`）。
 *
 * 本人のイメージ:「**でっかいボス一匹。そこに集団の我々が突っ込んでいく**」。
 *
 * ★**なぜアトラスを使わないのか。**
 * キャラの絵は `public/assets/atlas.png` の **4×4＝16マスで、すでに満杯**
 * （味方6・主人公2・人事部4・社員4・影1 …… 空きゼロ）。
 * マスを増やすとグリッドが変わり、**全キャラの UV が動いて PNG も作り直し**になる。
 * 一方、参考画像のボスは**平らな長方形の集まり**でしかない。
 * だから**障害物と同じ「板を並べる」作法**で作る。
 * これなら新しい素材も、アトラスの作り直しも要らない。
 *
 * ★**造形はデータ（`BossSpec`）で持つ。**
 * ボスは4体来るので（同僚たち／多数決／監査／決裁）、
 * クラスに `if (kind === ...)` を積むと必ず分岐だらけになる。
 * **表を足すだけで次のボスが増える**形にしてある。
 */

/** 板1枚。座標は「足元が y=0、身長が 1.0」の正規化した空間で書く */
export interface BossPart {
  /** 中心 x（身長に対する比。+ が画面右） */
  x: number;
  /** 中心 y（身長に対する比。0 が足元） */
  y: number;
  w: number;
  h: number;
  color: number;
  /** 手前へどれだけ出すか。重なりの順を決める */
  z?: number;
  /** 輪郭の濃い茶を後ろに敷くか。**敷かないと切り抜きに見えない** */
  outline?: boolean;
  /**
   * ★**傾き（ラジアン・反時計回り）**（2026-09-06 追加）。
   * ボス②「多数決」の**放射状の10本の腕**のために要る。
   * `ASSETS.ref.md` §3 が「腕は同じ板を角度を変えて10枚並べる」と書いているとおり、
   * **板を増やすのではなく、同じ板を回して置く**
   */
  rot?: number;
  /** ★**楕円（丸）にするか**。ボス④の朱の押す面だけが使う。角のある板では判子に見えない */
  round?: boolean;
  /**
   * ★**腕か**（2026-09-14・本人「**ボスの闘っているしぐさがまったくなく、戦っている感じがない**」）。
   * 印を付けた板（と、その輪郭）だけを、殴っているあいだ振り上げ・振り下ろす。
   * ★**回さずに動かす。** 板の中心が回転の中心なので `rotation` を足すと**腕が真ん中で折れる**
   * （肩を原点にした入れ子が要る ＝ 表の作りが変わる）。
   * **位置をずらすだけ**なら表の形を変えずに済み、ボス②の放射状の角度（`rot`）も壊れない
   */
  arm?: boolean;
}

export interface BossSpec {
  readonly name: string;
  /** 身長（m）。**カメラに収まる範囲で決める**（参考画像の「人の8倍」は画面に入らない） */
  readonly height: number;
  readonly parts: readonly BossPart[];
  /**
   * ★★**1枚絵で作るボス**（2026-09-15 新設・本人が Lv20 のボスを描いてきた）。
   *
   * ★**これがあるときは `parts`（板の表）を使わない。**
   * 鳥かごのような形は**板を並べても組めない**ので、絵をそのまま貼る。
   * `public/` からの相対パス。正方形の PNG（背景は透過 or 白）を想定する
   */
  readonly image?: string;
  /**
   * ★**腕の代わりに揺れるもの**（本人「**腕ではなくて、給料袋にしました。
   * キャラ自体、人間の形していないし**」）。
   * ★**左右に1つずつ置いて、`arm` と同じ振り方をさせる** ――
   * 殴るしぐさの仕組み（`setPunch`）をそのまま使えるので、新しい動きを発明しない
   */
  readonly armImage?: string;
  /** 揺れるものの置き場所（身長に対する割合）。`x` は中心からの左右の距離 */
  readonly armAt?: { readonly x: number; readonly y: number; readonly w: number };
}

const INK = 0x4a3524;

/**
 * ★**ボス①「同僚たち」＝ 最初に信じなかった人たち。**
 *
 * 参考画像のとおり:**枯れたカーキのスーツ・禿頭・目も鼻も無い・朱の口が1つ**。
 * 腕は真下。完全に静止。**何も言わずにただ立っている**のが怖い、という役。
 *
 * ★**朱の口は絶対に落とさない。** 画面で唯一の彩度なので、
 * これが無いと「灰色の板」にしか見えなくなる（`ASSETS.ref.md` §2）。
 */
export const BOSS1: BossSpec = {
  name: '同僚たち',
  height: 6.2,
  parts: [
    // 靴（いちばん奥から手前へ積む）
    { x: -0.13, y: 0.022, w: 0.20, h: 0.045, color: 0x6b4a33, outline: true },
    { x: 0.13, y: 0.022, w: 0.20, h: 0.045, color: 0x6b4a33, outline: true },
    // 脚
    { x: -0.10, y: 0.20, w: 0.15, h: 0.36, color: 0xa8a390, outline: true },
    { x: 0.10, y: 0.20, w: 0.15, h: 0.36, color: 0xa8a390, outline: true },
    // 胴（スーツ）
    { x: 0, y: 0.58, w: 0.46, h: 0.42, color: 0xa8a390, z: 0.02, outline: true },
    // シャツ（襟元だけ見える）
    { x: 0, y: 0.70, w: 0.12, h: 0.18, color: 0xefe9dc, z: 0.04 },
    // ネクタイ
    { x: 0, y: 0.66, w: 0.045, h: 0.20, color: 0xb08d4a, z: 0.05 },
    // 腕（真下。走りでは振らないが、★殴り合いのあいだだけ動く）
    { x: -0.27, y: 0.56, w: 0.10, h: 0.40, color: 0xa8a390, z: 0.06, outline: true, arm: true },
    { x: 0.27, y: 0.56, w: 0.10, h: 0.40, color: 0xa8a390, z: 0.06, outline: true, arm: true },
    // 手
    { x: -0.27, y: 0.36, w: 0.09, h: 0.07, color: 0xc9c3ae, z: 0.07 },
    { x: 0.27, y: 0.36, w: 0.09, h: 0.07, color: 0xc9c3ae, z: 0.07 },
    // 頭（禿頭・角の丸い四角）
    { x: 0, y: 0.895, w: 0.26, h: 0.21, color: 0xb5b09c, z: 0.03, outline: true },
    // ★朱の口。目も鼻も無い
    { x: 0, y: 0.845, w: 0.10, h: 0.022, color: 0xc8352b, z: 0.05 },
  ],
};


/** ボス②③④で使う色。**参考画像（`assets/ref/`）から拾った値**（`ASSETS.ref.md`） */
const SUIT2 = 0x8a7355;   // ボス②のオリーブ寄りの茶
const SKIN = 0xd8b184;    // 手・顔のタン
const CUFF = 0xf1ead8;    // 白いカフス
const NAVY = 0x3c4457;    // ボス③の濃紺（人事部と同じ系譜）
const CREAM = 0xefe7d2;   // 白紙の札
const WOOD = 0x7a5a3f;    // ボス④の判子の握り
const STAMP_RED = 0xd8452f;

/**
 * ★**ボス②「多数決」**（参考画像 `assets/ref/03-boss2-majority.jpg`）。
 *
 * `ASSETS.ref.md` §3 の要点そのまま:
 * **ずんぐり横広の体・腕が10本（左右5本ずつ）・頭は小さく体に埋まる・脚は短く太い**。
 * ★**このボスは腕の本数と放射の角度が全て。** 体は箱1つでよい。
 * **白いカフスが「腕の本数」を読みやすくしている**ので必ず残す。
 *
 * 意味: **数の暴力**。1人ずつ相手にすれば勝てるのに、手を挙げた数で押し切られる
 */
export const BOSS2: BossSpec = {
  name: '多数決',
  // ★**5.6 では腕の先が画面の上で切れた**（実機）。カメラは俯角が浅いので、
  // **横に広い体ほど背は低くする**。腕の広がりで大きさは十分に出る
  height: 5.0,
  parts: [
    // 靴（大きい）
    { x: -0.15, y: 0.028, w: 0.26, h: 0.055, color: 0x5f4630, outline: true },
    { x: 0.15, y: 0.028, w: 0.26, h: 0.055, color: 0x5f4630, outline: true },
    // 脚（短く太い）
    { x: -0.12, y: 0.20, w: 0.20, h: 0.30, color: SUIT2, outline: true },
    { x: 0.12, y: 0.20, w: 0.20, h: 0.30, color: SUIT2, outline: true },
    // 胴（ずんぐり横広）
    { x: 0, y: 0.52, w: 0.62, h: 0.40, color: SUIT2, z: 0.03, outline: true },
    // 頭（小さい・体の中央上に埋まる）
    { x: 0, y: 0.80, w: 0.17, h: 0.16, color: SKIN, z: 0.01, outline: true },
    // 髪（角の丸い帽子のように上へ）
    { x: 0, y: 0.865, w: 0.175, h: 0.05, color: 0x4a3524, z: 0.02 },
    // ★朱の口（4体のうち3体が持つ、この世界で唯一の彩度）
    { x: 0, y: 0.775, w: 0.075, h: 0.018, color: 0xc8352b, z: 0.03 },
    { x: -0.369, y: 0.623, w: 0.44, h: 0.075, rot: 3.037, color: SUIT2, z: 0.02, outline: true },
    { x: -0.341, y: 0.710, w: 0.44, h: 0.075, rot: 2.618, color: SUIT2, z: 0.02, outline: true },
    { x: -0.279, y: 0.778, w: 0.44, h: 0.075, rot: 2.199, color: SUIT2, z: 0.02, outline: true },
    { x: -0.203, y: 0.813, w: 0.44, h: 0.075, rot: 1.815, color: SUIT2, z: 0.02, outline: true },
    { x: -0.123, y: 0.818, w: 0.44, h: 0.075, rot: 1.449, color: SUIT2, z: 0.02, outline: true },
    { x: 0.369, y: 0.623, w: 0.44, h: 0.075, rot: 0.105, color: SUIT2, z: 0.02, outline: true },
    { x: 0.341, y: 0.710, w: 0.44, h: 0.075, rot: 0.524, color: SUIT2, z: 0.02, outline: true },
    { x: 0.279, y: 0.778, w: 0.44, h: 0.075, rot: 0.942, color: SUIT2, z: 0.02, outline: true },
    { x: 0.203, y: 0.813, w: 0.44, h: 0.075, rot: 1.326, color: SUIT2, z: 0.02, outline: true },
    { x: 0.123, y: 0.818, w: 0.44, h: 0.075, rot: 1.693, color: SUIT2, z: 0.02, outline: true },
    { x: -0.526, y: 0.640, w: 0.045, h: 0.085, rot: 3.037, color: CUFF, z: 0.04 },
    { x: -0.478, y: 0.789, w: 0.045, h: 0.085, rot: 2.618, color: CUFF, z: 0.04 },
    { x: -0.372, y: 0.906, w: 0.045, h: 0.085, rot: 2.199, color: CUFF, z: 0.04 },
    { x: -0.242, y: 0.967, w: 0.045, h: 0.085, rot: 1.815, color: CUFF, z: 0.04 },
    { x: -0.104, y: 0.976, w: 0.045, h: 0.085, rot: 1.449, color: CUFF, z: 0.04 },
    { x: 0.526, y: 0.640, w: 0.045, h: 0.085, rot: 0.105, color: CUFF, z: 0.04 },
    { x: 0.478, y: 0.789, w: 0.045, h: 0.085, rot: 0.524, color: CUFF, z: 0.04 },
    { x: 0.372, y: 0.906, w: 0.045, h: 0.085, rot: 0.942, color: CUFF, z: 0.04 },
    { x: 0.242, y: 0.967, w: 0.045, h: 0.085, rot: 1.326, color: CUFF, z: 0.04 },
    { x: 0.104, y: 0.976, w: 0.045, h: 0.085, rot: 1.693, color: CUFF, z: 0.04 },
    { x: -0.628, y: 0.650, w: 0.10, h: 0.115, rot: 3.037, color: SKIN, z: 0.05, round: true, outline: true },
    { x: -0.566, y: 0.840, w: 0.10, h: 0.115, rot: 2.618, color: SKIN, z: 0.05, round: true, outline: true },
    { x: -0.432, y: 0.989, w: 0.10, h: 0.115, rot: 2.199, color: SKIN, z: 0.05, round: true, outline: true },
    { x: -0.266, y: 1.066, w: 0.10, h: 0.115, rot: 1.815, color: SKIN, z: 0.05, round: true, outline: true },
    { x: -0.091, y: 1.077, w: 0.10, h: 0.115, rot: 1.449, color: SKIN, z: 0.05, round: true, outline: true },
    { x: 0.628, y: 0.650, w: 0.10, h: 0.115, rot: 0.105, color: SKIN, z: 0.05, round: true, outline: true },
    { x: 0.566, y: 0.840, w: 0.10, h: 0.115, rot: 0.524, color: SKIN, z: 0.05, round: true, outline: true },
    { x: 0.432, y: 0.989, w: 0.10, h: 0.115, rot: 0.942, color: SKIN, z: 0.05, round: true, outline: true },
    { x: 0.266, y: 1.066, w: 0.10, h: 0.115, rot: 1.326, color: SKIN, z: 0.05, round: true, outline: true },
    { x: 0.091, y: 1.077, w: 0.10, h: 0.115, rot: 1.693, color: SKIN, z: 0.05, round: true, outline: true },
  ],
};

/**
 * ★**ボス③「監査」**（参考画像 `assets/ref/04-boss3-audit.jpg`）。
 *
 * `ASSETS.ref.md` §4:**極端に縦長・細身／濃紺のスーツ／縦長台形のタンの頭／
 * 黒いネクタイ／胸の前に大きな白紙の札**。
 * ★**シルエットが縦に細いことが、①②との唯一の見分け。幅を絶対に太らせない。**
 * ★**札には何も描かない**（§4-I のレッドライン。白紙のままが一番怖い）
 *
 * 意味: **中身を見ずに紙で判断する相手**
 */
export const BOSS3: BossSpec = {
  name: '監査',
  // ★**7.6 では頭が画面の外**（実機）。細さで見分けさせるので、背は 6.4 でも役目は果たす
  height: 6.4,
  parts: [
    // 靴
    { x: -0.055, y: 0.018, w: 0.11, h: 0.036, color: 0x5f4630, outline: true },
    { x: 0.055, y: 0.018, w: 0.11, h: 0.036, color: 0x5f4630, outline: true },
    // 脚（長い）
    { x: -0.045, y: 0.22, w: 0.075, h: 0.40, color: NAVY, outline: true },
    { x: 0.045, y: 0.22, w: 0.075, h: 0.40, color: NAVY, outline: true },
    // 胴
    { x: 0, y: 0.60, w: 0.19, h: 0.36, color: NAVY, z: 0.02, outline: true },
    // 襟（クリーム）とネクタイ（黒）
    { x: 0, y: 0.755, w: 0.055, h: 0.05, color: CREAM, z: 0.04 },
    { x: 0, y: 0.705, w: 0.022, h: 0.10, color: 0x2b2721, z: 0.05 },
    // 腕（真下・細い）
    { x: -0.115, y: 0.60, w: 0.045, h: 0.34, color: NAVY, z: 0.03, outline: true, arm: true },
    { x: 0.115, y: 0.60, w: 0.045, h: 0.34, color: NAVY, z: 0.03, outline: true, arm: true },
    // 左手（垂れている）
    { x: -0.115, y: 0.415, w: 0.05, h: 0.055, color: 0x6b4a33, z: 0.04 },
    // ★白紙の札（枠は茶。中身は完全な白紙）
    { x: 0.03, y: 0.585, w: 0.28, h: 0.26, color: 0x6b4a33, z: 0.06 },
    { x: 0.03, y: 0.585, w: 0.25, h: 0.23, color: CREAM, z: 0.07 },
    // 札を支える右手（札の手前）
    { x: 0.155, y: 0.545, w: 0.055, h: 0.06, color: 0x6b4a33, z: 0.08 },
    // 頭（縦長の台形。わずかに傾ける＝見下ろしている）
    { x: 0, y: 0.885, w: 0.115, h: 0.20, rot: 0.035, color: SKIN, z: 0.02, outline: true },
    { x: 0, y: 0.975, w: 0.12, h: 0.035, rot: 0.035, color: 0x4a3524, z: 0.03 },
    { x: 0.002, y: 0.828, w: 0.06, h: 0.016, color: 0xc8352b, z: 0.04 },
  ],
};

/**
 * ★**ボス④「決裁」**（参考画像 `assets/ref/05-boss4-stamp.jpg`）。
 *
 * `ASSETS.ref.md` §5:**巨大な判子。上が濃い茶の握り、下が朱の楕円の押す面。
 * 握りの左右からタンの腕が2本、力なく垂れている**。
 * ★**腕が命。腕を落とすと家具になる。**
 * ★**顔は無い**（4体でこれだけ口が無い ＝ 話が通じない相手の極み）
 *
 * 意味: **人ではなく手続きそのもの**
 */
export const BOSS4: BossSpec = {
  name: '決裁',
  /*
   * ★★**2026-09-15 夜: 5.0 → 7.6 にした**（本人「**ボスを大きくしてほしい**」）。
   *
   * ★**数字ほど大きくは見えない。** 1枚絵は**正方形の PNG で、まわりに余白がある** ――
   * 実測でかご本体は画像の縦およそ 70% なので、**7.6 の板でも、かごの背は 5.3m ほど**。
   * ★**板の表で作った他のボス（6.2 / 6.4）と、画面上でだいたい並ぶ**のがこの値。
   * ★**最後のボスなので、少しだけ上回る**ようにしてある
   */
  height: 7.6,
  /*
   * ★★**2026-09-15: 本人が描いた絵に差し替えた。**
   * 本人:「**Lv20のボスいい感じのできました。腕ではなくて、給料袋にしました。
   * キャラ自体、人間の形していないし**」
   * ★**下の `parts`（板の表）は使われなくなったが、消さずに残してある** ――
   * 絵が気に入らなかったときに**すぐ戻せる**ようにするため。`image` を消せば board に戻る
   */
  image: 'assets/boss/boss4-body.png',
  armImage: 'assets/boss/boss4-bag.png',
  armAt: { x: 0.40, y: 0.60, w: 0.26 },
  parts: [
    // 押す面（下から: 茶の台 → 白いちぎれ縁 → 朱）
    /*
     * ★**白いちぎれ縁を太くしてある**（2026-09-06・実機で直した）。
     * この床（バトルリング）は**同じ朱**なので、細い縁だと**押す面が床に溶けて穴に見えた**。
     * 参考画像で「朱の面のまわりに白いちぎれ縁が1周」と書いてあるのは、
     * **白い紙の上だから成立する**話で、朱の床の上ではもっと太くしないと同じ効果にならない
     */
    { x: 0, y: 0.30, w: 0.90, h: 0.48, color: 0x6b4a33, round: true, z: 0.01 },
    { x: 0, y: 0.30, w: 0.82, h: 0.42, color: CREAM, round: true, z: 0.02 },
    { x: 0, y: 0.30, w: 0.68, h: 0.32, color: STAMP_RED, round: true, z: 0.03 },
    // 胴（帯）
    { x: 0, y: 0.56, w: 0.40, h: 0.14, color: WOOD, z: 0.02, outline: true },
    // 握り（角の丸い縦長）
    { x: 0, y: 0.79, w: 0.30, h: 0.42, color: WOOD, z: 0.03, outline: true },
    { x: 0, y: 0.985, w: 0.26, h: 0.06, color: WOOD, z: 0.03 },
    // ★腕2本（力なく垂れる）。少しだけ外へ開く
    { x: -0.215, y: 0.735, w: 0.30, h: 0.075, rot: -1.15, color: SKIN, z: 0.04, outline: true, arm: true },
    { x: 0.215, y: 0.735, w: 0.30, h: 0.075, rot: 1.15, color: SKIN, z: 0.04, outline: true, arm: true },
    // 手
    { x: -0.255, y: 0.60, w: 0.10, h: 0.11, color: SKIN, z: 0.05, outline: true },
    { x: 0.255, y: 0.60, w: 0.10, h: 0.11, color: SKIN, z: 0.05, outline: true },
  ],
};

/**
 * ★**ボスの表。** 5本ごとに1体ずつ。**`Boss` はここを添字で引くだけ**で、
 * `if (kind === ...)` を1つも書かない（`BossFigure` 冒頭の方針そのもの）
 */
export const BOSSES: readonly BossSpec[] = [BOSS1, BOSS2, BOSS3, BOSS4];

export class BossFigure {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly mats: THREE.MeshLambertMaterial[] = [];
  private spec: BossSpec | null = null;
  /** ★殴るときに動かす板（腕と、その輪郭）。2026-09-14 */
  private readonly arms: { mesh: THREE.Mesh; baseX: number; baseY: number; side: number }[] = [];
  private punchT = 0;
  private punchK = 0;

  /** いまの身長（m）。HP バーの高さを合わせるために外から読む */
  get height(): number {
    return this.spec ? this.spec.height * CFG.boss.figureScale : 0;
  }

  /** ★**表を差し替えるだけでボスが変わる。** ②③④はここに `BossSpec` を足すだけ */
  build(spec: BossSpec): void {
    if (this.spec === spec) return;
    this.clear();
    this.spec = spec;
    const H = spec.height * CFG.boss.figureScale;

    /*
     * ★★**1枚絵のボス**（2026-09-15）。`parts` の表は使わない。
     * ★**袋だけ別の板**にして、`arm` と同じ揺れをさせる（`setPunch` をそのまま使う）
     */
    if (spec.image) {
      this.addImage(0, H * 0.5, H, H, 0, spec.image);
      if (spec.armImage && spec.armAt) {
        const a = spec.armAt;
        for (const side of [-1, 1]) {
          this.addImage(side * a.x * H, a.y * H, a.w * H, a.w * H, 0.04 * H, spec.armImage);
          this.rememberArm(side * a.x);
        }
      }
      this.group.visible = false;
      return;
    }

    for (const p of spec.parts) {
      /*
       * ★**輪郭は「一回り大きい濃い茶の板を後ろに敷く」**で作る。
       * 線を引く手段が無いので、参考画像の「濃い茶の細い線」はこれで再現する。
       * 敷かないと**ただの色面**になって、貼り絵に見えない
       */
      if (p.outline) {
        const t = 0.012;
        this.add(p.x * H, p.y * H, (p.w + t) * H, (p.h + t) * H, (p.z ?? 0) * H - 0.02, INK, p.rot, p.round);
        // ★輪郭も一緒に動かさないと、振ったときに輪郭だけ置いていかれる
        if (p.arm) this.rememberArm(p.x);
      }
      this.add(p.x * H, p.y * H, p.w * H, p.h * H, (p.z ?? 0) * H, p.color, p.rot, p.round);
      if (p.arm) this.rememberArm(p.x);
    }
    this.group.visible = false;
  }

  /** ★直前に足した板を「腕」として覚える（2026-09-14） */
  private rememberArm(x: number): void {
    const m = this.meshes[this.meshes.length - 1];
    if (!m) return;
    this.arms.push({ mesh: m, baseX: m.position.x, baseY: m.position.y, side: x < 0 ? -1 : 1 });
  }

  /**
   * ★**殴っているあいだの動き**（2026-09-14・本人「**戦っている感じがない**」）。
   *
   * ★**絵は1枚も足していない。** ボスはアトラスを使わない**板の表**なので、
   * **板を動かすだけで殴れる**（`PROGRESS.md` §「例外②」の通り、ここは自由が効く）。
   *
   * 動かすのは2つだけ:
   * ① **腕を振り上げて振り下ろす**（左右は半周期ずらして交互）
   * ② ★**体が上下に弾む**。これが効く ―― 腕だけ動かすと「腕だけ動く置物」になる
   *
   * @param dt 前のフレームからの秒
   * @param on 殴っているか。★**切り替えは混ぜる**（急に止まると固まって見える）
   */
  setPunch(dt: number, on: boolean): void {
    this.punchK += ((on ? 1 : 0) - this.punchK) * Math.min(1, dt * 6);
    if (this.punchK < 0.002) return;
    this.punchT += dt;
    const H = (this.spec ? this.spec.height : 5) * CFG.boss.figureScale;
    const w = this.punchT * 7.2;
    for (const a of this.arms) {
      // 左右で半周期ずらす ＝ 片方が上がるとき、もう片方が下りる
      const ph = a.side > 0 ? Math.PI : 0;
      const s = Math.sin(w + ph);
      a.mesh.position.y = a.baseY + s * 0.055 * H * this.punchK;
      a.mesh.position.x = a.baseX + Math.max(s, 0) * 0.022 * H * a.side * this.punchK;
    }
    // 体の弾み。★`place` が position.y を書いたあとに呼ぶ（上書きされないように）
    this.group.position.y += Math.abs(Math.sin(w)) * 0.035 * H * this.punchK;
  }

  /**
   * ★**絵を貼った板を1枚置く**（2026-09-15）。
   * ★**`add`（単色の板）と分けている**のは、材質が違うから ――
   * 絵のほうは**透明を抜く**（`alphaTest`）必要があり、単色板に同じ設定を入れると輪郭が痩せる。
   */
  private addImage(x: number, y: number, w: number, h: number, z: number, url: string): void {
    const tex = new THREE.TextureLoader().load(url, undefined, undefined, () => {
      console.error(`[boss] ${url} を読めませんでした`);
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    // ★**紙の切り抜き**なので、拡大しても にじませない方向へ寄せる（ミップは残す）
    tex.anisotropy = 4;
    const mat = new THREE.MeshLambertMaterial({
      map: tex,
      transparent: true,
      // ★**半透明の縁を残すと、板の重なりで暗い輪が出る。** 抜くほうが紙らしい
      alphaTest: 0.35,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.frustumCulled = false;
    this.meshes.push(m);
    this.mats.push(mat);
    this.group.add(m);
  }

  private add(
    x: number, y: number, w: number, h: number, z: number, color: number,
    rot = 0, round = false,
  ): void {
    const mat = new THREE.MeshLambertMaterial({ color });
    // **薄い板**。厚みを持たせると角が光って「紙」に見えなくなる
    // ★丸だけは板（円）にする。箱で近似すると判子の押す面が四角くなる
    const geo = round
      ? new THREE.CircleGeometry(0.5, 40).scale(w, h, 1)
      : new THREE.BoxGeometry(w, h, 0.06);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.z = rot;
    m.frustumCulled = false;
    this.meshes.push(m);
    this.mats.push(mat);
    this.group.add(m);
  }

  /**
   * @param z ボスからの相対距離
   * @param frac 残り HP の割合（1..0）
   * @param hit 直前に殴られたか（のけぞる演出に使う）
   */
  place(z: number, frac: number, lean: number, fall = 0): void {
    this.group.visible = true;
    this.group.position.set(0, 0, z);
    /*
     * ★**減っているのを1体でどう見せるか**（2026-08-28）。
     * 群衆版は「前列から消える」で相殺が見えていたが、1体だと**何も起きない**。
     * HP バーだけに頼らず、**削られるほど後ろへのけぞる**ようにした。
     * 新しい語彙は増やさない —— 角度だけで「効いている」を出す
     */
    // ★`fall` は後ろへ倒す角度（ラジアン・2026-09-16）。寝きったら表の絵が上を向く
    this.group.rotation.x = lean * 0.22 - fall;
    // 沈み込み。のけぞりだけだと足が浮くので、わずかに下げる
    // ★寝たら床の少し上へ（沈めたままだと床に埋まって朱肉と重なってちらつく）
    this.group.position.y = fall > 1.2 ? 0.06 : -lean * 0.25;
    const k = 0.55 + 0.45 * frac;
    for (const m of this.mats) if (m.emissive) m.emissiveIntensity = k;
  }

  hide(): void {
    this.group.visible = false;
  }

  private clear(): void {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.meshes.length = 0;
    this.mats.length = 0;
    // ★**ここを忘れると、次のボスで「前の体の板」を動かそうとする**
    // （このリポジトリが何度も踏んでいる「使い回しの消し忘れ」の型）
    this.arms.length = 0;
    // ★**殴りの勢いも戻す**（2026-09-15）。`arms` だけ消してここを忘れると、
    // 次のボスが出た最初の 0.2秒ほど、前のボスの勢いで腕と体が揺れる
    this.punchK = 0;
    this.punchT = 0;
  }

  dispose(): void {
    this.clear();
  }
}
