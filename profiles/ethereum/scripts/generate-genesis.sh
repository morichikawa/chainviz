#!/bin/sh
# genesis 生成スクリプト(ethpandaops/ethereum-genesis-generator イメージ内で実行)
#
# EL(reth)用 genesis.json と CL(lighthouse)用 genesis.ssz / config.yaml、
# jwtsecret、バリデーター鍵を共有ボリューム /data に生成する。
# genesis 時刻を「現在時刻」で埋め込む。
#
# 冪等性: 共有ボリューム上に生成済みの genesis 一式が既に存在し、かつ
# スタックが稼働中だったと判断できる場合は、何もせずに終了する。稼働中
# スタックに `docker compose up -d` を再実行しても genesis サービスが再走
# して新しいタイムスタンプで上書きしてしまい、既存ノードと genesis
# ハッシュが食い違う事故を防ぐ(Issue #56)。
#
# 一方、次回起動時に全ノードが datadir を失った状態から genesis まで
# 遡って再構築しなければならない(= genesis 生成時刻からの経過時間
# 「genesis 年齢」が大きすぎる)と判断できる場合は、genesis を現在時刻で
# 自動的に作り直す。genesis 生成時刻に対して実時間が進み続ける PoS
# チェーンの性質上、genesis 年齢が大きいまま全ノードが停止すると、次回
# 起動時の空き slot 再構築が実時間に追いつけずハングするため(詳細・
# しきい値の根拠は docs/worklog/issue-148.md・issue-286.md)。
#
# 判定は2段階: (1) genesis 年齢が小さければ、稼働中でも全停止後でも
# 再構築量は安全な範囲なので常にスキップする。(2) genesis 年齢が大きい
# 場合のみ、実際に生きているノードがいるか(= 全停止していないか)を、
# 各ノードが書き出す生存報告(`/heartbeat/<ノード名>` の更新時刻)の
# 新しさ、および必要ならその前進のサンプリング観測で判定する(Issue #286。
# 「停止時間」だけでは「genesis は古いが停止は短い」down→up を見逃す
# ため、判定の入力を genesis 年齢に置き換えた)。
#
# まっさらな chain で始めたい場合は `docker compose down -v --remove-orphans`
# でボリュームごと破棄すれば、次回起動時に再生成される
# (こちらは常に有効な手動リセット。--remove-orphans が必要な理由は
# docker-compose.yml 冒頭コメント・README.md・Issue #359 を参照)。
set -e

GEN=/data/metadata
KEYS=/data/keys
# 生成完了を示すマーカー。生成処理の最後に書き出す。途中で失敗した実行は
# マーカーを残さないため、次回はやり直しになる(半端な生成物での起動を防ぐ)。
DONE_MARKER=/data/.genesis-complete
# genesis 生成時刻(epoch 秒)を記録するファイル(Issue #286)。genesis 年齢
# (= now - この値)の一次情報源。本変更より前に生成された既存ボリューム
# には無いため、その場合は DONE_MARKER の mtime にフォールバックする
# (下記 compute_genesis_age 参照)。
GENESIS_TIMESTAMP_FILE=/data/.genesis-timestamp

