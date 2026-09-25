/**
 * Whether the app can currently reach the store's API, for the
 * "Connecting to store…" banner.
 *
 * The backend runs on Render, which can take ~30 s to wake after being idle.
 * The API client retries idempotent requests through that window; this module
 * is how the UI learns a request is slow or retrying, so it can say
 * "Connecting to store…" instead of failing.
 */
export type ConnectionState = 'online' | 'connecting' | 'offline';

type Listener = (state: ConnectionState) => void;

let state: ConnectionState = 'online';
const listeners = new Set<Listener>();

export function getConnectionState(): ConnectionState {
  return state;
}

export function setConnectionState(next: ConnectionState): void {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener(state);
}

export function subscribeConnection(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
