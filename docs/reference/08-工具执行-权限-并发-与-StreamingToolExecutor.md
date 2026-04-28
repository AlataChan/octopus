# 工具执行、权限、并发与 StreamingToolExecutor

> 基于 Claude Code v2.1.88 反编译源码分析  
> 重点文件：`src/Tool.ts`、`src/tools.ts`、`src/services/tools/toolExecution.ts`、`src/services/tools/toolOrchestration.ts`、`src/services/tools/StreamingToolExecutor.ts`

## 1. 这套工具系统为什么不只是“function calling”

很多 agent demo 的工具层大概只有三步：

1. 模型返回 tool name
2. 用 JSON parse 参数
3. 调本地函数

Claude Code 的实现远比这个重：

1. 有统一 `Tool` 抽象。
2. 有 built-in / MCP 的统一工具池。
3. 有输入 schema、tool-specific validate、hook、权限流、并发语义、取消语义。
4. 有 streaming tool execution。
5. 有 transcript 一致性和 tool_result 回写规则。

这说明它的目标不是“能调用工具”，而是“能可靠地运行工具型 agent”。

## 2. `Tool` 抽象里有哪些关键字段

对应代码：

- `src/Tool.ts:355-560`

这个接口里最值得注意的不是 `call()`，而是下面这些设计：

### 执行相关

- `call(...)`
- `inputSchema`
- `inputJSONSchema`
- `mapToolResultToToolResultBlockParam(...)`

### 并发与破坏性语义

- `isConcurrencySafe(...)`
- `isReadOnly(...)`
- `isDestructive(...)`
- `interruptBehavior()`

### 权限与 hook 相关

- `checkPermissions(...)`
- `validateInput(...)`
- `preparePermissionMatcher(...)`

### 模型可见性相关

- `prompt(...)`
- `description(...)`
- `searchHint`
- `shouldDefer`
- `alwaysLoad`

### 其他工程语义

- `getToolUseSummary(...)`
- `getActivityDescription(...)`
- `toAutoClassifierInput(...)`
- `backfillObservableInput(...)`

这说明 `Tool` 本质上不是“函数签名”，而是“模型可见 + 权限可控 + runtime 可调度的执行单元”。

## 3. 工具池是怎么组织的

对应代码：

- `src/tools.ts:1-120`
- `src/tools.ts:197-389`

### 3.1 built-in 工具清单很大

默认内建工具包括：

- `BashTool`
- `FileReadTool`
- `FileEditTool`
- `FileWriteTool`
- `NotebookEditTool`
- `WebFetchTool`
- `WebSearchTool`
- `SkillTool`
- `AgentTool`
- `TodoWriteTool`
- `Task*Tool`
- `EnterPlanModeTool`
- `ListMcpResourcesTool`
- `ReadMcpResourceTool`
- 以及大量 feature-gated 工具

这点重要，因为它说明 agent 的核心能力不是后装的，是 runtime 原生就设计成 tool-rich。

### 3.2 工具池有模式过滤

`getTools(permissionContext)` 会根据当前模式做裁剪：

- simple/bare 模式只保留最核心工具
- REPL 模式会隐藏 primitive tool，改由 `REPLTool` 包装
- deny rules 会直接在“模型看到之前”过滤工具

这意味着工具池不是静态数组，而是运行时按权限和模式生成。

### 3.3 built-in 和 MCP 工具会合并成统一平面

`assembleToolPool(...)` 做三件事：

1. 取 built-in tools
2. 用 deny rule 过滤 MCP tools
3. 合并并去重

这里的设计很成熟，因为它不是简单拼接，还考虑了：

- prompt cache 稳定性
- built-in precedence
- server-prefix deny rule

## 4. 单次工具执行的真实流程

对应代码：

- `src/services/tools/toolExecution.ts:337-520`
- `src/services/tools/toolExecution.ts:920-1175`

### 4.1 `runToolUse(...)` 先做的是查找与兜底

步骤：

1. 从当前可见工具池里找工具。
2. 如果找不到，再尝试 alias fallback。
3. 如果仍然找不到，直接构造一个 `tool_result is_error=true` 返回给模型。

这里的思想是：

- 不把“未知工具”当成 runtime crash
- 而是把它变成模型可理解的 tool error

### 4.2 工具输入不是直接信任模型

`checkPermissionsAndCallTool(...)` 里会先做：

1. `inputSchema.safeParse(input)`
2. `tool.validateInput(...)`

如果失败，不抛异常给外层，而是转成：

- `<tool_use_error>...`
- `tool_result is_error=true`

这样模型能自己纠正下一次调用。

### 4.3 hook 先于权限执行

pre-tool hooks 会先运行，然后才进入权限决策。

好处：

- hook 可以修改输入
- hook 可以决定阻止 continuation
- hook 可以提前产出额外上下文

这意味着权限流不是 tool execution 的唯一闸门，hook 也在改变控制流。

## 5. 权限系统是如何接入工具执行的

对应代码：

- `src/services/tools/toolExecution.ts:921-1132`

核心逻辑：

1. `resolveHookPermissionDecision(...)`
2. 得到 `permissionDecision`
3. 如果不是 allow，则构造错误型 `tool_result`
4. 如果 allow，再继续执行工具

注意这里权限决策不仅有 allow/deny，还有来源信息：

- rule
- hook
- permissionPromptTool
- classifier
- mode

这使得系统不仅知道“能不能执行”，还知道“为什么能/不能执行”。