# --- 再生成判定のしきい値(Issue #148 / #286) ---
# 根拠は docs/worklog/issue-148.md・issue-286.md「3-3. しきい値と、その
# 前提」参照。環境変数で上書き可能(実機検証・QA で待ち時間を短縮するため)。
#   GENESIS_LIVE_THRESHOLD_SEC(既定 60秒):
#     直近この秒数以内に生存報告があれば「(down 直後の可能性を含め)まだ
#     停止が確定していない」とみなす。ハートビート間隔(既定10秒)の6倍で
#     ジッタ耐性を持つ。60秒以内の新鮮さは「生存の証明」にはならない
#     (down 直後の up も同じ見え方になる。#286 の教訓)ため、実際の生存
#     判定は下記のサンプリングに委ねる。
#   GENESIS_MAX_REBUILD_GAP_SEC(既定 600秒。実時間ベースの値であり
#     SLOT_DURATION_IN_SECONDS には依存しない。slot 数換算は values.env の
#     設定値によって変わる(例: 12秒 slot なら 50 slot 分、2秒 slot なら
#     300 slot 分)。旧 GENESIS_DOWNTIME_RESET_SEC から改名。判定量が
#     「停止時間」から「genesis 年齢(=次回起動時に再構築を要する実時間)」
#     に変わったため):
#     genesis 年齢がこれを超える場合のみ再生成を検討する(超えなければ、
#     稼働中でも全停止後でも安全に追いつける)。#139 の QA 実測(20 vCPU で
#     1350 slot ≒ 2700 秒(当時の 2秒 slot)を約90秒で追いつき、ハングは
#     3200 slot 以上でのみ観測)を踏まえ、観測ハング点の1/10以下に取った
#     安全側の値。CPU 性能に依存する値であり、特定環境の実測値ぎりぎりに
#     合わせたものではない。slot time を変更しても値そのものは変わらない
#     (Issue #322。600秒あたりの再構築 slot 数が減る方向にしか動かないため
#     安全側)。
LIVE_THRESHOLD_SEC="${GENESIS_LIVE_THRESHOLD_SEC:-60}"
MAX_REBUILD_GAP_SEC="${GENESIS_MAX_REBUILD_GAP_SEC:-600}"
# ハートビート書き込み間隔(reth-node.sh / lighthouse-bn.sh と同じ既定値。
# docker-compose.yml 側で同名の環境変数を渡し、ノード側の間隔を上書きした
# 場合は自動的にこちらにも反映される)。サンプリング窓の導出にのみ使う。
HEARTBEAT_INTERVAL_SEC="${HEARTBEAT_INTERVAL_SEC:-10}"

HEARTBEAT_DIR=/heartbeat
POISON_MARKER_NAME=suspend-detected
POISON_MARKER="${HEARTBEAT_DIR}/${POISON_MARKER_NAME}"

# /heartbeat 配下(poison マーカーを除く)の最新更新時刻(epoch 秒、整数)を
# 出力する。対象が無ければ何も出力しない(呼び出し側で「生存報告なし」として
# 扱う)。generator イメージ(Debian)の GNU find/coreutils を前提にした実装
# (busybox 等の非 GNU 環境では動かないので流用時は要確認)。
latest_heartbeat_epoch() {
  [ -d "$HEARTBEAT_DIR" ] || return 0
  find "$HEARTBEAT_DIR" -mindepth 1 -maxdepth 1 -type f \
    ! -name "$POISON_MARKER_NAME" \
    -printf '%T@\n' 2>/dev/null | cut -d. -f1 | sort -rn | head -1
}

# genesis 年齢(秒)をグローバル変数 GENESIS_AGE_SEC に代入する(Issue #286)。
# 戻り値ではなく副作用で結果を渡す設計にしているのは、フォールバック時に
# ログを出す必要があるため。$(...) コマンド置換で呼ぶとサブシェル化し、
# 中の echo が呼び出し側にログとしてではなく値としてキャプチャされて
# 壊れるので、通常の関数呼び出し(直接呼ぶ)専用とする。
GENESIS_AGE_SEC=""
compute_genesis_age() {
  now="$(date +%s)"
  if [ -f "$GENESIS_TIMESTAMP_FILE" ]; then
    genesis_ts="$(cat "$GENESIS_TIMESTAMP_FILE")"
  else
    echo "[generate] ${GENESIS_TIMESTAMP_FILE} が無い(本変更(Issue #286)より前に生成された既存ボリューム)。完了マーカー(${DONE_MARKER})の更新時刻(mtime)へフォールバックする(generator イメージの GNU coreutils 前提)。マーカーは生成完了時刻なので genesis 時刻よりバリデーター鍵導出の所要時間だけ遅く、genesis 年齢をやや過小評価し得る。"
    genesis_ts="$(stat -c %Y "$DONE_MARKER")"
  fi
  GENESIS_AGE_SEC=$(( now - genesis_ts ))
}

