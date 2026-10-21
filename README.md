# dshsync

为 DeepSeek Harness Desktop（DSH Desktop）提供的配置迁移插件。

DSH Desktop 的登录只同步账号，不会同步本机配置。**dshsync** 在旧电脑上导出配置，在新电脑上导入，从而恢复插件、插件设置、MCP 条目和用户技能。

> 本插件与 npm 上的 `dsh-config-sync` 不是同一个包，也没有隶属关系。dshsync 默认**不导出凭据与 API 密钥**；导入时会保留新电脑上已有的凭据。

## 功能

在 **设置 → 配置同步** 中：

1. **保存配置**：下载一个 JSON 文件。
2. **导入配置**：选择文件，先查看将要发生的变更，再点击“开始导入”。

导入会：

- 按文件中记录的来源和版本安装缺失的第三方插件；
- 恢复插件的启用/停用状态；
- 恢复每个插件的配置（包括第三方插件）；
- 通过 `insert` 行恢复 MCP 服务器等自定义插件条目；
- 恢复用户技能（`~/.dsh/skills` 与 `~/.agents/skills`）；
- 对暂时无法应用的配置排队，重启后自动继续应用；
- 永远不会安装、停用或改写 dshsync 自身（包括旧导出文件中的 `dsh-config-sync` 自身条目）。

## 安装

要求 DSH Desktop / Web `0.2.1-rc.1` 以上、`0.3.0` 以下，Node.js `20.18` 以上。

### 从 npm 安装（推荐）

```bash
dsh plugin --profile desktop add dshsync
# Web profile:
dsh plugin --profile web add dshsync
```

然后在 DSH 中重启或刷新页面。

### 在 Desktop 中安装

打开 **Plugins → Add plugin**，输入包名 `dshsync`，或选择本目录 / 本地 tarball。

### 从本地目录安装（开发）

```bash
dsh plugin --profile desktop add /path/to/dshsync
```

### 从 tarball 安装

```bash
dsh plugin --profile desktop add ./dshsync-1.0.0.tgz
```

安装后可在 **设置 → 配置同步** 找到本插件。

## 使用步骤

### 旧电脑

1. 安装并启用 dshsync。
2. 打开 **设置 → 配置同步**。
3. 点击 **保存到文件**，得到 `dshsync-YYYYMMDD-HHmm.json`。

### 新电脑

1. 下载并登录 DSH Desktop。
2. 安装并启用 dshsync。
3. 打开 **设置 → 配置同步**。
4. 点击 **选择文件…**，选中旧电脑导出的 JSON。
5. 检查“确认导入”页面中的安装、配置和手动步骤。
6. 点击 **开始导入**。
7. 若提示需要重启，重启 DSH Desktop。重启后插件加载完成，排队中的配置会自动应用。

## 会同步的内容

- 已安装 bundle 的清单、版本、安装来源、启用状态；
- 每个插件行的启用/停用状态；
- 配置层（`cordis.patch.yml`）中的插件配置；
- 配置层中的 `insert` 条目（例如 MCP 服务器定义）；
- 设置命名空间；
- 用户技能目录中的技能文件；
- 工作区列表仅作为参考信息写入文件，不会自动创建。

## 不会同步的内容

- **凭据与 API 密钥**：`.credentials.yaml` 不读取；配置中名称或形态像密钥的值会被脱敏；
- 会话、轮次、目标、定时任务记录；
- 附件、缓存、日志、插件运行时数据（例如费用统计账本）；
- 插件本体和 `link:` / 本地路径插件；
- 机器级 `.env` 和 home 级 `cordis.patch.yml`；
- 应用更新状态、窗口状态等非 DSH 配置。

## 安全与权限

dshsync 会：

- 读取 `$DSH_HOME` 下的 profile、patch、settings 和用户技能；
- 写入 `$DSH_HOME/dshsync/pending.json`（权限 600）和用户技能目录；
- 通过 Host 已认证的 `/api` 通道与当前页面通信；
- 从导入文件记录的 npm / Git 来源安装插件。

它不会：

- 读取 `.credentials.yaml`；
- 把 API 密钥写入导出文件；
- 在导入时清空新电脑上已有的同名凭据；
- 暴露 agent 工具来执行导入（导入会安装包、改配置，保持为需要用户明确确认的 UI 操作）。

