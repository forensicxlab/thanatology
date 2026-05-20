import type { GridFilterModel } from "@mui/x-data-grid-pro";

export function stableStringifyFilterModel(m: GridFilterModel | undefined): string {
  const items = [...(m?.items ?? [])]
    .map((it) => ({
      field: it.field,
      operator: it.operator,
      value: it.value ?? null,
    }))
    .sort((a, b) =>
      `${a.field}|${a.operator}|${a.value}`.localeCompare(
        `${b.field}|${b.operator}|${b.value}`,
      ),
    );

  const qf = [...(m?.quickFilterValues ?? [])].map(String).sort();

  return JSON.stringify({
    logicOperator: (m?.logicOperator ?? "and").toLowerCase(),
    quickFilterLogicOperator: (m?.quickFilterLogicOperator ?? "and").toLowerCase(),
    items,
    quickFilterValues: qf,
  });
}
