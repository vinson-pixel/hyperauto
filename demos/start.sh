#!/bin/bash
# マルケン電工 デモサーバー起動スクリプト
# 使い方: ./start.sh

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "❌ .env が見つかりません"
  echo "   cp .env.example .env してAPIキーを設定してください"
  exit 1
fi

echo "🚀 デモサーバーを起動します..."
node server.js
