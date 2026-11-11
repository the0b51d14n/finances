"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signInAction } from "@/app/actions/auth";
import { Field, FormMessage, SubmitButton } from "@/components/ui/forms";
import { IDLE } from "@/lib/actions/state";

export function LoginForm() {
  const params = useSearchParams();
  const [state, signIn] = useActionState(signInAction, IDLE);

  return (
    <form action={signIn} className="card form">
      <input type="hidden" name="suite" value={params.get("suite") ?? "/"} />
      <Field id="email" label="Adresse e-mail">
        <input id="email" name="email" type="email" className="input" autoComplete="email" required inputMode="email" />
      </Field>
      <Field id="password" label="Mot de passe">
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" minLength={8} required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="btn btn-primary btn-block" pendingLabel="Patientez…">
        Se connecter
      </SubmitButton>
    </form>
  );
}
