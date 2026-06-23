/**
 * Leader conversation buffer trimmer
 *
 * 策略：只剥离旧图片 base64 payload，不删任何消息（包括 tool 消息）。
 * - 旧图片按 image_history_retain_rounds 剥离 base64 payload，保留文字部分
 * - 消息裁剪（含 tool 消息）统一由 compact 路径负责，此处不再做条数裁剪
 */

import type { ChatMessage } from '../../llm/types.js';
import { config as runtimeConfig } from '../../config.js';
import {
  stripOldImageParts,
} from '../messageMemoryBudget.js';

/**
 * 给消息打默认 timestamp（秒，浮点）：仅在缺失时填充
 */
export function ensureMessageTimestamp(msg: ChatMessage, nowMs = Date.now()): ChatMessage {
  if (!msg.timestamp) {
    msg.timestamp = nowMs / 1000;
  }
  return msg;
}

/**
 * 对 conversation 做旧图片剥离，不删任何消息。
 *
 * 行为：
 * - 旧图片按配置轮数剥离 base64 payload，保留文字部分
 * - 不做条数裁剪（tool 消息也不删）；消息裁剪统一由 compact 路径负责
 */
export function trimConversationBuffer(
  conversation: ChatMessage[],
  _maxMessages?: number,
  _maxBytes?: number,
): ChatMessage[] {
  return stripOldImageParts(conversation, {
    retainImageMessages: runtimeConfig.advanced.image_history_retain_rounds,
    protectedCount: Math.min(2, conversation.length),
  });
}
