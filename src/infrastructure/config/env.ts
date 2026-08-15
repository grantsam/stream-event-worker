import { z } from 'zod';
import type { ActiveWindow } from '../../domain/rules/schedule-matcher.js';

const dayNames = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const dayNumber = new Map(dayNames.map((day, index) => [day, index + 1]));
const windowPattern =
  /^(MON|TUE|WED|THU|FRI|SAT|SUN)(?:-(MON|TUE|WED|THU|FRI|SAT|SUN))?@(\d{2}):(\d{2})-(\d{2}):(\d{2})$/u;

function positiveInteger(name: string) {
  return z.coerce.number().int().positive(`${name} must be a positive integer`);
}

function csv(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseActiveWindows(value: string): ActiveWindow[] {
  return csv(value).map((entry) => {
    const match = windowPattern.exec(entry.toUpperCase());
    if (!match) throw new Error(`Invalid ACTIVE_WINDOWS entry: ${entry}`);
    const [
      ,
      startDayName,
      endDayName = startDayName,
      startHour,
      startMinute,
      endHour,
      endMinute,
    ] = match;
    const startDay = dayNumber.get(startDayName as (typeof dayNames)[number]);
    const endDay = dayNumber.get(endDayName as (typeof dayNames)[number]);
    const startMinutes = Number(startHour) * 60 + Number(startMinute);
    const endMinutes = Number(endHour) * 60 + Number(endMinute);
    if (
      !startDay ||
      !endDay ||
      Number(startHour) > 23 ||
      Number(endHour) > 23 ||
      Number(startMinute) > 59 ||
      Number(endMinute) > 59
    ) {
      throw new Error(`Invalid ACTIVE_WINDOWS entry: ${entry}`);
    }
    const days: number[] = [];
    for (let day = startDay; ; day = (day % 7) + 1) {
      days.push(day);
      if (day === endDay) break;
    }
    return { days, startMinutes, endMinutes };
  });
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  APP_MODE: z.enum(['dry-run', 'live']).default('dry-run'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  TRANSPORT_ADAPTER: z.enum(['mock', 'live-session']).default('mock'),
  TIMEZONE: z.string().min(1),
  TARGET_THREAD_ID: z.string().min(1),
  AUTHORIZED_SENDER_IDS: z
    .string()
    .min(1)
    .transform(csv)
    .refine((value) => value.length > 0),
  TRIGGER_PHRASES: z
    .string()
    .min(1)
    .transform(csv)
    .refine((value) => value.length > 0),
  RESPONSE_TEXT: z.string().min(1),
  ACTIVE_WINDOWS: z.string().min(1).transform(parseActiveWindows),
  COOLDOWN_MS: positiveInteger('COOLDOWN_MS').default(300_000),
  MAX_EVENT_AGE_MS: positiveInteger('MAX_EVENT_AGE_MS').default(10_000),
  CLIENT_NAME: z.string().trim().default('default'),
  ADMIN_KEY: z.string().trim().default('apex_admin'),
  CLIENT_PIN: z.string().trim().default('1234'),
  HEALTH_HOST: z.string().min(1).default('127.0.0.1'),
  HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  STATE_DB_PATH: z.string().trim().min(1).default('./data/worker.sqlite'),
  APP_STATE_PATH: z.string().trim().min(1).default('./data/appstate.json'),
  HITS_LOG_PATH: z.string().trim().default('./data/hits.jsonl'),
  TYPING_DELAY_MS: z.coerce
    .number()
    .int()
    .nonnegative('TYPING_DELAY_MS must be a non-negative integer')
    .default(150),
  SIMULATE_TYPING: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  METRICS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const envWithFallbacks: NodeJS.ProcessEnv = {
    ...env,
    HEALTH_PORT: env.HEALTH_PORT ?? env.PORT,
    HEALTH_HOST: env.HEALTH_HOST ?? (env.PORT ? '0.0.0.0' : undefined),
  };
  const selected = Object.fromEntries(
    Object.keys(envSchema.shape).map((key) => [key, envWithFallbacks[key]]),
  );
  const parsed = envSchema.safeParse(selected);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${z.prettifyError(parsed.error)}`,
    );
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: parsed.data.TIMEZONE });
  } catch {
    throw new Error(`Invalid TIMEZONE: ${parsed.data.TIMEZONE}`);
  }
  return parsed.data;
}
