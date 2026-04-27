import { z } from "zod";

export const skillRegistryEntrySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    tier: z.string().min(1),
    domain: z.string().min(1),
    triggers: z.array(z.string().min(1)),
    summary: z.string().min(1),
    depends: z.array(z.string().min(1)),
    priority: z.string().min(1),
    platforms: z.array(z.string().min(1)),
    bodyPath: z.string().min(1),
    bodySha256: z.string().regex(/^[a-f0-9]{64}$/i),
    sourceCommit: z.string().min(1).optional(),
    materializedAt: z.string().datetime(),
  })
  .strict();

export const skillRegistryManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceCommit: z.string().min(1).optional(),
    materializedAt: z.string().datetime(),
    entries: z.array(skillRegistryEntrySchema),
  })
  .strict();
