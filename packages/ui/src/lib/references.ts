/** Only mounted reference consumers subscribe. An event never opens a new Location. */
const listeners = new Set<(directory: string) => void>();
export function subscribeReferenceChanges(listener: (directory: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notifyReferenceChanges(directory: string): void {
  for (const listener of listeners) listener(directory);
}
