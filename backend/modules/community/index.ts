/**
 * 社区 API(moltbook)高层能力封装。见 07 文档第四节。
 *
 * 四个核心能力:圈子详情 / 发想法 / 发评论 / 点赞。全部走 HMAC 签名(见 sign.ts),
 * 且受 config.features.community 开关控制(默认关,防误发)。
 *
 * 限流红线(07 文档第六节):全局 10 QPS;发想法每小时最多 5 条;评论每小时每想法 20 条。
 * 这些是本模块不主动做节流、交由调用方 + 开关兜底的硬约束——真实发帖端到端验证「待部署后验证」。
 */

import { communityCall } from './client.js';

// ---------------------------------------------------------------------------
// 响应类型(最小必要字段,见 07 文档 4.1/4.2/4.4/4.6)
// ---------------------------------------------------------------------------

export interface RingInfo {
  ring_id: string;
  ring_name: string;
  ring_desc: string;
  ring_avatar: string;
  membership_num: number;
  discussion_num: number;
}

export interface PinContent {
  pin_id: string;
  title?: string;
  content: string;
  author_name: string;
  images?: string[];
  publish_time: number;
  like_num: number;
  comment_num: number;
  fav_num: number;
  share_num: number;
}

export interface RingDetailData {
  ring_info: RingInfo;
  contents: PinContent[];
}

// ---------------------------------------------------------------------------
// 能力封装
// ---------------------------------------------------------------------------

/** 获取圈子详情(含圈子信息 + 最新内容)。GET /openapi/ring/detail */
export function getRingDetail(ringId: string, pageNum = 1, pageSize = 20) {
  return communityCall<RingDetailData>('/openapi/ring/detail', {
    query: { ring_id: ringId, page_num: String(pageNum), page_size: String(Math.min(pageSize, 50)) },
  });
}

/** 发布想法。POST /openapi/publish/pin(每小时最多 5 条)。返回 data.content_token */
export function publishPin(ringId: string, content: string, title = '') {
  return communityCall<{ content_token: string }>('/openapi/publish/pin', {
    method: 'POST',
    body: { ring_id: ringId, content, title },
  });
}

/** 创建评论(支持回复)。POST /openapi/comment/create。content_type: pin | comment */
export function createComment(contentToken: string, contentType: 'pin' | 'comment', content: string) {
  return communityCall<{ comment_id: string }>('/openapi/comment/create', {
    method: 'POST',
    body: { content_token: contentToken, content_type: contentType, content },
  });
}

/** 内容/评论点赞。POST /openapi/reaction。action_type=like,action_value=1 赞 / 0 取消 */
export function react(contentToken: string, contentType: 'pin' | 'comment', like: boolean) {
  return communityCall<Record<string, never>>('/openapi/reaction', {
    method: 'POST',
    body: {
      content_token: contentToken,
      content_type: contentType,
      action_type: 'like',
      action_value: like ? 1 : 0,
    },
  });
}
