# Agent Runtime 接口草图与伪代码

> 基于 Claude Code v2.1.88 反编译源码分析  
> 用途：把前面的“架构理解”压缩成可直接实现的接口和伪代码  
> 对照来源：`src/QueryEngine.ts`、`src/query.ts`、`src/Tool.ts`、`src/services/tools/*`、`src/services/mcp/client.ts`、`src/cli/structuredIO.ts`

## 0. 这份文档怎么用

这不是 Claude Code 源码的逐字翻译。

这份文档做的是两件事：

1. 把它的关键对象收敛成一套可实现接口。
2. 把它的控制流改写成更容易照抄的伪代码。

如果前一篇是“架构规范”，这一篇就是“接口合同”。

## 1. 建议先实现的核心类型

下面这些类型并不要求 1:1 对齐源码名字，但责任边界建议保持一致。

## 2. 消息模型

```ts
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result'
      tool_use_id: string
      content: string | Array<unknown>
      is_error?: boolean
    }
  | { type: 'image'; data: unknown }

type UserMessage = {
  type: 'user'
  uuid: string
  timestamp: string
  message: {
    role: 'user'
    content: string | ContentBlock[]
  }
  isMeta?: boolean
  toolUseResult?: string
}

type AssistantMessage = {
  type: 'assistant'
  uuid: string
  timestamp: string
  requestId?: string
  message: {
    id?: string
    role: 'assistant'
    content: ContentBlock[]
    stop_reason?: string | null
    usage?: Usage
  }
  isApiErrorMessage?: boolean
  apiError?: string
}

type ProgressMessage = {
  type: 'progress'
  uuid: string
  timestamp: string
  data: ToolProgressData
  parentToolUseId?: string | null
}

type AttachmentMessage = {
  type: 'attachment'
  uuid: string
  timestamp: string
  attachment: Attachment
}

type SystemMessage = {
  type: 'system'
  uuid: string
  timestamp: string
  subtype: string
  compactMetadata?: CompactMetadata
}

type ToolUseSummaryMessage = {
  type: 'tool_use_summary'
  uuid: string
  timestamp: string
  summary: string
  precedingToolUseIds: string[]
}

type InternalMessage =
  | UserMessage
  | AssistantMessage
  | ProgressMessage
  | AttachmentMessage
  | SystemMessage
  | ToolUseSummaryMessage
```

关键约束：

1. `tool_result` 放在 user-side message 中。
2. progress 和 attachment 也是内部消息，不是 UI 私货。
3. assistant content 必须允许 `text`、`thinking`、`tool_use` 混合出现。

## 3. SDK 结果模型

```ts
type SDKResultMessage =
  | {
      type: 'result'
      subtype: 'success'
      is_error: boolean
      result: string
      structured_output?: unknown
      stop_reason: string | null
      num_turns: number
      duration_ms: number
      duration_api_ms: number
      total_cost_usd: number
      usage: Usage
      permission_denials: PermissionDenial[]
      uuid: string
      session_id: string
    }
  | {
      type: 'result'
      subtype:
        | 'error_max_turns'
        | 'error_max_budget_usd'
        | 'error_max_structured_output_retries'
        | 'error_during_execution'
      is_error: true
      errors: string[]
      stop_reason: string | null
      num_turns: number
      duration_ms: number
      duration_api_ms: number
      total_cost_usd: number
      usage: Usage
      permission_denials: PermissionDenial[]
      uuid: string
      session_id: string
    }
```

来源：

- `src/QueryEngine.ts:619-631`
- `src/QueryEngine.ts:805-851`
- `src/QueryEngine.ts:883-1137`

## 4. 会话状态

```ts
type SessionState = {
  sessionId: string
  mutableMessages: InternalMessage[]
  readFileState: FileStateCache
  permissionDenials: PermissionDenial[]
  totalUsage: Usage
  discoveredSkillNames: Set<string>
  loadedNestedMemoryPaths: Set<string>
  hasHandledOrphanedPermission: boolean
}
```

这部分必须由单一对象拥有。

不要让：

- App shell
- Tool runtime
- API adapter

各自持有一份消息数组。

## 5. turn 状态

```ts
type TurnState = {
  messages: InternalMessage[]
  toolUseContext: ToolUseContext
  autoCompactTracking?: AutoCompactTrackingState
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride?: number
  pendingToolUseSummary?: Promise<ToolUseSummaryMessage | null>
  stopHookActive?: boolean
  turnCount: number
  transition?: ContinueReason
}
```

