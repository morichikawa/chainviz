// SignatureDemoView の操作フロー(編集→追従→改ざん→無効化→攻撃者再署名→
// なりすまし不成立→Alice再署名→有効化→リセット)のコンポーネントテスト
// (Issue #402)。文言・i18n観点は SignatureDemoView.i18n.test.tsx に分ける
// (CLAUDE.md の1ファイル1責務)。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SignatureDemoView } from "./SignatureDemoView.js";

function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <SignatureDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

function badgeText(): string | null {
  return screen.getByTestId("signature-demo-badge").textContent;
}

afterEach(cleanup);

describe("SignatureDemoView: pristine initial state", () => {
  it("renders as valid, with no resign buttons and no result message", () => {
    renderView();
    expect(screen.getByTestId("signature-demo")).toBeTruthy();
    expect(badgeText()).toBe("有効: 復元されたアドレスが送信者と一致");
    expect(screen.queryByTestId("signature-demo-resign-attacker")).toBeNull();
    expect(screen.queryByTestId("signature-demo-resign-alice")).toBeNull();
    expect(screen.queryByTestId("signature-demo-result-attacker")).toBeNull();
    expect(screen.queryByTestId("signature-demo-result-alice")).toBeNull();
  });

  it("mirrors the same signature value in both zones", () => {
    renderView();
    const workbenchSignature = screen.getByTestId("signature-demo-signature").title;
    const receivedSignature = screen.getByTestId("signature-demo-received-signature").title;
    expect(workbenchSignature).toBe(receivedSignature);
  });
});

describe("SignatureDemoView: editing the workbench re-signs and stays valid", () => {
  it("changes the signature value but keeps the demo valid, and the received fields follow along", () => {
    renderView();
    const signatureBefore = screen.getByTestId("signature-demo-signature").title;

    fireEvent.change(screen.getByTestId("signature-demo-workbench-amount"), {
      target: { value: "999" },
    });

    expect(screen.getByTestId("signature-demo-signature").title).not.toBe(signatureBefore);
    expect(badgeText()).toBe("有効: 復元されたアドレスが送信者と一致");
    expect(
      (screen.getByTestId("signature-demo-received-amount") as HTMLInputElement).value,
    ).toBe("999");
  });
});

describe("SignatureDemoView: tampering the received content breaks verification", () => {
  it("shows the invalid badge and both resign buttons after editing the received amount", () => {
    renderView();
    fireEvent.change(screen.getByTestId("signature-demo-received-amount"), {
      target: { value: "999" },
    });

    expect(badgeText()).toBe("無効: 復元されたアドレスが送信者と一致しません");
    expect(screen.getByTestId("signature-demo-resign-attacker")).toBeTruthy();
    expect(screen.getByTestId("signature-demo-resign-alice")).toBeTruthy();
  });

  it("does not change the workbench-side signature (only what arrived is edited)", () => {
    renderView();
    const signatureBefore = screen.getByTestId("signature-demo-signature").title;
    fireEvent.change(screen.getByTestId("signature-demo-received-to"), {
      target: { value: "0xdeadbeef00000000000000000000000000dead" },
    });
    expect(screen.getByTestId("signature-demo-signature").title).toBe(signatureBefore);
  });
});

describe("SignatureDemoView: resigning as the attacker cannot impersonate the sender", () => {
  it("stays invalid and shows the attacker-specific result message", () => {
    renderView();
    fireEvent.change(screen.getByTestId("signature-demo-received-amount"), {
      target: { value: "999" },
    });
    fireEvent.click(screen.getByTestId("signature-demo-resign-attacker"));

    expect(badgeText()).toBe("無効: 復元されたアドレスが送信者と一致しません");
    expect(screen.getByTestId("signature-demo-result-attacker")).toBeTruthy();
    expect(screen.queryByTestId("signature-demo-result-alice")).toBeNull();
  });
});

describe("SignatureDemoView: only Alice can re-sign valid content", () => {
  it("returns to the valid badge and shows the alice-specific result message", () => {
    renderView();
    fireEvent.change(screen.getByTestId("signature-demo-received-amount"), {
      target: { value: "999" },
    });
    fireEvent.click(screen.getByTestId("signature-demo-resign-alice"));

    expect(badgeText()).toBe("有効: 復元されたアドレスが送信者と一致");
    expect(screen.getByTestId("signature-demo-result-alice")).toBeTruthy();
    expect(screen.queryByTestId("signature-demo-resign-attacker")).toBeNull();
  });
});

describe("SignatureDemoView: the result message clears once the user acts again", () => {
  it("hides the attacker result message after editing the workbench again", () => {
    renderView();
    fireEvent.change(screen.getByTestId("signature-demo-received-amount"), {
      target: { value: "999" },
    });
    fireEvent.click(screen.getByTestId("signature-demo-resign-attacker"));
    expect(screen.getByTestId("signature-demo-result-attacker")).toBeTruthy();

    fireEvent.change(screen.getByTestId("signature-demo-workbench-amount"), {
      target: { value: "5" },
    });
    expect(screen.queryByTestId("signature-demo-result-attacker")).toBeNull();
  });
});

describe("SignatureDemoView: reset", () => {
  it("returns to the pristine (valid, no result message) state after tampering and resigning", () => {
    renderView();
    fireEvent.change(screen.getByTestId("signature-demo-received-amount"), {
      target: { value: "999" },
    });
    fireEvent.click(screen.getByTestId("signature-demo-resign-attacker"));
    expect(badgeText()).toBe("無効: 復元されたアドレスが送信者と一致しません");

    fireEvent.click(screen.getByTestId("signature-demo-reset"));
    expect(badgeText()).toBe("有効: 復元されたアドレスが送信者と一致");
    expect(screen.queryByTestId("signature-demo-result-attacker")).toBeNull();
    expect(
      (screen.getByTestId("signature-demo-received-amount") as HTMLInputElement).value,
    ).toBe("1");
  });
});
