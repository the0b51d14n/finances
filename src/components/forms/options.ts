/** Données sérialisables transmises aux formulaires clients. */
import type { Account, AccountType, Category, CategoryKind } from "@/lib/domain/types";

export type AccountOption = { id: string; name: string; type: AccountType; archived: boolean };
export type CategoryOption = { id: string; name: string; kind: CategoryKind; archived: boolean };

export const toAccountOptions = (accounts: Account[]): AccountOption[] =>
  accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, archived: !!a.archivedAt }));

export const toCategoryOptions = (categories: Category[]): CategoryOption[] =>
  categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, archived: !!c.archivedAt }));
