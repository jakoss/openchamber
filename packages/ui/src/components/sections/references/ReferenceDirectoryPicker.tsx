import React from 'react';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { opencodeClient } from '@/lib/opencode/client';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { normalizePath, getNormalizedParentDirectory } from '@/lib/pathNormalization';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

/** Browses the connected host. It never uses the browser's local directory picker. */
export function ReferenceDirectoryPicker({ initialDirectory, onSelect, onClose }: {
  initialDirectory: string | null; onSelect: (path: string) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const { files } = useRuntimeAPIs();
  const runtime = getRuntimeKey();
  const [directory, setDirectory] = React.useState(initialDirectory ?? '');
  const [input, setInput] = React.useState(initialDirectory ?? '');
  const [entries, setEntries] = React.useState<Array<{ name: string; path: string }>>([]);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  React.useEffect(() => {
    if (directory) return;
    let cancelled = false;
    void opencodeClient.getFilesystemHome().then((home) => {
      if (cancelled || getRuntimeKey() !== runtime) return;
      if (home) { setDirectory(home); setInput(home); } else setStatus('failed');
    });
    return () => { cancelled = true; };
  }, [directory, runtime]);
  React.useEffect(() => {
    if (!directory) return;
    let cancelled = false;
    setStatus('loading');
    void files.listDirectory(directory, { respectGitignore: false }).then((result) => {
      if (cancelled || getRuntimeKey() !== runtime) return;
      setEntries(result.entries.filter((entry) => entry.isDirectory));
      setStatus('ready');
    }).catch(() => { if (!cancelled) setStatus('failed'); });
    return () => { cancelled = true; };
  }, [directory, files, runtime]);
  const navigate = (value: string) => {
    const normalized = normalizePath(value);
    if (normalized) { setDirectory(normalized); setInput(normalized); }
  };
  const parent = getNormalizedParentDirectory(directory);
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent><DialogHeader><DialogTitle>{t('settings.references.browse')}</DialogTitle><DialogDescription>{t('settings.references.hostPaths')}</DialogDescription></DialogHeader>
      <div className="flex items-center gap-2"><Input value={input} aria-label={t('settings.references.path')} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); navigate(input); } }} /><Button variant="outline" onClick={() => navigate(input)}>{t('settings.references.open')}</Button></div>
      <Button variant="ghost" disabled={!parent} onClick={() => { if (parent) navigate(parent); }}>{t('settings.references.parent')}</Button>
      <div className="max-h-64 overflow-y-auto">
        {status === 'loading' ? <p>{t('common.loading')}</p> : status === 'failed' ? <p role="alert">{t('settings.references.unavailable')}</p> : entries.map((entry) => <Button key={entry.path} variant="ghost" className="w-full justify-start" onClick={() => navigate(entry.path)}>{entry.name}</Button>)}
      </div>
      <DialogFooter><Button variant="outline" onClick={onClose}>{t('settings.common.actions.cancel')}</Button><Button disabled={status !== 'ready'} onClick={() => { if (getRuntimeKey() === runtime) onSelect(directory); }}>{t('settings.references.select')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
