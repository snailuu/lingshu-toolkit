# RFC: historyTree — 破坏性操作（remove / prune / compact）

> status: draft
>
> author: snailuu
>
> create time: 2026/06/22 10:30:00
>
> rfc version: 0.3.0
>
> scope: `src/shared/history-tree`
>
> 依赖：本 RFC 构建在 [RFC 01 v0.2.0](../01-history-tree/RFC.md) 已定义的 `HistoryTree<T>` 接口之上，不修改既有 API 的任何行为。

## 版本历史

| 版本 | 日期 | 变更摘要 |
| --- | --- | --- |
| 0.3.0 | 2026/07/29 | 响应评审：新增 `loadFromSnapshot` 快照加载方法（持久化恢复 + 破坏性操作回滚）；明确 `preview` 与 `onChange` 事件的**快照时态**（preview 为操作前、`affectedNodes` 为操作后）并补齐 `commit` / `checkout` 的事件语义；定义 `mergeData` 抛错时的**原子性**（remove 先算后写、compact 全有或全无）；澄清 `compact` 委托的是内部 `removeNode` 而非公开 `remove` |
| 0.2.0 | 2026/06/27 | 响应评审：`prune` 增加 `includeSelf` 控制是否删除选中节点；`onChange` 增加可选事件参数并在 `prune` / `compact` 事件中返回被删除节点；新增 `previewRemove` / `previewPrune` / `previewCompact` 非破坏检测方法返回受影响节点 |
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
- 提供 `prune(nodeId, options?)` 删除节点及其后代子树；通过 `includeSelf` 控制是否同时删除选中节点（批量回收一片"失败分支"，也支持"只清空子树"）
- 提供 `compact(options?)` 批量合并"线性链"中间节点（自动整理深而细的历史）
- 引入**统一的数据合并钩子** `mergeData(removedData, survivorData) => T`，让调用方显式决定差量/全量场景下被删节点的 data 如何处理
- 所有破坏性操作均为**显式**：不调用就不破坏；调用一次就明确一次
- 为三个破坏性操作提供对应的**非破坏检测方法**：传入相同参数，返回本次会受影响的节点；没有节点受影响时返回空数组
- 提供 `loadFromSnapshot(snapshot)` 用快照整体替换当前树，覆盖"跨会话持久化恢复"与"破坏性操作前备份 / 失败回滚"两个场景
- `onChange` 增加可选事件参数，便于调用方在 `prune` / `compact` 后清理外部引用
- 明确所有破坏性操作在 `mergeData` 抛错时的**原子性**：要么整体生效，要么树状态完全不变
- 不修改 [RFC 01](../01-history-tree/RFC.md) 既有 API 的任何行为

### 非目标

- **不**实现隐式 GC（不暗中删除任何节点）
- **不**内建 undo 栈来"撤销破坏性操作"——破坏性操作本身不可逆；但调用方可用 `getSnapshot` + `loadFromSnapshot` 自行实现备份与回滚（见"快照加载语义"）
- **不**支持删除根节点（`rootId` 是树的锚点；确需更换根节点时用 `loadFromSnapshot` 整体替换）
- **不**自动判断"全量还是差量"——RFC 01 已经声明本工具对存储语义无感，本 RFC 延续这一立场：默认行为按全量场景设计（不传 `mergeData` 时直接丢弃被删 data），差量场景**强制**调用方传 `mergeData`，否则数据链一定会断
- **不**提供"按深度上限自动 GC"等策略——属于上层调度，调用方可以基于本 RFC 的 API 自行组合

## 名词约定（追加）

| 名词 | 含义 |
| --- | --- |
| Remove（单点删除） | 删除指定节点 N，N 的所有子节点提升到 N.parentId 下，占据 N 在 parent.childrenIds 中的原位置（保持顺序） |
| Prune（剪枝） | 默认删除指定节点及其全部后代子树；当 `includeSelf: false` 时，仅删除其全部后代并保留指定节点本身 |
| Compact（压缩） | 批量合并仅有单一子节点的"线性链"中间节点（内部对每个可合并节点执行一次 `removeNode` 核心逻辑，见"compact 与 remove 的关系"） |
| mergeData（数据合并钩子） | 调用方提供的纯函数 `(removedData, survivorData) => T`，告诉框架被删节点的 data 如何合并到留下的节点。差量场景必传 |
| Storage 模式（全量 / 差量） | 调用方在 `commit` 时实际写入节点的 data 形态。本工具对此无感，但破坏性操作的语义与之强相关 |
| Affected Node（受影响节点） | 其存在性、`data`、`parentId` 或 `childrenIds` 会发生变化的节点。**时态见下条** |
| 快照时态（before / after） | `preview*` 方法在操作发生**前**调用，只能返回**操作前**快照（含将被删除的节点）；`onChange` 在操作发生**后**触发，因此 `event.removedNodes` 为被删节点的**操作前**快照（节点已不存在），`event.affectedNodes` 为操作后仍存在的受影响节点的**操作后**快照。两者的 id 并集与对应 `preview*` 的 id 集合一致 |
| Change Event（变更事件） | `onChange` 的第二个可选参数，描述本次变更类型与被删除 / 受影响节点，便于调用方同步外部缓存 |
| Snapshot Load（快照加载） | 用一份 `HistoryTreeSnapshot<T>` 整体替换当前实例的 `rootId` / `currentId` / 全部节点。非破坏性语义上的"删除"，但会丢弃当前树的全部内容 |

## API 设计

### 新增破坏性方法、检测方法与事件类型