# 再生成するかどうかを判断し、理由を必ずログに出す(無言で分岐しない)。
# 戻り値: 0 = 再生成する / 1 = スキップする。
should_regenerate() {
  if [ ! -f "$DONE_MARKER" ]; then
    echo "[generate] 生成済みマーカー無し。初回生成として扱う。"
    return 0
  fi

  latest="$(latest_heartbeat_epoch)"
  now="$(date +%s)"
  if [ -z "$latest" ]; then
    hb_age=""
    hb_age_desc="(不明: ハートビートファイルが1つも無い)"
  else
    hb_age=$(( now - latest ))
    hb_age_desc="${hb_age}秒"
  fi

  if [ -f "$POISON_MARKER" ]; then
    # サスペンド watchdog(reth-node.sh / lighthouse-bn.sh)が書いた特例
    # マーカー。genesis 年齢に関わらず LIVE_THRESHOLD で再生成する
    # (#148 3-4 のまま。watchdog が発火する条件(600秒超の空白)が成立
    # した時点で genesis 年齢も MAX_REBUILD_GAP を超えているため、下記の
    # genesis 年齢判定に統合しても結果は変わらない)。
    if [ -z "$hb_age" ] || [ "$hb_age" -gt "$LIVE_THRESHOLD_SEC" ]; then
      echo "[generate] サスペンド検知マーカー(${POISON_MARKER})を検出。最新ハートビートの経過 ${hb_age_desc} > LIVE_THRESHOLD(${LIVE_THRESHOLD_SEC}秒)。全ノード停止とみなし再生成する。"
      return 0
    fi
    echo "[generate] サスペンド検知マーカーはあるが、最新ハートビートの経過 ${hb_age_desc} <= LIVE_THRESHOLD(${LIVE_THRESHOLD_SEC}秒)。まだ生存中のノードがあるとみなし再生成せずスキップする(警告: レジューム未完了のノードが残っている可能性)。"
    return 1
  fi

  compute_genesis_age
  genesis_age="$GENESIS_AGE_SEC"
  echo "[generate] genesis 年齢 ${genesis_age}秒(MAX_REBUILD_GAP=${MAX_REBUILD_GAP_SEC}秒)。最新ハートビートの経過 ${hb_age_desc}。"

  if [ "$genesis_age" -le "$MAX_REBUILD_GAP_SEC" ]; then
    echo "[generate] genesis 年齢 ${genesis_age}秒 <= MAX_REBUILD_GAP(${MAX_REBUILD_GAP_SEC}秒)。稼働中・全停止後のいずれでも次回起動時の再構築量は安全な範囲(#139 で検証済みの領域)。再生成せずスキップする。"
    return 1
  fi

  # genesis 年齢 > MAX_REBUILD_GAP: 全停止後だと次回起動時の再構築が実時間
  # に追いつけない領域。ここから先は「全ノードが停止しているか」を確定
  # させる必要がある。
  if [ -z "$hb_age" ] || [ "$hb_age" -gt "$LIVE_THRESHOLD_SEC" ]; then
    echo "[generate] genesis 年齢 ${genesis_age}秒 > MAX_REBUILD_GAP(${MAX_REBUILD_GAP_SEC}秒)、かつ最新ハートビートの経過 ${hb_age_desc} > LIVE_THRESHOLD(${LIVE_THRESHOLD_SEC}秒)(またはハートビート無し)。全ノード停止が確定しているとみなし再生成する。"
    return 0
  fi

  # genesis は古いが直近ハートビートは新しい曖昧ケース(#286 の本命)。
  # 60秒以内の新鮮さは「down 直後の up」でも同じ見え方になり生存の証明に
  # ならないため、ハートビート mtime が実際に前進するかをサンプリング観測
  # して実測する。`docker compose up` では全ノードが genesis サービスへの
  # `depends_on: condition: service_completed_successfully` を持つため、
  # この判定中は compose 側のノードが一切起動できない。したがって
  # サンプリング中に mtime を前進させられるのは「前回の up から生き続けて
  # いるノード」だけであり、これが判別の正しさの根拠になる(addNode の
  # 動的ノードはハートビートを書かないため撹乱しない)。
  sample_window_sec=$(( 2 * HEARTBEAT_INTERVAL_SEC ))
  echo "[generate] genesis 年齢 ${genesis_age}秒 > MAX_REBUILD_GAP(${MAX_REBUILD_GAP_SEC}秒)だが最新ハートビートの経過 ${hb_age_desc} <= LIVE_THRESHOLD(${LIVE_THRESHOLD_SEC}秒)。down 直後の up と稼働中を区別できないため ${sample_window_sec}秒 サンプリングしてハートビート mtime の前進を実測する。"
  before="$latest"
  sleep "$sample_window_sec"
  after="$(latest_heartbeat_epoch)"
  if [ -n "$after" ] && { [ -z "$before" ] || [ "$after" -gt "$before" ]; }; then
    echo "[generate] サンプリング中にハートビート mtime が前進した(${before:-無し} → ${after})。実際に稼働中のノードがいるとみなし再生成をスキップする(Issue #56 の保護)。"
    return 1
  fi
  echo "[generate] サンプリング中にハートビート mtime が前進しなかった(${before:-無し} → ${after:-無し})。down 直後の再起動、または全ノード一斉 Recreate とみなし再生成する(次回起動で全ノードが datadir を失うため。Issue #286 の本命ケース)。"
  return 0
}

