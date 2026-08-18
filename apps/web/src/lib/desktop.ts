/**
 * Desktop app (Electron) bridge.
 * When running inside the Electron wrapper, window.citsheDesktop is available.
 * In browser mode, all functions gracefully return null/false.
 */

interface MitsheDesktopAPI {
  selectFolder: () => Promise<string | null>;
  getVersion: () => Promise<string>;
  isDesktop: () => Promise<boolean>;
  changeServer: () => void;
}

declare global {
  interface Window {
    citsheDesktop?: MitsheDesktopAPI;
  }
}

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && !!window.citsheDesktop;
}

export async function selectLocalFolder(): Promise<string | null> {
  if (!window.citsheDesktop) return null;
  return window.citsheDesktop.selectFolder();
}

export async function getDesktopVersion(): Promise<string | null> {
  if (!window.citsheDesktop) return null;
  return window.citsheDesktop.getVersion();
}