在 [RFC 01 的 `HistoryTree<T>` 接口](../01-history-tree/RFC.md#返回值historytree)上**追加**三类破坏性方法、三类非破坏检测方法、一个快照加载方法，并扩展 `onChange` listener 的事件参数（不修改既有方法的签名与行为）：

```ts
interface HistoryTreeChangeEvent<T> {
  /** 触发本次变更的操作类型 */
  type: 'commit' | 'checkout' | 'remove' | 'prune' | 'compact' | 'load'

  /**
   * 本次操作删除的节点，**操作前**快照（节点已不在树中，只能是操作前状态）。
   * commit / checkout 为空数组；load 为被替换掉的旧树的全部节点
   */
  removedNodes: HistoryNodeInfo<T>[]

  /**
   * 操作后**仍存在**的受影响节点，**操作后**快照（data / parentId / childrenIds 均为新值）。
   * 调用方可直接用它刷新外部缓存，不会写回过期状态。无节点受影响时为空数组
   */
  affectedNodes: HistoryNodeInfo<T>[]
}

interface HistoryTree<T> {
  // ...... RFC 01 已有的 commit / checkout / getPathData / ... 等方法

  /**
   * 注册变更监听器。第二个参数为可选事件对象；旧调用方只接收 snapshot 时仍兼容。
   *
   * 快照时态：`removedNodes` 是操作前快照，`affectedNodes` 是操作后快照。
   * `removedNodes` 与 `affectedNodes` 的 id 并集，等于对应 `preview*` 方法返回的 id 集合
   */
  onChange(listener: (snapshot: HistoryTreeSnapshot<T>, event?: HistoryTreeChangeEvent<T>) => void): () => void

  /**
   * 【破坏性操作】单点删除：从树中删除 nodeId，其所有子节点提升到 nodeId.parentId 下，
   * 占据 nodeId 在 parent.childrenIds 中的原位置（保持顺序）
   *
   * 执行顺序（关键不变量：**任一前置校验或 mergeData 调用失败时，树状态完全不变**）：
   *   1. 校验 nodeId 存在，否则抛错
   *   2. 校验 nodeId 不是根节点，否则抛错
   *   3. 若 currentId === nodeId 且 options.onCurrentDeleted === 'throw' → 抛错
   *   4. 【先算】（若提供 mergeData）对每个 child 依次调用 mergeData(removed.data, child.data)，
   *      结果暂存于临时数组，**此阶段不写回任何节点**；
   *      任一次调用抛错则直接向上抛出原始错误，树保持调用前状态（见"mergeData 失败的原子性"）
   *   5. 【后写】把第 4 步暂存的结果统一写回各 child.data
   *   6. 修改拓扑：每个 child.parentId 改为 removed.parentId；
   *      parent.childrenIds 中的 nodeId 位置被替换为 [...child ids in order]
   *   7. 从 nodes Map 中删除 nodeId
   *   8. 若 currentId === nodeId，按策略回退（'parent' → removed.parentId；'first-child' → 首个子节点 id，无子时回退到 parent）
   *   9. 触发一次 onChange，event.removedNodes = [removed 的操作前快照]，
   *      event.affectedNodes = 父节点与各 child 的**操作后**快照（id 集合与 previewRemove 一致，减去被删节点）
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
   * 【非破坏检测】预览 remove 会影响的所有节点，返回**操作前**的节点快照
   * （操作尚未发生，操作后状态无从取得；需要操作后状态请在 onChange 的 event.affectedNodes 中取）。
   * 返回顺序：被删除节点 → 父节点（若存在）→ 子节点（按 childrenIds 顺序）。
   * 校验规则与 remove 一致；不会调用 mergeData，不会修改树，不会触发 onChange。
   */
  previewRemove(
    nodeId: string,
    options?: {
      mergeData?: (removedData: T, childData: T) => T
      onCurrentDeleted?: 'parent' | 'first-child' | 'throw'
    },
  ): HistoryNodeInfo<T>[]

  /**
   * 【破坏性操作】子树删除：默认删除指定节点及其全部后代子树；
   * 当 includeSelf 为 false 时，只删除指定节点的全部后代，保留指定节点本身
   *
   * 执行顺序（同 remove 的不变量）：
   *   1. 校验 nodeId 存在
   *   2. 当 includeSelf !== false 时，校验 nodeId 不是根节点；includeSelf === false 时允许传 rootId（语义为清空整棵树的非根节点）
   *   3. 计算被删除节点集合：includeSelf !== false 时为 nodeId + 全部后代；includeSelf === false 时仅为全部后代
   *   4. 若被删除节点集合为空 → 返回 []，不触发 onChange
   *   5. 若 currentId 落入被删集合且 options.onCurrentDeleted === 'throw' → 抛错
   *   6. 从 nodes Map 中删除被删集合；同步更新保留节点的 childrenIds
   *      - includeSelf !== false：将 nodeId 从其父节点 childrenIds 中移除
   *      - includeSelf === false：将 nodeId.childrenIds 清空
   *   7. 若 currentId 已被删除，按策略回退
   *      - includeSelf !== false 且策略为 parent：回退到被删根节点的 parentId
   *      - includeSelf === false 且策略为 parent：回退到 nodeId（因为 nodeId 被保留）
   *   8. 触发一次 onChange，event.removedNodes 为本次被删节点的**操作前**快照，
   *      event.affectedNodes 为被修改 childrenIds 的保留节点的**操作后**快照
   *
   * 注意：prune **不接受 mergeData**——整棵子树都被丢弃，"合并到谁"无语义可言。
   * 若需要在删之前对子树的 data 做汇总，调用方应在外部用 getNode / getSnapshot 自行处理后再调 prune
   *
   * @param nodeId 子树根节点 id
   * @param options.includeSelf 是否删除 nodeId 本身，默认 true；false 时仅删除 nodeId 的后代
   * @param options.onCurrentDeleted currentId 落入被删子树时的回退策略
   *   - `'parent'`（默认）：includeSelf 为 true 时回退到被删根节点的 parentId；includeSelf 为 false 时回退到 nodeId
   *   - `'root'`：currentId 回退到 rootId
   *   - `'throw'`：直接抛错
   *
   * @returns 被删除的节点 id 列表（**后序 DFS**：先访问全部后代再访问自身，便于按"子先父后"释放外部引用）；无节点被删除时返回 []
   *
   * @throws 节点不存在、includeSelf !== false 时传入根节点 id、或 currentId 落入被删集合且策略为 'throw' 时抛出
   */
  prune(
    nodeId: string,
    options?: { includeSelf?: boolean; onCurrentDeleted?: 'parent' | 'root' | 'throw' },
  ): string[]

  /**
   * 【非破坏检测】预览 prune 会影响的所有节点，返回**操作前**的节点快照。
   * 返回顺序：被删除节点（后序 DFS）→ 被修改 childrenIds 的保留节点（父节点或 nodeId）。
   * 无节点会被删除时返回 []；校验规则与 prune 一致；不会修改树，不会触发 onChange。
   */
  previewPrune(
    nodeId: string,
    options?: { includeSelf?: boolean; onCurrentDeleted?: 'parent' | 'root' | 'throw' },
  ): HistoryNodeInfo<T>[]

  /**
   * 【破坏性操作】批量压缩：对整棵树扫描，把所有满足条件的"线性中间节点"合并掉
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
   * 与 remove 的关系：compact 对每个候选节点执行一次**内部 `removeNode` 核心逻辑**，
   * 而**不是**循环调用公开的 `remove`——公开 `remove` 每次都会触发 onChange，
   * 循环调用会违反"compact 只通知一次"的契约（见"compact 与 remove 的关系"章节）。
   * 差量场景调用方**必须传 mergeData**，否则数据链会断（与 remove 同义警告）
   *
   * 原子性：整个 compact 是**全有或全无**的事务。任一候选节点的 mergeData 抛错时，
   * 已完成的合并会被整体还原，树恢复到 compact 调用前的状态，并向上抛出原始错误，
   * 且**不触发 onChange**（见"mergeData 失败的原子性"）
   *
   * @param options.mergeData 数据合并函数，语义与 remove 完全一致；差量场景必传
   * @param options.keep 节点保护函数；返回 true 时该节点不会被合并
   * @returns 本次调用合并掉的节点 id 列表（root-to-leaf 顺序）；为空数组时不触发 onChange
   */
  compact(options?: {
    mergeData?: (removedData: T, childData: T) => T
    keep?: (node: HistoryNodeInfo<T>) => boolean
  }): string[]

  /**
   * 【非破坏检测】预览 compact 会影响的所有节点，返回**操作前**的节点快照。
   * 返回顺序：会被合并删除的候选节点（root-to-leaf 顺序）→ 每个候选的 child → 每个候选的 parent 去重后结果。
   * 无候选节点时返回 []；不会调用 mergeData，不会修改树，不会触发 onChange。
   */
  previewCompact(options?: {
    mergeData?: (removedData: T, childData: T) => T
    keep?: (node: HistoryNodeInfo<T>) => boolean
  }): HistoryNodeInfo<T>[]

  /**
   * 【整体替换】用快照替换当前实例的全部状态：rootId、currentId 与所有节点。
   * 当前树的全部内容被丢弃，实例引用本身保持不变（外部持有的 tree 引用继续有效）。
   *
   * 两个典型场景：
   *   1. 持久化恢复：把 getSnapshot() 序列化存入 localStorage / 服务端，下次会话加载回来
   *   2. 破坏性操作回滚：破坏前 getSnapshot() 备份，操作出错或用户取消时 loadFromSnapshot 还原
   *
   * 执行顺序（关键不变量：**校验失败时当前树完全不变**）：
   *   1. 校验快照结构合法（见"快照校验规则"），任一项不通过 → 抛错，当前树不受影响
   *   2. 深拷贝快照节点写入内部 nodes Map（框架不持有调用方传入对象的引用；node.data 按引用原样存放，
   *      与 commit 的"原样存储"立场一致）
   *   3. 替换 rootId 与 currentId
   *   4. 推进内置 id 生成器（见"id 生成器与快照的关系"）
   *   5. 触发一次 onChange，event.type = 'load'，
   *      event.removedNodes = 被替换掉的**旧树**全部节点（操作前快照），
   *      event.affectedNodes = 加载后的**新树**全部节点（操作后快照）
   *
   * 注意：快照中的 data 不会被校验或转换——与 RFC 01"框架对存储语义无感"一致。
   * 若快照来自 JSON.parse，data 的原型链、Date / Map / Set 等类型需要调用方自行还原
   *
   * @param snapshot 完整的树快照，通常来自同类型实例的 getSnapshot()
   *
   * @throws 快照结构非法时抛出（缺字段、rootId / currentId 不存在、parentId 与 childrenIds 不一致、
   *   存在环、存在多个根、存在不可达的孤儿节点）
   */
  loadFromSnapshot(snapshot: HistoryTreeSnapshot<T>): void
}
```

### onChange 触发更新

[RFC 01](../01-history-tree/RFC.md#返回值historytree) 的 `onChange` listener 触发来源扩展至：**`commit` / `checkout` / `remove` / `prune` / `compact` / `load`**。第一个回调参数仍是最新的 `HistoryTreeSnapshot<T>`；第二个回调参数为可选 `HistoryTreeChangeEvent<T>`，旧代码 `(snapshot) => {}` 不需要修改。

**统一时态约定**：`removedNodes` 一律是**操作前**快照（这些节点已不在树中，取不到操作后状态）；`affectedNodes` 一律是**操作后**快照（调用方可直接用它刷新外部缓存）。二者的 id 并集等于对应 `preview*` 方法返回的 id 集合。

| 操作 | 触发约定 | `removedNodes`（before） | `affectedNodes`（after） |
|---|---|---|---|
| `commit` | 维持 RFC 01 既有行为 → **一次** | `[]` | 新建节点 + 其父节点 |
| `checkout` | 维持 RFC 01 既有行为（即使 checkout 到当前节点也触发，是 v0.1.0 既定行为） | `[]` | `[]`（仅 currentId 变化，无节点的 data / 拓扑改变） |
| `remove` | 必然产生状态变化 → **一次** | `[被删节点]` | 父节点 + 各被提升的 child |
| `prune` | 被删除节点数 > 0 时 **一次**；= 0 时不触发 | 本次被删的全部节点 | 被修改 `childrenIds` 的保留节点 |
| `compact` | 合并节点数 > 0 时 **一次**；= 0 时**不触发**，避免无意义通知；mergeData 抛错整体回滚时**不触发** | 本次合并删除的全部节点 | 被覆盖 data / 被改拓扑的保留节点 |
| `load` | 校验通过时 **一次**；校验失败抛错时不触发 | 被替换掉的旧树全部节点 | 加载后新树的全部节点 |

`compact` 的"无变化不通知"与 `checkout` 的"无变化也通知"不对称——这是有意的前向改进，不变更 v0.1.0 既有行为。

`checkout` 的 `affectedNodes` 为空数组而非"当前节点"：`affectedNodes` 的定义是"其存在性 / `data` / `parentId` / `childrenIds` 发生变化的节点"，`checkout` 只移动指针，不改变任何节点自身；当前节点是什么由第一个参数 `snapshot.currentId` 表达。

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

- **保持 id 稳定**：调用方在外部缓存了 child id 时不需要刷新（可通过 `onChange` 的 `event.removedNodes` / `event.affectedNodes` 清理或刷新外部引用）；如果合并产生新 id，所有外部 id 引用都会失效
- **不引入"合并提交"概念**：RFC 01 已经把"节点 = `commit()` 的结果"作为基础语义；如果破坏性操作能"在 `commit()` 之外新建节点"，调用方就要面对两套节点创建语义，理解与排查成本提高
- **可由调用方显式组合表达**：若调用方真的需要"用合并结果新建一个节点"，可以 `prune` 老子树 + 用合并后的 data 调 `commit`；这种用法应该是显式而非隐式的

#### 对调用方的可观察影响

| 项 | 影响 |
|---|---|
| `child.id` | **不变** |
| `child.parentId` / `child.childrenIds` | 拓扑变化时由框架同步 |
| `child.data` | **被新值覆盖** |
| 监听器在不同时刻收到的 snapshot | 同一个 id 可能呈现**不同 data**（不是 bug，是预期行为） |
| 业务层外部缓存的 `{id, data}` 副本 | 需要在 `onChange` 中根据 `event.removedNodes` 清理失效条目，并根据 `event.affectedNodes` 刷新受影响条目——后者是**操作后**快照，可直接写入缓存 |

#### 与 commit 的语义区别

| 操作 | 节点 id | data 写入位置 | 拓扑变化 |
|---|---|---|---|
| `commit(data)` | **新建** | 新节点 | 当前节点下新增子节点 |
| `remove(id, {mergeData})` | 不变 | **覆盖每个 child 的 data** | 拆掉一个节点 |
| `prune(id, {includeSelf?})` | 不变 | 不修改任何 data | 拆掉整棵子树，或只清空指定节点的后代 |
| `compact({mergeData})` | 不变（保留的子节点） | **覆盖保留节点的 data** | 拆掉所有"线性中间节点" |
| `loadFromSnapshot(snapshot)` | **全部替换为快照中的 id** | 全部替换为快照中的 data | 整棵树被替换 |

### mergeData 失败的原子性

`mergeData` 由调用方提供，框架无法假设它一定成功——差量合并器遇到非法 patch、深合并遇到不兼容结构都可能抛错。若不定义失败语义，多子节点 `remove` 会出现"前两个 child 已写回、第三个抛错"的半成品状态，`compact` 更会留下"压缩了一半"的树。

**统一契约：所有破坏性操作都是全有或全无。任一 `mergeData` 调用抛错时，树状态与调用前完全一致，原始错误原样向上抛出，且不触发 `onChange`。**

#### remove：先算后写

```
阶段 1（只读）：对每个 child 依次调用 mergeData，结果存入临时数组
              ↓ 任一次抛错 → 直接抛出，此时尚未修改任何节点，树天然不变
阶段 2（写入）：临时数组统一写回 child.data
阶段 3（拓扑）：改 parentId / childrenIds、删节点、回退 currentId
阶段 4（通知）：触发一次 onChange
```

阶段 1 完成后不再有调用方代码参与，阶段 2/3 只做确定性的内存写入，不会失败。因此"先算后写"就足以保证原子性，不需要额外的回滚机制。

#### compact：整体事务

`compact` 会连续处理多个候选节点，第 N 个候选的 `mergeData` 抛错时，前 N-1 个的合并结果已经写进树里了——单靠"先算后写"救不回来（候选集合本身依赖前一轮的合并结果，无法提前全部算完）。因此 `compact` 采用**快照回滚**：

```
1. 开始前用内部 buildSnapshot() 备份整棵树（与 getSnapshot 同一套逻辑）
2. 逐候选执行 removeNode（每个候选内部仍遵循"先算后写"）
3. 任一步抛错 → 用备份快照整体还原 nodes / currentId，向上抛出原始错误，不触发 onChange
4. 全部成功 → 触发一次 onChange
```

这条回滚路径与公开的 `loadFromSnapshot` 复用同一套内部还原逻辑，不重复实现。

#### prune 不涉及

`prune` 不接受 `mergeData`，全程没有调用方代码参与，所有前置校验通过后剩余步骤都是确定性内存操作，天然满足原子性。

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

#### 仅删除选中节点的后代（保留选中节点）

```ts
tree.prune('4', { includeSelf: false })
// 返回 ['5', '9', '8']（后序 DFS，不包含 '4'）
// v4 被保留，v4.childrenIds 从 ['5', '8'] 变为 []

// includeSelf: false 允许传 rootId，用于清空整棵树的非根节点
tree.prune(rootId, { includeSelf: false })
// root 保留，所有非根节点被删除
```

如果 `includeSelf: false` 且目标节点没有后代，`prune` 返回 `[]`，不触发 `onChange`。

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

最终：v3 的 **id 不变**，data 等价于 `mergeData(mergeData(v1.data, v2.data), v3.data)`；返回 `['1', '2']`（被合并删除的节点 id 列表）

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

#### compact 与 remove 的关系

`compact` 复用 `remove` 的**拓扑与合并逻辑**，但不复用它的**通知行为**。实现上必须把公开 `remove` 拆成两层：

```ts
// 内部核心：只改树，不通知
function removeNode(nodeId: string, options?: RemoveOptions): void { /* 校验 + 先算后写 + 改拓扑 */ }

// 公开 API：核心逻辑 + 一次通知
remove(nodeId, options) {
  removeNode(nodeId, options)
  notifyListeners({ type: 'remove', ... })
}

// compact：多次核心逻辑 + 一次通知
compact(options) {
  const backup = buildSnapshot()
  try {
    for (const candidate of candidates) removeNode(candidate, options)
  }
  catch (error) {
    restoreFromSnapshot(backup)   // 整体回滚
    throw error
  }
  if (merged.length > 0) notifyListeners({ type: 'compact', ... })
}
```

**实现者注意：`compact` 不能循环调用公开的 `remove`。**每次公开 `remove` 都会触发一次 `onChange`，循环调用会让一次 `compact` 发出 N 次通知，直接违反"合并节点数 > 0 时 **一次** onChange"的契约，也会让监听器看到中间态的树。

## 快照加载语义

`loadFromSnapshot(snapshot)` 用一份快照整体替换实例状态。它不属于破坏性操作（不删除"历史"，而是换掉整段历史），但与本 RFC 强相关：破坏性操作不可逆，调用方需要一条回滚路径。

### 两个使用场景

```ts
// 场景 1：跨会话持久化恢复
const tree = createHistoryTree<DocState>({ initialData: EMPTY_DOC })
const saved = localStorage.getItem('doc-history')
if (saved) {
  tree.loadFromSnapshot(JSON.parse(saved))
}
tree.onChange(snapshot => localStorage.setItem('doc-history', JSON.stringify(snapshot)))

// 场景 2：破坏性操作前备份 + 失败/取消时回滚
const backup = tree.getSnapshot()
try {
  tree.compact({ mergeData: mergePatch })
}
catch (error) {
  tree.loadFromSnapshot(backup) // 还原到 compact 之前
  throw error
}
```

> 场景 2 中 `compact` 自身已经保证了原子性（内部会自动回滚），这里的外层备份用于覆盖更大范围的多步操作，例如"`prune` 若干分支 + `compact`"整体作为一个用户可撤销的动作。

### 快照校验规则

`loadFromSnapshot` 会在写入前完整校验快照结构。**任一项不通过即抛错，当前树完全不受影响**（校验在临时结构上进行，通过后才替换实例状态）：

| # | 校验项 | 不通过时的错误 |
| --- | --- | --- |
| 1 | `snapshot` 是对象，且 `rootId` / `currentId` / `nodes` 字段齐备 | `Invalid snapshot: missing required field "xxx"` |
| 2 | `nodes[rootId]` 存在，且其 `parentId === null` | `Invalid snapshot: root node "xxx" does not exist` / `Invalid snapshot: root node "xxx" must have null parentId` |
| 3 | `nodes[currentId]` 存在 | `Invalid snapshot: current node "xxx" does not exist` |
| 4 | 除 root 外每个节点的 `parentId` 非 null 且指向存在的节点 | `Invalid snapshot: node "xxx" references missing parent "yyy"` |
| 5 | 每个节点的 `childrenIds` 均指向存在的节点 | `Invalid snapshot: node "xxx" references missing child "yyy"` |
| 6 | `parentId` 与 `childrenIds` **双向一致**（`child.parentId === parent.id` ⟺ `child.id ∈ parent.childrenIds`） | `Invalid snapshot: inconsistent link between "xxx" and "yyy"` |
| 7 | 有且只有一个 `parentId === null` 的节点 | `Invalid snapshot: multiple root nodes found` |
| 8 | 从 root 出发能遍历到全部节点（无环、无孤儿） | `Invalid snapshot: node "xxx" is unreachable from root` |

校验 6 覆盖了大部分手写快照的错误；校验 8 用一次从 root 的 DFS 同时排除环与孤儿——遍历到的节点数等于 `nodes` 总数即通过。整体复杂度 O(n)。

**不校验的部分**：节点的 `data` 内容。这延续 RFC 01"框架对存储语义无感"的立场——框架不知道 T 应该长什么样。

### id 生成器与快照的关系

这是本方法最容易踩的坑。RFC 01 的默认 `generateId` 是**从 0 开始的自增计数器**，而快照里的节点 id 通常就是 `"0"`、`"1"`、`"2"`……加载后如果计数器不动，下一次 `commit` 会生成 `"0"`，撞上快照里已有的根节点 id，触发 RFC 01 既有的 `Duplicate node id` 抛错。

**约定：使用内置默认 `generateId` 时，`loadFromSnapshot` 会自动把计数器推进到 `max(可解析为非负整数的 id) + 1`。**

```ts
// 快照节点 id 为 "0", "1", "2", "5"
tree.loadFromSnapshot(snapshot)
tree.commit(data) // → "6"，不冲突
```

细则：

- 只统计能被解析为**非负整数**的 id（`"0"`、`"12"`）；`"a"`、`"1.5"`、`"-1"`、`"01"` 等一律忽略
- 没有任何可解析 id 时，计数器保持不变
- 计数器**只推进不后退**：加载一份 id 更小的旧快照，不会把计数器调低，避免与本会话已发出的 id 冲突
- 调用方传了自定义 `generateId` 时，框架**不做任何干预**——唯一性本来就是调用方的责任（RFC 01 已明确）。自定义生成器若不是全局唯一的（例如同样基于自增），调用方需自行处理跨快照的冲突

### 对 rootId 的影响

当前 `core.ts` 中 `rootId` 是闭包内的 `const`，`loadFromSnapshot` 要求把它改为 `let`。这是本 RFC 对 RFC 01 **实现**的唯一改动，`HistoryTree<T>` 的公开契约不变（`getRoot()` / `getSnapshot().rootId` 行为一致，只是取值来源变成可变量）。

外部若缓存了 `getRoot().id`，需要在 `event.type === 'load'` 时刷新——`event.removedNodes` 包含旧树全部节点（含旧 root），足以驱动清理。

- **差量场景必传 mergeData**：框架不检测、不保护。不传 → 数据链一定断
- **mergeData 必须是纯函数**：不可有副作用；同样的输入必须返回同样的输出。compact 处理多个候选时是 **fold-left 风格的串联累积**——每次 `mergeData` 的输入是已被前面步骤覆盖过的 data，调用方实现需对这种累积保持稳定（典型如 patch 串接、深合并等天然满足）
- **mergeData 抛错是安全的**：任一破坏性操作在 `mergeData` 抛错时都保证树状态不变、不触发 `onChange`，错误原样抛出。调用方可以放心让合并器 fail fast，不需要在 `mergeData` 内部吞错来"保护"树
- **外部持有的节点 id**：`remove` / `prune` / `compact` 都会让被删节点的 id 失效。业务层在外部缓存了 id 时，可以先调用 `previewRemove` / `previewPrune` / `previewCompact` 预估影响范围，也可以在 `onChange` 中根据 `event.removedNodes` 同步清理、根据 `event.affectedNodes` 刷新缓存，或用 `keep` 保护关键节点
- **别混用 preview 与 event 的时态**：`preview*` 给的是**操作前**快照，只适合"这次会动到哪些节点"的影响面评估与二次确认弹窗；要把新值写进外部缓存，必须用 `onChange` 的 `event.affectedNodes`（**操作后**快照）。拿 `preview*` 的结果去刷新缓存会写回过期 data
- **`loadFromSnapshot` 会丢弃当前树**：没有内建确认或合并机制。需要保留当前内容时，调用方自己先 `getSnapshot()` 备份
- **快照的 data 是浅引用**：`loadFromSnapshot` 深拷贝的是树的拓扑结构，`node.data` 按引用原样存放（与 `commit` 的"原样存储"一致）。调用方若在加载后改动原快照对象里的 data，会直接影响树中的数据
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
| `prune` 传入根节点 id 且 `includeSelf !== false` | `throwError('history-tree', 'Cannot prune root node')` | `[@cmtlyt/lingshu-toolkit#history-tree]: Cannot prune root node` |
| `prune` 当前节点位于子树且策略为 `throw` | `throwError('history-tree', 'Current node "${currentId}" is in pruned subtree of "${nodeId}"')` | `[@cmtlyt/lingshu-toolkit#history-tree]: Current node "xxx" is in pruned subtree of "yyy"` |
| `loadFromSnapshot` 快照结构非法 | `throwError('history-tree', 'Invalid snapshot: ...')` | `[@cmtlyt/lingshu-toolkit#history-tree]: Invalid snapshot: <8 条校验规则对应的具体原因>` |

> `compact` 内部执行 `removeNode` 时产生的校验错误，按 remove 的错误信息抛出。
>
> **`mergeData` 自身抛出的错误不被包装**：框架原样向上抛出调用方的错误对象（保留 stack 与自定义错误类型），只保证抛出前树状态已恢复。这与 `throwError` 的框架错误是两类，调用方 `catch` 时可按 `instanceof` 区分。

## 测试策略

### 新增测试用例（#18–#75，共 **58 条**；连同 RFC 01 已有的 17 条，模块总计 **75 条**）

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
| 30 | **remove - previewRemove** | 返回被删除节点、父节点、子节点的**操作前**快照；不修改树、不触发 onChange |
| 31 | **remove - onChange event** | `event.removedNodes` 为被删节点的操作前快照；`event.affectedNodes` 为父节点与各 child 的操作后快照 |
| 32 | **prune - 叶子节点** | 父节点 childrenIds 不含被删 id，size -1 |
| 33 | **prune - 中间节点** | 所有后代被删；返回值为**后序 DFS** 顺序的 id 列表 |
| 34 | **prune - includeSelf false** | 仅删除目标节点的后代，目标节点保留且 childrenIds 清空 |
| 35 | **prune - includeSelf false 且无后代** | 返回 []，不触发 onChange |
| 36 | **prune - includeSelf false 允许 rootId** | root 保留，所有非根节点被删除 |
| 37 | **prune - currentId 在子树内（默认 parent）** | includeSelf true 时 currentId 回退到被删根节点的父；includeSelf false 时回退到 nodeId |
| 38 | **prune - currentId 在子树内（root 策略）** | currentId 回退到 rootId |
| 39 | **prune - currentId 在子树内（throw 策略）** | 抛错，currentId 与树状态不变 |
| 40 | **prune - currentId 不在子树内** | currentId 保持不变 |
| 41 | **prune - 根节点抛错** | 调用 `tree.prune(rootId)` 抛错且不修改树 |
| 42 | **prune - 节点不存在抛错** | 错误信息匹配 |
| 43 | **prune - 触发 onChange 一次** | 有节点被删除时一次调用只通知一次 |
| 44 | **prune - previewPrune** | 返回被删除节点和被修改 childrenIds 的保留节点；不修改树、不触发 onChange |
| 45 | **prune - onChange event** | `event.removedNodes` 为本次被删节点的操作前快照；`event.affectedNodes` 为被修改 childrenIds 的保留节点的**操作后**快照 |
| 46 | **compact - 合并线性链（不传 mergeData）** | 中间节点被删，子节点 data 不变（适合全量场景） |
| 47 | **compact - 合并线性链（传 mergeData）** | 验证 mergeData 被按"父先子后"的顺序对每个被合并节点调用 |
| 48 | **compact - 不合并 root** | root 即使只有 1 个子节点也保留 |
| 49 | **compact - 不合并 current** | current 永远保留 |
| 50 | **compact - 不合并分叉节点** | >1 子节点不参与合并 |
| 51 | **compact - 不合并叶子** | 0 子节点不参与合并 |
| 52 | **compact - keep 保护** | keep 返回 true 的节点不被合并 |
| 53 | **compact - 无可合并节点** | 返回 [] 且不触发 onChange |
| 54 | **compact - 触发 onChange 一次** | 有合并发生时一次调用只通知一次 |
| 55 | **compact - 返回被合并节点列表** | 返回 root-to-leaf 顺序的被删节点 id 列表 |
| 56 | **compact - 合并后 parent/child 关系正确** | 被提升的子节点 parentId 与 grandparent.childrenIds 顺序均正确 |
| 57 | **compact - 候选按 root-to-leaf 顺序处理** | 构造 v0 ── v1 ── v2 ── v3(current) 线性链，传入 mergeData 记录调用次序与参数；验证第一次调用参数为 (v1.data, v2.data)，第二次为 (mergeData 第一次的返回值, v3.data) |
| 58 | **compact - previewCompact** | 返回候选节点、候选 child、候选 parent 的操作前快照；不修改树、不触发 onChange |
| 59 | **compact - onChange event** | `event.removedNodes` 为被合并节点的操作前快照；`event.affectedNodes` 为保留节点的**操作后**快照（data 已是合并结果） |
| 60 | **节点修改策略 - id 稳定** | remove / compact 后保留节点的 id 不变；compact 整条线性链合并后，最末端保留节点的 id 与合并前一致 |
| 61 | **节点修改策略 - data 原地覆盖** | mergeData 返回值直接写入保留节点的 data；getSnapshot 在 compact 前后取得的 snapshot 中，保留节点 id 相同但 data 不同 |
| 62 | **差量场景集成测试** | 模拟 patch 存储 + 多次 commit + compact + 从 root 重放 → 验证状态与未 compact 时一致 |
| 63 | **原子性 - remove 的 mergeData 抛错** | 构造多子节点场景，mergeData 在第 2 个 child 抛错；验证树（含第 1 个 child 的 data）与调用前**完全一致**、不触发 onChange、抛出的是调用方原始错误对象 |
| 64 | **原子性 - compact 的 mergeData 抛错整体回滚** | 构造多候选线性链，mergeData 在第 2 个候选抛错；验证已合并的第 1 个候选被还原、`size` / 拓扑 / currentId 与调用前一致、不触发 onChange |
| 65 | **原子性 - mergeData 抛错后树仍可用** | 承接 #63，抛错后继续正常 commit / remove，验证内部状态没有被残留的临时数据污染 |
| 66 | **event 时态 - affectedNodes 为操作后快照** | remove 传 mergeData 后，`event.affectedNodes` 中 child 的 `data` 是**合并后**的新值、`parentId` 是**新**父节点；与同参数 `previewRemove` 的对应节点 data 不同 |
| 67 | **event 时态 - id 集合与 preview 一致** | `event.removedNodes ∪ event.affectedNodes` 的 id 集合等于 `previewRemove` / `previewPrune` / `previewCompact` 返回的 id 集合 |
| 68 | **event - commit / checkout 语义** | commit 的 `affectedNodes` 为 [新节点, 父节点] 且 `removedNodes` 为 []；checkout 的两个字段均为 [] |
| 69 | **loadFromSnapshot - 整体替换** | 加载另一棵树的快照后，`rootId` / `currentId` / `size` / 全部节点均与快照一致；旧节点 id 调 `getNode` 抛"不存在" |
| 70 | **loadFromSnapshot - 触发 onChange** | 触发一次，`event.type === 'load'`；`removedNodes` 为旧树全部节点，`affectedNodes` 为新树全部节点 |
| 71 | **loadFromSnapshot - id 计数器推进** | 加载含 id `"0","1","2","5"` 的快照后 `commit` 返回 `"6"`；不抛 Duplicate node id |
| 72 | **loadFromSnapshot - 计数器只推进不后退** | 先 commit 到 `"9"`，再加载只含 `"0","1"` 的快照，验证后续 commit 不会产出 `"2"` 这类已用过的小 id |
| 73 | **loadFromSnapshot - 非数字 id 与自定义 generateId** | 加载 id 为 `"a","b"` 的快照时计数器保持不变；传了自定义 generateId 时框架完全不干预 |
| 74 | **loadFromSnapshot - 校验失败树不变** | 参数化覆盖"快照校验规则"8 条：缺字段 / rootId 不存在 / currentId 不存在 / 缺 parent / 缺 child / 双向链接不一致 / 多个 root / 存在环或孤儿；每条均验证抛错信息匹配且**当前树完全不变**、不触发 onChange |
| 75 | **loadFromSnapshot - 破坏后回滚集成测试** | `getSnapshot` 备份 → `prune` + `compact` → `loadFromSnapshot(backup)` → 验证树与备份时**逐节点一致**（含 currentId），且能继续正常 commit |

## 文件改动规划

| 文件 | 改动 |
| --- | --- |
| `src/shared/history-tree/types.ts` | `HistoryTree<T>` 接口新增 `remove` / `prune` / `compact` 三个破坏性方法、`previewRemove` / `previewPrune` / `previewCompact` 三个检测方法、`loadFromSnapshot` 快照加载方法，以及 `HistoryTreeChangeEvent<T>` 类型 |
| `src/shared/history-tree/core.ts` | 实现上述方法；复用 `getNodeOrThrow` 与 `buildSnapshot`；拆出内部 `removeNode`（不通知）与 `restoreFromSnapshot`（供 compact 回滚与 loadFromSnapshot 共用）；`notifyListeners` 扩展为接收可选 event 参数；`rootId` 由 `const` 改为 `let`；默认 `generateId` 的计数器需支持外部推进 |
| `src/shared/history-tree/index.mdx` | 文档新增"破坏性操作"与"快照持久化 / 回滚"章节；强调差量场景的 mergeData 必传、includeSelf 语义、preview 与 event 的时态差异、快照加载的 id 冲突约定 |
| `src/shared/history-tree/__test__/history-tree.node.test.ts` | 追加 58 条新测试用例（#18–#75） |
| `src/shared/history-tree/__docs__/rfcs/02-history-tree-destructive-ops/IMPLEMENTATION.md` | RFC 通过后另起实施清单 |

## 关键设计取舍小结

| 取舍 | 决策 | 理由 |
| --- | --- | --- |
| 单点删除是否提供 | **是** | cmtlyt 评审指出"删一个节点 = 子节点提升"是自然语义；之前"歧义"论证不成立 |
| 数据合并由谁决定 | **调用方** | 框架对全量/差量无感（继承 RFC 01 立场），调用方传 mergeData 显式表达语义 |
| 差量场景不传 mergeData 是否报错 | **不报错** | 框架无法判断"全量 vs 差量"，强制报错会让全量场景被迫传无意义函数；通过 JSDoc + RFC 警告把责任明确给调用方 |
| compact 与 remove 关系 | **compact 委托内部 `removeNode`，不调用公开 `remove`** | 避免重复实现；compact 只负责"决定合并谁"，"怎么合并"沿用 remove 的核心逻辑。公开 `remove` 自带通知，循环调用会发出 N 次 onChange 并暴露中间态，违反"一次通知"契约 |
| 合并后修改节点还是新建节点 | **原地修改保留节点的 data，id 不变** | id 稳定避免外部引用失效；不引入与 commit 并列的"合并提交"概念；调用方有"用合并结果新建节点"的需求时可显式 prune + commit 表达 |
| compact 多候选时处理顺序 | **root-to-leaf** | 保证 mergeData 按"父先子后" fold-left 累积；对结合律合并器结果相同，对非结合律情形结果可预测 |
| remove 多子节点时 mergeData 调用次数 | **每个 child 各 1 次** | 差量场景下每个 child 都需要被删节点的 patch 前置才能保持从根可重算 |
| prune 是否提供 mergeData | **否** | 整棵子树都被丢弃，"合并到谁"无语义；调用方有汇总需求应在外部 getSnapshot 处理后再调 prune |
| prune 是否删除选中节点 | **默认删除，`includeSelf: false` 时保留** | 兼顾"删除整棵分支"与"清空某节点后代"两个场景；`includeSelf: false` 时允许传 rootId 用于清空非根节点 |
| compact 返回值 | **返回被合并删除的节点 id 列表** | 调用方可直接清理外部引用；空数组同时表达"无变化" |
| 是否提供检测方法 | **提供 `previewRemove` / `previewPrune` / `previewCompact`** | 让调用方在破坏前确认影响范围；无影响返回 []，便于 UI 二次确认或外部缓存预清理 |
| onChange event | **提供可选第二参数** | 保持旧 listener 兼容，同时在破坏性操作后暴露 removedNodes / affectedNodes，满足外部引用清理需求 |
| onChange 在 0 变更时是否触发 | **不触发** | `prune(includeSelf:false)` 无后代、`compact` 无候选时都无状态变化 → 无意义通知；与 checkout-self 仍触发的既有不对称是有意的前向改进 |
| preview 与 event 的快照时态 | **preview 为操作前，`affectedNodes` 为操作后，`removedNodes` 为操作前** | preview 在操作前调用，物理上取不到操作后状态；而 `affectedNodes` 的用途就是刷新外部缓存，给操作前快照会让调用方写回过期 data；被删节点已不存在，只能给操作前快照 |
| mergeData 抛错的语义 | **全有或全无，错误原样上抛，不触发 onChange** | 半成品状态在差量场景下会直接损坏数据链且无法察觉；remove 用"先算后写"、compact 用快照回滚，两者代价都可接受 |
| compact 回滚的实现方式 | **复用 `loadFromSnapshot` 的内部还原逻辑** | 已经要为 `loadFromSnapshot` 实现一套快照 → 内部状态的还原，回滚直接复用，不额外引入撤销栈 |
| 是否提供 `loadFromSnapshot` | **提供** | 破坏性操作不可逆，调用方需要备份/回滚路径；长会话场景也需要跨会话持久化恢复。二者是同一个能力，没必要拆成两个 API |
| `loadFromSnapshot` 是否限制 rootId 一致 | **不限制，允许完整替换** | 限制为"仅本实例回滚"会让持久化恢复场景失效（新会话的实例 rootId 必然对不上）；代价只是把 `rootId` 从 `const` 改为 `let` |
| 加载后的 id 冲突处理 | **自动推进内置计数器到 `max(数字 id)+1`，只推进不后退** | 默认 `generateId` 是自增计数器，不推进会在下一次 commit 直接撞 id；调用方零负担。自定义 generateId 的唯一性责任按 RFC 01 仍归调用方 |
| 是否校验快照结构 | **校验，8 条规则，失败时树不变** | 非法快照写进去会让整棵树进入不可预期状态，且错误会在很久之后才以别的形式暴露；一次从 root 的 DFS 即可完成，O(n) 代价可接受。`data` 内容仍不校验（框架对存储语义无感） |

## 开放问题

- 是否需要在 `createHistoryTree` 配置中加 `storageMode: 'full' | 'diff'`，从而让框架在差量模式下强制 mergeData？倾向不加——增加主入口配置项的复杂度换不来太多保护；调用方自己清楚自己的存储模式
- 是否提供"批量破坏性操作 + 单次通知"的事务 API（如 `batch(() => { ... })`）？目前每个方法内部已合并通知；跨方法的事务批处理属于后续话题。有了 `loadFromSnapshot` 后，调用方已经可以用"备份 + try/catch + 回滚"手动表达跨方法事务，只是通知次数无法合并
- 是否需要 `createHistoryTree({ snapshot })` 这样的工厂入参，省去"先建空树再 load"的两步？倾向不加——`loadFromSnapshot` 已经覆盖该场景，加入参会让 `HistoryTreeOptions` 变成互斥联合类型，主入口复杂度上升
- `loadFromSnapshot` 是否该有一个"不触发 onChange"的静默模式？例如初始化时从 localStorage 恢复，此时通知可能触发不必要的持久化写回。目前倾向不加——调用方可以在注册 listener 之前先 load
