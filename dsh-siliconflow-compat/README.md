# SiliconFlow 协议兼容插件

本插件为 DeepSeek Harness 的 `llm-pi-ai` 自定义提供方提供 **Responses → Messages 兼容桥接**，并修正 SiliconFlow 官方 API 前缀。

## 能力与限制

- 保留 `openai-responses` 配置选择，通过 `llm/stream` 中间件将 Harness 会话交给 pi-ai 的 Anthropic Messages 适配器。
- 上游使用 `/v1/messages` 与 Bearer 鉴权；流式文本、思考、工具调用、工具结果、回放及取消由现有适配器处理。
- 按请求从凭据服务解析密钥，不写入设置；缺少凭据时保持明确的凭据错误。
- 仅桥接 SiliconFlow 官方 `.cn` / `.com` 端点；其他提供方、私有网关、直接 Messages 请求走正常分派。
- 启动及切换协议时修正官方前缀：Messages 使用主机根地址，OpenAI 协议使用 `/v1`。只更新 `baseURL`，用设置版本检查保护并发编辑。
- 卸载会移除监听器和桥接；已修正的端点仍保存在设置里。

这是 **Harness 会话兼容模式**，不是原生 SiliconFlow Responses 支持，也不是面向外部客户端的 `/responses` HTTP 服务。不实现 OpenAI 的服务端响应存储、`previous_response_id` 或托管工具。协议专属配置必须被 Messages 适配器接受，不支持的兼容选项会校验失败。

## 环境要求

需要安装依赖后的 DeepSeek Harness **源码检出**，并通过 `tsx/esm` 启动（例如在源码目录运行 `pnpm dsh web`）。插件使用 Harness 内部模块，验证基线为 `8eb6aa069a`；升级 Harness 后需运行集成测试。不支持仅安装 npm 发行包、没有源码的运行环境。

源码路径优先级：插件配置 `harnessRoot` → 环境变量 `DSH_HARNESS_ROOT` → 当前工作目录。找不到模块会在加载时明确报错。插件可安装到任意 profile 目录，无需与源码相邻。

## 安装

```bash
export DSH_HARNESS_ROOT=/path/to/deepseek-harness
curl -fsSL https://raw.githubusercontent.com/chensl139-ok/dsh-plugins/main/install.sh | bash -s -- dsh-siliconflow-compat
```

安装器复制插件、注册本地依赖，并在 profile 的 `cordis.patch.yml` 中加入：

```yaml
- insert:
    - id: siliconflow-compat
      name: dsh-siliconflow-compat
      config:
        harnessRoot: /path/to/deepseek-harness
```

如果曾手工配置指向旧插件的绝对路径，请将原 `siliconflow-compat` 条目替换为上面的形式，避免重复挂载。安装或升级后重启 Web 服务，保持 SiliconFlow 的协议为 `openai-responses` 即可。

## 测试

无需 API Key 的测试：

```bash
cd dsh-siliconflow-compat
DSH_HARNESS_ROOT=/path/to/deepseek-harness npm test
```

覆盖端点、协议分派、鉴权、取消、缺失凭据、提供方隔离与卸载恢复。纯端点测试无需 Harness：`node --test endpoints.test.js harness.test.js`。

可选真实工具往返测试会使用现有用户设置及凭据，并产生少量模型调用费用：

```bash
export DSH_HARNESS_ROOT=/path/to/deepseek-harness
export SILICONFLOW_TEST_MODEL=zai-org/GLM-5.3
cd "$DSH_HARNESS_ROOT"
node --import tsx/esm /path/to/dsh-plugins/dsh-siliconflow-compat/verify-live.ts
```

用户目录默认 `~/.dsh`，可通过 `DSH_HOME` 覆盖。不要把密钥写入插件或提交到仓库。

## English

This source-backed Cordis plugin bridges the Harness Responses selection to SiliconFlow's Anthropic Messages API. It preserves the saved protocol selection, supports streaming and tool round trips through the existing pi-ai adapter, and normalizes official endpoint prefixes. It does not expose a Responses HTTP server or implement OpenAI server-side response storage and hosted tools.

Set `DSH_HARNESS_ROOT` to a dependency-installed Harness source checkout before running the repository installer. The installer records the checkout path as `config.harnessRoot`; manual installations can use that config field or the environment variable. Run Harness with `tsx/esm`. This plugin uses internal source modules and must be tested after Harness upgrades. Credentials are resolved per request and never stored in plugin settings. Private gateways and other providers keep their normal dispatch.
