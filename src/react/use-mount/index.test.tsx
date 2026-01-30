import { Component, type PropsWithChildren } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, renderHook } from 'vitest-browser-react';
import { useMount } from './index';

describe('useMount', () => {
  test('导出测试', () => {
    expect(useMount).toBeTypeOf('function');
  });

  test('基本使用', async () => {
    const callback = vi.fn();
    await renderHook(() => useMount(callback));
    expect(callback).toBeCalledTimes(1);
  });

  test('不传递参数', async () => {
    const Test = () => {
      // @ts-expect-error test
      useMount();
      return null;
    };
    const errorCallback = vi.fn(() => {
      return { hasError: true };
    });
    const ErrorBoundary = class extends Component<PropsWithChildren> {
      state = { hasError: false };
      static getDerivedStateFromError = errorCallback;
      render() {
        if (this.state.hasError) {
          return null;
        }
        return <Test />;
      }
    };
    await render(<ErrorBoundary />);
    expect(errorCallback).toBeCalledTimes(1);
  });
});
