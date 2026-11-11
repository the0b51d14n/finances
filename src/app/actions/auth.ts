"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { failure, safeReturnTo, type ActionState } from "@/lib/actions/state";
import { createSession, deleteSession } from "@/lib/auth/cookie";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { adminQuery } from "@/lib/db/neon";
import { sql } from "@/lib/db/sql";

const credentials = z.object({
  email: z.email({ error: "Adresse e-mail invalide." }),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères.").max(72, "Mot de passe trop long."),
});

/** Verrouillage temporaire après plusieurs échecs consécutifs. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const GENERIC_ERROR = "E-mail ou mot de passe incorrect.";

// Empreinte factice : un e-mail inconnu prend le même temps qu'un mauvais mot
// de passe (ne révèle pas quels comptes existent).
let dummyHash: Promise<string> | null = null;

type UserRow = { id: string; email: string; password_hash: string; locked: boolean };

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return failure("Identifiants invalides.");
  const email = parsed.data.email.trim().toLowerCase();

  const [user] = (await adminQuery(
    sql`select id, email, password_hash, coalesce(locked_until > now(), false) as locked from auth.users where email = ${email}`,
  )) as UserRow[];

  if (!user) {
    dummyHash ??= hashPassword("mot-de-passe-factice");
    await verifyPassword(parsed.data.password, await dummyHash);
    return failure(GENERIC_ERROR);
  }
  if (user.locked) return failure(`Trop de tentatives : réessayez dans ${LOCK_MINUTES} minutes.`);

  if (!(await verifyPassword(parsed.data.password, user.password_hash))) {
    await adminQuery(sql`
      update auth.users
         set failed_attempts = failed_attempts + 1,
             locked_until = case when failed_attempts + 1 >= ${MAX_FAILED_ATTEMPTS}
                                 then now() + make_interval(mins => ${LOCK_MINUTES}) end
       where id = ${user.id}`);
    return failure(GENERIC_ERROR);
  }

  await adminQuery(sql`update auth.users set failed_attempts = 0, locked_until = null where id = ${user.id}`);
  await createSession({ id: user.id, email: user.email });
  redirect(safeReturnTo(String(formData.get("suite") ?? ""), "/"));
}

export async function signOutAction(): Promise<void> {
  await deleteSession();
  redirect("/connexion");
}
