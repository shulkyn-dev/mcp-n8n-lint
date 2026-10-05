# mcp-n8n-lint

An MCP (Model Context Protocol) server that lints **n8n workflow exports** for reliability problems: missing error workflows, HTTP calls without retries, retries that swallow errors, unauthenticated webhooks, hardcoded secrets, and a few readability issues.

It reads the exported workflow JSON only. It is deterministic, needs no network access and never calls the n8n API, so it is safe to run on exports you do not want to send anywhere.

Why an MCP server: an AI agent that builds or reviews n8n workflows can call `lint_workflow` after every change and get machine-readable findings with a one-line fix for each, instead of guessing what "reliable" means.

## Install and run

Requires Node.js 20 or newer.

```bash
npm install
npm run build
npm test        # builds, then runs the vitest suite
```

The server speaks MCP over stdio. Run it directly with `node dist/index.js`, or register it in a client.

### Claude Code

```bash
claude mcp add n8n-lint -- node /absolute/path/to/mcp-n8n-lint/dist/index.js
```

### Any MCP client (JSON config)

```json
{
  "mcpServers": {
    "n8n-lint": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-n8n-lint/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | Input | Output |
| --- | --- | --- |
| `lint_workflow` | `workflow`: the n8n export, as an object or as a JSON string | `summary` (count of findings per severity, plus `total`) and `findings`: a list of `{ ruleId, severity, node, message, fix }`. `node` is the node name, or `null` for workflow-level findings. Findings are sorted error, warning, info. |
| `list_rules` | none | `rules`: a list of `{ id, name, severity, description }` |
| `explain_rule` | `ruleId`, for example `R002` | `id`, `name`, `severity`, `description`, `why` (why the rule exists), `howToFix`, and `unconfirmed` (fields the rule relies on that the n8n docs do not confirm; see below) |

Bad input (invalid JSON, no `nodes` array, unknown rule id) is returned as an MCP tool error, not a crash. The error text never quotes the input.

## Rules

| Id | Name | Severity | What it checks |
| --- | --- | --- | --- |
| R001 | no-error-workflow | warning | `settings.errorWorkflow` is not set. |
| R002 | http-no-retry | warning | An `n8n-nodes-base.httpRequest` node without `retryOnFail: true`. |
| R003 | retry-with-continue | warning | `retryOnFail: true` together with `onError` set to `continueRegularOutput` or `continueErrorOutput`, or with the legacy `continueOnFail: true`. |
| R004 | webhook-no-auth | warning | An `n8n-nodes-base.webhook` node whose `parameters.authentication` is absent or `"none"`. |
| R005 | hardcoded-secret | error | A node parameter that looks like a secret: a Bearer token, an `sk-...` key, a hex or base64-like string of 32+ characters, or a filled literal in a field named like `apiKey`, `token`, `password`, `secret`. Expressions (values starting with `=`) are ignored. |
| R006 | disabled-node | info | A node with `disabled: true`. |
| R007 | default-node-name | info | A node still named like its default (`HTTP Request`, `Edit Fields2`, `Code`, ...). Triggers and sticky notes are skipped. |
| R008 | orphan-node | warning | A node (not a trigger, not a sticky note) with no incoming and no outgoing connection. |

R005 never prints the value it found. Findings contain only the parameter path and the kind of match, with the value replaced by `********`. Tests plant fake secrets in fixtures and assert that no part of them appears in any output.

## Example

Input to `lint_workflow` (a small workflow with a fake placeholder token):

```json
{
  "name": "Order intake",
  "nodes": [
    {
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "parameters": { "httpMethod": "POST", "path": "orders" },
      "position": [0, 0]
    },
    {
      "name": "HTTP Request",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "https://api.example.invalid/orders",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer fake-bearer-token-0000000000000000" }
          ]
        }
      },
      "position": [200, 0]
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "HTTP Request", "type": "main", "index": 0 }]] }
  },
  "settings": { "executionOrder": "v1" }
}
```

Output:

```json
{
  "summary": { "error": 1, "warning": 3, "info": 1, "total": 5 },
  "findings": [
    {
      "ruleId": "R005",
      "severity": "error",
      "node": "HTTP Request",
      "message": "Parameter \"parameters.headerParameters.parameters[0].value\" looks like a hardcoded secret (literal value of \"Authorization\" header/field): ********",
      "fix": "Rotate the secret and move it into an n8n credential; clear \"parameters.headerParameters.parameters[0].value\"."
    },
    {
      "ruleId": "R001",
      "severity": "warning",
      "node": null,
      "message": "No error workflow is configured (settings.errorWorkflow is missing or empty).",
      "fix": "Set an error workflow (one that starts with an Error Trigger node) in Workflow Settings."
    },
    {
      "ruleId": "R002",
      "severity": "warning",
      "node": "HTTP Request",
      "message": "HTTP Request node has no retries (retryOnFail is not true).",
      "fix": "Turn on Retry On Fail for this node and set Max Tries and Wait Between Tries."
    },
    {
      "ruleId": "R004",
      "severity": "warning",
      "node": "Webhook",
      "message": "Webhook node does not require authentication.",
      "fix": "Set Authentication to Basic auth, Header auth or JWT auth on this node."
    },
    {
      "ruleId": "R007",
      "severity": "info",
      "node": "HTTP Request",
      "message": "Node uses a default name (\"HTTP Request\").",
      "fix": "Rename the node to describe what it does."
    }
  ]
}
```

## How the n8n field names were checked

Field names were checked against docs.n8n.io (October 2026):

- Confirmed in the Public API schema for the workflow and node objects: `retryOnFail`, `maxTries`, `waitBetweenTries`, `onError`, `continueOnFail` (marked deprecated, "use onError instead"), `disabled`, `parameters`, `settings.errorWorkflow` (the ID of the workflow that contains the Error Trigger node), and `connections` (keyed by source node name).
- Confirmed in the n8n docs' reference for editing workflows with the n8n MCP tools (`setNodeSettings`): the `onError` values `stopWorkflow`, `continueRegularOutput`, `continueErrorOutput`.
- Confirmed by example workflows embedded in the docs: the node types `n8n-nodes-base.httpRequest`, `n8n-nodes-base.webhook` and `n8n-nodes-base.stickyNote`, the default name `HTTP Request`, and the `connections` structure (`{ "<source>": { "main": [[ { "node", "type", "index" } ]] } }`).
- Behavior: the Handle errors gracefully page says an error workflow "runs if an execution fails", and the node settings page says that On Error "Continue" proceeds despite the error. That is the basis for R001 and R003.

Pages used: [Handle errors gracefully](https://docs.n8n.io/build/flow-logic/handle-errors-gracefully), [Work with nodes](https://docs.n8n.io/build/understand-workflows/workflow-components/work-with-nodes), [Webhook node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/), and the Public API reference.

### Not confirmed by the documentation

These parts are **based on observed export format, not documented**. The rules are kept, and `explain_rule` repeats the note:

- R004: `parameters.authentication` on the Webhook node, and the value `"none"`. The docs list the options only by their UI labels (Basic auth, Header auth, JWT auth, None) and do not show the JSON key or values. The rule treats an absent key the same as `"none"`, which is consistent with the documented example webhook (it has no `authentication` key), but this is an inference.
- R007: default display names other than `HTTP Request` (for example `Edit Fields`). The list in the code is incomplete.
- R008 (and R007): which node types count as triggers is decided by a type-name heuristic (type ends with `Trigger`, plus `webhook`, `start`, `cron`, `interval`).
- R002: the docs describe `retryOnFail` as an optional boolean without stating its default. A missing field is treated as `false`.
- R005: not tied to an n8n field. It is a pattern heuristic.

## Limitations

- Heuristics, not proof. R005 will produce false positives (for example a long identifier that looks like base64, or a placeholder in a `token` field) and false negatives (secrets split across fields, encoded, or short). R007 and R008 depend on lists and naming conventions.
- Export formats change between n8n versions, and the rules only look at the fields listed above. Older exports, exports copied from the editor canvas (which have no `settings`), and workflows from other tools may be read differently. Run it on a current export if results look off.
- Rules do not skip disabled nodes (R006 reports them, R002 to R005 and R008 still look at them), and R001 also flags a workflow that is itself an error handler (one that starts with an Error Trigger).
- It reads one JSON document. It does not call the n8n API, check that the referenced error workflow exists, resolve credentials, run the workflow, or follow sub-workflows.
- R002 says nothing about whether a call is safe to retry. Retrying non-idempotent requests (payments, emails) can cause duplicates.
- It does not replace a human review. It finds a fixed set of common reliability problems, not logic errors.
- Only the eight rules above exist.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # build + vitest (unit tests, fixture tests, end-to-end MCP client test)
```

Layout: `src/rules.ts` holds the rules, `src/secrets.ts` the secret detection, `src/lint.ts` the runner, `src/server.ts` the MCP tools. Test fixtures in `tests/fixtures` are synthetic workflows written for this project; all keys in them are obviously fake. Each rule has a `rNNN-bad.json` that triggers only that rule and a `rNNN-good.json` that does not trigger it.

## License

MIT. See [LICENSE](LICENSE).
