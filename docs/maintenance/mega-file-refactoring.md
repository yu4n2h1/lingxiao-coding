# 巨型文件拆分计划

> 5 个超过 1000 行的文件需拆分为可维护的独立模块

## 待拆分文件

| # | 文件 | 行数 | 严重级 | 核心问题 |
|---|------|------|--------|----------|
| P0-3 | `src/agents/LeaderAgent.ts` | 3500+ | P0 | 决策+工具+状态三合一 |
| P0-7 | `web/src/stores/sseStore.ts` | 1400+ | P0 | 60+ 事件类型单文件分发 |
| P0-8 | `src/tui/LingXiaoTUI.tsx` | 2800+ | P0 | 40+ useState，全功能堆叠 |

## P0-3: LeaderAgent.ts 拆分

### 当前结构（3500+ 行）
```
LeaderAgent.ts
  ├── 配置和常量 (~200 行)
  ├── 状态管理 (~400 行)        ← 提取为 LeaderStateManager
  ├── 用户输入处理 (~600 行)     ← 提取为 LeaderInputProcessor
  ├── 任务 DAG 管理 (~500 行)    ← 提取为 LeaderTaskDAG
  ├── 工具执行调度 (~400 行)     ← 提取为 LeaderToolExecutor
  ├── Agent 监督 (~300 行)       ← 提取为 LeaderSupervisor（已有 LeaderSupervisionCoordinator）
  ├── LLM 调用 (~300 行)         ← 提取为 LeaderLlmClient
  ├── 事件发射 (~200 行)         ← 保留在 LeaderAgent
  └── 生命周期 (~200 行)         ← 保留在 LeaderAgent
```

### 目标结构
```
src/agents/leader/
  ├── LeaderAgent.ts              (~300 行) — 门面类，组合各子模块
  ├── LeaderStateManager.ts       (~400 行) — 状态机：idle/busy/waiting/error
  ├── LeaderInputProcessor.ts     (~600 行) — 用户输入解析、意图识别
  ├── LeaderTaskDAG.ts            (~500 行) — 任务创建、依赖管理、DAG 校验
  ├── LeaderToolExecutor.ts       (~400 行) — 工具调度、超时、结果处理
  ├── LeaderLlmClient.ts          (~300 行) — LLM 调用、重试、上下文管理
  └── leader-constants.ts         (~200 行) — 常量、类型定义
```

### 拆分原则
1. **门面模式**：LeaderAgent 保持原有 public API，内部委托子模块
2. **单向依赖**：子模块不反向引用 LeaderAgent，通过接口/回调通信
3. **渐进式**：先提取独立性最高的模块（constants → StateManager → LlmClient），最后提取耦合最高的（InputProcessor → TaskDAG）
4. **测试先行**：每个子模块提取后单独可测

### 迁移步骤
```
Step 1: 提取 leader-constants.ts（纯常量，零风险）
Step 2: 提取 LeaderStateManager（状态逻辑自包含）
Step 3: 提取 LeaderLlmClient（LLM 调用逻辑独立）
Step 4: 提取 LeaderToolExecutor（依赖 StateManager + LlmClient）
Step 5: 提取 LeaderTaskDAG（依赖 StateManager）
Step 6: 提取 LeaderInputProcessor（依赖 TaskDAG + ToolExecutor）
Step 7: LeaderAgent 瘦身为门面类（~300 行）
```

## P0-7: sseStore.ts 拆分

### 当前结构（1400+ 行）
```
sseStore.ts
  ├── 连接管理 (~200 行)
  ├── handleSessionUpdate 主入口 (~100 行)
  ├── 会话事件处理 Part1 (~300 行)  ← 提取为 sessionHandlers.ts
  ├── Agent 事件处理 Part2 (~250 行) ← 提取为 agentHandlers.ts
  ├── Leader 事件处理 Part3 (~250 行) ← 提取为 leaderHandlers.ts
  ├── 编排事件处理 Part4 (~200 行)   ← 提取为 orchestrationHandlers.ts
  └── 工具函数 (~100 行)             ← 提取为 sseHelpers.ts
```

### 目标结构
```
web/src/stores/sse/
  ├── sseStore.ts              (~200 行) — store 定义、连接管理、主入口
  ├── sessionHandlers.ts       (~300 行) — session:*/task:* 事件处理
  ├── agentHandlers.ts         (~250 行) — agent:* 事件处理
  ├── leaderHandlers.ts        (~250 行) — leader:*/plan:*/permission:* 事件处理
  ├── orchestrationHandlers.ts (~200 行) — orchestration:*/blackboard:* 事件处理
  ├── sseHelpers.ts            (~100 行) — 去重、封顶、FIFO 等工具函数
  └── types.ts                 (~50 行)  — SessionUpdateKind 类型定义
```

