import { throwError } from '@/shared/throw-error';
import type { DefaultGenerateId, HistoryNode } from './helpers';
import { createDefaultGenerateId, getNodeOrThrow, MODULE_NAME, toNodeInfo, walkPostOrder, walkPreOrder } from './helpers';
import { validateSnapshot } from './snapshot';
import type {
  HistoryNodeInfo,
  HistoryTree,
  HistoryTreeChangeEvent,
  HistoryTreeCompactOptions,
  HistoryTreeOptions,
  HistoryTreePruneOptions,
  HistoryTreeRemoveOptions,
  HistoryTreeSnapshot,
} from './types';

/** 可解析为非负整数的 id，用于加载快照后推进内置计数器（"01" / "-1" / "1.5" / "a" 均不匹配） */
const NON_NEGATIVE_INTEGER = /^(?:0|[1-9]\d*)$/u;

/** 遍历拓扑时只需要的最小节点形态，让 compact 的候选判定能同时作用于真实节点与模拟副本 */
interface TopologyEntry {
  parentId: string | null;
  childrenIds: string[];
}

type ChangeListener<T> = (snapshot: HistoryTreeSnapshot<T>, event?: HistoryTreeChangeEvent<T>) => void;

/** 实例的全部可变状态；闭包只负责持有它，具体操作由下方各函数完成 */
interface TreeState<T> {
  nodes: Map<string, HistoryNode<T>>;
  listeners: Set<ChangeListener<T>>;
  generateId: () => string;
  /** 调用方传了自定义 generateId 时为 null，此时框架不干预 id 生成 */
  builtinGenerateId: DefaultGenerateId | null;
  rootId: string;
  currentId: string;
}

function nodeInfoById<T>(state: TreeState<T>, nodeId: string) {
  return toNodeInfo(state.nodes.get(nodeId)!);
}

function allNodeInfos<T>(state: TreeState<T>) {
  return [...state.nodes.values()].map((node) => toNodeInfo(node));
}

function buildSnapshot<T>(state: TreeState<T>): HistoryTreeSnapshot<T> {
  // 无原型对象：节点 id 为 "__proto__" 时普通字面量的赋值会走原型 setter 导致节点静默丢失
  const snapshotNodes: Record<string, HistoryNodeInfo<T>> = Object.create(null);
  for (const [id, node] of state.nodes) {
    snapshotNodes[id] = toNodeInfo(node);
  }
  return { rootId: state.rootId, currentId: state.currentId, nodes: snapshotNodes };
}

/** 事件负载通过工厂惰性构建，无监听器时不产生任何快照与 event 构造开销 */
function notifyListeners<T>(state: TreeState<T>, getEvent: () => HistoryTreeChangeEvent<T>): void {
  if (state.listeners.size === 0) {
    return;
  }
  const snapshot = buildSnapshot(state);
  const event = getEvent();
  for (const listener of state.listeners) {
    listener(snapshot, event);
  }
}

/** 用快照覆盖内部状态，供 compact 回滚与 loadFromSnapshot 共用；不校验、不通知 */
function restoreFromSnapshot<T>(state: TreeState<T>, snapshot: HistoryTreeSnapshot<T>): void {
  state.nodes.clear();
  for (const [id, info] of Object.entries(snapshot.nodes)) {
    state.nodes.set(id, {
      id: info.id,
      data: info.data,
      parentId: info.parentId,
      childrenIds: [...info.childrenIds],
    });
  }
  state.rootId = snapshot.rootId;
  state.currentId = snapshot.currentId;
}

/** remove / previewRemove 共用的前置校验 */
function assertRemovable<T>(
  state: TreeState<T>,
  nodeId: string,
  removeOptions?: HistoryTreeRemoveOptions<T>,
): HistoryNode<T> {
  const target = getNodeOrThrow(state.nodes, nodeId);
  if (nodeId === state.rootId) {
    throwError(MODULE_NAME, 'Cannot remove root node');
  }
  if (state.currentId === nodeId && removeOptions?.onCurrentDeleted === 'throw') {
    throwError(MODULE_NAME, `Current node "${state.currentId}" is the target of remove`);
  }
  return target;
}

/**
 * remove 的核心逻辑：只改树不通知，供公开 remove 与 compact 共用
 * 采用「先算后写」：mergeData 全部算完才写回，任一次抛错时树尚未被修改
 */
