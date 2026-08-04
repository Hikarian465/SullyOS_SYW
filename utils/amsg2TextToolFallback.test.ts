import { describe, expect, it } from 'vitest';
import { extractAmsg2TextToolCalls, stripAmsg2TextToolCalls } from './amsg2TextToolFallback';

describe('amsg2 正文工具调用兼容', () => {
  it('识别手机现场出现的方括号竖线排程格式，并归一化时间', () => {
    const raw = '收到，继续排查。\n[schedule_active_message | 2026-08-04 15:28:00]';
    expect(extractAmsg2TextToolCalls(raw)).toEqual([{
      name: 'schedule_active_message',
      args: { send_at: '2026-08-04T15:28:00', expire_policy: 'force' },
      matched: '[schedule_active_message | 2026-08-04 15:28:00]',
    }]);
    expect(stripAmsg2TextToolCalls(raw)).toBe('收到，继续排查。');
  });

  it('方括号简写可显式要求自动作废，完整 JSON 仍尊重原策略', () => {
    expect(extractAmsg2TextToolCalls(
      '[schedule_active_message | 2026-08-05 09:00:00 | expire]',
    )[0].args).toEqual({
      send_at: '2026-08-05T09:00:00',
      expire_policy: 'expire',
    });
    expect(extractAmsg2TextToolCalls(
      '[schedule_active_message | {"send_at":"2026-08-05T09:00:00","expire_policy":"expire"}]',
    )[0].args).toEqual({ send_at: '2026-08-05T09:00:00', expire_policy: 'expire' });
  });

  it('识别标准 JSON 正文调用', () => {
    const [call] = extractAmsg2TextToolCalls(
      'schedule_active_message({"send_at":"2026-08-05T09:00:00","expire_policy":"force"})',
    );
    expect(call.name).toBe('schedule_active_message');
    expect(call.args).toEqual({ send_at: '2026-08-05T09:00:00', expire_policy: 'force' });
  });

  it('兼容取消与续期的简写', () => {
    expect(extractAmsg2TextToolCalls('[cancel_active_message | 2b0360a1]')[0].args)
      .toEqual({ task_id: '2b0360a1' });
    expect(extractAmsg2TextToolCalls('[renew_active_message | 2026-08-05 10:00:00 | 2b0360a1]')[0].args)
      .toEqual({ send_at: '2026-08-05T10:00:00', task_id: '2b0360a1' });
  });
});
