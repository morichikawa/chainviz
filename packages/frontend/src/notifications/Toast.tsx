import { useLanguage } from "../i18n/LanguageProvider.js";
import type { Notification } from "./notificationStore.js";

export interface ToastStackProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

/**
 * 画面隅に積まれるトースト通知の一覧。コマンド失敗のエラー表示に使う（#39）。
 * 各トーストは手動で閉じられる。
 */
export function ToastStack({ notifications, onDismiss }: ToastStackProps) {
  const { t } = useLanguage();
  if (notifications.length === 0) return null;

  return (
    <div className="toast-stack" role="region" aria-label={t("toast.region")}>
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`toast toast--${notification.kind}`}
          role="alert"
          data-testid={`toast-${notification.id}`}
        >
          <span className="toast__message">{notification.message}</span>
          <button
            type="button"
            className="toast__dismiss"
            aria-label={t("toast.dismiss")}
            onClick={() => onDismiss(notification.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
