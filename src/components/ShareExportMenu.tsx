import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Download, FileSpreadsheet, FileText } from 'lucide-react';

interface ShareExportMenuProps {
  onExportPdf: () => void;
  onExportTxt: () => void;
  onExportCsv: () => void;
  onCopyRawList?: () => Promise<boolean> | boolean | void;
  onExportRawListTxt?: () => void;
  onExportMoxfieldTxt?: () => void;
  onExportMoxfieldCsv?: () => void;
  onExportArchidektTxt?: () => void;
  onExportArchidektCsv?: () => void;
  size?: 'sm' | 'md';
}

export const ShareExportMenu: React.FC<ShareExportMenuProps> = ({
  onExportPdf,
  onExportTxt,
  onExportCsv,
  onCopyRawList,
  onExportRawListTxt,
  onExportMoxfieldTxt,
  onExportMoxfieldCsv,
  onExportArchidektTxt,
  onExportArchidektCsv,
  size = 'sm',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [rawCopied, setRawCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const buttonSizeClass =
    size === 'md' ? 'px-4 py-2 text-sm' : 'px-3.5 py-2 text-xs';

  const hasPlatformExports = Boolean(
    onCopyRawList ||
      onExportRawListTxt ||
      onExportMoxfieldTxt ||
      onExportMoxfieldCsv ||
      onExportArchidektTxt ||
      onExportArchidektCsv
  );

  const handleCopyRawList = async () => {
    if (!onCopyRawList) return;
    setIsOpen(false);
    const result = await onCopyRawList();
    if (result !== false) {
      setRawCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setRawCopied(false), 2000);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`inline-flex items-center gap-1.5 rounded-lg font-semibold text-white cursor-pointer whitespace-nowrap shrink-0 shadow-sm transition-colors ${
          rawCopied
            ? 'bg-emerald-700 hover:bg-emerald-800'
            : 'bg-sky-700 hover:bg-sky-800'
        } ${buttonSizeClass}`}
      >
        {rawCopied ? (
          <>
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>Copied Raw List</span>
          </>
        ) : (
          <>
            <Download className="h-3.5 w-3.5 shrink-0" />
            <span>Export</span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-150 ${
                isOpen ? 'rotate-180' : ''
              }`}
            />
          </>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Export options"
          className="absolute right-0 z-40 mt-1.5 w-64 rounded-xl border border-zinc-200 bg-white py-1.5 shadow-lg"
        >
          <div className="px-3.5 pb-1 pt-1 text-[11px] font-semibold text-zinc-500">
            Standard &amp; Reports
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onExportPdf();
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer"
          >
            <FileText className="h-3.5 w-3.5 text-sky-700 shrink-0" />
            <span>Export PDF Report</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onExportTxt();
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
            <span>Standard Decklist (.txt)</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onExportCsv();
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
            <span>Spreadsheet / ManaBox (.csv)</span>
          </button>

          {hasPlatformExports && (
            <>
              {(onCopyRawList || onExportRawListTxt) && (
                <>
                  <div className="my-1.5 border-t border-zinc-100" />
                  <div className="px-3.5 pb-1 pt-0.5 text-[11px] font-semibold text-zinc-500">
                    Raw List (Quick Copy)
                  </div>
                  {onCopyRawList && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleCopyRawList}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer"
                    >
                      <Copy className="h-3.5 w-3.5 text-zinc-700 shrink-0" />
                      <span>Copy Raw List (Clipboard)</span>
                    </button>
                  )}
                  {onExportRawListTxt && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsOpen(false);
                        onExportRawListTxt();
                      }}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                      <span>Raw List (.txt)</span>
                    </button>
                  )}
                </>
              )}

              {(onExportMoxfieldTxt || onExportMoxfieldCsv) && (
                <>
                  <div className="my-1.5 border-t border-zinc-100" />
                  <div className="px-3.5 pb-1 pt-0.5 text-[11px] font-semibold text-zinc-500">
                    Moxfield Direct Import
                  </div>
                  {onExportMoxfieldTxt && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsOpen(false);
                        onExportMoxfieldTxt();
                      }}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                      <span>Moxfield Decklist (.txt)</span>
                    </button>
                  )}
                  {onExportMoxfieldCsv && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsOpen(false);
                        onExportMoxfieldCsv();
                      }}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                      <span>Moxfield Import (.csv)</span>
                    </button>
                  )}
                </>
              )}

              {(onExportArchidektTxt || onExportArchidektCsv) && (
                <>
                  <div className="my-1.5 border-t border-zinc-100" />
                  <div className="px-3.5 pb-1 pt-0.5 text-[11px] font-semibold text-zinc-500">
                    Archidekt Direct Import
                  </div>
                  {onExportArchidektTxt && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsOpen(false);
                        onExportArchidektTxt();
                      }}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                      <span>Archidekt Categorized (.txt)</span>
                    </button>
                  )}
                  {onExportArchidektCsv && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsOpen(false);
                        onExportArchidektCsv();
                      }}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                      <span>Archidekt Import (.csv)</span>
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
