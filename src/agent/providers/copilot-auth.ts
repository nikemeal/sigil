import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * GitHub Copilot OAuth — device flow authentication.
 *
 * Uses GitHub's device flow (RFC 8628) which is ideal for CLI/headless apps.
 * The user visits https://github.com/login/device, enters a code, and we
 * poll until the token is granted.
 *
 * The OAuth token is then exchanged for a Copilot API session token via
 * https://api.github.com/copilot_internal/v2/token — this short-lived token
 * (~30 min) is what actually authenticates API calls. We auto-refresh it.
 *
 * Token persistence: OAuth tokens are saved to data/copilot-token.json
 * so you only need to auth once (until you revoke the token).
 */

// Well-known GitHub OAuth client ID used by Copilot CLI tools
const CLIENT_ID = 'Ov23li8tweQw6odWQebz';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const COPILOT_MODELS_URL = 'https://api.github.com/copilot_internal/v2/models';

// Safety margin when polling to avoid clock skew
const POLL_SAFETY_MS = 3000;

export interface CopilotTokenData {
  oauthToken: string;
  copilotToken?: string;
  copilotTokenExpiresAt?: number; // unix timestamp in seconds
}

export interface CopilotSessionToken {
  token: string;
  expiresAt: number;
}

export interface CopilotModel {
  id: string;
  name: string;
  version: string;
  capabilities?: Record<string, unknown>;
}

export interface DeviceFlowResult {
  verificationUri: string;
  userCode: string;
  /** Call this to poll until the user authorizes. Resolves with the OAuth token. */
  waitForAuth: () => Promise<string>;
}

export class CopilotAuth {
  private tokenPath: string;
  private data: CopilotTokenData | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private onTokenExpired?: () => void;

  constructor(dataDir: string, onTokenExpired?: () => void) {
    this.tokenPath = resolve(dataDir, 'copilot-token.json');
    mkdirSync(dirname(this.tokenPath), { recursive: true });
    this.onTokenExpired = onTokenExpired;
    this.load();
  }

