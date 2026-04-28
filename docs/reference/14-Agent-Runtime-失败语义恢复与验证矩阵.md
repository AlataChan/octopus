# Agent Runtime 失败语义、恢复策略与验证矩阵

> 基于 Claude Code v2.1.88 反编译源码分析  
> 核心来源：`src/query.ts`、`src/QueryEngine.ts`、`src/services/api/claude.ts`、`src/services/tools/*`、`src/cli/structuredIO.ts`

## 0. 这份文档为什么重要

一个 agent runtime 最难的部分，不是 happy path。

真正难的是：

- 流式半途中断
- 工具执行一半失败
- 权限拒绝
- 旧流 fallback 到新流
- transcript 写了一半
- compact 之后还能 resume

如果这些失败语义没建好，系统在 demo 中看起来能跑，在真实使用里会不断撕裂。

这份文档的目标就是把这些“撕裂点”全部列出来，并给出最小可验证标准。

## 1. 先定义系统级一致性目标

复刻时，至少要保证下面 10 条一致性目标。

### 1. 每个 `tool_use` 最终都有对应结果语义

结果语义可以是：

- 正常 `tool_result`
- 输入错误 `tool_result`
- 权限拒绝 `tool_result`
- synthetic cancel `tool_result`

但不能没有。

### 2. transcript 不能在“用户消息已接受、assistant 尚未返回”时断链

来源：

- `src/QueryEngine.ts:393-427`

### 3. fallback 不得把旧 streaming 尝试的 `tool_use_id` 泄漏到新尝试

来源：

- `src/query.ts:657-735`

### 4. compact boundary 后，前半段消息必须同时从内存和 transcript 视图中被理解为“已裁剪”

来源：

- `src/query.ts:365-430`
- `src/QueryEngine.ts:820-851`

### 5. 用户中断后，不得继续悄悄进入下一轮

来源：

- `src/query.ts:1455-1497`

### 6. 权限拒绝不得靠抛异常表达

必须通过消息协议显式表达给模型。

来源：

- `src/services/tools/toolExecution.ts:1001-1105`

### 7. tool progress 不应破坏 transcript 链

来源：

- `src/QueryEngine.ts:748-768`

### 8. 最终 result 发出前，关键 transcript 写入应已 flush

来源：

- `src/QueryEngine.ts:1054-1084`

### 9. Bash sibling error 只能杀并行 Bash 兄弟，不应无差别炸掉所有工具语义

来源：

- `src/services/tools/StreamingToolExecutor.ts:334-352`

### 10. SDK / REPL / print 应共享同一失败语义，不应各自发明一套

来源：

- `src/cli/print.ts:2170-2215`
- `src/cli/structuredIO.ts:533-634`

## 2. 失败类型总表

下面按层次分失败类型。

### A. 输入与前置处理失败

- 用户输入处理失败
- transcript append 失败
- orphaned permission 恢复失败

### B. 模型流失败

- streaming 创建失败
- streaming 中途断流
- prompt too long
- max output tokens
- API retry exhaustion
- fallback 到 non-streaming

### C. 工具解析失败

- unknown tool
- input schema parse 失败
- validateInput 失败

### D. 权限失败

- 静态 deny
- interactive reject
- hook deny
- SDK permission request failed

### E. 工具执行失败

- tool call 抛异常
- Bash tool error
- sibling abort
- user interrupt during tool execution
- hook stop continuation

### F. 会话边界失败

- max turns
- max budget
- structured output retries exceeded
- error during execution

### G. 协议桥接失败

- control request 无响应
- SDK stream 关闭
- MCP elicitation 失败
- orphaned permission response 重复或晚到

## 3. 失败语义矩阵

下面按“触发条件 -> 检测点 -> 内部动作 -> 对 transcript 的要求 -> 对模型的可见语义 -> 测试要点”来写。

## 4. Unknown Tool

### 触发条件

模型调用了不存在的工具名。

### 检测点

