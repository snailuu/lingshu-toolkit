import { throwError } from '@/shared/throw-error';
import { compactAndNotify, previewCompactNodes } from './compact';
import type { HistoryNode } from './helpers';
import { createDefaultGenerateId, getNodeOrThrow, MODULE_NAME, toNodeInfo } from './helpers';
import { loadSnapshot } from './load';
import { previewPruneNodes, pruneAndNotify } from './prune';
import { previewRemoveNodes, removeAndNotify } from './remove';
import type { TreeState } from './state';
import { buildSnapshot, nodeInfoById, notifyListeners } from './state';
import type { HistoryTree, HistoryTreeOptions } from './types';

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

  notifyListeners(state, () => {
    return {
      type: 'commit',
      removedNodes: [],
      affectedNodes: [toNodeInfo(newNode), toNodeInfo(parentNode)],
    };
  });
  return newId;
}

function checkoutNode<T>(state: TreeState<T>, nodeId: string): void {
  getNodeOrThrow(state.nodes, nodeId);
  state.currentId = nodeId;
  // checkout 只移动指针，没有任何节点的 data 或拓扑发生变化
  notifyListeners(state, () => {
    return { type: 'checkout', removedNodes: [], affectedNodes: [] };
  });
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
