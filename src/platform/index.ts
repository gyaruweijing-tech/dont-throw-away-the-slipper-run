/**
 * プラットフォーム抽象層（PROGRESS §7）。
 *
 * Poki / CrazyGames はどちらも Gameplay start/stop の発火が必須。
 * 後付けするとゲームロジック中にSDK呼び出しが散らばるので、最初から1枚挟む。
 * Phase 0 では local 実装のみ。crazygames.ts / poki.ts は後で差し替える。
 */
export interface Platform {
  readonly name: string;
  /** SDK の初期化。失敗しても必ず resolve すること（ゲームを止めない） */
  init(): Promise<void>;
  /** プレイヤーが操作できる状態に入った瞬間 */
  gameplayStart(): void;
  /** リザルト・ポーズ・メニューに入った瞬間 */
  gameplayStop(): void;
  /** ロード進捗 0..1 */
  loadingProgress(p: number): void;
  save(key: string, value: unknown): void;
  load<T>(key: string, fallback: T): T;
}

import { LocalPlatform } from './local';

export const platform: Platform = new LocalPlatform();