- `src/services/tools/toolExecution.ts:337-403`
- `src/services/tools/StreamingToolExecutor.ts:72-98`

### 内部动作

1. 记录 telemetry
2. 构造 error `tool_result`
3. 不抛到 query loop 外层

### transcript 约束

- 必须写入一个 user-side `tool_result`

### 模型可见语义

- 模型看到一次失败的工具调用结果，可据此改正名称或放弃

### 测试要点

- 单轮内 unknown tool 不应导致会话崩溃
- transcript 里能看到成对失败结果

## 5. Input Schema Parse Failure

### 触发条件

模型参数类型错误，例如数组写成字符串。

### 检测点

- `src/services/tools/toolExecution.ts:635-688`

### 内部动作

1. `inputSchema.safeParse`
2. 格式化错误
3. 返回 error `tool_result`
4. 如果是 deferred tool 且 schema 未发送，可附加重试提示

### transcript 约束

- 错误必须被序列化为 user-side `tool_result`

### 测试要点

- 错误文本中包含足够修复线索
- 不应直接抛异常结束整个 turn

## 6. Tool Semantic Validation Failure

### 触发条件

参数类型正确，但值非法。

### 检测点

- `src/services/tools/toolExecution.ts:690-726`

### 内部动作

1. 调用 `tool.validateInput`
2. 失败时生成 error `tool_result`

### 测试要点

- 语义校验与 schema 校验分层
- validate fail 不应进入 permission 或实际执行阶段

## 7. Permission Denied / Rejected

### 触发条件

权限系统返回：

- `deny`
- `ask` 但用户拒绝
- SDK permission request 失败

### 检测点

- `src/services/tools/toolExecution.ts:1001-1105`
- `src/cli/structuredIO.ts:533-634`

### 内部动作

1. 记录 permission denial
2. 生成 error `tool_result`
3. 可附加 image/contentBlocks
4. auto mode classifier deny 时运行 PermissionDenied hooks

### transcript 约束

- 绝不能只在 UI 上弹一下，不写消息

### 模型可见语义

- 模型知道这次调用被拒绝，可以换方案或请求用户

### 测试要点

- REPL reject
- SDK host reject
- hook deny
- request stream closed

## 8. PreToolUse Hook Stop

### 触发条件

hook 明确要求停止本次执行。

### 检测点

- `src/services/tools/toolExecution.ts` 中 `runPreToolUseHooks` 分支

### 内部动作

1. 生成停止型 `tool_result`
2. 可附加 summary / attachment
3. query loop 若收到 `hook_stopped_continuation` attachment，则阻止递归下一轮

来源：

- `src/query.ts:1388-1497`

### 测试要点

- 工具调用停止后不得继续下一轮
- transcript 中应看见停止原因

## 9. Tool Call Threw Exception

### 触发条件

工具内部抛异常。

### 检测点

- `src/services/tools/toolExecution.ts:455-489`

### 内部动作

1. catch
2. 记录日志
3. 生成 error `tool_result`

### 测试要点

- 工具抛异常不应炸掉整个 runtime
- 错误必须变成模型可见结果

## 10. Streaming Tool Execution Sibling Abort

### 触发条件

并发执行中，一个 Bash 工具出现 error `tool_result`。

### 检测点

- `src/services/tools/StreamingToolExecutor.ts:334-352`

### 内部动作

1. 标记 `hasErrored`
2. `siblingAbortController.abort('sibling_error')`
3. 其他兄弟工具收到 synthetic cancel

### transcript 约束

- 发起错误的那个工具保留自己的真实错误
- 其他被牵连的工具生成 synthetic error `tool_result`

### 测试要点

- 只取消 sibling，不重写原始报错工具
- 非 Bash 工具失败不应无差别中止所有其他工具

## 11. User Interrupt During Tool Execution

### 触发条件

用户中断，或权限对话触发 abort。

### 检测点

- `src/services/tools/StreamingToolExecutor.ts:283-317`
- `src/query.ts:1455-1497`

### 内部动作

