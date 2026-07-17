import { describe, expect, it } from "vitest";
import {
  COMPOSE_PROJECT_LABEL,
  COMPOSE_SERVICE_LABEL,
  CONFIG_HASH_LABEL,
  MANAGED_LABEL,
  P2P_ROLE_LABEL,
  ROLE_LABEL,
} from "./labels.js";

// labels.ts は「ラベルキー文字列の唯一の定義元」という責務を持つ（同じ文字列
// リテラルが node-lifecycle.ts / classify.ts に重複して食い違うのを防ぐため）。
// ここではその定数群が満たすべき不変条件（正確なキー・命名規約・キーの一意性）
// を固定し、うっかり別の値に書き換わったり衝突したりする回帰を検出する。

/** compose が自動付与するラベル（collector が compose 互換として合わせる）。 */
const COMPOSE_LABELS = {
  COMPOSE_PROJECT_LABEL,
  COMPOSE_SERVICE_LABEL,
  CONFIG_HASH_LABEL,
} as const;

/** collector 独自のラベル。 */
const CHAINVIZ_LABELS = {
  MANAGED_LABEL,
  ROLE_LABEL,
  P2P_ROLE_LABEL,
} as const;

describe("ethereum docker label constants", () => {
  it("pins the exact compose-native label keys", () => {
    // これらは Docker Compose 側が解釈する固定キー名であり、綴りを変えると
    // Compose がコンテナを認識しなくなる（CONFIG_HASH_LABEL は Issue #359 の
    // 中心。project/service だけでは down -v --remove-orphans が孤児検出でき
    // なかった）。ハードコードで固定して不用意な変更を検出する。
    expect(COMPOSE_PROJECT_LABEL).toBe("com.docker.compose.project");
    expect(COMPOSE_SERVICE_LABEL).toBe("com.docker.compose.service");
    expect(CONFIG_HASH_LABEL).toBe("com.docker.compose.config-hash");
  });

  it("pins the exact chainviz-specific label keys", () => {
    expect(MANAGED_LABEL).toBe("com.chainviz.managed");
    expect(ROLE_LABEL).toBe("com.chainviz.role");
    expect(P2P_ROLE_LABEL).toBe("com.chainviz.p2p-role");
  });

  it("namespaces every compose-native label under com.docker.compose.", () => {
    for (const [name, value] of Object.entries(COMPOSE_LABELS)) {
      expect(value, name).toMatch(/^com\.docker\.compose\./);
    }
  });

  it("namespaces every chainviz label under com.chainviz.", () => {
    // ROLE_LABEL / P2P_ROLE_LABEL は「別軸」であることを命名でも表す
    // （labels.ts のコメント）。両方 com.chainviz. 名前空間で衝突しないこと。
    for (const [name, value] of Object.entries(CHAINVIZ_LABELS)) {
      expect(value, name).toMatch(/^com\.chainviz\./);
    }
  });

  it("keeps every label key distinct (no accidental duplicate string)", () => {
    // 定数同士が同じ文字列を指すと、片方への付与がもう片方を上書きして
    // 静かに壊れる。全キーが相異なることを保証する。
    const keys = [
      ...Object.values(COMPOSE_LABELS),
      ...Object.values(CHAINVIZ_LABELS),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
