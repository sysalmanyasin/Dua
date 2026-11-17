const ones = ['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const tens = ['', '', 'Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function underThousand(n) {
  const out = [];
  if (n >= 100) { out.push(ones[Math.floor(n / 100)], 'Hundred'); n %= 100; }
  if (n >= 20) { out.push(tens[Math.floor(n / 10)]); if (n % 10) out.push(ones[n % 10]); }
  else if (n > 0) out.push(ones[n]);
  return out.join(' ');
}
export function amountInWords(paisa) {
  if (!Number.isSafeInteger(paisa) || paisa < 0) throw new Error('Amount must be a non-negative integer number of paisa.');
  const rupees = Math.floor(paisa / 100);
  const cents = paisa % 100;
  if (rupees > 999999999) throw new Error('Amount is too large.');
  if (rupees === 0 && cents === 0) return 'Zero Pakistani Rupees Only';
  let n = rupees;
  const parts = [];
  for (const [size, label] of [[10000000,'Crore'],[100000,'Lakh'],[1000,'Thousand'],[1,'']]) {
    const chunk = Math.floor(n / size);
    if (chunk) { parts.push(underThousand(chunk)); if (label) parts.push(label); n %= size; }
  }
  let result = parts.join(' ') + ' Pakistani Rupees';
  if (cents) result += ' And ' + underThousand(cents) + ' Paisa';
  return result + ' Only';
}
