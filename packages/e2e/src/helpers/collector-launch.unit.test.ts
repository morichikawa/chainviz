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

describe("detectLaunchStatus - 異常系・境界値 (Issue #254)", () => {
  it("WebSocket・ロギングプロキシ両方が同時に EADDRINUSE でも portInUse と判定する", () => {
    // WS ポートもロギングプロキシポートも同時に専有されているケース。
    // どちらの listen も失敗するため、両方の EADDRINUSE ログが並ぶ。
    const status = detectLaunchStatus({
      logs:
        "[collector] fatal: Error: listen EADDRINUSE: address already in use 0.0.0.0:4123\n" +
        "[collector] fatal: Error: listen EADDRINUSE: address already in use 0.0.0.0:4124\n",
      port: 4123,
      proxyPort: 4124,
      exited: true,
      exitCode: 1,
    });
    expect(status).toEqual({ kind: "portInUse" });
  });

  it("ロギングプロキシ側の EADDRINUSE が WS の listening ログより先に現れても portInUse と判定する", () => {
    // ログの出現順に依存せず、どちらのエラーが先に検出されても失敗として
    // 扱えることを確認する。main() の実際の起動順とは逆順（proxy の失敗が
    // WS の listening より前に見えている）でも、EADDRINUSE 最優先の判定が
    // 効いていれば portInUse になる。
    const status = detectLaunchStatus({
      logs:
        "[collector] fatal: Error: listen EADDRINUSE: address already in use 0.0.0.0:4124\n" +
        "[collector] WebSocket server listening on port 4123\n",
      port: 4123,
      proxyPort: 4124,
      exited: true,
      exitCode: 1,
    });
    expect(status).toEqual({ kind: "portInUse" });
  });

  it("両方の listening ログが揃っていても EADDRINUSE が混在していれば安全側に portInUse を優先する", () => {
    // 通常は起こらない組み合わせだが、EADDRINUSE 検出を最優先にする設計を
    // 明示的に固定する。片方の listen が成功しても、ログに EADDRINUSE が
    // あれば「使えない collector」として扱う。
    const status = detectLaunchStatus({
      logs:
        "[collector] WebSocket server listening on port 4123\n" +
        "[collector] logging proxy listening on port 4124 -> http://target\n" +
        "[collector] fatal: Error: listen EADDRINUSE: address already in use 0.0.0.0:4124\n",
      port: 4123,
      proxyPort: 4124,
      exited: false,
      exitCode: null,
    });
    expect(status).toEqual({ kind: "portInUse" });
  });

  it("ロギングプロキシ側が EADDRINUSE 以外の理由(EACCES)で終了したら握りつぶさず crashed と判定する", () => {
    // 権限エラーなど EADDRINUSE 以外の listen 失敗は portInUse には該当
    // しない。WS は listening 済みでもロギングプロキシが失敗して終了すれば、
    // 「起動成功」と誤認せず crashed として扱い、終了コードを保持する。
    const status = detectLaunchStatus({
      logs:
        "[collector] WebSocket server listening on port 4123\n" +
        "[collector] fatal: Error: listen EACCES: permission denied 0.0.0.0:4124\n",
      port: 4123,
      proxyPort: 4124,
      exited: true,
      exitCode: 1,
    });
    expect(status).toEqual({ kind: "crashed", exitCode: 1 });
  });

  it("EACCES 等の失敗でクラッシュした場合、その原因ログが crashedMessage に残る（握りつぶさない）", () => {
    // crashed 判定のあと呼び出し元が投げるエラーメッセージに、具体的な
    // 失敗理由（EACCES）が失われず含まれることを確認する。
    const logs =
      "[collector] WebSocket server listening on port 4123\n" +
      "[collector] fatal: Error: listen EACCES: permission denied 0.0.0.0:4124\n";
    expect(crashedMessage(1, logs)).toContain("EACCES");
  });

  it("シグナルで kill され exitCode が null のまま終了したら crashed(exitCode null) と判定する", () => {
    // SIGKILL 等で終了すると exitCode が null になる。listening も EADDRINUSE
    // も無いまま終了した場合、null をそのまま crashed に伝える。
    const status = detectLaunchStatus({
      logs: "[collector] WebSocket server listening on port 4123\n",
      port: 4123,
      proxyPort: 4124,
      exited: true,
      exitCode: null,
    });
    expect(status).toEqual({ kind: "crashed", exitCode: null });
  });

  it("WS だけ listening でプロセスも終了もしていない間は pending を返し続ける（タイムアウト待ちに委ねる）", () => {
    // 片方の listening ログだけ来て、もう片方がいつまでも来ない状況では
    // detectLaunchStatus は listening にも crashed にもせず pending を返す。
    // これにより waitForOwnProcessToListen 側の有限タイムアウトで打ち切られ、
    // 誤って「起動成功」を確定させてハングすることがない。
    const status = detectLaunchStatus({
      logs: "[collector] WebSocket server listening on port 4123\n",
      port: 4123,
      proxyPort: 4124,
      exited: false,
      exitCode: null,
    });
    expect(status.kind).toBe("pending");
  });

  it("隣接ポート(port と port+1)でも WS/プロキシの listening ログを取り違えない", () => {
    // 既定の proxyPort = port + 1 という関係上、2 つのポート番号が隣接する。
    // 判定はポート番号だけでなく "WebSocket server" / "logging proxy" という
    // 別々の接頭辞も見るため、WS の listening ログだけではロギングプロキシ側が
    // listening 済みとは判定されない（数値の部分一致で誤判定しない）。
    const status = detectLaunchStatus({
      logs: "[collector] WebSocket server listening on port 4123\n",
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
