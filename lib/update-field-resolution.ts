export type UpdateBody = Record<string, unknown>;

export function hasUpdateField(body: UpdateBody, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, field);
}

export function resolveJsonArrayField(
  body: UpdateBody,
  field: string,
  previousValue: string | null,
): string | null {
  return hasUpdateField(body, field) ? JSON.stringify(body[field]) : previousValue;
}

export function resolveNullableField<T>(
  body: UpdateBody,
  field: string,
  previousValue: T | null,
): unknown {
  return hasUpdateField(body, field) ? body[field] ?? null : previousValue;
}