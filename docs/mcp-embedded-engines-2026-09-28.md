# 墨墅 1.2.0 内置本地推理引擎（2026-09-28）

## 用户确认与范围

用户选择随安装包内置 Ollama + llama.cpp，不分发原版 LM Studio。模型由用户自己的夸克网盘分发，分享链接及提取码本次留空；本轮不下载或运行真实模型，只下载构建所需运行库。

目标体验：完整安装/解压软件 → 从夸克分享页下载完整 GGUF（或使用已有文件）→ 设置 / AI 生成模型 / 内置本地模型 → 导入 GGUF → 选择引擎、设备和上下文 → 启用并设为默认。软件负责启动私有引擎、保存模型配置和后续请求时自动启动，不要求用户另装服务或手填端口。

## 已实现

- 新增内置模型面板，覆盖两处生成模型设置入口；向量模型继续走原有独立配置。
- GGUF 通过原生文件选择器授权导入，验证扩展名、魔数、版本和基本头部；仅记录原文件位置。不同模型架构能否运行仍由所选引擎决定，不能把头部检查当成完整模型验收。
- 当前导入支持完整单文件 GGUF，不支持分片 GGUF、ZIP、Safetensors 目录或单独 LoRA；不运行用户提供的程序/脚本。
- llama.cpp 直接读取 GGUF，提供 CPU 与 Vulkan 运行库；Ollama 以私有 blobs 和模型目录导入，不调用模型 pull API。
- 引擎仅绑定 127.0.0.1，使用独立端口、目录和子进程环境，不继承用户的模型目录、代理、云端密钥或 Node 注入变量。Ollama 设置 NO_CLOUD，llama.cpp 设置 offline、关闭其 Web UI 并使用本地 API Key。
- 只管理保留的子进程句柄对应的进程，不按名称结束 Ollama，不接管 11434 上已有服务。退出软件时停止自己创建的进程。
- 启用过程中校验固定运行库入口的 SHA-256；生成时重新解析临时端口与凭据，不把临时凭据保存到模型配置。请求不得通过重定向离开本地端点。
- 活跃生成期间拒绝切换/停止引擎；取消单个生成请求不强制中止共享预加载，释放资源可使用停止按钮。文件改变/移动须重新导入；重复导入会停止闲置旧引擎，避免继续使用旧权重。
- 内置配置从专用面板管理，普通编辑表单不允许手动改临时端点。显式“启用并设为默认”才改变默认模型；仅查看页面、导入文件或打开帮助不会自动开始写作。
- 配置损坏拒绝覆盖；导入不删除原文件，卸载不清理个人模型和作品。

## 夸克入口

源码配置：`packaging/model-download.json`。发行目录的 EXE 旁也有 `model-download.json`，资源目录有备用副本。当前内容的 `url` 与 `extractionCode` 都为空。

仅允许 HTTPS 的 `pan.quark.cn/s/...` 分享页；留空时下载按钮禁用并提示待配置。后续填写分享地址即可启用便携版入口；新安装包需要重新打包以包含新配置。此功能只打开系统浏览器，不自动登录网盘、读取 Cookie、伪装客户端、绕过下载限制或把分享页当作文件直链。模型由用户下载后手工选择导入。

向网盘分发模型时应确认模型的再分发/商业使用许可，并建议同时提供模型架构、量化类型、SHA-256、显存/内存要求与使用说明；不要上传个人 API Key、账号资料或小说数据。

## 固定运行库与来源

- Ollama CLI 0.34.4：官方 `ollama-windows-amd64.zip`，SHA-256 `535193f38f3344e5b08f5d1c171c31ce11aa17f0124ff69ae26d8ec7fe06fa62`。
- llama.cpp 稳定版 0.5.0 指向 b11146：官方 Windows x64 CPU 和 Vulkan 归档。
- 完整来源、字节数和散列：`packaging/embedded-runtime-pins.json`。
- 下载缓存：`.runtime/managed-engines/downloads/`；打包载荷：`.runtime/managed-engines/payload/`。
- 下载只允许固定 HTTPS 来源，校验后提取；没有运行系统安装器，没有修改全局 PATH/服务/驱动。
- 保留上游归档内的许可与依赖声明，补充 Ollama / llama.cpp MIT 许可；应用本地微软运行库来自签名、散列核对后的官方包，仅提取不安装。
- Ollama 官方嵌入说明：https://docs.ollama.com/windows 。LM Studio 默认条款限制再分发：https://lmstudio.ai/app-terms 。因此本包不包含 LM Studio 原版。

## 验证状态

最终结果：1.2.0 构建、归档与成品验证已完成。类型检查、构建门禁、i18n 检查通过，最后 IDE 诊断为零错误、零警告。

