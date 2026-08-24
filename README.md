# dsh-tool-oss

DeepSeek Harness 插件：OSS 对象存储文件浏览器，支持多 Bucket、文件/文件夹上传、递归删除，对接硅基流动 / 腾讯云 COS / 阿里云 OSS 等任意 S3 兼容存储。

> **零外部依赖** — 仅用 Node.js 内置 `crypto`（AWS SigV4 签名）和全局 `fetch`，不安装任何 SDK。

## 功能一览

| 功能 | 说明 |
|---|---|
| 📁 文件浏览 | 居中面板，支持目录层级导航（面包屑 + 子目录点击进入） |
| 📤 文件上传 | 单文件 / 多文件，任意格式（文本、图片、二进制） |
| 📁 文件夹上传 | 递归上传整个文件夹，保留完整目录结构（含文件夹名） |
| 📝 文本上传 | 直接输入 key + 文本内容上传 |
| 👁 文件查看 | 点击文件名内联查看内容 |
| 🗑 文件删除 | 单个文件删除，居中确认弹窗 |
| 🗑 文件夹删除 | 递归删除整个文件夹及其下所有对象 |
| 🔔 居中弹窗 | 所有确认 / 错误提示均为自定义居中 ModalDialog（非原生 `window.confirm`） |
| 🪣 多 Bucket | 同时配置多个 Bucket，UI 顶部一键切换 |
| 🔐 环境变量 | 凭证全部从 `~/.zshrc` 环境变量读取，composition 文件零密钥 |

## 包结构

```
local-plugins/
├── dsh-tool-oss/              # OSS 主插件（Host + Client 双面粉）
│   ├── index.js               # Host: oss 模型工具 + /oss RPC 通道
│   ├── client.js              # Client: 文件浏览面板 + 上传对话框
│   └── package.json           # dsh.client 声明
└── dsh-ui-archived-local/     # 归档面板覆盖插件
    ├── index.js               # Host: 空 apply 占位
    ├── client.js              # Client: 自定义居中确认弹窗替代 window.confirm
    └── package.json
```

## 安装

### 1. 放置插件文件

将 `local-plugins/` 目录放到 DSH profile 下：

```bash
~/.dsh/profiles/web/local-plugins/
```

### 2. 添加依赖

编辑 `~/.dsh/profiles/web/package.json`，在 `dependencies` 中加入：

```json
"dsh-tool-oss": "link:./local-plugins/dsh-tool-oss",
"dsh-ui-archived-local": "link:./local-plugins/dsh-ui-archived-local"
```

然后安装：

```bash
cd ~/.dsh/profiles/web && pnpm install
```

### 3. 配置环境变量

在 `~/.zshrc` 中添加（以硅基流动两个 Bucket 为例）：

```bash
# 共用配置（同账号）
export SILICON_OSS_AK='你的AccessKey'
export SILICON_OSS_SK='你的SecretKey'
export SILICON_OSS_ENDPOINT='https://s3.6scloud.com'
export SILICON_OSS_REGION='cn-east-1'

# Bucket 1
export SILICON_OSS_BUCKET='silicon'
# Bucket 2
export SILICON_OSS_BUCKET_2='model'
```

```bash
source ~/.zshrc
```

### 4. 配置 composition

编辑 `~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
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
          model:
            endpointEnv: SILICON_OSS_ENDPOINT
            regionEnv: SILICON_OSS_REGION
            bucketEnv: SILICON_OSS_BUCKET_2
            accessKeyIdEnv: SILICON_OSS_AK
            secretAccessKeyEnv: SILICON_OSS_SK
          # 腾讯云 COS
          # tencent:
          #   endpointEnv: TENCENT_COS_ENDPOINT
          #   regionEnv: TENCENT_COS_REGION
          #   bucketEnv: TENCENT_COS_BUCKET
          #   accessKeyIdEnv: TENCENT_COS_AK
          #   secretAccessKeyEnv: TENCENT_COS_SK

# 归档面板覆盖（可选）
- id: ui-archived
  disabled: true
- insert:
    - id: ui-archived-local
      name: dsh-ui-archived-local
```

### 5. 重启 DSH

```bash
pnpm dsh web
```

刷新浏览器后，左下角出现 `☁ OSS` 按钮。

## 使用

1. 点击左下角 `☁ OSS` → 居中弹出文件浏览面板
2. 顶部 `Bucket:` 按钮切换不同桶
3. 面包屑导航目录层级，`📁` 文件夹可点击进入
4. 点击 `📤 上传` → 居中弹出上传对话框
   - **文件 / 文件夹** Tab：选择文件或文件夹上传
   - **文本** Tab：输入 key + 内容上传
5. 文件右侧 `🗑` 删除单个对象，文件夹右侧 `🗑` 递归删除整个文件夹

## 对接其他云厂商

所有 S3 兼容存储都可对接，只需设置对应的环境变量：

| 云厂商 | Endpoint 示例 |
|---|---|
| 硅基流动 | `https://s3.6scloud.com` |
| 腾讯云 COS | `https://cos.ap-guangzhou.myqcloud.com` |
| 阿里云 OSS | `https://oss-cn-hangzhou.aliyuncs.com` |
| AWS S3 | `https://s3.us-east-1.amazonaws.com` |
| MinIO | `http://localhost:9000` |

## 技术细节

- **签名**：AWS Signature V4，纯 `node:crypto` 实现
- **传输**：Host 端 `fetch` + S3 REST API；Client 端 `connection.rpc.call` → Host
- **二进制安全**：文件以 base64 编码传输，Host 端 `Buffer.from(content, 'base64')` 解码后 PUT
- **文件夹删除**：S3 服务强制 `delimiter=/`，采用递归方式逐层删除（先删文件，再递归子目录）
- **生命周期**：所有 RPC 通道和 Tool 注册均 fiber-scoped，插件卸载时自动清理

## License

MIT
