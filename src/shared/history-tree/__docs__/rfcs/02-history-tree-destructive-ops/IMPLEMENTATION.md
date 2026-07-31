# history-tree 破坏性操作 实施清单

> 基于 RFC v0.3.0

## 文件清单

| 文件 | 职责 |
| --- | --- |
| `types.ts` | 追加 `HistoryTreeChangeEvent<T>`、`HistoryTreeMergeData<T>`、`HistoryTreeRemoveOptions<T>`、`HistoryTreePruneOptions`、`HistoryTreeCompactOptions<T>`；`HistoryTree<T>` 追加 7 个方法并扩展 `onChange` 签名 |
| `helpers.ts` | 新增：模块内共享的 `MODULE_NAME`、`HistoryNode<T>`、`DefaultGenerateId`、`createDefaultGenerateId`、`toNodeInfo`、`getNodeOrThrow`、`walkPreOrder` |
| `snapshot.ts` | 新增：`validateSnapshot` 及 5 个拆分后的校验函数 |
| `core.ts` | 状态收敛为 `TreeState<T>`，全部操作改为模块级函数；`createHistoryTree` 只负责建状态与返回门面 |
| `index.ts` | 追加导出新增类型 |
| `index.mdx` | 新增「破坏性操作」「快照持久化 / 回滚」章节与新增类型表格 |
| `__test__/history-tree.node.test.ts` | 追加 58 条用例（RFC 表格 #18–#75），已有用例不动 |

## 实施步骤

### 1. types.ts — 类型定义

```ts
HistoryTreeChangeEvent<T> {
  readonly type: 'commit' | 'checkout' | 'remove' | 'prune' | 'compact' | 'load'
  readonly removedNodes: readonly HistoryNodeInfo<T>[]   // 操作前快照
  readonly affectedNodes: readonly HistoryNodeInfo<T>[]  // 操作后快照
}

HistoryTreeMergeData<T> = (removedData: T, survivorData: T) => T
HistoryTreeRemoveOptions<T> { mergeData?; onCurrentDeleted?: 'parent' | 'first-child' | 'throw' }
HistoryTreePruneOptions { includeSelf?; onCurrentDeleted?: 'parent' | 'root' | 'throw' }
HistoryTreeCompactOptions<T> { mergeData?; keep?: (node: HistoryNodeInfo<T>) => boolean }

HistoryTree<T> 追加：
  remove / previewRemove / prune / previewPrune / compact / previewCompact / loadFromSnapshot
  onChange 的 listener 增加可选第二参数 event
```

RFC 把三组 options 写成内联字面量类型，实现改为具名 interface：`remove` 与 `previewRemove` 等成对方法共用同一份定义与 JSDoc，结构完全等价。

### 2. helpers.ts — 模块内共享基础件

`MODULE_NAME`、内部节点类型 `HistoryNode<T>`、`toNodeInfo`、`getNodeOrThrow` 从 `core.ts` 平移过来（行为不变）。新增两项：

- `createDefaultGenerateId()` 返回带 `advanceTo(next)` 的函数对象；`advanceTo` 只在 `next > counter` 时生效，保证计数器**只推进不后退**
- `walkPreOrder(startId, getChildrenIds)` 前序遍历（root-to-leaf），保证父节点排在后代之前。`getChildrenIds` 是回调，同一套遍历既能作用于真实节点也能作用于拓扑副本

### 3. snapshot.ts — 快照校验

`validateSnapshot` 按固定顺序调用 5 个断言，任一项不通过即 `throwError`，整体 O(n)：

| 顺序 | 函数 | 覆盖的 RFC 校验项 |
| --- | --- | --- |
| 1 | `assertSnapshotShape` | #1 缺字段、#2 root 存在且 parentId 为 null、#3 current 存在 |
| 2 | `assertSingleRoot` | #7 多个根 |
| 3 | `assertReferencesExist` | #4 缺 parent、#5 缺 child |
| 4 | `assertBidirectionalLinks` | #6 双向链接不一致 |
| 5 | `assertReachableFromRoot` | #8 环与孤儿 |

顺序不可随意调整：`assertSingleRoot` 必须排在 `assertReferencesExist` 之前，否则非根节点的 `parentId === null` 会被误报成"缺失父节点"。`inconsistent link` 的错误信息约定第一个 id 恒为父节点、第二个恒为子节点。

