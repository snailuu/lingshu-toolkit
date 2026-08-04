import { throwError } from '@/shared/throw-error';
import type { HistoryNode } from './helpers';
import { getNodeOrThrow, MODULE_NAME, toNodeInfo } from './helpers';
import type { TreeState } from './state';
import { nodeInfoById, notifyListeners } from './state';
import type { HistoryNodeInfo, HistoryTreeRemoveOptions } from './types';

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
export function removeNode<T>(state: TreeState<T>, nodeId: string, removeOptions?: HistoryTreeRemoveOptions<T>) {
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

export function removeAndNotify<T>(
  state: TreeState<T>,
  nodeId: string,
  removeOptions?: HistoryTreeRemoveOptions<T>,
): void {
  const { removed, affectedIds } = removeNode(state, nodeId, removeOptions);
  notifyListeners(state, () => {
    return {
      type: 'remove',
      removedNodes: [removed],
      affectedNodes: affectedIds.map((id) => nodeInfoById(state, id)),
    };
  });
}

export function previewRemoveNodes<T>(
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
