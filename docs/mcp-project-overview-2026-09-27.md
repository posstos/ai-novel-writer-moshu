# AI-Novel-Writer 项目初检

- 检查日期：2026-09-27
- 检查对象：`AI-Novel-Writer-master` 当前可见文件
- 本地包版本：桌面版 `1.1.0`；DeepSeek Harness 插件 `0.1.0`
- 基线：当前目录未被 Git 识别为有效 Worktree，无法记录分支、HEAD SHA 或 Git 脏状态。本报告是当前文件快照的静态初检，不代表上游最新分支或发布包验收。
- 范围：目录、项目约定、核心入口、创作工作流、数据存储、模型配置、安全边界、测试与发布配置的抽样检查，以及不安装依赖的轻量验证。
- 变更边界：不修改业务代码、依赖或配置；仅新增本报告。未启动桌面应用、未调用模型、未读取用户凭据或真实小说数据库。

## 一、结论

这是一个具有较完整工程结构的本地优先长篇小说创作工作台，而不是简单的聊天界面或单次生成脚本。其主要价值在于围绕一部小说管理设定、章节蓝图、草稿版本、人工确认的审稿意见、修稿和定稿，并把已定稿材料用于后续上下文。

从抽样代码看，项目已经考虑了旧项目会话、草稿来源、定稿事务、文件投影失败重试、原生模块隔离和跨平台发布等问题，适合作为进一步了解或二次开发的候选底座。但当前本机副本尚未安装依赖，也没有可确认的 Git 基线，因此不能据此宣布“可以直接运行”“全部测试通过”或“生产可用”。

建议下一步先建立可复现的桌面版运行与测试基线，再决定具体功能改造；不要先做大规模重构，也不要把冻结维护的插件当作桌面版的替代入口。

## 二、产品定位与边界

### 桌面版

主要流程：

```text
创作前提 → 角色/世界观 → 大纲/章节蓝图 → 草稿
                                      ↓
                          审稿 → 人工确认 → 修稿/差异合并
                                      ↓
                              定稿 → 后续章节上下文
```

仓库说明及抽样实现覆盖：

- 结构化项目资料、角色与章节管理。
- 草稿版本、生成失败恢复候选、审稿与修稿。
- 批量章节创作、参考资料、知识库和写作 Skill。
- 本地模型或用户自行配置的云端模型。
- Windows x64、macOS ARM64 与 Intel 的发布流程。

它不提供托管模型额度、在线小说发布平台或阅读社区。“本地优先”也不表示选择云端模型后内容仍不出本机：相应提示词和上下文会发送给配置的服务商。

证据：`README.md:83-160`、`docs/product-domain.md:5-29`。

### 独立的 DeepSeek Harness 插件

`plugins/dsh-ai-novel-writer/` 是另一套独立插件包、锁文件和项目格式，不读取桌面版 `.vela` 项目。其 README 明确标记 `0.1.0` 预览版冻结维护；V2 是人工审核 Proposal 的窄范围创作链，不能替代桌面工作台。

插件开发有独立门禁：真实 profile 加载、preset roster/mount、无密钥浏览器流程、Proposal 同页刷新及重启持久化证据。单测或打包成功不等于插件已完成可用性验收。本轮读取了这些规则，但未执行插件资格验证。

证据：`plugins/dsh-ai-novel-writer/README.md:3-35,116-128`、`plugins/dsh-ai-novel-writer/docs/v2-development-gates.md:20-58`。

## 三、技术栈与代码地图

桌面栈为 Electron 41、React 19、TypeScript 6、Vite 8，配合 Zustand、Tailwind、CodeMirror/Monaco、SQLite 和 LanceDB。版本范围由 `package.json` 声明，精确依赖以 `pnpm-lock.yaml` 为准；本轮没有联网核对最新版本或依赖漏洞库。

