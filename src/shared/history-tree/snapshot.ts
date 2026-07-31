import { throwError } from '@/shared/throw-error';
import { MODULE_NAME, walkPreOrder } from './helpers';
import type { HistoryTreeSnapshot } from './types';

function assertSnapshotShape<T>(snapshot: HistoryTreeSnapshot<T>): void {
  const source = snapshot as unknown as Record<string, unknown> | null | undefined;
  for (const field of ['rootId', 'currentId', 'nodes'] as const) {
    const value = source && typeof source === 'object' ? source[field] : undefined;
    if (value === undefined || value === null) {
      throwError(MODULE_NAME, `Invalid snapshot: missing required field "${field}"`);
    }
  }

  // 快照可能来自 JSON.parse 的不可信输入，存在性一律用 hasOwn 判断，
  // 防止 "constructor" 等原型链键被误判为存在的节点
  const { rootId, currentId, nodes } = snapshot;
  if (!Object.hasOwn(nodes, rootId)) {
    throwError(MODULE_NAME, `Invalid snapshot: root node "${rootId}" does not exist`);
  }
  if (nodes[rootId].parentId !== null) {
    throwError(MODULE_NAME, `Invalid snapshot: root node "${rootId}" must have null parentId`);
  }
  if (!Object.hasOwn(nodes, currentId)) {
    throwError(MODULE_NAME, `Invalid snapshot: current node "${currentId}" does not exist`);
  }
}

/** 先排除"多个根"，否则非根节点的 parentId 为 null 会被误报成缺失父节点 */
function assertSingleRoot<T>(snapshot: HistoryTreeSnapshot<T>): void {
  const { rootId, nodes } = snapshot;
  for (const nodeId of Object.keys(nodes)) {
    if (nodeId !== rootId && nodes[nodeId].parentId === null) {
      throwError(MODULE_NAME, 'Invalid snapshot: multiple root nodes found');
    }
  }
}

function assertReferencesExist<T>(snapshot: HistoryTreeSnapshot<T>): void {
  const { nodes } = snapshot;
  for (const nodeId of Object.keys(nodes)) {
    const node = nodes[nodeId];
    if (node.parentId !== null && !Object.hasOwn(nodes, node.parentId)) {
      throwError(MODULE_NAME, `Invalid snapshot: node "${nodeId}" references missing parent "${node.parentId}"`);
    }
    for (const childId of node.childrenIds) {
      if (!Object.hasOwn(nodes, childId)) {
        throwError(MODULE_NAME, `Invalid snapshot: node "${nodeId}" references missing child "${childId}"`);
      }
    }
  }
}

/** 双向一致性；错误信息中第一个 id 恒为父节点，第二个恒为子节点 */
function assertBidirectionalLinks<T>(snapshot: HistoryTreeSnapshot<T>): void {
  const { nodes } = snapshot;
  for (const nodeId of Object.keys(nodes)) {
    const node = nodes[nodeId];
    for (const childId of node.childrenIds) {
      if (nodes[childId].parentId !== nodeId) {
        throwError(MODULE_NAME, `Invalid snapshot: inconsistent link between "${nodeId}" and "${childId}"`);
      }
    }
    if (node.parentId !== null && !nodes[node.parentId].childrenIds.includes(nodeId)) {
      throwError(MODULE_NAME, `Invalid snapshot: inconsistent link between "${node.parentId}" and "${nodeId}"`);
    }
  }
}

/**
 * 一次从 root 出发的遍历同时排除环与孤儿：能遍历到的节点数等于总数即通过
 * 双向一致性已保证每个节点只有一个父节点，因此可达范围内不可能成环，遍历必然终止
 */
function assertReachableFromRoot<T>(snapshot: HistoryTreeSnapshot<T>): void {
  const { rootId, nodes } = snapshot;
  const nodeIds = Object.keys(nodes);
  const reachable = new Set(walkPreOrder(rootId, (nodeId) => nodes[nodeId].childrenIds));
  if (reachable.size !== nodeIds.length) {
    const unreachableId = nodeIds.find((nodeId) => !reachable.has(nodeId))!;
    throwError(MODULE_NAME, `Invalid snapshot: node "${unreachableId}" is unreachable from root`);
  }
}

/**
 * 校验快照结构，任一项不通过即抛错
 * 只做拓扑校验，不校验 node.data —— 框架对存储语义无感
 */
export function validateSnapshot<T>(snapshot: HistoryTreeSnapshot<T>): void {
  assertSnapshotShape(snapshot);
  assertSingleRoot(snapshot);
  assertReferencesExist(snapshot);
  assertBidirectionalLinks(snapshot);
  assertReachableFromRoot(snapshot);
}