function removeNode<T>(state: TreeState<T>, nodeId: string, removeOptions?: HistoryTreeRemoveOptions<T>) {
  const target = assertRemovable(state, nodeId, removeOptions);
  const removed = toNodeInfo(target);
  const childrenIds = [...target.childrenIds];

  const mergeData = removeOptions?.mergeData;
  const mergedData = mergeData
    ? childrenIds.map((childId) => mergeData(target.data, state.nodes.get(childId)!.data))
    : null;

  if (mergedData) {
    childrenIds.forEach((childId, index) => {
      state.nodes.get(childId)!.data = mergedData[index];
    });
  }

  const parentId = target.parentId!;
  const parent = state.nodes.get(parentId)!;
  parent.childrenIds.splice(parent.childrenIds.indexOf(nodeId), 1, ...childrenIds);
  for (const childId of childrenIds) {
    state.nodes.get(childId)!.parentId = parentId;
  }
  state.nodes.delete(nodeId);

  if (state.currentId === nodeId) {
    state.currentId =
      removeOptions?.onCurrentDeleted === 'first-child' && childrenIds.length > 0 ? childrenIds[0] : parentId;
  }

  return { removed, affectedIds: [parentId, ...childrenIds] };
}

/** prune / previewPrune 共用的前置校验与被删集合计算（后序 DFS） */
function collectPruneTargets<T>(state: TreeState<T>, nodeId: string, pruneOptions?: HistoryTreePruneOptions) {
  const target = getNodeOrThrow(state.nodes, nodeId);
  const includeSelf = pruneOptions?.includeSelf !== false;
  if (includeSelf && nodeId === state.rootId) {
    throwError(MODULE_NAME, 'Cannot prune root node');
  }

  const getChildrenIds = (id: string) => state.nodes.get(id)!.childrenIds;
  const removedIds = includeSelf
    ? walkPostOrder(nodeId, getChildrenIds)
    : target.childrenIds.flatMap((childId) => walkPostOrder(childId, getChildrenIds));

  if (removedIds.includes(state.currentId) && pruneOptions?.onCurrentDeleted === 'throw') {
    throwError(MODULE_NAME, `Current node "${state.currentId}" is in pruned subtree of "${nodeId}"`);
  }

  // includeSelf 为 false 时 nodeId 自己就是保留者，回退策略与 affectedNodes 都指向它
  const survivorId = includeSelf ? target.parentId! : nodeId;
  return { target, includeSelf, removedIds, survivorId };
}

/**
 * 找出下一个 compact 候选：非根、非当前、恰好 1 个子节点、未被 keep 保护
 * 按 root-to-leaf 顺序返回第一个命中者，调用方每合并一个就重新扫描，直到没有候选
 */
function findCompactCandidate<T>(
  state: TreeState<T>,
  getEntry: (nodeId: string) => TopologyEntry,
  keep?: (node: HistoryNodeInfo<T>) => boolean,
): string | undefined {
  return walkPreOrder(state.rootId, (nodeId) => getEntry(nodeId).childrenIds).find((nodeId) => {
    if (nodeId === state.rootId || nodeId === state.currentId) {
      return false;
    }
    const entry = getEntry(nodeId);
    if (entry.childrenIds.length !== 1) {
      return false;
    }
    const info: HistoryNodeInfo<T> = {
      id: nodeId,
      data: state.nodes.get(nodeId)!.data,
      parentId: entry.parentId,
      childrenIds: [...entry.childrenIds],
    };
    return !keep?.(info);
  });
}

/** 在拓扑副本上模拟 compact，供 previewCompact 取得受影响节点而不触碰真实树 */
function simulateCompact<T>(state: TreeState<T>, keep?: (node: HistoryNodeInfo<T>) => boolean) {
  const topology = new Map<string, TopologyEntry>();
  for (const [id, node] of state.nodes) {
    topology.set(id, { parentId: node.parentId, childrenIds: [...node.childrenIds] });
  }

  const candidateIds: string[] = [];
  const childIds: string[] = [];
  const parentIds: string[] = [];

  for (;;) {
    const candidateId = findCompactCandidate(state, (nodeId) => topology.get(nodeId)!, keep);
    if (candidateId === undefined) {
      break;
    }

    const entry = topology.get(candidateId)!;
    const [childId] = entry.childrenIds;
    const parentId = entry.parentId!;
    const parent = topology.get(parentId)!;
    parent.childrenIds.splice(parent.childrenIds.indexOf(candidateId), 1, childId);
    topology.get(childId)!.parentId = parentId;
    topology.delete(candidateId);

    candidateIds.push(candidateId);
    childIds.push(childId);
    parentIds.push(parentId);
  }

  return { candidateIds, childIds, parentIds };
}

