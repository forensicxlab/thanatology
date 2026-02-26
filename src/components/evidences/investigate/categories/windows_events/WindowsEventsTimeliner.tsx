import * as React from "react";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

import type { GridFilterModel } from "@mui/x-data-grid-pro";
import type { TimelineWindowsEventFilter } from "../../../../../dbutils/sqlite";

import WindowsEventTimelineScatter from "./WindowsEventTimelineScatter";
import WindowsEventsDataGrid from "./WindowsEventsDataGrid";

function stableStringifyFilterModel(m: GridFilterModel | undefined) {
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
    quickFilterLogicOperator: (
      m?.quickFilterLogicOperator ?? "and"
    ).toLowerCase(),
    items,
    quickFilterValues: qf,
  });
}

export default function WindowsEventsTimeliner({
  evidenceId,
  partitionId,
}: {
  evidenceId: number;
  partitionId: number;
}) {
  const [timelineFilter, setTimelineFilter] =
    React.useState<TimelineWindowsEventFilter | null>(null);

  // Draft grid filters (drive grid query + UI)
  const [gridFilterDraft, setGridFilterDraft] = React.useState<GridFilterModel>(
    {
      items: [],
    },
  );

  // Applied to chart (drive chart query)
  const [gridFilterAppliedToChart, setGridFilterAppliedToChart] =
    React.useState<GridFilterModel>({ items: [] });

  const draftKey = React.useMemo(
    () => stableStringifyFilterModel(gridFilterDraft),
    [gridFilterDraft],
  );
  const appliedKey = React.useMemo(
    () => stableStringifyFilterModel(gridFilterAppliedToChart),
    [gridFilterAppliedToChart],
  );

  const gridHasPendingChanges = draftKey !== appliedKey;

  const applyGridFiltersToChart = React.useCallback(() => {
    setGridFilterAppliedToChart(structuredClone(gridFilterDraft));
  }, [gridFilterDraft]);

  const cancelGridPending = React.useCallback(() => {
    setGridFilterDraft(structuredClone(gridFilterAppliedToChart));
  }, [gridFilterAppliedToChart]);

  return (
    <Stack gap={2}>
      <WindowsEventTimelineScatter
        evidenceId={evidenceId}
        partitionId={partitionId}
        onEventsFilterChange={setTimelineFilter}
        gridFilterModel={gridFilterAppliedToChart}
      />

      {gridHasPendingChanges && (
        <Stack
          direction="row"
          gap={1}
          justifyContent="center"
          alignItems="center"
        >
          <Typography variant="caption" color="text.secondary">
            Grid filters changed. Apply them to refresh the timeline.
          </Typography>
          <Button
            size="small"
            variant="contained"
            onClick={applyGridFiltersToChart}
          >
            Apply to timeline
          </Button>
          <Button size="small" variant="outlined" onClick={cancelGridPending}>
            Cancel
          </Button>
        </Stack>
      )}

      <WindowsEventsDataGrid
        evidenceId={evidenceId}
        partitionId={partitionId}
        timelineFilter={timelineFilter}
        onClearTimelineFilter={() => setTimelineFilter(null)}
        filterModel={gridFilterDraft}
        onFilterModelChange={setGridFilterDraft}
      />
    </Stack>
  );
}
