import type { ChatMessage } from '../llm/types.js';

/**
 * Estimate retained in-memory bytes for a chat message.
 *
 * JSON.stringify is intentionally used instead of content-only length because tool calls,
 * tool result ids, timestamps and structured multimodal content also stay resident in the
 * message array and are serialized during LLM calls.
 */
export function estimateChatMessageBytes(message: ChatMessage): number {
  try {
    return Buffer.byteLength(JSON.stringify(message), 'utf8');
  } catch {
    return Buffer.byteLength(String(message.content ?? ''), 'utf8') + 512;
  }
}

export function estimateChatMessagesBytes(messages: readonly ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateChatMessageBytes(message), 0);
}

function stripImagePartsFromMessage(message: ChatMessage): ChatMessage {
  if (!Array.isArray(message.content)) {
    return message;
  }

  const content = message.content.filter((part) => {
    if (!part || typeof part !== 'object') return true;
    const type = (part as { type?: unknown }).type;
    return type !== 'image_url' && type !== 'image' && type !== 'input_image' && type !== 'image_blob_ref';
  });

  return content.length === message.content.length ? message : { ...message, content };
}

function hasImagePart(message: ChatMessage): boolean {
  return Array.isArray(message.content) && message.content.some((part) => {
    if (!part || typeof part !== 'object') return false;
    const type = (part as { type?: unknown }).type;
    return type === 'image_url' || type === 'image' || type === 'input_image' || type === 'image_blob_ref';
  });
}

/**
 * Remove old multimodal image payloads while preserving the surrounding text turns.
 * Large 1M-context models can carry long text histories, but base64/image refs are still
 * expensive and often stale after visual grounding has moved on. Keep only the latest N
 * messages that actually contain image parts; older image parts are stripped in-place.
 */
export function stripOldImageParts(
  messages: ChatMessage[],
  options: { retainImageMessages: number; protectedCount?: number },
): ChatMessage[] {
  const retainImageMessages = Math.max(0, Math.floor(options.retainImageMessages));
  if (retainImageMessages <= 0 || messages.length === 0) {
    return messages.map(stripImagePartsFromMessage);
  }

  const protectedCount = Math.max(0, Math.min(options.protectedCount ?? 0, messages.length));
  let remaining = retainImageMessages;
  const keepImage = new Array<boolean>(messages.length).fill(false);
  for (let i = messages.length - 1; i >= protectedCount; i -= 1) {
    if (!hasImagePart(messages[i])) continue;
    if (remaining > 0) {
      keepImage[i] = true;
      remaining -= 1;
    }
  }
  for (let i = 0; i < protectedCount; i += 1) {
    if (hasImagePart(messages[i])) keepImage[i] = true;
  }

  return messages.map((message, index) => (keepImage[index] ? message : stripImagePartsFromMessage(message)));
}