来源：

- `src/query.ts:197-206`

## 6. 工具描述模型

```ts
type ToolDescriptor<Input = unknown> = {
  name: string
  aliases?: string[]
  isMcp?: boolean
  inputSchema: ZodSchema<Input>
  inputJSONSchema?: Record<string, unknown>

  description(): Promise<string>
  prompt(): Promise<string>

  isConcurrencySafe?(input: Input): boolean
  isReadOnly?(input?: Input): boolean
  isDestructive?(input?: Input): boolean
  isOpenWorld?(input?: Input): boolean
  isSearchOrReadCommand?(input?: Input): boolean

  validateInput?(
    input: Input,
    context: ToolUseContext,
  ): Promise<{ result: true } | { result: false; message: string; errorCode: number }>

  checkPermissions?(
    input: Input,
    context: ToolUseContext,
  ): Promise<PermissionResult>

  interruptBehavior?(): 'cancel' | 'block'

  backfillObservableInput?(input: Record<string, unknown>): void
  toAutoClassifierInput?(input: Input): unknown

  call(
    args: Input,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: AssistantMessage,
    onProgress?: (progress: ToolProgress<ToolProgressData>) => void,
  ): Promise<ToolCallResult>
}
```

来源：

- `src/Tool.ts:355-603`

## 7. ToolUseContext

这会是系统里最容易失控的对象，所以建议最开始就做成显式结构。

```ts
type ToolUseContext = {
  options: {
    commands: Command[]
    tools: ToolDescriptor[]
    mcpClients: McpClientConnection[]
    isNonInteractiveSession: boolean
    mainLoopModel: string
    verbose: boolean
    thinkingConfig: ThinkingConfig
    querySource?: string
    refreshTools?: () => ToolDescriptor[]
  }

  abortController: AbortController
  readFileState: FileStateCache
  messages: InternalMessage[]

  getAppState(): AppState
  setAppState(updater: (prev: AppState) => AppState): void
  handleElicitation?: HandleElicitationFn

  setInProgressToolUseIDs(
    updater: (prev: Set<string>) => Set<string>,
  ): void

  setHasInterruptibleToolInProgress?(
    value: boolean,
  ): void

  setSDKStatus?(status: SDKStatus): void

  updateFileHistoryState(
    updater: (prev: FileHistoryState) => FileHistoryState,
  ): void

  updateAttributionState(
    updater: (prev: AttributionState) => AttributionState,
  ): void

  queryTracking?: {
    chainId: string
    depth: number
  }

  agentId?: string
  agentType?: string
  toolDecisions?: Map<string, ToolDecisionInfo>
}
```

## 8. 核心类接口

### 8.1 SessionEngine

```ts
class SessionEngine {
  constructor(private config: SessionEngineConfig) {}

  async *submitMessage(
    prompt: string | ContentBlock[],
    options?: { uuid?: string; isMeta?: boolean },
  ): AsyncGenerator<SDKMessage, void> {}

  getReadFileState(): FileStateCache {}
}
```

责任：

- 接受输入
- 处理用户输入与 slash command
- 写 transcript
- 构造 system prompt
- 调用 `AgentLoop`
- 把内部消息转成 SDK stream
- 最终发 `result`

### 8.2 AgentLoop

```ts
type QueryParams = {
  messages: InternalMessage[]
  systemPrompt: SystemPrompt
  userContext: Record<string, string>
  systemContext: Record<string, string>
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  fallbackModel?: string
  querySource: QuerySource
  maxOutputTokensOverride?: number
  maxTurns?: number
  taskBudget?: { total: number }
}

async function* query(
  params: QueryParams,
): AsyncGenerator<
  StreamEvent | RequestStartEvent | InternalMessage | TombstoneMessage | ToolUseSummaryMessage,
  TerminalResult
> {}
```

责任：

- 真正的 turn recursion
- context prep
- compact / budget / prefetch
- API sampling
- tool execution
- next-turn decision

### 8.3 ModelStreamAdapter

```ts
interface ModelStreamAdapter {
  sample(
    request: ModelRequest,
  ): AsyncGenerator<
    | { type: 'stream_event'; event: RawProviderEvent }
    | { type: 'assistant'; message: AssistantMessage }
    | { type: 'system'; subtype: 'api_error'; error: unknown }
  >
}
```

