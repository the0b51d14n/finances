/**
 * Bilan automatique déterministe d'un mois.
 *
 * Chaque phrase est produite par une règle explicite à partir des chiffres ;
 * aucune affirmation n'est émise si les données ne la justifient pas (par
 * exemple, pas de comparaison sans mois précédent renseigné).
 */
import { formatCents, type Cents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { CategoryComparison, MonthSummary, RecurringAnomaly, SavingsFlows } from "./monthly";
import type { Transaction } from "./types";

export type InsightTone = "positive" | "negative" | "neutral" | "warning";
export type Insight = { tone: InsightTone; text: string };

export type BudgetOverrun = { categoryName: string; periodLabel: string; spentCents: Cents; amountCents: Cents };

/** Seuils des règles « inhabituel » : +50 % ET +50 € par rapport à la moyenne récente. */
export const UNUSUAL_RATIO = 1.5;
export const UNUSUAL_MIN_DIFF_CENTS = 5_000;
/** Une opération est « inhabituelle » si elle dépasse 2,5 fois la moyenne de sa catégorie. */
export const LARGE_TX_RATIO = 2.5;
const MIN_TX_SAMPLES = 3;

export function buildMonthInsights(args: {
  current: MonthSummary;
  previous: MonthSummary | null;
  history: MonthSummary[]; // mois antérieurs (jusqu'à 3), pour les moyennes
  categoryName: (id: string) => string;
  categoryComparison: CategoryComparison[];
  budgetOverruns: BudgetOverrun[];
  goalsAchieved: string[];
  savings: SavingsFlows | null;
  anomalies: RecurringAnomaly[];
  monthTransactions: Transaction[];
  historyTransactions: Transaction[];
}): Insight[] {
  const { current, previous } = args;
  const insights: Insight[] = [];

  if (current.provisional) {
    insights.push({ tone: "neutral", text: "Mois en cours : les chiffres sont provisoires et évolueront jusqu'à la fin du mois." });
  }
  if (current.transactionCount === 0) {
    insights.push({ tone: "neutral", text: "Aucune opération confirmée ce mois-ci : aucun bilan ne peut être établi." });
    return insights;
  }

  // Catégories les plus dépensières.
  if (current.expenseCents > 0) {
    const top = [...current.expenseByCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const parts = top.map(
      ([id, cents]) => `${args.categoryName(id)} (${formatCents(cents)}, ${Math.round((cents / current.expenseCents) * 100)} %)`,
    );
    insights.push({ tone: "neutral", text: `Principaux postes de dépenses : ${parts.join(", ")}.` });
  }

  // Solde net et taux d'épargne.
  if (current.incomeCents > 0 || current.expenseCents > 0) {
    if (current.netCents >= 0) {
      const rate =
        current.savingsRatePct !== null ? ` (taux d'épargne ${current.savingsRatePct.toLocaleString("fr-FR")} %)` : "";
      insights.push({ tone: "positive", text: `Solde net positif de ${formatCents(current.netCents)}${rate}.` });
    } else {
      insights.push({ tone: "negative", text: `Les dépenses dépassent les revenus de ${formatCents(-current.netCents)}.` });
    }
  }

  // Plus fortes hausses et baisses (uniquement si le mois précédent a des données).
  if (previous && previous.transactionCount > 0) {
    const increase = args.categoryComparison.find((c) => c.comparison.diffCents >= 100);
    const decrease = args.categoryComparison.find((c) => c.comparison.diffCents <= -100);
    if (increase) {
      const c = increase.comparison;
      const pct = c.pct !== null ? ` (+${c.pct.toLocaleString("fr-FR")} %)` : " (nouvelle dépense)";
      insights.push({ tone: "warning", text: `Plus forte hausse : ${args.categoryName(increase.categoryId)}, +${formatCents(c.diffCents)}${pct}.` });
    }
    if (decrease) {
      const c = decrease.comparison;
      const pct = c.pct !== null ? ` (${c.pct.toLocaleString("fr-FR")} %)` : "";
      insights.push({ tone: "positive", text: `Plus forte baisse : ${args.categoryName(decrease.categoryId)}, ${formatCents(c.diffCents)}${pct}.` });
    }
  }

  // Évolution de l'épargne.
  if (args.savings && (args.savings.startCents !== 0 || args.savings.endCents !== 0)) {
    const s = args.savings;
    const detail: string[] = [];
    if (s.contributionsCents !== 0) detail.push(`${formatCents(s.contributionsCents, { signed: true })} de versements nets`);
    if (s.interestCents !== 0) detail.push(`${formatCents(s.interestCents)} d'intérêts`);
    if (s.openingsCents !== 0) detail.push(`${formatCents(s.openingsCents)} de soldes initiaux de nouveaux comptes`);
    const suffix = detail.length ? ` (${detail.join(", ")})` : "";
    if (s.variationCents > 0) insights.push({ tone: "positive", text: `L'épargne progresse de ${formatCents(s.variationCents)}${suffix}.` });
    else if (s.variationCents < 0) insights.push({ tone: "negative", text: `L'épargne recule de ${formatCents(-s.variationCents)}${suffix}.` });
    else insights.push({ tone: "neutral", text: "L'épargne est stable sur le mois." });
  }

  for (const name of args.goalsAchieved) {
    insights.push({ tone: "positive", text: `Objectif atteint : ${name}.` });
  }

  for (const o of args.budgetOverruns) {
    insights.push({
      tone: "negative",
      text: `Budget ${o.periodLabel.toLowerCase()} dépassé : ${o.categoryName} (${formatCents(o.spentCents)} pour ${formatCents(o.amountCents)}).`,
    });
  }

  // Éléments inhabituels à vérifier.
  const monthsWithData = args.history.filter((h) => h.transactionCount > 0);
  if (monthsWithData.length >= 2) {
    for (const [categoryId, cents] of current.expenseByCategory) {
      const avg = monthsWithData.reduce((sum, h) => sum + (h.expenseByCategory.get(categoryId) ?? 0), 0) / monthsWithData.length;
      if (avg > 0 && cents >= avg * UNUSUAL_RATIO && cents - avg >= UNUSUAL_MIN_DIFF_CENTS) {
        insights.push({
          tone: "warning",
          text: `À vérifier : ${args.categoryName(categoryId)} atteint ${formatCents(cents)}, contre ${formatCents(Math.round(avg))} en moyenne sur les ${monthsWithData.length} mois précédents.`,
        });
      }
    }
  }

  const samplesByCategory = new Map<string, Cents[]>();
  for (const tx of args.historyTransactions) {
    if (tx.status !== "confirmed" || tx.kind !== "expense" || !tx.categoryId) continue;
    const list = samplesByCategory.get(tx.categoryId) ?? [];
    list.push(tx.amountCents);
    samplesByCategory.set(tx.categoryId, list);
  }
  for (const tx of args.monthTransactions) {
    if (tx.status !== "confirmed" || tx.kind !== "expense" || !tx.categoryId) continue;
    const samples = samplesByCategory.get(tx.categoryId);
    if (!samples || samples.length < MIN_TX_SAMPLES) continue;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (tx.amountCents >= avg * LARGE_TX_RATIO && tx.amountCents - avg >= UNUSUAL_MIN_DIFF_CENTS) {
      insights.push({
        tone: "warning",
        text: `Opération inhabituelle : « ${tx.label} » le ${formatDate(tx.date, "short")} (${formatCents(tx.amountCents)}), bien au-dessus de la moyenne de sa catégorie.`,
      });
    }
  }

  if (current.exceptionalExpenseCents > 0) {
    insights.push({ tone: "neutral", text: `Dont ${formatCents(current.exceptionalExpenseCents)} de dépenses marquées comme exceptionnelles.` });
  }
  if (current.adjustmentsNetCents !== 0) {
    insights.push({
      tone: "warning",
      text: `Des ajustements de solde ont été enregistrés (${formatCents(current.adjustmentsNetCents, { signed: true })}) : vérifiez qu'aucune opération n'a été oubliée.`,
    });
  }

  const missing = args.anomalies.filter((a) => a.kind === "missing");
  if (missing.length > 0) {
    const total = missing.reduce((s, a) => s + a.rule.amountCents, 0);
    insights.push({
      tone: "warning",
      text: `${missing.length} échéance(s) récurrente(s) attendue(s) ce mois-ci ne sont pas comptabilisées (${formatCents(total)}) : une baisse apparente peut venir d'un prélèvement décalé.`,
    });
  }
  const shiftedOut = args.anomalies.filter((a) => a.kind === "shifted_out");
  if (shiftedOut.length > 0) {
    insights.push({
      tone: "neutral",
      text: `${shiftedOut.length} échéance(s) de ce mois ont été comptabilisée(s) un autre mois (${shiftedOut.map((a) => a.rule.label).join(", ")}).`,
    });
  }
  const shiftedIn = args.anomalies.filter((a) => a.kind === "shifted_in");
  if (shiftedIn.length > 0) {
    insights.push({
      tone: "neutral",
      text: `${shiftedIn.length} opération(s) de ce mois correspondent à une échéance d'un autre mois (${shiftedIn.map((a) => a.rule.label).join(", ")}).`,
    });
  }

  return insights;
}
