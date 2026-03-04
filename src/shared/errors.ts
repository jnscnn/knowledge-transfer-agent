export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly context: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      context: this.context,
    };
  }
}

export class ConfigError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'CONFIG_ERROR', 500, context);
  }
}

export class AzureServiceError extends AppError {
  public readonly serviceName: string;
  public readonly operation: string;

  constructor(
    serviceName: string,
    operation: string,
    message: string,
    context: Record<string, unknown> = {},
  ) {
    super(
      `[${serviceName}] ${operation}: ${message}`,
      'AZURE_SERVICE_ERROR',
      502,
      { serviceName, operation, ...context },
    );
    this.serviceName = serviceName;
    this.operation = operation;
  }
}

export class EntityNotFoundError extends AppError {
  constructor(
    entityType: string,
    entityId: string,
    context: Record<string, unknown> = {},
  ) {
    super(
      `${entityType} not found: ${entityId}`,
      'ENTITY_NOT_FOUND',
      404,
      { entityType, entityId, ...context },
    );
  }
}

export class SearchError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'SEARCH_ERROR', 502, context);
  }
}

export class GraphApiError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'GRAPH_API_ERROR', 502, context);
  }
}

export class PipelineError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'PIPELINE_ERROR', 500, context);
  }
}

export class BotError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'BOT_ERROR', 500, context);
  }
}
