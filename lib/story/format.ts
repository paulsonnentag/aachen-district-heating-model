export const FORMATS = ['number', 'int', 'percent', 'pp'] as const;

export type Format = (typeof FORMATS)[number];

const integer = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('en', { maximumSignificantDigits: 4 });
const oneDecimal = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** `percent` and `pp` expect shares (0.231 → 23.1%); differences carry a sign. */
export function formatStoryValue(value: number, format: Format, signed: boolean): string {
  const text = formatMagnitude(Math.abs(value), format);
  if (/^[0.]+\D*$/.test(text)) return text;
  if (value < 0) return `−${text}`;
  return signed ? `+${text}` : text;
}

export function isFormat(text: string): text is Format {
  return (FORMATS as readonly string[]).includes(text);
}

function formatMagnitude(value: number, format: Format): string {
  switch (format) {
    case 'int':
      return integer.format(value);
    case 'percent':
      return `${oneDecimal.format(value * 100)}%`;
    case 'pp':
      return `${oneDecimal.format(value * 100)} pp`;
    case 'number':
      return number.format(value);
  }
}
