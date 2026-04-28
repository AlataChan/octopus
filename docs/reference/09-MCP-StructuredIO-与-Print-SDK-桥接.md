# MCP、StructuredIO 与 Print/SDK 桥接

> 基于 Claude Code v2.1.88 反编译源码分析  
> 重点文件：`src/services/mcp/client.ts`、`src/cli/structuredIO.ts`、`src/cli/print.ts`、`src/services/api/client.ts`

## 1. 为什么这一层特别有参考价值

很多项目把下面这些东西分散实现：

- 本地 CLI
- headless 模式
- IDE SDK
- 远程工具
- WebSocket/SSE transport

Claude Code 的价值在于，它没有把这些做成彼此孤立的模式，而是把它们接成了同一个 runtime：

1. print/SDK 模式调用的仍是同一个 `ask()` / `QueryEngine`
2. MCP 工具会被包装成同一个 `Tool` 抽象
3. 权限流通过 `StructuredIO` 和 control protocol 接进核心执行链
4. remote transport 只替换 IO，不替换 agent loop

这是一种很“runtime-first”的设计。

## 2. print 模式并不是简化版 CLI

对应代码：

- `src/main.tsx:2584-2615`
- `src/cli/print.ts:2170-2215`

`--print` 模式下，程序会：

1. 初始化非交互环境
2. 建立 `StructuredIO` 或 `RemoteIO`
3. 调用 `ask(...)`
4. 消费同一套 `SDKMessage`

这意味着：

- 它不是“打印最终回答”
- 它是真正的 headless agent runtime

支持的东西包括：

- 多轮 turn
- tool use
- permission prompt
- MCP elicitation
- result envelope
- stream-json 协议

## 3. `ask()` 如何接入 print/SDK 壳层

`print.ts` 里会把当前上下文传给 `ask(...)`：

- commands
- all tools
- all MCP clients
- readFileCache
- `handleElicitation`
- `setSDKStatus`
- agent definitions

对应代码：

- `src/cli/print.ts:2170-2215`

这说明 print 层并没有重写核心业务，只是在给 runtime 提供外部依赖。

## 4. `StructuredIO` 是什么

`StructuredIO` 可以理解为：

- 一个基于 NDJSON 的 control/message 协议终端
- 它负责把 stdin/stdout 变成结构化消息流

对应代码：

- `src/cli/structuredIO.ts:116-240`
- `src/cli/structuredIO.ts:240-520`

它做的事情包括：

1. 从输入流中解析：
   - `user`
   - `assistant`
   - `system`
   - `control_request`
   - `control_response`
2. 维护 `pendingRequests`
3. 向 stdout 发送结构化控制消息
4. 处理 SDK host 的权限响应、hook callback、elicitation 响应

所以 `StructuredIO` 不是简单的 stdin parser，而是一个会话协议端点。

## 5. 为什么 `sendRequest()` 是关键

对应代码：

- `src/cli/structuredIO.ts:520-694`

它的作用是：

1. 把内部动作包装成 `control_request`
2. 放进 outbound stream
3. 把 promise 挂进 `pendingRequests`
4. 等待 `control_response`
5. 支持 abort 时主动发 `control_cancel_request`

这让 runtime 可以把很多“本来只能在本地同步阻塞完成的事情”，改造成远程可协商协议：

- 权限请求
- hook callback
- elicitation
- sandbox network permission

这套协议层是整套系统能跑到 IDE / remote / bridge 的关键。

## 6. `createCanUseTool()` 怎么把权限系统桥出去

对应代码：

- `src/cli/structuredIO.ts:533-660`

它做的不是简单转发，而是“本地权限规则 + hook + SDK host prompt”的竞态整合。

执行顺序大致是：

1. 先跑本地 `hasPermissionsToUseTool(...)`
2. 如果直接 allow/deny，就立刻返回
3. 否则同时启动：
   - hook 侧权限决策
   - SDK host 侧 `can_use_tool` control request
4. 两边 race
5. 谁先决定，就用谁的结果

这段设计的妙处是：

- SDK host 的 UI 不会被 hook 阻塞
- hook 又不会失去控制权
- 运行时层只看到最终 `PermissionDecision`

这是一个非常值得借鉴的“多来源权限决策归一化”模式。

## 7. print 模式还支持另一种权限桥：permission prompt tool

对应代码：

- `src/cli/print.ts:4149-4348`

这里还有一条平行路径：

- 如果用户传了 `--permission-prompt-tool <mcp-tool>`
- 系统可以不用 stdio control request
- 而改用某个 MCP 工具来承载权限提示

实现方式是：

1. 先走 `hasPermissionsToUseTool(...)`
2. 如果需要询问
3. 调用指定的 permission prompt MCP tool
4. 把其返回值解析成 `PermissionDecision`

这说明权限系统本身也被设计成可插拔的执行后端。

## 8. MCP 为什么是一级公民

对应代码：

- `src/services/mcp/client.ts:1744-1878`

`fetchToolsForClient(...)` 会把 MCP server 返回的 tool，包装成标准 `Tool` 对象。

