# RFC: historyTree — 破坏性操作（remove / prune / compact）

> status: draft
>
> author: snailuu
>
> create time: 2026/06/22 10:30:00
>
> rfc version: 0.1.0
>
> scope: `src/shared/history-tree`
>
> 依赖：本 RFC 构建在 [RFC 01 v0.2.0](../01-history-tree/RFC.md) 已定义的 `HistoryTree<T>` 接口之上，不修改既有 API 的任何行为。

## 版本历史

| 版本 | 日期 | 变更摘要 |
| --- | --- | --- |
| 0.1.0 | 2026/06/22 | 初稿：拆出"破坏性操作"独立 RFC；新增 `remove` 单点删除 / `prune` 子树删除 / `compact` 线性压缩三个 API；引入 `mergeData` 数据合并钩子统一回答"全量 vs 差量"场景的语义问题 |

## 背景与动机

[RFC 01](../01-history-tree/RFC.md) 承诺"历史永不丢失"——所有 commit 都被永久保留为树节点。在编辑器、画板、Agent 思路树等**长会话**场景下，这种"无限增长"会带来明显的内存压力。

本 RFC 给调用方提供一组**显式破坏性操作**，使其能在愿意打破"永不丢失"承诺的前提下，主动回收历史节点；同时**正面回应**两个关键设计问题：

1. **数据合并语义**：被删除节点的 data 怎么处理？
2. **删除单个中间节点的合法性**：能否只删一个节点而保留其后代？

### 数据合并语义（核心问题）

RFC 01 已经声明"框架不区分全量/差异——存什么取什么"。在**全量场景**下，每个节点都是独立可还原的完整状态，删除中间节点不影响其他节点的语义。但在**差量场景**下，每个节点只存"相对父节点的 patch"，**节点间存在强语义依赖**：

```
全量场景（每个节点自带完整状态）：
  v0{x:0, y:0}  ──  v1{x:5, y:0}  ──  v2{x:5, y:3}
  删除 v1 之后从根重算到 v2 仍然能得到 {x:5, y:3}（直接用 v2 的全量）

差量场景（每个节点只存差量）：
  v0{x:0, y:0}  ──  v1{x:+5}  ──  v2{y:+3}
  删除 v1 之后从根重算到 v2 → 缺了 {x:+5} 这步 patch
  得到 {x:0, y:3}，错！
```

这意味着任何"删除节点"的操作都必须给调用方机会把被删节点的 data **合并到后续节点**，否则差量场景的数据链就断了。

### 删除单个中间节点的合法性

RFC 01 评审过程中曾把"删单点保后代"列为非目标，理由是"有提升子节点 vs 断开子树两种含糊解读"。重新审视后认为这个论证不成立——**"删一个节点 = 把它从树里抠掉，子节点接到父节点上"是自然且唯一的语义**（断开子树本质上是另一个操作，应该叫 `prune`）。本 RFC 接纳单点删除。

## 目标与非目标

### 目标

- 提供 `remove(nodeId, options?)` 单点删除节点，子节点自动提升到父节点位置（保持原有 childrenIds 顺序）
- 提供 `prune(nodeId, options?)` 删除节点及其全部后代子树（批量回收一片"失败分支"）
- 提供 `compact(options?)` 批量合并"线性链"中间节点（自动整理深而细的历史）
- 引入**统一的数据合并钩子** `mergeData(removedData, survivorData) => T`，让调用方显式决定差量/全量场景下被删节点的 data 如何处理
- 所有破坏性操作均为**显式**：不调用就不破坏；调用一次就明确一次
- 不修改 [RFC 01](../01-history-tree/RFC.md) 既有 API 的任何行为

### 非目标

