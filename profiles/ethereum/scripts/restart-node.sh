#!/bin/sh
# ノード単位(reth + beacon + validator)でまとめて再起動するヘルパー。
# ホスト側で使う運用スクリプトであり、どのコンテナにもマウントしない
# (generate-genesis.sh 等、コンテナのエントリポイントになる他スクリプトとは役割が違う)。
#
# 使い方(profiles/ethereum ディレクトリで実行):
#   ./scripts/restart-node.sh <ノード番号...>
#   例: ./scripts/restart-node.sh 1      → reth1 beacon1 validator1 をまとめて再起動
#       ./scripts/restart-node.sh 1 2    → ノード1・2をまとめて再起動
#
# なぜ必要か(Issue #43):
#   reth(EL)・lighthouse beacon(CL)は起動のたびにデータディレクトリを
#   初期化して genesis からやり直す設計になっている
#   (scripts/reth-node.sh・scripts/lighthouse-bn.sh 参照)。このため
#   `docker compose restart beacon1` のように beacon だけを再起動すると、
#   CL は genesis からやり直す一方 reth は再起動されず既存のブロックデータを
#   保持したまま先行してしまい、EL/CL のヘッドが乖離してチェーンが完全停止
#   する(自己回復しない)。
#
#   reth と beacon を必ずセットで再起動すれば、両方が同じ genesis から
#   やり直した状態になり、README「P2P 接続について」に書いた EL/CL 間の
#   P2P 再同期によって自動的にチェーンへ追従を再開する(実機で確認済み)。
#   validator はデータ(slashing protection DB 等)を保持する必要はないが、
#   「1 ノード = reth + beacon + validator」という構成(README「構成」参照)に
#   揃えるため同じタイミングで一緒に再起動する。
set -e

if [ "$#" -eq 0 ]; then
  echo "使い方: $0 <ノード番号...>  例: $0 1   (reth1 beacon1 validator1 をまとめて再起動)" >&2
  exit 1
fi

services=""
for n in "$@"; do
  case "$n" in
    '' | *[!0-9]*)
      echo "エラー: ノード番号は数字で指定すること(例: 1)。受け取った値: '$n'" >&2
      exit 1
      ;;
  esac
  services="$services reth$n beacon$n validator$n"
done

echo "[restart-node] 再起動対象:$services"
exec docker compose restart $services
