import {
  PushNotifications,
  type ActionPerformed,
  type PushNotificationSchema,
  type Token,
} from '@capacitor/push-notifications';
import type { ActiveMsg2InboxMessage } from '../types';
import {
  ActiveMsgClient,
  NATIVE_PUSH_PERMISSION_STORAGE_KEY,
  NATIVE_PUSH_TOKEN_STORAGE_KEY,
} from './activeMsgClient';
import { ActiveMsgStore } from './activeMsgStore';
import { flushInboxToChat } from './activeMsgRuntime';
import { DB } from './db';

const RECEIVED_IDS_KEY = 'amsg2_native_received_ids_v1';
let initialized = false;
let listenersReady = false;

const readReceivedIds = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECEIVED_IDS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
};

const rememberReceivedId = (messageId: string) => {
  const next = [messageId, ...readReceivedIds().filter((id) => id !== messageId)].slice(0, 100);
  localStorage.setItem(RECEIVED_IDS_KEY, JSON.stringify(next));
};

export const decodeNativeAmsgPayload = (
  notification: Pick<PushNotificationSchema, 'body' | 'data'>,
): Record<string, any> | null => {
  const data = notification.data || {};
  const raw = data.amsgPayload;
  if (typeof raw !== 'string' && (!raw || typeof raw !== 'object')) return null;
  try {
    const payload = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, any>;
    const hasBody = data.amsgHasBody === '1' || data.amsgHasBody === 1 || data.amsgHasBody === true;
    const recoveredBody = [
      data.amsgBody,
      notification.body,
      // Capacitor's Android tap callback only exposes Intent extras. Firebase
      // stores the visible notification body under this key in that callback.
      data['gcm.n.body'],
      data['gcm.notification.body'],
      payload.message,
      payload.body,
    ].find((value) => typeof value === 'string' && value.length > 0);
    // Do not acknowledge an AMSG content notification until its text can be
    // reconstructed. A delivered-notification recovery pass can retry it.
    if (hasBody && typeof recoveredBody !== 'string') return null;
    payload.message = hasBody ? String(recoveredBody || '') : String(payload.message || payload.body || '');
    return payload;
  } catch { return null; }
};

const ingestNotification = async (notification: PushNotificationSchema): Promise<void> => {
  const payload = decodeNativeAmsgPayload(notification);
  const charId = payload?.metadata?.charId;
  if (!payload || typeof charId !== 'string' || !charId) return;
  const messageId = String(payload.messageId || `${charId}-${Date.now()}`);
  if (readReceivedIds().includes(messageId)) return;

  const parsedSentAt = payload.timestamp ? new Date(payload.timestamp).getTime() : NaN;
  const body = String(payload.message || '').trim();
  const inbox: ActiveMsg2InboxMessage = {
    messageId,
    charId,
    charName: String(payload.contactName || payload.metadata?.charName || '主动消息'),
    body,
    previewBody: String(notification.body || body).trim(),
    avatarUrl: payload.avatarUrl,
    source: payload.source,
    messageType: payload.messageType,
    messageSubtype: payload.messageSubtype,
    taskId: payload.taskId ?? null,
    taskUuid: payload.taskUuid ?? null,
    recurrenceType: payload.recurrenceType ?? null,
    occurrenceMs: payload.occurrenceMs ?? null,
    metadata: {
      ...(payload.metadata || {}),
      sessionId: payload.sessionId,
      messageIndex: payload.messageIndex,
      totalMessages: payload.totalMessages,
    },
    sentAt: Number.isFinite(parsedSentAt) ? parsedSentAt : Date.now(),
    receivedAt: Date.now(),
  };
  await ActiveMsgStore.saveInboxMessage(inbox);
  rememberReceivedId(messageId);
  await flushInboxToChat();
};

