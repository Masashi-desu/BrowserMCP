export const resolveViteBase = (configured?: string): string => {
  const value = configured?.trim();
  if (value === undefined || value === "") return "./";
  if (value === "./" || value === ".") return "./";
  if (/^https?:\/\//u.test(value)) return value.endsWith("/") ? value : `${value}/`;
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
};
