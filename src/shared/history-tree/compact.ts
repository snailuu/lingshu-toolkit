import { toNodeInfo, walkPreOrder } from './helpers';
import { removeNode } from './remove';
import type { TreeState } from './state';
import { buildSnapshot, nodeInfoById, notifyListeners, restoreFromSnapshot } from './state';
import type { HistoryNodeInfo, HistoryTreeCompactOptions } from './types';

/** 遍历拓扑时只需要的最小节点形态，让候选判定能同时作用于真实节点与模拟副本 */
interface TopologyEntry {
  parentId: string | null;
  childrenIds: string[];
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

/** 反复扫描并合并候选，任一 mergeData 抛错时用开始前的备份整体回滚 */
function runCompact<T>(state: TreeState<T>, compactOptions?: HistoryTreeCompactOptions<T>) {
  const backup = buildSnapshot(state);
  const mergedIds: string[] = [];
  const affectedIds = new Set<string>();

  try {
    for (;;) {
      const candidateId = findCompactCandidate(state, (nodeId) => state.nodes.get(nodeId)!, compactOptions?.keep);
      if (candidateId === undefined) {
        break;
      }
      const { affectedIds: ids } = removeNode(state, candidateId, { mergeData: compactOptions?.mergeData });
      mergedIds.push(candidateId);
      for (const id of ids) {
        affectedIds.add(id);
      }
    }
  } catch (error) {
    // 全有或全无：已完成的合并整体还原，原样上抛调用方的错误，且不通知
    restoreFromSnapshot(state, backup);
    throw error;
  }

  // 从开始前的备份取被删节点：removeNode 当场返回的快照，其 data 可能已被前一个候选的
  // mergeData 覆盖，而 removedNodes 的时态基准是整个 compact 调用之前
  return { mergedIds, removedNodes: mergedIds.map((id) => backup.nodes[id]), affectedIds };
}

export function compactAndNotify<T>(state: TreeState<T>, compactOptions?: HistoryTreeCompactOptions<T>): string[] {
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

export function previewCompactNodes<T>(
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
