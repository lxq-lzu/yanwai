/**
 * 社区 API(moltbook)HMAC-SHA256 签名。见 07 文档第二节。
 *
 * 与内容 API 的 Bearer / OAuth 的 Token 都不同,这是一套独立的 AK/SK 签名鉴权:
 * 待签名字符串 = "app_key:{app_key}|ts:{timestamp}|logid:{log_id}|extra_info:{extra_info}"
 * sign = Base64( HMAC-SHA256(待签名字符串, app_secret) )
 *
 * 这里保持纯函数、不读 config,方便单测用固定输入断言确定性结果。
 */

import { createHmac } from 'node:crypto';

export function signCommunity(
  appKey: string,
  appSecret: string,
  timestamp: string,
  logId: string,
  extraInfo = ''
): string {
  const canonical = `app_key:${appKey}|ts:${timestamp}|logid:${logId}|extra_info:${extraInfo}`;
  return createHmac('sha256', appSecret).update(canonical).digest('base64');
}

/**
 * 生成一次请求所需的 5 个签名头(X-App-Key / X-Timestamp / X-Log-Id / X-Sign / X-Extra-Info)。
 * 头必须全在,缺一不可(07 文档 2.3)。log_id 用 request_ + 毫秒 + 随机尾巴保证唯一。
 */
export function buildCommunityHeaders(appKey: string, appSecret: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const logId = `request_${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    'X-App-Key': appKey,
    'X-Timestamp': timestamp,
    'X-Log-Id': logId,
    'X-Sign': signCommunity(appKey, appSecret, timestamp, logId),
    'X-Extra-Info': '',
  };
}
