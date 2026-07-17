// 設計メモ §3・§5.6 の設計不変条件「P2P のブロック伝播は各ノードの『受信』
// として記録し、送信経路（誰が誰へ送ったか）は断定しない」を文言・構造の
// 両面で固定するテスト。commsLogText.test.ts の通常の文言テストとは別に、
// この不変条件が将来の文言変更で崩れないことを守る回帰用として分離する
// （CLAUDE.md のテスト分割方針）。
import { describe, expect, it } from "vitest";
import { translate } from "../i18n/i18n.js";
import type { Language, MessageKey } from "../i18n/messages.js";
import type { CommsLogEntry } from "./commsLogEntry.js";
import { describeCommsLogEntry } from "./commsLogText.js";

const languages: Language[] = ["ja", "en"];

function blockEntry(isOrigin: boolean): CommsLogEntry {
  return {
    id: "b1",
    category: "block",
    timestamp: 1_000,
    actorIds: ["reth-1"],
    nodeId: "reth-1",
    nodeLabel: "chainviz-reth-1",
    blockNumber: 42,
    relativeDelayMs: isOrigin ? 0 : 420,
    isOrigin,
  };
}

function peerEntry(): CommsLogEntry {
  return {
    id: "p1",
    category: "peer",
    timestamp: 1_000,
    actorIds: ["reth-1", "reth-2"],
    fromNodeId: "reth-1",
    fromLabel: "chainviz-reth-1",
    toNodeId: "reth-2",
    toLabel: "chainviz-reth-2",
    networkId: "1337",
    change: "connected",
  };
}

describe("comms log wording: block propagation is stated as reception, never as a send path", () => {
  for (const language of languages) {
    const t = (key: MessageKey) => translate(key, language);

    it(`(${language}) block subject is the single receiving node, with no directional sender arrow`, () => {
      for (const isOrigin of [true, false]) {
        const { subject, body } = describeCommsLogEntry(blockEntry(isOrigin), t);
        // 主体は受信ノード単体。"A → B" のような送信方向を示す矢印を含まない。
        expect(subject).toBe("chainviz-reth-1");
        expect(subject).not.toContain("→");
        expect(body).not.toContain("→");
      }
    });

    it(`(${language}) block body uses a reception verb (does not name a sender)`, () => {
      const receptionVerb = language === "ja" ? "受信" : "eceive"; // Received / receive
      expect(describeCommsLogEntry(blockEntry(true), t).body).toContain(receptionVerb);
      expect(describeCommsLogEntry(blockEntry(false), t).body).toContain(receptionVerb);
    });
  }
});

describe("comms log wording: peer link uses a bidirectional symbol (direction not asserted)", () => {
  for (const language of languages) {
    const t = (key: MessageKey) => translate(key, language);

    it(`(${language}) peer subject joins endpoints with the bidirectional arrow, not a directional one`, () => {
      const { subject } = describeCommsLogEntry(peerEntry(), t);
      expect(subject).toContain("⇄");
      expect(subject).not.toContain("→");
    });
  }
});
