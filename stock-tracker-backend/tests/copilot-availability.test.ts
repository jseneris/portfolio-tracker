import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCopilotAvailability, stopCopilotClient } from '../src/services/copilot-insights.js';

const mocks = vi.hoisted(() => ({
  start: vi.fn(), stop: vi.fn(), auth: vi.fn(), models: vi.fn(), createSession: vi.fn(),
}));
vi.mock('@github/copilot-sdk', () => ({
  RuntimeConnection: { forStdio: vi.fn() },
  CopilotClient: class {
    start = mocks.start;
    stop = mocks.stop;
    getAuthStatus = mocks.auth;
    listModels = mocks.models;
    createSession = mocks.createSession;
  },
}));

describe('Copilot availability', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('COPILOT_MODEL', 'test-model');
    mocks.start.mockResolvedValue(undefined);
    mocks.stop.mockResolvedValue(undefined);
    mocks.auth.mockResolvedValue({ isAuthenticated: true });
    mocks.models.mockResolvedValue([{ id: 'test-model', policy: { state: 'enabled' } }]);
  });
  afterEach(async () => {
    await stopCopilotClient();
    vi.unstubAllEnvs();
  });

  it('checks sign-in and configured model without creating an AI session', async () => {
    expect(await checkCopilotAvailability()).toEqual({ available: true });
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.auth).toHaveBeenCalledTimes(1);
    expect(mocks.models).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('reports missing CLI sign-in without claiming AI is ready', async () => {
    mocks.auth.mockResolvedValue({ isAuthenticated: false });
    expect(await checkCopilotAvailability()).toMatchObject({ available: false, reason: expect.stringContaining('Sign in') });
    expect(mocks.models).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'unconfigured'])('does not mark a %s model available', async (state) => {
    mocks.models.mockResolvedValue([{ id: 'test-model', policy: { state } }]);
    expect(await checkCopilotAvailability()).toMatchObject({ available: false });
  });

  it('reports a missing configured model', async () => {
    mocks.models.mockResolvedValue([{ id: 'other-model' }]);
    expect(await checkCopilotAvailability()).toMatchObject({ available: false });
  });

  it('propagates connection failures and allows a later retry to start the client', async () => {
    mocks.start.mockRejectedValueOnce(new Error('CLI unavailable'));
    await expect(checkCopilotAvailability()).rejects.toThrow('CLI unavailable');
    expect(await checkCopilotAvailability()).toEqual({ available: true });
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });
});
