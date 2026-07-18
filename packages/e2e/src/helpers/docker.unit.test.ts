// deployUncatalogedContractInWorkbench（helpers/docker.ts）が組み立てる
// `docker compose exec` の引数を検証するユニットテスト。
//
// この関数は実 Docker への薄い委譲だが、本体（コンテナ）の環境を変えずに
// exec 実行にだけ RPC 向き先を上書きする、という Issue #381 の修正の核心が
// 「引数の並び」に凝縮されている（`-e ETH_RPC_URL=...` をサービス名より前に
// 置く、`-T` を付ける、プロキシポートを URL に正しく埋め込む）。実 Docker に
// 頼らず `node:child_process` の execFile をモックして、この引数組み立てだけを
// 回帰対象として固定する。docker やネットワークに依存しないため
// vitest.unit.config.ts 側（pnpm test）で回る。

import { afterEach, describe, expect, it, vi } from "vitest";

// execFile を差し替える。docker.ts は `promisify(execFile)` でラップしてから
// 呼ぶため、モックは execFile のコールバック規約 `(err, result)` に従い、
// promisify が解決に使う先頭値として `{ stdout }` を返す。
const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, result: { stdout: string }) => void,
    ) => cb(null, { stdout: "" }),
  ),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import { deployUncatalogedContractInWorkbench } from "./docker.js";

/** 直近の execFile 呼び出しで docker に渡された引数配列を取り出す。 */
function lastComposeArgs(): string[] {
  const calls = execFileMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [cmd, args] = calls[calls.length - 1];
  expect(cmd).toBe("docker");
  return args as string[];
}

describe("deployUncatalogedContractInWorkbench", () => {
  afterEach(() => {
    execFileMock.mockClear();
  });

  it("渡された proxyPort をロギングプロキシの ETH_RPC_URL に埋め込む", async () => {
    await deployUncatalogedContractInWorkbench(4126);

    const args = lastComposeArgs();
    expect(args).toContain("ETH_RPC_URL=http://host.docker.internal:4126");
  });

  it("proxyPort が変わると ETH_RPC_URL のポートも追従する（決め打ちしない）", async () => {
    await deployUncatalogedContractInWorkbench(4902);

    const args = lastComposeArgs();
    expect(args).toContain("ETH_RPC_URL=http://host.docker.internal:4902");
    // 旧固定値 4001（dev collector プロキシ）へ退行していないこと。
    expect(args.join(" ")).not.toContain("host.docker.internal:4001");
  });

  it("`-e ETH_RPC_URL=...` をサービス名 workbench より前に置く（compose exec のオプション位置）", async () => {
    await deployUncatalogedContractInWorkbench(4126);

    const args = lastComposeArgs();
    const dashE = args.indexOf("-e");
    const envArg = args.indexOf("ETH_RPC_URL=http://host.docker.internal:4126");
    const workbench = args.indexOf("workbench");

    // docker compose exec のオプション（-T / -e）はサービス名の前でなければ
    // ならない。サービス名の後ろに置くとコンテナ内コマンドの引数として
    // 解釈され、環境変数の上書きが効かなくなる（本 Issue の退行検出）。
    expect(dashE).toBeGreaterThanOrEqual(0);
    expect(workbench).toBeGreaterThanOrEqual(0);
    expect(dashE).toBeLessThan(workbench);
    expect(envArg).toBe(dashE + 1);
    expect(envArg).toBeLessThan(workbench);
  });

  it("TTY 無効化フラグ -T を付ける（非対話の exec）", async () => {
    await deployUncatalogedContractInWorkbench(4126);

    const args = lastComposeArgs();
    const dashT = args.indexOf("-T");
    const workbench = args.indexOf("workbench");
    expect(dashT).toBeGreaterThanOrEqual(0);
    expect(dashT).toBeLessThan(workbench);
  });

  it("mnemonic はコンテナ内シェルの $EL_AND_CL_MNEMONIC 展開に委ね、値を二重管理しない", async () => {
    await deployUncatalogedContractInWorkbench(4126);

    const args = lastComposeArgs();
    // sh -c '...forge create...' の形で渡し、シェル変数展開を使う。
    expect(args).toContain("sh");
    expect(args).toContain("-c");
    const script = args[args.length - 1];
    expect(script).toContain("forge create Counter");
    expect(script).toContain('"$EL_AND_CL_MNEMONIC"');
  });

  it("compose ファイルを -f で明示し、exec サブコマンドで実行する", async () => {
    await deployUncatalogedContractInWorkbench(4126);

    const args = lastComposeArgs();
    expect(args[0]).toBe("compose");
    expect(args).toContain("-f");
    expect(args).toContain("exec");
    // exec は -f <composeFile> の後（compose のグローバルオプションの後）。
    expect(args.indexOf("exec")).toBeGreaterThan(args.indexOf("-f"));
  });
});
