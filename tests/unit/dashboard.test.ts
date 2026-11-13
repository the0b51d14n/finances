import { describe, expect, it } from "vitest";
import { computeDashboard, defaultExpenseAccount, salaryAccount, salaryCategory } from "@/lib/domain/dashboard";
import { account, category, expense, income } from "./fixtures";

const TODAY = "2026-11-13";

const principal = account("principal", "checking", 50_000, "2026-01-01", { subtype: "current" });
const secondaire = account("secondaire", "checking", 10_000, "2026-01-01", { subtype: "secondary" });
const livretA = account("livretA", "savings", 300_000, "2026-01-01", { subtype: "livret_a" });
const carte = account("carte", "earmarked", 2_000, "2026-01-01", { subtype: "gift_card" });
const vieux = account("vieux", "checking", 99_999, "2026-01-01", { archivedAt: "2026-06-01T00:00:00Z" });
const accounts = [principal, secondaire, livretA, carte, vieux];

describe("tableau de bord", () => {
  it("additionne tout ce qui est possédé et isole l'épargne (comptes archivés exclus)", () => {
    const d = computeDashboard({ today: TODAY, accounts, transactions: [] });
    expect(d.totalCents).toBe(50_000 + 10_000 + 300_000 + 2_000);
    expect(d.savingsCents).toBe(300_000);
  });

  it("répartit les dépenses effectuées du mois par domaine, sans le mois précédent ni le prévu", () => {
    const transactions = [
      expense("2026-11-02", 4_000, "principal", { categoryId: "courses" }),
      expense("2026-11-10", 1_500, "principal", { categoryId: "courses" }),
      expense("2026-11-05", 9_000, "principal", { categoryId: "loyer" }),
      expense("2026-10-30", 7_000, "principal", { categoryId: "courses" }),
      expense("2026-11-20", 3_000, "principal", { categoryId: "loisirs", status: "planned", confirmedAt: null }),
    ];
    const d = computeDashboard({ today: TODAY, accounts, transactions });
    expect(d.expenses).toEqual([
      { categoryId: "loyer", cents: 9_000 },
      { categoryId: "courses", cents: 5_500 },
    ]);
    expect(d.expenseTotalCents).toBe(14_500);
  });

  it("compte le montant de chaque salaire reçu ce mois-ci", () => {
    const transactions = [
      income("2026-11-10", 80_282, "secondaire", { label: "Salaire alternance" }),
      income("2026-10-29", 45_000, "secondaire", { label: "Salaire Auchan" }),
    ];
    const d = computeDashboard({ today: TODAY, accounts, transactions });
    expect(d.salaries).toEqual({ alternance: 80_282, auchan: 0 });
  });

  it("crédite les salaires sur le compte courant secondaire et propose le principal pour les dépenses", () => {
    expect(salaryAccount(accounts)?.id).toBe("secondaire");
    expect(salaryAccount([principal])?.id).toBe("principal");
    expect(defaultExpenseAccount(accounts)?.id).toBe("principal");
    const categories = [category("alt", "income", "salary_apprentice"), category("job", "income", "salary_student_job")];
    expect(salaryCategory("alternance", categories)?.id).toBe("alt");
    expect(salaryCategory("auchan", categories)?.id).toBe("job");
  });
});
