"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteAllDataAction, saveCategoryAction, saveSettingsAction } from "@/app/actions/settings";
import { applyTheme, type ThemePreference } from "@/components/shell/ThemeSync";
import { Field, FormMessage, useServerForm } from "@/components/ui/forms";
import type { UserSettings } from "@/lib/domain/types";
import { centsToInput } from "@/lib/money";
import { categorySchema, settingsSchema } from "@/lib/validation/schemas";
import type { AccountOption } from "./options";

export function SettingsForm({ settings, accounts = [] }: { settings: UserSettings; accounts?: AccountOption[] }) {
  const { state, pending, onSubmit, errors } = useServerForm(saveSettingsAction, { schema: settingsSchema });
  const spendingCandidates = accounts.filter((a) => (!a.archived || a.id === settings.spendingAccountId) && (a.type === "checking" || a.type === "cash"));
  const check = (name: keyof UserSettings, label: string, hint?: string) => (
    <label className="checkbox">
      <input type="checkbox" name={snake(name)} defaultChecked={Boolean(settings[name])} />
      <span>
        {label}
        {hint && <span className="field-hint" style={{ display: "block" }}>{hint}</span>}
      </span>
    </label>
  );
  return (
    <form onSubmit={onSubmit} className="form" noValidate>
      <fieldset className="stack-sm">
        <legend className="field-label">Thème</legend>
        <div className="segmented">
          {(
            [
              ["dark", "Sombre"],
              ["light", "Clair"],
              ["system", "Système"],
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="theme"
                value={value}
                defaultChecked={settings.theme === value}
                onChange={() => applyTheme(value as ThemePreference)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        id="spending_account_id"
        label="Compte de dépenses courantes"
        error={errors.spending_account_id}
        hint="Compte qui paie par défaut vos achats et vos dépenses de budget (courses, loisirs). Sert au calcul des virements conseillés."
      >
        <select id="spending_account_id" name="spending_account_id" className="select" defaultValue={settings.spendingAccountId ?? ""}>
          <option value="">Aucun en particulier</option>
          {spendingCandidates.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-grid">
        <Field id="safety_reserve" label="Réserve de sécurité minimale (€)" error={errors.safety_reserve} hint="Montant à ne jamais entamer sur l'argent disponible.">
          <input id="safety_reserve" name="safety_reserve" className="input num" inputMode="decimal" defaultValue={centsToInput(settings.safetyReserveCents)} />
        </Field>
        <Field id="budget_alert_pct" label="Alerte budget à partir de (%)" error={errors.budget_alert_pct}>
          <input id="budget_alert_pct" name="budget_alert_pct" className="input" inputMode="numeric" defaultValue={settings.budgetAlertPct} />
        </Field>
        <Field id="bill_reminder_days" label="Rappel des échéances (jours)" error={errors.bill_reminder_days}>
          <input id="bill_reminder_days" name="bill_reminder_days" className="input" inputMode="numeric" defaultValue={settings.billReminderDays} />
        </Field>
        <Field id="comparison_months" label="Mois comparés dans les analyses" error={errors.comparison_months}>
          <input id="comparison_months" name="comparison_months" className="input" inputMode="numeric" defaultValue={settings.comparisonMonths} />
        </Field>
      </div>
      <fieldset className="stack-sm">
        <legend className="field-label">Prévisions</legend>
        {check("preserveBudgetsInForecast", "Préserver les enveloppes budgétaires dans les prévisions", "Le simulateur réserve ce qu'il reste à dépenser dans chaque budget.")}
        {check("forecastIncludeProbable", "Afficher le scénario estimé par défaut", "Inclut les revenus « probables » dans la courbe principale. Le verdict d'achat reste basé sur le scénario garanti.")}
      </fieldset>
      <fieldset className="stack-sm">
        <legend className="field-label">Alertes affichées sur le tableau de bord</legend>
        {check("notifyLowBalance", "Solde prévu sous la réserve ou négatif")}
        {check("notifyBudgetAlerts", "Budgets proches ou dépassés")}
        {check("notifyUpcomingBills", "Échéances à venir")}
        <span className="field-hint">Les alertes sont affichées dans l&apos;application ; aucune notification push n&apos;est envoyée dans cette version.</span>
      </fieldset>
      <FormMessage state={state} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer les paramètres"}
        </button>
      </div>
    </form>
  );
}

function snake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function CategoryForm({ category }: { category?: { id: string; name: string; kind: "expense" | "income" } }) {
  const { state, pending, onSubmit, errors } = useServerForm(saveCategoryAction, { schema: categorySchema });
  return (
    <form onSubmit={onSubmit} className="row" style={{ alignItems: "flex-start" }} noValidate>
      {category && <input type="hidden" name="id" value={category.id} />}
      {category ? (
        <input type="hidden" name="kind" value={category.kind} />
      ) : (
        <select name="kind" className="select" style={{ width: "auto" }} aria-label="Type de catégorie" defaultValue="expense">
          <option value="expense">Dépense</option>
          <option value="income">Revenu</option>
        </select>
      )}
      <div className="field" style={{ flex: "1 1 160px" }}>
        <input
          name="name"
          className="input"
          maxLength={60}
          defaultValue={category?.name}
          placeholder="Nom de la catégorie"
          aria-label="Nom de la catégorie"
          aria-invalid={!!errors.name}
        />
        {errors.name && <span className="field-error">{errors.name}</span>}
      </div>
      <button type="submit" className="btn" disabled={pending}>
        {category ? "Renommer" : "Ajouter"}
      </button>
      {state.status !== "idle" && state.message && (
        <span className={`small ${state.status === "error" ? "neg" : "pos"}`} role="status" style={{ flexBasis: "100%" }}>
          {state.message}
        </span>
      )}
    </form>
  );
}

/** Restauration d'une sauvegarde JSON, possible seulement sur un espace vide. */
export function RestoreBackupForm({ empty }: { empty: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function restore(file: File) {
    setResult(null);
    const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: await file.text() });
    const body = (await response.json().catch(() => ({}))) as { error?: string; counts?: { accounts: number; transactions: number } };
    if (!response.ok) {
      setResult({ ok: false, message: body.error ?? "La restauration a échoué." });
      return;
    }
    setResult({ ok: true, message: `Sauvegarde restaurée : ${body.counts?.accounts ?? 0} compte(s), ${body.counts?.transactions ?? 0} opération(s).` });
    router.refresh();
  }

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const file = (e.currentTarget.elements.namedItem("backup") as HTMLInputElement).files?.[0];
        if (!file) return setResult({ ok: false, message: "Choisissez un fichier de sauvegarde (.json)." });
        startTransition(() => restore(file));
      }}
    >
      <Field
        id="backup"
        label="Restaurer une sauvegarde (JSON)"
        hint={
          empty
            ? "Toutes les données de la sauvegarde seront recréées en une seule fois : tout ou rien."
            : "Possible uniquement sur un espace vide : exportez vos données, puis « Supprimer toutes mes données » avant de restaurer."
        }
      >
        <input id="backup" name="backup" type="file" accept=".json,application/json" className="input" disabled={!empty || pending} />
      </Field>
      {result && (
        <p className={`small ${result.ok ? "pos" : "neg"}`} role={result.ok ? "status" : "alert"}>
          {result.message}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="btn" disabled={!empty || pending}>
          {pending ? "Restauration…" : "Restaurer"}
        </button>
      </div>
    </form>
  );
}

export function DeleteDataForm() {
  const { state, pending, onSubmit } = useServerForm(deleteAllDataAction);
  return (
    <form
      onSubmit={(e) => {
        if (!window.confirm("Supprimer définitivement toutes vos données financières ? Cette action est irréversible.")) {
          e.preventDefault();
          return;
        }
        onSubmit(e);
      }}
      className="form"
    >
      <Field id="confirmation" label="Saisissez SUPPRIMER pour confirmer">
        <input id="confirmation" name="confirmation" className="input" autoComplete="off" />
      </Field>
      <FormMessage state={state} />
      <div className="form-actions">
        <button type="submit" className="btn btn-danger" disabled={pending}>
          Supprimer toutes mes données
        </button>
      </div>
    </form>
  );
}
