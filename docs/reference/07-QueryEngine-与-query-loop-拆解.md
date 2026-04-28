# QueryEngine 与 query loop 拆解

> 基于 Claude Code v2.1.88 反编译源码分析  
> 重点文件：`src/QueryEngine.ts`、`src/query.ts`、`src/services/api/claude.ts`

## 1. 先分清两个角色

这一部分最容易被误读。

### `QueryEngine` 负责什么

`src/QueryEngine.ts` 的职责是：

- 作为一个会话对象持有 `mutableMessages`、`readFileState`、`permissionDenials`、usage。
- 处理用户输入与 slash command。
- 组装 system prompt、user context、toolUseContext。
- 做 transcript 写入、SDK 消息归一化和最终 result 包装。

它更像“会话协调器”。

### `query()` 负责什么

`src/query.ts` 的职责是：

- 维护一个 turn 级状态机。
- 在每一轮里准备上下文、调用模型、观察 `tool_use`、执行工具、插入 attachment，再决定要不要继续下一轮。

它才是真正的 agent loop。

如果用最短的话总结：

- `QueryEngine` 管 session boundary
- `query.ts` 管 turn loop

## 2. `ask()` 到底做了什么

`ask()` 只是一个 one-shot 包装器，它把外部传入的参数塞进 `new QueryEngine(...)`，再 `yield* engine.submitMessage(...)`。

对应代码：

- `src/QueryEngine.ts:1186-1288`

这段设计非常干净：

1. REPL、print、SDK 都不用直接操作 `query()` 的细节。
2. 他们只要准备好上下文，调用 `ask()` 即可。
3. 这也让 headless 模式天然支持多轮、tool use、MCP、结构化输出和预算约束。

## 3. `submitMessage()` 的完整职责

`submitMessage()` 是 `QueryEngine` 的主入口。

关键步骤如下。

### 3.1 初始化系统上下文

对应代码：

- `src/QueryEngine.ts:273-325`

这里会：

1. 决定当前主模型。
2. 决定 thinking 配置。
3. 通过 `fetchSystemPromptParts(...)` 取回：
   - `defaultSystemPrompt`
   - `userContext`
   - `systemContext`
4. 把 custom prompt、memory mechanics prompt、append prompt 拼成最终 `systemPrompt`。

这说明 system prompt 不是静态常量，而是运行时按工具、模型、工作目录、MCP 状态拼出来的。

### 3.2 构建 `processUserInputContext`

对应代码：

- `src/QueryEngine.ts:335-395`

这一步把几乎所有后续链路都接进来了：

- `commands`
- `tools`
- `mcpClients`
- `AppState`
- `abortController`
- `readFileState`
- `setSDKStatus`
- `discoveredSkillNames`
- `loadedNestedMemoryPaths`

这个上下文后续既会传给 `processUserInput`，也会传给 `query()` 里的工具执行层。

### 3.3 先处理用户输入，再决定要不要真正进模型

对应代码：

- `src/QueryEngine.ts:410-428`

这里会调用 `processUserInput(...)`。

它的作用不是“把 prompt 变成字符串”这么简单，而是先做一轮解释：

- slash command
- local command
- attachment
- 模型切换
- allowed tools 更新
- shouldQuery 判定

这意味着不是所有用户输入都会进模型。有些输入会在本地直接执行，然后 `QueryEngine` 直接返回结果。

### 3.4 用户消息要先写 transcript，再进 query loop

对应代码：

- `src/QueryEngine.ts:436-463`

这段很关键，因为很多 agent demo 都忽略了这一点。

这里选择在真正调用模型之前先写 transcript，原因是：

- 如果用户刚发消息，进程还没来得及收到任何 assistant 响应就被杀掉，
- 会话仍然应该能 resume，
- 否则会出现“消息已经被接受，但日志没有记录”的断裂。

这是一种很工程化的做法：优先保证恢复一致性，而不是只保证 happy path。

### 3.5 给 SDK/print 模式准备 replay ack

对应代码：

- `src/QueryEngine.ts:465-486`

如果启用了 `replayUserMessages`，它会把某些用户消息重新作为 replay message 发回去。

这件事在本地 REPL 不重要，但在 stream-json/SDK 协议里很重要，因为上游宿主要知道：

- 哪条输入被 runtime 接受了
- 哪条是用户消息
- 哪条是本地合成消息

### 3.6 发 system init

对应代码：

- `src/QueryEngine.ts:529-551`

这里会发送一个 `buildSystemInitMessage(...)`，把当前运行时环境告知 SDK/host：

- tools
- MCP clients
- model
- permission mode
- commands
- skills
- plugins
- fast mode

所以 SDK host 拿到的不是“黑盒 agent”，而是一套已初始化的 runtime 描述。

## 4. `queryLoop()` 的状态机结构

`query.ts:241-1710` 是整个系统最核心的一段。

### 4.1 状态对象不是装饰，而是 loop machine 的内存

对应代码：

- `src/query.ts:265-279`

它把这些东西放进 loop-local state：

- `messages`
- `toolUseContext`
- `autoCompactTracking`
- `maxOutputTokensRecoveryCount`
- `hasAttemptedReactiveCompact`
- `pendingToolUseSummary`
- `turnCount`
- `transition`

这意味着这个 loop 天生支持：

- 多轮递归
- 压缩恢复
- fallback/retry
- 工具总结异步生成
- turn budget 累积

### 4.2 每一轮开始前先做预取和上下文整理

对应代码：

- `src/query.ts:297-335`
- `src/query.ts:365-426`

顺序大致是：

1. memory prefetch
2. skill discovery prefetch
3. tool result budget
4. snip compact
5. microcompact
6. context collapse
7. autocompact

