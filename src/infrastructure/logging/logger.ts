import { createHash } from 'node:crypto';
import pino, { type DestinationStream, type Logger } from 'pino';

const secretFields = [
  'authorization',
  'cookie',
  'cookies',
  'appState',
  'password',
  'token',
  'c_user',
  'xs',
];
const redactPaths = secretFields.flatMap((field) => [
  field,
  `*.${field}`,
  `*.*.${field}`,
]);

export function createLogger(
  level: string,
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      level,
      redact: { paths: redactPaths, censor: '[REDACTED]' },
    },
    destination,
  );
}

export function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
