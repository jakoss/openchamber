import { createReferenceConfigManager } from './reference-config.js';
import { OPENCODE_CONFIG_DIR, readConfigFile, writeConfig } from './shared.js';

const references = createReferenceConfigManager({ configDirectory: OPENCODE_CONFIG_DIR, readConfigFile, writeConfig });

export function registerReferenceRoutes(app, { resolveOptionalProjectDirectory }) {
  app.all('/api/config/references', async (req, res) => {
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Unsupported method' });
    const { directory, error } = await resolveOptionalProjectDirectory(req);
    if (error) return res.status(400).json({ error });
    try {
      const result = references.execute({ ...req.body, method: req.method, directory: directory || undefined });
      return res.json(result);
    } catch {
      // Repository inputs can contain accidental credentials. Never echo them
      // through validation errors or logs.
      return res.status(400).json({ error: 'Could not update references. Check the alias, source, branch and configuration file.' });
    }
  });
}
