import { throwError } from '@/shared/throw-error';
import type { HistoryNodeInfo } from './types';

export const MODULE_NAME = 'history-tree';

export interface HistoryNode<T> {
  id: string;
  data: T;
  parentId: string | null;
  childrenIds: string[];
}

/** 内置 id 生成器，额外暴露 advanceTo 供 loadFromSnapshot 推进计数器 */
export interface DefaultGenerateId {
  (): string;
  advanceTo: (next: number) => void;
}

export function createDefaultGenerateId(): DefaultGenerateId {
  let counter = 0;
  const generateId = () => String(counter++);
  generateId.advanceTo = (next: number) => {
    if (next > counter) {
      counter = next;
    }
  };
  return generateId;
}

export function toNodeInfo<T>(node: HistoryNode<T>): HistoryNodeInfo<T> {
  return {
    id: node.id,
    data: node.data,
    parentId: node.parentId,
    childrenIds: [...node.childrenIds],
  };
}

export function getNodeOrThrow<T>(nodes: Map<string, HistoryNode<T>>, nodeId: string): HistoryNode<T> {
  const node = nodes.get(nodeId);
  if (!node) {
    throwError(MODULE_NAME, `Node "${nodeId}" does not exist`);
  }
  return node;
}

/** 前序遍历（root-to-leaf），保证父节点总排在自己的后代之前 */
export function walkPreOrder(startId: string, getChildrenIds: (nodeId: string) => readonly string[]): string[] {
  const result: string[] = [];
  const stack = [startId];

  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    result.push(nodeId);
    const childrenIds = getChildrenIds(nodeId);
    for (let index = childrenIds.length - 1; index >= 0; index--) {
      stack.push(childrenIds[index]);
    }
  }

  return result;
}

/** 后序遍历（子先父后），迭代实现避免深链爆栈：children 正序入栈得到逆后序，整体反转即为后序 */
export function walkPostOrder(startId: string, getChildrenIds: (nodeId: string) => readonly string[]): string[] {
  const result: string[] = [];
  const stack = [startId];

  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    result.push(nodeId);
    for (const childId of getChildrenIds(nodeId)) {
      stack.push(childId);
    }
  }

  return result.reverse();
}