| 路径 | 职责 | 阅读建议 |
| --- | --- | --- |
| `src/App.tsx`、`src/components/` | 多面板界面、编辑器、项目与设置页面 | UI 改动从这里定位 |
| `src/stores/` | 项目、草稿、编辑器、模型及工作流状态 | 重点留意会话切换、未保存状态和异步结果 |
| `src/services/workflows/` | 写稿、审稿、修稿、定稿、批量任务与导入编排 | 功能逻辑的主要入口 |
| `src/services/workflows/commands/` | 各阶段命令实现 | 避免把新行为直接堆进组件 |
| `src/services/generation/` | 统一生成预算、模型执行租约及请求接口 | 模型调用策略应保持集中 |
| `src/shared/` | IPC 类型、领域合同、来源身份与状态模型 | 前后端边界变更先检查合同 |
| `electron/main.ts`、`electron/preload.ts` | 窗口、安全配置与渲染进程桥接 | 桌面运行和权限边界 |
| `electron/controllers/` | IPC 请求入口 | 后端参数校验与权限控制 |
| `electron/services/`、`electron/repositories/` | 业务服务与持久化 | 数据一致性问题从这里追踪 |
| `electron/database.ts` | 项目 SQLite 生命周期、建表及迁移 | 数据变更须补兼容和回归验证 |
| `electron/llm/` | OpenAI-compatible、Gemini 适配 | 不是任意 API 协议适配器 |
| `scripts/`、`.github/workflows/` | 原生依赖准备、测试、构建、发布资格检查 | 运行和打包不要绕过现有门禁 |

抽样追踪到的执行链：

```text
React 界面 / Zustand 状态
  → WorkflowDefinition / 阶段 Command
  → 生成运行时与 IPC 客户端
  → preload 桥接
  → Electron Controller
  → 模型适配器或 Service / Repository
  → 项目 SQLite、文件与知识库
```

`chapter-workflow.ts` 中写稿、审稿、修稿和定稿分别构造工作流，而不是把这些步骤无条件串成一次自动执行。人工确认的审稿内容有独立输入，不能直接把模型审稿文本视作作者已授权的修稿指令。

证据：`src/services/workflows/chapter-workflow.ts:62-78,225-271,319-464`、`electron/ipc-handlers.ts:24-50`、`electron/llm/llm-factory.ts:6-12`。

## 四、值得保留的工程设计

1. **项目身份与异步上下文有明确概念。** 工作流携带冻结的项目会话并检查目标路径；项目访问服务区分项目清单、旧版指纹和会话租约，避免单纯以路径字符串当作全部权限依据。
2. **项目数据库是主要持久化边界。** SQLite 位于项目的 `.vela/vela.db`，开启 WAL 和外键。
3. **定稿事实与实体文件分开处理。** `FinalizationService` 先提交定稿记录，再生成文件投影；使用正文哈希、不可变快照和可重试 outbox。重复请求会核对原提交，而非盲目生成第二次提交。
4. **配置写入具备防损坏处理。** 配置读取区分缺失与损坏；写入采用同目录临时文件、独占创建、fsync 和替换，Windows 占用错误有有限重试。
5. **测试与发布流程并非空白。** 有单元、浏览器、原生依赖和安装包相关检查；PR CI 明确配置类型检查、Lint、国际化、单测、浏览器测试与编译。

以上是代码和配置层面的观察，不等于这些机制已在本机运行通过，也不构成完整安全审计。

证据：`src/services/workflows/chapter-workflow.ts:130-143`、`electron/services/project-access.ts:13-78,117-165`、`electron/database.ts:23-36`、`electron/services/finalization-service.ts:87-170`、`electron/utils/config-utils.ts:28-117`、`.github/workflows/pr-ci.yml:53-79`。

## 五、需要优先处理或关注的事项

### 1. 先补运行基线，而不是把静态概览当验收

**类型：已确认的本机环境缺口。**

- 当前目录没有可识别的 Git Worktree 基线。
- 桌面包与插件包均未发现 `node_modules`。
- 本机 Node 为 `v22.13.1`；只确认 pnpm 命令存在，未调用 pnpm，也未验证其版本。
- 类型检查、Lint、单测、浏览器测试、构建和真实模型流程均未运行。