function commitNode<T>(state: TreeState<T>, data: T): string {
  const newId = state.generateId();
  if (state.nodes.has(newId)) {
    throwError(MODULE_NAME, `Duplicate node id "${newId}"`);
  }

  const newNode: HistoryNode<T> = {
    id: newId,
    data,
    parentId: state.currentId,
    childrenIds: [],
  };

  const parentNode = state.nodes.get(state.currentId)!;
  parentNode.childrenIds.push(newId);
  state.nodes.set(newId, newNode);
  state.currentId = newId;

  notifyListeners(state, () => ({
    type: 'commit',
    removedNodes: [],
    affectedNodes: [toNodeInfo(newNode), toNodeInfo(parentNode)],
  }));
  return newId;
}

function checkoutNode<T>(state: TreeState<T>, nodeId: string): void {
  getNodeOrThrow(state.nodes, nodeId);
  state.currentId = nodeId;
  // checkout 只移动指针，没有任何节点的 data 或拓扑发生变化
  notifyListeners(state, () => ({ type: 'checkout', removedNodes: [], affectedNodes: [] }));
}

function collectPathData<T>(state: TreeState<T>): T[] {
  const result: T[] = [];
  let current: HistoryNode<T> | undefined = state.nodes.get(state.currentId);

  while (current) {
    result.push(current.data);
    current = current.parentId === null ? undefined : state.nodes.get(current.parentId);
  }

  return result;
}

function removeAndNotify<T>(state: TreeState<T>, nodeId: string, removeOptions?: HistoryTreeRemoveOptions<T>): void {
  const { removed, affectedIds } = removeNode(state, nodeId, removeOptions);
  notifyListeners(state, () => ({
    type: 'remove',
    removedNodes: [removed],
    affectedNodes: affectedIds.map((id) => nodeInfoById(state, id)),
  }));
}

function previewRemoveNodes<T>(
  state: TreeState<T>,
  nodeId: string,
  removeOptions?: HistoryTreeRemoveOptions<T>,
): HistoryNodeInfo<T>[] {
  const target = assertRemovable(state, nodeId, removeOptions);
  return [
    toNodeInfo(target),
    nodeInfoById(state, target.parentId!),
    ...target.childrenIds.map((childId) => nodeInfoById(state, childId)),
  ];
}

function pruneAndNotify<T>(state: TreeState<T>, nodeId: string, pruneOptions?: HistoryTreePruneOptions): string[] {
  const { target, includeSelf, removedIds, survivorId } = collectPruneTargets(state, nodeId, pruneOptions);
  if (removedIds.length === 0) {
    return [];
  }

  // 操作前快照必须在删除发生前捕获，无监听器时省掉这份构建
  const removedNodes = state.listeners.size > 0 ? removedIds.map((id) => nodeInfoById(state, id)) : [];
  const currentRemoved = removedIds.includes(state.currentId);

  if (includeSelf) {
    const parent = state.nodes.get(survivorId)!;
    parent.childrenIds.splice(parent.childrenIds.indexOf(nodeId), 1);
  } else {
    target.childrenIds = [];
  }
  for (const id of removedIds) {
    state.nodes.delete(id);
  }

  if (currentRemoved) {
    state.currentId = pruneOptions?.onCurrentDeleted === 'root' ? state.rootId : survivorId;
  }

  notifyListeners(state, () => ({
    type: 'prune',
    removedNodes,
    affectedNodes: [nodeInfoById(state, survivorId)],
  }));
  return removedIds;
}

function previewPruneNodes<T>(
  state: TreeState<T>,
  nodeId: string,
  pruneOptions?: HistoryTreePruneOptions,
): HistoryNodeInfo<T>[] {
  const { removedIds, survivorId } = collectPruneTargets(state, nodeId, pruneOptions);
  if (removedIds.length === 0) {
    return [];
  }
  return [...removedIds.map((id) => nodeInfoById(state, id)), nodeInfoById(state, survivorId)];
}

/** 反复扫描并合并候选，任一 mergeData 抛错时用开始前的备份整体回滚 */
function runCompact<T>(state: TreeState<T>, compactOptions?: HistoryTreeCompactOptions<T>) {
  const backup = buildSnapshot(state);
  const mergedIds: string[] = [];
  const removedNodes: HistoryNodeInfo<T>[] = [];
  const affectedIds = new Set<string>();

  try {
    for (;;) {
      const candidateId = findCompactCandidate(state, (nodeId) => state.nodes.get(nodeId)!, compactOptions?.keep);
      if (candidateId === undefined) {
        break;
      }
      const { removed, affectedIds: ids } = removeNode(state, candidateId, { mergeData: compactOptions?.mergeData });
      mergedIds.push(candidateId);
      removedNodes.push(removed);
      for (const id of ids) {
        affectedIds.add(id);
      }
    }
  } catch (error) {
    // 全有或全无：已完成的合并整体还原，原样上抛调用方的错误，且不通知
    restoreFromSnapshot(state, backup);
    throw error;
  }

  return { mergedIds, removedNodes, affectedIds };
}

