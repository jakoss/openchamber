import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';

const hasControlCharacters = (value) => [...value].some((character) => character.charCodeAt(0) <= 31);
const alias = z.string().min(1).regex(/^[^/\\\s`,]+$/).refine((value) => !hasControlCharacters(value));
const nonempty = z.string().trim().min(1).refine((value) => !value.includes('\0'));
const guidance = { description: z.string().optional(), hidden: z.boolean().optional() };
const entrySchema = z.union([
  z.object({ path: nonempty, ...guidance }).strict(),
  z.object({ repository: nonempty, branch: z.string().optional(), ...guidance }).strict(),
]);
const normalizedEntry = z.union([
  entrySchema,
  z.string().transform((value) => value.startsWith('.') || value.startsWith('/') || value.startsWith('~')
    ? { path: value } : { repository: value }),
]);
const sectionSchema = z.record(z.string(), z.json());
export const referenceRequestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('GET'), directory: z.string().optional() }),
  z.object({ method: z.enum(['POST', 'PATCH']), directory: z.string().optional(), scope: z.enum(['user', 'project']), name: alias, previousName: alias.optional(), sourcePath: z.string().optional(), config: entrySchema }),
  z.object({ method: z.literal('DELETE'), directory: z.string().optional(), scope: z.enum(['user', 'project']), name: alias, sourcePath: z.string().optional() }),
]);

function validateRepository(repository) {
  const cleaned = repository.replace(/^git\+/, '').replace(/#.*$/, '').replace(/\/+$/, '');
  const safeSegment = (segment) => segment && segment !== '.' && segment !== '..' && !/[\s/\\:]/.test(segment) && !hasControlCharacters(segment);
  let host;
  let segments;
  if (cleaned.includes('://')) {
    let url;
    try { url = new URL(cleaned); } catch { throw new Error('Invalid repository URL'); }
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) || url.password || (url.protocol !== 'ssh:' && url.username)) {
      throw new Error('Use a remote Git repository without embedded credentials');
    }
    host = url.host;
    segments = url.pathname.split('/').filter(Boolean);
  } else {
    const scp = cleaned.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/);
    const parts = cleaned.replace(/^github:/, '').split('/').filter(Boolean);
    host = scp ? scp[1] : parts.length === 2 ? 'github.com' : parts.shift();
    segments = scp ? scp[2].split('/').filter(Boolean) : parts;
  }
  if (!host || host.startsWith('-') || !host.split(':').every(safeSegment) || !segments.length || !segments.every(safeSegment)) {
    throw new Error('Repository must be a Git URL, host/path, or owner/repo');
  }
}

function availability(directory) {
  try { return fs.statSync(directory).isDirectory() ? 'available' : 'not-directory'; }
  catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    if (error.code === 'ENOTDIR') return 'not-directory';
    if (error.code === 'EACCES' || error.code === 'EPERM') return 'denied';
    return 'unknown';
  }
}

/** Both hosts inject their existing JSONC reader/writer. No host-specific IO is duplicated. */
export function createReferenceConfigManager({ configDirectory, readConfigFile, writeConfig }) {
  const names = ['opencode.json', 'opencode.jsonc'];
  const filesIn = (directory) => names.map((name) => path.join(directory, name));
  const globalFiles = filesIn(configDirectory);
  const discover = (directory) => {
    const ancestors = [];
    if (directory) {
      let current = path.resolve(directory);
      while (true) {
        ancestors.unshift(current);
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
    }
    const layers = [
      ...globalFiles.map((file) => ({ path: file, scope: 'user' })),
      ...ancestors.flatMap((dir) => filesIn(dir).map((file) => ({ path: file, scope: 'project' }))),
      ...ancestors.flatMap((dir) => filesIn(path.join(dir, '.opencode')).map((file) => ({ path: file, scope: 'project' }))),
      ...(process.env.OPENCODE_CONFIG ? [{ path: path.resolve(process.env.OPENCODE_CONFIG), scope: 'custom' }] : []),
    ];
    return layers.filter((layer, index) => layers.findIndex((candidate) => candidate.path === layer.path) === index);
  };
  const readSection = (file) => {
    const config = readConfigFile(file);
    const entries = sectionSchema.parse(config.references ?? {});
    return { config, entries };
  };
  const target = (directory, scope) => {
    if (scope === 'project' && !directory) throw new Error('Project scope requires a directory');
    const candidates = scope === 'user' ? globalFiles : [
      ...filesIn(directory), ...filesIn(path.join(directory, '.opencode')),
    ];
    // The last existing document wins, as it does in OpenCode. Never redirect a
    // project/global write to OPENCODE_CONFIG just because it has higher priority.
    return candidates.filter((file) => fs.existsSync(file)).at(-1) ?? candidates[0];
  };
  const list = (directory) => {
    const entries = [];
    const errors = [];
    for (const layer of discover(directory)) {
      try {
        for (const [name, stored] of Object.entries(readSection(layer.path).entries)) {
          const parsed = normalizedEntry.safeParse(stored);
          if (!parsed.success) {
            if (!errors.some((error) => error.path === layer.path)) errors.push({ path: layer.path });
            continue;
          }
          const config = parsed.data;
          const resolvedPath = 'path' in config
            ? config.path.startsWith('~/') ? path.join(os.homedir(), config.path.slice(2)) : path.resolve(path.dirname(layer.path), config.path)
            : null;
          entries.push({ name, config, scope: layer.scope, sourcePath: layer.path, resolvedPath,
            availability: resolvedPath ? availability(resolvedPath) : 'unknown',
            editable: layer.scope !== 'custom', overridden: false });
        }
      } catch {
        errors.push({ path: layer.path });
      }
    }
    for (let index = 0; index < entries.length; index++) {
      entries[index].overridden = entries.slice(index + 1).some((entry) => entry.name === entries[index].name);
    }
    return { entries, errors, targets: { user: target(directory, 'user'), project: directory ? target(directory, 'project') : null } };
  };
  const execute = (input) => {
    const request = referenceRequestSchema.parse(input);
    if (request.method === 'GET') return list(request.directory);
    const oldName = request.method === 'PATCH' ? request.previousName ?? request.name : request.name;
    const matching = list(request.directory).entries.filter((entry) => entry.name === oldName && entry.scope === request.scope);
    const source = request.sourcePath ? matching.find((entry) => entry.sourcePath === request.sourcePath) : matching.at(-1);
    const file = request.method === 'POST' ? target(request.directory, request.scope) : source?.sourcePath;
    if (!file) throw new Error('Reference not found in the selected scope');
    const { config, entries } = readSection(file);
    if (request.method !== 'DELETE') {
      if ('repository' in request.config) {
        validateRepository(request.config.repository);
        const branch = request.config.branch;
        if (branch !== undefined && (!/^[A-Za-z0-9/_.-]+$/.test(branch) || branch.startsWith('-') || branch.includes('..'))) {
          throw new Error('Invalid branch name');
        }
      }
      const collision = list(request.directory).entries.some((entry) => entry.name === request.name && entry.scope === request.scope);
      if ((request.method === 'POST' || oldName !== request.name) && collision) throw new Error('Reference alias already exists in this scope');
    }
    if (request.method === 'DELETE' || oldName !== request.name) delete entries[oldName];
    if (request.method !== 'DELETE') Object.defineProperty(entries, request.name, { value: request.config, enumerable: true, writable: true, configurable: true });
    config.references = entries;
    writeConfig(config, file);
    return { success: true, path: file };
  };
  return { execute };
}
