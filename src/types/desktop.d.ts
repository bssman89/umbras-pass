export interface DesktopBridgeInfo {
  isDesktop: boolean;
  version: string;
  platform: string;
  userDataPath?: string;
  totalRamGb?: number;
  serverPort?: number;
}

export interface DesktopAppBridge {
  isDesktop: boolean;
  platform: string;
  version: string;
  selectGgufFile?: () => Promise<string | null>;
  getDesktopInfo?: () => Promise<DesktopBridgeInfo>;
  openModelsFolder?: () => Promise<void>;
  openUpdatesFolder?: () => Promise<void>;
  launchUpdateInstaller?: (
    filePath: string
  ) => Promise<{ ok: boolean; error?: string }>;
  exitApp?: () => Promise<void>;
}

declare global {
  interface Window {
    desktopApp?: DesktopAppBridge;
  }
}

export {};
