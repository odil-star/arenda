import { isAxiosError } from "axios";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import type { ApiErrorBody } from "./types";

export type ErrorKind = "network" | "server" | "notFound" | "forbidden" | "throttled" | "validation" | "unknown";

export function errorKind(error: unknown): ErrorKind {
  if (!isAxiosError(error)) return "unknown";
  if (!error.response) return "network";
  const { status } = error.response;
  if (status === 404) return "notFound";
  if (status === 403) return "forbidden";
  if (status === 429) return "throttled";
  if (status >= 500) return "server";
  if (status === 400) return "validation";
  return "unknown";
}

function getBody(error: unknown): ApiErrorBody | null {
  if (!isAxiosError(error)) return null;
  const data: unknown = error.response?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) return data as ApiErrorBody;
  return null;
}

function toMessages(value: string[] | string | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

/** Сообщения, не привязанные к полям формы (detail, non_field_errors, прочие поля). */
export function serverMessages(error: unknown, exclude: readonly string[] = []): string[] {
  const body = getBody(error);
  if (!body) return [];
  return Object.entries(body)
    .filter(([key]) => !exclude.includes(key))
    .flatMap(([key, value]) => {
      const msgs = toMessages(value);
      return key === "detail" || key === "non_field_errors" ? msgs : msgs.map((m) => `${key}: ${m}`);
    });
}

/**
 * Раскладывает ошибки DRF по полям формы.
 * Возвращает сообщения, которые не удалось привязать к полям, — их показываем над формой.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string[] {
  const body = getBody(error);
  if (!body) return [];
  for (const field of fields) {
    const msgs = toMessages(body[field]);
    if (msgs.length) setError(field, { type: "server", message: msgs.join(" ") });
  }
  return serverMessages(error, fields);
}
