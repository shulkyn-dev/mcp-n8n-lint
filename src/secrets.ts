export interface SecretHit {
  /** Parameter path, for example `parameters.headerParameters.parameters[0].value`. */
  path: string;
  /** Human-readable kind of match. Never contains the value itself. */
  kind: string;
}

const SENSITIVE_KEY = /(api[_-]?key|token|password|passwd|secret)$/i;
const SENSITIVE_NAME = /^(authorization|x-api-key|api[_-]?key|apikey|x-auth-token|access[_-]?token|auth[_-]?token|token|password|secret|client[_-]?secret)$/i;

/** Classify a string value by its shape. Returns a kind label or null. */
function classifyValue(value: string): string | null {
  if (/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/i.test(value)) return "Bearer token";
  if (/\bsk-[A-Za-z0-9_-]{16,}/.test(value)) return "API key (sk-...)";
  if (/^[a-f0-9]{32,}$/i.test(value)) return "long hex string";
  if (/^[A-Za-z0-9+/]{32,}={0,2}$/.test(value) && /[A-Za-z]/.test(value) && /\d/.test(value)) {
    return "long base64-like string";
  }
  return null;
}

function isExpression(value: string): boolean {
  return value.startsWith("=");
}

function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !isExpression(value);
}

/**
 * Walk a node's parameters and report parameters that look like hardcoded secrets.
 * Reports paths and kinds only, so callers can never leak the value.
 */
export function findSecrets(parameters: unknown, basePath = "parameters"): SecretHit[] {
  const hits: SecretHit[] = [];
  const seen = new Set<string>();
  const add = (path: string, kind: string) => {
    if (!seen.has(path)) {
      seen.add(path);
      hits.push({ path, kind });
    }
  };

  const walk = (value: unknown, path: string, key: string | null): void => {
    if (typeof value === "string") {
      if (isExpression(value) || value === "") return;
      const kind = classifyValue(value);
      if (kind) add(path, kind);
      else if (key && SENSITIVE_KEY.test(key)) add(path, `literal value of "${key}"`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`, null));
      return;
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      // n8n name/value pairs, for example headerParameters.parameters[] = { name, value }
      if (typeof obj.name === "string" && SENSITIVE_NAME.test(obj.name) && isFilled(obj.value)) {
        add(`${path}.value`, `literal value of "${obj.name}" header/field`);
      }
      for (const [k, v] of Object.entries(obj)) walk(v, `${path}.${k}`, k);
    }
  };

  walk(parameters, basePath, null);
  return hits;
}
