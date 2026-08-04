import { validateSnapshot } from './snapshot';
import type { TreeState } from './state';
import { allNodeInfos, notifyListeners, restoreFromSnapshot } from './state';
import type { HistoryTreeSnapshot } from './types';

/** 可解析为非负整数的 id，用于加载快照后推进内置计数器（"01" / "-1" / "1.5" / "a" 均不匹配） */
const NON_NEGATIVE_INTEGER = /^(?:0|[1-9]\d*)$/u;

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

export function loadSnapshot<T>(state: TreeState<T>, snapshot: HistoryTreeSnapshot<T>): void {
  validateSnapshot(snapshot);

  // 旧树快照必须在替换前捕获，无监听器时省掉两次 O(n) 构建
  const removedNodes = state.listeners.size > 0 ? allNodeInfos(state) : [];
  restoreFromSnapshot(state, snapshot);
  advanceBuiltinGenerateId(state);

  notifyListeners(state, () => {
    return { type: 'load', removedNodes, affectedNodes: allNodeInfos(state) };
  });
}
