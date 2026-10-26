"use client";

/**
 * Briques de formulaire côté client : bouton d'envoi avec état, champs,
 * messages, et boutons d'action (avec confirmation pour les actions destructives).
 */
import { startTransition, useActionState, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { z } from "zod";
import { IDLE, type ActionState } from "@/lib/actions/state";
import { fieldErrorsOf, formValues, type FieldErrors } from "@/lib/validation/schemas";

export type ServerAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Formulaire relié à une action serveur :
 *  - validation immédiate avec le même schéma que le serveur ;
 *  - un seul envoi à la fois, avec identifiant de requête stable (idempotence) ;
 *  - les champs saisis sont conservés en cas d'erreur (pas de réinitialisation).
 */
export function useServerForm(action: ServerAction, options: { schema?: z.ZodType; withRequestId?: boolean } = {}) {
  const [state, dispatch, pending] = useActionState(action, IDLE);
  const [clientErrors, setClientErrors] = useState<FieldErrors | null>(null);
  const getRequestId = useRequestId();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    if (options.withRequestId) formData.set("client_request_id", getRequestId());
    if (options.schema) {
      const result = options.schema.safeParse(formValues(formData));
      if (!result.success) {
        setClientErrors(fieldErrorsOf(result.error));
        return;
      }
    }
    setClientErrors(null);
    startTransition(() => dispatch(formData));
  };

  const shownState: ActionState = clientErrors ? { status: "error", message: "Vérifiez les champs signalés." } : state;
  return { state: shownState, pending, onSubmit, errors: clientErrors ?? state.fieldErrors ?? {} };
}

/** UUID v4 ; repli sur getRandomValues hors contexte sécurisé (http local). */
export function uuidv4(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Identifiant de requête stable pour un formulaire : renvoyé tel quel en cas
 * de nouvel envoi (double clic, réseau instable), il garantit côté base
 * qu'une seule opération est créée.
 */
export function useRequestId() {
  const ref = useRef<string | null>(null);
  return () => {
    ref.current ??= uuidv4();
    return ref.current;
  };
}

export function SubmitButton({
  children,
  pendingLabel = "Enregistrement…",
  className = "btn btn-primary",
  disabled = false,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}

export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <span className="field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </div>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <div className={`notice notice-${state.status === "error" ? "danger" : "success"}`} role={state.status === "error" ? "alert" : "status"}>
      <span>{state.message}</span>
    </div>
  );
}

/** Bouton déclenchant une action serveur, avec confirmation facultative. */
export function ActionButton({
  action,
  fields,
  children,
  confirm,
  className = "btn btn-sm",
  showMessage = true,
}: {
  action: ServerAction;
  fields: Record<string, string>;
  children: ReactNode;
  confirm?: string;
  className?: string;
  showMessage?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={className} disabled={pending} aria-busy={pending}>
        {children}
      </button>
      {showMessage && state.status !== "idle" && state.message && (
        <span role={state.status === "error" ? "alert" : "status"} className={`tiny ${state.status === "error" ? "neg" : "pos"}`}>
          {state.message}
        </span>
      )}
    </form>
  );
}
