import { throwError } from '@/shared/throw-error';
import { getNodeOrThrow, MODULE_NAME, walkPostOrder } from './helpers';
import type { TreeState } from './state';
import { nodeInfoById, notifyListeners } from './state';
import type { HistoryNodeInfo, HistoryTreePruneOptions } from './types';

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

export function pruneAndNotify<T>(
  state: TreeState<T>,
  nodeId: string,
  pruneOptions?: HistoryTreePruneOptions,
): string[] {
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

  notifyListeners(state, () => {
    return {
      type: 'prune',
      removedNodes,
      affectedNodes: [nodeInfoById(state, survivorId)],
    };
  });
  return removedIds;
}

export function previewPruneNodes<T>(
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
