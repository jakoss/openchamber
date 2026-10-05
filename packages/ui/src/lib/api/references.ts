import { z } from 'zod';
import { runtimeFetch } from '@/lib/runtime-fetch';

const guidance = { description: z.string().optional(), hidden: z.boolean().optional() };
const referenceConfigSchema = z.union([
  z.object({ path: z.string(), ...guidance }),
  z.object({ repository: z.string(), branch: z.string().optional(), ...guidance }),
]);
const referenceEntrySchema = z.object({
  name: z.string(), config: referenceConfigSchema, scope: z.enum(['user', 'project', 'custom']),
  sourcePath: z.string(), resolvedPath: z.string().nullable(),
  availability: z.enum(['available', 'missing', 'not-directory', 'denied', 'unknown']),
  editable: z.boolean(), overridden: z.boolean(),
});
const listSchema = z.object({ entries: z.array(referenceEntrySchema), errors: z.array(z.object({ path: z.string() })), targets: z.object({ user: z.string(), project: z.string().nullable() }) });
const mutationSchema = z.object({ success: z.literal(true), path: z.string() });
export type ReferenceConfig = z.infer<typeof referenceConfigSchema>;
export type ReferenceEntry = z.infer<typeof referenceEntrySchema>;
export type ReferenceList = z.infer<typeof listSchema>;
export type ReferenceScope = 'user' | 'project';
type Mutation =
  | { method: 'POST' | 'PATCH'; name: string; previousName?: string; sourcePath?: string; scope: ReferenceScope; config: ReferenceConfig }
  | { method: 'DELETE'; name: string; sourcePath?: string; scope: ReferenceScope };

export async function listReferenceConfigs(directory: string | null): Promise<ReferenceList> {
  const response = await runtimeFetch('/api/config/references', { query: directory ? { directory } : undefined });
  if (!response.ok) throw new Error('Reference configuration request failed');
  return listSchema.parse(await response.json());
}

export async function mutateReferenceConfig(directory: string | null, mutation: Mutation): Promise<void> {
  const response = await runtimeFetch('/api/config/references', {
    method: mutation.method, query: directory ? { directory } : undefined,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mutation),
  });
  if (!response.ok) throw new Error('Reference configuration update failed');
  mutationSchema.parse(await response.json());
}