### 拆分原则
1. **按事件域分组**：同一命名空间的事件放同一文件
2. **handler 纯函数**：每个 handler 是 `(state, update) => partialState`，无副作用
3. **主入口路由**：`handleSessionUpdate` 变成 switch 路由到各域 handler
4. **共享状态通过参数传递**：handler 不直接访问 store，接收 state 返回更新

### 迁移步骤
```
Step 1: 提取 types.ts（类型定义，零风险）
Step 2: 提取 sseHelpers.ts（纯函数工具）
Step 3: 提取 sessionHandlers.ts（会话域事件）
Step 4: 提取 agentHandlers.ts（Agent 域事件）
Step 5: 提取 leaderHandlers.ts（Leader 域事件）
Step 6: 提取 orchestrationHandlers.ts（编排域事件）
Step 7: sseStore.ts 瘦化为连接管理 + 路由入口
```

## P0-8: LingXiaoTUI.tsx 拆分

### 当前结构（2800+ 行）
```
LingXiaoTUI.tsx
  ├── 40+ useState               ← 分散到各功能组件
  ├── 输入处理 (~300 行)          ← 提取为 InputBar 组件
  ├── 消息列表渲染 (~500 行)      ← 提取为 MessageList 组件
  ├── 任务面板 (~300 行)          ← 提取为 TuiTaskBoard 组件
  ├── Agent 状态栏 (~200 行)      ← 提取为 AgentStatusBar 组件
  ├── 通知横幅 (~150 行)          ← 提取为 NotificationBanner 组件
  ├── 命令面板 (~200 行)          ← 提取为 CommandPalette 组件
  ├── 事件桥接 (~400 行)          ← 保留在 useTuiEventBridge（已有）
  ├── 渲染主函数 (~500 行)        ← 瘦化为组合各子组件
  └── 工具函数 (~250 行)          ← 提取为 tui-helpers.ts
```

### 目标结构
```
src/tui/components/
  ├── LingXiaoTUI.tsx          (~200 行) — 根组件，组合子组件
  ├── InputBar.tsx             (~300 行) — 用户输入、命令解析
  ├── MessageList.tsx          (~500 行) — 消息渲染、滚动、虚拟化
  ├── TuiTaskBoard.tsx         (~300 行) — 任务面板
  ├── AgentStatusBar.tsx       (~200 行) — Agent 状态显示
  ├── NotificationBanner.tsx   (~150 行) — 通知横幅
  ├── CommandPalette.tsx       (~200 行) — 命令面板
  └── tui-helpers.ts           (~250 行) — 格式化、工具函数
src/tui/runtime/
  └── useTuiEventBridge.ts     (已有)    — 事件桥接 hook
```

### 拆分原则
1. **按 UI 区域分组**：每个视觉区域一个组件
2. **状态就近原则**：useState 移到使用它的子组件中，全局状态通过 context 或 props 传递
3. **Ink 约束**：保持 Ink 的渲染模型（函数式组件 + hooks），不引入额外状态管理库
4. **性能**：拆分后减少根组件 re-render 范围，提升 TUI 响应速度

### 迁移步骤
```
Step 1: 提取 tui-helpers.ts（纯函数，零风险）
Step 2: 提取 NotificationBanner.tsx（独立性最高）
Step 3: 提取 AgentStatusBar.tsx
Step 4: 提取 CommandPalette.tsx
Step 5: 提取 TuiTaskBoard.tsx
Step 6: 提取 MessageList.tsx（最复杂，需处理虚拟滚动）
Step 7: 提取 InputBar.tsx
Step 8: LingXiaoTUI.tsx 瘦化为根组件
```

## 验收标准

拆分完成后验证：

- [ ] `npm run build` 无 TypeScript 错误
- [ ] `lingxiao` 启动 TUI 正常渲染
- [ ] `lingxiao --web` 启动 WebUI 正常渲染
- [ ] SSE 事件全部正确分发（60+ 事件类型）
- [ ] Leader 决策流程正常（创建任务 → 派发 → 验收）
- [ ] 各拆分文件行数 < 600 行
- [ ] 无新增 `as any` 或类型逃逸