责任：

- provider request 组装
- 流式消费
- 自己组 assistant block
- 维护 usage / stop reason / request id
- fallback 到 non-streaming

### 8.4 ToolRuntime

```ts
interface ToolRuntime {
  runToolUse(
    toolUse: ToolUseBlock,
    assistantMessage: AssistantMessage,
    canUseTool: CanUseToolFn,
    context: ToolUseContext,
  ): AsyncGenerator<MessageUpdateLazy, void>

  runTools(
    toolUses: ToolUseBlock[],
    assistantMessages: AssistantMessage[],
    canUseTool: CanUseToolFn,
    context: ToolUseContext,
  ): AsyncGenerator<MessageUpdate, void>
}
```

### 8.5 PermissionBridge

```ts
interface PermissionBridge {
  createCanUseTool(
    onPermissionPrompt?: (details: RequiresActionDetails) => void,
  ): CanUseToolFn

  sendRequest<TOutput>(
    request: ControlRequest,
    schema: ZodSchema<TOutput>,
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<TOutput>
}
```

### 8.6 ToolRegistry

```ts
interface ToolRegistry {
  getBuiltins(): ToolDescriptor[]
  getMcpWrappedTools(): Promise<ToolDescriptor[]>
  getAllTools(): Promise<ToolDescriptor[]>
  refresh(): Promise<void>
}
```

## 9. `submitMessage()` 的参考伪代码

```ts
async function* submitMessage(prompt, options) {
  resetSessionScopedTransientState()

  const wrappedCanUseTool = wrapCanUseToolAndTrackDenials(config.canUseTool)

  const {
    defaultSystemPrompt,
    userContext,
    systemContext,
  } = await fetchSystemPromptParts(...)

  const processCtx = buildProcessUserInputContext(...)

  if (orphanedPermission && !session.hasHandledOrphanedPermission) {
    yield* handleOrphanedPermission(...)
  }

  const {
    messagesFromUserInput,
    shouldQuery,
    allowedTools,
    modelFromUserInput,
    resultText,
  } = await processUserInput(...)

  session.mutableMessages.push(...messagesFromUserInput)

  await transcript.appendAcceptedInput(messagesFromUserInput)

  yield buildSystemInitMessage(...)

  if (!shouldQuery) {
    yield* replayLocalSlashCommandResults(...)
    yield buildSuccessResult(resultText)
    return
  }

  for await (const message of query({
    messages: [...session.mutableMessages],
    systemPrompt,
    userContext,
    systemContext,
    canUseTool: wrappedCanUseTool,
    toolUseContext: rebuildToolUseContext(...),
  })) {
    applyMessageToSessionStore(message)
    maybeWriteTranscript(message)
    yield* normalizeInternalMessageToSdkMessage(message)
  }

  await transcript.flush()
  yield buildTerminalResult(...)
}
```

关键点：

1. transcript 早写入发生在进入 query loop 前。
2. `query()` 只吃处理后的 message list。
3. result 的组装放在 `SessionEngine`，不放在 `query.ts`。

## 10. `queryLoop()` 的参考伪代码

