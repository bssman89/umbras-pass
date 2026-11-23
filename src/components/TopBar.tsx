import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Bot,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Cpu,
  ExternalLink,
  Globe,
  History,
  Info,
  LifeBuoy,
  Mail,
  MessageSquare,
  Power,
  RotateCcw,
  Scale,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  isStartupWelcomeDisabled,
  setStartupWelcomeDisabled,
  WELCOME_PREF_CHANGED_EVENT,
} from './GgufStartupModal';
import {
  isGitHubUpdateNotifyEnabled,
  setDismissedUpdateTag,
  setGitHubUpdateNotifyEnabled,
  UPDATE_NOTIFY_PREF_EVENT,
} from './UpdatesRollbackModal';

export type ActiveSection = 'import' | 'analysis' | 'optimize' | 'playtest';

const GITHUB_SOURCE_URL =
  (import.meta.env.VITE_GITHUB_REPO_URL as string | undefined)?.trim() ||
  'https://github.com/bssman89/umbras-pass';
const SUPPORT_EMAIL = 'umbraspass.support@gmail.com';

const CARD_MARKETPLACES = [
  { label: 'TCGplayer.com', href: 'https://www.tcgplayer.com' },
  { label: 'CardKingdom.com', href: 'https://www.cardkingdom.com' },
  { label: 'CardTrader.com', href: 'https://www.cardtrader.com/en-US' },
  { label: 'eBay.com', href: 'https://www.ebay.com' },
];

const DECK_PLATFORMS = [
  { label: 'Arena', href: 'https://magic.wizards.com/en/mtgarena' },
  { label: 'Moxfield', href: 'https://moxfield.com' },
  { label: 'Archidekt', href: 'https://archidekt.com' },
  { label: 'MTGGoldfish', href: 'https://www.mtggoldfish.com' },
  { label: 'ManaBox CSV', href: 'https://manabox.app' },
  { label: 'MTGO', href: 'https://www.mtgo.com' },
  { label: 'Cockatrice', href: 'https://cockatrice.github.io' },
  { label: 'Scryfall', href: 'https://scryfall.com' },
  { label: 'Deckstats', href: 'https://deckstats.net' },
  { label: 'TappedOut', href: 'https://tappedout.net' },
  { label: 'CubeCobra', href: 'https://cubecobra.com' },
  { label: 'MTGTop8', href: 'https://www.mtgtop8.com' },
  { label: 'Pastebin', href: 'https://pastebin.com' },
  { label: 'EDHREC.com', href: 'https://edhrec.com' },
];

const DEVELOPER_CREDITS = [
  {
    name: 'BizRoomba (bssman89)',
    role: 'Creator & Developer (github.com/bssman89)',
    href: 'https://github.com/bssman89',
  },
  {
    name: 'Google AI Studio',
    role: 'Development Platform',
    href: 'https://aistudio.google.com/',
  },
  {
    name: 'Hugging Face (huggingface.co)',
    role: 'GGUF AI Models',
    href: 'https://huggingface.co/',
  },
  {
    name: 'Firebase (firebase.google.com)',
    role: 'Hosting & Cloud Platform',
    href: 'https://firebase.google.com/',
  },
  {
    name: 'Vite (vite.dev)',
    role: 'Frontend Build Toolchain',
    href: 'https://vite.dev/',
  },
  {
    name: 'Electron (electronjs.org)',
    role: 'Desktop App Runtime',
    href: 'https://www.electronjs.org/',
  },
  {
    name: 'npm (npmjs.com)',
    role: 'Package Registry & Dependencies',
    href: 'https://www.npmjs.com/',
  },
];

