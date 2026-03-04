#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "🔧 Cleaning previous build..."
rm -rf nodejs/node_modules shared-deps-layer.zip

echo "📦 Installing dependencies..."
cp package.json nodejs/
cd nodejs && npm install --omit=dev
cd ..

echo "🗜️  Zipping layer..."
zip -rq shared-deps-layer.zip nodejs/

echo "✅ Layer artifact: shared-deps-layer.zip ($(du -h shared-deps-layer.zip | cut -f1))"