## 6. 为什么 headless 模式也能完整跑权限流

这正是这套设计的高价值处。

在 headless/SDK 模式下：

- 工具执行层仍然通过统一 `canUseTool(...)` 发起权限决策
- 只是这个决策函数的实现改成了 `StructuredIO` 或 MCP permission prompt tool

因此工具执行层不关心“对话框是谁弹的”，它只关心：

- 当前 decision 是什么
- 有没有 updatedInput
- 是不是被 abort

这就是一层合格抽象的样子。

## 7. 并发规则是怎么落地的

对应代码：

- `src/services/tools/toolOrchestration.ts:19-188`

### 7.1 并发不是全局并发，而是按批次分区

`partitionToolCalls(...)` 的规则是：

1. 单个非并发安全工具独占一个 batch
2. 连续的并发安全工具可以归入一个 batch

并发安全由工具自己通过 `isConcurrencySafe(input)` 决定。

### 7.2 只读工具可以并发

对于 concurrency-safe batch：

- `runToolsConcurrently(...)`
- 最多并发数由 `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 控制

### 7.3 改写状态的工具串行

对于非 concurrency-safe 工具：

- `runToolsSerially(...)`
- 每执行完一个工具，都允许更新 `currentContext`

这很合理，因为像 `Edit`、`Write`、某些 bash、状态型 MCP 工具，本来就不该并发。

## 8. 为什么还需要 `StreamingToolExecutor`

对应代码：

- `src/services/tools/StreamingToolExecutor.ts`

普通 `runTools(...)` 适合“assistant 输出完整后再统一跑工具”的模式。

但这里系统支持 streaming tool execution，所以需要另一层：

- 工具一边流式出现
- 一边开始执行
- 进度消息可以先吐给 UI
- 但最终结果仍要保证顺序和上下文一致性

这就是 `StreamingToolExecutor` 的职责。

## 9. `StreamingToolExecutor` 的关键设计

### 9.1 每个工具都被追踪成 `TrackedTool`

字段包括：

- `status`
- `isConcurrencySafe`
- `results`
- `pendingProgress`
- `contextModifiers`

这说明它不是“跑个 promise 然后 await”，而是一个有状态的 mini scheduler。

### 9.2 执行时允许“顺序产出 progress，延迟产出结果”

对应代码：

- `src/services/tools/StreamingToolExecutor.ts:260-520`

它的策略是：

- progress message 立即进入 `pendingProgress`
- `getCompletedResults()` 会优先吐 progress
- 最终结果等该工具完成后再统一产出

所以 UI 可以即时感知工具状态，而模型上下文仍然保持顺序。

### 9.3 只有 Bash error 会杀掉并发兄弟

对应代码：

- `src/services/tools/StreamingToolExecutor.ts:312-352`

实现细节非常有意思：

- 若某个工具返回 error result，
- 且这个工具是 `BashTool`，
- 则会触发 `siblingAbortController.abort('sibling_error')`

为什么只针对 Bash：

- Bash 工具往往有隐式依赖链
- 一个失败后，后续并行 bash 结果可能没有意义
- 但读取类工具彼此独立，不应该因为一个失败全部取消

这不是通用理论，而是非常实战的经验判断。

### 9.4 还要处理 user interrupt 和 streaming fallback

`StreamingToolExecutor` 还专门建模了三种 synthetic error：

- `sibling_error`
- `user_interrupted`
- `streaming_fallback`

这些 synthetic tool result 的存在非常重要，因为否则：

- 模型会看到孤儿 `tool_use`
- transcript 会断链
- resume / replay / UI 都会出错

## 10. tool result 为什么必须重新包装

每个工具执行完，结果不会直接作为 JS 对象传回上层逻辑结束。

而是会被映射成：

- `ToolResultBlockParam`
- 再变成一条 `user` 消息中的 `tool_result`

原因是 agent loop 的下一轮只认“消息”，不认“函数返回值”。

所以工具系统和模型循环之间的桥梁不是函数调用返回，而是消息协议。

这也是它为什么能支持：

- transcript
- resume
- streaming fallback
- SDK stream-json
- bridge

## 11. 这套工具层最值得抄的不是接口，而是语义

如果你要借鉴，最值得保留的是下面这些语义：

### 11.1 工具必须声明并发语义

不要把所有工具都当成可并发 promise。

### 11.2 工具必须显式进入权限层

不要把权限塞进具体工具实现里。

### 11.3 输入错误要转成模型可理解的 `tool_result error`

不要直接 throw 给用户看。

### 11.4 工具执行要能被中断，还要能产出 synthetic result

否则一旦有 fallback 或 abort，整个会话都会失去一致性。

### 11.5 progress 和 result 必须分开对待

否则你要么拿不到实时 UI，要么破坏消息顺序。

## 12. 对复刻者的建议

如果你不是要原样复刻 Claude Code，而是想借用它的设计，我建议优先学习这几个文件：

- `src/Tool.ts`
- `src/tools.ts`
- `src/services/tools/toolExecution.ts`
- `src/services/tools/toolOrchestration.ts`
- `src/services/tools/StreamingToolExecutor.ts`

尤其要看的是：

- 它们怎样把“工具定义”
- “权限决策”
- “并发调度”
- “消息回写”

做成了一条完整链路。

真正成熟的 agent tool runtime，核心从来都不是“call 一个函数”，而是“如何在复杂运行时里安全地 call 一个函数”。

