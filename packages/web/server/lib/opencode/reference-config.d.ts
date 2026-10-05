import type { z } from 'zod';

type ReferenceConfig = { path: string; description?: string; hidden?: boolean } | { repository: string; branch?: string; description?: string; hidden?: boolean };
type ReferenceRequest =
  | { method: 'GET'; directory?: string }
  | { method: 'POST' | 'PATCH'; directory?: string; scope: 'user' | 'project'; name: string; previousName?: string; sourcePath?: string; config: ReferenceConfig }
  | { method: 'DELETE'; directory?: string; scope: 'user' | 'project'; name: string; sourcePath?: string };
type ConfigDocument = { [key: string]: z.core.JSONType };
interface ReferenceList {
  entries: Array<{ name: string; config: ReferenceConfig; scope: 'user' | 'project' | 'custom'; sourcePath: string; resolvedPath: string | null; availability: 'available' | 'missing' | 'not-directory' | 'denied' | 'unknown'; editable: boolean; overridden: boolean }>;
  errors: Array<{ path: string }>;
  targets: { user: string; project: string | null };
}
export const referenceRequestSchema: z.ZodType<ReferenceRequest>;
export function createReferenceConfigManager(dependencies: {
  configDirectory: string;
  // Configuration is parsed by the host's existing JSONC reader at this boundary.
  readConfigFile: (path: string) => ConfigDocument;
  writeConfig: (config: ConfigDocument, path: string) => void;
}): { execute(input: ReferenceRequest): ReferenceList | { success: true; path: string } };