建议保留当前目录不动，先确认源码来源及是否需要一个独立、可追踪的 Git checkout。不要为补 Git 基线而覆盖现有文件、重置目录或替用户执行提交。

### 2. Node 版本声明与实际开发依赖要求不一致

**类型：已确认的工具链元数据问题。**

根包声明 `node >=20`，但锁文件中的 `@electron/rebuild@4.2.0` 要求 `>=22.12.0`；锁定的 Vite 也有更精确的最低版本条件。这意味着仅按“Node 20+”准备环境，不能保证覆盖完整开发/原生重建流程。

本机 `22.13.1` 满足上述 rebuild 的单项要求，但尚未验证整个工具链。PR CI 固定使用 Node `22.23.1` 和 pnpm `11.11.0`，建议优先与它对齐。插件另要求 `^22.19 || >=24`，当前本机版本不满足该插件声明。

证据：`package.json:8-11`、`pnpm-lock.yaml:498-500,4496-4498`、`.github/workflows/pr-ci.yml:39-48`、`plugins/dsh-ai-novel-writer/package.json:68-76`。

### 3. SQLite 等原生依赖是启动与测试的重点风险

**类型：已确认的工程约束，不是已复现故障。**

Node 单测与 Electron 应用使用不同的原生模块 ABI。仓库已经分别提供 `prepare:native-node` 和 `prepare-native-for-electron.mjs`；`pnpm dev` 的 predev 会准备 Electron 绑定。跑完 Node 测试后直接混用 Electron 绑定，或反过来，都应按既有脚本重新准备。

知识库加载还有独立的原生模块不可用错误处理。建议首轮验证覆盖 SQLite 建库、知识库加载、定稿和应用重启，不要只看 Vite 编译成功。

证据：`package.json:14-23,38-39`、`scripts/prepare-native-for-node.mjs`、`scripts/prepare-native-for-electron.mjs`、`electron/services/knowledge-base-loader.ts:19-47`。

### 4. API Key 当前以本机 JSON 明文持久化

**类型：已确认的安全设计取舍。**

模型配置由 `llm:save-model` 接收并直接保存到 `~/.vela/models.json`。底层使用 JSON 序列化；临时文件使用 `0o600`，但这不是凭据加密。README 已提示不要分享该配置文件。

这不表示已经发生凭据泄漏；风险主要来自本机账户失陷、误备份/同步或分享配置文件。若要面向更广用户发布，建议评估系统凭据存储或 Electron safeStorage，并对配置迁移、读取失败和导出脱敏制定明确策略。本轮没有读取实际的 models.json 或任何用户 API Key。

证据：`electron/controllers/llm-controller.ts:32-54,258-275`、`electron/utils/config-utils.ts:80-100,120-122`、`README.md:150-160`。

### 5. IPC 桥接范围值得做专项收紧

**类型：静态加固建议，未验证可利用漏洞。**

`preload.ts` 暴露了接受任意字符串 channel 的 invoke、send、on 和 once。TypeScript 类型不能代替运行时白名单。对已检查的 `index.html`、`electron/**/*.ts` 和 `vite.config.ts`，未检索到 CSP 配置。

同时，主窗口已关闭 Node integration、开启 context isolation，并阻止外部导航；不能把项目描述成“完全没有 Electron 安全措施”。建议专项评审时进一步核查频道白名单、参数 schema、调用者来源、模型配置暴露面和适合生产构建的 CSP。该项没有做攻击验证，不应当作已证实的远程执行漏洞。

证据：`electron/preload.ts:8-35`、`electron/main.ts:135-164`、`index.html:1-7`。

### 6. 维护与分发边界要先明确

- 当前非测试源码中存在超过千行的模块，涉及导入、架构生成、向量存储等。建议围绕具体需求和回归用例增量拆分，不凭文件长度发起整体重写。
- 根桌面仓库为 GPL-3.0，插件声明 MIT；不能把插件许可当作整个仓库的许可。二次分发或闭源整合前应单独核对许可义务。
- 当前 README 明确披露 Windows 安装程序未代码签名、macOS 为 ad-hoc 且未 Developer ID 签名/公证。分发可信度、安装提示和发布资格应作为单独工作项，不属于本轮已验证范围。