包装内容包括：

- `name`
- `mcpInfo`
- `description/prompt`
- `inputJSONSchema`
- `isConcurrencySafe`
- `isReadOnly`
- `isDestructive`
- `isOpenWorld`
- `checkPermissions`
- `call`

换句话说，MCP 工具不是 runtime 外部的异类对象，而是被投影进了统一的工具平面。

模型最终看到的是：

- 同一批工具定义
- 同一种 `tool_use`
- 同一种 `tool_result`

它根本不需要区分“本地工具”还是“远程 MCP 工具”。

## 9. MCP 工具调用不是裸调，而是有恢复逻辑的

对应代码：

- `src/services/mcp/client.ts:2800-2985`

`callMCPToolWithUrlElicitationRetry(...)` 处理了一类很真实的问题：

- MCP tool 调用时，server 可能返回 `-32042 UrlElicitationRequired`
- 用户需要先打开一个 URL、登录、授权
- 完成后才能重试 tool call

这里的处理链路是：

1. 调用 MCP tool
2. 如果收到 `UrlElicitationRequired`
3. 校验 error data 里的 elicitation 参数
4. 优先跑 hook
5. 若 hook 没解决：
   - print/SDK 模式走 `handleElicitation(...)`
   - REPL 模式走 appState queue + ElicitationDialog
6. 最后 retry tool call

这段逻辑的重要性在于：

- 它把 MCP 协议里的“交互式缺口”也纳入 runtime 统一控制流
- 没有把它留给 UI 层自己想办法

## 10. `handleElicitation()` 说明 SDK 不是只会收文本

对应代码：

- `src/cli/structuredIO.ts:694-736`

它会通过 control request 向 SDK host 请求：

- 表单式 elicitation
- URL 式 elicitation

然后等 host 回 `ElicitResult`。

这说明这个协议从一开始就不是为“纯聊天文本”设计的，而是为“受控 agent runtime”设计的。

## 11. `StructuredIO` 还承担了 orphan/duplicate response 处理

对应代码：

- `src/cli/structuredIO.ts:240-420`

它会维护：

- `pendingRequests`
- `resolvedToolUseIds`

原因是现实里会出现：

- control_response 重复到达
- bridge 重连后旧响应回流
- host 和 bridge 两边发生竞争

如果不做 resolved tracking，就会发生：

- duplicate assistant message
- duplicate tool_result
- API 400

这是一种典型的协议层幂等保护，很多 agent demo 完全没有。

## 12. transport 层是可替换的，但 runtime 不变

从代码可以看到至少三种 transport 方案：

- `WebSocketTransport`
- `HybridTransport`：WS 读 + HTTP POST 写
- `SSETransport`：SSE 读 + HTTP POST 写

其中 `HybridTransport` 和 `SSETransport` 还做了：

- 批量写入
- retry
- backpressure
- reconnect

关键不是 transport 本身，而是它们都服务于同一个 `StructuredIO` / SDK message 协议。

这就是为什么切换 transport 不需要重写 agent loop。

## 13. 多后端模型支持也遵循同一思路

对应代码：

- `src/utils/model/providers.ts:4-14`
- `src/services/api/client.ts:88-235`

这套 runtime 不只支持 Anthropic first-party：

- `firstParty`
- `bedrock`
- `vertex`
- `foundry`

虽然 provider 变了，但上层仍然维持：

- Anthropic 风格的消息接口
- 同一套 tool runtime
- 同一套 query loop

这说明它的抽象边界放得很稳：

- provider 差异收敛在 client layer
- agent runtime 不感知 provider 细节

## 14. 对复刻者来说，这层最值得学的是什么

### 14.1 把协议层和 runtime 层分开

不要让工具执行层知道：

- 当前是 CLI
- 还是 IDE
- 还是远程 bridge

它只该知道：

- 当前有没有权限
- 有没有 elicitation 结果
- 收到了什么 tool_result

### 14.2 把权限提示协议化

不要把权限 prompt 写死在本地 UI 里。

### 14.3 把 MCP 工具 runtime 化，而不是特殊分支化

不要把 MCP 当成“另一套工具系统”。

### 14.4 协议层必须做幂等保护

特别是：

- duplicate response
- orphan response
- cancel race
- reconnect replay

### 14.5 transport 可以替换，但消息协议不要乱

一旦消息协议稳定，上层 agent runtime 就能跨 terminal、IDE、远程 server 复用。

## 15. 这一层的真正价值

如果说 `query.ts` 展示的是“如何写 agent loop”，  
那这一层展示的就是“如何把 agent loop 变成可集成的产品运行时”。

这比单纯的 prompt orchestration 更接近真正可交付的系统：

- 可嵌到 IDE
- 可跑 headless
- 可走 bridge
- 可接远程工具
- 可带权限流
- 可恢复
- 可协议化

这也是为什么我认为这个项目很有参考价值的原因之一：  
它在很多地方已经不是“一个终端助手”，而是一套通用 agent runtime 平台。
