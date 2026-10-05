import { findSecrets } from "./secrets.js";
import type { Finding, N8nNode, N8nWorkflow, Rule } from "./types.js";

const HTTP_REQUEST = "n8n-nodes-base.httpRequest";
const WEBHOOK = "n8n-nodes-base.webhook";
const STICKY_NOTE = "n8n-nodes-base.stickyNote";
const CONTINUE_MODES = new Set(["continueRegularOutput", "continueErrorOutput"]);

const DEFAULT_NAMES = [
  "HTTP Request",
  "Edit Fields",
  "Set",
  "Code",
  "IF",
  "Switch",
  "Merge",
  "Filter",
  "Wait",
  "Loop Over Items",
  "Split In Batches",
  "Aggregate",
  "Sort",
  "Limit",
  "Remove Duplicates",
  "Summarize",
  "Split Out",
  "No Operation, do nothing",
  "Function",
  "Function Item",
  "Execute Workflow",
  "Respond to Webhook",
  "Stop and Error",
  "Date & Time",
];
const DEFAULT_NAME_RE = new RegExp(
  `^(${DEFAULT_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\d*$`,
);

const nameOf = (node: N8nNode): string => (typeof node.name === "string" ? node.name : "(unnamed node)");

/** Heuristic: trigger nodes by type name. Not an official classification. */
function isTrigger(node: N8nNode): boolean {
  const type = node.type ?? "";
  return (
    /trigger$/i.test(type) ||
    ["n8n-nodes-base.webhook", "n8n-nodes-base.start", "n8n-nodes-base.cron", "n8n-nodes-base.interval"].includes(type)
  );
}

function nodesOfType(wf: N8nWorkflow, type: string): N8nNode[] {
  return wf.nodes.filter((n) => n.type === type);
}

/** Names of nodes that take part in at least one connection, as source or target, for any connection type. */
function connectedNames(connections: unknown): Set<string> {
  const names = new Set<string>();
  if (!connections || typeof connections !== "object") return names;
  for (const [source, byType] of Object.entries(connections as Record<string, unknown>)) {
    if (!byType || typeof byType !== "object") continue;
    for (const outputs of Object.values(byType as Record<string, unknown>)) {
      if (!Array.isArray(outputs)) continue;
      for (const output of outputs) {
        if (!Array.isArray(output)) continue;
        for (const conn of output) {
          const target = (conn as { node?: unknown } | null)?.node;
          if (typeof target === "string") {
            names.add(source);
            names.add(target);
          }
        }
      }
    }
  }
  return names;
}

