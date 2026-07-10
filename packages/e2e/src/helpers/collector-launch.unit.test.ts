// collector-launch.ts の純粋ロジック（起動状況判定）のユニットテスト。
// 子プロセスや実ソケットには一切触れないため vitest.unit.config.ts 側
// （pnpm test）で回る。

import { describe, expect, it } from "vitest";
import {
  crashedMessage,
  detectLaunchStatus,
  portInUseMessage,
} from "./collector-launch.js";

describe("detectLaunchStatus", () => {
  it("WebSocket・ロギングプロキシ両方の listening ログが出ていれば listening と判定する", () => {
    const status = detectLaunchStatus({
      logs:
        "[collector] WebSocket server listening on port 4123\n" +
        "[collector] logging proxy listening on port 4124 -> http://target\n",
      port: 4123,
      proxyPort: 4124,
      exited: false,
      exitCode: null,
    });
    expect(status).toEqual({ kind: "listening" });
  });

  it("WebSocket の listening ログしか出ていなければ pending のまま（Issue #254）", () => {
    // collector は WS を先に bind してからロギングプロキシを bind する。
    // WS だけ listening しても、ロギングプロキシがまだ失敗するかもしれない
    // 途中の状態なので、ここで確定させてはいけない。
    const status = detectLaunchStatus({
      logs: "[collector] WebSocket server listening on port 4123\n",
      port: 4123,
      proxyPort: 4124,
      exited: false,
      exitCode: null,
    });
    expect(status).toEqual({ kind: "pending" });
  });

  it("ロギングプロキシの listening ログしか出ていなければ pending のまま", () => {
    const status = detectLaunchStatus({
      logs: "[collector] logging proxy listening on port 4124 -> http://target\n",
      port: 4123,
      proxyPort: 4124,
      exited: false,
      exitCode: null,
    });
    expect(status).toEqual({ kind: "pending" });
  });

  it("別ポート宛の listening ログは無視する", () => {
    // 他プロセス（別 worktree の dev collector 等）のログが紛れ込んでも、
    // 自分が指定したポートの listening でなければ判定に使わない想定。
    const status = detectLaunchStatus({
      logs:
        "[collector] WebSocket server listening on port 4000\n" +
        "[collector] logging proxy listening on port 4001 -> http://target\n",
      port: 4123,
      proxyPort: 4124,
      exited: false,
      exitCode: null,
    });
    expect(status).toEqual({ kind: "pending" });
  });

  it("EADDRINUSE を含むログは exited 前でも portInUse と判定する", () => {
    const status = detectLaunchStatus({
      logs: "[collector] fatal: Error: listen EADDRINUSE: address already in use :::4123\n",
      port: 4123,
      proxyPort: 4124,
      exited: false,
      exitCode: null,
    });
    expect(status).toEqual({ kind: "portInUse" });
  });

  it("EADDRINUSE を含むログが exited 後でも portInUse を優先する（crashed にしない）", () => {
    const status = detectLaunchStatus({
      logs: "[collector] fatal: Error: listen EADDRINUSE: address already in use :::4123\n",
      port: 4123,
      proxyPort: 4124,
      exited: true,
      exitCode: 1,
    });
    expect(status).toEqual({ kind: "portInUse" });
  });

  it("WebSocket は listening 済みでも、後発のロギングプロキシが EADDRINUSE なら portInUse と判定する（Issue #254）", () => {
    // main() の起動順（WS → ロギングプロキシ）どおり、WS の listening ログが
    // 先に出た後でロギングプロキシの EADDRINUSE が出るケース。旧実装は WS の
    // listening ログだけで "listening" と確定させてしまい、この後発の失敗を
    // 見逃していた。
    const status = detectLaunchStatus({
      logs:
        "[collector] WebSocket server listening on port 4123\n" +
        "[collector] fatal: Error: listen EADDRINUSE: address already in use 0.0.0.0:4001\n",
      port: 4123,
      proxyPort: 4001,
      exited: true,
      exitCode: 1,
    });
    expect(status).toEqual({ kind: "portInUse" });
  });

  it("listening も EADDRINUSE も出ないまま終了したら crashed と判定する", () => {
    const status = detectLaunchStatus({
      logs: "some unrelated crash output\n",
      port: 4123,
      proxyPort: 4124,
      exited: true,
      exitCode: 1,
    });
    expect(status).toEqual({ kind: "crashed", exitCode: 1 });
  });

  it("ログも終了もまだなら pending", () => {
    const status = detectLaunchStatus({
      logs: "",
      port: 4123,
      proxyPort: 4124,
      exited: false,
      exitCode: null,
    });
    expect(status).toEqual({ kind: "pending" });
  });
});

describe("portInUseMessage", () => {
  it("原因（他プロセスとの同時実行の可能性）と両方のポート番号を含む", () => {
    const msg = portInUseMessage(4123, 4124, "some logs");
    expect(msg).toContain("4123");
    expect(msg).toContain("4124");
    expect(msg).toContain("EADDRINUSE");
    expect(msg).toContain("同時に複数実行");
    expect(msg).toContain("some logs");
  });
});

describe("crashedMessage", () => {
  it("終了コードとログを含む", () => {
    const msg = crashedMessage(1, "boom");
    expect(msg).toContain("code 1");
    expect(msg).toContain("boom");
  });
});
