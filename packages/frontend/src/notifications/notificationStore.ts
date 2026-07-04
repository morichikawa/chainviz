/**
 * 画面隅に一時的に出すトースト通知。現状はコマンド失敗のエラー表示に使う
 * （#39）。将来 info/success 種別を足せるよう kind を持たせておく。
 */
export type NotificationKind = "error" | "info";

export interface Notification {
  id: string;
  kind: NotificationKind;
  message: string;
}

export interface NotificationInput {
  kind: NotificationKind;
  message: string;
}

/**
 * 通知を末尾に追加した新しい配列を返す（イミュータブル）。id は呼び出し側で
 * 一意に採番して渡す。
 */
export function addNotification(
  list: Notification[],
  id: string,
  input: NotificationInput,
): Notification[] {
  return [...list, { id, kind: input.kind, message: input.message }];
}

/** 指定 id の通知を取り除いた新しい配列を返す（イミュータブル）。 */
export function dismissNotification(
  list: Notification[],
  id: string,
): Notification[] {
  return list.filter((n) => n.id !== id);
}