证据：`LICENSE:1-17`、`README.md:64-70,174-192`、`electron-builder.json5:24-35`，以及本轮源码行数统计。

## 六、本轮验证记录

| 检查 | 实际结果 | 能证明什么 / 不能证明什么 |
| --- | --- | --- |
| MCP 目录、搜索、文件读取 | 成功 | 能读取当前文件，不代表应用可运行 |
| Git Worktree 识别 | 未识别到有效 Worktree | 无法提供分支、SHA 或脏状态 |
| Node 探测 | `v22.13.1` | 只证明命令可执行 |
| 依赖目录探测 | 根包及插件 node_modules 不存在 | 未建立本机依赖基线 |
| JSON 解析 | 3 个文件通过：根 package、插件 package、release-profile | 只证明 JSON 语法可解析，不是发布合同完整验证 |
| 顶层脚本语法检查 | `scripts/*.mjs` 共 24 个，`node --check` 全部通过 | 不执行脚本、不解析依赖，不代表脚本运行成功 |
| 编辑器诊断 | 当前返回 0 条错误/警告 | 不能替代 TypeScript、Lint 或测试；语言服务结果可能不完整 |
| LSP 文档符号 | 返回空，并标记 `semantic_result_inconclusive=true` | 已回退到文本定位与源码读取，未把空结果解释成没有实现 |
| 测试文件统计 | 指定目录下 294 个 test/spec 文件 | 文件数量不是测试用例数量、覆盖率或通过率 |
| Typecheck / Lint / i18n / 单测 / 浏览器 / 构建 | 未运行 | 缺依赖，且本轮不执行安装或构建 |
| 真实模型、安装包、升级与重启持久化 | 未运行 | 不宣称功能、发布或跨平台验收通过 |

统计范围：`src`、`electron`、`test`、`scripts` 下的 `.ts`、`.tsx`、`.mjs` 共 761 个文件；其中按 `.test/.spec.ts(x)` 文件名统计 294 个测试文件，不含独立插件。没有读取实际测试覆盖率报告。

## 七、建议的后续顺序

### 第一步：建立桌面开发基线

以下是后续建议，不是本轮已执行命令。先确认并使用与 CI 对齐的 Node `22.23.1`、pnpm `11.11.0`，在目标仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm run check:i18n
pnpm run prepare:native-node
pnpm test
```

安装依赖和 native prepare 会下载或调整本机文件，应作为明确的环境准备任务执行。浏览器验证另需准备 Playwright Chromium，不能用浏览器测试未运行的状态宣称整套 CI 通过。

### 第二步：运行桌面版，做最小创作闭环

```bash
pnpm dev
```

`predev` 会检查并准备 Electron 所需的 SQLite 绑定。用虚构测试资料和单独项目目录验证：

1. 创建项目，填写前提、角色和章节蓝图。
2. 生成一章草稿并保存。
3. 运行审稿，人工确认需要修订的项目。
4. 生成修订稿，查看差异后合并。
5. 定稿，关闭应用，再打开项目核对正文与状态。
6. 再验证取消、生成中断、项目切换和失败重试不会覆盖作者内容。

真实模型调用需使用用户指定的服务与预算；不要把真实小说、凭据或整包数据库写入公开报告。

### 第三步：围绕目标选专项

- 以实际使用为目标：先排运行问题、模型连通性、保存与恢复。
- 以二次开发为目标：先明确要改的创作阶段，再检查对应工作流、状态和 IPC 合同。
- 以对外分发为目标：再做凭据管理、IPC/CSP、许可、签名、安装与升级资格。
- 插件任务单独立项，遵守其冻结维护状态和 V2 真实入口门禁。

## 八、报告与变更说明

报告归档路径：`docs/mcp-project-overview-2026-09-27.md`。

本轮未修改业务源码、依赖清单、锁文件或配置；未安装依赖、启动应用、执行提交、打包或发布。除本报告外，探测记录保留在会话侧，不把机器日志、私人路径、凭据或临时脚本写进项目 docs。