`assertReachableFromRoot` 复用 `walkPreOrder`：双向一致性已保证每个节点只有一个父节点，可达范围内不可能成环，遍历必然终止。

### 4. core.ts — 核心实现

内部状态收敛为一个对象，全部操作是接收它的模块级函数：

```ts
interface TreeState<T> {
  nodes: Map<string, HistoryNode<T>>
  listeners: Set<ChangeListener<T>>
  generateId: () => string
  builtinGenerateId: DefaultGenerateId | null  // 传了自定义 generateId 时为 null
  rootId: string      // RFC 要求的"const 改 let"，落到可变字段上
  currentId: string
}
```

`createHistoryTree` 只负责建根节点、组装 `state`，返回的门面对象每个成员都是一行委托。

实现要点：

- **`removeNode`（内部，不通知）与 `removeAndNotify`（公开 `remove`）分层**：`compact` 循环调用的是 `removeNode`，不是公开 `remove`，否则一次 `compact` 会发出 N 次 `onChange` 并暴露中间态
- **`remove` 先算后写**：`mergeData` 对每个子节点的结果先全部算进临时数组，此阶段不写任何节点；抛错时树天然保持原状。之后的写回、改拓扑、删节点、回退 `currentId` 都是确定性内存操作
- **`compact` 整体事务**：开始前 `buildSnapshot()` 备份 → 循环 `findCompactCandidate` + `removeNode` → 任一步抛错则 `restoreFromSnapshot(backup)` 整体回滚并原样上抛，不触发 `onChange`。`restoreFromSnapshot` 与 `loadFromSnapshot` 共用同一套还原逻辑
- **compact 候选顺序**：每轮用 `walkPreOrder` 取 root-to-leaf 第一个候选，合并后重新扫描，直到没有候选。候选条件为「非根 + 非 current + 恰好 1 个子节点 + `keep` 未返回 true」
- **compact 的 `affectedNodes` 需过滤**：中途被记为受影响、随后自己也被合并掉的节点已不存在，通知前只保留仍在 `nodes` 里的
- **`prune` 的 `survivorId`**：`includeSelf` 为 true 时是父节点，为 false 时是 `nodeId` 自己。回退 `currentId`（`'parent'` 策略）与 `affectedNodes` 都指向它，两个分支收敛成一条路径
- **`previewCompact` 走拓扑副本模拟**：复制一份只含 `parentId` / `childrenIds` 的副本跑同一套候选逻辑，不调用 `mergeData`、不触碰真实树。候选判定函数 `findCompactCandidate` 通过 `getEntry` 回调同时服务真实树与副本
- **`loadFromSnapshot`**：校验 → 记录旧树全部节点 → `restoreFromSnapshot`（深拷贝拓扑，`data` 按引用原样存放）→ `advanceBuiltinGenerateId` → 通知。id 推进只统计匹配 `/^(?:0|[1-9]\d*)$/u` 的 id，`"01"` / `"-1"` / `"1.5"` / `"a"` 一律忽略；`builtinGenerateId` 为 null（调用方传了自定义生成器）时完全不干预
- **`notifyListeners` 接收 event**：`commit` 的 `affectedNodes` 为 `[新节点, 父节点]`，`checkout` 两个字段均为空数组（只移动指针，不改任何节点）

### 5. __test__/history-tree.node.test.ts — 测试用例

追加 RFC 表格 #18–#75 共 58 条，已有用例一条未动。三个共享 fixture：

- `createSampleTree()` — RFC 的 v0~v9 拓扑，current 停在 v9
- `createCompactTree()` — `c0 ── c1 ── c2 ── c3 ──┬── c4 / └── c5(current)`
- `createLinearTree()` — 纯线性链 `l0 ── l1 ── l2 ── l3(current)`

用 `vi.fn()` 校验 `mergeData` 的调用次数、顺序、参数与返回值串联，以及 `onChange` 的触发次数。`#74` 在单条用例内参数化遍历 9 组非法快照（RFC 的 8 条规则 + "root parentId 非 null"），每组都验证错误信息逐字符匹配、当前树完全不变、不触发 `onChange`。

## 依赖

- `shared/throw-error`：`throwError` 函数

## 执行顺序

1. types.ts
2. helpers.ts / snapshot.ts
3. core.ts
4. index.ts
5. __test__/history-tree.node.test.ts
6. index.mdx
7. 运行 `pnpm exec tsc --noEmit` + `pnpm test:ci` + `pnpm check` 验证
