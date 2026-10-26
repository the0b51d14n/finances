/** Virements conseillés entre comptes courants (ex. Caisse d'Épargne → Boursorama). */
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/primitives";
import { formatDate } from "@/lib/dates";
import type { TransferSuggestion } from "@/lib/domain/transfers";
import type { Account } from "@/lib/domain/types";
import { centsToInput, formatCents } from "@/lib/money";

export function TransferSuggestions({
  suggestions,
  accountsById,
  returnTo,
  emptyText,
}: {
  suggestions: TransferSuggestion[];
  accountsById: Map<string, Account>;
  returnTo: string;
  emptyText?: string;
}) {
  if (suggestions.length === 0) {
    return emptyText ? <p className="muted small">{emptyText}</p> : null;
  }
  return (
    <ul className="list">
      {suggestions.map((s, i) => {
        const to = accountsById.get(s.toAccountId)?.name ?? "compte";
        const from = s.fromAccountId ? (accountsById.get(s.fromAccountId)?.name ?? "compte") : null;
        const href = s.fromAccountId
          ? `/operations/nouvelle?type=transfer&compte=${s.fromAccountId}&vers=${s.toAccountId}&montant=${encodeURIComponent(centsToInput(s.amountCents))}&libelle=${encodeURIComponent(`Virement vers ${to}`)}&retour=${encodeURIComponent(returnTo)}`
          : null;
        return (
          <li key={i} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            {s.covered && from ? (
              <div className="row-between">
                <span className="list-main">
                  <span>
                    Virer <strong className="num">{formatCents(s.amountCents)}</strong> de {from} vers {to}
                  </span>
                  <span className="faint tiny">
                    avant le {formatDate(s.byDate, "short")} · sinon découvert de {formatCents(s.shortfallCents)} prévu le {formatDate(s.shortfallDate, "short")}
                  </span>
                </span>
                {href && (
                  <Link href={href} className="btn btn-sm">
                    <Icon name="swap" size={14} /> Enregistrer le virement
                  </Link>
                )}
              </div>
            ) : (
              <Notice tone="danger" title={`${to} : découvert de ${formatCents(s.shortfallCents)} prévu le ${formatDate(s.shortfallDate, "short")}`}>
                {from
                  ? `${from} ne peut couvrir que partiellement ce manque sans passer lui-même à découvert.`
                  : "Aucun autre compte courant ne peut couvrir ce manque."}{" "}
                Reportez une dépense ou prévoyez une rentrée d&apos;argent.
              </Notice>
            )}
          </li>
        );
      })}
    </ul>
  );
}
