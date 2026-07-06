// pnpm build（tsc -b）完了後に実行し、packages/collector/dist/.build-commit
// へビルド時点の git commit hash / dirty 状態を書き込む（Issue #121）。
// package.json の "build" スクリプトから `tsc -b && node dist/build-info/write-marker.js`
// の形で呼び出す想定。

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BUILD_MARKER_FILENAME, formatBuildMarker } from "./build-marker.js";

export interface WriteBuildMarkerDeps {
  /** collector パッケージのルート（package.json がある場所）。 */
  collectorDir: string;
  /** git コマンドを実行し標準出力を返す。失敗時は例外を投げる。 */
  runGit: (args: string[]) => string;
  ensureDir: (dir: string) => void;
  writeFile: (filePath: string, content: string) => void;
}

/**
 * git の状態からマーカーファイルを書き込み、書き込み先のパスを返す。
 * git コマンド自体の失敗（.git が無い等）は呼び出し側に伝播させる
 * （握りつぶさない。呼び出し元の main() でまとめて扱う）。
 */
export function writeBuildMarker(deps: WriteBuildMarkerDeps): string {
  const commitHash = deps.runGit(["rev-parse", "HEAD"]).trim();
  const statusOutput = deps.runGit(["status", "--porcelain"]);
  const dirty = statusOutput.trim().length > 0;

  const distDir = path.join(deps.collectorDir, "dist");
  deps.ensureDir(distDir);
  const markerPath = path.join(distDir, BUILD_MARKER_FILENAME);
  deps.writeFile(markerPath, formatBuildMarker({ commitHash, dirty }));
  return markerPath;
}

/** collector パッケージのルートを解決する（dist/build-info/write-marker.js から2つ上）。 */
function resolveCollectorDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../..");
}

function createRealDeps(collectorDir: string): WriteBuildMarkerDeps {
  return {
    collectorDir,
    runGit: (args) =>
      execFileSync("git", args, { cwd: collectorDir, encoding: "utf8" }),
    ensureDir: (dir) => mkdirSync(dir, { recursive: true }),
    writeFile: (filePath, content) => writeFileSync(filePath, content, "utf8"),
  };
}

// 直接実行されたとき（ビルドスクリプトから呼ばれたとき）だけ書き込みを行う。
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  try {
    const markerPath = writeBuildMarker(createRealDeps(resolveCollectorDir()));
    console.log(`[collector] build marker written: ${markerPath}`);
  } catch (err) {
    // git が使えない（.git が無い配布物としてビルドされている等）環境も
    // ありうる。マーカーはあくまで dev-up.sh 向けの診断情報であり、
    // 書き込めないこと自体がビルドの失敗を意味しないため、警告を残した
    // うえでビルド自体は成功させる（意図的に例外を握りつぶす。理由は
    // このコメントの通り）。マーカーが無ければ dev-up.sh 側は
    // 「ビルド情報が見つかりません」として警告するので、診断能力は失われない。
    console.warn(
      "[collector] failed to write build marker (dev-up.sh will warn that build info is missing):",
      err,
    );
  }
}
