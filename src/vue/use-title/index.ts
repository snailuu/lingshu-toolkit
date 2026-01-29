import { type MaybeRefOrGetter, onScopeDispose, ref, toValue, watch } from 'vue';

interface UseTitleOptions {
  restoreOnUnmount?: boolean;
}

export function useTitle(newTitle: MaybeRefOrGetter<string> = '', options: UseTitleOptions = {}) {
  const { restoreOnUnmount = true } = options;
  const title = ref(toValue(newTitle));
  let originalTitle = '';

  if (typeof document !== 'undefined') {
    originalTitle = document.title;
    document.title = title.value;
  }

  watch(
    title,
    (value) => {
      if (typeof document !== 'undefined') {
        document.title = value;
      }
    },
    { flush: 'sync' },
  );

  watch(
    () => toValue(newTitle),
    (value) => {
      title.value = value;
    },
  );

  if (restoreOnUnmount) {
    onScopeDispose(() => {
      if (originalTitle && typeof document !== 'undefined') {
        document.title = originalTitle;
      }
    });
  }

  return title;
}
