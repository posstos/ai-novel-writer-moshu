# 启动下载失败修复记录

日期：2026-09-27

## 结论

本次依赖安装故障已处理。项目依赖就绪检查、实际 BAT `/check` 和 Electron 内的 SQLite 内存数据库自检均通过。用户可以重新双击项目根目录的 `一键启动.bat`。

这不是模型或完整桌面流程的验收：本轮没有打开写作应用 GUI、启动模型服务或下载模型。

## 失败证据与判断

原始日志：`.runtime/launcher/logs/20260927-164400-17816.log`。

- 普通依赖阶段已显示 `added 871, done`，不是全部依赖都未下载。
- Electron 安装脚本出现 `TypeError: fetch failed`；实际安装器是 `@electron/get` 的 Fetch 下载器。
- `better-sqlite3` 的预编译包下载出现 `read ECONNRESET`，随后尝试本机编译。
- 日志明确显示已经找到 Python 3.13.2，不能将其解释为缺少 Python。
- 初始日志没有提供足够证据认定缺少 Visual Studio，也不能仅凭 `fetch failed` 确定具体网络设备或运营商原因。

只读探测核对了实际版本和下载文件：Electron 41.10.7、SQLite 12.8.0、Windows x64，Node ABI 127 / Electron ABI 145。官网对应三个文件的 HEAD 请求均返回 200；镜像地址也仅做了 HEAD 比较，没有因此修改下载源或从镜像安装。HEAD 成功本身不作为完整下载成功的证据。

## 获得同意后执行的修复

用户明确同意补齐项目依赖并进行无界面自检；范围不含模型、Python / VS 安装和写作 GUI 启动。

1. 使用项目已有的 pnpm 11.11.0，沿用现有下载配置和缓存，不升级包管理器。
2. 重试时日志显示 `reused 871, downloaded 0`：普通依赖全部复用缓存。Electron / SQLite 的独立二进制下载不包含在这个 npm 包计数中。
3. Electron 安装脚本完成；现有 `rebuild:electron` 流程准备并验证了 Electron ABI 对应的 SQLite。
4. 再次运行原生模块准备命令，直接返回已验证状态。
5. 最后只调用原生探测函数，不再触发重建，内存数据库查询仍然成功。

本项目定义了同名 `rebuild` 脚本。此次包含 `rebuild electron better-sqlite3` 的 pnpm 调用实际先补齐了依赖，再进入项目的 `rebuild:electron` 脚本；不能把它误记为仅执行了 pnpm 内置的定向重建。上述结果以实际日志和独立探测为准。

未手工删除缓存、锁文件或小说数据；未修改 `package.json`、`.npmrc`、`pnpm-workspace.yaml` 和现有 `prepare-native-for-electron.mjs` 的内容，回读哈希与修复前一致。没有配置镜像、关闭 TLS 验证或关闭 Electron 安装器的校验。

## 启动器改进

- 初始化 pnpm、安装项目依赖、准备原生模块时，对可识别的临时下载错误最多尝试 3 次，间隔 2 秒。
- 配置错误、证书信任错误等未命中网络重试规则时直接报告；不自动删除锁文件或切换下载源。
- 应用启动命令默认只执行一次，不因退出而循环重启。
- Windows PowerShell 按 UTF-8 解码 Node 工具输出，结束后恢复原编码，减少此前的乱码。
- 当前启动进程不显示 pnpm 升级通知，继续使用项目指定版本；不修改全局配置。
- 仍保留首次初始化确认、日志、端口 / 互斥锁保护和只读检查模式。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| PowerShell 5.1 语法解析 | 通过 |
| 启动流程断言 | 37 项通过 |
| 原生命令退出码与重试断言 | 21 项通过；只运行测试目录内的假 CMD 文件 |
| Node 源码约束测试 | 13 项通过 |
| 实际依赖修复命令 | 退出码 0 |
| Electron / SQLite 独立探测 | 退出码 0，`ELECTRON_SQLITE_READY` |
| 主脚本只读就绪检查 | 退出码 0 |
| 从项目外调用 BAT `/check` | 退出码 0 |

本机结构化结果位于 `.runtime/launcher/`：`dependency-repair-result.json`、`repair-regression-result.json`、`repair-final-readiness.json`。修复过程日志位于 `.runtime/launcher/logs/repair-*.log`。这些是本机忽略目录中的运行证据，不随源码提交。

## 接下来

重新双击 `一键启动.bat`。目前依赖已齐全，不需要因为这次故障重装 Node / Python 或清空依赖。如果出现新的错误，请保留最新日志，再按新的失败环节诊断，不把依赖自检通过等同于完整应用 / 模型验收通过。