```ts
async function* queryLoop(params, consumedCommandIds) {
  let state: TurnState = initTurnState(params)
  let taskBudgetRemaining: number | undefined

  using pendingMemoryPrefetch = startRelevantMemoryPrefetch(...)

  while (true) {
    const pendingSkillPrefetch = startSkillDiscoveryPrefetch(...)

    yield { type: 'stream_request_start' }

    const queryTracking = computeQueryTracking(state.toolUseContext)
    let toolUseContext = { ...state.toolUseContext, queryTracking }

    let messagesForQuery = getMessagesAfterCompactBoundary(state.messages)
    messagesForQuery = await applyToolResultBudget(messagesForQuery, ...)
    messagesForQuery = maybeSnip(messagesForQuery)
    messagesForQuery = await microcompact(messagesForQuery)
    messagesForQuery = await maybeAutocompact(messagesForQuery)

    const modelEvents = modelAdapter.sample({
      messages: normalizeMessagesForAPI(messagesForQuery),
      tools: toolUseContext.options.tools,
      ...
    })

    const assistantMessages: AssistantMessage[] = []
    const toolUseBlocks: ToolUseBlock[] = []
    let streamingToolExecutor = maybeCreateStreamingToolExecutor(...)
    let sawToolUse = false

    for await (const event of modelEvents) {
      yield event

      if (event.type === 'assistant') {
        assistantMessages.push(event.message)
        extractAndRegisterToolUseBlocks(event.message, toolUseBlocks)
        maybeFeedStreamingToolExecutor(event.message)
      }

      if (event.type === 'stream_event') {
        maybeUpdateUsageAndStopReason(event)
      }
    }

    if (abortedDuringStreaming) {
      yield* synthesizeMissingToolResultsIfNeeded()
      return { reason: 'aborted_streaming' }
    }

    yieldPendingToolUseSummaryFromPreviousTurn()

    if (!sawToolUse) {
      yield* handleStopHooks(...)
      return { reason: 'completed_without_tool_use' }
    }

    const toolUpdates = streamingToolExecutor
      ? streamingToolExecutor.getRemainingResults()
      : runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext)

    const toolResults: InternalMessage[] = []
    let updatedContext = toolUseContext
    let shouldPreventContinuation = false

    for await (const update of toolUpdates) {
      if (update.message) {
        yield update.message
        toolResults.push(update.message)
        if (isHookStoppedContinuationAttachment(update.message)) {
          shouldPreventContinuation = true
        }
      }
      if (update.newContext) {
        updatedContext = { ...update.newContext, queryTracking }
      }
    }

    if (toolUseContext.abortController.signal.aborted) {
      yield maybeCreateUserInterruptionMessage()
      return { reason: 'aborted_tools' }
    }

    if (shouldPreventContinuation) {
      return { reason: 'hook_stopped' }
    }

    for await (const attachment of getAttachmentMessages(...)) {
      yield attachment
      toolResults.push(attachment)
    }

    injectPrefetchedMemoryAndSkills(toolResults)
    refreshToolsIfNeeded(updatedContext)

    const nextTurnCount = state.turnCount + 1
    if (params.maxTurns && nextTurnCount > params.maxTurns) {
      yield createMaxTurnsAttachment(...)
      return { reason: 'max_turns', turnCount: nextTurnCount }
    }

    state = {
      messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
      toolUseContext: { ...updatedContext, queryTracking },
      turnCount: nextTurnCount,
      ...
    }
  }
}
```

## 11. `runToolUse()` 的参考伪代码

```ts
async function* runToolUse(
  toolUse,
  assistantMessage,
  canUseTool,
  toolUseContext,
) {
  const tool = findTool(toolUse.name) ?? findDeprecatedAlias(toolUse.name)

  if (!tool) {
    yield createErrorToolResult(toolUse.id, `No such tool: ${toolUse.name}`)
    return
  }

  if (toolUseContext.abortController.signal.aborted) {
    yield createCancelledToolResult(toolUse.id)
    return
  }

  for await (const update of streamedCheckPermissionsAndCallTool(...)) {
    yield update
  }
}
```

## 12. `checkPermissionsAndCallTool()` 的参考伪代码

```ts
async function checkPermissionsAndCallTool(...) {
  const parsedInput = tool.inputSchema.safeParse(input)
  if (!parsedInput.success) {
    return [createInputValidationError(toolUseId, parsedInput.error)]
  }

  const semanticValidation = await tool.validateInput?.(...)
  if (semanticValidation?.result === false) {
    return [createSemanticValidationError(toolUseId, semanticValidation.message)]
  }

  let processedInput = parsedInput.data
  const preToolHookResults = await runPreToolUseHooks(...)
  processedInput = maybeApplyHookUpdatedInput(preToolHookResults, processedInput)

  const permissionDecision = await resolveHookPermissionDecision(
    hookPermissionResult,
    tool,
    processedInput,
    toolUseContext,
    canUseTool,
    assistantMessage,
    toolUseId,
  )

  if (permissionDecision.behavior !== 'allow') {
    return [
      createPermissionDeniedUserMessage(
        toolUseId,
        permissionDecision.message,
        permissionDecision.contentBlocks,
      ),
      ...maybePermissionDeniedHookMessages(),
    ]
  }

  if (permissionDecision.updatedInput !== undefined) {
    processedInput = permissionDecision.updatedInput
  }

  const toolCallResult = await tool.call(
    processedInput,
    toolUseContext,
    canUseTool,
    assistantMessage,
    onProgress,
  )

  return processToolCallResultToMessages(toolCallResult)
}
```

