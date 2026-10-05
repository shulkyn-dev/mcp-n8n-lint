export type Severity = "error" | "warning" | "info";

export interface N8nNode {
  name?: string;
  type?: string;
  disabled?: boolean;
  retryOnFail?: boolean;
  onError?: string;
  continueOnFail?: boolean;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface N8nWorkflow {
  nodes: N8nNode[];
  connections?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  /** Node name, or null for workflow-level findings. */
  node: string | null;
  message: string;
  fix: string;
}

export interface RuleInfo {
  id: string;
  name: string;
  severity: Severity;
  description: string;
  /** Why the rule exists. */
  why: string;
  /** How to fix a finding. */
  howToFix: string;
  /** Fields the rule relies on that docs.n8n.io does not confirm. Empty if all are documented. */
  unconfirmed: string[];
}

export interface Rule extends RuleInfo {
  check(workflow: N8nWorkflow): Finding[];
}
