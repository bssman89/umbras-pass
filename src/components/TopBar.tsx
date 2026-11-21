import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Cpu,
  ExternalLink,
  History,
  Info,
  LifeBuoy,
  Mail,
  Power,
  Scale,
  Settings,
  Sparkles,
} from 'lucide-react';

export type ActiveSection = 'import' | 'mana' | 'changes' | 'export' | 'playtest';

const GITHUB_SOURCE_URL =
  (import.meta.env.VITE_GITHUB_REPO_URL as string | undefined)?.trim() ||
  'https://github.com/umbras-pass/umbras-pass';
const SUPPORT_EMAIL = 'umbraspass.support@gmail.com';

interface TopBarProps {
  hasAnalysis: boolean;
  activeSection: ActiveSection;
  onNavigate: (section: ActiveSection) => void;
  userDeckCount: number;
  onOpenUserDecks: () => void;
  onOpenDesktopModal: () => void;
  onRequestExit: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  hasAnalysis,
  activeSection,
  onNavigate,
  userDeckCount,
  onOpenUserDecks,
  onOpenDesktopModal,
  onRequestExit,
}) => {
  const [logoError, setLogoError] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsArea, setSettingsArea] = useState<'general' | 'about' | 'support' | 'disclaimers'>('general');
  const [copiedEmail, setCopiedEmail] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

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

  const navItems: Array<{ id: ActiveSection; label: string; disabled?: boolean }> = [
    { id: 'import', label: 'Import Deck' },
    { id: 'mana', label: 'Mana & Lands', disabled: !hasAnalysis },
    { id: 'changes', label: 'Card Changes', disabled: !hasAnalysis },
    { id: 'export', label: 'Optimized List', disabled: !hasAnalysis },
    { id: 'playtest', label: 'Bot Playtest', disabled: !hasAnalysis },
  ];

  return (
    <header className="md:sticky md:top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur-sm">
      <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-6 py-2">
        {/* Zone 1: Brand logo & wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('import')}
          aria-label="Umbras Pass — Return to Import Deck"
          className="order-1 inline-flex min-w-0 items-center gap-2.5 font-display text-sm font-semibold tracking-tight text-zinc-900 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          {!logoError ? (
            <img
              src="/assets/aistudio/Umbras_pass_v3-removebg-preview_58159528_959d0bfd.png?v=2"
              alt="Umbras Pass logo"
              referrerPolicy="no-referrer"
              onError={() => setLogoError(true)}
              className="h-11 w-auto object-contain shrink-0"
            />
          ) : (
            <span
              aria-hidden="true"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-sky-700 text-xs font-bold text-white shrink-0"
            >
              UP
            </span>
          )}
          <span className="flex min-w-0 flex-col text-left leading-snug">
            <span className="text-[20px] font-semibold text-sky-700">
              Sharper Mana. Tighter Synergies. Smarter Playtests.
            </span>
            <span className="hidden sm:inline text-[17px] font-medium text-zinc-500">
              Indie Magic: The Gathering Deck Analyzer &amp; Playtest Sim
            </span>
          </span>
        </button>

        {/* Zone 2: Workspace navigation links */}
        <nav
          className="order-3 xl:order-2 hidden lg:flex w-full xl:w-auto items-center justify-center gap-4 xl:gap-5 border-t border-zinc-100 xl:border-t-0 pt-2 xl:pt-0 text-sm font-medium"
          aria-label="Workspace sections"
        >
          {navItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                onClick={() => onNavigate(item.id)}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  isActive
                    ? 'border-sky-700 text-zinc-900'
                    : 'border-transparent text-zinc-600 hover:text-zinc-900 hover:border-zinc-300'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Streamlined Vault & Settings Controls pinned to right side */}
        <div className="order-2 xl:order-3 ml-auto flex items-center gap-2.5 shrink-0">
          <div className="relative" ref={settingsRef}>
            <button
              type="button"
              onClick={() => setIsSettingsOpen((prev) => !prev)}
              aria-expanded={isSettingsOpen}
              aria-haspopup="menu"
              title="Settings, AI Engine & About Umbras Pass"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition ${
                isSettingsOpen
                  ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                  : 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50'
              }`}
            >
              <Settings className="h-3.5 w-3.5 text-sky-600" />
              <span>Settings</span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${
                  isSettingsOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isSettingsOpen && (
              <div
                role="menu"
                aria-label="Settings menu"
                className="absolute right-0 mt-2 w-[350px] sm:w-[440px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-5rem)] overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-2xl z-50"
              >
                {/* Settings Menu Area Tabs */}
                <div className="flex items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => setSettingsArea('general')}
                    className={`flex-1 inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      settingsArea === 'general'
                        ? 'bg-white text-zinc-900 shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    <Settings className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                    <span>Settings</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettingsArea('about')}
                    className={`flex-1 inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
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
                    onClick={() => setSettingsArea('support')}
                    className={`flex-1 inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
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
                    className={`flex-1 inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      settingsArea === 'disclaimers'
                        ? 'bg-white text-zinc-900 shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    <Scale className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                    <span>Disclaimers</span>
                  </button>
                </div>

                {settingsArea === 'general' ? (
                  <>
                    {/* AI Engine Sub-Menu Action */}
                    <div className="p-3 border-b border-zinc-100">
                      <div className="px-1.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                        Engine &amp; Runtime
                      </div>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsSettingsOpen(false);
                          onOpenDesktopModal();
                        }}
                        className="w-full flex items-center justify-between gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2.5 text-left hover:bg-sky-500/20 cursor-pointer transition-colors"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <Cpu className="h-4 w-4 text-sky-700 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-zinc-900">
                              AI Engine &amp; Local Models
                            </div>
                            <div className="text-[11px] text-zinc-600 leading-snug">
                              Local Qwen GGUF models and compute settings
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-sky-700 shrink-0" />
                      </button>
                    </div>

                    {/* Information & Support Area Entries */}
                    <div className="p-3 border-b border-zinc-100 space-y-2">
                      <div className="px-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                        Program Info &amp; Support
                      </div>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => setSettingsArea('about')}
                        className="w-full flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-left hover:border-sky-500/50 hover:bg-zinc-100 cursor-pointer transition-colors"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <Info className="h-4 w-4 text-sky-700 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-zinc-900">
                              About Umbras Pass
                            </div>
                            <div className="text-[11px] text-zinc-600 leading-snug">
                              Dev credits &amp; platform details
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => setSettingsArea('support')}
                        className="w-full flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-left hover:border-sky-500/50 hover:bg-zinc-100 cursor-pointer transition-colors"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <LifeBuoy className="h-4 w-4 text-sky-700 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-zinc-900">
                              Support &amp; Resources
                            </div>
                            <div className="text-[11px] text-zinc-600 leading-snug">
                              Bug support email, source files, marketplaces &amp; deck sites
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => setSettingsArea('disclaimers')}
                        className="w-full flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-left hover:border-sky-500/50 hover:bg-zinc-100 cursor-pointer transition-colors"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <Scale className="h-4 w-4 text-sky-700 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-zinc-900">
                              Disclaimers &amp; Legal
                            </div>
                            <div className="text-[11px] text-zinc-600 leading-snug">
                              Program affiliation, source files &amp; third-party notices
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
                      </button>
                    </div>

                    {/* Exit Program Action inside Settings Menu */}
                    <div className="p-3 bg-white">
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
                  </>
                ) : settingsArea === 'about' ? (
                  /* Separate About Area: Program Overview & Dev Credits */
                  <div className="p-4 bg-zinc-50 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900">
                        <Info className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                        <span>About Umbras Pass</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettingsArea('general')}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                      >
                        <ArrowLeft className="h-3 w-3" />
                        <span>Back</span>
                      </button>
                    </div>

                    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-zinc-900">
                          Umbras Pass — Why It Exists
                        </div>
                        <span className="text-[10px] font-medium text-sky-700">
                          Open-Source · Free Forever
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-zinc-600">
                        <strong className="font-semibold text-zinc-800">Our Goal:</strong>{' '}
                        Give Magic: The Gathering deckbuilders an honest, transparent toolkit to test deck builds, optimize mana bases, card synergies & compare upgrades, with simulated game matches against smart AI bots.
                      </p>
                      <p className="text-[11px] leading-relaxed text-zinc-600">
                        <strong className="font-semibold text-zinc-800">Why the Program was Made:</strong>{' '}
                        Built by dev <strong className="font-semibold text-zinc-800">BizRoomba</strong> to improve deck analytics for every MTG player without guesswork.
                      </p>
                      <p className="text-[11px] leading-relaxed text-zinc-600">
                        <strong className="font-semibold text-zinc-800">Always Open-Source &amp; Never Paid:</strong>{' '}
                        Built by players for the MTG community—Umbras Pass will remain 100% free and open-source forever so anyone can analyze and improve their decks without a paywall.
                      </p>
                    </div>

                    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-700">
                        <Sparkles className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                        <span>Dev Credits</span>
                      </div>
                      <div className="grid grid-cols-1 gap-1.5 text-[11px]">
                        <a
                          href="https://github.com/bssman89"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 hover:border-sky-600 transition-colors"
                        >
                          <div>
                            <div className="font-semibold text-zinc-900">BizRoomba (bssman89)</div>
                            <div className="text-[10px] text-zinc-500">Creator &amp; Developer (github.com/bssman89)</div>
                          </div>
                          <ExternalLink className="h-3 w-3 text-sky-700 shrink-0" />
                        </a>
                        <a
                          href="https://aistudio.google.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 hover:border-sky-600 transition-colors"
                        >
                          <div>
                            <div className="font-semibold text-zinc-900">Google AI Studio</div>
                            <div className="text-[10px] text-zinc-500">App engineering &amp; build platform</div>
                          </div>
                          <ExternalLink className="h-3 w-3 text-sky-700 shrink-0" />
                        </a>
                        <a
                          href="https://huggingface.co/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 hover:border-sky-600 transition-colors"
                        >
                          <div>
                            <div className="font-semibold text-zinc-900">Hugging Face (huggingface.co)</div>
                            <div className="text-[10px] text-zinc-500">Local GGUF open-weight AI models</div>
                          </div>
                          <ExternalLink className="h-3 w-3 text-sky-700 shrink-0" />
                        </a>
                        <a
                          href="https://firebase.google.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 hover:border-sky-600 transition-colors"
                        >
                          <div>
                            <div className="font-semibold text-zinc-900">Firebase (firebase.google.com)</div>
                            <div className="text-[10px] text-zinc-500">Hosting &amp; cloud backend platform</div>
                          </div>
                          <ExternalLink className="h-3 w-3 text-sky-700 shrink-0" />
                        </a>
                        <a
                          href="https://vite.dev/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 hover:border-sky-600 transition-colors"
                        >
                          <div>
                            <div className="font-semibold text-zinc-900">Vite (vite.dev)</div>
                            <div className="text-[10px] text-zinc-500">Frontend build &amp; bundling toolchain</div>
                          </div>
                          <ExternalLink className="h-3 w-3 text-sky-700 shrink-0" />
                        </a>
                        <a
                          href="https://www.electronjs.org/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 hover:border-sky-600 transition-colors"
                        >
                          <div>
                            <div className="font-semibold text-zinc-900">Electron (electronjs.org)</div>
                            <div className="text-[10px] text-zinc-500">Desktop app runtime</div>
                          </div>
                          <ExternalLink className="h-3 w-3 text-sky-700 shrink-0" />
                        </a>
                        <a
                          href="https://www.npmjs.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 hover:border-sky-600 transition-colors"
                        >
                          <div>
                            <div className="font-semibold text-zinc-900">npm (npmjs.com)</div>
                            <div className="text-[10px] text-zinc-500">Package registry &amp; dependencies</div>
                          </div>
                          <ExternalLink className="h-3 w-3 text-sky-700 shrink-0" />
                        </a>
                      </div>
                    </div>
                  </div>
                ) : settingsArea === 'support' ? (
                  /* Support Tab: Bug Support Email, Source Files & Platform Links */
                  <div className="p-4 bg-zinc-50 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900">
                        <LifeBuoy className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                        <span>Support &amp; Resources</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettingsArea('general')}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                      >
                        <ArrowLeft className="h-3 w-3" />
                        <span>Back</span>
                      </button>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Mail className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-[10px] font-medium text-zinc-500">
                              Bug Support Email
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

                      <a
                        href={GITHUB_SOURCE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 hover:border-sky-600 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Code2 className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                          <div className="min-w-0 space-y-0.5">
                            <div className="text-[10px] font-medium text-zinc-500">
                              Source Files on GitHub
                            </div>
                            <div className="text-[11px] text-zinc-600 leading-snug">
                              Looking to dev? Compile your own version of this program with the source files from the GitHub.com repo.
                            </div>
                            <div className="truncate font-mono text-[11px] font-semibold text-sky-700">
                              {GITHUB_SOURCE_URL}
                            </div>
                          </div>
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                      </a>

                      <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-2">
                        <div className="text-[10px] font-medium text-zinc-500">
                          Card Marketplaces &amp; Resources
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <a
                            href="https://www.tcgplayer.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>TCGplayer.com</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <a
                            href="https://www.cardkingdom.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>CardKingdom.com</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <a
                            href="https://www.ebay.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>eBay.com</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        </div>
                      </div>

                      <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-2">
                        <div className="text-[10px] font-medium text-zinc-500">
                          Deck Platforms &amp; Resources
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <a
                            href="https://magic.wizards.com/en/mtgarena"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>Arena</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <a
                            href="https://moxfield.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>Moxfield</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <a
                            href="https://archidekt.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>Archidekt</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <a
                            href="https://www.mtggoldfish.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>MTGGoldfish</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <a
                            href="https://manabox.app"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>ManaBox CSV</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <a
                            href="https://www.mtgo.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>MTGO</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <a
                            href="https://cockatrice.github.io"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>Cockatrice</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <a
                            href="https://scryfall.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>Scryfall</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <a
                            href="https://deckstats.net"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>Deckstats</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <a
                            href="https://tappedout.net"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>TappedOut</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <a
                            href="https://cubecobra.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>CubeCobra</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <a
                            href="https://www.mtgtop8.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>MTGTop8</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <a
                            href="https://pastebin.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                          >
                            <span>Pastebin</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Fourth Tab: Dedicated Disclaimers & Legal Notices Section */
                  <div className="p-4 bg-zinc-50 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900">
                        <Scale className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                        <span>Disclaimers &amp; Legal</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettingsArea('general')}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                      >
                        <ArrowLeft className="h-3 w-3" />
                        <span>Back</span>
                      </button>
                    </div>

                    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-1.5">
                      <div className="text-[11px] font-semibold text-zinc-700">
                        General Disclaimer
                      </div>
                      <p className="text-[11px] leading-relaxed text-zinc-600">
                        Umbras Pass is an independent (indie) program created by fans and has no official affiliation with, endorsement from, or sponsorship by Wizards of the Coast LLC, Hasbro,{' '}
                        <a
                          href="https://aistudio.google.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-700 hover:underline"
                        >
                          Google AI Studio
                        </a>
                        ,{' '}
                        <a
                          href="https://huggingface.co/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-700 hover:underline"
                        >
                          Hugging Face (huggingface.co)
                        </a>
                        ,{' '}
                        <a
                          href="https://firebase.google.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-700 hover:underline"
                        >
                          Firebase (firebase.google.com)
                        </a>
                        ,{' '}
                        <a
                          href="https://vite.dev/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-700 hover:underline"
                        >
                          Vite (vite.dev)
                        </a>
                        ,{' '}
                        <a
                          href="https://www.electronjs.org/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-700 hover:underline"
                        >
                          Electron (electronjs.org)
                        </a>
                        ,{' '}
                        <a
                          href="https://www.npmjs.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-700 hover:underline"
                        >
                          npm (npmjs.com)
                        </a>
                        , Scryfall, MTG Arena, Moxfield, Archidekt, MTGGoldfish, ManaBox, MTGO, Cockatrice, Deckstats, TappedOut, CubeCobra, MTGTop8, Pastebin, TCGplayer.com, CardKingdom.com, eBay.com, or any other Magic: The Gathering (MTG) entities, development platforms, AI model hubs, cloud providers, software runtimes, package registries, deck tools, or marketplace platforms. All card names, symbols, file formats, and trademarks belong to their respective owners. External links to deck platforms and marketplaces are provided strictly for convenience; deck services, pricing, and purchases occur solely on those external sites. Dev Bssman89 or BizRoomba is not liable or responsible for any damages, issues, third-party transactions, or outcomes arising from the use of this program or linked external websites.
                      </p>
                    </div>

                    <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-1.5">
                      <div className="text-[11px] font-semibold text-zinc-700">
                        Source Files Disclaimer
                      </div>
                      <p className="text-[11px] leading-relaxed text-zinc-600">
                        Source files hosted on GitHub are provided &ldquo;as is&rdquo; for community review and self-hosted indie use without warranty of any kind. Anyone cloning, modifying, or running from source is responsible for their own local setup, credentials, and compliance with third-party data provider, development platform, AI model hub, hosting, build toolchain, runtime, package registry, deck platform, and marketplace terms (including{' '}
                        <a
                          href="https://aistudio.google.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-700 hover:underline"
                        >
                          Google AI Studio
                        </a>
                        ,{' '}
                        <a
                          href="https://huggingface.co/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-700 hover:underline"
                        >
                          Hugging Face (huggingface.co)
                        </a>
                        ,{' '}
                        <a
                          href="https://firebase.google.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-700 hover:underline"
                        >
                          Firebase (firebase.google.com)
                        </a>
                        ,{' '}
                        <a
                          href="https://vite.dev/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-700 hover:underline"
                        >
                          Vite (vite.dev)
                        </a>
                        ,{' '}
                        <a
                          href="https://www.electronjs.org/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-700 hover:underline"
                        >
                          Electron (electronjs.org)
                        </a>
                        ,{' '}
                        <a
                          href="https://www.npmjs.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-700 hover:underline"
                        >
                          npm (npmjs.com)
                        </a>
                        , Scryfall, MTG Arena, Moxfield, Archidekt, MTGGoldfish, ManaBox, MTGO, Cockatrice, Deckstats, TappedOut, CubeCobra, MTGTop8, Pastebin, TCGplayer.com, CardKingdom.com, and eBay.com). Dev Bssman89 or BizRoomba is not liable or responsible for any issues, damages, or modifications resulting from the use of these source files or any external links.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onOpenUserDecks}
            title="View your saved decks and snapshots"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            <History className="h-3.5 w-3.5 text-sky-600" />
            <span className="tabular-nums">My Decks ({userDeckCount})</span>
          </button>

          <button
            type="button"
            onClick={onRequestExit}
            title="Exit Umbras Pass"
            aria-label="Exit Program"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:border-red-400 hover:bg-red-50 hover:text-red-700 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
          >
            <Power className="h-3.5 w-3.5 text-red-600" />
            <span className="hidden sm:inline">Exit Program</span>
          </button>
        </div>
      </div>
    </header>
  );
};
