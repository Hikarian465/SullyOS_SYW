/**
 * 主动消息 2.0 的正文工具调用兼容层。
 *
 * 某些 OpenAI 兼容中转会吞掉 function calling 结构，把调用降级成聊天正文。除了标准的
 * `schedule_active_message({...})`，现场还见过 `[schedule_active_message | 2026-08-04 15:25:00]`。
 * 这些文字如果直接落进聊天，看起来像“已经排程”，实际上 Worker 完全没收到请求。
 */

import { AMSG2_TOOL_NAMES } from './amsg2ToolBridge';

export interface Amsg2TextToolCall {
  name: string;
  args: Record<string, unknown>;
  /** 原始匹配串，最终从给用户看的正文里剥掉。 */
  matched: string;
}

const TOOL_NAMES = Array.from(AMSG2_TOOL_NAMES);
const TOOL_PATTERN = TOOL_NAMES
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

const parseObject = (raw: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

/** 把模型常写的 `YYYY-MM-DD HH:mm:ss` 收敛成工具 schema 要求的裸墙钟 ISO。 */
const normalizeWallClock = (raw: string): string => raw.trim().replace(
  /^(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)$/,
  '$1T$2',
);

const parsePipeArgs = (name: string, raw: string): Record<string, unknown> => {
  const text = raw.trim();
  if (!text) return {};
  if (text.startsWith('{')) return parseObject(text) ?? {};

  if (name === 'schedule_active_message') {
    return { send_at: normalizeWallClock(text) };
  }
  if (name === 'cancel_active_message') {
    return { task_id: text };
  }
  if (name === 'renew_active_message') {
    // 兼容 `[renew_active_message | 时间 | 短 id]`；只有时间时由执行器按唯一任务续期。
    const [sendAt = '', taskId = ''] = text.split('|').map((part) => part.trim());
    return {
      send_at: normalizeWallClock(sendAt),
      ...(taskId ? { task_id: taskId } : {}),
    };
  }
  return {};
};

export const extractAmsg2TextToolCalls = (content: string): Amsg2TextToolCall[] => {
  if (!content || !TOOL_PATTERN) return [];
  const calls: Amsg2TextToolCall[] = [];
  const occupied: Array<[number, number]> = [];

  // 标准正文降级：tool_name({...})。参数写坏也认作调用，交给执行器返回可读错误，
  // 避免把半截工具语法原样展示给用户。
  const functionRe = new RegExp(`(^|[^\\w./])(${TOOL_PATTERN})\\s*\\(([^)]*)\\)`, 'g');
  for (const match of content.matchAll(functionRe)) {
    const prefix = match[1] || '';
    const matched = match[0].slice(prefix.length);
    const start = (match.index ?? 0) + prefix.length;
    const rawArgs = (match[3] || '').trim();
    calls.push({
      name: match[2],
      args: parseObject(rawArgs || '{}') ?? {},
      matched,
    });
    occupied.push([start, start + matched.length]);
  }

  // 中转自创的简写：`[schedule_active_message | 2026-08-04 15:25:00]`。
  const pipeRe = new RegExp(`\\[\\s*(${TOOL_PATTERN})\\s*(?:\\|\\s*([^\\]]*))?\\]`, 'g');
  for (const match of content.matchAll(pipeRe)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (occupied.some(([a, b]) => start < b && end > a)) continue;
    calls.push({
      name: match[1],
      args: parsePipeArgs(match[1], match[2] || ''),
      matched: match[0],
    });
  }

  return calls.slice(0, 6);
};

export const stripAmsg2TextToolCalls = (
  content: string,
  calls: Amsg2TextToolCall[] = extractAmsg2TextToolCalls(content),
): string => {
  let cleaned = content || '';
  for (const call of calls) cleaned = cleaned.replace(call.matched, '');
  return cleaned.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};