关键约束：

1. input schema parse 在最前面。
2. permission deny 不抛异常，而是生成 error `tool_result`。
3. `updatedInput` 允许权限层重写参数。

## 13. `StreamingToolExecutor` 的参考伪代码

```ts
class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private toolUseContext: ToolUseContext
  private siblingAbortController: AbortController
  private discarded = false
  private hasErrored = false

  addTool(block, assistantMessage) {
    const tool = track(block, assistantMessage, computeConcurrencySafety(block))
    this.tools.push(tool)
    void this.processQueue()
  }

  async processQueue() {
    for (const tool of this.tools) {
      if (tool.status !== 'queued') continue
      if (!this.canExecute(tool)) break
      await this.executeTool(tool)
    }
  }

  async executeTool(tool) {
    tool.status = 'executing'

    const initialAbortReason = this.getAbortReason(tool)
    if (initialAbortReason) {
      tool.results = [createSyntheticErrorMessage(tool.id, initialAbortReason)]
      tool.status = 'completed'
      return
    }

    const toolAbortController = createChildAbortController(this.siblingAbortController)
    const generator = runToolUse(
      tool.block,
      tool.assistantMessage,
      canUseTool,
      { ...this.toolUseContext, abortController: toolAbortController },
    )

    for await (const update of generator) {
      if (isAbortNow(tool) && !tool.selfErrored) {
        tool.results.push(createSyntheticErrorMessage(...))
        break
      }

      if (isProgress(update.message)) {
        tool.pendingProgress.push(update.message)
        notifyProgressAvailable()
      } else if (update.message) {
        tool.results.push(update.message)
      }

      if (update.contextModifier) {
        tool.contextModifiers.push(update.contextModifier.modifyContext)
      }

      if (isBashError(update.message)) {
        this.hasErrored = true
        this.siblingAbortController.abort('sibling_error')
      }
    }

    if (!tool.isConcurrencySafe) {
      this.toolUseContext = applyContextModifiers(
        this.toolUseContext,
        tool.contextModifiers,
      )
    }

    tool.status = 'completed'
  }

  *getCompletedResults() {
    for (const tool of this.toolsInOrder()) {
      yield* flushPendingProgress(tool)
      if (tool.status === 'completed') {
        yield* tool.results
        tool.status = 'yielded'
      }
    }
  }
}
```

这个类的设计重点不是“更快”，而是：

1. 工具开始执行和工具结果回放可以解耦。
2. progress 可以先发，结果可以按到达顺序稳定回放。
3. fallback / sibling abort / user interrupt 都能生成合成错误结果。

## 14. 权限 race 的参考伪代码

```ts
function createCanUseTool(onPermissionPrompt?): CanUseToolFn {
  return async (tool, input, context, assistantMessage, toolUseId, forceDecision) => {
    const mainPermissionResult =
      forceDecision ?? await hasPermissionsToUseTool(...)

    if (mainPermissionResult.behavior === 'allow') return mainPermissionResult
    if (mainPermissionResult.behavior === 'deny') return mainPermissionResult

    const hookAbortController = new AbortController()
    const parentSignal = context.abortController.signal
    parentSignal.addEventListener('abort', () => hookAbortController.abort(), { once: true })

    try {
      const hookPromise = executePermissionRequestHooksForSDK(...)
        .then(decision => ({ source: 'hook', decision }))

      const requestId = randomUUID()
      onPermissionPrompt?.(buildRequiresActionDetails(...))

      const sdkPromise = sendRequest({
        subtype: 'can_use_tool',
        tool_name: tool.name,
        input,
        tool_use_id: toolUseId,
      }, schema, hookAbortController.signal, requestId)
        .then(result => ({ source: 'sdk', result }))

      const winner = await Promise.race([hookPromise, sdkPromise])

      if (winner.source === 'hook' && winner.decision) {
        sdkPromise.catch(() => {})
        hookAbortController.abort()
        return winner.decision
      }

      if (winner.source === 'hook') {
        const sdkResult = await sdkPromise
        return sdkResultToPermissionDecision(sdkResult.result)
      }

      return sdkResultToPermissionDecision(winner.result)
    } finally {
      parentSignal.removeEventListener('abort', ...)
    }
  }
}
```

