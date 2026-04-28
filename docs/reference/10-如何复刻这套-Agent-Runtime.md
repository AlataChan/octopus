# 如何复刻这套 Agent Runtime

> 基于 Claude Code v2.1.88 反编译源码分析  
> 重点文件：`src/main.tsx`、`src/QueryEngine.ts`、`src/query.ts`、`src/services/api/claude.ts`、`src/services/tools/*`、`src/services/mcp/client.ts`、`src/cli/structuredIO.ts`、`src/cli/print.ts`

## 一句话判断

如果你想从这个项目里学东西，最值得复刻的不是某个 prompt，也不是某个单独工具，而是它把下面几件事收成了一个统一运行时：

1. 同一条 agent loop 同时服务 REPL、headless、SDK、remote bridge。
2. 工具调用不是 JSON function calling，而是有权限、并发、恢复、中断、回写语义的执行系统。
3. MCP、子代理、技能、memory、会话持久化都不是外挂，而是主链路里的一级部件。

这意味着它真正提供的是“runtime architecture”，不是“功能拼装”。

## 1. 先不要照抄代码，先照抄边界

这个项目里最重要的不是某个函数本身，而是边界划分。复刻时建议先把下面 7 个边界钉死：

### A. 启动边界

- 入口文件只做模式分流。
- 不在 CLI 层写业务控制流。

参考：

- `src/entrypoints/cli.tsx`
- `src/main.tsx:884-1006`
- `src/main.tsx:2584-2615`

### B. 会话边界

- 用一个会话对象持有消息数组、权限拒绝、缓存、usage、read file state。
- 这个对象负责接用户输入、处理 slash command、拼 system prompt、调用 query loop。

参考：

- `src/QueryEngine.ts:184-620`
- `src/QueryEngine.ts:1186-1288`

### C. turn 边界

- 真正的 agent loop 独立出来，不和 UI、CLI、SDK 输出混在一起。
- 它的输入是“当前消息 + tool context + system context + model config”。
- 它的输出是“流式 assistant 事件 / tool_result / terminal result”。

参考：

- `src/query.ts:230-430`
- `src/query.ts:552-705`
- `src/query.ts:1366-1564`

### D. 模型边界

- API 层只负责和模型协议打交道。
- 不让 SDK 高层对象主导本地状态机。
- 自己消费原始流事件，自己拼 `text` / `thinking` / `tool_use`。

参考：

- `src/services/api/claude.ts:1780-1875`
- `src/services/api/claude.ts:1975-2065`
- `src/services/api/claude.ts:2478-2698`

### E. 工具边界

- 所有工具都进统一 `Tool` 抽象。
- built-in 和 MCP 工具在模型看来应当没有本质区别。

参考：

- `src/Tool.ts:355-603`
- `src/tools.ts:197-389`
- `src/services/mcp/client.ts:1744-1878`

### F. 权限边界

- 权限系统不能散在每个工具里。
- 所有工具执行都必须先经过统一的 `canUseTool` / hook / permission prompt 决策。

参考：

- `src/services/tools/toolExecution.ts:492-1175`
- `src/cli/structuredIO.ts:533-634`
- `src/cli/print.ts:4149-4323`

### G. transport 边界

- REPL、print、SDK、remote 只替换 IO 和 permission bridge。
- 不替换 `QueryEngine` 和 query loop。

参考：

- `src/cli/print.ts:2170-2215`
- `src/cli/structuredIO.ts:116-240`
- `src/services/api/client.ts:88-235`

## 2. 最小可复刻版本应该长什么样

如果你不是要 1:1 克隆 Claude Code，而是要“学其骨架”，建议先实现一个 6 部件版本：

1. `AppShell`
2. `SessionEngine`
3. `AgentLoop`
4. `ModelStreamAdapter`
5. `ToolRuntime`
6. `PermissionBridge`

可以把它抽象成这样：

```text
User Input
  -> SessionEngine.submitMessage()
  -> AgentLoop.runTurn()
  -> ModelStreamAdapter.sample()
  -> detect tool_use?
     -> ToolRuntime.execute()
     -> append tool_result
     -> AgentLoop.runTurn()
  -> final assistant result
```

这个结构里最关键的是：

