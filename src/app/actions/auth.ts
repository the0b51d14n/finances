"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { failure, safeReturnTo, success, type ActionState } from "@/lib/actions/state";
import { createClient } from "@/lib/supabase/server";

const credentials = z.object({
  email: z.email({ error: "Adresse e-mail invalide." }),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères.").max(72, "Mot de passe trop long."),
});

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return failure("Identifiants invalides.");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Message volontairement générique : ne révèle pas si le compte existe.
    return failure(
      error.code === "email_not_confirmed"
        ? "Adresse e-mail non confirmée : ouvrez le lien reçu par e-mail."
        : "E-mail ou mot de passe incorrect.",
    );
  }
  redirect(safeReturnTo(String(formData.get("suite") ?? ""), "/"));
}

export async function signUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Données invalides.");
  }
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error) {
    return failure(
      error.code === "signup_disabled"
        ? "Les inscriptions sont désactivées sur ce projet Supabase."
        : "Inscription impossible. Vérifiez l'adresse et réessayez.",
    );
  }
  if (data.session) redirect("/");
  return success("Compte créé. Confirmez votre adresse via le lien reçu par e-mail, puis connectez-vous.");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/connexion");
}
