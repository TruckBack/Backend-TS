import 'dotenv/config';
import { z } from 'zod';

const boolFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const ConfigSchema = z.object({
  APP_NAME: z.string().default('TruckBack'),
  APP_ENV: z.string().default('development'),
  DEBUG: boolFromString.default(false),
  API_V1_PREFIX: z.string().default('/api/v1'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(8000),

  SECRET_KEY: z.string().min(16, 'SECRET_KEY must be at least 16 characters'),
  ACCESS_TOKEN_EXPIRE_MINUTES: z.coerce.number().int().default(30),
  REFRESH_TOKEN_EXPIRE_DAYS: z.coerce.number().int().default(14),
  JWT_ALGORITHM: z.literal('HS256').default('HS256'),

  CORS_ORIGINS: z.string().default(''),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),

  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_PRESIGNED_EXPIRE_SECONDS: z.coerce.number().int().default(900),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:8000/api/v1/auth/google/callback'),

  GEMINI_API_KEY: z.string().default(''),

  UPLOADS_DIR: z.string().default('uploads'),
});

export type Config = z.infer<typeof ConfigSchema> & {
  CORS_ORIGINS_LIST: string[];
  DATABASE_URL_NORMALIZED: string;
};

function normalizeDatabaseUrl(url: string): string {
  if (url.startsWith('postgres://')) {
    return 'postgresql://' + url.slice('postgres://'.length);
  }
  return url;
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const data = parsed.data;
  cached = {
    ...data,
    CORS_ORIGINS_LIST: data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    DATABASE_URL_NORMALIZED: normalizeDatabaseUrl(data.DATABASE_URL),
  };
  return cached;
}

export function resetConfig(): void {
  cached = null;
}

export const config = new Proxy({} as Config, {
  get(_target, prop) {
    const c = loadConfig();
    return c[prop as keyof Config];
  },
});
