// useCommands の onDiffEvents 引数(Issue #317。useWorldState への委譲)専用の
// テスト。useCommands.test.tsx は既にコマンド発行・ゴースト等の関心事で
// 大きいため、この配線1点だけを別ファイルに分ける
// (CLAUDE.md「1ファイル1責務をテストファイルにも適用する」)。

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "../i18n/i18n.js";
import type { MessageKey } from "../i18n/messages.js";
import type { ChainvizClient, ChainvizClientHandlers } from "../websocket/client.js";
import type { ClientFactory } from "../world-state/useWorldState.js";
import { useCommands } from "./useCommands.js";

const t = (key: MessageKey) => translate(key, "en");

afterEach(cleanup);

describe("useCommands onDiffEvents wiring (Issue #317)", () => {
  it("forwards onDiffEvents through to useWorldState", () => {
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers): ChainvizClient => {
      captured = handlers;
      return {
        connect() {},
        disconnect() {},
        sendCommand: () => "cmd-1",
        getStatus: () => "connected",
      };
    };
    const notify = vi.fn();
    const onDiffEvents = vi.fn();

    renderHook(() => useCommands(factory, notify, t, onDiffEvents));

    act(() => {
      captured?.onDiff?.([{ type: "entityRemoved", id: "ghost" }]);
    });

    expect(onDiffEvents).toHaveBeenCalledTimes(1);
  });

  it("does not throw when onDiffEvents is omitted", () => {
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers): ChainvizClient => {
      captured = handlers;
      return {
        connect() {},
        disconnect() {},
        sendCommand: () => "cmd-1",
        getStatus: () => "connected",
      };
    };
    const notify = vi.fn();

    renderHook(() => useCommands(factory, notify, t));

    expect(() => {
      act(() => {
        captured?.onDiff?.([{ type: "entityRemoved", id: "ghost" }]);
      });
    }).not.toThrow();
  });
});
