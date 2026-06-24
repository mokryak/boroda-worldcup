import { beforeEach, describe, expect, it } from "vitest";
import { clearRememberedEditIdentity, getRememberedEditIdentity, rememberEditIdentity } from "./editMemory";

describe("edit memory", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("remembers the latest edit identity", () => {
    rememberEditIdentity({ editToken: "player-1-token", displayName: "Игрок 1" });
    rememberEditIdentity({ editToken: "player-2-token", displayName: "Игрок 2" });

    expect(getRememberedEditIdentity()).toEqual({
      editToken: "player-2-token",
      displayName: "Игрок 2"
    });
  });

  it("clears only the saved edit identity", () => {
    window.localStorage.setItem("worldcup-predictor-db", "keep-me");
    rememberEditIdentity({ editToken: "player-1-token", displayName: "Игрок 1" });

    clearRememberedEditIdentity();

    expect(getRememberedEditIdentity()).toBeNull();
    expect(window.localStorage.getItem("worldcup-predictor-db")).toBe("keep-me");
  });
});

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value)
    }
  });
}
