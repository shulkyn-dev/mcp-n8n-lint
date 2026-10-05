import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadFixture, loadFixtureText } from "./helpers.js";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

let client: Client;

const textOf = (result: unknown): string =>
  ((result as { content: { type: string; text: string }[] }).content[0] as { text: string }).text;

beforeAll(async () => {
  expect(existsSync(SERVER), "run `npm run build` first").toBe(true);
  client = new Client({ name: "e2e-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER] }));
});

afterAll(async () => {
  await client.close();
});

describe("built MCP server over stdio", () => {
  it("exposes exactly the three tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["explain_rule", "lint_workflow", "list_rules"]);
  });

  it("list_rules returns the 8 rules", async () => {
    const result = await client.callTool({ name: "list_rules", arguments: {} });
    const { rules } = JSON.parse(textOf(result));
    expect(rules.map((r: { id: string }) => r.id)).toEqual(["R001", "R002", "R003", "R004", "R005", "R006", "R007", "R008"]);
    for (const r of rules) expect(Object.keys(r).sort()).toEqual(["description", "id", "name", "severity"]);
  });

  it("lint_workflow on the bad fixture (object input) returns summary and findings", async () => {
    const result = await client.callTool({ name: "lint_workflow", arguments: { workflow: loadFixture("all-bad") } });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(textOf(result));
    expect(body.summary).toEqual({ error: 2, warning: 4, info: 3, total: 9 });
    expect(new Set(body.findings.map((f: { ruleId: string }) => f.ruleId))).toEqual(
      new Set(["R001", "R003", "R004", "R005", "R006", "R007", "R008"]),
    );
    for (const f of body.findings) {
      expect(Object.keys(f).sort()).toEqual(["fix", "message", "node", "ruleId", "severity"]);
    }
    expect(body.findings.find((f: { ruleId: string }) => f.ruleId === "R001").node).toBeNull();
    expect(result.structuredContent).toEqual(body);
  });

  it("lint_workflow accepts a JSON string and the secrets do not leak through the protocol", async () => {
    const text = loadFixtureText("all-bad");
    const result = await client.callTool({ name: "lint_workflow", arguments: { workflow: text } });
    const out = JSON.stringify(result);
    expect(out).not.toContain("sk-test");
    expect(out).not.toContain("fake-bearer-token");
    expect(JSON.parse(textOf(result)).summary.total).toBe(9);
  });

  it("lint_workflow returns a tool error for input that is not a workflow", async () => {
    const result = await client.callTool({ name: "lint_workflow", arguments: { workflow: "{broken" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Input is not valid JSON.");
  });

  it("explain_rule explains a rule and flags unconfirmed fields", async () => {
    const result = await client.callTool({ name: "explain_rule", arguments: { ruleId: "R004" } });
    const body = JSON.parse(textOf(result));
    expect(body.id).toBe("R004");
    expect(body.why.length).toBeGreaterThan(20);
    expect(body.howToFix.length).toBeGreaterThan(20);
    expect(body.unconfirmed.join(" ")).toContain("not documented");
  });

  it("explain_rule returns a tool error for an unknown rule", async () => {
    const result = await client.callTool({ name: "explain_rule", arguments: { ruleId: "R999" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("R001");
  });
});
