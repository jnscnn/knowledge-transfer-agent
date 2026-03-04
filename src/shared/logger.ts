import * as appInsights from 'applicationinsights';
import type { TelemetryClient } from 'applicationinsights';

let insightsClient: TelemetryClient | undefined;

const connectionString = process.env['APPLICATIONINSIGHTS_CONNECTION_STRING'];
if (connectionString) {
  appInsights.setup(connectionString)
    .setAutoCollectRequests(true)
    .setAutoCollectExceptions(true)
    .setAutoCollectDependencies(true)
    .start();
  insightsClient = appInsights.defaultClient;
}

interface LogContext {
  component?: string;
  operation?: string;
  correlationId?: string;
  [key: string]: unknown;
}

function buildProperties(
  level: string,
  message: string,
  context: LogContext,
): Record<string, string> {
  const props: Record<string, string> = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) {
      props[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
  }
  return props;
}

function writeToConsole(level: string, message: string, context: LogContext): void {
  const ts = new Date().toISOString();
  const prefix = context.component ? `[${context.component}]` : '';
  const line = `${ts} ${level.toUpperCase()} ${prefix} ${message}`;

  switch (level) {
    case 'error':
      console.error(line, Object.keys(context).length ? context : '');
      break;
    case 'warn':
      console.warn(line, Object.keys(context).length ? context : '');
      break;
    case 'debug':
      console.debug(line, Object.keys(context).length ? context : '');
      break;
    default:
      console.log(line, Object.keys(context).length ? context : '');
  }
}

export const logger = {
  info(message: string, context: LogContext = {}): void {
    writeToConsole('info', message, context);
    insightsClient?.trackTrace({
      message,
      severity: 'Information',
      properties: buildProperties('info', message, context),
    });
  },

  warn(message: string, context: LogContext = {}): void {
    writeToConsole('warn', message, context);
    insightsClient?.trackTrace({
      message,
      severity: 'Warning',
      properties: buildProperties('warn', message, context),
    });
  },

  error(message: string, context: LogContext & { error?: Error } = {}): void {
    writeToConsole('error', message, context);
    if (context.error && insightsClient) {
      insightsClient.trackException({
        exception: context.error,
        properties: buildProperties('error', message, context),
      });
    } else {
      insightsClient?.trackTrace({
        message,
        severity: 'Error',
        properties: buildProperties('error', message, context),
      });
    }
  },

  debug(message: string, context: LogContext = {}): void {
    writeToConsole('debug', message, context);
    insightsClient?.trackTrace({
      message,
      severity: 'Verbose',
      properties: buildProperties('debug', message, context),
    });
  },

  trackEvent(name: string, properties: Record<string, string> = {}): void {
    insightsClient?.trackEvent({ name, properties });
  },

  trackException(error: Error, context: LogContext = {}): void {
    insightsClient?.trackException({
      exception: error,
      properties: buildProperties('error', error.message, context),
    });
  },

  async flush(): Promise<void> {
    if (insightsClient) {
      await insightsClient.flush();
    }
  },
};
