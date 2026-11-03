# Team Workbench / 团队工作台

A local MCP workbench for native Codex collaborators, inspired by DeepSeek Harness.
Tasks, lifecycle observations, exact parent relationships and source-labeled records
share one conversation panel.

**0.5.2 为开发验证版，GitHub 源码发布不代表已在你的客户端安装。真实历史直读已实测；客户端
直接跳转与完整桌面 UI 验收尚未完成。** 原稳定源码仍可追溯至提交
[`3a66a9a`](https://github.com/912925635/codex-team-workbench/commit/3a66a9accb0a8ae9fb6dc54fefad1b45d5424d29)。

## 已实现与实测

- SQLite 持久化任务、负责人、DAG 依赖、原子领取与版本冲突检查。
- 原生 `SubagentStart`、`SubagentStop`、`PreModelRequest` 回调写入插件自己的元数据
  journal；普通 MCP 快照自动读取，无需反复发同步指令，不使用模型轮询状态。
- 真实同一子代理的「运行→空闲→续接运行→空闲」已验证；续接运行由
  `PreModelRequest` 捕获。回合停止与任务成功分开记录。
- 真实父子孙关系经公开线程父节点元数据核对；树形节点与工作流分组分别保留含义。
  只有同一会话关联时，不虚构父子关系。
- 原生计时进程实际运行 135.169 秒。运行证据超过两分钟时保留「运行后未收到停止、
  活跃性待确认」，真实停止回调到达后才转为空闲。
- 初始指令、执行结果与可见会话快照分开保存。快照是有来源、有边界的可见历史，
  不冒充完整工具或推理转录。
- 已绑定会话的可见历史可通过公开分页接口直接读取；刷新运行记录直接读取已接收事件，
  均不向主对话发消息。打开按钮使用宿主声明的 `openLinks` / `ui/open-link`，准确保留
  拒绝或链接回执；当前客户端是否接受 `codex://` 仍待实测。
- 明确对当前工作台启用后，后台监听现有插件事件日志，在子代理回合停止后自动同步
  一页可见消息，按事件键去重，无需主代理回读。旧工作台默认关闭，不扩大 Hooks 范围。
- 启动、续接及可选的主会话协助操作明确标注会发送请求；任务正文保存在后端，执行与
  续接消息只带请求标识。消息发出不等于执行成功；旧代理不在目录时不新建替身。

0.5.1 基线为 92 项通过；当前 0.5.2 本地回归 118 项通过。按钮路径、真实直读证据与未完成的宿主检查见
[0.5.2 按钮验收](docs/BUTTON_ACTIONS_0.5.2.md)，原生事件证据见
[0.5.1 验收记录](docs/ACCEPTANCE_0.5.1.md)，版本变化见 [CHANGELOG](CHANGELOG.md)。
公开仓库仅含合成测试数据，不含真实会话标识、转录、任务数据库或测试回执。
后台架构、实测耗时与尚未测量的部分见 [数据流说明](docs/DATA_FLOW_0.5.2.md)。
0.5.2 隔离后端已用真实新代理及同一代理续接验证，两个停止事件到会话页保存分别为
1158 / 1021 毫秒。该验证使用现有测试探针；打包 Hooks 与客户端画面仍待实际加载验收。

## 从 GitHub 添加

标准目录清单位于 `.agents/plugins/marketplace.json`，`./` 指向仓库根部插件。
市场名保持 `codex-team-workbench`，插件名保持 `team-workbench`。已经添加这个
GitHub 市场的用户应更新原来源，不需要重复创建插件。跟踪 `main` 可获取后续源码，
固定 commit 不会跟随更新；市场同步、安装更新与活跃 MCP 连接重载是不同步骤。
详见 [市场与更新说明](docs/MARKETPLACE.md)。

官方已核实的工作区同步路径需要**工作区管理员**：

1. 打开 **Admin → Plugins → Add → Import marketplace**。
2. Source 填 `https://github.com/912925635/codex-team-workbench`；Path 留空；
   Branch 填 `main`，或固定到一个审核过的完整 commit。
3. 导入后按工作区策略安装 Team Workbench，并正常审阅三项元数据 Hooks。

这是工作区 GitHub 来源导入，不是单纯连接 GitHub 应用。个人账号若没有该管理入口，
这里不假设存在同名按钮；使用客户端实际提供的原生安装入口。
[官方 GitHub 导入说明](https://learn.chatgpt.com/docs/enterprise/plugin-management)
说明了管理员要求、仓库根路径和同步方式。

已有私有插件与新 GitHub 来源**可能是不同身份**，数据目录也可能不同。不要先卸载旧版，
不要删除旧数据库再重装；先确认身份、备份原数据并核对新实例的数据根。
仓库不嵌入任何人的私有插件 ID，也不自动把个人插件迁移到工作区。
详见 [安装、保留数据与移除](docs/INSTALL.md)。

## Hooks 与权限

源码声明三项待审阅的插件 Hooks。发布或克隆仓库不会修改本机 `hooks.json`、信任记录、
模型设置或现有安装。安装后仍需在 **Settings → Hooks** 或输入框的 **Review hooks**
中正常审阅；未受信任时不执行。

处理器只持久化明确绑定、未归档工作台对应根会话的事件/代理/回合标识、类型和时间。
不保存提示词、对话正文、工具载荷、凭据或 Token 数据；不读宿主私有会话目录或数据库。
启用这个范围需要用户正常批准，单个测试会话的授权不等于所有工作台的授权。
每次回调使用短时 Node 进程，没有常驻监听器或远程数据上传。

若已有开发探针，先确认插件自身回调正常，再只移除准确匹配的开发定义。
工作台不要同时读取两份 journal。迁移脚本只生成计划，不自动改配置。

## 本地开发

需要已有 **Node.js 24+**（使用内置 `node:sqlite`）；Windows 公开元数据读取还需要
已有 PowerShell 7。没有 npm 依赖，不需要 API Key 或另装 Codex CLI。

```powershell
npm run check
npm test
npm run preview
```

预览仅绑定 `127.0.0.1` 动态端口，使用真实本地存储；它不是桌面插件安装或 UI 验收。
Ctrl+C 只停止该预览。`node src/server.mjs` 提供 stdio MCP。
可用 `npm run pack:local` 生成源码包；检查、测试和打包脚本不会安装插件、信任 Hooks、
重启宿主或启动模型。

数据根优先级：`TEAM_WORKBENCH_DATA`，否则 `PLUGIN_DATA/team-workbench`，否则当前
工作目录下的 `.team-workbench`。升级必须核实实际根目录；相同包名不保证跨来源数据迁移。

## 当前边界

新 GitHub 安装的面板激活、视觉连线、点击跳转和续接按钮的完整客户端验收仍未完成。
公开导航工具实际返回过成功，但这不等于目视确认界面。当前会话的 MCP 热重载也未核实，
关闭重开面板不保证替换旧连接。

插件不能凭匿名 metadata 自动取得原生线程 UUID；绑定必须来自明确授权的准确来源。
代理目录丢失后的历史代理恢复尚未证明可行。续接依赖实际父会话能够访问那个代理及
受支持的协作工具；不向 V2 子代理直接发送 app-server 输入，不偷偷换成自管团队。

## 许可证

MIT。[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的任务板设计与
部分语义适配保留 MIT 许可和归属，见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)
及 [上游许可证](LICENSES/DeepSeek-Harness-MIT.txt)。