function compactAndNotify<T>(state: TreeState<T>, compactOptions?: HistoryTreeCompactOptions<T>): string[] {
  const { mergedIds, removedNodes, affectedIds } = runCompact(state, compactOptions);
  if (mergedIds.length === 0) {
    return [];
  }

  notifyListeners(state, () => {
    // 中途被记为受影响、随后又被合并掉的节点不再存在，只保留活着的
    const affectedNodes: HistoryNodeInfo<T>[] = [];
    for (const id of affectedIds) {
      const node = state.nodes.get(id);
      if (node) {
        affectedNodes.push(toNodeInfo(node));
      }
    }
    return { type: 'compact', removedNodes, affectedNodes };
  });
  return mergedIds;
}

function previewCompactNodes<T>(
  state: TreeState<T>,
  compactOptions?: HistoryTreeCompactOptions<T>,
): HistoryNodeInfo<T>[] {
  const { candidateIds, childIds, parentIds } = simulateCompact(state, compactOptions?.keep);
  if (candidateIds.length === 0) {
    return [];
  }
  const orderedIds = [...new Set([...candidateIds, ...childIds, ...parentIds])];
  return orderedIds.map((id) => nodeInfoById(state, id));
}

/** 内置计数器推进到 max(可解析为非负整数的 id) + 1，只推进不后退；自定义生成器不干预 */
function advanceBuiltinGenerateId<T>(state: TreeState<T>): void {
  if (!state.builtinGenerateId) {
    return;
  }
  let maxNumericId = -1;
  for (const nodeId of state.nodes.keys()) {
    if (NON_NEGATIVE_INTEGER.test(nodeId)) {
      maxNumericId = Math.max(maxNumericId, Number(nodeId));
    }
  }
  if (maxNumericId >= 0) {
    state.builtinGenerateId.advanceTo(maxNumericId + 1);
  }
}

function loadSnapshot<T>(state: TreeState<T>, snapshot: HistoryTreeSnapshot<T>): void {
  validateSnapshot(snapshot);

  // 旧树快照必须在替换前捕获，无监听器时省掉两次 O(n) 构建
  const removedNodes = state.listeners.size > 0 ? allNodeInfos(state) : [];
  restoreFromSnapshot(state, snapshot);
  advanceBuiltinGenerateId(state);

  notifyListeners(state, () => ({ type: 'load', removedNodes, affectedNodes: allNodeInfos(state) }));
}

export function createHistoryTree<T>(options: HistoryTreeOptions<T>): HistoryTree<T> {
  // 只有使用内置生成器时才需要在加载快照后推进计数器；自定义生成器的唯一性由调用方负责
  const builtinGenerateId = options.generateId ? null : createDefaultGenerateId();
  const generateId = options.generateId ?? builtinGenerateId!;
  const rootId = generateId();
  const rootNode: HistoryNode<T> = {
    id: rootId,
    data: options.initialData,
    parentId: null,
    childrenIds: [],
  };

  const state: TreeState<T> = {
    nodes: new Map([[rootId, rootNode]]),
    listeners: new Set(),
    generateId,
    builtinGenerateId,
    rootId,
    currentId: rootId,
  };

  return {
    commit: (data) => commitNode(state, data),

    checkout: (nodeId) => checkoutNode(state, nodeId),

    getPathData: () => collectPathData(state),

    getCurrentNode: () => nodeInfoById(state, state.currentId),

    getNode: (nodeId) => toNodeInfo(getNodeOrThrow(state.nodes, nodeId)),

    getRoot: () => nodeInfoById(state, state.rootId),

    getSnapshot: () => buildSnapshot(state),

    onChange(listener) {
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    },

    remove: (nodeId, removeOptions) => removeAndNotify(state, nodeId, removeOptions),

    previewRemove: (nodeId, removeOptions) => previewRemoveNodes(state, nodeId, removeOptions),

    prune: (nodeId, pruneOptions) => pruneAndNotify(state, nodeId, pruneOptions),

    previewPrune: (nodeId, pruneOptions) => previewPruneNodes(state, nodeId, pruneOptions),

    compact: (compactOptions) => compactAndNotify(state, compactOptions),

    previewCompact: (compactOptions) => previewCompactNodes(state, compactOptions),

    loadFromSnapshot: (snapshot) => loadSnapshot(state, snapshot),

    get currentId(): string {
      return state.currentId;
    },

    get currentData(): T {
      return state.nodes.get(state.currentId)!.data;
    },

    get parentData(): T | null {
      const current = state.nodes.get(state.currentId)!;
      if (current.parentId === null) {
        return null;
      }
      return state.nodes.get(current.parentId)!.data;
    },

    get size(): number {
      return state.nodes.size;
    },
  };
}
