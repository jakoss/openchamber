import React from 'react';
import { opencodeClient } from '@/lib/opencode/client';
import type { Reference } from '@/lib/opencode/model';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { subscribeReferenceChanges } from '@/lib/references';

const empty: Reference[] = [];

export function useReferences(directory: string | null | undefined): Reference[] {
  const runtimeKey = getRuntimeKey();
  const [snapshot, setSnapshot] = React.useState<{ directory: string; runtimeKey: string; entries: Reference[] } | null>(null);
  React.useEffect(() => {
    if (!directory) return;
    let generation = 0;
    let mounted = true;
    const load = async () => {
      const request = ++generation;
      try {
        const entries = await opencodeClient.listReferences(directory);
        if (mounted && generation === request && getRuntimeKey() === runtimeKey) setSnapshot({ directory, runtimeKey, entries });
      } catch {
        // Failed refreshes retain this owner's last authoritative list.
      }
    };
    void load();
    const unsubscribe = subscribeReferenceChanges((changedDirectory) => {
      if (changedDirectory === directory) void load();
    });
    return () => { mounted = false; unsubscribe(); };
  }, [directory, runtimeKey]);
  return snapshot && snapshot.directory === directory && snapshot.runtimeKey === runtimeKey ? snapshot.entries : empty;
}
