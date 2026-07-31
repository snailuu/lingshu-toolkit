import { describe, expect, test, vi } from 'vitest';
import { createHistoryTree } from '../core';
import type { HistoryTreeSnapshot } from '../types';

describe('history-tree - 基础提交', () => {
  test('创建树后根节点数据正确', () => {
    const tree = createHistoryTree({ initialData: { x: 0 } });
    expect(tree.currentData).toEqual({ x: 0 });
    expect(tree.size).toBe(1);
    expect(tree.parentData).toBeNull();
  });

  test('连续 commit 创建线性链', () => {
    const tree = createHistoryTree({ initialData: 'v0' });
    const id1 = tree.commit('v1');
    const id2 = tree.commit('v2');

    expect(tree.size).toBe(3);
    expect(tree.currentData).toBe('v2');

    const node2 = tree.getNode(id2);
    expect(node2.parentId).toBe(id1);

    const node1 = tree.getNode(id1);
    expect(node1.childrenIds).toEqual([id2]);

    const root = tree.getRoot();
    expect(root.childrenIds).toEqual([id1]);
  });
});

describe('history-tree - 分支创建', () => {
  test('checkout 到中间节点后 commit 创建分支', () => {
    const tree = createHistoryTree({ initialData: 'v0' });
    const id1 = tree.commit('v1');
    tree.commit('v2');

    tree.checkout(id1);
    const id3 = tree.commit('v3');

    const node1 = tree.getNode(id1);
    expect(node1.childrenIds).toHaveLength(2);
    expect(tree.currentId).toBe(id3);
    expect(tree.currentData).toBe('v3');
  });
});

describe('history-tree - 复杂分支拓扑（v0~v9）', () => {
  test('还原 RFC 示例中的完整分支拓扑', () => {
    const tree = createHistoryTree({ initialData: 'd0' });
    const id1 = tree.commit('d1');
    const id2 = tree.commit('d2');

    tree.checkout(id1);
    const id3 = tree.commit('d3');
    const id4 = tree.commit('d4');
    const id5 = tree.commit('d5');

    tree.checkout(id2);
    const id6 = tree.commit('d6');

    tree.checkout(id3);
    const id7 = tree.commit('d7');

    tree.checkout(id4);
    const id8 = tree.commit('d8');
    const id9 = tree.commit('d9');

    expect(tree.size).toBe(10);

    expect(tree.getRoot().childrenIds).toEqual([id1]);
    expect(tree.getNode(id1).childrenIds).toEqual([id2, id3]);
    expect(tree.getNode(id2).childrenIds).toEqual([id6]);
    expect(tree.getNode(id3).childrenIds).toEqual([id4, id7]);
    expect(tree.getNode(id4).childrenIds).toEqual([id5, id8]);
    expect(tree.getNode(id5).childrenIds).toEqual([]);
    expect(tree.getNode(id6).childrenIds).toEqual([]);
    expect(tree.getNode(id7).childrenIds).toEqual([]);
    expect(tree.getNode(id8).childrenIds).toEqual([id9]);
    expect(tree.getNode(id9).childrenIds).toEqual([]);

    expect(tree.getNode(id3).parentId).toBe(id1);
    expect(tree.getNode(id7).parentId).toBe(id3);
    expect(tree.getNode(id8).parentId).toBe(id4);
    expect(tree.getNode(id6).parentId).toBe(id2);
  });
});

describe('history-tree - 路径回溯', () => {
  test('getPathData 返回从当前节点到根的有序列表', () => {
    const tree = createHistoryTree({ initialData: 'd0' });
    const id1 = tree.commit('d1');
    const id2 = tree.commit('d2');

    tree.checkout(id1);
    tree.commit('d3');
    const id4 = tree.commit('d4');

    tree.checkout(id4);
    tree.commit('d8');
    tree.commit('d9');

    expect(tree.getPathData()).toEqual(['d9', 'd8', 'd4', 'd3', 'd1', 'd0']);

    tree.checkout(id2);
    const id6 = tree.commit('d6');
    tree.checkout(id6);
    expect(tree.getPathData()).toEqual(['d6', 'd2', 'd1', 'd0']);
  });
});

describe('history-tree - 节点查询', () => {
  test('getCurrentNode 返回当前节点信息', () => {
    const tree = createHistoryTree({ initialData: 'root' });
    tree.commit('child');

    const current = tree.getCurrentNode();
    expect(current.data).toBe('child');
    expect(current.parentId).toBe(tree.getRoot().id);
  });

  test('getNode 返回指定节点信息', () => {
    const tree = createHistoryTree({ initialData: 'root' });
    const id = tree.commit('child');

    const node = tree.getNode(id);
    expect(node.id).toBe(id);
    expect(node.data).toBe('child');
  });

  test('getRoot 返回根节点', () => {
    const tree = createHistoryTree({ initialData: 'root' });
    tree.commit('child');

    const root = tree.getRoot();
    expect(root.data).toBe('root');
    expect(root.parentId).toBeNull();
  });
});

describe('history-tree - 错误处理', () => {
  test('checkout 不存在的节点抛错', () => {
    const tree = createHistoryTree({ initialData: 'root' });
    expect(() => tree.checkout('non-existent')).toThrow(
      '[@cmtlyt/lingshu-toolkit#history-tree]: Node "non-existent" does not exist',
    );
  });

  test('getNode 不存在的节点抛错', () => {
    const tree = createHistoryTree({ initialData: 'root' });
    expect(() => tree.getNode('non-existent')).toThrow(
      '[@cmtlyt/lingshu-toolkit#history-tree]: Node "non-existent" does not exist',
    );
  });
});

describe('history-tree - size 计数', () => {
  test('commit 后 size 正确递增', () => {
    const tree = createHistoryTree({ initialData: 'v0' });
    expect(tree.size).toBe(1);

    tree.commit('v1');
    expect(tree.size).toBe(2);

    tree.commit('v2');
    expect(tree.size).toBe(3);
  });
});

