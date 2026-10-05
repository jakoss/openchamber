import React from 'react';
import { useI18n } from '@/lib/i18n';
import { useSettingsDirectory } from '@/hooks/useSettingsDirectory';
import { useReferences } from '@/hooks/useReferences';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { listReferenceConfigs, mutateReferenceConfig, type ReferenceConfig, type ReferenceEntry, type ReferenceList, type ReferenceScope } from '@/lib/api/references';
import { notifyReferenceChanges, subscribeReferenceChanges } from '@/lib/references';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui';
import { SettingsPageLayout } from '../shared/SettingsPageLayout';
import { SettingsSection, SettingsStackedField, SettingsCheckboxRow, SettingsChipGroup, SETTINGS_FIELDS_STACK_CLASS } from '../shared/SettingsSection';
import { SettingsAddCard, SettingsCard, SettingsCardChip, SettingsBackButton, SETTINGS_CARD_GRID_CLASS } from '../shared/SettingsCards';
import { useAutosave, AUTOSAVE_UNCHANGED, AUTOSAVE_SAVED, autosaveFailed } from '../shared/SettingsAutosave';
import { ReferenceDirectoryPicker } from './ReferenceDirectoryPicker';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

interface Draft { name: string; kind: 'local' | 'git'; source: string; branch: string; description: string; hidden: boolean }
const makeDraft = (entry?: ReferenceEntry): Draft => ({
  name: entry?.name ?? '', kind: entry && 'repository' in entry.config ? 'git' : 'local',
  source: entry ? 'path' in entry.config ? entry.config.path : entry.config.repository : '',
  branch: entry && 'repository' in entry.config ? entry.config.branch ?? '' : '',
  description: entry?.config.description ?? '', hidden: entry?.config.hidden ?? false,
});
function configOf(draft: Draft): ReferenceConfig {
  const config: ReferenceConfig = draft.kind === 'local' ? { path: draft.source.trim() } : { repository: draft.source.trim() };
  if (draft.description) config.description = draft.description;
  if (draft.hidden) config.hidden = true;
  if ('repository' in config && draft.branch.trim()) config.branch = draft.branch.trim();
  return config;
}
function validDraft(draft: Draft): boolean {
  return !!draft.source.trim() && /^[^/\\\s`,]+$/.test(draft.name) && [...draft.name].every((character) => character.charCodeAt(0) > 31)
    && (draft.kind === 'local' || !draft.branch.trim() || (/^[A-Za-z0-9/_.-]+$/.test(draft.branch.trim()) && !draft.branch.startsWith('-') && !draft.branch.includes('..')));
}

function ReferenceEditor({ entry, directory, scope, onClose, onWritten }: {
  entry?: ReferenceEntry; directory: string | null; scope: ReferenceScope;
  onClose: () => void; onWritten: (name: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState(() => makeDraft(entry));
  const baseline = React.useRef(makeDraft(entry));
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  const [creating, setCreating] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [validationError, setValidationError] = React.useState(false);
  const runtime = getRuntimeKey();
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  React.useEffect(() => {
    if (!entry) return;
    const incoming = makeDraft(entry);
    if (JSON.stringify(draftRef.current) === JSON.stringify(baseline.current)) {
      setDraft(incoming);
      baseline.current = incoming;
    }
  }, [entry]);
  const save = async () => {
    if (!entry || JSON.stringify(draft) === JSON.stringify(baseline.current)) return AUTOSAVE_UNCHANGED;
    if (!validDraft(draft)) { setValidationError(true); return autosaveFailed(t('settings.references.invalid')); }
    const submitted = { ...draft };
    try {
      await mutateReferenceConfig(directory, { method: 'PATCH', scope, sourcePath: entry.sourcePath, previousName: baseline.current.name, name: submitted.name, config: configOf(submitted) });
      if (!mounted.current || getRuntimeKey() !== runtime) return AUTOSAVE_UNCHANGED;
      baseline.current = submitted;
      setValidationError(false);
      onWritten(submitted.name);
      return AUTOSAVE_SAVED;
    } catch { return autosaveFailed(t('settings.references.failed')); }
  };
  const autosave = useAutosave(save);
  const update = (changes: Partial<Draft>, immediate = false) => {
    setDraft((current) => ({ ...current, ...changes }));
    if (immediate && entry) autosave.requestSave();
  };
  const create = async () => {
    if (!validDraft(draft)) { setValidationError(true); return; }
    setCreating(true);
    try {
      await mutateReferenceConfig(directory, { method: 'POST', scope, name: draft.name, config: configOf(draft) });
      if (mounted.current && getRuntimeKey() === runtime) { onWritten(draft.name); onClose(); }
    } catch { if (mounted.current) toast.error(t('settings.references.failed')); }
    finally { if (mounted.current) setCreating(false); }
  };
  return <SettingsPageLayout title={entry?.name ?? t('settings.references.add')} onBlurCapture={autosave.onBlurCapture}>
    <SettingsBackButton label={t('settings.references.back')} onClick={onClose} />
    <SettingsSection divider={false} contentClassName={SETTINGS_FIELDS_STACK_CLASS}>
      {entry ? <p className="typography-meta break-all text-muted-foreground">{entry.sourcePath}</p> : null}
      <SettingsStackedField label={t('settings.references.alias')}>
        <Input value={draft.name} aria-label={t('settings.references.alias')} onChange={(event) => update({ name: event.target.value })} disabled={creating} />
      </SettingsStackedField>
      <SettingsStackedField label={t('settings.references.type')}>
        <SettingsChipGroup options={[{ value: 'local', label: t('settings.references.local') }, { value: 'git', label: t('settings.references.git') }]}
          value={draft.kind} onChange={(value) => update({ kind: value === 'git' ? 'git' : 'local', branch: '' }, true)} aria-label={t('settings.references.type')} />
      </SettingsStackedField>
      <SettingsStackedField label={t(draft.kind === 'local' ? 'settings.references.path' : 'settings.references.repository')}>
        <div className="flex items-center gap-2">
          <Input value={draft.source} aria-label={t(draft.kind === 'local' ? 'settings.references.path' : 'settings.references.repository')} onChange={(event) => update({ source: event.target.value })} disabled={creating} />
          {draft.kind === 'local' ? <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>{t('settings.references.browse')}</Button> : null}
        </div>
      </SettingsStackedField>
      {draft.kind === 'git' ? <SettingsStackedField label={t('settings.references.branch')}>
        <Input value={draft.branch} aria-label={t('settings.references.branch')} onChange={(event) => update({ branch: event.target.value })} disabled={creating} />
      </SettingsStackedField> : null}
      <SettingsStackedField label={t('settings.common.field.description')}>
        <Textarea value={draft.description} aria-label={t('settings.common.field.description')} onChange={(event) => update({ description: event.target.value })} disabled={creating} />
      </SettingsStackedField>
      <SettingsCheckboxRow label={t('settings.references.hidden')} checked={draft.hidden} onChange={(hidden) => update({ hidden }, true)} disabled={creating} />
      {validationError ? <p role="alert" className="typography-meta text-[var(--status-error-text)]">{t('settings.references.invalid')}</p> : null}
      {!entry ? <div className="flex gap-2">
        <Button onClick={() => void create()} disabled={creating}>{t('settings.common.actions.create')}</Button>
        <Button variant="outline" onClick={onClose} disabled={creating}>{t('settings.common.actions.cancel')}</Button>
      </div> : null}
    </SettingsSection>
    {pickerOpen ? <ReferenceDirectoryPicker initialDirectory={directory} onClose={() => setPickerOpen(false)} onSelect={(source) => { update({ source }, true); setPickerOpen(false); }} /> : null}
  </SettingsPageLayout>;
}

function ScopedReferencesPage({ directory, scope, setScope }: { directory: string | null; scope: ReferenceScope; setScope: (scope: ReferenceScope) => void }) {
  const { t } = useI18n();
  const [catalog, setCatalog] = React.useState<ReferenceList | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [selection, setSelection] = React.useState<{ id: string; name: string; entry: ReferenceEntry } | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ReferenceEntry | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [revision, refresh] = React.useReducer((value) => value + 1, 0);
  const runtime = getRuntimeKey();
  const resolvedReferences = useReferences(directory);
  React.useEffect(() => {
    let cancelled = false;
    void listReferenceConfigs(directory).then((result) => {
      if (!cancelled && getRuntimeKey() === runtime) { setCatalog(result); setFailed(false); }
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [directory, runtime, revision]);
  React.useEffect(() => subscribeReferenceChanges((changedDirectory) => { if (changedDirectory === directory) refresh(); }), [directory]);
  const onWritten = (name: string) => {
    setSelection((current) => current && current !== 'new' ? { ...current, name } : current);
    refresh();
    if (directory) notifyReferenceChanges(directory);
  };
  const selectedEntry = selection && selection !== 'new' ? catalog?.entries.find((entry) => entry.name === selection.name && entry.sourcePath === selection.entry.sourcePath) ?? selection.entry : undefined;
  if (selection === 'new' || selectedEntry) return <ReferenceEditor key={selection === 'new' ? 'new' : selection?.id} entry={selectedEntry} directory={directory} scope={scope} onClose={() => setSelection(null)} onWritten={onWritten} />;
  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await mutateReferenceConfig(directory, { method: 'DELETE', scope, name: deleteTarget.name, sourcePath: deleteTarget.sourcePath });
      if (getRuntimeKey() !== runtime) return;
      setDeleteTarget(null); refresh();
      if (directory) notifyReferenceChanges(directory);
    } catch { toast.error(t('settings.references.failed')); }
    finally { setDeleting(false); }
  };
  const entries = catalog?.entries.filter((entry) => entry.scope === scope || entry.scope === 'custom') ?? [];
  return <SettingsPageLayout title={t('settings.page.references.title')} description={t('settings.page.references.description')}>
    <SettingsSection divider={false} settingsItem="references.scope">
      <SettingsStackedField label={t('settings.references.scope')}>
        <SettingsChipGroup options={[{ value: 'project', label: t('settings.common.scope.project'), disabled: !directory }, { value: 'user', label: t('settings.common.scope.global') }]}
          value={scope} onChange={(value) => setScope(value === 'project' ? 'project' : 'user')} aria-label={t('settings.references.scope')} />
      </SettingsStackedField>
      <p className="typography-meta break-all text-muted-foreground">{catalog?.targets[scope]}</p>
      {failed ? <p role="alert" className="typography-meta text-[var(--status-error-text)]">{t('settings.references.failed')}</p> : null}
      {catalog?.errors.map((error) => <p key={error.path} role="alert" className="typography-meta break-all text-[var(--status-warning-text)]">{t('settings.references.configError', { path: error.path })}</p>)}
      <Button size="sm" variant="outline" onClick={refresh}>{t('settings.references.refresh')}</Button>
    </SettingsSection>
    <SettingsSection divider={false} settingsItem="references.manage" contentClassName={SETTINGS_CARD_GRID_CLASS}>
      <SettingsAddCard label={t('settings.references.add')} onClick={() => setSelection('new')} />
      {entries.map((entry) => <SettingsCard key={`${entry.sourcePath}:${entry.name}`} icon={<Icon name={'path' in entry.config ? 'folder' : 'git-branch'} className="size-5" />}
        title={entry.name} subtitle={'path' in entry.config ? entry.config.path : entry.config.repository}
        footer={<><SettingsCardChip>{entry.overridden ? t('settings.references.overridden') : entry.scope === 'custom' ? t('settings.references.custom') : t(scope === 'user' ? 'settings.common.scope.global' : 'settings.common.scope.project')}</SettingsCardChip>
          <span>{entry.availability === 'available' || (!entry.overridden && resolvedReferences.some((reference) => reference.name === entry.name))
            ? t('settings.remoteInstances.sidebar.phase.ready') : t('settings.references.unavailable')}</span></>}
        onOpen={entry.editable ? () => setSelection({ id: `${entry.sourcePath}:${entry.name}`, name: entry.name, entry }) : undefined}
        actions={entry.editable ? [{ label: t('settings.common.actions.delete'), destructive: true, onSelect: () => setDeleteTarget(entry) }] : undefined}
        actionsLabel={t('settings.common.actions.delete')} />)}
      {!catalog && !failed ? <p className="typography-meta text-muted-foreground">{t('common.loading')}</p> : null}
    </SettingsSection>
    <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{t('settings.common.actions.delete')}</DialogTitle><DialogDescription>{t('settings.references.deleteConfirm', { name: deleteTarget?.name ?? '' })}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>{t('settings.common.actions.cancel')}</Button><Button variant="destructive" onClick={() => void remove()} disabled={deleting}>{t('settings.common.actions.delete')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </SettingsPageLayout>;
}

export function ReferencesPage() {
  const directory = useSettingsDirectory();
  const [scope, setScope] = React.useState<ReferenceScope>(directory ? 'project' : 'user');
  const effectiveScope = directory ? scope : 'user';
  return <ScopedReferencesPage key={JSON.stringify([getRuntimeKey(), directory, effectiveScope])} directory={directory} scope={effectiveScope} setScope={setScope} />;
}
