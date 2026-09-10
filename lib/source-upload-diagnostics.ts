export function logSourceUploadFailure(
  message: string,
  context: Record<string, unknown> = {},
  error?: unknown,
): void {
  const normalizedError =
    error instanceof Error ? error : new Error(error == null ? message : String(error));
  console.log(`[source-upload][server] ${message}`, {
    ...context,
    errorName: normalizedError.name,
    errorMessage: normalizedError.message,
    stack: normalizedError.stack ?? new Error(message).stack,
  });
}