describe('history-tree - currentData getter', () => {
  test('commit 后 currentData 更新', () => {
    const tree = createHistoryTree({ initialData: 'v0' });
    expect(tree.currentData).toBe('v0');

    tree.commit('v1');
    expect(tree.currentData).toBe('v1');
  });

  test('checkout 后 currentData 更新', () => {
    const tree = createHistoryTree({ initialData: 'v0' });
    tree.commit('v1');
    const rootId = tree.getRoot().id;

    tree.checkout(rootId);
    expect(tree.currentData).toBe('v0');
  });
});

describe('history-tree - parentData getter', () => {
  test('根节点的 parentData 为 null', () => {
    const tree = createHistoryTree({ initialData: 'root' });
    expect(tree.parentData).toBeNull();
  });

  test('子节点的 parentData 返回父节点数据', () => {
    const tree = createHistoryTree({ initialData: 'root' });
    tree.commit('child');
    expect(tree.parentData).toBe('root');
  });

  test('checkout 后 parentData 跟随变化', () => {
    const tree = createHistoryTree({ initialData: 'v0' });
    const id1 = tree.commit('v1');
    tree.commit('v2');

    expect(tree.parentData).toBe('v1');

    tree.checkout(id1);
    expect(tree.parentData).toBe('v0');
  });
});

describe('history-tree - 自定义 id 生成', () => {
  test('传入 generateId 后节点使用自定义 id', () => {
    let counter = 100;
    const tree = createHistoryTree({
      initialData: 'root',
      generateId: () => `node-${counter++}`,
    });

    expect(tree.currentId).toBe('node-100');

    const id1 = tree.commit('v1');
    expect(id1).toBe('node-101');

    const id2 = tree.commit('v2');
    expect(id2).toBe('node-102');
  });
});

describe('history-tree - 重复 id 检测', () => {
  test('generateId 返回重复 id 时抛错', () => {
    let called = false;
    const tree = createHistoryTree({
      initialData: 'root',
      generateId: () => {
        if (!called) {
          called = true;
          return 'unique-root';
        }
        return 'unique-root';
      },
    });

    expect(() => tree.commit('v1')).toThrow('[@cmtlyt/lingshu-toolkit#history-tree]: Duplicate node id "unique-root"');
  });
});

describe('history-tree - 边界情况', () => {
  test('只有根节点时 getPathData 返回单元素列表', () => {
    const tree = createHistoryTree({ initialData: 'only-root' });
    expect(tree.getPathData()).toEqual(['only-root']);
  });

  test('checkout 到当前节点不抛错', () => {
    const tree = createHistoryTree({ initialData: 'root' });
    const currentId = tree.currentId;
    expect(() => tree.checkout(currentId)).not.toThrow();
    expect(tree.currentId).toBe(currentId);
  });
});

describe('history-tree - getSnapshot', () => {
  test('返回包含所有节点的快照', () => {
    const tree = createHistoryTree({ initialData: 'v0' });
    const id1 = tree.commit('v1');
    tree.commit('v2');

    const snapshot = tree.getSnapshot();
    expect(snapshot.rootId).toBe(tree.getRoot().id);
    expect(snapshot.currentId).toBe(tree.currentId);
    expect(Object.keys(snapshot.nodes)).toHaveLength(3);
    expect(snapshot.nodes[id1].data).toBe('v1');
  });

  test('快照中 childrenIds 为副本，修改不影响原树', () => {
    const tree = createHistoryTree({ initialData: 'v0' });
    tree.commit('v1');

    const snapshot = tree.getSnapshot();
    const rootNode = snapshot.nodes[snapshot.rootId];
    const childrenCopy = [...rootNode.childrenIds];
    expect(childrenCopy).toHaveLength(1);

    // 原树提交新节点
    tree.commit('v2');
    // 之前的快照不应变化
    expect(rootNode.childrenIds).toHaveLength(1);
  });

  test('id 为 "__proto__" 等原型链键的节点在快照中不丢失', () => {
    const ids = ['r', '__proto__'];
    let index = 0;
    const tree = createHistoryTree<string>({ initialData: 'd0', generateId: () => ids[index++] });
    tree.commit('d1');

    const snapshot = tree.getSnapshot();
    const nodeEntries = Object.entries(snapshot.nodes);
    expect(nodeEntries.map(([id]) => id)).toEqual(['r', '__proto__']);
    expect(nodeEntries.find(([id]) => id === '__proto__')?.[1].data).toBe('d1');
  });
});

