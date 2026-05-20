import * as React from "react";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import TimelineScatter from "./TimelineScatter";
import FileDataGrid from "../files/FilesDataGrid";
import type { GridFilterModel } from "@mui/x-data-grid-pro";
import type { TimelineFileFilter } from "../../../../../dbutils/sqlite";
import { stableStringifyFilterModel } from "./timelineUtils";

export default function Timeliner({
  evidenceId,
  partitionId,
}: {
  evidenceId: number;
  partitionId: number;
}) {
  const [timelineFilter, setTimelineFilter] =
    React.useState<TimelineFileFilter | null>(null);

  // Grid filter: draft (drives grid UI + grid querying)
  const [gridFilterDraft, setGridFilterDraft] = React.useState<GridFilterModel>(
    {
      items: [],
    },
  );

  // Grid filter: applied to timeline (drives chart querying)
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
    // clone to avoid accidental mutation surprises
    setGridFilterAppliedToChart(structuredClone(gridFilterDraft));
  }, [gridFilterDraft]);

  const cancelGridPending = React.useCallback(() => {
    setGridFilterDraft(structuredClone(gridFilterAppliedToChart));
  }, [gridFilterAppliedToChart]);

  return (
    <Stack sx={{
      gap: 2
    }}>
      <TimelineScatter
        evidenceId={evidenceId}
        partitionId={partitionId}
        onFilesFilterChange={setTimelineFilter}
        // IMPORTANT: chart uses the APPLIED grid filters, not draft
        gridFilterModel={gridFilterAppliedToChart}
      />
      {gridHasPendingChanges && (
        <Stack
          direction="row"
          sx={{
            gap: 1,
            justifyContent: "center",
            alignItems: "center"
          }}>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
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
      <FileDataGrid
        evidence_id={evidenceId}
        partition_id={partitionId}
        timelineFilter={timelineFilter}
        onClearTimelineFilter={() => setTimelineFilter(null)}
        filterModel={gridFilterDraft}
        onFilterModelChange={setGridFilterDraft}
        autoSize={false}
      />
    </Stack>
  );
}