1. 子 tool abort controller 触发
2. 已执行工具可能产出 synthetic reject
3. query loop 检测 abort，产出 interruption message 或直接结束

### transcript 约束

- 不得悄悄丢失正在运行的工具状态

### 测试要点

- `interrupt` 与普通 abort reason 的区别
- `cancel`/`block` interruptBehavior 的差异

## 12. Streaming Fallback To Non-streaming

### 触发条件

streaming 路径报错，需要 fallback 到 non-streaming。

### 检测点

- `src/services/api/claude.ts:2478-2698`
- `src/query.ts:657-735`

### 内部动作

1. 记录 fallback
2. discard 旧 `StreamingToolExecutor`
3. 丢弃旧流内未完成工具结果
4. 用全新 executor / 全新采样尝试继续

### transcript 约束

- 不能留下上一条失败 streaming 尝试的 `tool_use_id`

### 测试要点

- fallback 后 transcript 不出现重复或孤儿 tool_result
- 新尝试中 tool ids 全新

## 13. Aborted Streaming Before Tool Results

### 触发条件

流中断发生在 assistant 已经发出 `tool_use` 之后，但 `tool_result` 尚未产生。

### 检测点

- `src/query.ts:1011-1051`
- `yieldMissingToolResultBlocks(...)`

### 内部动作

1. 为尚未得到结果的 `tool_use` 补 error `tool_result`
2. 返回 `aborted_streaming`

### transcript 约束

- 不允许出现只有 `tool_use` 没有结果的轨迹

### 测试要点

- 流式中断后，resume 仍能读取可闭合轨迹

## 14. Max Turns

### 触发条件

下一轮 turn 计数超过限制。

### 检测点

- `src/query.ts:1702-1711`
- `src/QueryEngine.ts:805-851`

### 内部动作

1. query loop 发 `max_turns_reached` attachment
2. QueryEngine 观察后生成 `error_max_turns` result

### 测试要点

- attachment 和最终 result 均出现
- num_turns 与 attachment 一致

## 15. Max Budget USD

### 触发条件

累计成本达到配置上限。

### 检测点

- `src/QueryEngine.ts:883-931`

### 内部动作

1. flush transcript
2. 发 `error_max_budget_usd`

### 测试要点

- usage / total_cost_usd 要带出来

## 16. Structured Output Retry Exhaustion

### 触发条件

结构化输出工具反复失败，达到最大重试次数。

### 检测点

- `src/QueryEngine.ts:934-982`

### 内部动作

1. 统计结构化输出工具调用次数
2. 超限后发 `error_max_structured_output_retries`

### 测试要点

- 只统计本次 query 的 delta，而不是整个会话历史

## 17. Error During Execution

### 触发条件

query loop 正常结束，但最后无法构成有效成功结果。

例如：

- 最后消息不是合法 assistant/user terminal
- stop reason 不符合成功条件

### 检测点

- `src/QueryEngine.ts:1054-1084`

### 内部动作

1. 提取 turn-scoped error buffer
2. 生成 `error_during_execution`

### 测试要点

- 错误日志应是本 turn 局部，不是整个进程累计

## 18. Transcript Append / Flush Failure

源码里对此没有把所有细节暴露成统一高层错误消息，但复刻时你必须考虑。

### 建议策略

1. 用户消息 append 失败时，不要继续进入 query loop
2. assistant/progress/attachment 的 fire-and-forget append 失败应进入错误缓冲
3. 最终 result 前 flush 失败应升级为 session-level error

### 为什么

因为 transcript 一致性是 resume 的基础，不只是日志记录。

## 19. Orphaned Permission Response / Late Control Response

### 风险

SDK 场景下，control response 可能：

- 迟到
- 重复
- 在正常权限决策后才到达

### 设计要点

`StructuredIO` 里需要记录：

- 已解决 `tool_use_id`
- pending requests

来源：

- `src/cli/structuredIO.ts:130-178`
- `src/cli/structuredIO.ts:376-499`

### 验证点

- 迟到 response 不得再次写入消息，避免重复 tool_use id