- **不**实现隐式 GC（不暗中删除任何节点）
- **不**实现"撤销破坏性操作"——破坏即永久
- **不**支持删除根节点（`rootId` 是树的锚点，需要主动重建实例）
- **不**自动判断"全量还是差量"——RFC 01 已经声明本工具对存储语义无感，本 RFC 延续这一立场：默认行为按全量场景设计（不传 `mergeData` 时直接丢弃被删 data），差量场景**强制**调用方传 `mergeData`，否则数据链一定会断
- **不**提供"按深度上限自动 GC"等策略——属于上层调度，调用方可以基于本 RFC 的 API 自行组合

## 名词约定（追加）

| 名词 | 含义 |
| --- | --- |
| Remove（单点删除） | 删除指定节点 N，N 的所有子节点提升到 N.parentId 下，占据 N 在 parent.childrenIds 中的原位置（保持顺序） |
| Prune（剪枝） | 删除指定节点及其全部后代子树 |
| Compact（压缩） | 批量合并仅有单一子节点的"线性链"中间节点（本质上是对每个可合并节点执行一次 remove） |
| mergeData（数据合并钩子） | 调用方提供的纯函数 `(removedData, survivorData) => T`，告诉框架被删节点的 data 如何合并到留下的节点。差量场景必传 |
| Storage 模式（全量 / 差量） | 调用方在 `commit` 时实际写入节点的 data 形态。本工具对此无感，但破坏性操作的语义与之强相关 |

## API 设计

### 新增三个方法