关键点：

1. hook 和 SDK prompt 是并行的。
2. hook 没给出决定时，SDK prompt 继续等待。
3. hook 一旦先赢，SDK 请求需要被忽略或取消。

## 15. MCP tool wrapping 的参考伪代码

```ts
async function convertMcpTools(client: McpConnection): Promise<ToolDescriptor[]> {
  const result = await client.request({ method: 'tools/list' })
  const tools = sanitizeUnicode(result.tools)

  return tools.map(tool => {
    const fullyQualifiedName = buildMcpToolName(client.name, tool.name)
    return {
      ...MCPToolBase,
      name: fullyQualifiedName,
      isMcp: true,
      mcpInfo: { serverName: client.name, toolName: tool.name },
      inputJSONSchema: tool.inputSchema,
      isConcurrencySafe() {
        return tool.annotations?.readOnlyHint ?? false
      },
      isReadOnly() {
        return tool.annotations?.readOnlyHint ?? false
      },
      isDestructive() {
        return tool.annotations?.destructiveHint ?? false
      },
      async checkPermissions() {
        return {
          behavior: 'passthrough',
          message: 'MCPTool requires permission.',
          suggestions: [...]
        }
      },
      async call(args, context, _canUseTool, parentMessage, onProgress) {
        return await callMcpToolWithUrlElicitationRetry(...)
      },
    }
  })
}
```

关键点：

1. MCP tool 先被降维成 `ToolDescriptor`。
2. 权限与并发语义映射成本地工具语义。
3. 真正的 transport 问题被封在 `call()` 内部。

## 16. transcript 的最低接口

```ts
interface TranscriptStore {
  append(messages: InternalMessage[]): Promise<void>
  flush(): Promise<void>
  load(sessionId: string): Promise<InternalMessage[]>
  compactBoundary(boundary: CompactBoundary): Promise<void>
}
```

建议增加两个能力：

1. fire-and-forget append
2. 强制 flush

原因：

- assistant streaming 时不能每条都阻塞
- 最终 result 前必须 flush

## 17. 模块依赖规则

为了避免后面崩掉，建议一开始就写清楚依赖方向：

```text
AppShell -> SessionEngine -> AgentLoop
AgentLoop -> ModelStreamAdapter
AgentLoop -> ToolRuntime
ToolRuntime -> PermissionBridge
ToolRuntime -> ToolRegistry
SessionEngine -> TranscriptStore
ToolRegistry -> MCP integration

禁止：
ModelStreamAdapter -> AppShell
ToolRuntime -> CLI UI
MCP transport -> SessionEngine
```

## 18. 最小目录骨架

```text
src/
  app/
    cli.ts
    print.ts
    repl.ts
    sdk.ts
  runtime/
    sessionEngine.ts
    agentLoop.ts
    transcriptStore.ts
    permissionBridge.ts
    compact.ts
    budget.ts
  model/
    modelStreamAdapter.ts
    providerClient.ts
  tools/
    types.ts
    registry.ts
    toolExecution.ts
    toolOrchestration.ts
    streamingToolExecutor.ts
    builtins/
  integrations/
    mcp/
      client.ts
      wrapping.ts
      transport.ts
  types/
    messages.ts
    sdk.ts
```

## 19. 实现时最应该优先跑通的三条路径

### Path A：无工具成功返回

目标：

- 用户输入
- assistant 流式文本
- 成功 result

### Path B：单工具一轮递归

目标：

- `tool_use`
- tool validation / permission
- `tool_result`
- 下一轮 assistant

### Path C：权限拒绝和中断

目标：

- deny 产生 error `tool_result`
- abort 产生补偿语义
- transcript 不断链

如果这三条路径没跑通，不要继续做 MCP、compact、remote。

## 20. 最后一句建议

真正值得照着抄的不是函数名，而是这几个合同：

1. `SessionEngine` 拥有会话。
2. `AgentLoop` 拥有 turn recursion。
3. `ModelStreamAdapter` 拥有 provider 协议。
4. `ToolRuntime` 拥有工具执行语义。
5. `PermissionBridge` 拥有权限协商。
6. `TranscriptStore` 拥有恢复一致性。

只要这 6 个合同没混，你写出来的系统就还有机会往上长。

一旦它们混了，后面加的每一个功能都会变成补丁。