  // ── Persistence ──────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.tokenPath)) return;
    try {
      const raw = readFileSync(this.tokenPath, 'utf-8');
      this.data = JSON.parse(raw);
    } catch {
      this.data = null;
    }
  }

  private save(): void {
    writeFileSync(this.tokenPath, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  /** Whether we have a saved OAuth token (not necessarily a valid session token). */
  get isAuthenticated(): boolean {
    return !!this.data?.oauthToken;
  }

  /** Get the current OAuth token, or null if not authenticated. */
  get oauthToken(): string | null {
    return this.data?.oauthToken ?? null;
  }

  // ── Device Flow OAuth ────────────────────────────────────────

  /**
   * Start the GitHub device flow. Returns the verification URL and user code
   * that must be shown to the user, plus a promise that resolves once they
   * authorize in the browser.
   */
  async startDeviceFlow(): Promise<DeviceFlowResult> {
    const res = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        scope: 'read:user',
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to initiate GitHub device flow: ${res.status} ${await res.text()}`);
    }

    const device = await res.json() as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };

    return {
      verificationUri: device.verification_uri,
      userCode: device.user_code,
      waitForAuth: () => this.pollForToken(device.device_code, device.interval),
    };
  }

  private async pollForToken(deviceCode: string, interval: number): Promise<string> {
    let pollInterval = interval;

    while (true) {
      await sleep(pollInterval * 1000 + POLL_SAFETY_MS);

      const res = await fetch(ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });

      if (!res.ok) {
        throw new Error(`GitHub OAuth token request failed: ${res.status}`);
      }

      const data = await res.json() as {
        access_token?: string;
        error?: string;
        interval?: number;
      };

      if (data.access_token) {
        this.data = { oauthToken: data.access_token };
        this.save();
        return data.access_token;
      }

      if (data.error === 'authorization_pending') {
        continue;
      }

      if (data.error === 'slow_down') {
        // RFC 8628: add 5 seconds to current interval
        pollInterval = (data.interval ?? pollInterval + 5);
        continue;
      }

      if (data.error === 'expired_token') {
        throw new Error('Device code expired. Please restart the authorization process.');
      }

      if (data.error === 'access_denied') {
        throw new Error('Authorization was denied by the user.');
      }

      if (data.error) {
        throw new Error(`GitHub OAuth error: ${data.error}`);
      }
    }
  }

  // ── Copilot Session Token ────────────────────────────────────

  /**
   * Get a valid Copilot API session token. Refreshes automatically if expired.
   * Returns null if no OAuth token is available.
   */
  async getSessionToken(): Promise<CopilotSessionToken | null> {
    if (!this.data?.oauthToken) return null;

    // Check if current session token is still valid (with 60s buffer)
    if (this.data.copilotToken && this.data.copilotTokenExpiresAt) {
      const now = Math.floor(Date.now() / 1000);
      if (this.data.copilotTokenExpiresAt > now + 60) {
        return {
          token: this.data.copilotToken,
          expiresAt: this.data.copilotTokenExpiresAt,
        };
      }
    }

    // Refresh the session token
    return this.refreshSessionToken();
  }

  private async refreshSessionToken(): Promise<CopilotSessionToken | null> {
    if (!this.data?.oauthToken) return null;

    try {
      const res = await fetch(COPILOT_TOKEN_URL, {
        headers: {
          Authorization: `token ${this.data.oauthToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 401) {
        console.error('[copilot] OAuth token is invalid or expired. Please re-authenticate.');
        this.onTokenExpired?.();
        return null;
      }

      if (!res.ok) {
        const body = await res.text();
        console.error(`[copilot] Failed to get session token: ${res.status} ${body}`);
        return null;
      }

      const data = await res.json() as {
        token: string;
        expires_at: number;
      };

      this.data.copilotToken = data.token;
      this.data.copilotTokenExpiresAt = data.expires_at;
      this.save();

      // Schedule proactive refresh 2 minutes before expiry
      this.scheduleRefresh(data.expires_at);

      return {
        token: data.token,
        expiresAt: data.expires_at,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[copilot] Session token refresh failed: ${msg}`);
      return null;
    }
  }

  private scheduleRefresh(expiresAt: number): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    const now = Math.floor(Date.now() / 1000);
    const refreshIn = Math.max((expiresAt - now - 120) * 1000, 10_000); // 2 min before expiry, min 10s

    this.refreshTimer = setTimeout(async () => {
      console.log('[copilot] Proactively refreshing session token...');
      await this.refreshSessionToken();
    }, refreshIn);

    // Don't keep the process alive just for this timer
    this.refreshTimer.unref();
  }

  // ── Model Discovery ──────────────────────────────────────────

  /**
   * Fetch the list of models available to this Copilot subscription.
   * Requires a valid session token.
   */
  async listModels(): Promise<CopilotModel[]> {
    const session = await this.getSessionToken();
    if (!session) {
      throw new Error('Not authenticated. Run the Copilot login flow first.');
    }

    const res = await fetch(COPILOT_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${session.token}`,
        Accept: 'application/json',
        'Openai-Intent': 'conversation-edits',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`Failed to list Copilot models: ${res.status} ${await res.text()}`);
    }

    const data = await res.json() as {
      data?: Array<{
        id: string;
        name?: string;
        version?: string;
        capabilities?: Record<string, unknown>;
      }>;
      models?: Array<{
        id: string;
        name?: string;
        version?: string;
        capabilities?: Record<string, unknown>;
      }>;
    };

    const models = data.data ?? data.models ?? [];

    return models.map(m => ({
      id: m.id,
      name: m.name ?? m.id,
      version: m.version ?? 'unknown',
      capabilities: m.capabilities,
    }));
  }

  /** Clean up timers */
  stop(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** Remove stored credentials (logout) */
  logout(): void {
    this.stop();
    this.data = null;
    if (existsSync(this.tokenPath)) {
      writeFileSync(this.tokenPath, '{}', { mode: 0o600 });
    }
  }
}
