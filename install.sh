#!/usr/bin/env bash
set -euo pipefail

# DSH 插件存储仓库 — 一键安装脚本
# 用法:
#   安装所有插件:  bash install.sh
#   安装指定插件:  bash install.sh dsh-tool-oss
#   安装多个插件:  bash install.sh dsh-tool-oss dsh-ui-archived-local
#   指定 profile:  bash install.sh --profile my-profile dsh-tool-oss
#   远程一键:      curl -fsSL https://raw.githubusercontent.com/chensl139-ok/dsh-plugins/main/install.sh | bash -s -- dsh-tool-oss

REPO_URL="https://github.com/chensl139-ok/dsh-plugins.git"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

# ── 解析参数 ──────────────────────────────────────────────────────────────────
PROFILE="web"
PLUGINS=()

for arg in "$@"; do
  case "$arg" in
    --profile) shift_next=1 ;;
    --profile=*) PROFILE="${arg#--profile=}" ;;
    *) if [ "${shift_next:-0}" = "1" ]; then PROFILE="$arg"; shift_next=0; else PLUGINS+=("$arg"); fi ;;
  esac
done

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PLUGINS_DIR="$PROFILE_DIR/local-plugins"

# 可用插件清单
declare -a AVAILABLE=(
  "dsh-tool-oss|OSS 对象存储文件浏览器（多 Bucket、文件/文件夹上传、递归删除）"
  "dsh-ui-archived-local|归档面板（自定义居中确认弹窗替代 window.confirm）"
)

# 如果未指定插件，交互式选择
if [ ${#PLUGINS[@]} -eq 0 ]; then
  echo "📦 DSH 插件安装脚本"
  echo "   Profile: $PROFILE"
  echo ""
  echo "可用插件:"
  for i in "${!AVAILABLE[@]}"; do
    IFS='|' read -r name desc <<< "${AVAILABLE[$i]}"
    echo "  $((i+1)). $name — $desc"
  done
  echo "  0. 全部安装"
  echo ""
  read -r -p "选择要安装的插件（数字，多个用空格分隔）: " choices

  for choice in $choices; do
    if [ "$choice" = "0" ]; then
      for a in "${AVAILABLE[@]}"; do IFS='|' read -r name _ <<< "$a"; PLUGINS+=("$name"); done
      break
    fi
    idx=$((choice-1))
    if [ "$idx" -ge 0 ] && [ "$idx" -lt "${#AVAILABLE[@]}" ]; then
      IFS='|' read -r name _ <<< "${AVAILABLE[$idx]}"
      PLUGINS+=("$name")
    fi
  done

  if [ ${#PLUGINS[@]} -eq 0 ]; then
    echo "未选择任何插件，退出。"
    exit 0
  fi
fi

echo ""
echo "📦 安装到 profile: $PROFILE"
echo "   插件: ${PLUGINS[*]}"
echo "   目录: $PLUGINS_DIR"
echo ""

# ── Clone 仓库 ────────────────────────────────────────────────────────────────
echo "⬇  克隆仓库…"
git clone --depth 1 "$REPO_URL" "$TMP_DIR/repo" 2>/dev/null

# ── 复制插件文件 ──────────────────────────────────────────────────────────────
mkdir -p "$PLUGINS_DIR"
for plugin in "${PLUGINS[@]}"; do
  if [ ! -d "$TMP_DIR/repo/$plugin" ]; then
    echo "❌ 未知插件: $plugin（仓库中不存在此目录）"
    exit 1
  fi
  rm -rf "$PLUGINS_DIR/$plugin"
  cp -r "$TMP_DIR/repo/$plugin" "$PLUGINS_DIR/"
  echo "✅ $plugin 已复制"
done

# ── 添加依赖到 package.json ───────────────────────────────────────────────────
PKG="$PROFILE_DIR/package.json"
if [ ! -f "$PKG" ]; then
  echo "❌ 未找到 $PKG — 请确认 profile '$PROFILE' 存在"
  exit 1
fi

echo "📝 添加依赖…"
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$PKG', 'utf8'));
  pkg.dependencies = pkg.dependencies || {};
  const plugins = process.argv.slice(1);
  let changed = false;
  for (const p of plugins) {
    if (!pkg.dependencies[p]) { pkg.dependencies[p] = 'link:./local-plugins/' + p; changed = true; }
  }
  if (changed) { fs.writeFileSync('$PKG', JSON.stringify(pkg, null, 2) + '\n'); console.log('✅ 依赖已添加'); }
  else { console.log('✅ 依赖已存在，跳过'); }
" "${PLUGINS[@]}"

# ── pnpm install ──────────────────────────────────────────────────────────────
echo "📦 安装依赖…"
cd "$PROFILE_DIR"
pnpm install 2>&1 | tail -3

# ── 配置 cordis.patch.yml ─────────────────────────────────────────────────────
PATCH="$PROFILE_DIR/cordis.patch.yml"

# dsh-tool-oss 的 composition
has_oss=$(grep -c 'tool-oss' "$PATCH" 2>/dev/null || echo 0)
if echo "${PLUGINS[@]}" | grep -qw 'dsh-tool-oss' && [ "$has_oss" = "0" ]; then
  echo "📝 配置 dsh-tool-oss…"
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
YAML
  echo "✅ dsh-tool-oss 已配置"
fi

# dsh-ui-archived-local 的 composition
has_archived=$(grep -c 'ui-archived-local' "$PATCH" 2>/dev/null || echo 0)
if echo "${PLUGINS[@]}" | grep -qw 'dsh-ui-archived-local' && [ "$has_archived" = "0" ]; then
  echo "📝 配置 dsh-ui-archived-local…"
  cat >> "$PATCH" << 'YAML'

# ── dsh-ui-archived-local ──
- id: ui-archived
  disabled: true
- insert:
    - id: ui-archived-local
      name: dsh-ui-archived-local
YAML
  echo "✅ dsh-ui-archived-local 已配置"
fi

# ── 提示 ──────────────────────────────────────────────────────────────────────
echo ""
echo "🎉 安装完成！"
echo ""

if echo "${PLUGINS[@]}" | grep -qw 'dsh-tool-oss'; then
  echo "dsh-tool-oss 需要设置环境变量（~/.zshrc）:"
  echo '  export SILICON_OSS_AK="你的AK"'
  echo '  export SILICON_OSS_SK="你的SK"'
  echo '  export SILICON_OSS_ENDPOINT="https://s3.6scloud.com"'
  echo '  export SILICON_OSS_REGION="cn-east-1"'
  echo '  export SILICON_OSS_BUCKET="你的bucket名"'
  echo ""
fi

echo "重启 DSH:"
echo "  source ~/.zshrc && pnpm dsh web --profile $PROFILE"
echo "刷新浏览器即可使用。"
