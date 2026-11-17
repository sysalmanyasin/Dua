const ones = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const tens = ['', '', 'twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
function underThousand(n) {
  const out = [];
  if (n >= 100) { out.push(ones[Math.floor(n / 100)], 'hundred'); n %= 100; }
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
  for (const [size, label] of [[10000000,'crore'],[100000,'lakh'],[1000,'thousand'],[1,'']]) {
    const chunk = Math.floor(n / size);
    if (chunk) { parts.push(underThousand(chunk)); if (label) parts.push(label); n %= size; }
  }
  let result = parts.join(' ') + ' Pakistani Rupees';
  if (cents) result += ' and ' + underThousand(cents) + ' Paisa';
  return result + ' Only';
}
