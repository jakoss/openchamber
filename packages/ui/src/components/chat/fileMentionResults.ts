import { scoreByFuzzyQuery } from '@/lib/search/fuzzySearch';
import type { ProjectFileSearchHit } from '@/lib/opencode/client';
import type { Reference } from '@/lib/opencode/model';
import type { FilesAPI } from '@/lib/api/types';

export function resolveReferenceMention(mention: string, references: readonly Reference[]) {
  const normalized = mention.replace(/\\/g, '/');
  const slash = normalized.indexOf('/');
  const alias = slash < 0 ? normalized : normalized.slice(0, slash);
  const reference = references.find((entry) => entry.name === alias);
  if (!reference) return null;
  const subpath = slash < 0 ? '' : normalized.slice(slash + 1);
  if (subpath.split('/').some((part) => part === '..' || part === '.' || part.includes(':'))) return null;
  const root = reference.path.replace(/\\/g, '/').replace(/\/+$/, '');
  return { reference, subpath, serverPath: subpath ? `${root}/${subpath}` : root };
}

export async function listReferenceMentionHits(
  mention: string,
  references: readonly Reference[],
  files: Pick<FilesAPI, 'listDirectory'>,
  options: { includeHidden: boolean; respectGitignore: boolean },
): Promise<FileMentionHit[]> {
  const resolved = resolveReferenceMention(mention, references);
  if (!resolved) return [];
  const slash = resolved.subpath.lastIndexOf('/');
  const parent = slash < 0 ? '' : resolved.subpath.slice(0, slash + 1);
  const query = resolved.subpath.slice(slash + 1);
  const root = resolved.reference.path.replace(/\\/g, '/').replace(/\/+$/, '');
  const listing = await files.listDirectory(`${root}/${parent}`, { respectGitignore: options.respectGitignore });
  const hits = listing.entries
    .filter((entry) => options.includeHidden || !entry.name.startsWith('.'))
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      relativePath: entry.name,
      kind: entry.isDirectory ? 'directory' as const : 'file' as const,
    }));
  return rankFileMentionResults(
    hits.filter((hit) => hit.kind === 'file'),
    hits.filter((hit) => hit.kind === 'directory'),
    query,
  ).map((hit) => ({ ...hit, relativePath: `${resolved.reference.name}/${parent}${hit.name}${hit.kind === 'directory' ? '/' : ''}` }));
}

export type FileMentionHit = ProjectFileSearchHit & { kind: 'file' | 'directory' };

export const tokenizeMentionQuery = (query: string): string[] =>
  (query ?? '')
    .trim()
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

/**
 * The opencode file search takes a single term, so multi-word queries send the
 * most selective (longest) token and the remaining tokens filter client-side.
 */
export const mentionServerQuery = (query: string): string => {
  const tokens = tokenizeMentionQuery(query);
  if (tokens.length === 0) {
    return '';
  }
  return tokens.reduce((longest, token) => (token.length > longest.length ? token : longest));
};

/**
 * Merge directory and file hits into one list ranked by match quality against
 * the full relative path. Multi-token queries require every token to appear
 * somewhere in the path, in any order.
 */
export function rankFileMentionResults(
  files: ProjectFileSearchHit[],
  directories: ProjectFileSearchHit[],
  query: string,
  limit = 20,
): FileMentionHit[] {
  const merged: FileMentionHit[] = [
    ...directories.map((hit) => ({ ...hit, kind: 'directory' as const })),
    ...files.map((hit) => ({ ...hit, kind: 'file' as const })),
  ];

  const tokens = tokenizeMentionQuery(query);
  if (tokens.length === 0) {
    return merged.slice(0, limit);
  }

  const pathOf = (hit: FileMentionHit) => hit.relativePath || hit.name;
  const candidates = tokens.length === 1
    ? merged
    : merged.filter((hit) => {
        const haystack = pathOf(hit).toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      });

  const primary = tokens.reduce((longest, token) => (token.length > longest.length ? token : longest));
  return scoreByFuzzyQuery(candidates, primary, pathOf, { limit, threshold: 0.4 }).map(
    (scored) => scored.item,
  );
}

export function filterStaleRecentFiles<T extends { path: string }>(
  files: readonly T[],
  stalePaths: ReadonlySet<string>,
): T[] {
  if (stalePaths.size === 0) {
    return [...files];
  }
  return files.filter((file) => !stalePaths.has(file.path));
}
