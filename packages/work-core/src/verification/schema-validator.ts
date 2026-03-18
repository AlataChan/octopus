import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import type { VerificationResult } from "@octopus/work-contracts";

import type { VerificationContext, VerificationPlugin } from "./plugin.js";
import { resolveWorkspacePath } from "./path.js";

type PrimitiveSchemaType = "string" | "number" | "boolean" | "object" | "array";

export interface SimpleSchema {
  type: PrimitiveSchemaType;
  required?: string[];
  properties?: Record<string, SimpleSchema>;
}

export interface SchemaValidatorPluginOptions {
  targetPath: string;
  schema: SimpleSchema;
  readFile?: (path: string) => Promise<string>;
}

export class SchemaValidatorPlugin implements VerificationPlugin {
  readonly method = "schema-validator" as const;
  private readonly readFileImpl: (path: string) => Promise<string>;

  constructor(private readonly options: SchemaValidatorPluginOptions) {
    this.readFileImpl = options.readFile ?? ((path) => readFile(path, "utf8"));
  }

  async run(context: VerificationContext): Promise<VerificationResult> {
    const raw = await this.readFileImpl(resolveWorkspacePath(context.workspaceRoot, this.options.targetPath));
    const value = JSON.parse(raw) as unknown;
    const errors = validateValue(value, this.options.schema, this.options.targetPath);

    return {
      id: randomUUID(),
      method: this.method,
      status: errors.length === 0 ? "pass" : "fail",
      evidence: [
        {
          label: "schema",
          value: errors.length === 0 ? "valid" : errors.join("; "),
          passed: errors.length === 0
        }
      ],
      durationMs: 0,
      createdAt: new Date()
    };
  }
}

function validateValue(value: unknown, schema: SimpleSchema, path: string): string[] {
  const errors: string[] = [];

  if (!matchesType(value, schema.type)) {
    errors.push(`${path} must be ${schema.type}`);
    return errors;
  }

  if (schema.type === "object" && schema.required && isRecord(value)) {
    for (const key of schema.required) {
      if (!(key in value)) {
        errors.push(`${path}.${key} is required`);
      }
    }
  }

  if (schema.type === "object" && schema.properties && isRecord(value)) {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        errors.push(...validateValue(value[key], childSchema, `${path}.${key}`));
      }
    }
  }

  return errors;
}

function matchesType(value: unknown, type: PrimitiveSchemaType): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
