import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const {
  execSyncMock,
  safeHandleMock,
  findExecutableInWindowsPathMock,
  getEnhancedWindowsPathMock,
  simpleGitMock,
} = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
  safeHandleMock: vi.fn(),
  findExecutableInWindowsPathMock: vi.fn(),
  getEnhancedWindowsPathMock: vi.fn(),
  simpleGitMock: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: class {},
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
  execSync: execSyncMock,
}));

vi.mock('../WindowsPathResolver', () => ({
  findExecutableInWindowsPath: findExecutableInWindowsPathMock,
  getEnhancedWindowsPath: getEnhancedWindowsPathMock,
}));

vi.mock('../../utils/ipcRegistry', () => ({
  safeHandle: safeHandleMock,
}));

vi.mock('../../utils/store', () => ({
  getAppSetting: vi.fn(() => null),
}));

vi.mock('../services/analytics/AnalyticsService.ts', () => ({
  AnalyticsService: {
    getInstance: () => ({
      sendEvent: vi.fn(),
    }),
  },
}));

vi.mock('simple-git', () => ({
  simpleGit: simpleGitMock,
}));

import { CLIManager } from '../CLIManager';

describe('CLIManager.checkClaudeCodeWindowsInstallation', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
    });

    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    getEnhancedWindowsPathMock.mockReturnValue('C:\\Users\\test\\AppData\\Roaming\\npm;C:\\Program Files\\nodejs');
    findExecutableInWindowsPathMock.mockReturnValue('C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd');
    simpleGitMock.mockReturnValue({
      version: vi.fn().mockResolvedValue({ installed: false }),
    });
    execSyncMock.mockReset();
    safeHandleMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('detects a Windows npm installation exposed as claude.cmd on PATH', async () => {
    execSyncMock.mockImplementation((command: string, options?: { env?: Record<string, string> }) => {
      if (command === '"C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd" --version') {
        expect(options?.env?.PATH).toBe('C:\\Users\\test\\AppData\\Roaming\\npm;C:\\Program Files\\nodejs');
        return '1.2.3\n';
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const manager = new CLIManager();
    const result = await manager.checkClaudeCodeWindowsInstallation();

    expect(findExecutableInWindowsPathMock).toHaveBeenCalledWith(
      ['claude.cmd', 'claude.exe'],
      'C:\\Users\\test\\AppData\\Roaming\\npm;C:\\Program Files\\nodejs'
    );
    expect(result).toEqual({
      isPlatformWindows: true,
      gitVersion: undefined,
      claudeCodeVersion: '1.2.3',
    });
  });
});
