// Prometheus のテキストエクスポジション形式（# HELP / # TYPE コメント +
// `metric_name{label="value",...} value` 形式のサンプル行）を読む汎用パーサー。
// reth（Ethereum プロファイル）固有の語彙はここには一切持ち込まない
// （どのチェーンの Prometheus エクスポータの出力にも使い回せる。チェーン固有の
// メトリクス名の解釈は reth-metrics.ts の責務とする。CLAUDE.md「ChainAdapter 境界」）。
//
// フォーマットの参考: https://github.com/prometheus/docs/blob/main/content/docs/instrumenting/exposition_formats.md
// 完全な OpenMetrics 仕様への準拠は目指さない。reth（`metrics-exporter-prometheus`
// クレート由来）が実際に出力する形（counter/gauge/summary、ラベル付き/無し、
// `+Inf`/`-Inf`/`NaN`）を実機の `/metrics` 出力で確認した範囲をカバーする。

/** 1 サンプル行（ラベル集合 + 値）。 */
export interface PromSample {
  labels: Record<string, string>;
  value: number;
}

/**
 * パース結果。`samples` は行に現れた**そのままの**メトリクス名（summary の
 * `_sum` / `_count` サフィックス付きの名前もそれぞれ別キーとして持つ）を
 * キーにする。`help` / `type` は `# HELP <name> ...` / `# TYPE <name> ...`
 * コメントで宣言された名前（サフィックス無しの「ファミリー名」）をキーにする。
 */
export interface ParsedMetrics {
  samples: Map<string, PromSample[]>;
  help: Map<string, string>;
  type: Map<string, string>;
}

/** ラベル無しメトリクスの最初のサンプル値を返す（無ければ undefined）。 */
export function firstValue(
  parsed: ParsedMetrics,
  metricName: string,
): number | undefined {
  return parsed.samples.get(metricName)?.[0]?.value;
}

/** 指定メトリクス名の全サンプルを返す（無ければ空配列）。 */
export function samplesOf(
  parsed: ParsedMetrics,
  metricName: string,
): PromSample[] {
  return parsed.samples.get(metricName) ?? [];
}

/** 10 進数（整数・小数・指数表記、符号付き）にマッチする値トークンの形。 */
const NUMERIC_TOKEN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Prometheus 値トークンを number へ変換する。`+Inf` / `-Inf` / `NaN` は正規の
 * 特殊トークンとして解釈する（`NaN` は「値が読めなかった」ことと区別する必要が
 * あるため、`Number()` に丸投げせず明示的に判定する）。それ以外は 10 進数の
 * 形として妥当な場合のみ変換し、そうでなければ undefined（＝この行は読めない
 * ので呼び出し側が読み捨てる）を返す。
 */
function parseValueToken(token: string): number | undefined {
  if (token === "+Inf") return Infinity;
  if (token === "-Inf") return -Infinity;
  if (token === "NaN") return NaN;
  if (!NUMERIC_TOKEN.test(token)) return undefined;
  return Number(token);
}

/**
 * HELP コメントのテキスト部分のエスケープ（`\\` → `\`、`\n` → 改行）を解く。
 * Prometheus のテキスト形式では HELP 行のテキスト部分でこの 2 つだけが
 * エスケープされる（ラベル値のクォート内エスケープとは別ルール）。
 */
function unescapeHelpText(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === "n") {
        result += "\n";
        i++;
        continue;
      }
      if (next === "\\") {
        result += "\\";
        i++;
        continue;
      }
    }
    result += text[i];
  }
  return result;
}

/**
 * `label="value",label2="value2"` 形式のラベル列を読む（`{` と `}` の間の
 * 中身を渡す）。値のクォート内エスケープ（`\"` / `\\` / `\n`）に対応する。
 * 想定外の形（クォートで始まらない値等）に出会ったら、そこで打ち切って
 * それまでに読めたラベルだけを返す（1 箇所の乱れで行全体を諦めない）。
 */
function parseLabels(raw: string): Record<string, string> {
  const labels: Record<string, string> = {};
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && (raw[i] === " " || raw[i] === ",")) i++;
    if (i >= raw.length) break;
    const eq = raw.indexOf("=", i);
    if (eq === -1) break;
    const name = raw.slice(i, eq).trim();
    i = eq + 1;
    while (i < raw.length && raw[i] === " ") i++;
    if (raw[i] !== '"') break;
    i++;
    let value = "";
    while (i < raw.length && raw[i] !== '"') {
      if (raw[i] === "\\" && i + 1 < raw.length) {
        const next = raw[i + 1];
        if (next === "n") value += "\n";
        else if (next === "\\") value += "\\";
        else if (next === '"') value += '"';
        else value += next;
        i += 2;
      } else {
        value += raw[i];
        i++;
      }
    }
    i++; // 閉じクォートを読み飛ばす
    if (name.length > 0) labels[name] = value;
  }
  return labels;
}

/** サンプル行（コメント・空行を除いた行）を 1 行パースする。不正なら null。 */
function parseSampleLine(
  line: string,
): { metric: string; labels: Record<string, string>; value: number } | null {
  const braceIdx = line.indexOf("{");
  let metric: string;
  let labels: Record<string, string> = {};
  let rest: string;
  if (braceIdx !== -1) {
    metric = line.slice(0, braceIdx).trim();
    const closeIdx = line.indexOf("}", braceIdx);
    if (closeIdx === -1) return null;
    labels = parseLabels(line.slice(braceIdx + 1, closeIdx));
    rest = line.slice(closeIdx + 1).trim();
  } else {
    const spaceIdx = line.search(/\s/);
    if (spaceIdx === -1) return null;
    metric = line.slice(0, spaceIdx).trim();
    rest = line.slice(spaceIdx + 1).trim();
  }
  if (!metric || rest.length === 0) return null;
  // rest は "value" または "value timestamp"。先頭トークンだけを値として使う
  // （タイムスタンプは扱わない。collector 側はスクレイプした瞬間を別途 own の
  // 時刻ソースで扱うため、reth が付けるタイムスタンプに依存しない）。
  const valueToken = rest.split(/\s+/)[0];
  const value = parseValueToken(valueToken);
  if (value === undefined) return null;
  return { metric, labels, value };
}

/**
 * Prometheus テキスト形式全体をパースする。1 行ずつ独立に解釈し、個々の行が
 * 不正でもその行だけ読み捨てて残りは継続する（1 メトリクスの乱れで全体を
 * 諦めない。reth のイメージ更新でメトリクス名・形が変わっても、認識できる
 * 範囲は使い続けられるようにするため）。
 */
export function parsePrometheusText(text: string): ParsedMetrics {
  const samples = new Map<string, PromSample[]>();
  const help = new Map<string, string>();
  const type = new Map<string, string>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith("#")) {
      const helpMatch = /^#\s*HELP\s+(\S+)\s+(.*)$/.exec(line);
      if (helpMatch) {
        help.set(helpMatch[1], unescapeHelpText(helpMatch[2]));
        continue;
      }
      const typeMatch = /^#\s*TYPE\s+(\S+)\s+(\S+)$/.exec(line);
      if (typeMatch) {
        type.set(typeMatch[1], typeMatch[2]);
        continue;
      }
      // その他のコメント（例: 将来の `# EOF` 等）は読み捨てる。
      continue;
    }
    const parsed = parseSampleLine(line);
    if (!parsed) continue;
    const list = samples.get(parsed.metric);
    if (list) list.push({ labels: parsed.labels, value: parsed.value });
    else samples.set(parsed.metric, [{ labels: parsed.labels, value: parsed.value }]);
  }

  return { samples, help, type };
}
