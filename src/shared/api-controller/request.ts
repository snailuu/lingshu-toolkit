import { throwType } from '@/shared/throw-error';
import { tryCall } from '@/shared/try-call';
import { getType } from '@/shared/utils/base';
import { isFunction, isNullOrUndef } from '@/shared/utils/verify';
import type { RequestAPIConfig } from './types';
import { getBody, targetUrlParser, urlParamsParser } from './utils';

const ON_REQUEST_FN_NAME = 'apiController.onRequest';

async function baseRequest<R, C extends RequestAPIConfig<any, R> = RequestAPIConfig<any, R>>(
  config: C,
  getResponse: (requestInfo: Request) => Promise<Response>,
): Promise<R> {
  // 非 RequestInit 字段统一从 rest 中剔除, 避免混入 new Request 的初始化参数
  const {
    baseUrl,
    url,
    method: _method,
    parser,
    data,
    tdto,
    tvo,
    params,
    onRequest,
    onResponse,
    requestMode,
    requestModeMap,
    ...rest
  } = config;

  const targetUrl = targetUrlParser(url, baseUrl!);
  const method = _method?.toUpperCase() as RequestInit['method'];

  const requestInfo = tryCall(() => {
    if (isNullOrUndef(method) || method === 'GET' || method === 'HEAD') {
      const queryKeys = Object.keys(data || {});
      for (let i = 0; i < queryKeys.length; ++i) {
        targetUrl.searchParams.append(queryKeys[i], (data as any)[queryKeys[i]]);
      }
      return new Request(targetUrl, { ...rest, method });
    }
    const body = getBody(data, tdto);
    return new Request(targetUrl, { ...rest, method, body });
  });

  const responseInfo = await getResponse(requestInfo);

  const resResult = await tryCall<Promise<any>>(() => {
    if (onResponse) {
      return onResponse(responseInfo, config);
    }
    if (!parser) {
      return responseInfo.json();
    }
    if (parser === 'stream') {
      return responseInfo.body;
    }
    const responseHandler = (responseInfo as unknown as Record<string, () => Promise<any>>)[parser];
    if (isFunction(responseHandler)) {
      return Reflect.apply(responseHandler, responseInfo, []);
    }
    throwType('apiController.responseParser', 'Invalid parser');
  });

  return tvo ? tvo(resResult) : (resResult as R);
}

async function mockRequest<R, C extends RequestAPIConfig<any, R> = RequestAPIConfig<any, R>>(config: C): Promise<R> {
  const { onRequest, ...rest } = config;

  return baseRequest<R>(config, async (requestInfo) => {
    const reqResult = await (onRequest && onRequest(requestInfo, config));

    const responseBody = getBody(reqResult);
    return new Response(responseBody, { ...rest });
  });
}

/** 已告警过的 onRequest, 避免热路径上每次请求都刷屏 */
const warnedOnRequest = new WeakSet<object>();

function warnInvalidOnRequestResult(onRequest: object, result: unknown) {
  if (warnedOnRequest.has(onRequest)) {
    return;
  }
  warnedOnRequest.add(onRequest);
  console.warn(
    `[@cmtlyt/lingshu-toolkit#${ON_REQUEST_FN_NAME}]: network 模式下 onRequest 返回了无法处理的 "${getType(result)}", 已忽略该返回值并发送原请求. ` +
      '返回 Response 可短路请求, 返回 Request 可替换原请求.',
  );
}

async function networkRequest<R, C extends RequestAPIConfig<any, R> = RequestAPIConfig<any, R>>(config: C): Promise<R> {
  const { onRequest } = config;

  return baseRequest<R>(config, async (requestInfo) => {
    if (!onRequest) {
      return fetch(requestInfo);
    }

    const reqResult = await onRequest(requestInfo, config);
    // 跨 realm(iframe/Worker) 传入的 Response/Request 无法通过 instanceof 识别, 会退化为发送原请求
    if (reqResult instanceof Response) {
      return reqResult;
    }
    if (reqResult instanceof Request) {
      return fetch(reqResult);
    }
    // network 模式下 onRequest 仅支持 Response(短路) 与 Request(替换请求) 两种返回值.
    // 此处告警降级而非抛错, 是为了兼容 mock/network 共用同一份 onRequest 配置的既有用法.
    if (!isNullOrUndef(reqResult)) {
      warnInvalidOnRequestResult(onRequest, reqResult);
    }
    return fetch(requestInfo);
  });
}

/**
 * 请求方法
 *
 * @param config 请求配置
 */
export function request<R, C extends RequestAPIConfig<any, R> = RequestAPIConfig<any, R>>(config: C): Promise<R> {
  const url = urlParamsParser(config.url, config.params);

  const { requestMode, requestModeMap } = config;
  const customRequest = (requestModeMap || {})[requestMode || ''];
  if (customRequest) {
    return customRequest({ ...config, url });
  }

  if (requestMode === 'mock') {
    return mockRequest({ ...config, url });
  }
  return networkRequest({ ...config, url });
}
