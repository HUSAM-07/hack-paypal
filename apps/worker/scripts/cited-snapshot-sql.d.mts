export declare const CITED_TABLES: readonly string[];
export declare function snapshotSql(
  rowsByTable: Record<string, Record<string, string | number | boolean | null>[]>,
): string;
