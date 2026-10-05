import { describe, expect, it } from "vitest";
import { lintWorkflow } from "../src/lint.js";
import { loadFixtureText } from "./helpers.js";

/** Every secret literal planted in the fixtures. None of them may appear in any output. */
const PLANTED = [
  "fake-bearer-token-0000000000000000",
  "literal-header-value-for-test",
  "sk-test-00000000000000000000000000000000",
  "0123456789abcdef0123456789abcdef0123",
  "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5",
  "fake-pw-value-for-test-only-1",
];

describe("secrets never reach the output", () => {
  for (const name of ["r005-bad", "all-bad"]) {
    it(`${name}: no planted secret (whole or partial) appears in the lint result`, () => {
      const text = loadFixtureText(name);
      const planted = PLANTED.filter((s) => text.includes(s));
      expect(planted.length).toBeGreaterThan(0); // the fixture really contains secrets

      const output = JSON.stringify(lintWorkflow(text));
      for (const secret of planted) {
        expect(output).not.toContain(secret);
        // also no 8-character window of the secret, so a prefix or a suffix cannot leak either
        for (let i = 0; i + 8 <= secret.length; i++) {
          expect(output).not.toContain(secret.slice(i, i + 8));
        }
      }
    });
  }

  it("an invalid JSON string containing a secret is not echoed in the error", () => {
    const input = '{"apiKey": "sk-test-00000000000000000000000000000000" oops';
    let message = "";
    try {
      lintWorkflow(input);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe("Input is not valid JSON.");
    expect(message).not.toContain("sk-test");
  });
});