| 验证 | 结果 |
| --- | --- |
| 原墨墅回归 | 15 文件 / 102 测试通过 |
| 本地模型相关回归 | 19 文件 / 229 测试通过 |
| 新增内置引擎定向回归 | 4 文件 / 48 测试通过 |
| 三组回归合计 | 379 测试通过；包含模拟服务，不是实际 LLM 推理 |
| 原生运行库检查 | 5 项通过；在准备目录和打包后的 win-unpacked 中复核 |
| 成品兼容性验证 | 9 项通过，包括 ZIP 完整性、中文/空格重定位、SQLite 保存重开、LanceDB 本地向量检索、隐藏界面、安装器载荷一致性 |
| 新版真实界面 | 隐藏窗口中进入帮助与模型设置，内置面板可见、两引擎可用、无已导入模型、空夸克入口禁用 |
| 旧版保护 | 两个 1.1.0 发行目录共 6 个 EXE/ZIP 的 SHA-256 均保持不变 |
| 签名与分享配置 | 安装器 NotSigned；源码及程序目录的 Quark URL / 提取码全部为空 |

测试没有下载、加载或运行任何真实语言模型。LanceDB 检索使用合成向量，不调用向量模型。

初期文档措辞触发过旧测试，修正文案后完整回归通过。MCP 隧道随后中断，原任务在免安装 ZIP 压缩阶段退出，残留 69,206,016 字节的 ZIP，经检查为意外截断（7-Zip 退出 2）。新会话没有绕过旧命令的会话权限，也没有盲目重复构建：先核对项目进程已退出与现有日志，保留已生成的安装器，再用 `scripts/resume-moshu-packaging.mjs` 补齐 ZIP 和源码。安装器在恢复过程中散列不变，截断文件保留在项目忽略目录作诊断。恢复详情见 `BUILD-REPORT.json` 的 `archiveRecovery`。

```text
node scripts/prepare-managed-engines.mjs --allow-runtime-downloads
node scripts/verify-managed-engines.mjs
node scripts/build-moshu.mjs
node scripts/package-moshu.mjs --release-suffix=embedded-20260928
node scripts/verify-managed-engines.mjs --app-dir=release/moshu-1.2.0-win-x64-embedded-20260928/win-unpacked
node scripts/verify-moshu-compat.mjs --release-suffix=embedded-20260928
```

构建使用新目录，不覆盖既有 1.1.0 包。构建摘要会先标记 running，失败标记 failed，打包要求版本匹配且状态 passed，避免误用旧摘要。先构建目录并验证真实隐藏窗口，再从该目录生成 NSIS 安装器。

## 最终交付文件

目录：`release/moshu-1.2.0-win-x64-embedded-20260928/`。

| 文件 | 用途 | 大小 |
| --- | --- | --- |
| `Moshu-Setup-1.2.0-win-x64.exe` | 内置双引擎安装器 | 1,547,196,871 字节，约 1.55 GB |
| `Moshu-Portable-1.2.0-win-x64.zip` | 内置双引擎免安装包 | 1,813,705,953 字节，约 1.81 GB |
| `Moshu-Source-1.2.0.zip` | 对应源码与构建脚本 | 约 60 MB；最终散列见 SHA256SUMS.txt |

安装器 SHA-256：`444fc9d5cd38bb1c404927f3dcf2934ad1b2a3de6e1ed1767ce882d1a5a911dd`。

免安装 ZIP SHA-256：`af2a99e22cd9b2a813d00f74c380812c862686931ab62cafd253f09f03d9ff8f`。

源码包在同步本文最终说明后重新测试完整性并更新校验和，不改变已验收的程序代码、EXE 或便携 ZIP。本文不包含自身所在源码 ZIP 的散列，避免循环引用。

同目录提供 `先看这里-内置模型版.txt`、`验证记录.md`、`交付清单.json`、`BUILD-REPORT.json`、`COMPATIBILITY-REPORT.json`、`NATIVE-ENGINE-REPORT.json` 与 `SHA256SUMS.txt`。构建/恢复/探测日志分别位于 `.runtime/moshu-package/` 和 `.runtime/managed-engines/logs/`，不放入 docs。

修改夸克入口时，编辑安装或完整解压后的 **Moshu.exe 同目录** 的 `model-download.json`。仅在安装器文件旁放一个 JSON 不会改变安装器内的载荷；要向新用户分发更新后的安装器须重新打包，更新后的便携目录须重新压缩。源码侧配置是 `packaging/model-download.json`。

## 尚未验收的边界

本机为 Windows 10 22H2 x64。Windows 11、另一台电脑、标准用户独立账户、实际安装/卸载、真实 GPU 加载、任何真实 GGUF 的写作质量和完整创作流程均未验收。模型和网盘地址待用户提供；不能宣称任意模型下载后都一定能运行。内置运行库要求 Windows 10 22H2 或更新版本；32 位 Windows 与 ARM64 原生不在本次交付范围。

程序未签名，可能触发 SmartScreen。核对来源及 SHA-256，不关闭杀毒软件或系统安全功能。UI 软件渲染与推理引擎的 GPU 选择相互独立。
