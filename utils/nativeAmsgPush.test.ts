import { beforeEach, describe, expect, it, vi } from 'vitest';

const { push, activeClient, activeStore, db, flushInboxToChat, handlers } = vi.hoisted(() => {
  const handlers: Record<string, (...args: any[]) => any> = {};
  return {
    handlers,
    activeClient: { registerNativePushToken: vi.fn().mockResolvedValue(undefined) },
    activeStore: { saveInboxMessage: vi.fn().mockResolvedValue(undefined) },
    db: { getAllCharacters: vi.fn().mockResolvedValue([]) },
    flushInboxToChat: vi.fn().mockResolvedValue(undefined),
    push: {
      createChannel: vi.fn().mockResolvedValue(undefined),
      addListener: vi.fn().mockImplementation(async (event: string, handler: (...args: any[]) => any) => {
        handlers[event] = handler;
        return { remove: vi.fn() };
      }),
      checkPermissions: vi.fn().mockResolvedValue({ receive: 'prompt' }),
      requestPermissions: vi.fn().mockResolvedValue({ receive: 'granted' }),
      getDeliveredNotifications: vi.fn().mockResolvedValue({ notifications: [] }),
      register: vi.fn().mockImplementation(async () => {
        await handlers.registration?.({ value: 'fcm-native-token' });
      }),
    },
  };
});

vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: push }));
vi.mock('./activeMsgClient', () => ({
  ActiveMsgClient: activeClient,
  NATIVE_PUSH_PERMISSION_STORAGE_KEY: 'permission',
  NATIVE_PUSH_TOKEN_STORAGE_KEY: 'token',
}));
vi.mock('./activeMsgStore', () => ({ ActiveMsgStore: activeStore }));
vi.mock('./activeMsgRuntime', () => ({ flushInboxToChat }));
vi.mock('./db', () => ({ DB: db }));

import {
  decodeNativeAmsgPayload,
  recoverDeliveredNativeAmsg,
  requestNativeAmsgPushRegistration,
} from './nativeAmsgPush';

const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});

describe('native AMSG2 payload bridge', () => {
  it('用通知正文还原被 Worker 去重掉的 message 字段', () => {
    const payload = decodeNativeAmsgPayload({
      body: '你好呀',
      data: {
        amsgHasBody: '1',
        amsgPayload: JSON.stringify({ messageId: 'm1', metadata: { charId: 'c1' } }),
      },
    });
    expect(payload?.message).toBe('你好呀');
    expect(payload?.metadata.charId).toBe('c1');
  });

  it('restores the body from Android notification-tap Intent data', () => {
    const payload = decodeNativeAmsgPayload({
      data: {
        amsgHasBody: '1',
        amsgPayload: JSON.stringify({ messageId: 'm2', metadata: { charId: 'c1' } }),
        'gcm.n.body': 'cold-start body',
      },
    });
    expect(payload?.message).toBe('cold-start body');
  });

  it('restores the body from the native replay field', () => {
    const payload = decodeNativeAmsgPayload({
      data: {
        amsgHasBody: '1',
        amsgBody: 'replay body',
        amsgPayload: JSON.stringify({ messageId: 'm3', metadata: { charId: 'c1' } }),
      },
    });
    expect(payload?.message).toBe('replay body');
  });

  it('does not acknowledge a content notification whose body cannot be restored', () => {
    expect(decodeNativeAmsgPayload({
      data: {
        amsgHasBody: '1',
        amsgPayload: JSON.stringify({ messageId: 'm4', metadata: { charId: 'c1' } }),
      },
    })).toBeNull();
  });

  it('recovers a still-visible notification when the app icon was opened directly', async () => {
    db.getAllCharacters.mockResolvedValue([{ id: 'char-1', name: 'Sully' }]);
    await recoverDeliveredNativeAmsg({
      id: 'system-id', tag: 'message-from-tag', title: 'Sully', body: '你回来啦', data: {},
    });
    expect(activeStore.saveInboxMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-from-tag', charId: 'char-1', body: '你回来啦',
    }));
    expect(flushInboxToChat).toHaveBeenCalled();
  });

  it('非 AMSG2 FCM 通知不接管', () => {
    expect(decodeNativeAmsgPayload({ body: '普通通知', data: {} })).toBeNull();
  });

  it('原生按钮申请系统权限、注册 FCM，并返回收到的 token', async () => {
    await expect(requestNativeAmsgPushRegistration()).resolves.toBe('fcm-native-token');
    expect(push.requestPermissions).toHaveBeenCalled();
    expect(push.register).toHaveBeenCalled();
    expect(values.get('permission')).toBe('granted');
    expect(values.get('token')).toBe('fcm-native-token');
    expect(activeClient.registerNativePushToken).toHaveBeenCalledWith('fcm-native-token');
  });
});
