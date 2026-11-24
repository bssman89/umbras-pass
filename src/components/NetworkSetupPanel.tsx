import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Globe,
  Loader2,
  Network,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wifi,
} from 'lucide-react';
import type {
  MultiplayerConnectionMode,
  NetworkDiagnosticsReport,
} from '../types/multiplayer';
import { copyTextToClipboard } from '../utils/clipboard';

export interface NetworkSetupPanelProps {
  netInfo: NetworkDiagnosticsReport | null;
  loadingNetInfo: boolean;
  onRefreshDiagnostics: () => void;
  externalHostInput: string;
  onExternalHostInputChange: (nextValue: string) => void;
  detectingPublicIp?: boolean;
  publicIpError?: string | null;
  onDetectPublicIp?: () => void;
  testingPort: boolean;
  portTestOk: boolean | null;
  portTestMessage: string | null;
  onRunPortCheck: () => void;
  connectionMode?: MultiplayerConnectionMode;
}

export const NetworkSetupPanel: React.FC<NetworkSetupPanelProps> = ({
  netInfo,
  loadingNetInfo,
  onRefreshDiagnostics,
  externalHostInput,
  onExternalHostInputChange,
  detectingPublicIp = false,
  publicIpError = null,
  onDetectPublicIp,
  testingPort,
  portTestOk,
  portTestMessage,
  onRunPortCheck,
  connectionMode = 'lan',
}) => {
  const [showRouterGuide, setShowRouterGuide] = useState<boolean>(
    connectionMode === 'online'
  );
  const [showAllInterfaces, setShowAllInterfaces] = useState<boolean>(false);
  const [firewallTab, setFirewallTab] = useState<'windows' | 'unix'>('windows');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const listeningPort = netInfo?.listeningPort || 3000;
  const primaryLanIface = netInfo?.lanInterfaces?.[0] || null;
  const primaryLanIp = primaryLanIface?.address || '192.168.1.X';
  const primaryLanUrl =
    netInfo?.primaryLanUrl ||
    primaryLanIface?.lanUrl ||
    (typeof window !== 'undefined' ? window.location.origin : `http://localhost:${listeningPort}`);

  const windowsFirewallCmd =
    netInfo?.firewallCommands?.windowsPowerShell ||
    `New-NetFirewallRule -DisplayName "UmbrasPass Tabletop (TCP ${listeningPort})" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${listeningPort}`;
  const unixFirewallCmd =
    netInfo?.firewallCommands?.linuxUfw || `sudo ufw allow ${listeningPort}/tcp`;

  const routerPortForwardClipboardSummary = useMemo(() => {
    const extEndpoint = externalHostInput.trim()
      ? externalHostInput.trim().includes(':')
        ? externalHostInput.trim()
        : `${externalHostInput.trim()}:${listeningPort}`
      : `<Your-Public-IP-or-DDNS>:${listeningPort}`;

    return [
      `=== Umbra's Pass — Router Port-Forwarding Configuration ===`,
      `Service / Rule Name : UmbrasPass-Tabletop`,
      `Protocol            : TCP`,
      `External (WAN) Port : ${listeningPort}`,
      `Internal (LAN) IP   : ${primaryLanIp}`,
      `Internal (LAN) Port : ${listeningPort}`,
      `Local LAN Host URL  : ${primaryLanUrl}`,
      `Remote WAN Host URL : http://${extEndpoint}`,
      ``,
      `=== Step-by-Step Router Port-Forwarding Setup ===`,
      `1. Reserve a Static DHCP Lease on your router for your host PC (${primaryLanIp}) so your LAN IP doesn't change.`,
      `2. Open your Router Admin Portal (commonly http://192.168.1.1, http://192.168.0.1, or http://10.0.0.1) -> Advanced -> NAT / Port Forwarding.`,
      `3. Add a new Port Forwarding rule:`,
      `   - Service Name  : UmbrasPass-Tabletop`,
      `   - Protocol      : TCP`,
      `   - External Port : ${listeningPort}`,
      `   - Internal IP   : ${primaryLanIp}`,
      `   - Internal Port : ${listeningPort}`,
      `4. Allow inbound TCP port ${listeningPort} in your OS firewall:`,
      `   Windows (PowerShell Admin):`,
      `   ${windowsFirewallCmd}`,
      `   Linux / macOS (UFW):`,
      `   ${unixFirewallCmd}`,
      `5. Click "Test Port Reachability" in Umbra's Pass to verify that TCP port ${listeningPort} is reachable before inviting remote friends.`,
    ].join('\n');
  }, [externalHostInput, listeningPort, primaryLanIp, primaryLanUrl, windowsFirewallCmd, unixFirewallCmd]);

  const routerRuleValuesText = useMemo(
    () =>
      [
        `Service Name: UmbrasPass-Tabletop`,
        `Protocol: TCP`,
        `External Port: ${listeningPort}`,
        `Internal IP: ${primaryLanIp}`,
        `Internal Port: ${listeningPort}`,
      ].join('\n'),
    [listeningPort, primaryLanIp]
  );

  const handleCopy = async (key: string, value: string) => {
    await copyTextToClipboard(value);
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2000);
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 sm:p-5 space-y-4">
      {/* Compact Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <Wifi className="h-4 w-4 text-sky-700 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-zinc-900">
              Network &amp; Port Check
            </h3>
            <p className="text-xs text-zinc-600 truncate">
              TCP <span className="font-mono tabular-nums">{listeningPort}</span> · Bound{' '}
              <span className="font-mono tabular-nums">
                {netInfo?.hostBindAddress || '0.0.0.0'}
              </span>{' '}
              · {netInfo?.lanReachable ? 'LAN Ready' : 'Listener Active'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefreshDiagnostics}
          disabled={loadingNetInfo}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingNetInfo ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Host Local IP & Join URL Tiles */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-200 bg-white px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-zinc-600">
              Host Local IP
            </div>
            <div className="font-mono text-sm font-bold tabular-nums text-zinc-900 truncate">
              {primaryLanIp}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleCopy('primary-ip', primaryLanIp)}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer shrink-0"
          >
            {copiedKey === 'primary-ip' ? (
              <Check className="h-3.5 w-3.5 text-emerald-700" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-sky-700" />
            )}
            <span>{copiedKey === 'primary-ip' ? 'Copied' : 'Copy'}</span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-zinc-600">
              Host LAN URL
            </div>
            <div className="font-mono text-sm font-bold tabular-nums text-sky-800 truncate">
              {primaryLanUrl}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleCopy('primary-lan-url', primaryLanUrl)}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer shrink-0"
          >
            {copiedKey === 'primary-lan-url' ? (
              <Check className="h-3.5 w-3.5 text-emerald-700" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-sky-700" />
            )}
            <span>{copiedKey === 'primary-lan-url' ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Secondary Network Adapters Toggle (Collapsed by default to cut clutter) */}
      {netInfo && netInfo.lanInterfaces.length > 1 && (
        <div>
          <button
            type="button"
            onClick={() => setShowAllInterfaces((v) => !v)}
            className="inline-flex min-h-[32px] items-center gap-1.5 text-xs font-semibold text-sky-700 hover:underline cursor-pointer"
          >
            {showAllInterfaces ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            <span>
              {showAllInterfaces
                ? 'Hide extra network interfaces'
                : `Show ${netInfo.lanInterfaces.length - 1} other network interface${
                    netInfo.lanInterfaces.length - 1 === 1 ? '' : 's'
                  }`}
            </span>
          </button>

          {showAllInterfaces && (
            <div className="mt-2 space-y-1.5">
              {netInfo.lanInterfaces.slice(1).map((iface) => (
                <div
                  key={`${iface.name}-${iface.address}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs"
                >
                  <div className="min-w-0 truncate">
                    <span className="font-mono font-semibold text-sky-800">
                      {iface.lanUrl}
                    </span>{' '}
                    <span className="text-zinc-500">({iface.name})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopy(`lan-${iface.address}`, iface.lanUrl)}
                    className="min-h-[30px] rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer shrink-0"
                  >
                    {copiedKey === `lan-${iface.address}` ? 'Copied' : 'Copy'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Public IPv4 & Port Reachability Test */}
      <div className="rounded-lg border border-zinc-200 bg-white p-3.5 space-y-3 text-xs sm:text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 font-bold text-zinc-900">
            <Globe className="h-4 w-4 text-sky-700 shrink-0" />
            <span>
              Public IPv4 &amp; Port Check (TCP {listeningPort})
            </span>
          </span>
          <div className="flex items-center gap-2.5 shrink-0">
            {onDetectPublicIp && (
              <button
                type="button"
                onClick={onDetectPublicIp}
                disabled={detectingPublicIp}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                {detectingPublicIp ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Detecting...</span>
                  </>
                ) : (
                  <>
                    <Globe className="h-3.5 w-3.5 text-sky-700" />
                    <span>Detect Public IPv4</span>
                  </>
                )}
              </button>
            )}
            {portTestOk !== null && (
              <span
                className={`font-mono text-xs font-bold whitespace-nowrap ${
                  portTestOk ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {portTestOk ? 'Reachable · Ready' : 'Check Needed'}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <input
            type="text"
            value={externalHostInput}
            onChange={(e) => onExternalHostInputChange(e.target.value)}
            placeholder="Public IPv4 or DDNS (e.g. 203.0.113.45)"
            aria-label="External Public IPv4 or DDNS Hostname"
            className="min-h-[40px] flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-sm tabular-nums text-zinc-900 focus:border-sky-600 focus:bg-white focus:outline-none"
          />
          <button
            type="button"
            onClick={onRunPortCheck}
            disabled={testingPort}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            {testingPort ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Testing...</span>
              </>
            ) : (
              <>
                <Network className="h-4 w-4" />
                <span>Test Port Reachability</span>
              </>
            )}
          </button>
        </div>

        {externalHostInput.trim() && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
            <div className="min-w-0 truncate">
              <span className="text-zinc-600">Public Share URL:</span>{' '}
              <span className="font-mono font-semibold tabular-nums text-sky-900">
                {externalHostInput.trim().startsWith('http://') ||
                externalHostInput.trim().startsWith('https://')
                  ? externalHostInput.trim()
                  : externalHostInput.trim().includes(':')
                  ? `http://${externalHostInput.trim()}`
                  : `http://${externalHostInput.trim()}:${listeningPort}`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                const raw = externalHostInput.trim();
                const url =
                  raw.startsWith('http://') || raw.startsWith('https://')
                    ? raw
                    : raw.includes(':')
                    ? `http://${raw}`
                    : `http://${raw}:${listeningPort}`;
                void handleCopy('public-share-url', url);
              }}
              className="min-h-[32px] rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer whitespace-nowrap shrink-0"
            >
              {copiedKey === 'public-share-url' ? 'Copied' : 'Copy URL'}
            </button>
          </div>
        )}

        {publicIpError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
            {publicIpError}
          </div>
        )}

        {portTestMessage && (
          <div
            className={`rounded-lg border px-3 py-2 text-xs font-medium leading-relaxed ${
              portTestOk
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-amber-200 bg-amber-50 text-amber-900'
            }`}
          >
            {portTestMessage}
          </div>
        )}
      </div>

      {/* Router Port-Forwarding & Firewall Helper */}
      <div className="rounded-lg border border-zinc-200 bg-white p-3.5 space-y-3 text-xs sm:text-sm">
        <button
          type="button"
          onClick={() => setShowRouterGuide((v) => !v)}
          aria-expanded={showRouterGuide}
          className="flex min-h-[38px] w-full items-center justify-between text-left font-bold text-zinc-900 cursor-pointer"
        >
          <span className="inline-flex items-center gap-2">
            <Terminal className="h-4 w-4 text-sky-700 shrink-0" />
            <span>Router Port-Forwarding Guide</span>
          </span>
          {showRouterGuide ? (
            <ChevronUp className="h-4 w-4 text-zinc-500 shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-zinc-500 shrink-0" />
          )}
        </button>

        {/* Compact Rule Copy Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
          <div className="font-mono text-zinc-800 truncate">
            TCP <span className="font-bold text-sky-800">{listeningPort}</span> &rarr;{' '}
            <span className="font-bold text-sky-800">
              {primaryLanIp}:{listeningPort}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleCopy('router-rule-values', routerRuleValuesText)}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer"
            >
              {copiedKey === 'router-rule-values' ? (
                <Check className="h-3.5 w-3.5 text-emerald-700" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-sky-700" />
              )}
              <span>{copiedKey === 'router-rule-values' ? 'Copied' : 'Copy Rule'}</span>
            </button>
            <button
              type="button"
              onClick={() =>
                void handleCopy('full-port-forward-guide', routerPortForwardClipboardSummary)
              }
              className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100 cursor-pointer"
            >
              {copiedKey === 'full-port-forward-guide' ? (
                <Check className="h-3.5 w-3.5 text-emerald-700" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-sky-700" />
              )}
              <span>
                {copiedKey === 'full-port-forward-guide' ? 'Copied Guide' : 'Copy Full Guide'}
              </span>
            </button>
          </div>
        </div>

        {showRouterGuide && (
          <div className="space-y-3.5 border-t border-zinc-100 pt-3 text-xs sm:text-sm text-zinc-700">
            {/* Clean 5-row NAT Rule Values */}
            <div className="rounded-lg border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
              {[
                { id: 'rf-name', label: 'Rule Name', value: 'UmbrasPass-Tabletop' },
                { id: 'rf-proto', label: 'Protocol', value: 'TCP' },
                { id: 'rf-ext-port', label: 'External Port', value: String(listeningPort) },
                { id: 'rf-int-port', label: 'Internal Port', value: String(listeningPort) },
                { id: 'rf-int-ip', label: 'Internal LAN IP', value: primaryLanIp },
              ].map((field) => (
                <div
                  key={field.id}
                  className="flex items-center justify-between gap-2 bg-white px-3 py-2 text-xs"
                >
                  <span className="text-zinc-600 font-medium">{field.label}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold tabular-nums text-zinc-900 truncate">
                      {field.value}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopy(field.id, field.value)}
                      className="min-h-[30px] rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer shrink-0"
                    >
                      {copiedKey === field.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Concise 4-step Instructions */}
            <ol className="space-y-1.5 pl-4 list-decimal text-xs sm:text-sm text-zinc-700 leading-relaxed">
              {(
                netInfo?.routerGuideSteps || [
                  {
                    step: 1,
                    title: 'Static LAN IP',
                    detail: `Bind your host PC to ${primaryLanIp} in your router DHCP settings.`,
                  },
                  {
                    step: 2,
                    title: 'Port Forwarding Rule',
                    detail: `Forward external TCP ${listeningPort} to ${primaryLanIp}:${listeningPort} in your router portal.`,
                  },
                  {
                    step: 3,
                    title: 'Allow OS Firewall',
                    detail: `Run the firewall command below to open TCP port ${listeningPort}.`,
                  },
                  {
                    step: 4,
                    title: 'Test & Share',
                    detail: `Run "Test Port Reachability" above before sharing your Room Code & Passcode.`,
                  },
                ]
              ).map((s) => (
                <li key={s.step}>
                  <strong className="font-semibold text-zinc-900">{s.title}:</strong> {s.detail}
                </li>
              ))}
            </ol>

            {/* Tabbed OS Firewall Command */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center rounded-lg bg-zinc-100 p-1 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setFirewallTab('windows')}
                    className={`min-h-[32px] rounded-md px-3 py-1 cursor-pointer transition-colors ${
                      firewallTab === 'windows'
                        ? 'bg-white text-zinc-900 shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    Windows PowerShell
                  </button>
                  <button
                    type="button"
                    onClick={() => setFirewallTab('unix')}
                    className={`min-h-[32px] rounded-md px-3 py-1 cursor-pointer transition-colors ${
                      firewallTab === 'unix'
                        ? 'bg-white text-zinc-900 shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    Linux / macOS
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    void handleCopy(
                      `fw-${firewallTab}`,
                      firewallTab === 'windows' ? windowsFirewallCmd : unixFirewallCmd
                    )
                  }
                  className="inline-flex min-h-[32px] items-center gap-1 rounded px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 hover:underline cursor-pointer"
                >
                  {copiedKey === `fw-${firewallTab}` ? 'Copied' : 'Copy Command'}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-3 font-mono text-xs text-zinc-100">
                {firewallTab === 'windows' ? windowsFirewallCmd : unixFirewallCmd}
              </pre>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-950">
              <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0" />
              <span>
                Guest access requires scrypt-verified Session Passcode + Host Lobby Approval.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