## 20. MCP URL Elicitation Failure

### 风险

远端 MCP tool 可能在调用时要求 URL / 表单补充输入。

### 设计要点

- elicitation 失败不能让主 runtime 卡死
- 必须有 abort / timeout 路径

来源：

- `src/cli/structuredIO.ts:691-760`
- `src/services/mcp/client.ts` 中 URL elicitation retry 路径

## 21. 最低测试矩阵

下面是我认为复刻后至少要覆盖的测试矩阵。

## 22. 单元测试

### Query / State

- `queryLoop` 在无工具时正常终止
- `queryLoop` 在有工具时递归进入下一轮
- `maxTurns` 超限时发 attachment 并返回 terminal reason
- aborted streaming 时会补 tool result

### Tool Runtime

- unknown tool -> error `tool_result`
- schema parse fail -> error `tool_result`
- validate fail -> error `tool_result`
- permission deny -> error `tool_result`
- updatedInput 正确覆盖原始输入

### StreamingToolExecutor

- 只读工具可并发
- 非并发工具串行
- Bash error 触发 sibling abort
- progress 先于结果对外可见
- discard 后不再吐出旧结果

### StructuredIO / PermissionBridge

- hook 与 SDK prompt race
- request abort 时 pendingRequests 清理
- duplicate response 被忽略

## 23. 集成测试

### Happy Path

- 单轮纯文本
- 单工具递归
- 多工具只读并发
- MCP tool wrapped path

### Failure Path

- streaming fallback to non-streaming
- permission reject in SDK mode
- interrupt during tool execution
- compact boundary 后继续执行
- transcript kill-and-resume

## 24. 端到端测试

至少要有以下剧本：

### 剧本 1：文件读取 -> 分析 -> 结束

验证：

- 基础主链路

### 剧本 2：文件编辑 -> 权限拒绝 -> 模型改方案

验证：

- permission result 对模型可见

### 剧本 3：多个 Bash 并发，其中一个失败

验证：

- sibling abort
- synthetic cancel

### 剧本 4：长会话 compact 后继续做工具调用

验证：

- compact boundary
- transcript pruning

### 剧本 5：SDK host 权限弹窗 + hook race

验证：

- 先到先赢
- 后到响应不污染消息流

## 25. 混沌测试

这是很多人会跳过，但这里强烈建议做。

### 建议注入点

- streaming 中途断流
- transcript flush 超时
- hook callback 超时
- MCP server 断连
- SDK permission response 晚到
- tool.call 抛出随机异常

### 通过标准

- 会话可以失败，但消息轨迹不能断成不可恢复状态

## 26. 验收标准

只有同时满足下面这些条件，我才会认为“runtime 做成了”：

1. 一条用户消息在任意时点 kill 掉进程后，都不会把 transcript 弄成不可 resume 的半死状态。
2. 任意一个 `tool_use` 都能在 transcript 中闭合为结果语义。
3. print/SDK/REPL 的失败语义一致。
4. fallback 与 interrupt 不会泄漏旧 `tool_use_id`。
5. compact 后还能继续跑工具，而不是只会“总结完结束”。
6. MCP 工具不需要第二套权限与调度框架。

## 27. 监控建议

如果你真要上线，不建议只看日志。

至少加这些计数：

- 每轮 turn 数
- 每次 query 的 tool count
- tool validation failures
- permission denials by source
- streaming fallback count
- aborted_streaming count
- sibling abort count
- compact count
- transcript flush failures
- duplicate control response count

这些指标能直接告诉你，系统是在“正常工作”，还是在“勉强看起来能用”。

## 28. 最后一句话

agent runtime 的工程难点，从来不是“让模型会调工具”。

真正的难点是：

- 失败时仍然闭合语义
- 恢复时仍然闭合历史
- 多壳层下仍然闭合同一条主链路

如果这些闭合关系成立，你有的是一个 runtime。

如果这些闭合关系不成立，你有的只是一个容易坏掉的 agent demo。
