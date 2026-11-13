import { describe, expect, it } from "vitest";
import { accountSchema } from "@/lib/validation/schemas";

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
});
