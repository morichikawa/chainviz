#!/bin/sh
# コントラクトカタログ(catalog.json)の再生成スクリプト。
#
# `forge build` で src/ 配下のサンプルコントラクトをコンパイルし、
# out/ 配下に生成される標準の forge ビルド成果物 JSON(`<Name>.sol/<Name>.json`)
# の `.abi` フィールドを読み取って catalog.json を作り直す
# (docs/ARCHITECTURE.md §4「コントラクトカタログ」)。
#
# ホスト側で使う開発用スクリプトであり、どのコンテナにもマウントしない
# (generate-genesis.sh 等、コンテナのエントリポイントになるスクリプトとは
# 役割が違う。scripts/restart-node.sh と同じ位置づけ)。
#
# 実行タイミング: src/ 配下のコントラクトを追加・変更したときのみ。
# catalog.json はビルド成果物由来だが、ABI はコンパイル時刻に依存せず
# ソースだけで決まる決定的な値なので、コミットするデータファイルとして
# 扱う(CLAUDE.md「データとコードの分離」、ARCHITECTURE.md §4の決定。
# genesis のような実行時生成にはしない)。ソースを変えたら都度このスクリプトを
# 再実行し、生成された catalog.json の差分をコミットすること。
#
# 使い方(このディレクトリ profiles/ethereum/contracts で実行):
#   ./build-catalog.sh
#
# 前提:
#   - jq が必要(無ければエラーで停止する)
#   - forge がローカルに無ければ、docker-compose.yml の workbench サービスと
#     同じ ghcr.io/foundry-rs/foundry イメージを docker 経由で使ってビルドする
#     (フォールバック。foundry.toml が solc_version を固定しているため、
#     ローカル forge / イメージ経由のどちらでビルドしても同じ ABI が
#     生成される)
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

FOUNDRY_IMAGE="ghcr.io/foundry-rs/foundry:latest"

if command -v forge >/dev/null 2>&1; then
  echo "[build-catalog] ローカルの forge でビルドする"
  forge build
else
  echo "[build-catalog] forge が見つからないため docker(${FOUNDRY_IMAGE})経由でビルドする"
  command -v docker >/dev/null 2>&1 || {
    echo "[build-catalog] エラー: forge も docker も見つからない。どちらかをインストールすること" >&2
    exit 1
  }
  docker run --rm -v "${SCRIPT_DIR}:/contracts" -w /contracts "$FOUNDRY_IMAGE" "forge build"
fi

command -v jq >/dev/null 2>&1 || {
  echo "[build-catalog] エラー: jq が見つからない。インストールすること" >&2
  exit 1
}

OUT_DIR="${SCRIPT_DIR}/out"
CATALOG="${SCRIPT_DIR}/catalog.json"
TMP_CATALOG="$(mktemp)"
trap 'rm -f "$TMP_CATALOG" "${TMP_CATALOG}.next"' EXIT

echo '{}' > "$TMP_CATALOG"

# catalog.json へ 1 エントリを追記する。
#   $1 = forge 側のコントラクト名。out/<name>.sol/<name>.json というパスの
#        <name> と一致させる。catalog.json 上の catalogKey・表示名(name)
#        の両方にそのまま使う(Solidity のコントラクト名を単一の真実の
#        情報源にして、キー変換ロジックによる取り違えを避ける)
#   $2 = トークンメタ情報(symbol/decimals)の JSON。ERC20 系でなければ
#        空文字列を渡す(token フィールド自体を省略する)
#   $3 = NFT メタ情報(symbol)の JSON。ERC-721 系でなければ空文字列を渡す
#        (nft フィールド自体を省略する)。token と nft は同じエントリに
#        同時には立てない(数量ベースか個体ベースかは排他。
#        docs/ARCHITECTURE.md §13.1)
#
# ソースコードは src/<name>.sol をそのまま埋め込む
# (source: { fileName, language, code })。src/ を唯一の真実の情報源とし、
# フロントへ渡すのは常にこのビルド時点のコピー(ContractEntity.sourceCode。
# docs/worklog/issue-321.md 参照)。
add_entry() {
  contract_name="$1"
  token_json="$2"
  nft_json="$3"
  abi_path="${OUT_DIR}/${contract_name}.sol/${contract_name}.json"
  src_file_name="${contract_name}.sol"
  src_path="${SCRIPT_DIR}/src/${src_file_name}"

  if [ ! -f "$abi_path" ]; then
    echo "[build-catalog] エラー: ${abi_path} が見つからない(forge build に失敗しているか、コントラクト名の指定が誤っている)" >&2
    exit 1
  fi

  if [ ! -f "$src_path" ]; then
    echo "[build-catalog] エラー: ${src_path} が見つからない(ソースファイル名がコントラクト名と一致しているか確認すること)" >&2
    exit 1
  fi

  abi="$(jq '.abi' "$abi_path")"
  source_json="$(jq -n --arg fileName "$src_file_name" --arg language "solidity" --rawfile code "$src_path" \
    '{fileName: $fileName, language: $language, code: $code}')"
  entry="$(jq -n --arg name "$contract_name" --argjson abi "$abi" --argjson source "$source_json" \
    '{name: $name, abi: $abi, source: $source}')"
  if [ -n "$token_json" ]; then
    entry="$(printf '%s' "$entry" | jq --argjson token "$token_json" '. + {token: $token}')"
  fi
  if [ -n "$nft_json" ]; then
    entry="$(printf '%s' "$entry" | jq --argjson nft "$nft_json" '. + {nft: $nft}')"
  fi

  jq --arg key "$contract_name" --argjson entry "$entry" '. + {($key): $entry}' \
    "$TMP_CATALOG" > "${TMP_CATALOG}.next"
  mv "${TMP_CATALOG}.next" "$TMP_CATALOG"
  echo "[build-catalog]   ${contract_name} を追加した"
}

echo "[build-catalog] catalog.json を再構築する"

# ChainvizToken: symbol/decimals は src/ChainvizToken.sol の定数
# (symbol="CVZDEMO" / decimals=18)と一致させること。ABI にはこれらの値自体は
# 出てこない(constant の値であって関数シグネチャではないため)ので、
# ソースを変更した場合はここも手動で合わせて直す。
add_entry "ChainvizToken" '{"symbol": "CVZDEMO", "decimals": 18}' ""
add_entry "Counter" "" ""

# ChainvizNFT: symbol は src/ChainvizNFT.sol の定数(symbol="CVNDEMO")と
# 一致させること(token と同じ理由で ABI には出てこない)。decimals は
# 個体ベースの NFT には概念が無いため持たない(docs/ARCHITECTURE.md §13.1)。
add_entry "ChainvizNFT" "" '{"symbol": "CVNDEMO"}'

jq -S '.' "$TMP_CATALOG" > "$CATALOG"
echo "[build-catalog] 完了: ${CATALOG}"
