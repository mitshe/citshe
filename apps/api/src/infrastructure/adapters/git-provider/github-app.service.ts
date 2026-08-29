import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

/**
 * GitHub App integration: SSO install flow + minting short-lived installation
 * access tokens. Requires a registered GitHub App (see docs/GITHUB_APP_SETUP).
 * When the App env vars are absent, isConfigured() is false and callers fall
 * back to the PAT path — nothing here throws at boot.
 */
@Injectable()
export class GithubAppService {
  private readonly logger = new Logger(GithubAppService.name);
  private readonly tokenCache = new Map<string, CachedToken>();

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!(
      this.config.get<string>('GITHUB_APP_ID') &&
      this.getPrivateKey() &&
      this.config.get<string>('GITHUB_APP_SLUG')
    );
  }

  private appUrl(): string {
    return this.config.get<string>('APP_URL') || 'http://localhost:3000';
  }

  private stateSecret(): string {
    return this.config.get<string>('JWT_SECRET') || 'dev-secret';
  }

  /** PEM private key — supports raw multiline or base64-encoded env value. */
  private getPrivateKey(): string | null {
    const raw = this.config.get<string>('GITHUB_APP_PRIVATE_KEY');
    if (!raw) return null;
    if (raw.includes('BEGIN')) return raw.replace(/\\n/g, '\n');
    try {
      return Buffer.from(raw, 'base64').toString('utf-8');
    } catch {
      return null;
    }
  }

  /** Signed, short-lived state carrying the org id through the OAuth redirect. */
  buildInstallUrl(organizationId: string): string {
    if (!this.isConfigured()) {
      throw new Error(
        'GitHub App is not configured. Set GITHUB_APP_* env vars, or connect with a token instead.',
      );
    }
    const slug = this.config.get<string>('GITHUB_APP_SLUG');
    const state = jwt.sign({ organizationId }, this.stateSecret(), {
      expiresIn: '15m',
    });
    return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
  }

  verifyState(state: string): string {
    const decoded = jwt.verify(state, this.stateSecret()) as {
      organizationId: string;
    };
    return decoded.organizationId;
  }

  /**
   * Mint (and cache) an installation access token. Tokens live ~1h on GitHub's
   * side; we cache to 55 min and refresh transparently.
   */
  async getInstallationToken(installationId: string): Promise<string> {
    const cached = this.tokenCache.get(installationId);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const appJwt = this.signAppJwt();
    const res = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Failed to get installation token (${res.status}): ${body}`,
      );
    }
    const data = (await res.json()) as { token: string; expires_at: string };
    this.tokenCache.set(installationId, {
      token: data.token,
      expiresAt: Date.now() + 55 * 60_000,
    });
    return data.token;
  }

  /** List the repos this installation was granted access to. */
  async listInstallationRepos(installationId: string): Promise<
    Array<{
      id: number;
      name: string;
      full_name: string;
      description: string | null;
      default_branch: string;
      clone_url: string;
      html_url: string;
      private: boolean;
    }>
  > {
    const token = await this.getInstallationToken(installationId);
    const repos: Array<Record<string, unknown>> = [];
    let page = 1;
    // Paginate defensively; installations rarely exceed a few pages.
    for (;;) {
      const res = await fetch(
        `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );
      if (!res.ok) {
        throw new Error(`Failed to list installation repos (${res.status})`);
      }
      const data = (await res.json()) as {
        repositories: Array<Record<string, unknown>>;
      };
      repos.push(...data.repositories);
      if (data.repositories.length < 100) break;
      page += 1;
      if (page > 10) break;
    }
    return repos as never;
  }

  private signAppJwt(): string {
    const appId = this.config.get<string>('GITHUB_APP_ID');
    const key = this.getPrivateKey();
    if (!appId || !key) throw new Error('GitHub App is not configured.');
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign({ iat: now - 60, exp: now + 9 * 60, iss: appId }, key, {
      algorithm: 'RS256',
    });
  }
}