export const recoverDeliveredNativeAmsg = async (notification: PushNotificationSchema): Promise<void> => {
  if (decodeNativeAmsgPayload(notification)) {
    await ingestNotification(notification);
    return;
  }

  // Firebase keeps custom data on the notification's tap Intent, not on
  // Notification.extras. When the user opens the app icon instead of tapping
  // the notification, Capacitor can therefore return only title/body/tag.
  const title = String(notification.title || '').trim();
  const body = String(notification.body || '').trim();
  const messageId = String(notification.tag || '').trim();
  if (!title || !body || !messageId) return;

  const characters = await DB.getAllCharacters();
  const matches = characters.filter((character) => character.name?.trim() === title);
  if (matches.length !== 1) return;

  await ingestNotification({
    ...notification,
    data: {
      ...(notification.data || {}),
      amsgHasBody: '1',
      amsgBody: body,
      amsgPayload: JSON.stringify({
        messageId,
        contactName: title,
        metadata: { charId: matches[0].id, recoveredFromDeliveredNotification: true },
      }),
    },
  });
};

const registerToken = async (token: Token) => {
  const value = token.value?.trim();
  if (!value) return;
  localStorage.setItem(NATIVE_PUSH_TOKEN_STORAGE_KEY, value);
  try {
    await ActiveMsgClient.registerNativePushToken(value);
  } catch (error) {
    console.info('[ActiveMsg:native] token 已保存，等待 Worker 连接后补登记', error);
  }
};

const ensureNativePushListeners = async (): Promise<void> => {
  if (listenersReady) return;
  listenersReady = true;
  await PushNotifications.createChannel({
    id: 'amsg2', name: '主动消息', description: '角色主动消息与定时消息',
    importance: 5, visibility: 1, vibration: true,
  }).catch(() => undefined);
  await PushNotifications.addListener('registration', registerToken);
  await PushNotifications.addListener('registrationError', (error) =>
    console.warn('[ActiveMsg:native] FCM registration 失败', error));
  await PushNotifications.addListener('pushNotificationReceived', (notification) =>
    void ingestNotification(notification));
  await PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
    void ingestNotification(action.notification).then(() => {
      const charId = decodeNativeAmsgPayload(action.notification)?.metadata?.charId;
      if (typeof charId === 'string' && charId) {
        window.dispatchEvent(new CustomEvent('active-msg-open', { detail: { charId } }));
      }
    });
  });

  // Notification messages received while Android has suspended/killed the
  // WebView are displayed by the OS without firing a JavaScript receive event.
  // Recover still-visible AMSG notifications whenever the app starts.
  void PushNotifications.getDeliveredNotifications()
    .then(({ notifications }) => Promise.all(notifications.map((notification) => recoverDeliveredNativeAmsg(notification))))
    .catch((error) => console.info('[ActiveMsg:native] delivered notification recovery unavailable', error));
};

const waitForNativeToken = async (timeoutMs = 10_000): Promise<string | null> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const token = localStorage.getItem(NATIVE_PUSH_TOKEN_STORAGE_KEY)?.trim();
    if (token) return token;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return localStorage.getItem(NATIVE_PUSH_TOKEN_STORAGE_KEY)?.trim() || null;
};

export const requestNativeAmsgPushRegistration = async (): Promise<string | null> => {
  await ensureNativePushListeners();
  const current = await PushNotifications.checkPermissions();
  const permission = current.receive === 'prompt' || current.receive === 'prompt-with-rationale'
    ? await PushNotifications.requestPermissions()
    : current;
  localStorage.setItem(NATIVE_PUSH_PERMISSION_STORAGE_KEY, permission.receive);
  if (permission.receive !== 'granted') return null;
  const existing = localStorage.getItem(NATIVE_PUSH_TOKEN_STORAGE_KEY)?.trim();
  if (existing) {
    await registerToken({ value: existing });
    return existing;
  }
  await PushNotifications.register();
  return waitForNativeToken();
};

export const initNativeAmsgPush = async (): Promise<void> => {
  if (initialized) return;
  initialized = true;
  await requestNativeAmsgPushRegistration();
};
