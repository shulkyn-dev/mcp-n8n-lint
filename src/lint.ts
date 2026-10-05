import { RULES } from "./rules.js";
import type { Finding, N8nWorkflow, Severity } from "./types.js";

export class InputError extends Error {}

export interface LintResult {
  summary: Record<Severity, number> & { total: number };
  findings: Finding[];
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Accept a workflow object or a JSON string; throw InputError (never echoing the input) if it is not a workflow export. */
export function parseWorkflow(input: unknown): N8nWorkflow {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      // The parser message can quote part of the input, so it is deliberately not forwarded.
      throw new InputError("Input is not valid JSON.");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError("Workflow must be a JSON object.");
  }
  const wf = value as Record<string, unknown>;
  if (!Array.isArray(wf.nodes) || wf.nodes.some((n) => !n || typeof n !== "object" || Array.isArray(n))) {
    throw new InputError('Workflow must have a "nodes" array of objects.');
  }
  return wf as N8nWorkflow;
}

export function lintWorkflow(input: unknown): LintResult {
  const wf = parseWorkflow(input);
  const findings = RULES.flatMap((rule) => rule.check(wf)).sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      (a.node ?? "").localeCompare(b.node ?? ""),
  );
  const summary = { error: 0, warning: 0, info: 0, total: findings.length };
  for (const f of findings) summary[f.severity] += 1;
  return { summary, findings };
}
