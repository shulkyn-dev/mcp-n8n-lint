import { describe, expect, it } from "vitest";
import { InputError, lintWorkflow } from "../src/lint.js";
import { RULES } from "../src/rules.js";
import { loadFixture, loadFixtureText } from "./helpers.js";

const ids = (name: string) => lintWorkflow(loadFixture(name)).findings.map((f) => f.ruleId);

describe("each rule fires on its bad fixture and stays silent on its good fixture", () => {
  for (const rule of RULES) {
    const key = rule.id.toLowerCase();

    it(`${rule.id} ${rule.name}: bad fixture triggers only this rule`, () => {
      const found = ids(`${key}-bad`);
      expect(found.length).toBeGreaterThan(0);
      expect(new Set(found)).toEqual(new Set([rule.id]));
    });

    it(`${rule.id} ${rule.name}: good fixture produces no finding of this rule`, () => {
      expect(ids(`${key}-good`)).not.toContain(rule.id);
    });
  }

  it("clean fixture produces no findings at all", () => {
    expect(lintWorkflow(loadFixture("clean"))).toEqual({
      summary: { error: 0, warning: 0, info: 0, total: 0 },
      findings: [],
    });
  });
});

describe("rule details", () => {
  it("has exactly 8 rules R001..R008 with the specified severities", () => {
    expect(RULES.map((r) => [r.id, r.severity])).toEqual([
      ["R001", "warning"],
      ["R002", "warning"],
      ["R003", "warning"],
      ["R004", "warning"],
      ["R005", "error"],
      ["R006", "info"],
      ["R007", "info"],
      ["R008", "warning"],
    ]);
  });

  it("R001 is a workflow-level finding (node is null)", () => {
    const [f] = lintWorkflow(loadFixture("r001-bad")).findings;
    expect(f.node).toBeNull();
  });

  it("R003 covers onError continue modes and legacy continueOnFail", () => {
    const nodes = lintWorkflow(loadFixture("r003-bad")).findings.map((f) => f.node);
    expect(nodes.sort()).toEqual(
      ["Fetch customer from CRM API", "Fetch order from billing API", "Push result to ERP API"].sort(),
    );
  });

  it("R004 flags both a missing authentication key and authentication: none", () => {
    expect(lintWorkflow(loadFixture("r004-bad")).findings.map((f) => f.node).sort()).toEqual([
      "Receive order",
      "Receive refund",
    ]);
  });

  it("R005 reports six distinct secret shapes and skips expressions, empty values and non-secret keys", () => {
    const r005 = lintWorkflow(loadFixture("r005-bad")).findings;
    expect(r005).toHaveLength(6);
    expect(lintWorkflow(loadFixture("r005-good")).findings).toHaveLength(0);
  });

  it("R007 matches names with numeric suffixes", () => {
    expect(lintWorkflow(loadFixture("r007-bad")).findings.map((f) => f.node).sort()).toEqual([
      "Code",
      "Edit Fields2",
      "HTTP Request1",
    ]);
  });

  it("R008 ignores sticky notes, triggers and nodes connected only via ai_* connections", () => {
    expect(ids("r008-good")).toEqual([]);
    expect(lintWorkflow(loadFixture("r008-bad")).findings.map((f) => f.node)).toEqual(["Unused cleanup step"]);
  });

  it("sorts findings by severity: error, then warning, then info", () => {
    const order = lintWorkflow(loadFixture("all-bad")).findings.map((f) => f.severity);
    expect(order).toEqual([...order].sort((a, b) => ["error", "warning", "info"].indexOf(a) - ["error", "warning", "info"].indexOf(b)));
  });

  it("accepts the workflow as a JSON string and as an object, with the same result", () => {
    expect(lintWorkflow(loadFixtureText("all-bad"))).toEqual(lintWorkflow(loadFixture("all-bad")));
  });

  it("rejects input that is not a workflow", () => {
    expect(() => lintWorkflow("{not json")).toThrow(InputError);
    expect(() => lintWorkflow("[]")).toThrow(InputError);
    expect(() => lintWorkflow({ name: "no nodes" })).toThrow(InputError);
  });
});