describe('history-tree - onChange', () => {
  test('commit 后触发 onChange 回调', () => {
    const tree = createHistoryTree({ initialData: 'v0' });
    const listener = vi.fn();
    tree.onChange(listener);

    tree.commit('v1');

    expect(listener).toHaveBeenCalledTimes(1);
    const snapshot = listener.mock.calls[0][0];
    expect(snapshot.currentId).toBe(tree.currentId);
    expect(Object.keys(snapshot.nodes)).toHaveLength(2);
  });

  test('checkout 后触发 onChange 回调', () => {
    const tree = createHistoryTree({ initialData: 'v0' });
    tree.commit('v1');

    const listener = vi.fn();
    tree.onChange(listener);

    const rootId = tree.getRoot().id;
    tree.checkout(rootId);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].currentId).toBe(rootId);
  });

  test('多个 listener 均被通知', () => {
    const tree = createHistoryTree({ initialData: 'v0' });
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    tree.onChange(listenerA);
    tree.onChange(listenerB);

    tree.commit('v1');

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  test('取消订阅后不再触发', () => {
    const tree = createHistoryTree({ initialData: 'v0' });
    const listener = vi.fn();
    const unsubscribe = tree.onChange(listener);

    tree.commit('v1');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    tree.commit('v2');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

/**
 * 构建 RFC 的 v0~v9 拓扑，current 停在 v9
 *
 * ```text
 * v0 ── v1 ──┬── v2 ── v6
 *            └── v3 ──┬── v4 ──┬── v5
 *                     │        └── v8 ── v9
 *                     └── v7
 * ```
 */
function createSampleTree() {
  const tree = createHistoryTree<string>({ initialData: 'd0' });
  const v1 = tree.commit('d1');
  const v2 = tree.commit('d2');

  tree.checkout(v1);
  const v3 = tree.commit('d3');
  const v4 = tree.commit('d4');
  const v5 = tree.commit('d5');

  tree.checkout(v2);
  const v6 = tree.commit('d6');

  tree.checkout(v3);
  const v7 = tree.commit('d7');

  tree.checkout(v4);
  const v8 = tree.commit('d8');
  const v9 = tree.commit('d9');

  return { tree, v0: tree.getRoot().id, v1, v2, v3, v4, v5, v6, v7, v8, v9 };
}

/**
 * 构建 compact 演示拓扑，current 停在 c5
 *
 * ```text
 * c0 ── c1 ── c2 ── c3 ──┬── c4
 *                        └── c5（current）
 * ```
 */
function createCompactTree() {
  const tree = createHistoryTree<string>({ initialData: 'd0' });
  const c1 = tree.commit('d1');
  const c2 = tree.commit('d2');
  const c3 = tree.commit('d3');
  const c4 = tree.commit('d4');

  tree.checkout(c3);
  const c5 = tree.commit('d5');

  return { tree, c0: tree.getRoot().id, c1, c2, c3, c4, c5 };
}

/** 构建纯线性链 l0 ── l1 ── l2 ── l3（current） */
function createLinearTree() {
  const tree = createHistoryTree<string>({ initialData: 'd0' });
  const l1 = tree.commit('d1');
  const l2 = tree.commit('d2');
  const l3 = tree.commit('d3');

  return { tree, l0: tree.getRoot().id, l1, l2, l3 };
}

const joinData = (removedData: string, survivorData: string) => `${removedData}+${survivorData}`;

describe('history-tree - remove 单点删除', () => {
  test('删除叶子节点后父节点 childrenIds 移除该 id 且不调用 mergeData', () => {
    const { tree, v4, v5, v8 } = createSampleTree();
    const mergeData = vi.fn(joinData);

    tree.remove(v5, { mergeData });

    expect(tree.getNode(v4).childrenIds).toEqual([v8]);
    expect(tree.size).toBe(9);
    expect(mergeData).not.toHaveBeenCalled();
  });

  test('删除单子节点中间节点后子节点提升且 mergeData 调用一次', () => {
    const { tree, v4, v5, v8, v9 } = createSampleTree();
    const mergeData = vi.fn(joinData);

    tree.remove(v8, { mergeData });

    expect(tree.getNode(v9).parentId).toBe(v4);
    expect(tree.getNode(v4).childrenIds).toEqual([v5, v9]);
    expect(mergeData).toHaveBeenCalledTimes(1);
    expect(mergeData).toHaveBeenCalledWith('d8', 'd9');
  });

  test('删除多子节点中间节点后子节点按原顺序占据被删位置', () => {
    const { tree, v1, v2, v3, v4, v7 } = createSampleTree();
    const mergeData = vi.fn(joinData);

    tree.remove(v3, { mergeData });

    expect(tree.getNode(v1).childrenIds).toEqual([v2, v4, v7]);
    expect(tree.getNode(v4).parentId).toBe(v1);
    expect(tree.getNode(v7).parentId).toBe(v1);
    expect(mergeData).toHaveBeenCalledTimes(2);
    expect(mergeData).toHaveBeenNthCalledWith(1, 'd3', 'd4');
    expect(mergeData).toHaveBeenNthCalledWith(2, 'd3', 'd7');
  });

  test('不传 mergeData 时子节点 data 保持不变', () => {
    const { tree, v3, v4, v7 } = createSampleTree();

    tree.remove(v3);

    expect(tree.getNode(v4).data).toBe('d4');
    expect(tree.getNode(v7).data).toBe('d7');
  });

  test('差量场景下 mergeData 返回值写回子节点 data', () => {
    interface Patch {
      ops: string[];
    }
    const tree = createHistoryTree<Patch>({ initialData: { ops: [] } });
    tree.commit({ ops: ['+x'] });
    const p2 = tree.commit({ ops: ['+y'] });
    const p3 = tree.commit({ ops: ['+z'] });

    tree.remove(p2, {
      mergeData: (removed, child) => {
        return { ops: [...removed.ops, ...child.ops] };
      },
    });

    expect(tree.getNode(p3).data).toEqual({ ops: ['+y', '+z'] });
  });

  test('currentId 命中时默认回退到父节点', () => {
    const { tree, v1, v3 } = createSampleTree();
    tree.checkout(v3);

    tree.remove(v3);

    expect(tree.currentId).toBe(v1);
  });

  test('currentId 命中且策略为 first-child 时切到首个子节点', () => {
    const { tree, v3, v4 } = createSampleTree();
    tree.checkout(v3);

    tree.remove(v3, { onCurrentDeleted: 'first-child' });

    expect(tree.currentId).toBe(v4);
  });

  test('currentId 命中且策略为 first-child 但无子节点时回退到父节点', () => {
    const { tree, v4, v5 } = createSampleTree();
    tree.checkout(v5);

    tree.remove(v5, { onCurrentDeleted: 'first-child' });

    expect(tree.currentId).toBe(v4);
  });

  test('currentId 命中且策略为 throw 时抛错且树状态不变', () => {
    const { tree, v3 } = createSampleTree();
    tree.checkout(v3);
    const before = tree.getSnapshot();

    expect(() => tree.remove(v3, { onCurrentDeleted: 'throw' })).toThrow(
      `[@cmtlyt/lingshu-toolkit#history-tree]: Current node "${v3}" is the target of remove`,
    );
    expect(tree.getSnapshot()).toEqual(before);
  });

  test('删除根节点抛错且树状态不变', () => {
    const { tree, v0 } = createSampleTree();
    const before = tree.getSnapshot();

    expect(() => tree.remove(v0)).toThrow('[@cmtlyt/lingshu-toolkit#history-tree]: Cannot remove root node');
    expect(tree.getSnapshot()).toEqual(before);
  });

  test('删除不存在的节点抛错', () => {
    const { tree } = createSampleTree();

    expect(() => tree.remove('non-existent')).toThrow(
      '[@cmtlyt/lingshu-toolkit#history-tree]: Node "non-existent" does not exist',
    );
  });

  test('一次 remove 只触发一次 onChange', () => {
    const { tree, v3 } = createSampleTree();
    const listener = vi.fn();
    tree.onChange(listener);

    tree.remove(v3, { mergeData: joinData });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('previewRemove 返回操作前快照且不修改树、不触发 onChange', () => {
    const { tree, v1, v3, v4, v7 } = createSampleTree();
    const listener = vi.fn();
    tree.onChange(listener);
    const before = tree.getSnapshot();

    const preview = tree.previewRemove(v3, { mergeData: joinData });

    expect(preview.map((node) => node.id)).toEqual([v3, v1, v4, v7]);
    expect(preview[0].childrenIds).toEqual([v4, v7]);
    expect(preview[2].parentId).toBe(v3);
    expect(preview[2].data).toBe('d4');
    expect(tree.getSnapshot()).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test('onChange 事件中 removedNodes 为操作前快照、affectedNodes 为操作后快照', () => {
    const { tree, v1, v2, v3, v4, v7 } = createSampleTree();
    const listener = vi.fn();
    tree.onChange(listener);

    tree.remove(v3, { mergeData: joinData });

    const event = listener.mock.calls[0][1];
    expect(event.type).toBe('remove');
    expect(event.removedNodes.map((node: { id: string }) => node.id)).toEqual([v3]);
    expect(event.removedNodes[0].data).toBe('d3');
    expect(event.removedNodes[0].childrenIds).toEqual([v4, v7]);
    expect(event.affectedNodes.map((node: { id: string }) => node.id)).toEqual([v1, v4, v7]);
    expect(event.affectedNodes[0].childrenIds).toEqual([v2, v4, v7]);
    expect(event.affectedNodes[1].data).toBe('d3+d4');
    expect(event.affectedNodes[1].parentId).toBe(v1);
  });
});

describe('history-tree - prune 子树删除', () => {
  test('删除叶子节点后返回单元素列表且父节点 childrenIds 更新', () => {
    const { tree, v4, v5, v8 } = createSampleTree();

    expect(tree.prune(v5)).toEqual([v5]);
    expect(tree.getNode(v4).childrenIds).toEqual([v8]);
    expect(tree.size).toBe(9);
  });

  test('删除中间节点时全部后代被删且返回后序 DFS 顺序', () => {
    const { tree, v3, v4, v5, v7, v8, v9 } = createSampleTree();

    expect(tree.prune(v4)).toEqual([v5, v9, v8, v4]);
    expect(tree.getNode(v3).childrenIds).toEqual([v7]);
    expect(tree.size).toBe(6);
    expect(() => tree.getNode(v9)).toThrow(`[@cmtlyt/lingshu-toolkit#history-tree]: Node "${v9}" does not exist`);
  });

  test('includeSelf 为 false 时保留目标节点并清空其 childrenIds', () => {
    const { tree, v4, v5, v8, v9 } = createSampleTree();

    expect(tree.prune(v4, { includeSelf: false })).toEqual([v5, v9, v8]);
    expect(tree.getNode(v4).childrenIds).toEqual([]);
    expect(tree.size).toBe(7);
  });

  test('includeSelf 为 false 且无后代时返回空数组且不触发 onChange', () => {
    const { tree, v5 } = createSampleTree();
    const listener = vi.fn();
    tree.onChange(listener);

    expect(tree.prune(v5, { includeSelf: false })).toEqual([]);
    expect(tree.size).toBe(10);
    expect(listener).not.toHaveBeenCalled();
  });

  test('includeSelf 为 false 时允许传 rootId 以清空全部非根节点', () => {
    const { tree, v0 } = createSampleTree();

    const removed = tree.prune(v0, { includeSelf: false });

    expect(removed).toHaveLength(9);
    expect(tree.size).toBe(1);
    expect(tree.getRoot().childrenIds).toEqual([]);
    expect(tree.currentId).toBe(v0);
  });

  test('currentId 落入被删子树时默认回退到保留节点', () => {
    const included = createSampleTree();
    included.tree.checkout(included.v9);
    included.tree.prune(included.v4);
    expect(included.tree.currentId).toBe(included.v3);

    const excluded = createSampleTree();
    excluded.tree.checkout(excluded.v9);
    excluded.tree.prune(excluded.v4, { includeSelf: false });
    expect(excluded.tree.currentId).toBe(excluded.v4);
  });

  test('currentId 落入被删子树且策略为 root 时回退到根节点', () => {
    const { tree, v0, v4, v9 } = createSampleTree();
    tree.checkout(v9);

    tree.prune(v4, { onCurrentDeleted: 'root' });

    expect(tree.currentId).toBe(v0);
  });

  test('currentId 落入被删子树且策略为 throw 时抛错且树状态不变', () => {
    const { tree, v4, v9 } = createSampleTree();
    tree.checkout(v9);
    const before = tree.getSnapshot();

    expect(() => tree.prune(v4, { onCurrentDeleted: 'throw' })).toThrow(
      `[@cmtlyt/lingshu-toolkit#history-tree]: Current node "${v9}" is in pruned subtree of "${v4}"`,
    );
    expect(tree.getSnapshot()).toEqual(before);
  });

  test('currentId 不在被删子树时保持不变', () => {
    const { tree, v4, v6 } = createSampleTree();
    tree.checkout(v6);

    tree.prune(v4);

    expect(tree.currentId).toBe(v6);
  });

  test('删除根节点抛错且树状态不变', () => {
    const { tree, v0 } = createSampleTree();
    const before = tree.getSnapshot();

    expect(() => tree.prune(v0)).toThrow('[@cmtlyt/lingshu-toolkit#history-tree]: Cannot prune root node');
    expect(tree.getSnapshot()).toEqual(before);
  });

  test('删除不存在的节点抛错', () => {
    const { tree } = createSampleTree();

    expect(() => tree.prune('non-existent')).toThrow(
      '[@cmtlyt/lingshu-toolkit#history-tree]: Node "non-existent" does not exist',
    );
  });

  test('有节点被删除时只触发一次 onChange', () => {
    const { tree, v4 } = createSampleTree();
    const listener = vi.fn();
    tree.onChange(listener);

    tree.prune(v4);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('previewPrune 返回被删节点与保留节点且不修改树、不触发 onChange', () => {
    const { tree, v3, v4, v5, v7, v8, v9 } = createSampleTree();
    const listener = vi.fn();
    tree.onChange(listener);
    const before = tree.getSnapshot();

    const preview = tree.previewPrune(v4);

    expect(preview.map((node) => node.id)).toEqual([v5, v9, v8, v4, v3]);
    expect(preview[4].childrenIds).toEqual([v4, v7]);
    expect(tree.getSnapshot()).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test('onChange 事件中 removedNodes 为操作前快照、affectedNodes 为操作后快照', () => {
    const { tree, v3, v4, v5, v7, v8, v9 } = createSampleTree();
    const listener = vi.fn();
    tree.onChange(listener);

    tree.prune(v4);

    const event = listener.mock.calls[0][1];
    expect(event.type).toBe('prune');
    expect(event.removedNodes.map((node: { id: string }) => node.id)).toEqual([v5, v9, v8, v4]);
    expect(event.removedNodes[3].childrenIds).toEqual([v5, v8]);
    expect(event.affectedNodes.map((node: { id: string }) => node.id)).toEqual([v3]);
    expect(event.affectedNodes[0].childrenIds).toEqual([v7]);
  });

  test('深线性链 prune 不爆栈', () => {
    const depth = 50_000;
    const tree = createHistoryTree<number>({ initialData: 0 });
    const first = tree.commit(1);
    for (let value = 2; value <= depth; value++) {
      tree.commit(value);
    }

    const removed = tree.prune(first);

    expect(removed).toHaveLength(depth);
    expect(tree.size).toBe(1);
  });
});

describe('history-tree - compact 批量压缩', () => {
  test('不传 mergeData 时线性中间节点被删且子节点 data 不变', () => {
    const { tree, c0, c1, c2, c3 } = createCompactTree();

    expect(tree.compact()).toEqual([c1, c2]);
    expect(tree.getNode(c3).data).toBe('d3');
    expect(tree.getNode(c3).parentId).toBe(c0);
    expect(tree.size).toBe(4);
  });

  test('传 mergeData 时按父先子后的顺序对每个被合并节点调用', () => {
    const { tree, c3 } = createCompactTree();
    const mergeData = vi.fn(joinData);

    tree.compact({ mergeData });

    expect(mergeData).toHaveBeenCalledTimes(2);
    expect(mergeData).toHaveBeenNthCalledWith(1, 'd1', 'd2');
    expect(mergeData).toHaveBeenNthCalledWith(2, 'd1+d2', 'd3');
    expect(tree.getNode(c3).data).toBe('d1+d2+d3');
  });

  test('根节点即使只有一个子节点也不参与合并', () => {
    const { tree, l0, l1, l2 } = createLinearTree();

    const merged = tree.compact();

    expect(merged).toEqual([l1, l2]);
    expect(merged).not.toContain(l0);
    expect(tree.getRoot().id).toBe(l0);
    expect(tree.getRoot().childrenIds).toHaveLength(1);
  });

  test('当前节点即使满足线性条件也不参与合并', () => {
    const { tree, l1, l2 } = createLinearTree();
    tree.checkout(l2);

    const merged = tree.compact();

    expect(merged).toEqual([l1]);
    expect(tree.getNode(l2).data).toBe('d2');
    expect(tree.currentId).toBe(l2);
  });

  test('分叉节点不参与合并', () => {
    const { tree, c3 } = createCompactTree();

    expect(tree.compact()).not.toContain(c3);
    expect(tree.getNode(c3).childrenIds).toHaveLength(2);
  });

  test('叶子节点不参与合并', () => {
    const { tree, c4, c5 } = createCompactTree();

    const merged = tree.compact();

    expect(merged).not.toContain(c4);
    expect(merged).not.toContain(c5);
    expect(tree.getNode(c4).data).toBe('d4');
    expect(tree.getNode(c5).data).toBe('d5');
  });

  test('keep 返回 true 的节点不被合并', () => {
    const { tree, c1, c2 } = createCompactTree();

    const merged = tree.compact({ mergeData: joinData, keep: (node) => node.id === c2 });

    expect(merged).toEqual([c1]);
    expect(tree.getNode(c2).data).toBe('d1+d2');
  });

  test('无可合并节点时返回空数组且不触发 onChange', () => {
    const tree = createHistoryTree<string>({ initialData: 'd0' });
    tree.commit('d1');
    const listener = vi.fn();
    tree.onChange(listener);

    expect(tree.compact()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  test('有合并发生时只触发一次 onChange', () => {
    const { tree } = createCompactTree();
    const listener = vi.fn();
    tree.onChange(listener);

    tree.compact({ mergeData: joinData });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('返回 root-to-leaf 顺序的被合并节点 id 列表', () => {
    const { tree, c1, c2 } = createCompactTree();

    expect(tree.compact({ mergeData: joinData })).toEqual([c1, c2]);
  });

  test('合并后被提升节点的 parentId 与祖父节点 childrenIds 顺序正确', () => {
    const tree = createHistoryTree<string>({ initialData: 'd0' });
    const a1 = tree.commit('d1');
    const a2 = tree.commit('d2');
    tree.checkout(a1);
    const a3 = tree.commit('d3');
    tree.checkout(a2);
    const a4 = tree.commit('d4');
    tree.checkout(a3);

    // a1 分叉不参与；a2 只有 a4 一个子节点，被合并后 a4 顶替 a2 的原位置
    expect(tree.compact({ mergeData: joinData })).toEqual([a2]);
    expect(tree.getNode(a4).parentId).toBe(a1);
    expect(tree.getNode(a1).childrenIds).toEqual([a4, a3]);
  });

  test('候选节点按 root-to-leaf 顺序处理并串联累积 mergeData 结果', () => {
    const { tree, l1, l2, l3 } = createLinearTree();
    const mergeData = vi.fn(joinData);

    expect(tree.compact({ mergeData })).toEqual([l1, l2]);
    expect(mergeData.mock.calls).toEqual([
      ['d1', 'd2'],
      ['d1+d2', 'd3'],
    ]);
    expect(mergeData.mock.results[0].value).toBe('d1+d2');
    expect(tree.getNode(l3).data).toBe('d1+d2+d3');
  });

  test('previewCompact 返回操作前快照且不修改树、不触发 onChange', () => {
    const { tree, c0, c1, c2, c3 } = createCompactTree();
    const listener = vi.fn();
    tree.onChange(listener);
    const before = tree.getSnapshot();

    const preview = tree.previewCompact({ mergeData: joinData });

    expect(preview.map((node) => node.id)).toEqual([c1, c2, c3, c0]);
    expect(preview[1].data).toBe('d2');
    expect(preview[1].parentId).toBe(c1);
    expect(tree.getSnapshot()).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test('onChange 事件中 removedNodes 为操作前快照、affectedNodes 为操作后快照', () => {
    const { tree, c0, c1, c2, c3 } = createCompactTree();
    const listener = vi.fn();
    tree.onChange(listener);

    tree.compact({ mergeData: joinData });

    const event = listener.mock.calls[0][1];
    expect(event.type).toBe('compact');
    expect(event.removedNodes.map((node: { id: string }) => node.id)).toEqual([c1, c2]);
    expect(event.removedNodes[1].data).toBe('d1+d2');
    expect(event.affectedNodes.map((node: { id: string }) => node.id)).toEqual([c0, c3]);
    expect(event.affectedNodes[1].data).toBe('d1+d2+d3');
    expect(event.affectedNodes[1].parentId).toBe(c0);
  });
});

describe('history-tree - 节点修改策略', () => {
  test('remove 与 compact 后保留节点的 id 不变', () => {
    const { tree, v4, v8, v9 } = createSampleTree();
    tree.remove(v8, { mergeData: joinData });
    expect(tree.getNode(v9).id).toBe(v9);
    expect(tree.getNode(v4).id).toBe(v4);

    const linear = createLinearTree();
    const beforeIds = Object.keys(linear.tree.getSnapshot().nodes);
    linear.tree.compact({ mergeData: joinData });
    expect(Object.keys(linear.tree.getSnapshot().nodes)).toEqual(
      beforeIds.filter((id) => id !== linear.l1 && id !== linear.l2),
    );
    expect(linear.tree.getNode(linear.l3).id).toBe(linear.l3);
  });

  test('mergeData 返回值原地覆盖保留节点的 data', () => {
    const { tree, c3 } = createCompactTree();
    const before = tree.getSnapshot();

    tree.compact({ mergeData: joinData });
    const after = tree.getSnapshot();

    expect(before.nodes[c3].id).toBe(after.nodes[c3].id);
    expect(before.nodes[c3].data).toBe('d3');
    expect(after.nodes[c3].data).toBe('d1+d2+d3');
  });

  test('差量场景 compact 后从根重放的状态与压缩前一致', () => {
    interface Patch {
      ops: Array<{ path: string; value: number }>;
    }
    const replay = (patches: Patch[]) => {
      const state: Record<string, number> = {};
      for (const patch of [...patches].reverse()) {
        for (const op of patch.ops) {
          state[op.path] = op.value;
        }
      }
      return state;
    };

    const tree = createHistoryTree<Patch>({ initialData: { ops: [] } });
    tree.commit({ ops: [{ path: 'x', value: 1 }] });
    tree.commit({ ops: [{ path: 'y', value: 2 }] });
    tree.commit({ ops: [{ path: 'z', value: 3 }] });
    tree.commit({ ops: [{ path: 'w', value: 4 }] });

    const before = replay(tree.getPathData());
    const merged = tree.compact({
      mergeData: (removed, child) => {
        return { ops: [...removed.ops, ...child.ops] };
      },
    });

    expect(merged).toHaveLength(3);
    expect(tree.size).toBe(2);
    expect(replay(tree.getPathData())).toEqual(before);
    expect(before).toEqual({ x: 1, y: 2, z: 3, w: 4 });
  });
});

describe('history-tree - mergeData 抛错的原子性', () => {
  test('remove 的 mergeData 中途抛错时树完全不变且不通知', () => {
    const { tree, v3, v4 } = createSampleTree();
    const listener = vi.fn();
    tree.onChange(listener);
    const before = tree.getSnapshot();

    const failure = new Error('merge failed');
    let calls = 0;
    const mergeData = vi.fn((removedData: string, childData: string) => {
      calls += 1;
      if (calls === 2) {
        throw failure;
      }
      return joinData(removedData, childData);
    });

    let caught: unknown;
    try {
      tree.remove(v3, { mergeData });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(failure);
    expect(mergeData).toHaveBeenCalledTimes(2);
    // 第一个 child 的合并结果只算不写，树里仍是原始 data
    expect(tree.getNode(v4).data).toBe('d4');
    expect(tree.getSnapshot()).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test('compact 的 mergeData 中途抛错时已合并部分被整体回滚', () => {
    const { tree, l1, l2, l3 } = createLinearTree();
    const listener = vi.fn();
    tree.onChange(listener);
    const before = tree.getSnapshot();

    const failure = new Error('merge failed');
    let calls = 0;
    const mergeData = vi.fn((removedData: string, childData: string) => {
      calls += 1;
      if (calls === 2) {
        throw failure;
      }
      return joinData(removedData, childData);
    });

    let caught: unknown;
    try {
      tree.compact({ mergeData });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(failure);
    expect(tree.size).toBe(4);
    expect(tree.currentId).toBe(l3);
    expect(tree.getNode(l1).data).toBe('d1');
    expect(tree.getNode(l2).data).toBe('d2');
    expect(tree.getSnapshot()).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test('mergeData 抛错后树仍可继续 commit 与 remove', () => {
    const { tree, v3, v4 } = createSampleTree();
    const failure = new Error('merge failed');

    expect(() =>
      tree.remove(v3, {
        mergeData: () => {
          throw failure;
        },
      }),
    ).toThrow(failure);

    tree.checkout(v4);
    const extra = tree.commit('d10');
    expect(tree.getNode(extra).parentId).toBe(v4);
    expect(tree.size).toBe(11);

    tree.remove(v3, { mergeData: joinData });
    expect(tree.size).toBe(10);
    expect(tree.getNode(v4).data).toBe('d3+d4');
  });
});

describe('history-tree - 变更事件时态', () => {
  test('affectedNodes 为操作后快照，与 previewRemove 的操作前快照不同', () => {
    const { tree, v1, v3, v4 } = createSampleTree();
    const preview = tree.previewRemove(v3, { mergeData: joinData });
    const listener = vi.fn();
    tree.onChange(listener);

    tree.remove(v3, { mergeData: joinData });

    const previewChild = preview.find((node) => node.id === v4)!;
    const affectedChild = listener.mock.calls[0][1].affectedNodes.find((node: { id: string }) => node.id === v4);
    expect(previewChild.data).toBe('d4');
    expect(previewChild.parentId).toBe(v3);
    expect(affectedChild.data).toBe('d3+d4');
    expect(affectedChild.parentId).toBe(v1);
  });

  test('removedNodes 与 affectedNodes 的 id 并集等于 preview 的 id 集合', () => {
    const collectEventIds = (listener: ReturnType<typeof vi.fn>) =>
      new Set(
        [...listener.mock.calls[0][1].removedNodes, ...listener.mock.calls[0][1].affectedNodes].map(
          (node: { id: string }) => node.id,
        ),
      );

    const removeCase = createSampleTree();
    const removeListener = vi.fn();
    const removePreview = new Set(removeCase.tree.previewRemove(removeCase.v3).map((node) => node.id));
    removeCase.tree.onChange(removeListener);
    removeCase.tree.remove(removeCase.v3);
    expect(collectEventIds(removeListener)).toEqual(removePreview);

    const pruneCase = createSampleTree();
    const pruneListener = vi.fn();
    const prunePreview = new Set(pruneCase.tree.previewPrune(pruneCase.v4).map((node) => node.id));
    pruneCase.tree.onChange(pruneListener);
    pruneCase.tree.prune(pruneCase.v4);
    expect(collectEventIds(pruneListener)).toEqual(prunePreview);

    const compactCase = createCompactTree();
    const compactListener = vi.fn();
    const compactPreview = new Set(compactCase.tree.previewCompact().map((node) => node.id));
    compactCase.tree.onChange(compactListener);
    compactCase.tree.compact({ mergeData: joinData });
    expect(collectEventIds(compactListener)).toEqual(compactPreview);
  });

  test('commit 与 checkout 的事件语义', () => {
    const tree = createHistoryTree<string>({ initialData: 'd0' });
    const rootId = tree.getRoot().id;
    const listener = vi.fn();
    tree.onChange(listener);

    const newId = tree.commit('d1');
    const commitEvent = listener.mock.calls[0][1];
    expect(commitEvent.type).toBe('commit');
    expect(commitEvent.removedNodes).toEqual([]);
    expect(commitEvent.affectedNodes.map((node: { id: string }) => node.id)).toEqual([newId, rootId]);
    expect(commitEvent.affectedNodes[1].childrenIds).toEqual([newId]);

    tree.checkout(rootId);
    const checkoutEvent = listener.mock.calls[1][1];
    expect(checkoutEvent.type).toBe('checkout');
    expect(checkoutEvent.removedNodes).toEqual([]);
    expect(checkoutEvent.affectedNodes).toEqual([]);
  });
});

interface MutableSnapshotNode {
  id: string;
  data: string;
  parentId: string | null;
  childrenIds: string[];
}

interface MutableSnapshot {
  rootId?: string;
  currentId?: string;
  nodes: Record<string, MutableSnapshotNode>;
}

/** 构造一份最小合法快照，供校验用例逐项破坏 */
function createValidSnapshot(): MutableSnapshot {
  return {
    rootId: '0',
    currentId: '1',
    nodes: {
      0: { id: '0', data: 'd0', parentId: null, childrenIds: ['1'] },
      1: { id: '1', data: 'd1', parentId: '0', childrenIds: [] },
    },
  };
}

describe('history-tree - loadFromSnapshot 快照加载', () => {
  test('加载后 rootId / currentId / 节点全部被整体替换', () => {
    const source = createLinearTree();
    const target = createSampleTree();
    const snapshot = source.tree.getSnapshot();

    target.tree.loadFromSnapshot(snapshot);

    expect(target.tree.getRoot().id).toBe(snapshot.rootId);
    expect(target.tree.currentId).toBe(snapshot.currentId);
    expect(target.tree.size).toBe(4);
    expect(target.tree.getSnapshot()).toEqual(snapshot);
    expect(() => target.tree.getNode(target.v9)).toThrow(
      `[@cmtlyt/lingshu-toolkit#history-tree]: Node "${target.v9}" does not exist`,
    );
  });

  test('加载触发一次 onChange 且事件包含新旧两棵树的节点', () => {
    const source = createLinearTree();
    const target = createSampleTree();
    const listener = vi.fn();
    target.tree.onChange(listener);

    target.tree.loadFromSnapshot(source.tree.getSnapshot());

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][1];
    expect(event.type).toBe('load');
    expect(event.removedNodes).toHaveLength(10);
    expect(event.removedNodes.map((node: { id: string }) => node.id)).toContain(target.v9);
    expect(event.affectedNodes).toHaveLength(4);
    expect(event.affectedNodes.map((node: { id: string }) => node.id)).toEqual(
      Object.keys(source.tree.getSnapshot().nodes),
    );
  });

  test('加载后内置 id 计数器推进到最大数字 id + 1', () => {
    const ids = ['0', '1', '2', '5'];
    let index = 0;
    const source = createHistoryTree<string>({ initialData: 'd0', generateId: () => ids[index++] });
    source.commit('d1');
    source.commit('d2');
    source.commit('d5');

    const tree = createHistoryTree<string>({ initialData: 'x' });
    tree.loadFromSnapshot(source.getSnapshot());

    expect(tree.commit('d6')).toBe('6');
    expect(tree.size).toBe(5);
  });

  test('计数器只推进不后退', () => {
    const tree = createHistoryTree<string>({ initialData: 'd0' });
    for (let step = 1; step <= 9; step++) {
      tree.commit(`d${step}`);
    }
    expect(tree.currentId).toBe('9');

    const smallIds = ['0', '1'];
    let index = 0;
    const source = createHistoryTree<string>({ initialData: 's0', generateId: () => smallIds[index++] });
    source.commit('s1');

    tree.loadFromSnapshot(source.getSnapshot());

    expect(tree.commit('next')).toBe('10');
  });

  test('非数字 id 不推进计数器，自定义 generateId 完全不受干预', () => {
    const letterIds = ['a', 'b'];
    let letterIndex = 0;
    const source = createHistoryTree<string>({ initialData: 's0', generateId: () => letterIds[letterIndex++] });
    source.commit('s1');
    const snapshot = source.getSnapshot();

    const builtin = createHistoryTree<string>({ initialData: 'd0' });
    builtin.loadFromSnapshot(snapshot);
    expect(builtin.commit('next')).toBe('1');

    let customCounter = 100;
    const custom = createHistoryTree<string>({ initialData: 'd0', generateId: () => `node-${customCounter++}` });
    custom.loadFromSnapshot(createLinearTree().tree.getSnapshot());
    expect(custom.commit('next')).toBe('node-101');
  });

  test('快照校验失败时抛错、树完全不变且不触发 onChange', () => {
    const cases: Array<{ mutate: (snapshot: MutableSnapshot) => void; message: string }> = [
      {
        mutate: (snapshot) => {
          snapshot.rootId = undefined;
        },
        message: 'Invalid snapshot: missing required field "rootId"',
      },
      {
        mutate: (snapshot) => {
          snapshot.rootId = 'missing';
        },
        message: 'Invalid snapshot: root node "missing" does not exist',
      },
      {
        mutate: (snapshot) => {
          snapshot.currentId = 'missing';
        },
        message: 'Invalid snapshot: current node "missing" does not exist',
      },
      {
        mutate: (snapshot) => {
          snapshot.nodes['2'] = { id: '2', data: 'd2', parentId: 'missing', childrenIds: [] };
        },
        message: 'Invalid snapshot: node "2" references missing parent "missing"',
      },
      {
        mutate: (snapshot) => {
          snapshot.nodes['1'].childrenIds.push('missing');
        },
        message: 'Invalid snapshot: node "1" references missing child "missing"',
      },
      {
        mutate: (snapshot) => {
          snapshot.nodes['0'].childrenIds = [];
        },
        message: 'Invalid snapshot: inconsistent link between "0" and "1"',
      },
      {
        mutate: (snapshot) => {
          snapshot.nodes['2'] = { id: '2', data: 'd2', parentId: null, childrenIds: [] };
        },
        message: 'Invalid snapshot: multiple root nodes found',
      },
      {
        mutate: (snapshot) => {
          snapshot.nodes['2'] = { id: '2', data: 'd2', parentId: '3', childrenIds: ['3'] };
          snapshot.nodes['3'] = { id: '3', data: 'd3', parentId: '2', childrenIds: ['2'] };
        },
        message: 'Invalid snapshot: node "2" is unreachable from root',
      },
      {
        mutate: (snapshot) => {
          snapshot.nodes['0'].parentId = '1';
        },
        message: 'Invalid snapshot: root node "0" must have null parentId',
      },
    ];

    for (const { mutate, message } of cases) {
      const { tree } = createSampleTree();
      const listener = vi.fn();
      tree.onChange(listener);
      const before = tree.getSnapshot();

      const snapshot = createValidSnapshot();
      mutate(snapshot);

      expect(() => tree.loadFromSnapshot(snapshot as unknown as HistoryTreeSnapshot<string>)).toThrow(
        `[@cmtlyt/lingshu-toolkit#history-tree]: ${message}`,
      );
      expect(tree.getSnapshot()).toEqual(before);
      expect(listener).not.toHaveBeenCalled();
    }
  });

  test('parentId 指向 "constructor" 等原型链键时按契约报 Invalid snapshot', () => {
    const { tree } = createSampleTree();
    const before = tree.getSnapshot();

    const snapshot = createValidSnapshot();
    snapshot.nodes['2'] = { id: '2', data: 'd2', parentId: 'constructor', childrenIds: [] };

    expect(() => tree.loadFromSnapshot(snapshot as unknown as HistoryTreeSnapshot<string>)).toThrow(
      '[@cmtlyt/lingshu-toolkit#history-tree]: Invalid snapshot: node "2" references missing parent "constructor"',
    );
    expect(tree.getSnapshot()).toEqual(before);
  });

  test('破坏性操作后可用备份快照逐节点还原并继续提交', () => {
    const { tree, v4 } = createSampleTree();
    const backup = tree.getSnapshot();

    tree.prune(v4);
    tree.compact({ mergeData: joinData });
    expect(tree.getSnapshot()).not.toEqual(backup);

    tree.loadFromSnapshot(backup);

    expect(tree.getSnapshot()).toEqual(backup);
    expect(tree.currentId).toBe(backup.currentId);

    const extra = tree.commit('d10');
    expect(tree.getNode(extra).data).toBe('d10');
    expect(tree.size).toBe(11);
  });
});
