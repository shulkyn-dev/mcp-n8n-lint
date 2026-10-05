import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InputError, lintWorkflow } from "./lint.js";
import { RULES, getRule } from "./rules.js";

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const ok = (data: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});

const fail = (message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

export function createServer(): McpServer {
  const server = new McpServer({ name: "mcp-n8n-lint", version: "0.1.0" });

  server.registerTool(
    "lint_workflow",
    {
      title: "Lint n8n workflow",
      description:
        "Check an n8n workflow export (JSON) for reliability problems. Pass the workflow as an object or as a JSON string. Returns a severity summary and a list of findings.",
      inputSchema: {
        workflow: z
          .union([z.string(), z.record(z.string(), z.unknown())])
          .describe("n8n workflow export, as an object or a JSON string"),
      },
    },
    async ({ workflow }) => {
      try {
        return ok({ ...lintWorkflow(workflow) });
      } catch (err) {
        if (err instanceof InputError) return fail(err.message);
        throw err;
      }
    },
  );

  server.registerTool(
    "list_rules",
    {
      title: "List lint rules",
      description: "List all lint rules with id, name, severity and description.",
      inputSchema: {},
    },
    async () => ok({ rules: RULES.map(({ id, name, severity, description }) => ({ id, name, severity, description })) }),
  );

  server.registerTool(
    "explain_rule",
    {
      title: "Explain lint rule",
      description: "Explain why a rule exists and how to fix a finding. Also lists fields the rule relies on that the n8n docs do not confirm.",
      inputSchema: { ruleId: z.string().describe('Rule id, for example "R002"') },
    },
    async ({ ruleId }) => {
      const rule = getRule(ruleId);
      if (!rule) return fail(`Unknown rule "${ruleId.slice(0, 40)}". Known rules: ${RULES.map((r) => r.id).join(", ")}.`);
      const { id, name, severity, description, why, howToFix, unconfirmed } = rule;
      return ok({ id, name, severity, description, why, howToFix, unconfirmed });
    },
  );

  return server;
}
