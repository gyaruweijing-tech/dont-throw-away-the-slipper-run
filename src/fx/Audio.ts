/**
 * SE（PROGRESS §7 の fx/Audio.ts）。Phase 2 はゲートぶんだけ。
 * BGM と全体の音づくりは Phase 6（ジュース）でやる。
 *
 * 方針:
 *  - **全部 WebAudio の合成音**。音源ファイルを1バイトも積まない（初回DL 8MB 目標・§6）
 *  - AudioContext はユーザー操作があるまで作らない（自動再生ポリシー。作ると suspended で溜まる）
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastTick = -1;
  /** 社員の騒音。**鳴らしっぱなしのオシレータを1本だけ持ち、音量だけ動かす**。
   *  毎フレーム作り直すとプチプチ鳴るし、GC も走る */
  private noiseOsc: OscillatorNode | null = null;
  private noiseGain: GainNode | null = null;
  /** 種類ごとの最終発音時刻。**同種が固まって鳴ると音が割れる**ので間引きに使う */
  private readonly last: Record<string, number> = {};
  /**
   * ★**ミュートは自分で覚えておく**（2026-09-29）。`master` は最初のタップまで作られないので、
   * `master` にだけ書くと「起動直後にミュート → 最初のタップで鳴る」になる。`unlock()` で反映する
   */
  private muted = false;
  /** BGM（2026-09-29）。鳴らしている間だけ `bgmTimer` が生きている */
  private bgmGain: GainNode | null = null;
  private bgmTimer = 0;
  private bgmNext = 0;
  private bgmStep = 0;

  /** 最初のクリック／キーで呼ぶ */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.32;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.32;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * ★**タブが隠れたら音の時計ごと止める**（2026-09-29）。止めないと、戻った瞬間に
   * 溜まった BGM の予約が一斉に鳴る。ポータルの広告中もここを呼べば止まる
   */
  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  /**
   * ★★**BGM**（2026-09-29）。走行中（RUN / BOSS）だけ鳴らし、ゴール・ホーム・リザルトでは止める。
   * ★ファンファーレ・扉の音を立たせるため、区切りの場面は無音にしておく。
   *
   * ★**音源ファイルは積まない**（§6 の初回DL）。SE と同じ合成音で、16小節をその場で並べる。
   * 「くだらない使命に、大まじめで出発する朝」なので、**行進の2拍子**・ハ長調・弱めの音量。
   * ★SE（増えた／減った）が主役なので BGM は master の 0.28 倍に抑える。
   * ★先読み方式（0.1秒ごとに 0.35秒先まで予約）。`setTimeout` のずれが音のずれにならない
   */
  bgm(on: boolean): void {
    if (!on) {
      if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = 0; }
      if (this.bgmGain && this.ctx) {
        const g = this.bgmGain;
        g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06);
        this.bgmGain = null;
        setTimeout(() => g.disconnect(), 600);
      }
      return;
    }
    const ctx = this.ctx;
    if (!ctx || !this.master || this.bgmTimer) return;
    const g = ctx.createGain();
    g.gain.value = 0.28;
    g.connect(this.master);
    this.bgmGain = g;
    this.bgmStep = 0;
    this.bgmNext = ctx.currentTime + 0.05;
    const schedule = (): void => {
      if (!this.ctx || !this.bgmGain) return;
      while (this.bgmNext < this.ctx.currentTime + 0.35) {
        this.bgmNote(this.bgmStep, this.bgmNext);
        this.bgmNext += BGM_STEP;
        this.bgmStep = (this.bgmStep + 1) % (BGM_MELODY.length);
      }
    };
    schedule();
    this.bgmTimer = window.setInterval(schedule, 100);
  }

  /** BGM の8分音符1つぶん（ベース・和音の裏拍・旋律） */
  private bgmNote(step: number, t: number): void {
    const bar = Math.floor(step / 8);
    const chord = BGM_CHORDS[bar % BGM_CHORDS.length];
    const beat = step % 8;
    // ベース: 表拍（1・3拍目）で根音、2・4拍目で5度 ＝ 行進の「ズン・チャ」
    if (beat % 2 === 0) {
      const f = beat % 4 === 0 ? chord[0] / 2 : chord[2] / 2;
      this.tone('triangle', f, t, BGM_STEP * 1.6, 0.55);
    } else {
      // 裏拍の和音（小さく短く）
      this.tone('square', chord[1] * 2, t, 0.05, 0.05);
      this.tone('square', chord[2] * 2, t, 0.05, 0.04);
    }
    const m = BGM_MELODY[step];
    if (m > 0) this.tone('triangle', m, t, BGM_STEP * 0.9, 0.26);
  }

  /** BGM 用の1音。`blip` と違って音程は動かさず、行き先が bgmGain */
  private tone(type: OscillatorType, f: number, t: number, dur: number, vol: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.bgmGain) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.bgmGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** 増えた。上がる二音＝「得した」と分かる最小の形 */
  gain(): void {
    this.blip('triangle', 520, 880, 0.13, 0.9);
    this.blip('triangle', 780, 1320, 0.16, 0.5, 0.05);
  }

  /** 減った。濁った下降。§4-D の社員の低音と同じ族にしておく */
  loss(): void {
    /*
     * ★★**2026-09-15 夜: 柔らかくした**（本人「**音はもう少し柔らかくしてほしい**」）。
     *
     * ★**前は `sawtooth`（のこぎり波）で 300→90Hz を 0.26秒で落としていた。**
     * のこぎり波は**倍音が全部入る**ので、耳には「ビリッ」と刺さる。
     * しかもこの音は**当たるたびに鳴る**（走行中に何度も）ので、刺さる音だと疲れる。
     *
     * ★**変えたのは3つ**:
     *  ① 波形を `triangle`（三角波）へ ―― 倍音が少なく、丸い
     *  ② 落差を 300→90 から **260→130** へ（落ちすぎると「失敗」の意味が強くなる）
     *  ③ ★**立ち上がりを 12ms → 34ms**。**アタックが速いほど「打撃」に、遅いほど「ふわっ」と聞こえる**
     * ★下に `sine` を薄く重ねて芯を丸くする（単体だと軽すぎて聞こえない）
     */
    this.blip('triangle', 260, 130, 0.24, 0.52, 0, 0.034);
    this.blip('sine', 170, 110, 0.18, 0.24, 0.015, 0.03);
  }

  /*
   * ★**ゲームオーバー**（2026-09-14・本人「**うわあ～っていう音とか、ゲームオーバーの音が鳴って**」）。
   *
   * ★**`loss` とは別物にする。** `loss` は「減った」で走行中に何度も鳴るので、
   * 同じ音で終わると**ただの被弾に聞こえて「終わった」が伝わらない**。
   * 3段に落とす ―― **短い2音で落ち、最後に長く沈む**。マリオの落下音がこの形。
   * ★**音源ファイルは使わない**（初回DL 8MB の縛り。全部その場の合成音）
   */
  /** ★巨大なボスが床に倒れた音（2026-09-16）。低く長く落ちる */
  thud(): void {
    this.blip('sine', 120, 38, 0.7, 0.9, 0, 0.004);
    this.blip('triangle', 70, 30, 0.9, 0.5, 0.02, 0.01);
  }

  slipperGone(): void {
    this.blip('square', 520, 392, 0.16, 0.5);
    this.blip('square', 392, 294, 0.18, 0.5, 0.16);
    this.blip('sawtooth', 294, 70, 0.62, 0.62, 0.34);
    // 最後に紙が落ちる乾いた音を1つ。★これが無いと「消えた」だけで「捨てられた」にならない
    this.blip('triangle', 180, 120, 0.1, 0.34, 1.15);
  }

  /** 障害物で減った。ゲートの loss より鈍く、詰まった音にする（§4-D: 痛いこと自体を伝える） */
  hit(): void {
    this.blip('square', 220, 60, 0.2, 0.6);
    this.blip('sawtooth', 140, 55, 0.3, 0.4, 0.02);
  }

  /**
   * 味方が説得されて離脱した（§4-E: 死なずにグレーで抜ける）。
   * ゲート1回で何十体も抜けるので**必ず間引いて薄く**鳴らす。
   * ここが主役になると「減った」の主音（loss / hit）を潰してしまう。
   */
  leave(): void {
    if (!this.throttled('leave', 0.08)) return;
    this.blip('sine', 430, 170, 0.1, 0.11);
  }

  /** 壇を1段登った ＝ 罪状が1行消えた（§4-I の判子）。短く詰まった打刻音 */
  stamp(): void {
    this.blip('square', 190, 70, 0.09, 0.5);
    this.blip('triangle', 900, 320, 0.035, 0.28);
  }

  /** 味方を1人ずつ壇へ払っている粒（§4-E の消費式）。tick より低く柔らかい */
  pay(): void {
    if (!this.throttled('pay', 0.045)) return;
    this.blip('sine', 660, 470, 0.055, 0.16);
  }

  /** 最上段まで届いて扉が開く（§4-E: 信じてもらえた）。ゲーム中で一番報われる音 */
  door(): void {
    this.blip('triangle', 220, 660, 0.9, 0.45);
    this.blip('sine', 330, 990, 1.0, 0.3, 0.06);
  }

  /**
   * ★**勝ったときのファンファーレ**（2026-09-06 夜・本人指定）。
   *
   * 本人の言葉:「**モンハンだっていつもあの音楽と「目標を達成しました」みたいな文字が出るからこそ
   * 達成感がでる**」。★**音が無いと、判子はただの絵**になる。
   *
   * ★**音源は積まない**（§6 の初回DL 8MB）。既存の `blip` を**遅延で並べるだけ**で作る。
   * 上りの3音 → 最後の1音を伸ばす、という**世界中の「勝った」の形**をそのまま使う。
   * 低い根音を下に敷くと、同じ音形でも「小さな正解音」ではなく「区切り」に聞こえる
   */
  fanfare(): void {
    // 上がる3音（ド・ミ・ソ）。短く歯切れよく
    this.blip('triangle', 523, 523, 0.12, 0.5, 0.00);
    this.blip('triangle', 659, 659, 0.12, 0.5, 0.13);
    this.blip('triangle', 784, 784, 0.12, 0.5, 0.26);
    // 着地（高いド）。ここだけ伸ばす
    this.blip('triangle', 1047, 1047, 0.62, 0.6, 0.40);
    this.blip('square', 1047, 1047, 0.30, 0.16, 0.40);
    // 下に敷く根音。**これが無いと「得した」の音と区別が付かない**
    this.blip('sine', 262, 262, 0.85, 0.30, 0.40);
  }

  /**
   * 社員の騒音（§4-D）。**濁った低音の音量を距離で連続的に動かす。**
   * 逃げると静かになる、が快感の本体なので、ここは離散的に切り替えない。
   * @param level 0..1
   */
  noise(level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (!this.noiseOsc) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      // 濁らせるために低い矩形波。整数比でない揺れを付けて「がーがー」に寄せる
      osc.type = 'square';
      osc.frequency.value = 62;
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 7.5;
      lfoGain.gain.value = 16;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      g.gain.value = 0;
      osc.connect(g);
      g.connect(this.master);
      osc.start();
      lfo.start();
      this.noiseOsc = osc;
      this.noiseGain = g;
    }
    // 急に切り替えるとブツッと鳴るので必ず時定数で寄せる
    this.noiseGain?.gain.setTargetAtTime(level * level * 0.55, ctx.currentTime, 0.08);
  }

  /**
   * 味方が1体湧くたびの粒。**必ず間引く** —
   * +700人を1体ずつ鳴らすと 700 音が同時に出て割れる（湧きは 0.35 秒で出し切る仕様）
   */
  tick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t - this.lastTick < 0.035) return;
    this.lastTick = t;
    this.blip('square', 1400 + Math.random() * 500, 900, 0.04, 0.18);
  }

  /** 同種の音が固まるのを防ぐ。@returns 鳴らしてよいか */
  private throttled(key: string, sec: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const t = ctx.currentTime;
    if (t - (this.last[key] ?? -1) < sec) return false;
    this.last[key] = t;
    return true;
  }

  private blip(
    type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0,
    /** ★立ち上がりの秒数。**短いほど打撃音、長いほど柔らかい**（2026-09-15 追加） */
    attack = 0.012,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    // クリックノイズを避けるため必ず立ち上がりと減衰を付ける
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}

