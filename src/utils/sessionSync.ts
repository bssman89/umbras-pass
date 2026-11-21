export type GoogleAuthPersistenceMode = 'local' | 'session';
export type IdleTimeoutMinutes = 0 | 15 | 30;

const AUTH_PERSISTENCE_PREF_KEY = 'umbras_pass_auth_persistence_v1';
const IDLE_TIMEOUT_PREF_KEY = 'umbras_pass_idle_timeout_v1';
export const SESSION_SYNC_STORAGE_KEY = 'umbras_pass_session_sync_v1';

export function getStoredAuthPersistenceMode(): GoogleAuthPersistenceMode {
  try {
    const val = window.localStorage.getItem(AUTH_PERSISTENCE_PREF_KEY);
    return val === 'session' ? 'session' : 'local';
  } catch {
    return 'local';
  }
}

export function isSharedSessionPersistenceActive(): boolean {
  return getStoredAuthPersistenceMode() === 'session';
}

export function getStoredIdleTimeoutMinutes(): IdleTimeoutMinutes {
  try {
    const raw = window.localStorage.getItem(IDLE_TIMEOUT_PREF_KEY);
    if (raw === '15') return 15;
    if (raw === '30') return 30;
    if (raw === '0') return 0;
    return isSharedSessionPersistenceActive() ? 15 : 0;
  } catch {
    return 0;
  }
}

export function setStoredIdleTimeoutMinutes(minutes: IdleTimeoutMinutes): void {
  try {
    window.localStorage.setItem(IDLE_TIMEOUT_PREF_KEY, String(minutes));
  } catch {
    // Ignore storage unavailability
  }
}

export function broadcastSessionSyncEvent(
  action: 'sign-out' | 'lock' | 'account-switch',
  uid?: string
): void {
  try {
    window.localStorage.setItem(
      SESSION_SYNC_STORAGE_KEY,
      JSON.stringify({ action, uid: uid || null, ts: Date.now() })
    );
  } catch {
    // Ignore storage unavailability
  }
}

export function setStoredAuthPersistenceMode(
  mode: GoogleAuthPersistenceMode
): void {
  try {
    window.localStorage.setItem(AUTH_PERSISTENCE_PREF_KEY, mode);
  } catch {
    // Ignore storage unavailability
  }
}
