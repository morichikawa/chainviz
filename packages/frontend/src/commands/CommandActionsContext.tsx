import { type ReactNode, createContext, useContext } from "react";
import type { CommandActions } from "./useCommands.js";

const CommandActionsContext = createContext<CommandActions | null>(null);

export interface CommandActionsProviderProps {
  actions: CommandActions;
  children: ReactNode;
}

/**
 * 操作コマンドのアクション群を配下に配る Provider。React Flow のカスタム
 * ノード（InfraNodeCard）はキャンバス内部に描画されるため、props ではなく
 * context 経由で削除アクションを渡す。
 */
export function CommandActionsProvider({
  actions,
  children,
}: CommandActionsProviderProps) {
  return (
    <CommandActionsContext.Provider value={actions}>
      {children}
    </CommandActionsContext.Provider>
  );
}

/** Provider 配下で操作コマンドのアクション群を取り出す。 */
export function useCommandActions(): CommandActions {
  const ctx = useContext(CommandActionsContext);
  if (!ctx) {
    throw new Error(
      "useCommandActions must be used within a CommandActionsProvider",
    );
  }
  return ctx;
}
