import { describe, expect, it } from "vitest";
import { calendarItems, ruleScheduleText, unplannedExpenses } from "@/lib/domain/calendar";
import { dueRealizations, firstDate, occurrences } from "@/lib/domain/recurrence";
import type { RecurringRule } from "@/lib/domain/types";
import { expenseSchema } from "@/lib/validation/schemas";
import { expense, transfer } from "./fixtures";

const TODAY = "2026-11-13"; // vendredi

function rule(partial: Partial<RecurringRule> & Pick<RecurringRule, "frequency" | "startDate">): RecurringRule {
  return {
    id: "r1",
    kind: "expense",
    label: "Loyer",
    amountCents: 45_000,
    accountId: "chk",
    toAccountId: null,
    categoryId: "logement",
    endDate: null,
    trackingStart: partial.startDate,
    isActive: true,
    ...partial,
  };
}

describe("dates des échéances (sans report des week-ends ni jours fériés)", () => {
  it("chaque semaine : même jour de la semaine, samedi compris", () => {
    expect(occurrences(rule({ frequency: "weekly", startDate: "2026-11-14" }), "2026-11-01", "2026-11-30")).toEqual([
      "2026-11-14",
      "2026-11-21",
      "2026-11-28",
    ]);
  });

  it("chaque mois : même numéro de jour, borné à la fin du mois, jour férié compris", () => {
    expect(occurrences(rule({ frequency: "monthly", startDate: "2026-01-31" }), "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
    // 1er mai (férié) : l'échéance reste le 1er.
    expect(occurrences(rule({ frequency: "monthly", startDate: "2026-04-01" }), "2026-05-01", "2026-05-31")).toEqual(["2026-05-01"]);
  });

  it("s'arrête à la date de fin", () => {
    expect(occurrences(rule({ frequency: "monthly", startDate: "2026-01-05", endDate: "2026-02-10" }), "2026-01-01", "2026-12-31")).toEqual([
      "2026-01-05",
      "2026-02-05",
    ]);
  });

  it("calcule la première échéance selon le jour demandé", () => {
    expect(firstDate({ repeat: "weekly", weekday: 5 }, TODAY)).toBe("2026-11-13"); // vendredi : aujourd'hui
    expect(firstDate({ repeat: "weekly", weekday: 1 }, TODAY)).toBe("2026-11-16"); // lundi suivant
    expect(firstDate({ repeat: "monthly", day: 20 }, TODAY)).toBe("2026-11-20");
    expect(firstDate({ repeat: "monthly", day: 5 }, TODAY)).toBe("2026-12-05");
    expect(firstDate({ repeat: "monthly", day: 31 }, TODAY)).toBe("2026-11-30");
    expect(firstDate({ repeat: "annual", date: "2026-03-01" }, TODAY)).toBe("2027-03-01");
    expect(firstDate({ repeat: "none", date: "2026-11-02" }, TODAY)).toBe("2026-11-02");
  });

  it("décrit le rythme en clair", () => {
    expect(ruleScheduleText(rule({ frequency: "weekly", startDate: "2026-11-14" }))).toBe("Chaque samedi");
    expect(ruleScheduleText(rule({ frequency: "monthly", startDate: "2026-11-05" }))).toBe("Chaque mois le 5");
    expect(ruleScheduleText(rule({ frequency: "annual", startDate: "2027-03-01" }))).toBe("Chaque année le 1er mars");
  });
});

describe("enregistrement automatique", () => {
  it("enregistre chaque échéance passée une seule fois et confirme les opérations à venir échues", () => {
    const r = rule({ frequency: "monthly", startDate: "2026-09-05" });
    const planned = expense("2026-11-10", 2_000, "chk", { status: "planned", confirmedAt: null });
    const done = expense("2026-09-05", 45_000, "chk", { recurrenceId: "r1", occurrenceDate: "2026-09-05" });
    const cancelled = expense("2026-10-05", 45_000, "chk", { recurrenceId: "r1", occurrenceDate: "2026-10-05", status: "cancelled", confirmedAt: null });
    const due = dueRealizations({ today: TODAY, rules: [r], transactions: [planned, done, cancelled] });
    expect(due).toEqual([
      { type: "confirm", transactionId: planned.id },
      {
        type: "create",
        payload: expect.objectContaining({ date: "2026-11-05", status: "confirmed", recurrence_id: "r1", entries: [{ account_id: "chk", amount_cents: -45_000 }] }),
      },
    ]);
  });

  it("ignore les revenus récurrents et les règles suspendues", () => {
    expect(dueRealizations({ today: TODAY, rules: [rule({ frequency: "monthly", startDate: "2026-11-01", kind: "income" })], transactions: [] })).toEqual([]);
    expect(dueRealizations({ today: TODAY, rules: [rule({ frequency: "monthly", startDate: "2026-11-01", isActive: false })], transactions: [] })).toEqual([]);
  });

  it("crée les deux écritures d'un virement récurrent", () => {
    const r = rule({ frequency: "weekly", startDate: "2026-11-13", kind: "transfer", toAccountId: "liv", categoryId: null, label: "Épargne" });
    const [due] = dueRealizations({ today: TODAY, rules: [r], transactions: [] });
    expect(due).toMatchObject({
      type: "create",
      payload: {
        kind: "transfer",
        category_id: null,
        entries: [
          { account_id: "chk", amount_cents: -45_000 },
          { account_id: "liv", amount_cents: 45_000 },
        ],
      },
    });
  });
});

describe("calendrier", () => {
  it("place chaque opération à sa date et ajoute les échéances futures non enregistrées", () => {
    const r = rule({ frequency: "weekly", startDate: "2026-11-07" });
    const items = calendarItems({
      month: "2026-11",
      today: TODAY,
      rules: [r],
      transactions: [
        expense("2026-11-07", 45_000, "chk", { recurrenceId: "r1", occurrenceDate: "2026-11-07" }),
        transfer("2026-11-10", 10_000, "chk", "liv"),
        expense("2026-11-03", 999, "chk", { status: "cancelled", confirmedAt: null }),
        expense("2026-10-31", 500, "chk"),
      ],
    });
    expect(items.map((i) => [i.date, i.kind, i.upcoming])).toEqual([
      ["2026-11-07", "expense", false],
      ["2026-11-10", "transfer", false],
      ["2026-11-14", "expense", true],
      ["2026-11-21", "expense", true],
      ["2026-11-28", "expense", true],
    ]);
    expect(items[1]).toMatchObject({ accountId: "chk", toAccountId: "liv" });
  });
});

describe("opérations (dépenses non prévues)", () => {
  it("garde les dépenses ponctuelles saisies le jour même ou après, pas celles programmées à l'avance", () => {
    const courses = expense("2026-11-12", 3_500, "chk", { createdAt: "2026-11-12T17:00:00Z" });
    const elec = expense("2026-11-03", 6_000, "chk", { createdAt: "2026-11-10T08:00:00Z" }); // saisie après coup
    const programmee = expense("2026-11-10", 2_000, "chk", { createdAt: "2026-11-01T08:00:00Z" });
    const loyer = expense("2026-11-05", 45_000, "chk", { recurrenceId: "r1", occurrenceDate: "2026-11-05" });
    const avant = expense("2026-10-30", 1_000, "chk", { createdAt: "2026-10-30T08:00:00Z" });
    const aVenir = expense("2026-11-20", 1_000, "chk", { status: "planned", confirmedAt: null, createdAt: "2026-11-13T08:00:00Z" });
    expect(unplannedExpenses([elec, programmee, courses, loyer, avant, aVenir], "2026-11").map((t) => t.id)).toEqual([courses.id, elec.id]);
  });
});

describe("saisie d'une dépense", () => {
  const base = { amount: "12,50", category_id: "11111111-1111-4111-8111-111111111111", account_id: "22222222-2222-4222-8222-222222222222" };

  it("demande le jour de la semaine, le numéro du jour ou la date selon la répétition", () => {
    expect(expenseSchema.safeParse({ ...base, repeat: "weekly" }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...base, repeat: "monthly", day: "32" }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...base, repeat: "none" }).success).toBe(false);
    expect(expenseSchema.parse({ ...base, repeat: "weekly", weekday: "6" }).schedule).toEqual({ repeat: "weekly", weekday: 6 });
    expect(expenseSchema.parse({ ...base, repeat: "monthly", day: "5" }).schedule).toEqual({ repeat: "monthly", day: 5 });
    expect(expenseSchema.parse({ ...base, date: "2026-11-20" }).schedule).toEqual({ repeat: "none", date: "2026-11-20" });
    // Nom facultatif : vide, la dépense prend le nom du domaine.
    expect(expenseSchema.parse({ ...base, date: "2026-11-20", label: "  Courses Lidl " }).label).toBe("Courses Lidl");
    expect(expenseSchema.parse({ ...base, date: "2026-11-20", label: "" }).label).toBeNull();
  });
});
