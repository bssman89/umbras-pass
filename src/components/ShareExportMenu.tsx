import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileText } from 'lucide-react';

interface ShareExportMenuProps {
  onExportPdf: () => void;
  onExportTxt: () => void;
  onExportCsv: () => void;
  size?: 'sm' | 'md';
}

export const ShareExportMenu: React.FC<ShareExportMenuProps> = ({
  onExportPdf,
  onExportTxt,
  onExportCsv,
  size = 'sm',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`inline-flex items-center gap-1.5 rounded-lg bg-sky-700 font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0 shadow-sm transition-colors ${buttonSizeClass}`}
      >
        <Download className="h-3.5 w-3.5 shrink-0" />
        <span>Export</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Export options"
          className="absolute right-0 z-40 mt-1.5 w-56 rounded-xl border border-zinc-200 bg-white py-1.5 shadow-lg"
        >
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
            <span>Export Decklist (.txt)</span>
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
            <Download className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
            <span>Export Spreadsheet (.csv)</span>
          </button>
        </div>
      )}
    </div>
  );
};
