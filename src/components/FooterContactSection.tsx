import React, { useState } from 'react';
import { Bug, Check, Code2, ExternalLink, MessageSquare, Send } from 'lucide-react';

const SOURCE_FILES_URL = 'https://github.com/umbras-pass/umbras-pass';

export const FooterContactSection: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState<'bug' | 'feature' | 'parsing' | 'other'>('bug');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanMsg = message.trim();
    if (!cleanMsg) {
      setError('Please provide a brief description of the bug or feedback.');
      return;
    }
    setError(null);

    // Simulate successful report logging / storage
    const report = {
      id: `bug_${Date.now().toString(36)}`,
      category,
      message: cleanMsg,
      email: email.trim(),
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

    setSubmitted(true);

    // Also trigger mailto window if desired or helpful
    try {
      const subject = encodeURIComponent(`[Umbras Pass Bug/Feedback] - ${category.toUpperCase()}`);
      const body = encodeURIComponent(`Category: ${category}\nSender: ${email || 'Anonymous'}\n\nMessage:\n${cleanMsg}\n\nURL: ${window.location.href}`);
      window.location.href = `mailto:umbraspass.support@gmail.com?subject=${subject}&body=${body}`;
    } catch {
      // Fallback
    }

    setTimeout(() => {
      setSubmitted(false);
      setMessage('');
      setEmail('');
      setIsOpen(false);
    }, 2800);
  };

  return (
    <footer className="border-t border-zinc-200 bg-white">
      <div className="mx-auto max-w-[1360px] px-6 py-10 space-y-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              About &amp; Dev Credits
            </div>
            <div className="space-y-2 text-xs leading-relaxed text-zinc-600">
              <p>
                <span className="font-semibold text-zinc-800">Goal:</span>{' '}
                Umbras Pass Gives Magic: The Gathering deckbuilders an honest, transparent toolkit to test deck builds, optimize mana bases ,card synergies & compare upgrades, with simulated game matches against smart AI bots.
              </p>
              <p>
                <span className="font-semibold text-zinc-800">Why the Program was Made:</span>{' '}
                Built by dev <span className="font-semibold text-zinc-800">BizRoomba</span>  to improve deck analytics  for every MTG player without guesswork.
              </p>
              <p>
                <span className="font-semibold text-zinc-800">Always Open-Source &amp; Never Paid:</span>{' '}
                Made for the MTG community—Umbras Pass will remain 100% free and open-source forever so anyone can analyze and improve their decks without a paywall.
              </p>
            </div>
            <div className="space-y-1.5 pt-1 text-xs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Developer Credits
              </div>
              <div className="flex flex-col gap-1.5">
                <a
                  href="https://github.com/bssman89"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:border-sky-600 transition-colors"
                >
                  <span>
                    <span className="font-semibold text-sky-700">BizRoomba (bssman89)</span>{' '}
                    <span className="text-zinc-500">(github.com/bssman89) — Creator &amp; Developer</span>
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                </a>
                <a
                  href="https://aistudio.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:border-sky-600 transition-colors"
                >
                  <span>
                    <span className="font-semibold text-sky-700">Google AI Studio</span>{' '}
                    <span className="text-zinc-500">— Development Platform</span>
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                </a>
                <a
                  href="https://huggingface.co/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:border-sky-600 transition-colors"
                >
                  <span>
                    <span className="font-semibold text-sky-700">Hugging Face</span>{' '}
                    <span className="text-zinc-500">(huggingface.co) — GGUF AI Models</span>
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                </a>
                <a
                  href="https://firebase.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:border-sky-600 transition-colors"
                >
                  <span>
                    <span className="font-semibold text-sky-700">Firebase</span>{' '}
                    <span className="text-zinc-500">(firebase.google.com) — Hosting &amp; Cloud Platform</span>
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                </a>
                <a
                  href="https://vite.dev/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:border-sky-600 transition-colors"
                >
                  <span>
                    <span className="font-semibold text-sky-700">Vite</span>{' '}
                    <span className="text-zinc-500">(vite.dev) — Frontend Build Toolchain</span>
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                </a>
                <a
                  href="https://www.electronjs.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:border-sky-600 transition-colors"
                >
                  <span>
                    <span className="font-semibold text-sky-700">Electron</span>{' '}
                    <span className="text-zinc-500">(electronjs.org) — Desktop App Runtime</span>
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                </a>
                <a
                  href="https://www.npmjs.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:border-sky-600 transition-colors"
                >
                  <span>
                    <span className="font-semibold text-sky-700">npm</span>{' '}
                    <span className="text-zinc-500">(npmjs.com) — Package Registry &amp; Dependencies</span>
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                </a>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Support &amp; Resources
            </div>
            <ul className="space-y-2 text-xs text-zinc-600">
              <li>
                <span className="font-medium text-zinc-800">Card Database:</span> Scryfall API (Real-time prices &amp; Oracle text)
              </li>
              <li>
                <span className="font-medium text-zinc-800">Formats Supported:</span> Commander, Standard, Modern, Pioneer, Pauper, Legacy, Vintage, Brawl
              </li>
              <li>
                <span className="font-medium text-zinc-800">Support Email:</span>{' '}
                <a href="mailto:umbraspass.support@gmail.com" className="text-sky-700 hover:underline">
                  umbraspass.support@gmail.com
                </a>
              </li>
              <li>
                <span className="font-medium text-zinc-800">Card Marketplaces &amp; Resources:</span>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <a
                    href="https://www.tcgplayer.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>TCGplayer.com</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <a
                    href="https://www.cardkingdom.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>CardKingdom.com</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <a
                    href="https://www.ebay.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>eBay.com</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </div>
              </li>
              <li>
                <span className="font-medium text-zinc-800">Deck Platforms &amp; Resources:</span>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <a
                    href="https://magic.wizards.com/en/mtgarena"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>Arena</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <a
                    href="https://moxfield.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>Moxfield</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <a
                    href="https://archidekt.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>Archidekt</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <a
                    href="https://www.mtggoldfish.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>MTGGoldfish</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <a
                    href="https://manabox.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>ManaBox CSV</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <a
                    href="https://www.mtgo.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>MTGO</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <a
                    href="https://cockatrice.github.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>Cockatrice</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <a
                    href="https://scryfall.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>Scryfall</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <a
                    href="https://deckstats.net"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>Deckstats</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <a
                    href="https://tappedout.net"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>TappedOut</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <a
                    href="https://cubecobra.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>CubeCobra</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <a
                    href="https://www.mtgtop8.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>MTGTop8</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <a
                    href="https://pastebin.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors"
                  >
                    <span>Pastebin</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </div>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Feedback &amp; Bug Reporting
            </div>
            <p className="text-xs text-zinc-600">
              Encountered a card parsing mismatch, rule edge-case, or bot playtest anomaly? Let us know so we can refine our analysis engine.
            </p>
            <div>
              <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 cursor-pointer transition-colors shadow-sm"
              >
                <Bug className="h-3.5 w-3.5 text-sky-400" />
                {isOpen ? 'Close Report Form' : 'Report a Bug / Feedback'}
              </button>
            </div>
          </div>
        </div>

        {/* Expandable Bug Report & Feedback Form */}
        {isOpen && (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 space-y-4 max-w-2xl animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-sky-700" />
                <h3 className="font-display text-sm font-bold text-zinc-900">
                  Submit Bug Report or Feature Request
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-xs text-zinc-500 hover:text-zinc-800 cursor-pointer"
              >
                Cancel
              </button>
            </div>

            {submitted ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center space-y-1">
                <div className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-emerald-100 text-emerald-700 mx-auto">
                  <Check className="h-4 w-4" />
                </div>
                <div className="text-sm font-semibold text-emerald-900">Report Submitted Successfully!</div>
                <p className="text-xs text-emerald-700">
                  Thank you for helping improve Umbras Pass. Your report has been logged and opened via email to umbraspass.support@gmail.com.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="bug-category" className="block text-xs font-medium text-zinc-700 mb-1">
                      Issue Category
                    </label>
                    <select
                      id="bug-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value as any)}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 focus:border-sky-600 focus:outline-none"
                    >
                      <option value="bug">🐛 Report a Bug / Error</option>
                      <option value="parsing">📜 Card Parsing / Scryfall Mismatch</option>
                      <option value="feature">💡 Feature Request</option>
                      <option value="other">💬 General Feedback</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="bug-email" className="block text-xs font-medium text-zinc-700 mb-1">
                      Your Email (Optional)
                    </label>
                    <input
                      id="bug-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="planeswalker@mtg.com"
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="bug-message" className="block text-xs font-medium text-zinc-700 mb-1">
                    Description &amp; Steps to Reproduce <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    id="bug-message"
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Describe what happened, deck format, or card names involved..."
                    className="w-full rounded-lg border border-zinc-300 bg-white p-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none"
                  />
                </div>

                {error && (
                  <div className="text-xs font-medium text-red-700">{error}</div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer shadow-sm"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Submit Report
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Dedicated Source Files Section */}
        <section
          aria-label="Source Files"
          className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-4 space-y-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-sky-700">
                <Code2 className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-display text-sm font-semibold text-zinc-900">
                  Source Files
                </h3>
                <p className="mt-0.5 text-xs text-zinc-600">
                  Looking to dev? Compile your own version of this program with the source files from the GitHub.com repo.
                </p>
              </div>
            </div>

            <a
              href={SOURCE_FILES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-between gap-2.5 rounded-lg border border-zinc-300 bg-white px-4 py-2 font-mono text-xs font-semibold text-sky-700 hover:border-sky-600 hover:bg-zinc-100 transition-colors shrink-0"
            >
              <span className="truncate">{SOURCE_FILES_URL}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          </div>

          <p className="border-t border-zinc-200 pt-2.5 text-[11px] leading-relaxed text-zinc-500">
            <span className="font-semibold text-zinc-600">Source Files Disclaimer:</span> The Umbras Pass repository on GitHub is provided &ldquo;as is&rdquo; for community review and self-hosted indie use, without warranty of any kind. Users cloning, modifying, or running from source are responsible for their own local environment configuration, credentials, and adherence to third-party data provider, development platform, AI model hub, hosting, build toolchain, runtime, package registry, deck platform, and marketplace terms (including{' '}
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
        </section>

        <div className="border-t border-zinc-100 pt-6 space-y-2.5 text-xs text-zinc-500">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span>&copy; {new Date().getFullYear()} Umbras Pass · Indie Magic: The Gathering Deck Analyzer &amp; Playtest Sim</span>
            <span>Card metadata and imagery sourced from Scryfall</span>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            <span className="font-semibold text-zinc-600">Disclaimer:</span> Umbras Pass is an independent (indie) program created by fans and has no official affiliation with, endorsement from, or sponsorship by Wizards of the Coast LLC, Hasbro,{' '}
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
            , Scryfall, MTG Arena, Moxfield, Archidekt, MTGGoldfish, ManaBox, MTGO, Cockatrice, Deckstats, TappedOut, CubeCobra, MTGTop8, Pastebin, TCGplayer.com, CardKingdom.com, eBay.com, or any other Magic: The Gathering (MTG) entities, development platforms, AI model hubs, cloud providers, software runtimes, package registries, deck tools, or marketplace platforms. Magic: The Gathering and all associated card names, symbols, file formats, and trademarks belong to their respective owners. External resource, deck platform, and marketplace links are provided strictly for informational convenience—pricing, deck services, availability, and transactions occur solely on those external sites. Dev Bssman89 or BizRoomba is not liable or responsible for any damages, issues, third-party transactions, or outcomes arising from the use of this program or linked external websites.
          </p>
        </div>
      </div>
    </footer>
  );
};