/* ================= BGM の譜面（2026-09-29） ================= */
/** 8分音符1つの秒数（テンポ 132） */
const BGM_STEP = 60 / 132 / 2;
const C4 = 261.63, D4 = 293.66, E4 = 329.63, F4 = 349.23, G4 = 392.0, A4 = 440.0, B4 = 493.88;
const C5 = 523.25, D5 = 587.33, E5 = 659.25;
/** 小節ごとの和音 [根音, 3度, 5度]（C → Am → F → G の繰り返し。ベースは根音の1オクターブ下） */
const A3 = 220.0, F3 = 174.61, G3 = 196.0;
const BGM_CHORDS: readonly (readonly number[])[] = [
  [C4, E4, G4], [A3, C4, E4], [F3, A3, C4], [G3, B4 / 2, D4],
]
/** 旋律（8分音符・0 は休符）。4小節 × 4 ＝ 16小節。3回目だけ上に上がって、4回目で締める */
const BGM_MELODY: readonly number[] = [
  // 1〜4
  E5, 0, C5, 0, D5, E5, D5, 0,   C5, 0, A4, 0, C5, 0, 0, 0,
  A4, 0, C5, A4, F4, 0, A4, 0,   G4, 0, B4, 0, D5, 0, 0, 0,
  // 5〜8
  E5, 0, C5, 0, D5, E5, D5, 0,   C5, 0, A4, 0, E5, D5, C5, 0,
  A4, 0, C5, 0, F4, A4, C5, 0,   B4, 0, D5, 0, G4, 0, 0, 0,
  // 9〜12（上がる）
  G4, C5, E5, 0, E5, 0, D5, C5,  C5, 0, E5, 0, A4, 0, 0, 0,
  A4, C5, F4, 0, A4, 0, C5, D5,  D5, 0, B4, 0, G4, B4, D5, 0,
  // 13〜16（締め）
  E5, 0, D5, C5, D5, 0, E5, 0,   C5, 0, A4, 0, C5, 0, E5, 0,
  F4, 0, A4, 0, C5, 0, A4, 0,    G4, 0, D5, 0, C5, 0, 0, 0,
];
