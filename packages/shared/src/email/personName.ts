/**
 * Turn the name shapes staff records actually carry into something fit for an
 * email greeting. Roster imports store "LAST, FIRST" in all caps, and several
 * senders fall back to an email local part ("paul.ivers").
 *
 *   formatPersonName('IVERS, PAUL')  → 'Paul Ivers'
 *   formatPersonName('paul.ivers')   → 'Paul Ivers'
 *   formatPersonName('Jane McDonald') → 'Jane McDonald' (mixed case kept)
 */
export function formatPersonName(raw: string): string {
  let name = raw.trim();
  if (!name) return '';
  if (name.includes('@')) name = name.split('@')[0] ?? name;

  const comma = name.indexOf(',');
  if (comma !== -1) {
    const last = name.slice(0, comma).trim();
    const first = name.slice(comma + 1).trim();
    name = first && last ? `${first} ${last}` : first || last;
  } else if (!/\s/.test(name) && /[._]/.test(name)) {
    name = name.replace(/[._]+/g, ' ');
  }

  // Only re-case names that carry no case information (ALL CAPS or all
  // lowercase) so deliberate casing like "McDonald" or "de la Cruz" survives.
  if (name === name.toUpperCase() || name === name.toLowerCase()) {
    name = name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => {
      return sep + ch.toUpperCase();
    });
  }
  return name.replace(/\s+/g, ' ');
}

/** First name for a greeting ("Hi Paul,"). Accepts the same shapes as
 *  formatPersonName. */
export function firstNameOf(raw: string): string {
  return formatPersonName(raw).split(' ')[0] ?? '';
}