脱敏覆盖常见字段名（`apiKey`、`token`、`secret`、`password`、`authorization` 等）、常见密钥格式（`sk-…`、`ghp_…`、JWT、Bearer 等）、URL 用户信息和敏感查询参数、`env`/`headers` 中的凭据。脱敏是启发式的，不能替代人工检查；分享导出文件前请自行确认。

## 导入行为与限制

- **不删除**新电脑上多出来的插件或配置；导入是恢复/合并，不是镜像覆盖。
- 第三方插件按文件记录的版本安装；已安装但版本不同的插件不会自动降级或升级，会在计划中提示。
- `link:`、绝对路径、`file:` 插件无法跨机器安装，计划中会列出手动步骤。
- 需要构建脚本授权的包不会自动授权，请在 Plugins 页面手动处理。
- 部分插件在安装后需要重启才会出现 Host 条目；相关配置会进入 `~/.dsh/dshsync/pending.json`，重启后自动应用。
- 用户技能不会覆盖新电脑上已有的同名技能。
- 工作区路径通常与机器绑定，导入时只作为参考信息展示。
- 插件 bundle 的启用顺序可能因新机器安装顺序不同而略有差异；如果多个 bundle 之间存在覆盖关系，请在 Plugins 页面确认顺序。
- 带条件表达式（`disabled: !!js …`）的插件行不会被自动改写，计划中会提示需要手动确认。
- 被停用 bundle 内部的单行启用状态不会单独导出；重新启用该 bundle 后会使用其默认行状态。
- 如果导入文件来自不同的操作系统，插件配置中的绝对路径（命令、工作目录等）需要手动调整，导入计划会给出提示。
- 同一 bundle 内多个插件共用 settings 时，导入使用 merge 语义，不会删除目标端已有字段；这是为了不误删凭据。

## 插件市场与索引

- **第三方市场**：公开 GitHub 仓库 `dshsync`，加 `dsh-plugin` topic；市场会搜索到，并从 npm 包名 `dshsync` 一键安装。
- **官方 Discover / 社区索引**：添加索引源
  `https://limbo1996.github.io/dshsync/index.json`
  （部署 `market/` 目录后可用）。
- **社区目录**：DSH Plugin Hub、Open Plugin Market、realoiyo 索引等；详见 [PUBLISHING.md](https://github.com/limbo1996/dshsync/blob/main/PUBLISHING.md)。

官方 DSH 0.2.x **没有默认市场索引**；Discover 需要用户添加索引源 URL。

## 文件格式

导出文件为 JSON，顶层包含：

```json
{
  "format": "dshsync",
  "version": 1,
  "exportedAt": "2026-10-20T10:00:00.000Z",
  "source": { "profile": "desktop", "platform": "darwin", "node": "26.0.0" },
  "profile": {
    "bundles": [],
    "plugins": [],
    "inserts": [],
    "disabled": [],
    "configs": [],
    "settings": [],
    "dependencies": {},
    "bundleOrder": []
  },
  "skills": { "skills": [] },
  "workspaces": []
}
```

`redacted` 数组记录被脱敏的字段路径，导入时用于保留新机器上已有的值。

## 故障排查

- **提示需要重启**：关闭并重新打开 DSH Desktop。`pending.json` 中的应用项会在启动后自动重试。
- **配置同步页面不存在**：确认插件已安装并启用；Settings 中有“配置同步”一项。若刚安装，请重启。
- **插件安装失败**：检查网络、npm registry 和 pnpm；查看导入报告中的安装诊断。
- **本地插件未恢复**：`link:` / 本地路径插件不会被复制。请在新电脑上重新安装该插件，然后重新导入配置。
- **导入后页面消失**：如果旧配置停用了 Settings 插件，导入会忠实恢复该状态。可在 Plugins 页面重新启用。
- **旧导出文件里有 `dsh-config-sync`**：dshsync 会把它识别为同步插件自身并跳过，不会安装 npm 上另一个同名包。

## 开发

```bash
npm install
npm test
npm pack --dry-run
```

测试覆盖密钥脱敏、配置恢复、`cordis.patch.yml` 插入行读写、导入计划、自身包跳过、导入执行、pending 重试、技能导入和 Host 路由。

## 发布

见 [PUBLISHING.md](https://github.com/limbo1996/dshsync/blob/main/PUBLISHING.md)。

## 许可证

MIT
