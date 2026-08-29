import * as Joi from 'joi';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Read a var straight from the `.env` file. Secrets are resolved at module-load
 * time — BEFORE Nest's ConfigModule loads `.env` into process.env — so without
 * this the generated fallback would always win even when `.env` sets the key.
 * Making `.env` authoritative here avoids the footgun where changing `.env`
 * silently orphans data encrypted with a previously-generated key.
 */
function readFromEnvFile(envVar: string): string | undefined {
  for (const file of ['.env', '../../.env']) {
    try {
      const content = fs.readFileSync(
        path.resolve(process.cwd(), file),
        'utf-8',
      );
      const match = content.match(new RegExp(`^${envVar}=(.*)$`, 'm'));
      if (match) {
        // strip surrounding quotes + inline comments
        const val = match[1]
          .replace(/\s+#.*$/, '')
          .trim()
          .replace(/^["']|["']$/g, '');
        if (val) return val;
      }
    } catch {
      // file not here — try the next candidate
    }
  }
  return undefined;
}

function getOrGenerateSecret(envVar: string, name: string): string {
  // 1. Explicit env var wins.
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  // 2. The .env file is authoritative (loaded before ConfigModule runs).
  const fromFile = readFromEnvFile(envVar);
  if (fromFile && fromFile.length >= 32) {
    process.env[envVar] = fromFile;
    return fromFile;
  }

  // 3. Fall back to a persisted generated secret.
  const secretsDir = path.join(
    process.env.HOME || '/tmp',
    '.citshe',
    'secrets',
  );
  const secretFile = path.join(secretsDir, name);

  try {
    const existing = fs.readFileSync(secretFile, 'utf-8').trim();
    if (existing.length >= 32) {
      process.env[envVar] = existing;
      return existing;
    }
  } catch {
    // File doesn't exist yet
  }

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  } catch (err) {
    console.warn(
      `[citshe] Could not persist ${name}: ${(err as Error).message}`,
    );
  }

  process.env[envVar] = generated;
  return generated;
}

// Always resolve through getOrGenerateSecret so the .env file is authoritative
// even when process.env isn't populated yet.
getOrGenerateSecret('JWT_SECRET', 'jwt-secret');
getOrGenerateSecret('ENCRYPTION_KEY', 'encryption-key');

export const configValidationSchema = Joi.object({
  DATABASE_URL: Joi.string()
    .required()
    .description('Database connection string (PostgreSQL or SQLite file:)'),

  ENCRYPTION_KEY: Joi.string()
    .length(64)
    .pattern(/^[0-9a-f]+$/i)
    .optional()
    .description(
      'AES-256 encryption key (64 hex chars / 32 bytes). Auto-generated if not set.',
    ),

  JWT_SECRET: Joi.string()
    .min(32)
    .optional()
    .description(
      'JWT secret for signing tokens (min 32 chars). Auto-generated if not set.',
    ),

  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().port().default(3001),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .optional(),

  CORS_ORIGINS: Joi.string().default(
    'http://localhost:3000,http://127.0.0.1:3000',
  ),

  ALLOWED_ORIGINS: Joi.string().default(
    'http://localhost:3000,http://127.0.0.1:3000',
  ),

  API_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://localhost:3001'),

  // Public web URL — used for GitHub App callbacks/redirects.
  APP_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://localhost:3000'),

  // GitHub App (SSO connect). Optional — blank/absent means PAT-only.
  GITHUB_APP_SLUG: Joi.string().allow('').optional(),
  GITHUB_APP_ID: Joi.string().allow('').optional(),
  GITHUB_APP_CLIENT_ID: Joi.string().allow('').optional(),
  GITHUB_APP_CLIENT_SECRET: Joi.string().allow('').optional(),
  GITHUB_APP_PRIVATE_KEY: Joi.string().allow('').optional(),

  SENTRY_ENABLED: Joi.string().valid('true', 'false').default('false'),
  SENTRY_DSN: Joi.string().uri().optional(),

  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error')
    .default('info'),
});

export interface AppConfig {
  database: { url: string };
  security: { encryptionKey?: string };
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  redis: { host: string; port: number; url?: string };
  corsOrigins: string[];
  allowedOrigins: string[];
  apiBaseUrl: string;
  sentry?: { dsn: string };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export const configuration = (): AppConfig => ({
  database: { url: process.env.DATABASE_URL! },
  security: { encryptionKey: process.env.ENCRYPTION_KEY },
  nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  redis: {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  corsOrigins: (
    process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000'
  ).split(','),
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000'
  ).split(','),
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3001',
  sentry: process.env.SENTRY_DSN ? { dsn: process.env.SENTRY_DSN } : undefined,
  logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) || 'info',
});
