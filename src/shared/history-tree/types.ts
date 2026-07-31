export interface HistoryTreeOptions<T> {
  /** 初始数据，将作为根节点（v0）的存储数据 */
  initialData: T;

  /**
   * 自定义节点 id 生成函数
   * 每次创建新节点时调用，返回值作为节点 id
   * 调用方需自行保证返回值的唯一性
   *
   * @default 内置自增数字转字符串（"0", "1", "2", ...）
   */
  generateId?: () => string;
}

export interface HistoryNodeInfo<T> {
  /** 节点唯一标识 */
  readonly id: string;

  /** 节点存储的数据 */
  readonly data: T;

  /** 父节点 id，根节点为 null */
  readonly parentId: string | null;

  /** 子节点 id 列表 */
  readonly childrenIds: readonly string[];
}

export interface HistoryTreeSnapshot<T> {
  /** 根节点 id */
  readonly rootId: string;

  /** 当前节点 id */
  readonly currentId: string;

  /** 所有节点信息，key 为节点 id */
  readonly nodes: Readonly<Record<string, HistoryNodeInfo<T>>>;
}

export interface HistoryTreeChangeEvent<T> {
  /** 触发本次变更的操作类型 */
  readonly type: 'commit' | 'checkout' | 'remove' | 'prune' | 'compact' | 'load';

  /**
   * 本次操作删除的节点，为**操作前**快照（节点已不在树中，取不到操作后状态）
   * commit / checkout 为空数组；load 为被替换掉的旧树的全部节点
   */
  readonly removedNodes: readonly HistoryNodeInfo<T>[];

  /**
   * 操作后**仍存在**的受影响节点，为**操作后**快照（data / parentId / childrenIds 均为新值）
   * 可直接用于刷新外部缓存，无节点受影响时为空数组
   */
  readonly affectedNodes: readonly HistoryNodeInfo<T>[];
}

/** 破坏性操作中被删节点 data 合并到留下节点的钩子，差量场景必传 */
export type HistoryTreeMergeData<T> = (removedData: T, survivorData: T) => T;

export interface HistoryTreeRemoveOptions<T> {
  /**
   * 把被删节点的 data 合并到每个子节点的纯函数，对每个子节点各调用一次
   * 差量场景**必传**，否则数据链会断；全量场景可省略，省略时被删节点的 data 直接丢弃
   */
  mergeData?: HistoryTreeMergeData<T>;

  /**
   * currentId 命中被删节点时的回退策略
   * - `'parent'`（默认）：回退到被删节点的 parentId
   * - `'first-child'`：切换到被删节点的首个子节点，无子节点时回退到 parentId
   * - `'throw'`：直接抛错
   */
  onCurrentDeleted?: 'parent' | 'first-child' | 'throw';
}

export interface HistoryTreePruneOptions {
  /** 是否删除 nodeId 本身，默认 true；为 false 时仅删除其全部后代 */
  includeSelf?: boolean;

  /**
   * currentId 落入被删子树时的回退策略
   * - `'parent'`（默认）：includeSelf 为 true 时回退到被删根节点的 parentId，为 false 时回退到 nodeId
   * - `'root'`：回退到 rootId
   * - `'throw'`：直接抛错
   */
  onCurrentDeleted?: 'parent' | 'root' | 'throw';
}

export interface HistoryTreeCompactOptions<T> {
  /** 数据合并函数，语义与 remove 完全一致；差量场景必传 */
  mergeData?: HistoryTreeMergeData<T>;

  /** 节点保护函数，返回 true 时该节点不会被合并 */
  keep?: (node: HistoryNodeInfo<T>) => boolean;
}

export interface HistoryTree<T> {
  /**
   * 提交新数据，在当前节点下创建子节点，并将指针移到新节点
   * 框架原样存储 data，不做任何处理
   *
   * @returns 新创建的节点 id
   */
  commit: (data: T) => string;

  /**
   * 切换当前指针到指定节点
   * 切换后可继续 commit 创建新分支
   *
   * @throws 节点不存在时抛出错误
   */
  checkout: (nodeId: string) => void;

  /**
   * 获取当前节点到根节点路径上所有节点的存储数据
   * 返回有序列表：[当前节点数据, 父节点数据, ..., 根节点数据]
   */
  getPathData: () => T[];

  /** 获取当前节点信息 */
  getCurrentNode: () => HistoryNodeInfo<T>;

  /**
   * 获取指定节点信息
   *
   * @throws 节点不存在时抛出错误
   */
  getNode: (nodeId: string) => HistoryNodeInfo<T>;

  /** 获取根节点信息 */
  getRoot: () => HistoryNodeInfo<T>;

  /** 获取整棵树的快照，包含所有节点信息、根节点 id 和当前节点 id */
  getSnapshot: () => HistoryTreeSnapshot<T>;

  /**
   * 注册变更监听器，当 commit / checkout / remove / prune / compact / load 导致树状态变化时触发
   * 第一个参数为最新的快照，第二个参数为可选事件对象，只接收 snapshot 的旧监听器无需修改
   *
   * 快照时态：`event.removedNodes` 是操作前快照，`event.affectedNodes` 是操作后快照
   * 两者的 id 并集等于对应 `preview*` 方法返回的 id 集合
   *
   * @returns 取消订阅函数
   */
  onChange: (listener: (snapshot: HistoryTreeSnapshot<T>, event?: HistoryTreeChangeEvent<T>) => void) => () => void;

