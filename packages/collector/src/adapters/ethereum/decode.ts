// コントラクトカタログの ABI を使って、tx の関数呼び出し（input）・
// イベントログ（receipt.logs）を復号する部分（Issue #162）。
//
// ABI（EVM 固有の語彙・viem への依存）はこのファイルの内側に閉じ込め、
// 呼び出し側（index.ts）には ContractCall / ContractEvent という
// チェーン非依存の型だけを返す（CLAUDE.md「ChainAdapter 境界」）。復号に
// 失敗した場合（宛先/発行元コントラクトの ABI に合致するセレクタ・
// イベント signature が無い等）は raw 識別子のみを積んで返す
// （docs/ARCHITECTURE.md §4 の「復号できないものは raw 識別子だけを載せる」方針）。

import type { ContractCall, ContractEvent, DecodedArgument } from "@chainviz/shared";
import { decodeEventLog, decodeFunctionData, type Abi, type Hex } from "viem";
import type { CatalogEntry } from "./catalog.js";
import type { RpcLog } from "./eth-rpc-client.js";

/** ABI の 1 関数/イベント要素から、名前付き引数定義だけを取り出した最小形。 */
interface AbiParamLike {
  name?: string;
  type: string;
}

/**
 * input（16 進文字列）の先頭 4 バイト（関数セレクタ）を切り出す。セレクタが
 * 無い（"0x" のみ、または 4 バイト未満）場合は undefined（純粋な value 送金
 * など、関数呼び出しではないと判定する）。
 */
function extractFunctionSelector(inputHex: string): string | undefined {
  if (!/^0x[0-9a-fA-F]{8,}$/.test(inputHex)) return undefined;
  return inputHex.slice(0, 10);
}

/** BigInt を含みうる復号値を、精度を落とさず表示用文字列に変換する。 */
function stringifyArgValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, (_key, v) =>
    typeof v === "bigint" ? v.toString(10) : v,
  );
}

/**
 * viem の decodeFunctionData/decodeEventLog が返す args（ABI の入力に名前が
 * 揃っている場合はオブジェクト、1 つでも無名の入力があれば配列、というように
 * viem 側の実装都合で形が変わる）を、ABI の入力定義（abiInputs）の順序に
 * 沿った DecodedArgument[] へ正規化する。名前が無い入力には `argN`
 * （N は 0 始まりの位置）を割り当てる。
 */
function toDecodedArgs(
  abiInputs: readonly AbiParamLike[],
  args: unknown,
): DecodedArgument[] {
  if (args === undefined) return [];
  if (Array.isArray(args)) {
    return abiInputs.map((input, i) => ({
      name: input.name && input.name.length > 0 ? input.name : `arg${i}`,
      value: stringifyArgValue(args[i]),
    }));
  }
  if (typeof args === "object" && args !== null) {
    const record = args as Record<string, unknown>;
    return abiInputs.map((input, i) => {
      const key = input.name && input.name.length > 0 ? input.name : undefined;
      return {
        name: key ?? `arg${i}`,
        value: stringifyArgValue(key !== undefined ? record[key] : undefined),
      };
    });
  }
  return [];
}

/** ABI（unknown[] 由来）から、指定した type/name の要素の inputs 定義を探す。 */
function findAbiInputs(
  abi: readonly unknown[],
  type: "function" | "event",
  name: string | undefined,
): readonly AbiParamLike[] {
  if (!name) return [];
  const item = abi.find(
    (entry): entry is { type: string; name: string; inputs: AbiParamLike[] } =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { type?: unknown }).type === type &&
      (entry as { name?: unknown }).name === name,
  );
  return item?.inputs ?? [];
}

/**
 * tx の呼び出しデータ（input）を、カタログ照合済みコントラクトの ABI で
 * 復号する。呼び出し元（index.ts）は宛先が追跡中のコントラクトであれば
 * （カタログ照合の有無に関わらず）これを呼ぶ。decodeContractEvent と対称に、
 * catalogEntry が undefined（追跡中だがカタログ未照合の「未知のコントラクト」。
 * docs/ARCHITECTURE.md §6.4）の場合も、セレクタが抽出できれば rawFunctionId
 * のみを持つ ContractCall を返す（レビュー差し戻し 2026-07-07: 以前は
 * catalogEntry が無い呼び出し元判定自体を呼び出し側で弾いていたため、未知の
 * コントラクト宛て tx に rawFunctionId が一切載らなかった）。
 *
 * input にセレクタが無い（純粋な value 送金）場合は catalogEntry の有無に
 * 関わらず undefined を返し、呼び出し側は contractCall 自体を省略する。
 * セレクタはあるが ABI に一致する関数が無い（デコード失敗、または
 * catalogEntry が undefined でそもそも ABI を持たない）場合は rawFunctionId
 * のみを持つ ContractCall を返す。
 */
export function decodeContractCall(
  catalogEntry: CatalogEntry | undefined,
  contractAddress: string,
  inputHex: string,
): ContractCall | undefined {
  const rawFunctionId = extractFunctionSelector(inputHex);
  if (!rawFunctionId) return undefined;
  const fallback: ContractCall = { contractAddress, rawFunctionId };
  if (!catalogEntry) return fallback;
  try {
    const abi = catalogEntry.abi as Abi;
    const { functionName, args } = decodeFunctionData({
      abi,
      data: inputHex as Hex,
    });
    const abiInputs = findAbiInputs(catalogEntry.abi, "function", functionName);
    return {
      contractAddress,
      functionName,
      args: toDecodedArgs(abiInputs, args),
    };
  } catch (err) {
    // ABI に一致するセレクタが無い（カタログ外の関数呼び出し、または不正な
    // input）。raw 識別子だけを残し、tx 自体の可視化は継続する。
    console.warn(
      `[ethereum] failed to decode function call ${rawFunctionId} for contract ${contractAddress}:`,
      err,
    );
    return fallback;
  }
}

/**
 * receipt の 1 ログ（未復号）を ContractEvent へ復号する。ログの発行元
 * （log.address）がカタログ照合済み（catalogEntry が渡された）場合のみ ABI
 * での復号を試みる。宛先が未追跡・未カタログ（catalogEntry が undefined）、
 * またはデコードに失敗した場合は rawEventId（topics[0]。匿名イベント等で
 * topics が空なら省略）のみを持つ ContractEvent を返す。
 */
export function decodeContractEvent(
  catalogEntry: CatalogEntry | undefined,
  log: RpcLog,
): ContractEvent {
  const rawEventId = log.topics[0];
  const fallback: ContractEvent = rawEventId
    ? { contractAddress: log.address, rawEventId }
    : { contractAddress: log.address };
  if (!catalogEntry) return fallback;

  try {
    const abi = catalogEntry.abi as Abi;
    const { eventName, args } = decodeEventLog({
      abi,
      data: log.data as Hex,
      topics: log.topics as [Hex, ...Hex[]],
    });
    const abiInputs = findAbiInputs(catalogEntry.abi, "event", eventName);
    return {
      contractAddress: log.address,
      eventName,
      args: toDecodedArgs(abiInputs, args),
    };
  } catch (err) {
    console.warn(
      `[ethereum] failed to decode event log ${rawEventId ?? "(no topics)"} for contract ${log.address}:`,
      err,
    );
    return fallback;
  }
}
