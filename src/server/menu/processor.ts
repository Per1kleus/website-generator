import "server-only";

/**
 * Menu Data Processor.
 *
 * Sits between the Google Sheets API and the Digital Menu: it identifies the
 * required columns, parses each row, validates it, and produces structured
 * menu items grouped by category.
 *
 * One bad row never breaks the menu. Invalid rows are dropped from the output
 * and reported back to the builder application by row number, so the creator
 * can fix the spreadsheet while every valid row keeps working.
 */

/**
 * The exact header names the spreadsheet must use. These are the creator's
 * contract with the sheet and are deliberately not "friendly" identifiers —
 * renaming them would break every spreadsheet already in use.
 */
export const REQUIRED_COLUMNS = [
  "name",
  "price",
  "description",
  "chefs choice",
  "category",
  "imageurl",
] as const;

export type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

/** Suggested dropdown values for the `category` column, offered in the UI. */
export const SUGGESTED_CATEGORIES = [
  "Starters", "Main Courses", "Salads", "Pasta", "Pizza", "Seafood", "Meat",
  "Sides", "Desserts", "Wines", "Beers", "Cocktails", "Soft Drinks", "Coffee",
  "Other",
];

export type Finding = {
  level: "error" | "warning";
  /** 1-based spreadsheet row, matching what the creator sees in Sheets. */
  row: number | null;
  column: string | null;
  message: string;
};

/** One parsed row, before image resolution. */
export type ParsedItem = {
  /** Stable across syncs: derived from category + name so translations survive. */
  sourceKey: string;
  name: string;
  price: string;
  description: string;
  chefsChoice: boolean;
  category: string;
  imageUrlRaw: string;
  row: number;
};

export type ParseResult = {
  items: ParsedItem[];
  /** Category names in first-seen order — the sheet decides the ordering. */
  categories: string[];
  findings: Finding[];
  /** Rows that were present but rejected. */
  rejected: number;
  headerRow: string[];
};

/** Header matching is forgiving about case and padding, nothing else. */
function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Google Sheets checkboxes arrive as real booleans through
 * UNFORMATTED_VALUE, but a sheet may also carry text or a tick character if
 * the column was filled in by hand before the checkbox was applied.
 */
function parseChefsChoice(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === "") return false;
  if (["true", "yes", "y", "1", "✓", "✔", "☑", "x"].includes(v)) return true;
  if (["false", "no", "n", "0", "☐", "-"].includes(v)) return false;
  return null;
}

/**
 * Prices stay strings: the sheet is the source of truth for how a price is
 * written, including its currency symbol and decimal convention. This only
 * rejects values that plainly are not prices, and normalises the bare numbers
 * that UNFORMATTED_VALUE returns for a numeric cell.
 */
function parsePrice(raw: string): { value: string; ok: boolean } {
  const v = raw.trim();
  if (v === "") return { value: "", ok: true }; // a priced-on-request item

  // A plain number from an unformatted numeric cell: render to 2 decimals.
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return { value: v, ok: false };
    return { value: n.toFixed(2), ok: true };
  }

  // Anything containing a digit is accepted as written: "8,50", "€8.50",
  // "12.00 / 18.00", "from 9". Formatting is the restaurant's business.
  if (/\d/.test(v)) return { value: v, ok: true };

  return { value: v, ok: false };
}

/** Deterministic id so a re-sync keeps the same key for an unchanged item. */
function sourceKey(category: string, name: string): string {
  const slug = `${category}|${name}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "item";
}

/**
 * Turns raw sheet values into structured menu data.
 *
 * `values[0]` must be the header row; every later row is one menu item.
 */
export function processSheet(values: string[][]): ParseResult {
  const findings: Finding[] = [];

  if (!values.length) {
    return {
      items: [], categories: [], rejected: 0, headerRow: [],
      findings: [{
        level: "error", row: null, column: null,
        message: "That sheet is empty. Row 1 must contain the column headers.",
      }],
    };
  }

  const headerRow = values[0].map((h) => h ?? "");
  const headers = headerRow.map(normaliseHeader);

  const index: Partial<Record<RequiredColumn, number>> = {};
  const missing: RequiredColumn[] = [];
  for (const column of REQUIRED_COLUMNS) {
    const at = headers.indexOf(column);
    if (at < 0) missing.push(column);
    else index[column] = at;
  }

  if (missing.length) {
    // Missing columns are structural: refuse rather than silently continue.
    for (const column of missing) {
      findings.push({
        level: "error", row: 1, column,
        message: `Required column "${column}" is missing. Add it to row 1, spelled exactly like that.`,
      });
    }
    return { items: [], categories: [], rejected: 0, headerRow, findings };
  }

  const cell = (row: string[], column: RequiredColumn) =>
    String(row[index[column] as number] ?? "").trim();

  const items: ParsedItem[] = [];
  const categories: string[] = [];
  const seenKeys = new Map<string, number>();
  let rejected = 0;

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rowNumber = i + 1; // 1-based, and row 1 is the header

    // A completely empty row is spreadsheet padding, not an error.
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;

    const name = cell(row, "name");
    const category = cell(row, "category");
    const rawPrice = cell(row, "price");
    const rawChefs = cell(row, "chefs choice");
    const description = cell(row, "description");
    const imageUrlRaw = cell(row, "imageurl");

    const rowErrors: Finding[] = [];

    if (!name) {
      rowErrors.push({
        level: "error", row: rowNumber, column: "name",
        message: "The name is empty. This item will not be displayed.",
      });
    }
    if (!category) {
      rowErrors.push({
        level: "error", row: rowNumber, column: "category",
        message: "The category is empty. This item will not be displayed.",
      });
    }

    const price = parsePrice(rawPrice);
    if (!price.ok) {
      rowErrors.push({
        level: "error", row: rowNumber, column: "price",
        message: `"${rawPrice}" is not a valid price. This item will not be displayed until the spreadsheet is corrected.`,
      });
    }

    const chefsChoice = parseChefsChoice(rawChefs);
    if (chefsChoice === null) {
      // Recoverable: treat as not-a-chef's-choice and warn, rather than
      // dropping an otherwise good dish over one checkbox.
      rowErrors.push({
        level: "warning", row: rowNumber, column: "chefs choice",
        message: `"${rawChefs}" is not TRUE or FALSE. Use the checkbox; treated as not a chef's choice.`,
      });
    }

    const hardErrors = rowErrors.filter((f) => f.level === "error");
    findings.push(...rowErrors);

    if (hardErrors.length) {
      rejected += 1;
      continue;
    }

    const key = sourceKey(category, name);
    const duplicate = seenKeys.get(key);
    if (duplicate) {
      findings.push({
        level: "warning", row: rowNumber, column: "name",
        message: `Same name and category as row ${duplicate}. Both are shown, but they will look identical.`,
      });
    } else {
      seenKeys.set(key, rowNumber);
    }

    if (!categories.includes(category)) categories.push(category);

    items.push({
      // Suffix a duplicate so two identical rows keep separate translations.
      sourceKey: duplicate ? `${key}-${rowNumber}` : key,
      name,
      price: price.value,
      description,
      chefsChoice: chefsChoice ?? false,
      category,
      imageUrlRaw,
      row: rowNumber,
    });
  }

  if (!items.length && !findings.some((f) => f.level === "error")) {
    findings.push({
      level: "error", row: null, column: null,
      message: "The sheet has headers but no menu items below them.",
    });
  }

  return { items, categories, findings, rejected, headerRow };
}
