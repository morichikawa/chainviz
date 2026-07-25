// Issue #420 テスト強化: Engine API（§7.6.7）と VC メトリクス（§7.6.12）の
// 2つの method 分類テーブルが、名前空間として重ならないことを固定する。
//
// `entities/internalLinkActivity.ts` の `formatInternalCallEntry` は
// `describeEngineApiMethod(method) ?? describeValidatorApiMethod(method)` の
// 2段フォールバックであり、「両テーブルの接頭辞が重ならないため誤マッチの
// 心配はない」という前提（docs/ARCHITECTURE.md §7.6.12）に依存している。
// 将来どちらかのテーブルに接頭辞を足したときにこの前提が崩れたら、ここで
// 気付けるようにする（フォーマッタ側のテストは個々の method しか見ないため、
// テーブル全体の関係はこのファイルの責務とする）。

import { describe, expect, it } from "vitest";
import {
  ENGINE_API_METHOD_LABELS,
  describeEngineApiMethod,
} from "./nodeInternals.js";
import {
  VALIDATOR_API_METHOD_LABELS,
  describeValidatorApiMethod,
} from "./validatorApiMethodLabels.js";

describe("Engine API / validator API method label namespaces", () => {
  it("has no prefix pair where one is a prefix of the other", () => {
    for (const engine of ENGINE_API_METHOD_LABELS) {
      for (const validator of VALIDATOR_API_METHOD_LABELS) {
        expect(engine.prefix.startsWith(validator.prefix)).toBe(false);
        expect(validator.prefix.startsWith(engine.prefix)).toBe(false);
      }
    }
  });

  it("never resolves a validator prefix through the Engine API table", () => {
    for (const validator of VALIDATOR_API_METHOD_LABELS) {
      expect(describeEngineApiMethod(validator.prefix)).toBeUndefined();
      expect(describeEngineApiMethod(`${validator.prefix}:success`)).toBeUndefined();
    }
  });

  it("never resolves an Engine API prefix through the validator table", () => {
    for (const engine of ENGINE_API_METHOD_LABELS) {
      expect(describeValidatorApiMethod(engine.prefix)).toBeUndefined();
      expect(describeValidatorApiMethod(`${engine.prefix}V4`)).toBeUndefined();
    }
  });

  it("keeps the two tables' labels distinct (no duplicated wording across tables)", () => {
    // 別の職務に同じ和訳／英訳が付くと、ホバーの内訳で区別できなくなる。
    const jaLabels = [
      ...ENGINE_API_METHOD_LABELS.map((entry) => entry.label.ja),
      ...VALIDATOR_API_METHOD_LABELS.map((entry) => entry.label.ja),
    ];
    const enLabels = [
      ...ENGINE_API_METHOD_LABELS.map((entry) => entry.label.en),
      ...VALIDATOR_API_METHOD_LABELS.map((entry) => entry.label.en),
    ];
    expect(new Set(jaLabels).size).toBe(jaLabels.length);
    expect(new Set(enLabels).size).toBe(enLabels.length);
  });
});
