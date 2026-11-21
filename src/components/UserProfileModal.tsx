import React, { useState } from 'react';
import {
  KeyRound,
  Lock,
  LogOut,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import type { GoogleAuthPersistenceMode } from '../firebase';
import type { StoredLocalUserProfile } from '../utils/versionHistory';

export type LocalUserProfile = StoredLocalUserProfile;

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  authPersistenceMode: GoogleAuthPersistenceMode;
  onChangeAuthPersistence: (mode: GoogleAuthPersistenceMode) => void;
  activeLocalProfile: LocalUserProfile | null;
  savedLocalProfiles: LocalUserProfile[];
  onSignInProfile: (profileId: string, passcode?: string) => Promise<boolean>;
  onCreateProfile: (name: string, passcode?: string) => Promise<void>;
  onUpdateProfilePasscode: (
    profileId: string,
    newPasscode: string,
    currentPasscode?: string
  ) => Promise<boolean>;
  onDeleteProfileAndData: (profileId: string) => void;
  onSignOut: (purgeCache?: boolean) => void;
  onStartFreshGuestSession: () => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  authPersistenceMode,
  onChangeAuthPersistence,
  activeLocalProfile,
  savedLocalProfiles,
  onSignInProfile,
  onCreateProfile,
  onUpdateProfilePasscode,
  onDeleteProfileAndData,
  onSignOut,
  onStartFreshGuestSession,
}) => {
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfilePasscode, setNewProfilePasscode] = useState('');
  const [unlockingProfileId, setUnlockingProfileId] = useState<string | null>(null);
  const [unlockPasscode, setUnlockPasscode] = useState('');
  const [showPasscodeEditor, setShowPasscodeEditor] = useState(false);
  const [currentPasscodeInput, setCurrentPasscodeInput] = useState('');
  const [nextPasscodeInput, setNextPasscodeInput] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const keepSignedIn = authPersistenceMode === 'local';

  const resetModalTransientState = () => {
    setUnlockingProfileId(null);
    setUnlockPasscode('');
    setShowPasscodeEditor(false);
    setCurrentPasscodeInput('');
    setNextPasscodeInput('');
    setConfirmDeleteOpen(false);
    setDeleteConfirmText('');
    setErrorMsg(null);
    setStatusMsg(null);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newProfileName.trim();
    if (!trimmed) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await onCreateProfile(trimmed, newProfilePasscode.trim() || undefined);
      setNewProfileName('');
      setNewProfilePasscode('');
      resetModalTransientState();
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not create profile.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSelectProfile = async (prof: LocalUserProfile) => {
    setErrorMsg(null);
    setStatusMsg(null);
    if (prof.passcodeHash) {
      setUnlockingProfileId(prof.id);
      setUnlockPasscode('');
      return;
    }
    setBusy(true);
    try {
      const ok = await onSignInProfile(prof.id);
      if (ok) {
        resetModalTransientState();
        onClose();
      } else {
        setErrorMsg('Could not sign into profile.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockingProfileId) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const ok = await onSignInProfile(unlockingProfileId, unlockPasscode);
      if (ok) {
        resetModalTransientState();
        onClose();
      } else {
        setErrorMsg('Incorrect passcode. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePasscodeSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLocalProfile) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const ok = await onUpdateProfilePasscode(
        activeLocalProfile.id,
        nextPasscodeInput.trim(),
        activeLocalProfile.passcodeHash ? currentPasscodeInput : undefined
      );
      if (ok) {
        setStatusMsg(
          nextPasscodeInput.trim()
            ? 'Passcode lock updated.'
            : 'Passcode lock removed from this profile.'
        );
        setShowPasscodeEditor(false);
        setCurrentPasscodeInput('');
        setNextPasscodeInput('');
      } else {
        setErrorMsg('Current passcode did not match.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDeleteAccount = () => {
    if (!activeLocalProfile) return;
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') return;
    onDeleteProfileAndData(activeLocalProfile.id);
    resetModalTransientState();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/70 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-profile-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4">
          <div className="space-y-0.5">
            <h2
              id="user-profile-modal-title"
              className="font-display text-lg font-bold text-zinc-900"
            >
              {activeLocalProfile ? 'Your Account' : 'Account & Profiles'}
            </h2>
            <p className="text-xs text-zinc-500">
              Each person&apos;s decks and bot playtest progress stay separate and private.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Account Modal"
            className="rounded-lg border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[78vh] overflow-y-auto p-6 space-y-6">
          {/* Active Signed-In Profile Card */}
          {activeLocalProfile && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    {activeLocalProfile.passcodeHash ? (
                      <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0" />
                    ) : (
                      <UserCheck className="h-4 w-4 text-emerald-700 shrink-0" />
                    )}
                    <span className="truncate text-sm font-bold text-zinc-900">
                      {activeLocalProfile.name}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-600">
                    {activeLocalProfile.passcodeHash
                      ? 'Passcode protected · Decks & bots isolated to this profile'
                      : 'Active profile · Decks & bots isolated to this profile'}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onSignOut(!keepSignedIn);
                    resetModalTransientState();
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {activeLocalProfile.passcodeHash ? 'Lock & Sign Out' : 'Sign Out'}
                </button>
              </div>

              <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  checked={keepSignedIn}
                  disabled={busy}
                  onChange={(e) =>
                    onChangeAuthPersistence(e.target.checked ? 'local' : 'session')
                  }
                  className="h-3.5 w-3.5 rounded border-zinc-300 accent-sky-600 cursor-pointer"
                />
                <span>Keep me signed in on this device</span>
              </label>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-emerald-200 pt-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasscodeEditor((v) => !v);
                    setErrorMsg(null);
                    setStatusMsg(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:text-sky-800 cursor-pointer"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  {activeLocalProfile.passcodeHash
                    ? 'Change or Remove Passcode'
                    : 'Add Passcode Lock'}
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDeleteOpen((v) => !v)}
                  className="text-[11px] font-medium text-zinc-500 hover:text-red-700 cursor-pointer"
                >
                  Delete profile &amp; saved decks
                </button>
              </div>

              {showPasscodeEditor && (
                <form
                  onSubmit={(e) => void handlePasscodeSave(e)}
                  className="rounded-lg border border-zinc-200 bg-white p-3 space-y-2.5 text-xs"
                >
                  {activeLocalProfile.passcodeHash && (
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                        Current Passcode
                      </label>
                      <input
                        type="password"
                        required
                        value={currentPasscodeInput}
                        onChange={(e) => setCurrentPasscodeInput(e.target.value)}
                        placeholder="Enter current passcode"
                        className="w-full rounded border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 focus:border-sky-600 focus:outline-none"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                      {activeLocalProfile.passcodeHash
                        ? 'New Passcode (leave blank to remove lock)'
                        : 'New Passcode'}
                    </label>
                    <input
                      type="password"
                      required={!activeLocalProfile.passcodeHash}
                      value={nextPasscodeInput}
                      onChange={(e) => setNextPasscodeInput(e.target.value)}
                      placeholder={
                        activeLocalProfile.passcodeHash
                          ? 'New passcode or leave empty'
                          : 'Enter a passcode'
                      }
                      className="w-full rounded border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 focus:border-sky-600 focus:outline-none"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPasscodeEditor(false)}
                      className="px-2.5 py-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded bg-sky-700 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer"
                    >
                      Save Passcode
                    </button>
                  </div>
                </form>
              )}

              {confirmDeleteOpen && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-3 space-y-2 text-xs">
                  <p className="text-[11px] text-red-800 leading-relaxed">
                    This permanently deletes this profile, saved decks, and bot memory from this browser. Type{' '}
                    <code className="font-mono font-bold">DELETE</code> to confirm:
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder="Type DELETE"
                      aria-label="Type DELETE to confirm profile deletion"
                      className="flex-1 rounded border border-red-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 focus:border-red-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={
                        busy || deleteConfirmText.trim().toUpperCase() !== 'DELETE'
                      }
                      onClick={handleConfirmDeleteAccount}
                      className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                    >
                      Delete Everything
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {statusMsg && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              {statusMsg}
            </div>
          )}
          {errorMsg && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {errorMsg}
            </div>
          )}

          {/* Create New Account / Profile */}
          <form
            onSubmit={(e) => void handleCreateSubmit(e)}
            className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 space-y-3"
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Create Account / Profile
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                maxLength={40}
                placeholder="Enter profile name"
                aria-label="Profile name"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none"
              />
              <input
                type="password"
                value={newProfilePasscode}
                onChange={(e) => setNewProfilePasscode(e.target.value)}
                maxLength={64}
                placeholder="Optional passcode"
                aria-label="Optional passcode"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={keepSignedIn}
                  disabled={busy}
                  onChange={(e) =>
                    onChangeAuthPersistence(e.target.checked ? 'local' : 'session')
                  }
                  className="h-3.5 w-3.5 rounded border-zinc-300 accent-sky-600 cursor-pointer"
                />
                <span>Keep me signed in on this device</span>
              </label>

              <button
                type="submit"
                disabled={busy || !newProfileName.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Create &amp; Sign In
              </button>
            </div>
          </form>

          {/* Existing Profiles Switcher */}
          {savedLocalProfiles.length > 0 && (
            <div className="space-y-2.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Sign In / Switch Profile
              </div>

              <div className="space-y-2">
                {savedLocalProfiles.map((prof) => {
                  const isCurrent = activeLocalProfile?.id === prof.id;
                  const isUnlocking = unlockingProfileId === prof.id;

                  return (
                    <div
                      key={prof.id}
                      className={`rounded-lg border px-3 py-2.5 space-y-2 ${
                        isCurrent
                          ? 'border-sky-600 bg-sky-50'
                          : 'border-zinc-200 bg-zinc-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={isCurrent || busy}
                          onClick={() => void handleSelectProfile(prof)}
                          className="flex flex-1 items-center gap-2 text-left text-xs font-semibold text-zinc-900 cursor-pointer hover:text-sky-700 disabled:cursor-default"
                        >
                          {prof.passcodeHash ? (
                            <Lock className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                          ) : (
                            <UserCheck className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                          )}
                          <span>{prof.name}</span>
                          {prof.passcodeHash && !isCurrent && (
                            <span className="text-[11px] font-normal text-zinc-500">
                              · Passcode required
                            </span>
                          )}
                          {isCurrent && (
                            <span className="text-[11px] font-normal text-sky-700">
                              · Signed in
                            </span>
                          )}
                        </button>

                        {!isCurrent && (
                          <button
                            type="button"
                            onClick={() => {
                              if (unlockingProfileId === prof.id) {
                                setUnlockingProfileId(null);
                              }
                              onDeleteProfileAndData(prof.id);
                            }}
                            title={`Remove profile ${prof.name}`}
                            aria-label={`Delete profile ${prof.name}`}
                            className="rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-700 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {isUnlocking && (
                        <form
                          onSubmit={(e) => void handleUnlockSubmit(e)}
                          className="flex flex-col gap-2 pt-1 sm:flex-row"
                        >
                          <input
                            type="password"
                            autoFocus
                            required
                            value={unlockPasscode}
                            onChange={(e) => setUnlockPasscode(e.target.value)}
                            placeholder={`Enter passcode for ${prof.name}`}
                            aria-label={`Enter passcode for ${prof.name}`}
                            className="flex-1 rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 focus:border-sky-600 focus:outline-none"
                          />
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setUnlockingProfileId(null);
                                setUnlockPasscode('');
                                setErrorMsg(null);
                              }}
                              className="px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={busy || !unlockPasscode}
                              className="rounded bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-40 cursor-pointer"
                            >
                              Unlock
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Guest Session Action */}
          <div className="flex items-center justify-between border-t border-zinc-200 pt-4">
            <span className="text-xs text-zinc-500">
              Or use a temporary blank workspace:
            </span>
            <button
              type="button"
              onClick={() => {
                onStartFreshGuestSession();
                resetModalTransientState();
                onClose();
              }}
              className="text-xs font-semibold text-sky-700 hover:text-sky-800 cursor-pointer"
            >
              New Guest Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