这说明这个 runtime 的设计理念不是“模型自己想办法处理长上下文”，而是客户端主动为下一轮准备最合适的上下文窗口。

### 4.3 `queryLoop` 真正调用模型的地方

对应代码：

- `src/query.ts:650-705`

这里会把以下内容送进 `deps.callModel(...)`：

- `messages`
- `systemPrompt`
- `thinkingConfig`
- `tools`
- `fallbackModel`
- `mcpTools`
- `queryTracking`
- `taskBudget`

注意它传给模型的不只是消息文本，还包括完整工具池和运行时状态。

## 5. `claude.ts` 如何把流式返回变成内部消息

### 5.1 使用原始流，不依赖高层流对象

对应代码：

- `src/services/api/claude.ts:1780-1836`

它直接调用：

```ts
anthropic.beta.messages.create({ ...params, stream: true }).withResponse()
```

然后消费的是 `BetaRawMessageStreamEvent`。

代码注释明确说明：

- 它故意不用高层 `BetaMessageStream`
- 因为不想承担 `partialParse()` 带来的额外开销
- 同时需要自己控制 `input_json_delta` 的拼装

### 5.2 内容块是自己累积的

对应代码：

- `src/services/api/claude.ts:1979-2065`

这一步会自己处理：

- `message_start`
- `content_block_start`
- `content_block_delta`
- `content_block_stop`
- `message_delta`

尤其关键的是：

- `tool_use` 的 `input` 先以字符串形式拼接 partial JSON
- `thinking` 需要保存 signature
- `message_delta` 到来时才会写回最终 usage 和 stop_reason

这就是为什么它不能简单地依赖更高层 SDK 结果对象：它需要精确控制这些时序。

### 5.3 为什么 assistant message 要在 `content_block_stop` 时先 yield

原因是：

- UI 和上层协议希望尽早看到 assistant block
- 但真正的 usage 和 stop_reason 还没到
- 所以它先产出 assistant message，
- 再在 `message_delta` 阶段回写最终 usage/stop_reason

这也是 `QueryEngine` 里 transcript 写入要特别小心的根本原因。

## 6. `tool_use` 是如何让 loop 继续的

对应代码：

- `src/query.ts:552-568`

这里的逻辑不是看 `stop_reason === tool_use`。

代码明确写了：

- `stop_reason === 'tool_use'` 不可靠
- 真正可靠的信号是 streaming 过程中确实收到了 `tool_use` block

所以它维护：

- `toolUseBlocks`
- `needsFollowUp`

只要 streaming 里出现工具调用，就进入工具执行阶段。

## 7. 工具执行完之后，为什么还能继续下一轮

对应代码：

- `src/query.ts:1380-1408`
- `src/query.ts:1547-1710`

工具执行后发生了 4 件事：

1. 把 `tool_result` 与 attachment 塞进 `toolResults`
2. 插入 queued command / file change / memory / skill discovery 等 attachment
3. 刷新 tools（为了接入新连接的 MCP server）
4. 计算 `nextTurnCount`，准备递归下一轮

换句话说，工具阶段不是“副作用结束点”，而是“下一轮采样前的上下文增量阶段”。

这正是 agent runtime 和普通聊天循环的最大区别。

## 8. 这个 loop 还有哪些工程级保护

### 8.1 tool use summary 不阻塞下一轮

对应代码：

- `src/query.ts:1411-1482`

工具摘要是异步生成的，不会阻塞下一轮模型调用。

这是一个典型的“非关键路径延迟隐藏”设计。

### 8.2 aborted tools 和 interrupted turn 被显式建模

对应代码：

- `src/query.ts:1484-1516`

如果在工具期间中断：

- 它会生成 interruption message
- 必要时附带 `max_turns_reached`
- 并用明确的 terminal reason 返回

所以“中断”是控制流的一部分，不是异常分支的附属品。

### 8.3 queued commands 和 attachment 是 loop 内部的一等消息

对应代码：

- `src/query.ts:1555-1650`

它会把：

- task notification
- prompt queue
- memory attachment
- skill discovery attachment

全部当成下一轮模型上下文的一部分，而不是 UI 层的附加物。

这件事很重要，因为它解释了为什么这个系统能把很多“系统侧事件”自然嵌入 agent 行为。

## 9. `QueryEngine` 如何收尾并输出最终结果

对应代码：

- `src/QueryEngine.ts:665-1137`

它一边消费 `query()` 的消息，一边做：

- transcript 记录
- SDK 消息归一化
- usage 累积
- replay ack
- compact boundary 处理
- structured output 捕获
- budget / max_turns / retry 上限检查

最后再决定产出哪一种 `result`：

- `success`
- `error_max_turns`
- `error_max_budget_usd`
- `error_max_structured_output_retries`
- `error_during_execution`

这说明“结果对象”不是模型直接给的，而是 runtime 自己综合判定出来的。

## 10. 这一层最值得借鉴的设计原则

### 原则 1：输入处理、agent loop、结果封装分层

不要把这三件事糊在一个 generator 里。

### 原则 2：把所有 runtime 副作用都建模成消息

包括：

- assistant block
- tool result
- attachment
- progress
- compact boundary
- local command output

这样才容易：

- 持久化
- 回放
- headless 协议化
- resume

### 原则 3：把“继续下一轮”的条件显式化

不要隐式依赖 stop reason，也不要把工具执行写成 callback 地狱。

这里的实现更像：

- 先收集 assistant 输出
- 再看是否有 tool use
- 再跑工具
- 再把新消息拼回上下文
- 再显式递归

这比多数 agent demo 稳得多。

