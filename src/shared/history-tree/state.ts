import type { DefaultGenerateId, HistoryNode } from './helpers';
import { toNodeInfo } from './helpers';
import type { HistoryNodeInfo, HistoryTreeChangeEvent, HistoryTreeSnapshot } from './types';

export type ChangeListener<T> = (snapshot: HistoryTreeSnapshot<T>, event?: HistoryTreeChangeEvent<T>) => void;

/** 实例的全部可变状态；创建时由工厂持有，各操作模块只接收它作为第一个参数 */
export interface TreeState<T> {
  nodes: Map<string, HistoryNode<T>>;
  listeners: Set<ChangeListener<T>>;
  generateId: () => string;
  /** 调用方传了自定义 generateId 时为 null，此时框架不干预 id 生成 */
  builtinGenerateId: DefaultGenerateId | null;
  rootId: string;
  currentId: string;
}

export function nodeInfoById<T>(state: TreeState<T>, nodeId: string) {
  return toNodeInfo(state.nodes.get(nodeId)!);
}

export function allNodeInfos<T>(state: TreeState<T>) {
  return [...state.nodes.values()].map((node) => toNodeInfo(node));
}

export function buildSnapshot<T>(state: TreeState<T>): HistoryTreeSnapshot<T> {
  // 无原型对象：节点 id 为 "__proto__" 时普通字面量的赋值会走原型 setter 导致节点静默丢失
  const snapshotNodes: Record<string, HistoryNodeInfo<T>> = Object.create(null);
  for (const [id, node] of state.nodes) {
    snapshotNodes[id] = toNodeInfo(node);
  }
  return { rootId: state.rootId, currentId: state.currentId, nodes: snapshotNodes };
}

/** 事件负载通过工厂惰性构建，无监听器时不产生任何快照与 event 构造开销 */
export function notifyListeners<T>(state: TreeState<T>, getEvent: () => HistoryTreeChangeEvent<T>): void {
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
export function restoreFromSnapshot<T>(state: TreeState<T>, snapshot: HistoryTreeSnapshot<T>): void {
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