- `SessionEngine` 负责会话，不负责采样。
- `AgentLoop` 负责 turn machine，不负责终端渲染。
- `ModelStreamAdapter` 负责协议，不负责工具执行。
- `ToolRuntime` 负责执行，不负责决定整个回合何时结束。

只要这四层没混，你后续加能力都还能站得住。

## 3. 真正值得复刻的 10 个设计点

### 1. `ask()` 只是薄封装，真正状态在 `QueryEngine`

`ask()` 只是为 non-interactive/SDK 场景创建一个 `QueryEngine`，然后把 prompt 扔进 `submitMessage()`。

参考：

- `src/QueryEngine.ts:1186-1288`

意义：

- CLI、SDK、脚本调用共享同一个会话协调器。
- 你不用维护第二套 headless 逻辑。

### 2. `submitMessage()` 负责“会话准备”，不是“模型调用”

`submitMessage()` 做的事情很多：

1. 包装 `canUseTool`，记录 permission denial。
2. 拉 system prompt 片段。
3. 跑 `processUserInput()` 处理 slash command 和附件。
4. 先写 transcript，再进 query loop。
5. 发 system init message。

参考：

- `src/QueryEngine.ts:209-620`

意义：

- “消息接受”与“模型响应”解耦。
- 用户消息被接受后，即使中途进程挂掉，也能 resume。

### 3. query loop 显式维护 turn state

`src/query.ts` 不是简单递归，而是一个显式状态机，持续维护：

- `messages`
- `toolUseContext`
- `turnCount`
- `autoCompactTracking`
- `maxOutputTokensRecoveryCount`
- `pendingToolUseSummary`
- `transition`

参考：

- `src/query.ts:241-305`

意义：

- 复杂行为不会藏在闭包和临时变量里。
- compact、retry、budget、tool summary 这些横切逻辑能共存。

### 4. prefetch 和主链路并行，而不是阻塞式做 enrichment

它会提前启动：

- relevant memory prefetch
- skill discovery prefetch

然后把这些等待隐藏在模型 streaming 和工具执行下面。

参考：

- `src/query.ts:296-337`
- `src/query.ts:1054-1065`

意义：

- 你可以做更重的上下文 enrichment，而不把首 token 延迟拉爆。

### 5. compact 是 runtime 行为，不是离线清理

这个项目把 compact 做成 loop 内置能力：

- history snip
- microcompact
- autocompact
- reactive compact
- tool result budget replacement

参考：

- `src/query.ts:365-430`
- `src/query.ts:1065-1186`

意义：

- 长会话不会把 agent loop 拖死。
- compact boundary 还能被 transcript 和 resume 理解。

### 6. 流式 API 事件必须自己拼块，不要完全交给 SDK

`services/api/claude.ts` 明确自己处理原始流事件，自己组装消息块并跟 usage、fallback、stop reason 对齐。

参考：

- `src/services/api/claude.ts:1780-1875`
- `src/services/api/claude.ts:1975-2065`

意义：

- 你才能控制 tool_use 的出现时机。
- 你才能实现 streaming tool execution、fallback discard、usage 精确统计。

### 7. 工具执行必须有“执行前”和“执行后”两个层次

执行前：

- tool lookup
- schema parse
- tool-specific validate
- hooks
- permission resolve

执行后：

- progress
- tool_result message
- context modifier
- transcript append

参考：

- `src/services/tools/toolExecution.ts:337-520`
- `src/services/tools/toolExecution.ts:635-1175`

意义：

- 工具调用不再是“本地函数 return 一段字符串”，而是 runtime 中的可观察事件。

### 8. 并发不是统一 `Promise.all`，而是基于工具语义分批

只读工具可并发，写状态工具必须串行。

参考：

- `src/services/tools/toolOrchestration.ts:1-188`

意义：

- 减少共享状态踩踏。
- 又不会把只读查询全都串行化。

### 9. streaming tool execution 不是优化，而是关键体验层

这个类做了 3 件很重要的事：

1. 工具一流出就可以开始跑。
2. progress 可以先发，结果按原始 tool arrival order 回放。
3. streaming fallback 时可以整体 discard，避免旧 `tool_use_id` 泄漏到下一轮。

