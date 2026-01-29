import { useMemo } from 'react';
import { useToggle } from '@/react/use-toggle';

export function useBoolean(defaultValue = false) {
  const [state, { toggle, set }] = useToggle(!!defaultValue);

  // biome-ignore lint/correctness/useExhaustiveDependencies: toggle action is pure
  const actions = useMemo(() => {
    return {
      toggle,
      setTrue: () => set(true),
      setFalse: () => set(false),
      set: (value: boolean) => set(!!value),
    };
  }, []);

  return [state, actions] as const;
}
