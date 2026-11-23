export class ToolExecutionError extends Error {
  constructor(
    public readonly toolName: string,
    message: string
  ) {
    super(`Failed to execute tool "${toolName}": ${message}`);
    this.name = 'ToolExecutionError';
  }
}

export class ValidationError extends Error {
  constructor(
    public readonly toolName: string,
    message: string
  ) {
    super(`Validation failed for tool "${toolName}": ${message}`);
    this.name = 'ValidationError';
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(`Configuration error: ${message}`);
    this.name = 'ConfigError';
  }
}

export function handleError(error: unknown, context: string): string {
  if (error instanceof Error) {
    return `Error in ${context}: ${error.message}`;
  }
  return `Error in ${context}: ${String(error)}`;
}
