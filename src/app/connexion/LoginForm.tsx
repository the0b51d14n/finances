"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signInAction, signUpAction } from "@/app/actions/auth";
import { Field, FormMessage, SubmitButton } from "@/components/ui/forms";
import { IDLE } from "@/lib/actions/state";

export function LoginForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signInState, signIn] = useActionState(signInAction, IDLE);
  const [signUpState, signUp] = useActionState(signUpAction, IDLE);
  const state = mode === "signin" ? signInState : signUpState;
  const linkError = params.get("erreur");

  return (
    <form action={mode === "signin" ? signIn : signUp} className="card form">
      <div className="segmented" role="tablist" aria-label="Mode">
        <label>
          <input type="radio" name="mode-choice" checked={mode === "signin"} onChange={() => setMode("signin")} />
          Se connecter
        </label>
        <label>
          <input type="radio" name="mode-choice" checked={mode === "signup"} onChange={() => setMode("signup")} />
          Créer un compte
        </label>
      </div>
      {linkError && <div className="notice notice-danger">Le lien de confirmation est invalide ou expiré.</div>}
      <input type="hidden" name="suite" value={params.get("suite") ?? "/"} />
      <Field id="email" label="Adresse e-mail">
        <input id="email" name="email" type="email" className="input" autoComplete="email" required inputMode="email" />
      </Field>
      <Field id="password" label="Mot de passe" hint={mode === "signup" ? "8 caractères minimum." : undefined}>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          minLength={8}
          required
        />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="btn btn-primary btn-block" pendingLabel="Patientez…">
        {mode === "signin" ? "Se connecter" : "Créer mon compte"}
      </SubmitButton>
    </form>
  );
}
