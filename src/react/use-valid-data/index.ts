import { dataHandler } from '@s';
import type { DataHandlerOptions, Handler } from '@s/data-handler/types';
import { useMemo, useRef } from 'react';

export * from '@s/data-handler/tools';

export function useValidData<T extends Record<PropertyKey, any>>(
  data: T,
  verifyInfo: Handler<T>,
  options?: DataHandlerOptions<T>,
) {
  const verifyInfoRef = useRef(verifyInfo);
  const optionsRef = useRef(options);

  return useMemo(() => dataHandler(data, verifyInfoRef.current, optionsRef.current), [data]);
}
