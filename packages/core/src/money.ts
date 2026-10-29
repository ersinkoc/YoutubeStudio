/**
 * Para birimi her yerde mikro-dolar (1 USD = 1_000_000) tamsayı olarak tutulur.
 * Kayan nokta toplama hataları maliyet defterinde birikmesin diye.
 */
export type Micros = number;

export const usd = (dollars: number): Micros => Math.round(dollars * 1_000_000);

export const toDollars = (micros: Micros): number => micros / 1_000_000;

export const formatUsd = (micros: Micros): string => {
  const d = toDollars(micros);
  return `$${d < 1 ? d.toFixed(4) : d.toFixed(2)}`;
};
