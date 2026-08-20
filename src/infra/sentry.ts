/**
 * Optional Sentry integration — honest: inactive without SENTRY_DSN.
 */

let active = false;

export function initSentry(): boolean {
  if (active) return true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
      beforeSend(event: { request?: { headers?: Record<string, string> } }) {
        if (event.request?.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers['x-api-key'];
        }
        return event;
      },
    });
    active = true;
    return true;
  } catch {
    return false;
  }
}

export function sentryActive(): boolean {
  return active;
}

export function captureException(err: unknown, context?: Record<string, string>): void {
  if (!active) return;
  try {
    const Sentry = require('@sentry/node');
    Sentry.withScope((scope: { setTag: (k: string, v: string) => void }) => {
      if (context) {
        for (const [k, v] of Object.entries(context)) scope.setTag(k, v);
      }
      Sentry.captureException(err);
    });
  } catch {
    /* ignore */
  }
}