export const RULES: Rule[] = [
  {
    id: "R001",
    name: "no-error-workflow",
    severity: "warning",
    description: "The workflow has no error workflow (settings.errorWorkflow is not set).",
    why: "An error workflow runs when an execution fails, so it is where alerts (email, Slack) are sent. Without it, failures of unattended workflows go unnoticed until someone opens the Executions list.",
    howToFix:
      "Create a workflow that starts with an Error Trigger node, then select it under Workflow Settings > Error workflow. One error workflow can serve many workflows.",
    unconfirmed: [],
    check(wf) {
      const value = wf.settings?.errorWorkflow;
      if (typeof value === "string" && value.trim() !== "") return [];
      return [
        {
          ruleId: this.id,
          severity: this.severity,
          node: null,
          message: "No error workflow is configured (settings.errorWorkflow is missing or empty).",
          fix: "Set an error workflow (one that starts with an Error Trigger node) in Workflow Settings.",
        },
      ];
    },
  },
  {
    id: "R002",
    name: "http-no-retry",
    severity: "warning",
    description: "An HTTP Request node does not have Retry On Fail enabled.",
    why: "HTTP calls to external services fail transiently (timeouts, 429, 5xx). Without retries, one blip fails the whole execution.",
    howToFix:
      "Enable Retry On Fail in the node settings (retryOnFail: true) and set Max Tries and Wait Between Tries. Retry only calls that are safe to repeat (idempotent).",
    unconfirmed: ["default of retryOnFail when the field is absent (treated here as false)"],
    check(wf) {
      return nodesOfType(wf, HTTP_REQUEST)
        .filter((n) => n.retryOnFail !== true)
        .map((n) => ({
          ruleId: this.id,
          severity: this.severity,
          node: nameOf(n),
          message: "HTTP Request node has no retries (retryOnFail is not true).",
          fix: "Turn on Retry On Fail for this node and set Max Tries and Wait Between Tries.",
        }));
    },
  },
  {
    id: "R003",
    name: "retry-with-continue",
    severity: "warning",
    description: "A node has Retry On Fail enabled together with a continue-on-error mode.",
    why: "With a continue mode the execution is not marked as failed once the retries run out, so the error workflow does not fire. With continueRegularOutput the error item also travels down the normal output as if it were data. Retries then end in a silent failure.",
    howToFix:
      "Use onError: continueErrorOutput and route the error output to explicit handling (log, alert, fallback), or set onError to stopWorkflow so the error workflow is triggered.",
    unconfirmed: [],
    check(wf) {
      return wf.nodes
        .filter(
          (n) =>
            n.retryOnFail === true &&
            ((typeof n.onError === "string" && CONTINUE_MODES.has(n.onError)) || n.continueOnFail === true),
        )
        .map((n) => ({
          ruleId: this.id,
          severity: this.severity,
          node: nameOf(n),
          message:
            "Retry On Fail is combined with continue-on-error, so a failure after the last retry is swallowed.",
          fix: "Route the error output to explicit handling, or set On Error to Stop Workflow.",
        }));
    },
  },
  {
    id: "R004",
    name: "webhook-no-auth",
    severity: "warning",
    description: "A Webhook node has no authentication (parameters.authentication is absent or \"none\").",
    why: "A public webhook URL accepts requests from anyone who finds it. Without authentication anyone can trigger the workflow with arbitrary data.",
    howToFix:
      "Set Authentication on the Webhook node to Basic auth, Header auth or JWT auth and attach a credential. If the sender cannot authenticate, validate a shared secret or signature in the first node after the webhook.",
    unconfirmed: [
      'parameters.authentication on the Webhook node (key name and the value "none") - based on observed export format, not documented; the docs only list the UI labels Basic auth, Header auth, JWT auth, None',
    ],
    check(wf) {
      return nodesOfType(wf, WEBHOOK)
        .filter((n) => {
          const auth = n.parameters?.authentication;
          return auth === undefined || auth === null || auth === "" || auth === "none";
        })
        .map((n) => ({
          ruleId: this.id,
          severity: this.severity,
          node: nameOf(n),
          message: "Webhook node does not require authentication.",
          fix: "Set Authentication to Basic auth, Header auth or JWT auth on this node.",
        }));
    },
  },
  {
    id: "R005",
    name: "hardcoded-secret",
    severity: "error",
    description: "A node parameter contains a literal that looks like a secret (Bearer token, sk- key, long hex/base64 string, or a filled apiKey/token/password field).",
    why: "Secrets stored in workflow parameters are copied into exports, version history, screenshots and Git. Anyone with the file has the key.",
    howToFix:
      "Rotate the exposed secret, store it in an n8n credential, and reference the credential in the node instead of typing the value into a parameter.",
    unconfirmed: [
      "Detection is pattern-based (shape of the string and name of the key), so it is a heuristic with false positives and false negatives; no n8n field is involved",
    ],
    check(wf) {
      const findings: Finding[] = [];
      for (const n of wf.nodes) {
        for (const hit of findSecrets(n.parameters)) {
          findings.push({
            ruleId: this.id,
            severity: this.severity,
            node: nameOf(n),
            // Never include the value: only the path and the kind of match.
            message: `Parameter "${hit.path}" looks like a hardcoded secret (${hit.kind}): ********`,
            fix: `Rotate the secret and move it into an n8n credential; clear "${hit.path}".`,
          });
        }
      }
      return findings;
    },
  },
  {
    id: "R006",
    name: "disabled-node",
    severity: "info",
    description: "A node is disabled (disabled: true).",
    why: "Disabled nodes are skipped at run time but stay in the workflow. They often hide dead branches or leftover debugging, and they make the flow harder to read.",
    howToFix: "Delete the node if it is no longer needed, or enable it. If it is kept on purpose, document why in a sticky note.",
    unconfirmed: [],
    check(wf) {
      return wf.nodes
        .filter((n) => n.disabled === true)
        .map((n) => ({
          ruleId: this.id,
          severity: this.severity,
          node: nameOf(n),
          message: "Node is disabled.",
          fix: "Remove the node, re-enable it, or explain why it stays disabled.",
        }));
    },
  },
  {
    id: "R007",
    name: "default-node-name",
    severity: "info",
    description: "A node still has its default name (for example \"HTTP Request\", \"Edit Fields2\", \"Code\").",
    why: "Default names say what the node is, not what it does. Execution logs, error messages and expressions that reference nodes by name become hard to read.",
    howToFix: "Rename the node after its purpose (for example \"Fetch invoices from billing API\"). n8n updates expressions that reference the old name.",
    unconfirmed: [
      'default display names other than "HTTP Request" (for example "Edit Fields") - based on observed export format, not documented; the list is also incomplete. Trigger and sticky note nodes are not checked',
    ],
    check(wf) {
      return wf.nodes
        .filter((n) => n.type !== STICKY_NOTE && !isTrigger(n) && typeof n.name === "string" && DEFAULT_NAME_RE.test(n.name))
        .map((n) => ({
          ruleId: this.id,
          severity: this.severity,
          node: nameOf(n),
          message: `Node uses a default name ("${nameOf(n)}").`,
          fix: "Rename the node to describe what it does.",
        }));
    },
  },
  {
    id: "R008",
    name: "orphan-node",
    severity: "warning",
    description: "A node (not a trigger or sticky note) has no incoming or outgoing connections.",
    why: "A node that is wired to nothing never runs. It is usually left over from a refactor or a connection that was removed by mistake, so part of the intended logic silently does nothing.",
    howToFix: "Connect the node into the flow, or delete it.",
    unconfirmed: ["which node types count as triggers is decided by a type-name heuristic (type ends with \"Trigger\", plus webhook, start, cron, interval)"],
    check(wf) {
      const connected = connectedNames(wf.connections);
      return wf.nodes
        .filter((n) => n.type !== STICKY_NOTE && !isTrigger(n) && typeof n.name === "string" && !connected.has(n.name))
        .map((n) => ({
          ruleId: this.id,
          severity: this.severity,
          node: nameOf(n),
          message: "Node has no incoming or outgoing connections.",
          fix: "Connect the node into the flow or delete it.",
        }));
    },
  },
];

export function getRule(id: string): Rule | undefined {
  return RULES.find((r) => r.id === id.trim().toUpperCase());
}
