import Papa from "papaparse";
import { IssueSeverity } from "@prisma/client";

export const REQUIRED_HEADERS = [
  "brigade_number",
  "school_or_unit",
  "category",
  "division",
  "team_number",
  "cadet_last_name",
  "cadet_first_name",
 ] as const;

export const OPTIONAL_WARNING_HEADERS = [
  "cadet_rank",
  "cadet_gender",
  "cadet_grade",
] as const;

export const ALL_EXPECTED_HEADERS = [
  ...REQUIRED_HEADERS,
  ...OPTIONAL_WARNING_HEADERS,
] as const;

export type RequiredHeader = (typeof REQUIRED_HEADERS)[number];
export type OptionalWarningHeader = (typeof OPTIONAL_WARNING_HEADERS)[number];
export type RosterHeader = (typeof ALL_EXPECTED_HEADERS)[number];

export type ParsedRosterRow = Record<RosterHeader, string> & {
  rowNumber: number;
  normalizedName: string;
  canonicalIdentityKey: string;
};

export type GeneratedIssue = {
  type: string;
  code: string;
  severity: IssueSeverity;
  message: string;
  rowNumber?: number;
  brigadeNumber?: string;
  category?: string;
  division?: string;
  canonicalIdentityKey?: string;
  details?: Record<string, unknown>;
};

export type ParseResult = {
  headers: string[];
  rows: ParsedRosterRow[];
  hardErrors: GeneratedIssue[];
  warnings: GeneratedIssue[];
  identityReviews: GeneratedIssue[];
};

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeName(first: string, last: string): string {
  return `${clean(last).toLowerCase()},${clean(first).toLowerCase()}`;
}

function canonicalIdentityKey(row: Record<RosterHeader, string>): string {
  return [
    row.brigade_number.trim().toLowerCase(),
    row.division.trim().toLowerCase(),
    normalizeName(row.cadet_first_name, row.cadet_last_name),
  ].join("|");
}

function compactNameKey(row: Record<RosterHeader, string>): string {
  const first = clean(row.cadet_first_name).toLowerCase();
  const last = clean(row.cadet_last_name).toLowerCase();
  return `${row.brigade_number.trim().toLowerCase()}|${last}|${first.slice(0, 1)}`;
}

export function parseRosterCsv(csvText: string): ParseResult {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => clean(h).toLowerCase(),
  });

  const headers = (parsed.meta.fields ?? []).map((h) => h.toLowerCase());
  const rows: ParsedRosterRow[] = [];

  parsed.data.forEach((raw, index) => {
    const rowNumber = index + 2;
    const row = Object.fromEntries(
      ALL_EXPECTED_HEADERS.map((h) => [h, clean(raw[h])]),
    ) as Record<RosterHeader, string>;

    rows.push({
      ...row,
      rowNumber,
      normalizedName: normalizeName(row.cadet_first_name, row.cadet_last_name),
      canonicalIdentityKey: canonicalIdentityKey(row),
    });
  });
  return {
    headers,
    rows,
    ...analyzeParsedRows(rows, headers),
  };
}

export function buildTeamKey(row: ParsedRosterRow): string {
  return [
    row.brigade_number.trim(),
    row.division.trim(),
    row.category.trim(),
    row.team_number.trim(),
  ].join("|");
}

export function analyzeParsedRows(
  rows: ParsedRosterRow[],
  headers: string[],
): Pick<ParseResult, "hardErrors" | "warnings" | "identityReviews"> {
  const missingRequiredHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  const hardErrors: GeneratedIssue[] = [];
  const warnings: GeneratedIssue[] = [];
  const identityReviews: GeneratedIssue[] = [];

  if (missingRequiredHeaders.length > 0) {
    hardErrors.push({
      type: "VALIDATION",
      code: "MISSING_HEADERS",
      severity: IssueSeverity.HARD_ERROR,
      message: `Missing required headers: ${missingRequiredHeaders.join(", ")}`,
      details: { missingHeaders: missingRequiredHeaders },
    });
  }

  for (const row of rows) {
    const requiredFieldFailures = REQUIRED_HEADERS.filter((h) => !row[h]);
    if (requiredFieldFailures.length > 0) {
      // Silent warning — does not block schedule generation, inspectable but not mandatory to resolve
      identityReviews.push({
        type: "VALIDATION",
        code: "MISSING_REQUIRED_VALUE",
        severity: IssueSeverity.WARNING,
        message: `Row ${row.rowNumber} is missing: ${requiredFieldFailures.join(", ")}`,
        rowNumber: row.rowNumber,
        details: { requiredFieldFailures },
      });
    }
  }

  const duplicateSameCategoryMap = new Map<string, ParsedRosterRow[]>();
  const multiCategoryMap = new Map<string, Set<string>>();
  const compactIdentityMap = new Map<string, Set<string>>();

  for (const row of rows) {
    const sameCategoryKey = [
      row.brigade_number.toLowerCase(),
      row.division.toLowerCase(),
      row.category.toLowerCase(),
      row.normalizedName,
    ].join("|");
    const list = duplicateSameCategoryMap.get(sameCategoryKey) ?? [];
    list.push(row);
    duplicateSameCategoryMap.set(sameCategoryKey, list);

    const categories = multiCategoryMap.get(row.canonicalIdentityKey) ?? new Set<string>();
    categories.add(`${row.category}::${row.division}`);
    multiCategoryMap.set(row.canonicalIdentityKey, categories);

    const compactKey = compactNameKey(row);
    const identityVariants = compactIdentityMap.get(compactKey) ?? new Set<string>();
    identityVariants.add(row.normalizedName);
    compactIdentityMap.set(compactKey, identityVariants);
  }

  for (const [key, entries] of duplicateSameCategoryMap) {
    const distinctTeams = new Set(entries.map((r) => r.team_number));
    if (distinctTeams.size > 1) {
      const [brigadeNumber, division, category] = key.split("|");
      hardErrors.push({
        type: "CONFLICT",
        code: "DUPLICATE_SAME_CATEGORY",
        severity: IssueSeverity.HARD_ERROR,
        message: `Cadet appears in multiple teams of ${category}/${division}`,
        brigadeNumber,
        division,
        category,
        canonicalIdentityKey: entries[0].canonicalIdentityKey,
        details: {
          rows: entries.map((r) => r.rowNumber),
          teams: [...distinctTeams],
        },
      });
    }
  }

  for (const [identityKey, categories] of multiCategoryMap) {
    if (categories.size > 1) {
      const [brigadeNumber] = identityKey.split("|");
      warnings.push({
        type: "CONFLICT",
        code: "MULTI_CATEGORY_CADET",
        severity: IssueSeverity.WARNING,
        message: "Cadet competes in multiple categories/divisions",
        brigadeNumber,
        canonicalIdentityKey: identityKey,
        details: {
          categories: [...categories],
        },
      });
    }
  }

  for (const [compactKey, names] of compactIdentityMap) {
    if (names.size > 1) {
      const [brigadeNumber] = compactKey.split("|");
      identityReviews.push({
        type: "IDENTITY",
        code: "IDENTITY_VARIANT",
        severity: IssueSeverity.WARNING,
        message: "Possible identity mismatch. Review merge/split.",
        brigadeNumber,
        details: {
          variants: [...names],
        },
      });
    }
  }

  return { hardErrors, warnings, identityReviews };
}
