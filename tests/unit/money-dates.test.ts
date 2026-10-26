import { describe, expect, it } from "vitest";
import { centsToInput, formatCents, parseAmountToCents, percentage } from "@/lib/money";
import {
  addDays,
  addMonths,
  diffDays,
  diffMonths,
  endOfWeek,
  formatMonth,
  isValidIsoDate,
  monthRange,
  startOfWeek,
  todayParis,
} from "@/lib/dates";

const normalize = (s: string) => s.replace(/[  ]/g, " ");

describe("montants en centimes", () => {
  it.each([
    ["12", 1200],
    ["12,5", 1250],
    ["12,50", 1250],
    ["12.50", 1250],
    ["0,01", 1],
    ["1 234,56", 123456],
    ["1 234,56", 123456],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["45 €", 4500],
    ["0,1", 10],
  ])("convertit « %s » en %i centimes", (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  it.each(["", "abc", "12,345", "-5", "1.2.3", "12,", "1,23,45", "9999999999999"])("refuse « %s »", (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });

  it("évite les erreurs d'arrondi des flottants", () => {
    // 0,1 + 0,2 en flottant = 0,30000000000000004 ; en centimes : exact.
    expect(parseAmountToCents("0,1")! + parseAmountToCents("0,2")!).toBe(30);
    expect(parseAmountToCents("19,99")! * 3).toBe(5997);
  });

  it("formate en euros à la française", () => {
    expect(normalize(formatCents(123456))).toBe("1 234,56 €");
    expect(normalize(formatCents(-500))).toBe("-5,00 €");
    expect(normalize(formatCents(500, { signed: true }))).toBe("+5,00 €");
    expect(centsToInput(123456)).toBe("1234,56");
    expect(centsToInput(5)).toBe("0,05");
  });

  it("calcule un pourcentage ou null si la base est nulle", () => {
    expect(percentage(25, 200)).toBe(12.5);
    expect(percentage(10, 0)).toBeNull();
  });
});

describe("dates et fuseau horaire", () => {
  it("détermine le jour courant à Paris, y compris autour de minuit et du changement d'heure", () => {
    // 24/10/2026 22:30 UTC = 25/10 00:30 à Paris (heure d'été, UTC+2).
    expect(todayParis(new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    // 25/10/2026 22:30 UTC = 25/10 23:30 à Paris (heure d'hiver, UTC+1).
    expect(todayParis(new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-25");
    // Réveillon : 31/12 23:30 UTC = 1er janvier à Paris.
    expect(todayParis(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });

  it("additionne des jours sans décalage lié à l'heure d'été", () => {
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(diffDays("2026-03-01", "2026-04-01")).toBe(31);
  });

  it("ajoute des mois en bornant à la fin du mois sans dériver", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("utilise des semaines du lundi au dimanche", () => {
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19"); // dimanche → lundi précédent
    expect(endOfWeek("2026-10-19")).toBe("2026-10-25");
    expect(startOfWeek("2026-10-26")).toBe("2026-10-26");
  });

  it("valide les dates et compte les mois", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(diffMonths("2026-01-15", "2026-04-14")).toBe(2);
    expect(diffMonths("2026-01-31", "2026-02-28")).toBe(1);
    expect(monthRange("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(formatMonth("2026-10")).toBe("Octobre 2026");
  });
});