interface TopBarProps {
  hasAnalysis: boolean;
  activeSection: ActiveSection;
  onNavigate: (section: ActiveSection) => void;
  isImportResetWarningOpen?: boolean;
  onConfirmImportReset?: () => void;
  onCancelImportReset?: () => void;
  userDeckCount: number;
  onOpenUserDecks: () => void;
  onOpenDesktopModal: () => void;
  onOpenWelcomeModal: () => void;
  onOpenUpdatesModal: () => void;
  hasAvailableUpdate?: boolean;
  onRequestExit: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  hasAnalysis,
  activeSection,
  onNavigate,
  isImportResetWarningOpen = false,
  onConfirmImportReset,
  onCancelImportReset,
  userDeckCount,
  onOpenUserDecks,
  onOpenDesktopModal,
  onOpenWelcomeModal,
  onOpenUpdatesModal,
  hasAvailableUpdate = false,
  onRequestExit,
}) => {
  const [logoError, setLogoError] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsArea, setSettingsArea] = useState<
    'general' | 'about' | 'source' | 'resources' | 'support' | 'disclaimers'
  >('general');
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedRepo, setCopiedRepo] = useState(false);
  const [showWelcomeOnStartup, setShowWelcomeOnStartup] = useState<boolean>(
    () => !isStartupWelcomeDisabled()
  );
  const [githubUpdateNotify, setGithubUpdateNotify] = useState<boolean>(() =>
    isGitHubUpdateNotifyEnabled()
  );

  // Feedback & Bug Reporting state inside Settings -> Support
  const [isBugFormOpen, setIsBugFormOpen] = useState(false);
  const [bugCategory, setBugCategory] = useState<'bug' | 'feature' | 'parsing' | 'other'>('bug');
  const [bugMessage, setBugMessage] = useState('');
  const [bugEmail, setBugEmail] = useState('');
  const [bugSubmitted, setBugSubmitted] = useState(false);
  const [bugError, setBugError] = useState<string | null>(null);

  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncWelcomePref = () => {
      setShowWelcomeOnStartup(!isStartupWelcomeDisabled());
    };
    const syncUpdatePref = () => {
      setGithubUpdateNotify(isGitHubUpdateNotifyEnabled());
    };
    window.addEventListener(WELCOME_PREF_CHANGED_EVENT, syncWelcomePref);
    window.addEventListener(UPDATE_NOTIFY_PREF_EVENT, syncUpdatePref);
    window.addEventListener('storage', syncWelcomePref);
    window.addEventListener('storage', syncUpdatePref);
    return () => {
      window.removeEventListener(WELCOME_PREF_CHANGED_EVENT, syncWelcomePref);
      window.removeEventListener(UPDATE_NOTIFY_PREF_EVENT, syncUpdatePref);
      window.removeEventListener('storage', syncWelcomePref);
      window.removeEventListener('storage', syncUpdatePref);
    };
  }, []);

  useEffect(() => {
    if (!isSettingsOpen) {
      setSettingsArea('general');
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setIsSettingsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSettingsOpen]);

  const handleCopySupportEmail = () => {
    try {
      void navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopiedEmail(true);
      window.setTimeout(() => setCopiedEmail(false), 2000);
    } catch {
      // Ignore clipboard unavailability
    }
  };

  const handleCopyRepoUrl = () => {
    try {
      void navigator.clipboard.writeText(GITHUB_SOURCE_URL);
      setCopiedRepo(true);
      window.setTimeout(() => setCopiedRepo(false), 2000);
    } catch {
      // Ignore clipboard unavailability
    }
  };

  const handleBugSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanMsg = bugMessage.trim();
    if (!cleanMsg) {
      setBugError('Please provide a brief description of the bug or feedback.');
      return;
    }
    setBugError(null);

    const report = {
      id: `bug_${Date.now().toString(36)}`,
      category: bugCategory,
      message: cleanMsg,
      email: bugEmail.trim(),
      createdAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };

    try {
      const existing = JSON.parse(localStorage.getItem('umbras_pass_bug_reports_v1') || '[]');
      localStorage.setItem('umbras_pass_bug_reports_v1', JSON.stringify([report, ...existing]));
    } catch {
      // Ignore storage errors
    }

    setBugSubmitted(true);

    try {
      const subject = encodeURIComponent(`[Umbras Pass Bug/Feedback] - ${bugCategory.toUpperCase()}`);
      const body = encodeURIComponent(
        `Category: ${bugCategory}\nSender: ${bugEmail || 'Anonymous'}\n\nMessage:\n${cleanMsg}\n\nURL: ${window.location.href}`
      );
      window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    } catch {
      // Fallback if mailto client cannot launch
    }

    window.setTimeout(() => {
      setBugSubmitted(false);
      setBugMessage('');
      setBugEmail('');
      setIsBugFormOpen(false);
    }, 2800);
  };

  const navItems: Array<{
    id: ActiveSection;
    label: string;
    shortLabel: string;
    icon: React.FC<{ className?: string }>;
    disabled?: boolean;
  }> = [
    { id: 'import', label: 'Import Deck', shortLabel: 'Import', icon: Upload },
    { id: 'analysis', label: 'Deck Overview', shortLabel: 'Overview', icon: BarChart3, disabled: !hasAnalysis },
    {
      id: 'optimize',
      label: 'Mana, Changes & List',
      shortLabel: 'Mana & List',
      icon: SlidersHorizontal,
      disabled: !hasAnalysis,
    },
    { id: 'playtest', label: 'Bot Playtest', shortLabel: 'Playtest', icon: Bot, disabled: !hasAnalysis },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-x-4 gap-y-2.5 px-4 sm:px-6 py-2.5">
        {/* Zone 1: Brand Logo, Tagline & Title */}
        <button
          type="button"
          onClick={() => onNavigate('import')}
          title={
            hasAnalysis
              ? 'Warning: Returning to Import Deck will stop your current Bot Playtest and reset the program'
              : 'Return to Import Deck'
          }
          aria-label="Umbras Pass — Return to Import Deck"
          className="order-1 inline-flex min-w-0 flex-1 sm:flex-initial items-center gap-2.5 sm:gap-3 text-left cursor-pointer sm:shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          {!logoError ? (
            <img
              src="/assets/aistudio/Umbras_pass_v3-removebg-preview_58159528_959d0bfd.png?v=2"
              alt="Umbras Pass logo"
              referrerPolicy="no-referrer"
              onError={() => setLogoError(true)}
              className="h-[100px] w-auto object-contain shrink-0"
            />
          ) : (
            <span
              aria-hidden="true"
              className="inline-flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-sky-700 text-xs font-bold text-white shrink-0"
            >
              UP
            </span>
          )}
          <span className="flex min-w-0 flex-col leading-snug">
            <span className="font-display text-xs sm:text-[15px] font-bold tracking-tight text-sky-700 truncate sm:whitespace-nowrap">
              Sharper Mana. Tighter Synergies. Smarter Playtests.
            </span>
            <span className="hidden sm:block text-xs font-medium text-zinc-500 truncate sm:whitespace-nowrap">
              Umbras Pass · Indie Magic: The Gathering Deck Analyzer &amp; Playtest Sim
            </span>
          </span>
        </button>

        {/* Zone 2: Clean Segmented Workspace Navigation */}
        <nav
          aria-label="Workspace sections"
          className="order-3 xl:order-2 hidden md:flex w-full xl:w-auto items-center justify-center gap-1 rounded-lg bg-zinc-100 p-1"
        >
          {navItems.map((item) => {
            const isActive = activeSection === item.id;
            const Icon = item.icon;
            return (
              <div key={item.id} className="relative group shrink-0">
                <button
                  type="button"
                  aria-disabled={item.disabled || undefined}
                  onClick={() => {
                    if (item.disabled) {
                      onNavigate('import');
                      return;
                    }
                    onNavigate(item.id);
                  }}
                  title={
                    item.disabled
                      ? `Import a deck first and click Analyze Deck before proceeding to ${item.label}`
                      : hasAnalysis && item.id === 'import'
                      ? 'Warning: Clicking Import Deck will stop your current Bot Playtest and reset the program to import a new deck'
                      : item.label
                  }
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    item.disabled
                      ? 'opacity-65 cursor-not-allowed text-zinc-500 hover:bg-amber-50 hover:text-amber-900'
                      : isActive
                      ? 'bg-white text-zinc-900 shadow-sm cursor-pointer'
                      : 'text-zinc-600 hover:text-zinc-900 cursor-pointer'
                  }`}
                >
                  <Icon
                    className={`h-3.5 w-3.5 shrink-0 ${
                      item.disabled
                        ? 'text-zinc-400 group-hover:text-amber-700'
                        : isActive
                        ? 'text-sky-700'
                        : 'text-zinc-500'
                    }`}
                  />
                  <span className="hidden 2xl:inline">{item.label}</span>
                  <span className="2xl:hidden">{item.shortLabel}</span>
                </button>

                {item.disabled && (
                  <div
                    role="tooltip"
                    className="pointer-events-none invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity duration-150 absolute left-1/2 top-full z-40 mt-2 w-64 -translate-x-1/2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[11px] leading-snug text-amber-950 shadow-lg"
                  >
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
                      <span>
                        <strong className="font-bold">Import &amp; Analyze First:</strong> Import a deck below and click{' '}
                        <strong className="font-semibold">Analyze Deck</strong> before proceeding to{' '}
                        <strong className="font-semibold">{item.label}</strong>.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Zone 3: Primary Action Cluster */}
        <div className="order-2 xl:order-3 ml-auto xl:ml-0 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenUserDecks}
            title="View your saved decks and snapshots"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
          >
            <History className="h-3.5 w-3.5 text-sky-700 shrink-0" />
            <span className="hidden sm:inline">My Decks</span>
            <span className="font-mono text-[11px] tabular-nums text-zinc-500">({userDeckCount})</span>
          </button>

          <div className="relative" ref={settingsRef}>
            <button
              type="button"
              onClick={() => setIsSettingsOpen((prev) => !prev)}
              aria-expanded={isSettingsOpen}
              aria-haspopup="menu"
              title="Settings, About, Support & Disclaimers"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 sm:px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                isSettingsOpen
                  ? 'border-sky-600 bg-sky-50 text-sky-900'
                  : 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50'
              }`}
            >
              <Settings className="h-3.5 w-3.5 text-sky-700 shrink-0" />
              <span className="hidden sm:inline">Settings</span>
              {hasAvailableUpdate && (
                <span
                  aria-label="Update available"
                  title="A newer GitHub release is available"
                  className="inline-block h-2 w-2 rounded-full bg-sky-600 shrink-0"
                />
              )}
              <ChevronDown
                className={`h-3.5 w-3.5 text-zinc-500 transition-transform shrink-0 ${
                  isSettingsOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isSettingsOpen && (
              <div
                role="menu"
                aria-label="Settings menu"
                className="absolute right-0 mt-2 w-[350px] sm:w-[560px] max-w-[calc(100vw-1.5rem)] max-h-[calc(100vh-5rem)] overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-2xl z-50"
              >
                {/* Sticky Settings Menu Area Tabs */}
                <div className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 px-2.5 py-2">
                  <div className="grid grid-cols-3 sm:flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
                    <button
                      type="button"
                      onClick={() => setSettingsArea('general')}
                      className={`sm:flex-1 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        settingsArea === 'general'
                          ? 'bg-white text-zinc-900 shadow-sm'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      <Settings className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                      <span>General</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettingsArea('about')}
                      className={`sm:flex-1 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        settingsArea === 'about'
                          ? 'bg-white text-zinc-900 shadow-sm'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      <Info className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                      <span>About</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettingsArea('source')}
                      className={`sm:flex-1 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        settingsArea === 'source'
                          ? 'bg-white text-zinc-900 shadow-sm'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      <Code2 className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                      <span>Open Source</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettingsArea('resources')}
                      className={`sm:flex-1 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        settingsArea === 'resources'
                          ? 'bg-white text-zinc-900 shadow-sm'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      <Globe className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                      <span>Resources</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettingsArea('support')}
                      className={`sm:flex-1 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        settingsArea === 'support'
                          ? 'bg-white text-zinc-900 shadow-sm'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      <LifeBuoy className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                      <span>Support</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettingsArea('disclaimers')}
                      className={`sm:flex-1 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        settingsArea === 'disclaimers'
                          ? 'bg-white text-zinc-900 shadow-sm'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      <Scale className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                      <span>Disclaimers</span>
                    </button>
                  </div>
                </div>

                {settingsArea === 'general' ? (
                  <div className="p-3 space-y-2.5">
                    <div className="space-y-2">
                      <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        AI Engine &amp; Startup
                      </div>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsSettingsOpen(false);
                          onOpenDesktopModal();
                        }}
                        className="w-full flex items-center justify-between gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-left hover:bg-sky-500/20 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Cpu className="h-4 w-4 text-sky-700 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-zinc-900">
                              AI Engine &amp; Local Models
                            </div>
                            <div className="text-[11px] text-zinc-600 truncate">
                              Configure Qwen .gguf models &amp; compute
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-sky-700 shrink-0" />
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsSettingsOpen(false);
                          onOpenWelcomeModal();
                        }}
                        className="w-full flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-left hover:border-sky-500/50 hover:bg-zinc-100 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <BookOpen className="h-4 w-4 text-sky-700 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-zinc-900">
                              Welcome &amp; .gguf Setup Guide
                            </div>
                            <div className="text-[11px] text-zinc-600 truncate">
                              Download &amp; install local Hugging Face models
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
                      </button>

                      <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-zinc-800">
                            Show welcome screen at startup
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {showWelcomeOnStartup ? 'Enabled on launch' : 'Hidden on launch'}
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={showWelcomeOnStartup}
                          aria-label="Toggle welcome screen at startup"
                          onClick={() => {
                            const nextShow = !showWelcomeOnStartup;
                            setStartupWelcomeDisabled(!nextShow);
                            setShowWelcomeOnStartup(nextShow);
                          }}
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                            showWelcomeOnStartup ? 'bg-sky-700' : 'bg-zinc-300'
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                              showWelcomeOnStartup ? 'translate-x-4.5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    <div className="border-t border-zinc-100 pt-2.5 space-y-2">
                      <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Updates &amp; Version
                      </div>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsSettingsOpen(false);
                          onOpenUpdatesModal();
                        }}
                        className="w-full flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-left hover:border-sky-500/50 hover:bg-zinc-100 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <History className="h-4 w-4 text-sky-700 shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900">
                              <span>Updates &amp; Version Rollback</span>
                              {hasAvailableUpdate && (
                                <span className="text-[10px] font-semibold text-sky-700">
                                  Update ready
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-600 truncate">
                              Check GitHub releases or restore an earlier build
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
                      </button>

                      <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-zinc-800">
                            GitHub update notifications
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {githubUpdateNotify
                              ? 'Alerts when a newer release is posted'
                              : 'Manual checks only'}
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={githubUpdateNotify}
                          aria-label="Toggle GitHub update notifications"
                          onClick={() => {
                            const nextNotify = !githubUpdateNotify;
                            setGitHubUpdateNotifyEnabled(nextNotify);
                            if (nextNotify) {
                              setDismissedUpdateTag(null);
                            }
                            setGithubUpdateNotify(nextNotify);
                          }}
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                            githubUpdateNotify ? 'bg-sky-700' : 'bg-zinc-300'
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                              githubUpdateNotify ? 'translate-x-4.5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    <div className="border-t border-zinc-100 pt-2.5">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsSettingsOpen(false);
                          onRequestExit();
                        }}
                        className="w-full flex items-center justify-between gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 cursor-pointer transition-colors"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Power className="h-3.5 w-3.5 shrink-0" />
                          <span>Exit Program</span>
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      </button>
                    </div>
                  </div>
                ) : settingsArea === 'about' ? (
                  /* About & Dev Credits Section */
                  <div className="p-3.5 bg-zinc-50 space-y-2.5">
                    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-zinc-900">
                          About Umbras Pass
                        </div>
                        <span className="text-[10px] font-medium text-sky-700">
                          Indie · Free Forever
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-zinc-600">
                        <strong className="font-semibold text-zinc-800">What It Does:</strong>{' '}
                        Umbras Pass gives Magic: The Gathering players an honest, transparent way to test decks, fine-tune mana bases and synergies, and compare card upgrades by running simulated games against smart AI bots.
                      </p>
                      <p className="text-[11px] leading-relaxed text-zinc-600">
                        <strong className="font-semibold text-zinc-800">Why I Built It:</strong>{' '}
                        As a hobbyist developer (<strong className="font-semibold text-zinc-800">BizRoomba</strong>), I wanted to take the guesswork out of deckbuilding and make solid analytics accessible to everyone.
                      </p>
                    </div>

                    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-800">
                        <Sparkles className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                        <span>Developer Credits</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                        {DEVELOPER_CREDITS.map((credit) => (
                          <a
                            key={credit.name}
                            href={credit.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 hover:border-sky-600 transition-colors"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-zinc-900 truncate">{credit.name}</div>
                              <div className="text-[10px] text-zinc-500 truncate">{credit.role}</div>
                            </div>
                            <ExternalLink className="h-3 w-3 text-sky-700 shrink-0" />
                          </a>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-1 text-[11px] text-zinc-600">
                      <div className="font-semibold text-zinc-800 mb-1">
                        Data &amp; Format Coverage
                      </div>
                      <div>
                        <span className="font-semibold text-zinc-800">Card Database:</span>{' '}
                        Scryfall API (Real-time prices &amp; Oracle text)
                      </div>
                      <div>
                        <span className="font-semibold text-zinc-800">Formats Supported:</span>{' '}
                        Commander, Standard, Modern, Pioneer, Pauper, Legacy, Vintage, Brawl
                      </div>
                    </div>
                  </div>
                ) : settingsArea === 'source' ? (
                  /* Open Source & GitHub Source Files Section */
                  <div className="p-3.5 bg-zinc-50 space-y-2.5">
                    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-zinc-900">
                          GitHub Source Files
                        </div>
                        <span className="text-[10px] font-semibold text-sky-700">
                          100% Open Source
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-zinc-600">
                        Explore every component, mana calculation, and bot rule on GitHub, or compile your own local build from source.
                      </p>

                      <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
                        <a
                          href={GITHUB_SOURCE_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold text-sky-700 hover:underline"
                        >
                          {GITHUB_SOURCE_URL}
                        </a>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={handleCopyRepoUrl}
                            title="Copy GitHub repository URL"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                          >
                            {copiedRepo ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-700" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                          <a
                            href={GITHUB_SOURCE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-800 transition-colors"
                          >
                            <span>View Code</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <a
                          href={GITHUB_SOURCE_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 hover:border-sky-600 hover:text-sky-700 transition-colors"
                        >
                          <span>Source Tree</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                        <a
                          href={`${GITHUB_SOURCE_URL}/releases`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 hover:border-sky-600 hover:text-sky-700 transition-colors"
                        >
                          <span>Releases &amp; Builds</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                        <a
                          href={`${GITHUB_SOURCE_URL}/issues`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 hover:border-sky-600 hover:text-sky-700 transition-colors"
                        >
                          <span>Issues &amp; PRs</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </div>
                    </div>

                    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-2">
                      <div className="text-xs font-semibold text-zinc-900">
                        Why It&apos;s Open Source
                      </div>
                      <p className="text-[11px] leading-relaxed text-zinc-600">
                        <strong className="font-semibold text-zinc-800">Auditable Math &amp; Bot Logic:</strong>{' '}
                        Public code lets players inspect how Monte Carlo opening hands, mana checks, synergy scores, and AI bot plays work—with no hidden black-box rules.
                      </p>
                      <p className="text-[11px] leading-relaxed text-zinc-600">
                        <strong className="font-semibold text-zinc-800">Community-Built &amp; Local-First:</strong>{' '}
                        Built by a player for the MTG community so anyone can fork, self-host, swap local <span className="font-mono">.gguf</span> models without lock-in, and keep decklists under their control.
                      </p>
                    </div>
                  </div>
                ) : settingsArea === 'resources' ? (
                  /* Card Marketplaces & Deck Platforms Resources Tab */
                  <div className="p-3.5 bg-zinc-50 space-y-2.5">
                    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-zinc-900">
                          Card Marketplaces
                        </div>
                        <span className="text-[10px] font-medium text-zinc-500">
                          Singles &amp; Pricing
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {CARD_MARKETPLACES.map((site) => (
                          <a
                            key={site.label}
                            href={site.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>{site.label}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-zinc-900">
                          Deck Platforms &amp; Resources
                        </div>
                        <span className="text-[10px] font-medium text-zinc-500">
                          Deckbuilding &amp; Data
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {DECK_PLATFORMS.map((site) => (
                          <a
                            key={site.label}
                            href={site.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>{site.label}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : settingsArea === 'support' ? (
                  /* Support & Bug Reporting Tab */
                  <div className="p-3.5 bg-zinc-50 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Mail className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[10px] font-medium text-zinc-500">
                            Support Email
                          </div>
                          <a
                            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('[Umbras Pass] Bug Report')}`}
                            className="block truncate text-xs font-semibold text-sky-700 hover:underline"
                          >
                            {SUPPORT_EMAIL}
                          </a>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopySupportEmail}
                        title="Copy support email"
                        className="rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer shrink-0 inline-flex items-center gap-1"
                      >
                        {copiedEmail ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-700" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Feedback & Bug Reporting */}
                    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-2">
                      <div className="text-xs font-semibold text-zinc-900">
                        Feedback &amp; Bug Reporting
                      </div>
                      <p className="text-[11px] leading-relaxed text-zinc-600">
                        Encountered a card parsing mismatch, rule edge-case, or bot playtest anomaly? Let us know so we can refine our analysis engine.
                      </p>
                      <button
                        type="button"
                        onClick={() => setIsBugFormOpen((prev) => !prev)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-800 cursor-pointer transition-colors"
                      >
                        <Bug className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                        <span>{isBugFormOpen ? 'Close Report Form' : 'Report a Bug / Feedback'}</span>
                      </button>

                      {isBugFormOpen && (
                        <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-3">
                          <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
                            <div className="flex items-center gap-1.5">
                              <MessageSquare className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                              <span className="text-[11px] font-bold text-zinc-900">
                                Submit Bug Report or Feature Request
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setIsBugFormOpen(false)}
                              className="text-[11px] text-zinc-500 hover:text-zinc-800 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>

                          {bugSubmitted ? (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center space-y-1">
                              <div className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-emerald-100 text-emerald-700 mx-auto">
                                <Check className="h-3.5 w-3.5" />
                              </div>
                              <div className="text-xs font-semibold text-emerald-900">
                                Report Submitted Successfully!
                              </div>
                              <p className="text-[11px] text-emerald-700">
                                Thank you for helping improve Umbras Pass. Your report was logged and prepared for {SUPPORT_EMAIL}.
                              </p>
                            </div>
                          ) : (
                            <form onSubmit={handleBugSubmit} className="space-y-2.5">
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <div>
                                  <label htmlFor="settings-bug-category" className="block text-[11px] font-medium text-zinc-700 mb-1">
                                    Issue Category
                                  </label>
                                  <select
                                    id="settings-bug-category"
                                    value={bugCategory}
                                    onChange={(e) => setBugCategory(e.target.value as 'bug' | 'feature' | 'parsing' | 'other')}
                                    className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[11px] text-zinc-900 focus:border-sky-600 focus:outline-none"
                                  >
                                    <option value="bug">Report a Bug / Error</option>
                                    <option value="parsing">Card Parsing / Scryfall Mismatch</option>
                                    <option value="feature">Feature Request</option>
                                    <option value="other">General Feedback</option>
                                  </select>
                                </div>
                                <div>
                                  <label htmlFor="settings-bug-email" className="block text-[11px] font-medium text-zinc-700 mb-1">
                                    Your Email (Optional)
                                  </label>
                                  <input
                                    id="settings-bug-email"
                                    type="email"
                                    value={bugEmail}
                                    onChange={(e) => setBugEmail(e.target.value)}
                                    placeholder="planeswalker@mtg.com"
                                    className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none"
                                  />
                                </div>
                              </div>

                              <div>
                                <label htmlFor="settings-bug-message" className="block text-[11px] font-medium text-zinc-700 mb-1">
                                  Description &amp; Steps to Reproduce <span className="text-red-600">*</span>
                                </label>
                                <textarea
                                  id="settings-bug-message"
                                  rows={3}
                                  value={bugMessage}
                                  onChange={(e) => setBugMessage(e.target.value)}
                                  placeholder="Describe what happened, deck format, or card names involved..."
                                  className="w-full rounded-md border border-zinc-300 bg-white p-2 text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none"
                                />
                              </div>

                              {bugError && (
                                <div className="text-[11px] font-medium text-red-700">{bugError}</div>
                              )}

                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setIsBugFormOpen(false)}
                                  className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                                >
                                  Close
                                </button>
                                <button
                                  type="submit"
                                  className="inline-flex items-center gap-1 rounded-md bg-sky-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-sky-800 cursor-pointer"
                                >
                                  <Send className="h-3 w-3" />
                                  <span>Submit Report</span>
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Disclaimers & Legal Notices Section */
                  <div className="p-3.5 bg-zinc-50 space-y-2.5">
                    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-1.5">
                      <div className="text-xs font-semibold text-zinc-900">
                        Unofficial Fan Project &amp; Trademarks
                      </div>
                      <p className="text-[11px] leading-relaxed text-zinc-600">
                        Umbras Pass is an independent fan project with no official affiliation, endorsement, or sponsorship by Wizards of the Coast LLC, Hasbro,{' '}
                        <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
                          Google AI Studio
                        </a>
                        ,{' '}
                        <a href="https://huggingface.co/" target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
                          Hugging Face
                        </a>
                        ,{' '}
                        <a href="https://firebase.google.com/" target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
                          Firebase
                        </a>
                        ,{' '}
                        <a href="https://vite.dev/" target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
                          Vite
                        </a>
                        ,{' '}
                        <a href="https://www.electronjs.org/" target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
                          Electron
                        </a>
                        ,{' '}
                        <a href="https://www.npmjs.com/" target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
                          npm
                        </a>
                        , Scryfall, EDHREC, MTG Arena, Moxfield, Archidekt, MTGGoldfish, ManaBox, MTGO, Cockatrice, Deckstats, TappedOut, CubeCobra, MTGTop8, Pastebin, TCGplayer.com, CardKingdom.com, CardTrader.com (cardtrader.com/en-US), or eBay.com. All card names, symbols, and trademarks belong to their respective owners, and all pricing or purchases occur solely on external sites.
                      </p>
                    </div>

                    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-1.5">
                      <div className="text-xs font-semibold text-zinc-900">
                        Source Files &amp; &ldquo;As Is&rdquo; Liability
                      </div>
                      <p className="text-[11px] leading-relaxed text-zinc-600">
                        GitHub source files and builds are provided &ldquo;as is&rdquo; without warranty of any kind. Users cloning, modifying, or running from source (including local <span className="font-mono">.gguf</span> models) are solely responsible for their own environment, credentials, and compliance with third-party terms. Dev Bssman89 / BizRoomba is not liable for any damages, modifications, third-party transactions, or outcomes from using this program or external links.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onRequestExit}
            title="Exit Umbras Pass"
            aria-label="Exit Program"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:border-red-300 hover:bg-zinc-50 hover:text-red-700 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
          >
            <Power className="h-3.5 w-3.5 text-red-600 shrink-0" />
            <span className="hidden sm:inline">Exit</span>
          </button>
        </div>
      </div>

      {/* Compact Mobile Workspace Bar (< md) */}
      <nav
        aria-label="Mobile workspace sections"
        className="flex md:hidden items-center gap-1 border-t border-zinc-100 bg-zinc-50 px-3 py-1.5"
      >
        <div className="flex w-full items-center gap-1 rounded-lg bg-zinc-100 p-1">
          {navItems.map((item) => {
            const isActive = activeSection === item.id;
            const Icon = item.icon;
            return (
              <div key={item.id} className="relative group flex-1">
                <button
                  type="button"
                  aria-disabled={item.disabled || undefined}
                  title={
                    item.disabled
                      ? `Import a deck first and click Analyze Deck before proceeding to ${item.label}`
                      : item.label
                  }
                  onClick={() => {
                    if (item.disabled) {
                      onNavigate('import');
                      return;
                    }
                    onNavigate(item.id);
                  }}
                  className={`w-full inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    item.disabled
                      ? 'opacity-65 cursor-not-allowed text-zinc-500 hover:bg-amber-50 hover:text-amber-900'
                      : isActive
                      ? 'bg-white text-zinc-900 shadow-sm cursor-pointer'
                      : 'text-zinc-600 hover:text-zinc-900 cursor-pointer'
                  }`}
                >
                  <Icon
                    className={`h-3.5 w-3.5 shrink-0 ${
                      item.disabled
                        ? 'text-zinc-400 group-hover:text-amber-700'
                        : isActive
                        ? 'text-sky-700'
                        : 'text-zinc-500'
                    }`}
                  />
                  <span>{item.shortLabel}</span>
                </button>

                {item.disabled && (
                  <div
                    role="tooltip"
                    className="pointer-events-none invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity duration-150 absolute left-1/2 top-full z-40 mt-2 w-56 -translate-x-1/2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] leading-snug text-amber-950 shadow-lg"
                  >
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
                      <span>
                        <strong className="font-bold">Import &amp; Analyze First:</strong> Import a deck and click{' '}
                        <strong className="font-semibold">Analyze Deck</strong> before proceeding to{' '}
                        <strong className="font-semibold">{item.label}</strong>.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      {/* Active Session Warning Banner when clicking Import Deck */}
      {hasAnalysis && isImportResetWarningOpen && (
        <div
          role="alert"
          aria-live="assertive"
          className="border-t border-amber-300 bg-amber-50 px-4 sm:px-6 py-2.5"
        >
          <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-amber-950 min-w-0">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
              <p className="leading-snug">
                <span className="font-bold">Warning:</span> Returning to{' '}
                <span className="font-semibold">Import Deck</span> will stop your active{' '}
                <span className="font-semibold">Bot Playtest / Live Game</span> and reset the program so you can import a new deck.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onCancelImportReset && (
                <button
                  type="button"
                  onClick={onCancelImportReset}
                  className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer"
                >
                  Cancel &amp; Keep Playing
                </button>
              )}
              {onConfirmImportReset && (
                <button
                  type="button"
                  onClick={onConfirmImportReset}
                  className="inline-flex items-center gap-1 rounded-md bg-amber-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-800 cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Stop Playtest &amp; Reset</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