  /**
   * 【破坏性操作】单点删除：从树中删除 nodeId，其所有子节点提升到 nodeId 的父节点下，
   * 并占据 nodeId 在父节点 childrenIds 中的原位置（保持顺序）
   *
   * 采用「先算后写」：mergeData 全部调用完成后才写回数据，任一次抛错都保证树状态与调用前完全一致、
   * 不触发 onChange，且原样上抛调用方的错误对象
   *
   * @throws 节点不存在、传入根节点 id、或 currentId 命中且策略为 'throw' 时抛出
   */
  remove: (nodeId: string, options?: HistoryTreeRemoveOptions<T>) => void;

  /**
   * 【非破坏检测】预览 remove 会影响的所有节点，返回**操作前**的节点快照
   * 返回顺序：被删除节点 → 父节点 → 各子节点（按 childrenIds 顺序）
   * 校验规则与 remove 一致；不调用 mergeData，不修改树，不触发 onChange
   */
  previewRemove: (nodeId: string, options?: HistoryTreeRemoveOptions<T>) => HistoryNodeInfo<T>[];

  /**
   * 【破坏性操作】子树删除：默认删除指定节点及其全部后代；
   * includeSelf 为 false 时只删除全部后代并保留指定节点本身（此时允许传 rootId）
   *
   * 不接受 mergeData——整棵子树都被丢弃，"合并到谁"无语义可言
   *
   * @returns 被删除的节点 id 列表（**后序 DFS**：先访问全部后代再访问自身）；无节点被删除时返回 []
   *
   * @throws 节点不存在、includeSelf 非 false 时传入根节点 id、或 currentId 落入被删集合且策略为 'throw' 时抛出
   */
  prune: (nodeId: string, options?: HistoryTreePruneOptions) => string[];

  /**
   * 【非破坏检测】预览 prune 会影响的所有节点，返回**操作前**的节点快照
   * 返回顺序：被删除节点（后序 DFS）→ 被修改 childrenIds 的保留节点（父节点或 nodeId）
   * 无节点会被删除时返回 []；校验规则与 prune 一致；不修改树，不触发 onChange
   */
  previewPrune: (nodeId: string, options?: HistoryTreePruneOptions) => HistoryNodeInfo<T>[];

  /**
   * 【破坏性操作】批量压缩：反复扫描整棵树，把所有"线性中间节点"合并掉，直到没有候选为止
   *
   * 合并候选需同时满足：非根节点、非当前节点、恰好只有 1 个子节点、`keep` 未返回 true
   * 候选按 **root-to-leaf** 顺序处理，保证 mergeData 按"父先子后"累积
   *
   * 原子性：整体是全有或全无的事务，任一候选的 mergeData 抛错时已完成的合并会被整体还原，
   * 原样上抛错误且不触发 onChange
   *
   * @returns 本次合并掉的节点 id 列表（root-to-leaf 顺序）；为空数组时不触发 onChange
   */
  compact: (options?: HistoryTreeCompactOptions<T>) => string[];

  /**
   * 【非破坏检测】预览 compact 会影响的所有节点，返回**操作前**的节点快照
   * 返回顺序：被合并删除的候选节点（root-to-leaf 顺序）→ 各候选的子节点 → 各候选的父节点，整体去重
   * 无候选节点时返回 []；不调用 mergeData，不修改树，不触发 onChange
   *
   * 注意：因为不调用 mergeData，`keep` 在 preview 中只能看到**操作前**的 data；
   * 真实 compact 中候选被检查时其 data 可能已被前序合并覆盖。
   * `keep` 的判断若依赖 data 内容，preview 与真实 compact 的候选集可能不一致
   */
  previewCompact: (options?: HistoryTreeCompactOptions<T>) => HistoryNodeInfo<T>[];

  /**
   * 【整体替换】用快照替换当前实例的 rootId、currentId 与全部节点，实例引用本身保持不变
   * 覆盖"跨会话持久化恢复"与"破坏性操作前备份 / 失败回滚"两个场景
   *
   * 校验在写入前完成，任一项不通过即抛错且当前树完全不受影响
   * 节点的 data 不被校验或转换，按引用原样存放（与 commit 的"原样存储"一致）
   * 使用内置 generateId 时，加载后计数器会推进到 `max(可解析为非负整数的 id) + 1`，只推进不后退
   *
   * @throws 快照结构非法时抛出（缺字段、rootId / currentId 不存在、父子链接不一致、多个根、存在环或孤儿）
   */
  loadFromSnapshot: (snapshot: HistoryTreeSnapshot<T>) => void;

  /** 获取当前节点的 id */
  readonly currentId: string;

  /** 获取当前节点的存储数据（getter） */
  readonly currentData: T;

  /** 获取当前节点的父节点存储数据（getter），根节点无父节点时返回 null */
  readonly parentData: T | null;

  /** 获取树中所有节点的数量（getter，代理内部 nodes Map 的 size） */
  readonly size: number;
}
