# Windows EXE 打包与兼容性验证记录（2026-09-28）

## 交付结论

已完成当前墨墅（Moshu）1.1.0 定制项目的 Windows 安装版 EXE、完整免安装 ZIP 与对应源码 ZIP。用户选择的目标是 Intel / AMD x64、Windows 10 / 11。构建和本机成品验证均通过。

本次新建 `release/moshu-1.1.0-win-x64-20260928/`；原有 `release/moshu-1.1.0-win-x64/` 保持原位，其三个发行文件的 SHA-256 均与原报告一致。没有把旧包冒充本次新构建结果。

### 主要文件

| 文件（位于本次发行目录） | 用途 | 大小 |
| --- | --- | --- |
| `Moshu-Setup-1.1.0-win-x64.exe` | 安装版；双击运行向导 | 195,224,469 字节，约 186.2 MiB |
| `Moshu-Portable-1.1.0-win-x64.zip` | 完整解压后运行目录内的 Moshu.exe | 262,267,485 字节，约 250.1 MiB |
| `Moshu-Source-1.1.0.zip` | 对应源码及重打包脚本，分发时同时提供 | 约 57 MiB；准确大小和散列见最终清单 |
| `SHA256SUMS.txt` | 三个发行文件的 SHA-256 | 以成品文件为准 |
| `BUILD-REPORT.json` | 打包和基础启动验证 | 机器可读记录 |
| `COMPATIBILITY-REPORT.json` | 独立解压和兼容性验证 | 机器可读记录 |
| `先看这里-使用说明.txt` | 运行、换机及风险提示 | 面向使用者 |

安装版 SHA-256：`4ccedf9ee630cab2072499d234d3c5600b8e055e0cd474b1365c6fdba5002072`。

免安装 ZIP SHA-256：`9292a5d3d1ee17e96d08fb5df3f0fa839d304993d9e7d80df13568c7d2d796cf`。

源码 ZIP 在交付阶段同步本篇最终说明后重新检查 ZIP 完整性并更新清单；仅同步文档，不修改已验收的 EXE、免安装 ZIP 或程序源码。本篇不内嵌自身所在源码 ZIP 的散列，避免循环引用。

## 本次实际调整

1. Windows 使用 `app.disableHardwareAcceleration()` 软件渲染，替代原来关闭 GPU 沙箱的方案。保留 renderer 隔离和安全模式入口；软件渲染可能增加 CPU 占用。
2. 打包脚本新增严格字符校验的 `--release-suffix`，拒绝覆盖非空发行目录；独立保存本次打包日志。
3. 手工发行配置同时关闭 Windows 层继承的发布配置。没有向上游发布，保持手动更新。
4. 对应源码补入构建所需的 `.eslintrc.cjs` 与 `.gitattributes`。
5. 复用已有 Electron 41.10.7、SQLite 12.8.0、LanceDB 0.22.3。微软 VC 运行库来自项目已缓存的官方包，散列和 Authenticode 校验通过；仅在应用目录放置，不执行运行库系统安装。
6. 沿用本地 Monaco、字体、生产依赖及历史用户数据身份；运行目标电脑无需额外安装 Node.js、pnpm、Python 或 Visual Studio。
7. 新增 `scripts/verify-moshu-compat.mjs`，在源码目录以外验证真实分发文件，防止误用开发目录的依赖。

## 本次实测结果

实机：Windows 10 22H2 x64（10.0.19045）；构建 Node 22.13.1，运行 Electron 41.10.7 / ABI 145。

| 检查 | 实际结果 |
| --- | --- |
| TypeScript 全量类型检查 | 退出码 0 |
| 指定文件 ESLint、i18n 覆盖 | 均退出码 0，ESLint 零 warning |
| 墨墅相关回归 | 15 文件、102 测试通过 |
| 本地模型相关回归（不是实际模型调用） | 19 文件、229 测试通过 |
| 无效发行后缀、拒绝覆盖旧包 | 2 项命令级检查通过 |
| 编辑器诊断 | 最后查询无错误和警告 |
| 打包结构、x64 模块、原生加载、隐藏窗口 | 全部通过 |
| 安装包、免安装 ZIP、源码 ZIP 的 SHA-256 / ZIP 完整性 | 通过 |
| 脱离源码目录、中文和空格路径、无开发工具 PATH、不同当前目录 | 通过 |
| SQLite 中文文件保存后关闭重开 | 便携版和安装器载荷均通过 |
| LanceDB 建库、写入和本地向量检索 | 便携版和安装器载荷均通过；不调用向量模型 |
| 本地首页、帮助页、字体、IPC、渲染隔离、空模型配置、手动更新状态 | 隐藏窗口验证通过 |
| 100%、150%、200% 缩放参数与安全模式参数 | 启动验证通过；不是跨显示器视觉验收 |
| NSIS 内嵌载荷 | 7z 头校验、完整性和提取通过；关键文件与便携版散列一致 |
| 临时测试目录清理 | 只清理本次带所有权标记的临时目录，成功 |
| 安装器签名 | `NotSigned`；未购买或使用代码签名证书 |

新增兼容性验证共 9 项通过。测试使用一次性隔离配置，隐藏窗口中拦截 HTTP(S) 请求，没有操作既有作品或调用真实模型。提取 NSIS 载荷不等同于在系统中安装；没有自动安装、卸载或修改系统安全设置。

## 重打包

```text
node scripts/build-moshu.mjs
node scripts/package-moshu.mjs --release-suffix=新的唯一后缀
node scripts/verify-moshu-compat.mjs --release-suffix=相同后缀
```

详细流程见 `docs/moshu-packaging.md`。首次准备缺失的官方 VC 运行库缓存时，构建脚本需要明确的 `--allow-tool-downloads`；本轮使用现有缓存。

构建日志：`.runtime/moshu-package/logs/`；本次打包日志：`.runtime/moshu-package/logs/20260928/`；兼容性及交付校验：`.runtime/moshu-validation/20260928/`。日志和机器可读证据不写入 docs。

## 使用、分发和兼容性边界

- 推荐先在另一台目标电脑完整解压便携 ZIP，运行 `Moshu.exe`；不能只复制 EXE，也不要从 ZIP 内直接运行。
- 安装版默认当前用户安装。安装/卸载向导需要使用者实际验收；本次未执行真实系统安装。
- Windows 11、第二台电脑、标准用户独立账户和真实模型未实测。不能把这台 Windows 10 的成功当成所有系统小版本、CPU、显卡、安全软件或精简系统的保证。
- 不支持 Windows 7/8.1 或 32 位 Windows；不承诺 ARM64 原生兼容。建议已更新的 Windows 10 22H2 或 Windows 11。
- 程序不包含模型、模型服务、API Key、小说或原电脑的设置；AI 功能需要在新电脑自行准备和配置模型服务。
- 用户全局配置仍默认在 `%USERPROFILE%\.vela`，Electron 数据仍在 `%APPDATA%\ai-novel-writer`，作品保存在用户选择的项目目录。免安装不等于用户数据随程序携带。
- 未签名可能触发 SmartScreen 或“未知发布者”。先核对来源和 SHA-256，不要关闭杀毒软件或系统安全功能。
- 分发程序时同时提供对应源码 ZIP 和许可，遵守 GPL-3.0 及依赖许可；不要公开个人配置和作品。

用户侧详细说明见 `docs/moshu-windows-release.md`；最终构建及兼容性报告位于 `release/moshu-1.1.0-win-x64-20260928/`。
