import type { NotUnion } from '@s/types';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { $dt, $t, useValidData } from '../use-valid-data';

interface UseControllableValueOptions<Ks extends PropertyKey = PropertyKey, P extends Ks | (string & {}) = 'value'> {
  defaultValue: any;
  defaultValuePropName: Ks;
  valuePropName: P;
  trigger: Ks;
}

const validInfo = $dt<UseControllableValueOptions>({
  defaultValuePropName: $t.validString('defaultValue'),
  valuePropName: $t.validString('value'),
  trigger: $t.validString('onChange'),
});

export type PublicUseControllableValueOptions<
  Ks extends PropertyKey = PropertyKey,
  P extends Ks | (string & {}) = 'value',
> = Partial<UseControllableValueOptions<Ks, P>>;

type ValueType<T extends Record<PropertyKey, any>, P> = NotUnion<P> extends true
  ? P extends keyof T
    ? T[P]
    : T['value']
  : T['value'];

/**
 * 受控组件 value 逻辑切换, 如果传递了 value 则走受控逻辑, 否则走非受控逻辑
 */
export function useControllableValue<
  T extends Record<PropertyKey, any>,
  P extends keyof T | (string & {}) = PropertyKey,
>(props = {} as T, options: PublicUseControllableValueOptions<keyof T, P> = {}) {
  const { result: validOptions } = useValidData(options as UseControllableValueOptions, validInfo) as {
    result: UseControllableValueOptions;
  };
  const { defaultValue: _defaultValue, trigger, valuePropName, defaultValuePropName } = validOptions;
  const {
    [valuePropName]: propValue,
    [defaultValuePropName]: defaultValue = _defaultValue,
    [trigger]: emitChange,
  } = props;

  const hasValueRef = useRef(Boolean(Reflect.getOwnPropertyDescriptor(props, valuePropName)));
  const isFirstRenderRef = useRef(true);

  const [ctrlValue, setCtrlValue] = useState(hasValueRef.current ? (propValue as ValueType<T, P>) : defaultValue);

  const setValue = useEffectEvent((value: ValueType<T, P>, ...args: any[]) => {
    if (typeof emitChange === 'function') {
      emitChange(value, ...args);
    }
    if (!hasValueRef.current) {
      setCtrlValue(value);
    }
  });

  useEffect(() => {
    if (isFirstRenderRef.current || !hasValueRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    setCtrlValue(propValue as ValueType<T, P>);
  }, [propValue]);

  return [ctrlValue, setValue] as [ValueType<T, P>, typeof setValue];
}