参考：

- `src/services/tools/StreamingToolExecutor.ts:35-212`
- `src/query.ts:561-864`
- `src/query.ts:1011-1051`

意义：

- 首屏工具响应更快。
- transcript 不会因 fallback/retry 弄乱。

### 10. MCP 必须进统一工具面，不要搞两条 agent 路径

它不是“本地 tool + 外部插件”两套系统，而是把 MCP `tools/list` 回来的定义直接转成本地 `Tool`。

参考：

- `src/services/mcp/client.ts:1744-1878`

意义：

- 模型只需要理解一个 tool namespace。
- 权限、并发、回写、日志都能复用。

## 4. 复刻时最容易做错的地方

### 错法 1：让 CLI 直接驱动模型

后果：

- print/SDK 很快会裂出第二套实现。
- resume、remote、permission prompt 很难接回来。

正确做法：

- CLI 只负责组装依赖，业务进入 `SessionEngine`。

### 错法 2：把 tool call 只当函数调用

后果：

- 没有权限边界。
- 没有中断和并发策略。
- fallback/retry 后 transcript 很容易坏。

正确做法：

- 把工具执行建模成“事件流 + 结果消息 + context modifier”。

### 错法 3：把 memory / compact / skill 检索做成前置阻塞链

后果：

- 首 token 延迟越来越高。

正确做法：

- 能预取的尽量预取，能隐藏在 streaming 下面的尽量隐藏。

### 错法 4：把 MCP 当特例

后果：

- 权限和工具描述会分叉。
- 模型 prompt 也要解释两套工具系统。

正确做法：

- 动态包装进统一 `Tool` 抽象。

### 错法 5：完全相信模型 API SDK 的高层事件对象

后果：

- 一旦你需要 fallback、tool streaming、usage 对账、resume 一致性，就会失去控制权。

正确做法：

- 抓底层流事件，自己组 message block。

## 5. 一个现实可行的实施顺序

建议按 4 个阶段做，不要一口气上全量系统。

### 阶段 1：跑通最小单线程 agent

目标：

- 单会话
- 单模型
- 本地 2 到 3 个工具
- 无 MCP
- 无 compact

必须有：

- `SessionEngine`
- `AgentLoop`
- `ModelStreamAdapter`
- 最简权限接口

### 阶段 2：把工具层做对

目标：

- schema 验证
- 统一 `Tool`
- read-only 并发 / mutation 串行
- `tool_result` 回写

这一阶段完成后，你的系统才配叫“可执行 agent”。

### 阶段 3：把 transport 做薄

目标：

- REPL
- print/headless
- SDK/IDE bridge

要求：

- 只能替换 IO，不允许复制一套核心逻辑。

### 阶段 4：再加高级能力

包括：

- memory prefetch
- autocompact
- MCP
- subagent
- transcript resume
- budget tracking

这部分价值很高，但都应该建在前 3 阶段之上。

## 6. 如果只能学 5 个文件，先学哪 5 个

如果你时间有限，建议先按这个顺序读：

1. `src/query.ts`
2. `src/QueryEngine.ts`
3. `src/services/tools/toolExecution.ts`
4. `src/services/api/claude.ts`
5. `src/services/mcp/client.ts`

原因：

- `query.ts` 决定系统是不是 agent。
- `QueryEngine.ts` 决定系统是不是可用 runtime。
- `toolExecution.ts` 决定工具是不是可靠。
- `claude.ts` 决定 streaming 和 tool_use 是否可控。
- `mcp/client.ts` 决定它是不是可扩展平台。

## 7. 最后给一个更直接的工程结论

这个项目最值得借鉴的不是“Claude Code 有哪些功能”，而是它证明了一件事：

一个工程级别的 coding agent，真正需要的是一个统一 runtime，把下面这些东西同时纳进来：

- 会话状态
- 递归 turn loop
- 流式模型协议
- 工具执行系统
- 权限系统
- transport/SDK 桥接
- 外部工具生态接入

如果这 7 件事是分散的，你得到的是“能跑 demo 的 agent”。

如果这 7 件事在同一条主链路里，你才开始接近“可维护、可扩展、可恢复的 agent runtime”。
