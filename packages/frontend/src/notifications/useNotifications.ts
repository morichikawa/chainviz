import { useCallback, useRef, useState } from "react";
import {
  type Notification,
  type NotificationInput,
  addNotification,
  dismissNotification,
} from "./notificationStore.js";

export interface UseNotificationsResult {
  notifications: Notification[];
  /** 通知を1件追加し、採番した id を返す。 */
  notify: (input: NotificationInput) => string;
  /** 指定 id の通知を消す。 */
  dismiss: (id: string) => void;
}

/**
 * トースト通知の一覧を管理するフック。id は単調増加カウンタで採番する。
 * `notify` / `dismiss` は安定した参照を返すので依存配列に入れても再生成
 * ループを起こさない。
 */
export function useNotifications(): UseNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const counterRef = useRef(0);

  const notify = useCallback((input: NotificationInput) => {
    const id = `notif-${++counterRef.current}`;
    setNotifications((list) => addNotification(list, id, input));
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((list) => dismissNotification(list, id));
  }, []);

  return { notifications, notify, dismiss };
}
