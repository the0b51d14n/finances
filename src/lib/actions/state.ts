/** État renvoyé par les actions serveur aux formulaires (useActionState). */
import type { FieldErrors } from "@/lib/validation/schemas";

export type ActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: FieldErrors;
};

export const IDLE: ActionState = { status: "idle" };

export function failure(message: string, fieldErrors?: FieldErrors): ActionState {
  return { status: "error", message, fieldErrors };
}

export function success(message: string): ActionState {
  return { status: "success", message };
}

/** N'accepte que des chemins internes pour les redirections (pas d'URL externe). */
export function safeReturnTo(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}
