/** Libellés français des valeurs métier, partagés par toutes les pages. */
import type { Certainty, TransactionKind, TransactionStatus } from "@/lib/domain/types";

export const KIND_LABELS: Record<TransactionKind, string> = {
  expense: "Dépense",
  income: "Revenu",
  transfer: "Transfert",
  adjustment: "Ajustement",
};

export const STATUS_LABELS: Record<TransactionStatus, string> = {
  planned: "Prévue",
  confirmed: "Confirmée",
  cancelled: "Annulée",
};

export const CERTAINTY_LABELS: Record<Certainty, string> = {
  certain: "Certain",
  probable: "Probable",
  uncertain: "Incertain",
};

export const CERTAINTY_HINTS: Record<Certainty, string> = {
  certain: "Compté dans le scénario garanti (salaire, aide déjà accordée…).",
  probable: "Compté seulement dans le scénario estimé.",
  uncertain: "Jamais compté dans les calculs : affiché pour information.",
};