if ! should_regenerate; then
  echo "[generate] 既存の genesis を再利用する。作り直すには 'docker compose down -v --remove-orphans' でボリュームを破棄すること。"
  exit 0
fi

echo "[generate] 前回の生成物を破棄"
rm -rf /data/metadata /data/jwt /data/keys /data/parsed "$DONE_MARKER" "$GENESIS_TIMESTAMP_FILE"
# down -v 相当のクリーンさにするため、bootnode の enode/ENR 受け渡しと
# ハートビート(poison マーカー含む)も一掃する(genesis サービスの
# clpeer/elpeer/heartbeat マウントは docker-compose.yml で rw にしてある)。
rm -f /clpeer/boot.enr /elpeer/boot.enode
if [ -d "$HEARTBEAT_DIR" ]; then
  find "$HEARTBEAT_DIR" -mindepth 1 -delete 2>/dev/null || true
fi

echo "[generate] EL + CL genesis を生成(genesis 時刻 = 現在時刻)"
export GENESIS_TIMESTAMP="$(date +%s)"
# genesis 年齢判定(Issue #286)の一次情報源として、export した時刻をその
# まま書き出す。生成が途中で失敗しても DONE_MARKER が書かれないため、
# 次回起動は「生成済みマーカー無し」分岐で必ずこのファイルごと rm -rf
# してから作り直す(半端な .genesis-timestamp が残ることはない)。
echo "$GENESIS_TIMESTAMP" > "$GENESIS_TIMESTAMP_FILE"
/work/entrypoint.sh all

# lighthouse の testnet-dir が要求するファイル名を用意する。
# generator は deposit_contract_block.txt を作るが lighthouse は
# deploy_block.txt を見る。boot_enr.yaml は空でよい(bootnode は
# 起動時に beacon ノード間で受け渡す。lighthouse-bn.sh を参照)。
cp "$GEN/deposit_contract_block.txt" "$GEN/deploy_block.txt"
echo "[]" > "$GEN/boot_enr.yaml"

# generator と同じ手順で mnemonic 等を解決する(defaults → values.env の順)。
. /defaults/defaults.env
[ -f /config/values.env ] && . /config/values.env

# NUMBER_OF_VALIDATORS 個のバリデーター鍵を NODE_COUNT ノードに均等分割し、
# node0, node1, ... 別ディレクトリに lighthouse 形式(keys/ + secrets/)で出力する。
NODE_COUNT="${NODE_COUNT:-1}"
TOTAL="${NUMBER_OF_VALIDATORS}"
PER=$(( TOTAL / NODE_COUNT ))

echo "[generate] バリデーター鍵を導出: 合計 ${TOTAL} を ${NODE_COUNT} ノードに分割(各 ${PER})"
i=0
while [ "$i" -lt "$NODE_COUNT" ]; do
  MIN=$(( i * PER ))
  if [ "$i" -eq $(( NODE_COUNT - 1 )) ]; then
    MAX="$TOTAL"          # 端数はすべて最終ノードへ
  else
    MAX=$(( MIN + PER ))
  fi
  echo "[generate]   node${i}: バリデーター ${MIN}..$(( MAX - 1 ))"
  eth2-val-tools keystores --insecure \
    --source-mnemonic "$EL_AND_CL_MNEMONIC" \
    --source-min "$MIN" --source-max "$MAX" \
    --out-loc "$KEYS/node${i}"
  i=$(( i + 1 ))
done

# すべて成功したときだけ完了マーカーを書く。以降の起動はこのマーカーを見て
# 再生成をスキップする(冪等性)。
touch "$DONE_MARKER"
echo "[generate] 完了"
