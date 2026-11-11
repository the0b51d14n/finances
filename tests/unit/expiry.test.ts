import { describe, expect, it } from "vitest";
import { computeDashboard } from "@/lib/domain/dashboard";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { accountSchema } from "@/lib/validation/schemas";
import { account } from "./fixtures";

const TODAY = "2026-11-11";

describe("date d'expiration des bons d'achat et cartes cadeaux", () => {
  const form = (subtype: string, validUntil: string) => ({
    name: "Compte",
    subtype,
    opening_balance: "50,00",
    opening_balance_date: TODAY,
    valid_until: validUntil,
  });

  it("est acceptée pour un bon d'achat, une carte cadeau et des tickets-restaurant", () => {
    for (const subtype of ["store_credit", "gift_card", "meal_voucher", "holiday_vouchers"]) {
      expect(accountSchema.safeParse(form(subtype, "2027-03-31")).success).toBe(true);
    }
  });

  it("est refusée pour un compte bancaire ou une cagnotte", () => {
    for (const subtype of ["current", "online_kitty"]) {
      expect(accountSchema.safeParse(form(subtype, "2027-03-31")).success).toBe(false);
    }
  });

  const dashboard = (validUntil: string, openingCents: number) =>
    computeDashboard({
      today: TODAY,
      accounts: [
        account("bon", "earmarked", openingCents, "2026-01-01", { name: "Bon d'achat Fnac", subtype: "store_credit", validUntil }),
        account("courant", "checking", 100_000),
      ],
      transactions: [],
      rules: [],
      budgets: [],
      goals: [],
      allocations: [],
      settings: DEFAULT_SETTINGS,
      categoryName: (id) => id,
    }).alerts.filter((a) => a.href === "/comptes/bon");

  it("alerte dans les 30 jours avant l'expiration, avec le solde restant", () => {
    const alerts = dashboard("2026-11-30", 2_500);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: "warning", title: "Bon d'achat Fnac expire bientôt" });
    expect(alerts[0].detail).toMatch(/^25,00\s€ à utiliser avant le 30 nov\. 2026\.$/);
  });

  it("n'alerte pas si l'expiration est lointaine ou le solde nul", () => {
    expect(dashboard("2027-06-30", 2_500)).toEqual([]);
    expect(dashboard("2026-11-30", 0)).toEqual([]);
  });
});
