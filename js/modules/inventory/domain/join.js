// Put the stock half and the sales half of a product together. Rows without a sales half (or when the person may not see
// sales) get no sales fields, so a report that needs them must check `hasSales` first.
export function joinProducts(stock, sales) {
  if (!sales) return stock.map((s) => ({ ...s }));
  return stock.map((s) => {
    const v = sales.get(s.code);
    return v
      ? { ...s, ...v }
      : {
          ...s,
          n0: 0,
          n30: 0,
          n60: 0,
          n90: 0,
          vi0: 0,
          vi30: 0,
          vi60: 0,
          vi90: 0,
          ve0: 0,
          ve30: 0,
          ve60: 0,
          ve90: 0,
          tax: 0,
          taxable: false,
        };
  });
}