在 [RFC 01 的 `HistoryTree<T>` 接口](../01-history-tree/RFC.md#返回值historytree)上**追加**三个方法（不修改既有方法的签名与行为）：

```ts
interface HistoryTree<T> {
  // ...... RFC 01 已有的 commit / checkout / getPathData / ... 等方法

  /**
   * 【破坏性操作】单点删除：从树中删除 nodeId，其所有子节点提升到 nodeId.parentId 下，
   * 占据 nodeId 在 parent.childrenIds 中的原位置（保持顺序）
   *
   * 执行顺序（关键不变量：任一前置校验失败时，树状态完全不变）：
   *   1. 校验 nodeId 存在，否则抛错
   *   2. 校验 nodeId 不是根节点，否则抛错
   *   3. 若 currentId === nodeId 且 options.onCurrentDeleted === 'throw' → 抛错
   *   4. （若提供 mergeData）对每个 child，调用 mergeData(removed.data, child.data) 计算新 data 并写回 child.data
   *   5. 修改拓扑：每个 child.parentId 改为 removed.parentId；
   *      parent.childrenIds 中的 nodeId 位置被替换为 [...child ids in order]
   *   6. 从 nodes Map 中删除 nodeId
   *   7. 若 currentId === nodeId，按策略回退（'parent' → removed.parentId；'first-child' → 首个子节点 id，无子时回退到 parent）
   *   8. 触发一次 onChange
   *
   * @param nodeId 要删除的节点 id
   * @param options.mergeData 合并被删节点 data 到每个子节点的纯函数。差量场景**必传**，否则节点链会断；
   *   全量场景可省略，省略时被删节点的 data 直接丢弃，子节点 data 保持不变
   * @param options.onCurrentDeleted currentId === nodeId 时的回退策略
   *   - `'parent'`（默认）：currentId 回退到被删节点的 parentId
   *   - `'first-child'`：currentId 切换到被删节点的首个 child（若有），否则回退到 parent
   *   - `'throw'`：直接抛错，调用方需先手动 checkout
   *
   * @throws 节点不存在、传入根节点 id、或 currentId 命中且策略为 'throw' 时抛出
   */
  remove(
    nodeId: string,
    options?: {
      mergeData?: (removedData: T, childData: T) => T
      onCurrentDeleted?: 'parent' | 'first-child' | 'throw'
    },
  ): void

  /**
   * 【破坏性操作】子树删除：删除指定节点及其全部后代子树，不可恢复
   *
   * 执行顺序（同 remove 的不变量）：
   *   1. 校验 nodeId 存在
   *   2. 校验 nodeId 不是根节点
   *   3. 若 currentId 落入被删子树且 options.onCurrentDeleted === 'throw' → 抛错
   *   4. 将 nodeId 从其父节点的 childrenIds 中移除；从 nodes Map 中删除 nodeId 及其所有后代
   *   5. 若 currentId 已被删除，按策略回退
   *   6. 触发一次 onChange
   *
   * 注意：prune **不接受 mergeData**——整棵子树都被丢弃，"合并到谁"无语义可言。
   * 若需要在删之前对子树的 data 做汇总，调用方应在外部用 getNode / getSnapshot 自行处理后再调 prune
   *
   * @param nodeId 子树根节点 id（含此节点本身 + 全部后代）
   * @param options.onCurrentDeleted currentId 落入被删子树时的回退策略
   *   - `'parent'`（默认）：currentId 回退到被删根节点的 parentId
   *   - `'root'`：currentId 回退到 rootId
   *   - `'throw'`：直接抛错
   *
   * @returns 被删除的节点 id 列表（**后序 DFS**：先访问全部后代再访问自身，便于按"子先父后"释放外部引用）
   *
   * @throws 节点不存在、传入根节点 id、或 currentId 落入子树且策略为 'throw' 时抛出
   */
  prune(
    nodeId: string,
    options?: { onCurrentDeleted?: 'parent' | 'root' | 'throw' },
  ): string[]

  /**
   * 【破坏性操作】批量压缩：对整棵树扫描，把所有满足条件的"线性中间节点"用一次 remove 合并掉
   *
   * 合并候选：一个节点 N 满足全部条件时会被 remove：
   *   1. N 不是根节点
   *   2. N 不是当前节点（currentId）
   *   3. N 恰好只有 1 个子节点（叶子节点和分叉节点不参与）
   *   4. options.keep（如果提供）返回 false
   *
   * 候选节点的处理顺序为 **root-to-leaf**：保证连续线性链上 mergeData 按"父先子后"的顺序累积，
   * 与 fold-left 语义一致（典型场景：patch 串接、深合并等天然满足结合律的合并器，结果与执行顺序无关；
   * 但为了让边缘情形结果可预测，本 RFC 仍把顺序固定为 root-to-leaf）。
   * 反复扫描直到稳定；连续的线性链会被一次性压缩完。
   *
   * 与 remove 的关系：compact 是"对每个候选节点执行一次 remove(..., {mergeData})"的批量包装；
   * 差量场景调用方**必须传 mergeData**，否则数据链会断（与 remove 同义警告）
   *
   * @param options.mergeData 数据合并函数，语义与 remove 完全一致；差量场景必传
   * @param options.keep 节点保护函数；返回 true 时该节点不会被合并
   * @returns 本次调用合并掉的节点数量；为 0 时不触发 onChange
   */
  compact(options?: {
    mergeData?: (removedData: T, childData: T) => T
    keep?: (node: HistoryNodeInfo<T>) => boolean
  }): number
}
```

### onChange 触发更新

[RFC 01](../01-history-tree/RFC.md#返回值historytree) 的 `onChange` listener 触发来源扩展至：**`commit` / `checkout` / `remove` / `prune` / `compact`**。回调参数仍是最新的 `HistoryTreeSnapshot<T>`。

| 操作 | 触发约定 |
|---|---|
| `commit`、`checkout` | 维持 RFC 01 既有行为（即使 checkout 到当前节点也触发，是 v0.1.0 既定行为） |
| `remove` | 必然产生状态变化 → **一次** onChange |
| `prune` | 必然产生状态变化（已排除 root，目标节点至少自身被删）→ **一次** onChange |
| `compact` | 合并数 > 0 时**一次** onChange；合并数 = 0 时**不触发**，避免无意义通知 |

`compact` 的"无变化不通知"与 `checkout` 的"无变化也通知"不对称——这是有意的前向改进，不变更 v0.1.0 既有行为。

## 数据合并语义详解

这是本 RFC 最关键的设计点，单独拿出来说明。

### 全量场景（无需 mergeData）

每个节点的 data 自带完整状态：

```ts
interface DocState { title: string; content: string }
const tree = createHistoryTree<DocState>({ initialData: { title: '', content: '' } })

tree.commit({ title: 'a', content: '1' }) // v1
tree.commit({ title: 'a', content: '12' }) // v2
tree.commit({ title: 'a', content: '123' }) // v3 (current)

// 想压缩中间节点 v2
tree.remove('2')
// 不传 mergeData → v2 的 data 直接丢弃；v3 的 data 不变
// 结果：v0 ── v1 ── v3(current, {title: 'a', content: '123'})
// 从根重算到 v3 → 直接用 v3 的全量，状态正确
```

### 差量场景（必须 mergeData）

每个节点的 data 是相对父节点的 patch：

```ts
interface Patch { ops: Array<{path: string; value: unknown}> }
const tree = createHistoryTree<Patch>({ initialData: { ops: [] } })

tree.commit({ ops: [{path: '/x', value: 5}] })       // v1: +x=5
tree.commit({ ops: [{path: '/y', value: 3}] })       // v2: +y=3
tree.commit({ ops: [{path: '/z', value: 7}] })       // v3: +z=7 (current)

// 想压缩中间节点 v2
tree.remove('2', {
  mergeData: (removedPatch, childPatch) => ({
    ops: [...removedPatch.ops, ...childPatch.ops],   // 把 v2 的 patch 前置到 v3 上
  }),
})
// 结果：v0 ── v1 ── v3(ops: [+y=3, +z=7])
// 从根重算：apply(v1.ops) → apply(v3.ops) → {x:5, y:3, z:7} ✓
```

如果差量场景**不传** `mergeData`：

```ts
tree.remove('2') // 没传 mergeData
// v3.ops 仍是 [+z=7]，但 v2 的 [+y=3] 永远丢失
// 从根重算到 v3 → {x:5, z:7}，y 不见了，数据错误
```

**框架不会自动检测这种错误**——这是调用方的责任。本 RFC 在 JSDoc 与本节都给出明确警告。

### 多子节点场景

当 remove 一个有多个子节点的节点时，`mergeData` 对**每个 child 各调用一次**：

```ts
// 拓扑：v0 ── v1 ──┬── v2
//                  └── v3
tree.remove('1', { mergeData: (a, b) => merge(a, b) })
// mergeData(v1.data, v2.data) → v2 新 data
// mergeData(v1.data, v3.data) → v3 新 data
// 结果：v0 ──┬── v2(new data)
//           └── v3(new data)
```

这适合差量场景：每个 child 都需要把被删节点的 patch 前置到自己头上才能保持从根可重算。

### 节点修改策略：原地修改（in-place mutation）

被删节点的 data 通过 `mergeData` 合并到子节点后，框架**直接覆盖子节点的 data**，**不创建新节点**——子节点的 id 与拓扑位置保持不变。

#### 为什么不创建新节点？

- **保持 id 稳定**：调用方在外部缓存了 child id 时不需要刷新（只需在 `onChange` 中关心被删的 id）；如果合并产生新 id，所有外部 id 引用都会失效
- **不引入"合并提交"概念**：RFC 01 已经把"节点 = `commit()` 的结果"作为基础语义；如果破坏性操作能"在 `commit()` 之外新建节点"，调用方就要面对两套节点创建语义，理解与排查成本提高
- **可由调用方显式组合表达**：若调用方真的需要"用合并结果新建一个节点"，可以 `prune` 老子树 + 用合并后的 data 调 `commit`；这种用法应该是显式而非隐式的

#### 对调用方的可观察影响

| 项 | 影响 |
|---|---|
| `child.id` | **不变** |
| `child.parentId` / `child.childrenIds` | 拓扑变化时由框架同步 |
| `child.data` | **被新值覆盖** |
| 监听器在不同时刻收到的 snapshot | 同一个 id 可能呈现**不同 data**（不是 bug，是预期行为） |
| 业务层外部缓存的 `{id, data}` 副本 | 需要在 `onChange` 中刷新对应条目 |

#### 与 commit 的语义区别

| 操作 | 节点 id | data 写入位置 | 拓扑变化 |
|---|---|---|---|
| `commit(data)` | **新建** | 新节点 | 当前节点下新增子节点 |
| `remove(id, {mergeData})` | 不变 | **覆盖每个 child 的 data** | 拆掉一个节点 |
| `prune(id)` | 不变 | 不修改任何 data | 拆掉整棵子树 |
| `compact({mergeData})` | 不变（保留的子节点） | **覆盖保留节点的 data** | 拆掉所有"线性中间节点" |

## 破坏性操作语义详解

复用 [RFC 01 的 v0~v9 拓扑](../01-history-tree/RFC.md#分支创建语义)：

```text
v0 ──→ v1 ──┬──→ v2 ──→ v6
             │
             └──→ v3 ──┬──→ v4 ──┬──→ v5
                        │         │
                        │         └──→ v8 ──→ v9
                        │
                        └──→ v7
```

### remove：单点删除

#### 删除叶子节点（无子节点）

```ts
tree.remove('5')
// v4.childrenIds 从 ['5', '8'] 变为 ['8']
// 不调用 mergeData（无 child）
```

#### 删除有 1 个子节点的中间节点

```ts
tree.remove('8', { mergeData: mergePatch })
// v9.parentId 由 '8' 改为 '4'
// v4.childrenIds 中 '8' 被替换为 '9'，最终 ['5', '9']
// mergeData(v8.data, v9.data) → v9 新 data
```

#### 删除有多个子节点的中间节点

```ts
tree.remove('3', { mergeData: mergePatch })
// 删前 v3.childrenIds = ['4', '7']
// v4.parentId 由 '3' 改为 '1'；v7.parentId 由 '3' 改为 '1'
// v1.childrenIds 中 '3' 被替换为 ['4', '7']，最终 ['2', '4', '7']
// mergeData(v3.data, v4.data) → v4 新 data
// mergeData(v3.data, v7.data) → v7 新 data
```

#### 当前节点恰好是被删节点

```ts
tree.checkout('3')
tree.remove('3', { onCurrentDeleted: 'parent' })
// currentId 从 '3' → '1'

tree.remove('3', { onCurrentDeleted: 'first-child' })
// currentId 从 '3' → '4'（v3 的首个 child）
// 若 v3 没有 child（叶子），fallback 到 parent '1'

tree.remove('3', { onCurrentDeleted: 'throw' })
// 抛错，树状态不变
```

#### 边界

- `tree.remove(rootId)` → 抛错（不允许删根）
- `tree.remove('不存在')` → 抛错

### prune：子树删除

#### 删除叶子节点

```ts
tree.prune('5')
// 返回 ['5']
// v4.childrenIds 从 ['5', '8'] 变为 ['8']
```

#### 删除中间节点（含全部后代）

```ts
tree.prune('4')
// 返回 ['5', '9', '8', '4']（后序 DFS：v4 子节点为 [v5, v8]，v8 又有子 v9）
// v3.childrenIds 从 ['4', '7'] 变为 ['7']
```

#### 当前节点落入被删子树

```ts
tree.checkout('9')
tree.prune('4', { onCurrentDeleted: 'parent' })  // 默认
// currentId 从 '9' → '3'（v4 的父）

tree.prune('4', { onCurrentDeleted: 'root' })    // currentId → '0'
tree.prune('4', { onCurrentDeleted: 'throw' })   // 抛错
```

### compact：批量合并线性链

```text
压缩前：v0 ── v1 ── v2 ── v3 ──┬── v4
                                └── v5（current）

压缩后（root-to-leaf 顺序合并，v3 的 id 不变、data 被覆盖）：
v0 ── v3 ──┬── v4
            └── v5（current）
```

执行过程（演示 root-to-leaf 串联累积 + 原地修改）：

1. 第一轮扫描，v1 是离 root 最近的候选 → 调 `remove(v1, {mergeData})`：
   - `mergeData(v1.data, v2.data)` → **直接覆盖 v2.data**
   - 拓扑：v0 ── v2 ── v3 ──┬── v4 / └── v5
2. 第二轮扫描，v2 现在是候选 → 调 `remove(v2, {mergeData})`：
   - `mergeData(v2.data[已含 v1 的合并结果], v3.data)` → **直接覆盖 v3.data**
   - 拓扑：v0 ── v3 ──┬── v4 / └── v5
3. 第三轮扫描，无候选 → 稳定，结束

参与/不参与合并的原因：

- v0 是 root，不参与
- v1 / v2 是只有 1 个子节点的中间节点，被合并
- v3 是分叉点（2 个子节点），不参与
- v4 是叶子，不参与
- v5 是 current，不参与

最终：v3 的 **id 不变**，data 等价于 `mergeData(mergeData(v1.data, v2.data), v3.data)`；返回 `2`

#### 保护策略

```ts
// '2' 是用户手动收藏的"里程碑"节点，不应被压缩
tree.compact({
  mergeData: mergePatch,
  keep: node => node.id === '2',
})
```

#### 与 prune 的组合

```ts
// 先删掉失败的分支，再压缩剩余的线性段
tree.prune(failedBranchRoot)
tree.compact({ mergeData: mergePatch })
```

## 调用方注意事项

- **差量场景必传 mergeData**：框架不检测、不保护。不传 → 数据链一定断
- **mergeData 必须是纯函数**：不可有副作用；同样的输入必须返回同样的输出。compact 处理多个候选时是 **fold-left 风格的串联累积**——每次 `mergeData` 的输入是已被前面步骤覆盖过的 data，调用方实现需对这种累积保持稳定（典型如 patch 串接、深合并等天然满足）
- **外部持有的节点 id**：`remove` / `prune` / `compact` 都会让被删节点的 id 失效。业务层在外部缓存了 id 时需要在 `onChange` 中同步清理或用 `keep` 保护
- **listener 回调中再次破坏**：允许，但继承自 v0.1.0 的既有 reentrance 行为——`notifyListeners` 不冻结监听器列表也不去重快照，嵌套的状态变更可能导致无限递归或快照 out-of-order 送达。调用方若敏感于顺序，应在监听器内避免触发新的状态变更
- **性能**：`remove` 复杂度为 O(子节点数)；`prune` 为 O(被删节点数)；`compact` 当前实现采用反复扫描直到稳定的策略（理论上界 O(n²)，但因为 root / current / 分叉 / 叶子全部不参与合并，可被合并的"线性中间节点"通常占少数），适合人类操作频率而非密集批处理；大批量场景可在后续版本演进为单次拓扑遍历

## 错误处理（追加）

沿用 [RFC 01 错误处理约定](../01-history-tree/RFC.md#错误处理)，统一通过 `throwError('history-tree', ...)` 抛出。新增错误场景：

| 错误场景 | 调用方式 | 实际错误信息 |
| --- | --- | --- |
| `remove` 时节点不存在 | `throwError('history-tree', 'Node "${nodeId}" does not exist')` | `[@cmtlyt/lingshu-toolkit#history-tree]: Node "xxx" does not exist` |
| `remove` 传入根节点 id | `throwError('history-tree', 'Cannot remove root node')` | `[@cmtlyt/lingshu-toolkit#history-tree]: Cannot remove root node` |
| `remove` 当前节点命中且策略为 `throw` | `throwError('history-tree', 'Current node "${currentId}" is the target of remove')` | `[@cmtlyt/lingshu-toolkit#history-tree]: Current node "xxx" is the target of remove` |
| `prune` 时节点不存在 | `throwError('history-tree', 'Node "${nodeId}" does not exist')` | `[@cmtlyt/lingshu-toolkit#history-tree]: Node "xxx" does not exist` |
| `prune` 传入根节点 id | `throwError('history-tree', 'Cannot prune root node')` | `[@cmtlyt/lingshu-toolkit#history-tree]: Cannot prune root node` |
| `prune` 当前节点位于子树且策略为 `throw` | `throwError('history-tree', 'Current node "${currentId}" is in pruned subtree of "${nodeId}"')` | `[@cmtlyt/lingshu-toolkit#history-tree]: Current node "xxx" is in pruned subtree of "yyy"` |

> compact 内部错误会按 remove 的错误抛出（因为 compact = 多次 remove）。

## 测试策略

### 新增测试用例（在 RFC 01 已有 17 条之上追加）

| # | 场景 | 验证点 |
| --- | --- | --- |
| 18 | **remove - 叶子节点** | 父节点 childrenIds 不含被删 id；不调用 mergeData |
| 19 | **remove - 单子节点中间节点** | child.parentId 改写正确；mergeData 调用 1 次 |
| 20 | **remove - 多子节点中间节点** | parent.childrenIds 中目标位置被多个 child id 顺序替换；mergeData 对每个 child 各调用 1 次 |
| 21 | **remove - 不传 mergeData** | 子节点 data 保持不变；不调用 mergeData |
| 22 | **remove - 差量场景验证 mergeData** | 提供 patch merger，验证 mergeData 返回值写回 child.data |
| 23 | **remove - currentId 命中（默认 parent）** | currentId 回退到 parentId |
| 24 | **remove - currentId 命中（first-child 有 child）** | currentId 切到首个 child |
| 25 | **remove - currentId 命中（first-child 无 child）** | currentId fallback 到 parent |
| 26 | **remove - currentId 命中（throw 策略）** | 抛错，树状态不变 |
| 27 | **remove - 根节点抛错** | 调用 `tree.remove(rootId)` 抛错且不修改树 |
| 28 | **remove - 节点不存在抛错** | 错误信息匹配 RFC 01 既有格式 |
| 29 | **remove - 触发 onChange 一次** | 一次调用只通知一次 |
| 30 | **prune - 叶子节点** | 父节点 childrenIds 不含被删 id，size -1 |
| 31 | **prune - 中间节点** | 所有后代被删；返回值为**后序 DFS** 顺序的 id 列表 |
| 32 | **prune - currentId 在子树内（默认 parent）** | currentId 回退到被删根节点的父 |
| 33 | **prune - currentId 在子树内（root 策略）** | currentId 回退到 rootId |
| 34 | **prune - currentId 在子树内（throw 策略）** | 抛错，currentId 与树状态不变 |
| 35 | **prune - currentId 不在子树内** | currentId 保持不变 |
| 36 | **prune - 根节点抛错** | 调用 `tree.prune(rootId)` 抛错且不修改树 |
| 37 | **prune - 节点不存在抛错** | 错误信息匹配 |
| 38 | **prune - 触发 onChange 一次** | 一次调用只通知一次 |
| 39 | **compact - 合并线性链（不传 mergeData）** | 中间节点被删，子节点 data 不变（适合全量场景） |
| 40 | **compact - 合并线性链（传 mergeData）** | 验证 mergeData 被按"父先子后"的顺序对每个被合并节点调用 |
| 41 | **compact - 不合并 root** | root 即使只有 1 个子节点也保留 |
| 42 | **compact - 不合并 current** | current 永远保留 |
| 43 | **compact - 不合并分叉节点** | >1 子节点不参与合并 |
| 44 | **compact - 不合并叶子** | 0 子节点不参与合并 |
| 45 | **compact - keep 保护** | keep 返回 true 的节点不被合并 |
| 46 | **compact - 无可合并节点** | 返回 0 且不触发 onChange |
| 47 | **compact - 触发 onChange 一次** | 有合并发生时一次调用只通知一次 |
| 48 | **compact - 合并后 parent/child 关系正确** | 被提升的子节点 parentId 与 grandparent.childrenIds 顺序均正确 |
| 49 | **compact - 候选按 root-to-leaf 顺序处理** | 构造 v0 ── v1 ── v2 ── v3(current) 线性链，传入 mergeData 记录调用次序与参数；验证第一次调用参数为 (v1.data, v2.data)，第二次为 (mergeData 第一次的返回值, v3.data) |
| 50 | **节点修改策略 - id 稳定** | remove / compact 后保留节点的 id 不变；compact 整条线性链合并后，最末端保留节点的 id 与合并前一致 |
| 51 | **节点修改策略 - data 原地覆盖** | mergeData 返回值直接写入保留节点的 data；getSnapshot 在 compact 前后取得的 snapshot 中，保留节点 id 相同但 data 不同 |
| 52 | **差量场景集成测试** | 模拟 patch 存储 + 多次 commit + compact + 从 root 重放 → 验证状态与未 compact 时一致 |

## 文件改动规划

| 文件 | 改动 |
| --- | --- |
| `src/shared/history-tree/types.ts` | `HistoryTree<T>` 接口新增 `remove` / `prune` / `compact` 三个方法签名 |
| `src/shared/history-tree/core.ts` | 实现三个新方法；复用 `getNodeOrThrow` 与 `notifyListeners`；`compact` 内部委托 `remove` |
| `src/shared/history-tree/index.mdx` | 文档新增"破坏性操作"章节；强调差量场景的 mergeData 必传 |
| `src/shared/history-tree/__test__/history-tree.node.test.ts` | 追加 32 条新测试用例 |
| `src/shared/history-tree/__docs__/rfcs/02-history-tree-destructive-ops/IMPLEMENTATION.md` | RFC 通过后另起实施清单 |

## 关键设计取舍小结

| 取舍 | 决策 | 理由 |
| --- | --- | --- |
| 单点删除是否提供 | **是** | cmtlyt 评审指出"删一个节点 = 子节点提升"是自然语义；之前"歧义"论证不成立 |
| 数据合并由谁决定 | **调用方** | 框架对全量/差量无感（继承 RFC 01 立场），调用方传 mergeData 显式表达语义 |
| 差量场景不传 mergeData 是否报错 | **不报错** | 框架无法判断"全量 vs 差量"，强制报错会让全量场景被迫传无意义函数；通过 JSDoc + RFC 警告把责任明确给调用方 |
| compact 与 remove 关系 | **compact 内部委托 remove** | 避免重复实现；compact 只负责"决定合并谁"，"怎么合并"完全交给 remove |
| 合并后修改节点还是新建节点 | **原地修改保留节点的 data，id 不变** | id 稳定避免外部引用失效；不引入与 commit 并列的"合并提交"概念；调用方有"用合并结果新建节点"的需求时可显式 prune + commit 表达 |
| compact 多候选时处理顺序 | **root-to-leaf** | 保证 mergeData 按"父先子后" fold-left 累积；对结合律合并器结果相同，对非结合律情形结果可预测 |
| remove 多子节点时 mergeData 调用次数 | **每个 child 各 1 次** | 差量场景下每个 child 都需要被删节点的 patch 前置才能保持从根可重算 |
| prune 是否提供 mergeData | **否** | 整棵子树都被丢弃，"合并到谁"无语义；调用方有汇总需求应在外部 getSnapshot 处理后再调 prune |
| onChange 在 compact 0 合并时是否触发 | **不触发** | 无状态变化 → 无意义通知；与 checkout-self 仍触发的既有不对称是有意的前向改进 |

## 开放问题

- 是否需要在 `createHistoryTree` 配置中加 `storageMode: 'full' | 'diff'`，从而让框架在差量模式下强制 mergeData？倾向不加——增加主入口配置项的复杂度换不来太多保护；调用方自己清楚自己的存储模式
- `compact` 是否需要返回被合并节点的 id 列表（便于外部清理引用）？当前仅返回数量；如外部确有此需求可演进为 `{ count, removedIds }` 形态。倾向先保持 `number`，待真实场景出现再扩展
- 是否提供"批量破坏性操作 + 单次通知"的事务 API（如 `batch(() => { ... })`）？目前每个方法内部已合并通知；跨方法的事务批处理属于后续话题
