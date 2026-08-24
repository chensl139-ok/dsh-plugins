#!/usr/bin/env bash
set -euo pipefail

# DSH 插件存储仓库 — 一键安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/chensl139-ok/dsh-tool-oss/main/install.sh | bash
# 或:   bash install.sh [profile]

PROFILE="${1:-web}"
REPO_URL="https://github.com/chensl139-ok/dsh-tool-oss.git"
TMP_DIR=$(mktemp -d)
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PLUGINS_DIR="$PROFILE_DIR/local-plugins"

echo "📦 DSH 插件安装脚本"
echo "   Profile: $PROFILE"
echo "   目录: $PROFILE_DIR"
echo ""

# 1. Clone repo
echo "⬇  克隆仓库…"
git clone --depth 1 "$REPO_URL" "$TMP_DIR/repo" 2>/dev/null

# 2. Copy plugins
if [ -d "$PLUGINS_DIR" ]; then
  echo "⚠  目录已存在，将覆盖: $PLUGINS_DIR"
  rm -rf "$PLUGINS_DIR"
fi
mkdir -p "$PLUGINS_DIR"
cp -r "$TMP_DIR/repo/dsh-tool-oss" "$PLUGINS_DIR/"
cp -r "$TMP_DIR/repo/dsh-ui-archived-local" "$PLUGINS_DIR/"
echo "✅ 插件文件已复制到 $PLUGINS_DIR"

# 3. Add dependencies to package.json
PKG="$PROFILE_DIR/package.json"
if [ ! -f "$PKG" ]; then
  echo "❌ 未找到 $PKG — 请确认 profile '$PROFILE' 存在"
  exit 1
fi

if ! grep -q '"dsh-tool-oss"' "$PKG"; then
  echo "📝 添加依赖到 package.json…"
  # Use node to safely edit JSON
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$PKG', 'utf8'));
    pkg.dependencies = pkg.dependencies || {};
    pkg.dependencies['dsh-tool-oss'] = 'link:./local-plugins/dsh-tool-oss';
    pkg.dependencies['dsh-ui-archived-local'] = 'link:./local-plugins/dsh-ui-archived-local';
    fs.writeFileSync('$PKG', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "✅ 依赖已添加"
else
  echo "✅ 依赖已存在，跳过"
fi

# 4. pnpm install
echo "📦 安装依赖…"
cd "$PROFILE_DIR"
pnpm install 2>&1 | tail -3

# 5. Patch cordis.patch.yml if not already patched
PATCH="$PROFILE_DIR/cordis.patch.yml"
if ! grep -q 'tool-oss' "$PATCH" 2>/dev/null; then
  echo "📝 配置 cordis.patch.yml…"
  cat >> "$PATCH" << 'YAML'

# ── dsh-tool-oss: S3-compatible object storage ──
- insert:
    - id: tool-oss
      name: dsh-tool-oss
      config:
        timeoutMs: 60000
        providers:
          silicon:
            endpointEnv: SILICON_OSS_ENDPOINT
            regionEnv: SILICON_OSS_REGION
            bucketEnv: SILICON_OSS_BUCKET
            accessKeyIdEnv: SILICON_OSS_AK
            secretAccessKeyEnv: SILICON_OSS_SK

# ── dsh-ui-archived-local ──
- id: ui-archived
  disabled: true
- insert:
    - id: ui-archived-local
      name: dsh-ui-archived-local
YAML
  echo "✅ cordis.patch.yml 已配置"
else
  echo "✅ cordis.patch.yml 已包含 tool-oss，跳过"
fi

# Cleanup
rm -rf "$TMP_DIR"

echo ""
echo "🎉 安装完成！"
echo ""
echo "下一步:"
echo "  1. 在 ~/.zshrc 中设置环境变量:"
echo '     export SILICON_OSS_AK="你的AK"'
echo '     export SILICON_OSS_SK="你的SK"'
echo '     export SILICON_OSS_ENDPOINT="https://s3.6scloud.com"'
echo '     export SILICON_OSS_REGION="cn-east-1"'
echo '     export SILICON_OSS_BUCKET="你的bucket名"'
echo ""
echo "  2. source ~/.zshrc"
echo "  3. 重启 dsh: pnpm dsh web --profile $PROFILE"
echo "  4. 刷新浏览器，左下角出现 ☁ OSS 按钮"
