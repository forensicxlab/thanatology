import * as React from "react";
import {
  DataGridPro,
  GridActionsCellItem,
  type GridColDef,
  type GridPaginationModel,
  type GridSortModel,
} from "@mui/x-data-grid-pro";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import CloseIcon from "@mui/icons-material/Close";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import {
  getInstalledApplicationCorroboration,
  getInstalledApplicationEventFacets,
  getInstalledApplicationEventsPage,
  getInstalledApplicationObservationsPage,
  getInstalledApplicationsFacets,
  getInstalledApplicationsPage,
  type InstalledApplicationEventFacets,
  type InstalledApplicationFacet,
  type InstalledApplicationFacets,
  type InstalledApplicationObservationRow,
  type InstalledApplicationObservationSortField,
  type InstalledApplicationRow,
  type InstalledApplicationSortField,
} from "../../../../../dbutils/installedApplications";
import type { InvestigationTimeScope } from "../../../../../dbutils/sqlite";
import {
  useTimeFilter,
  useTimeFilterStore,
} from "../../../../../store/timeFilterStore";
import TimeFilterBanner from "../../TimeFilterBanner";
import {
  formatBytes,
  renderTimestampCell,
} from "../mobile/common";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];
// Let React StrictMode discard its first effect pass before any SQLite work starts.
const REQUEST_START_DELAY_MS = 0;

type Pane = "inventory" | "events" | "observations";
type InventoryFilters = {
  platform: string;
  objectKind: string;
  parser: string;
  installType: string;
  state: string;
};
type ObservationFilters = {
  platform: string;
  objectKind: string;
  parser: string;
};
type EventFilters = {
  platform: string;
  parser: string;
  eventType: string;
  subjectType: string;
};
type DetailSelection =
  | { pane: "inventory"; row: InstalledApplicationRow }
  | {
      pane: "events" | "observations";
      row: InstalledApplicationObservationRow;
    };

const EMPTY_FACETS: InstalledApplicationFacets = {
  instances: 0,
  presentInstances: 0,
  syntheticEntries: 0,
  distinctIdentifiers: 0,
  observations: 0,
  platforms: [],
  objectKinds: [],
  parsers: [],
  installTypes: [],
  states: [],
  sourcePlatforms: [],
  sourceObjectKinds: [],
  sourceParsers: [],
};

const EMPTY_EVENT_FACETS: InstalledApplicationEventFacets = {
  observations: 0,
  platforms: [],
  parsers: [],
  eventTypes: [],
  subjectTypes: [],
};

export interface InstalledApplicationsViewProps {
  evidenceId: number;
  partitionId: number;
  onRevealFile: (fileId: number) => void;
}

function clipped(value: unknown): React.ReactNode {
  const text = String(value ?? "");
  if (!text) return "—";
  return (
    <Tooltip title={text} placement="bottom-start">
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {text}
      </span>
    </Tooltip>
  );
}

function facetLabel(facet: InstalledApplicationFacet): string {
  return `${facet.value} (${facet.count.toLocaleString()})`;
}

function FacetSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: InstalledApplicationFacet[];
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      sx={{ minWidth: 155, flex: "0 1 210px" }}
    >
      <MenuItem value="">All {label.toLocaleLowerCase()}</MenuItem>
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {facetLabel(option)}
        </MenuItem>
      ))}
    </TextField>
  );
}

async function openSourceFile(
  evidenceId: number,
  partitionId: number,
  row: InstalledApplicationRow | InstalledApplicationObservationRow,
): Promise<void> {
  if (
    row.file_id == null ||
    row.fs_identifier == null ||
    row.file_size == null ||
    !row.file_path
  ) {
    throw new Error("The source file is not available in the indexed filesystem.");
  }
  const payload = {
    evidenceId,
    partitionId,
    Identifier: row.fs_identifier,
    fileId: row.file_id,
    fileSize: row.file_size,
    path: row.file_path,
  };
  localStorage.setItem("pending_fileviewer_payload", JSON.stringify(payload));
  try {
    await invoke("new_fileviewer");
  } finally {
    await emitTo("fileviewer", "message", payload);
  }
}

function prettyJson(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function timestampCell(row: InstalledApplicationObservationRow): React.ReactNode {
  if (row.timestamp_ms != null) return renderTimestampCell(row.timestamp_ms);
  return clipped(row.timestamp_label);
}

function rangeLabel(start: number | null, end: number | null): string {
  const stamp = (value: number) => new Date(value).toISOString().replace("T", " ");
  if (start != null && end != null) return `${stamp(start)} → ${stamp(end)}`;
  if (start != null) return `from ${stamp(start)} onward`;
  if (end != null) return `through ${stamp(end)}`;
  return "all time";
}

function sourceActions<T extends InstalledApplicationRow | InstalledApplicationObservationRow>(
  evidenceId: number,
  partitionId: number,
  onRevealFile: (fileId: number) => void,
  onDetails: (row: T) => void,
  onError: (message: string) => void,
): GridColDef<T> {
  return {
    field: "actions",
    type: "actions",
    headerName: "",
    width: 108,
    getActions: ({ row }) => [
      <GridActionsCellItem
        key="details"
        icon={<InfoOutlinedIcon />}
        label="Inspect details"
        onClick={() => onDetails(row)}
      />,
      <GridActionsCellItem
        key="open-source"
        icon={<VisibilityOutlinedIcon />}
        label="Open source file"
        disabled={
          row.file_id == null ||
          row.fs_identifier == null ||
          row.file_size == null ||
          !row.file_path
        }
        onClick={() => {
          void openSourceFile(evidenceId, partitionId, row).catch((cause) =>
            onError(cause instanceof Error ? cause.message : String(cause)),
          );
        }}
      />,
      <GridActionsCellItem
        key="reveal-source"
        icon={<FolderOpenOutlinedIcon />}
        label="Reveal in Files"
        disabled={row.file_id == null}
        onClick={() => row.file_id != null && onRevealFile(row.file_id)}
      />,
    ],
  };
}

export default function InstalledApplicationsView({
  evidenceId,
  partitionId,
  onRevealFile,
}: InstalledApplicationsViewProps) {
  const { start, end, fileTimeField } = useTimeFilter();
  const scopeEvidenceId = useTimeFilterStore((state) => state.evidenceId);
  const scopePartitionId = useTimeFilterStore((state) => state.partitionId);
  const [pane, setPane] = React.useState<Pane>("inventory");
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [inventoryFilters, setInventoryFilters] = React.useState<InventoryFilters>({
    platform: "",
    objectKind: "",
    parser: "",
    installType: "",
    state: "",
  });
  const [observationFilters, setObservationFilters] =
    React.useState<ObservationFilters>({ platform: "", objectKind: "", parser: "" });
  const [eventFilters, setEventFilters] = React.useState<EventFilters>({
    platform: "",
    parser: "",
    eventType: "",
    subjectType: "",
  });
  const [inventoryRows, setInventoryRows] = React.useState<InstalledApplicationRow[]>([]);
  const [observationRows, setObservationRows] = React.useState<
    InstalledApplicationObservationRow[]
  >([]);
  const [eventRows, setEventRows] = React.useState<InstalledApplicationObservationRow[]>([]);
  const [inventoryCount, setInventoryCount] = React.useState(0);
  const [observationCount, setObservationCount] = React.useState(0);
  const [eventCount, setEventCount] = React.useState(0);
  const [facets, setFacets] = React.useState(EMPTY_FACETS);
  const [eventFacets, setEventFacets] = React.useState(EMPTY_EVENT_FACETS);
  const [loadedApplicationFacetKey, setLoadedApplicationFacetKey] =
    React.useState<string | null>(null);
  const [loadedEventFacetKey, setLoadedEventFacetKey] = React.useState<
    string | null
  >(null);
  const [inventoryPagination, setInventoryPagination] =
    React.useState<GridPaginationModel>({ page: 0, pageSize: 50 });
  const [observationPagination, setObservationPagination] =
    React.useState<GridPaginationModel>({ page: 0, pageSize: 50 });
  const [eventPagination, setEventPagination] =
    React.useState<GridPaginationModel>({ page: 0, pageSize: 50 });
  const [inventorySort, setInventorySort] = React.useState<GridSortModel>([
    { field: "display_name", sort: "asc" },
  ]);
  const [observationSort, setObservationSort] = React.useState<GridSortModel>([
    { field: "display_name", sort: "asc" },
  ]);
  const [eventSort, setEventSort] = React.useState<GridSortModel>([
    { field: "timestamp_ms", sort: "desc" },
  ]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<DetailSelection | null>(null);
  const [detailTab, setDetailTab] = React.useState(0);
  const [corroboration, setCorroboration] = React.useState<
    InstalledApplicationObservationRow[]
  >([]);
  const [corroborationCount, setCorroborationCount] = React.useState(0);
  const [corroborationLoading, setCorroborationLoading] = React.useState(false);
  const investigationScope = React.useRef({ evidenceId, partitionId });
  const fetchSequence = React.useRef(0);
  const facetSequence = React.useRef(0);
  const corroborationSequence = React.useRef(0);
  const inventoryCountCache = React.useRef(new Map<string, number>());
  const observationCountCache = React.useRef(new Map<string, number>());
  const eventCountCache = React.useRef(new Map<string, number>());

  const timeScope = React.useMemo<InvestigationTimeScope | undefined>(
    () =>
      scopeEvidenceId === evidenceId && scopePartitionId === partitionId
        ? { evidenceId, partitionId, startMs: start, endMs: end, fileTimeField }
        : undefined,
    [
      end,
      evidenceId,
      fileTimeField,
      partitionId,
      scopeEvidenceId,
      scopePartitionId,
      start,
    ],
  );
  const hasScopedTimeRange =
    timeScope?.startMs != null || timeScope?.endMs != null;
  const scopedRangeLabel = rangeLabel(
    timeScope?.startMs ?? null,
    timeScope?.endMs ?? null,
  );

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    const previousScope = investigationScope.current;
    if (
      previousScope.evidenceId === evidenceId &&
      previousScope.partitionId === partitionId
    ) {
      return;
    }
    investigationScope.current = { evidenceId, partitionId };
    setPane("inventory");
    setSearchInput("");
    setSearch("");
    setInventoryFilters({
      platform: "",
      objectKind: "",
      parser: "",
      installType: "",
      state: "",
    });
    setObservationFilters({ platform: "", objectKind: "", parser: "" });
    setEventFilters({ platform: "", parser: "", eventType: "", subjectType: "" });
    inventoryCountCache.current.clear();
    observationCountCache.current.clear();
    eventCountCache.current.clear();
    setFacets(EMPTY_FACETS);
    setEventFacets(EMPTY_EVENT_FACETS);
    setLoadedApplicationFacetKey(null);
    setLoadedEventFacetKey(null);
    setSelected(null);
  }, [evidenceId, partitionId]);

  const inventoryFilterKey = React.useMemo(
    () => JSON.stringify({ evidenceId, partitionId, search, ...inventoryFilters }),
    [evidenceId, inventoryFilters, partitionId, search],
  );
  const observationFilterKey = React.useMemo(
    () => JSON.stringify({ evidenceId, partitionId, search, ...observationFilters }),
    [evidenceId, observationFilters, partitionId, search],
  );
  const eventFilterKey = React.useMemo(
    () =>
      JSON.stringify({
        evidenceId,
        partitionId,
        search,
        ...eventFilters,
        start: timeScope?.startMs ?? null,
        end: timeScope?.endMs ?? null,
      }),
    [evidenceId, eventFilters, partitionId, search, timeScope?.endMs, timeScope?.startMs],
  );
  const applicationFacetKey = React.useMemo(
    () => JSON.stringify({ evidenceId, partitionId, search }),
    [evidenceId, partitionId, search],
  );
  const eventFacetKey = React.useMemo(
    () =>
      JSON.stringify({
        evidenceId,
        partitionId,
        search,
        start: timeScope?.startMs ?? null,
        end: timeScope?.endMs ?? null,
      }),
    [evidenceId, partitionId, search, timeScope?.endMs, timeScope?.startMs],
  );

  React.useEffect(() => {
    setInventoryPagination((current) =>
      current.page === 0 ? current : { ...current, page: 0 },
    );
  }, [inventoryFilterKey]);
  React.useEffect(() => {
    setObservationPagination((current) =>
      current.page === 0 ? current : { ...current, page: 0 },
    );
  }, [observationFilterKey]);
  React.useEffect(() => {
    setEventPagination((current) =>
      current.page === 0 ? current : { ...current, page: 0 },
    );
  }, [eventFilterKey]);

  const usesApplicationFacets = pane !== "events";
  const usesEventFacets = pane === "events";
  const hasCurrentApplicationFacets =
    loadedApplicationFacetKey === applicationFacetKey;
  const displayedFacets = hasCurrentApplicationFacets
    ? facets
    : EMPTY_FACETS;
  const hasCurrentEventFacets = loadedEventFacetKey === eventFacetKey;
  const displayedEventFacets = hasCurrentEventFacets
    ? eventFacets
    : EMPTY_EVENT_FACETS;
  const activePageFilterKey =
    pane === "inventory"
      ? inventoryFilterKey
      : pane === "events"
        ? eventFilterKey
        : observationFilterKey;
  const activePagePagination =
    pane === "inventory"
      ? inventoryPagination
      : pane === "events"
        ? eventPagination
        : observationPagination;
  const activePageSort =
    pane === "inventory"
      ? inventorySort
      : pane === "events"
        ? eventSort
        : observationSort;

  React.useEffect(() => {
    if (!usesApplicationFacets) return;
    const sequence = ++facetSequence.current;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled || sequence !== facetSequence.current) return;
      void getInstalledApplicationsFacets({
        evidenceId,
        partitionId,
        search: search || undefined,
      })
        .then((nextFacets) => {
          if (cancelled || sequence !== facetSequence.current) return;
          setFacets(nextFacets);
          setLoadedApplicationFacetKey(applicationFacetKey);
        })
        .catch((cause) => {
          if (!cancelled && sequence === facetSequence.current) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        });
    }, REQUEST_START_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [applicationFacetKey, evidenceId, partitionId, search, usesApplicationFacets]);

  React.useEffect(() => {
    if (!usesEventFacets) return;
    const sequence = ++facetSequence.current;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled || sequence !== facetSequence.current) return;
      void getInstalledApplicationEventFacets(
        { evidenceId, partitionId, search: search || undefined },
        timeScope,
      )
        .then((nextEventFacets) => {
          if (cancelled || sequence !== facetSequence.current) return;
          setEventFacets(nextEventFacets);
          setLoadedEventFacetKey(eventFacetKey);
        })
        .catch((cause) => {
          if (!cancelled && sequence === facetSequence.current) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        });
    }, REQUEST_START_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [eventFacetKey, evidenceId, partitionId, search, usesEventFacets]);

  React.useEffect(() => {
    const sequence = ++fetchSequence.current;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const finish = () => {
      if (!cancelled && sequence === fetchSequence.current) setLoading(false);
    };
    const fail = (cause: unknown) => {
      if (cancelled || sequence !== fetchSequence.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      if (pane === "inventory") {
        setInventoryRows([]);
        setInventoryCount(0);
      } else if (pane === "events") {
        setEventRows([]);
        setEventCount(0);
      } else {
        setObservationRows([]);
        setObservationCount(0);
      }
    };

    const timer = window.setTimeout(() => {
      if (cancelled || sequence !== fetchSequence.current) return;
      if (pane === "inventory") {
        const sort = inventorySort[0];
        void getInstalledApplicationsPage({
          evidenceId,
          partitionId,
          offset: inventoryPagination.page * inventoryPagination.pageSize,
          limit: inventoryPagination.pageSize,
          search: search || undefined,
          ...inventoryFilters,
          sortField: sort?.field as InstalledApplicationSortField | undefined,
          sortDirection: sort?.sort === "desc" ? "desc" : "asc",
          knownRowCount: inventoryCountCache.current.get(inventoryFilterKey),
        })
          .then((page) => {
            if (cancelled || sequence !== fetchSequence.current) return;
            inventoryCountCache.current.set(inventoryFilterKey, page.rowCount);
            setInventoryRows(page.rows);
            setInventoryCount(page.rowCount);
          })
          .catch(fail)
          .finally(finish);
      } else if (pane === "events") {
        const sort = eventSort[0];
        void getInstalledApplicationEventsPage(
          {
            evidenceId,
            partitionId,
            offset: eventPagination.page * eventPagination.pageSize,
            limit: eventPagination.pageSize,
            search: search || undefined,
            ...eventFilters,
            sortField: sort?.field as InstalledApplicationObservationSortField | undefined,
            sortDirection: sort?.sort === "asc" ? "asc" : "desc",
            knownRowCount: eventCountCache.current.get(eventFilterKey),
          },
          timeScope,
        )
          .then((page) => {
            if (cancelled || sequence !== fetchSequence.current) return;
            eventCountCache.current.set(eventFilterKey, page.rowCount);
            setEventRows(page.rows);
            setEventCount(page.rowCount);
          })
          .catch(fail)
          .finally(finish);
      } else {
        const sort = observationSort[0];
        void getInstalledApplicationObservationsPage({
          evidenceId,
          partitionId,
          offset: observationPagination.page * observationPagination.pageSize,
          limit: observationPagination.pageSize,
          search: search || undefined,
          ...observationFilters,
          sortField: sort?.field as InstalledApplicationObservationSortField | undefined,
          sortDirection: sort?.sort === "desc" ? "desc" : "asc",
          knownRowCount: observationCountCache.current.get(observationFilterKey),
        })
          .then((page) => {
            if (cancelled || sequence !== fetchSequence.current) return;
            observationCountCache.current.set(observationFilterKey, page.rowCount);
            setObservationRows(page.rows);
            setObservationCount(page.rowCount);
          })
          .catch(fail)
          .finally(finish);
      }
    }, REQUEST_START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activePageFilterKey,
    activePagePagination.page,
    activePagePagination.pageSize,
    activePageSort,
    pane,
  ]);

  React.useEffect(() => {
    const sequence = ++corroborationSequence.current;
    setCorroboration([]);
    setCorroborationCount(0);
    if (!selected || selected.pane !== "inventory") {
      setCorroborationLoading(false);
      return;
    }
    let cancelled = false;
    setCorroborationLoading(true);
    void getInstalledApplicationCorroboration(
      evidenceId,
      partitionId,
      selected.row,
    )
      .then((page) => {
        if (cancelled || sequence !== corroborationSequence.current) return;
        setCorroboration(page.rows);
        setCorroborationCount(page.rowCount);
      })
      .catch((cause) => {
        if (!cancelled && sequence === corroborationSequence.current) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled && sequence === corroborationSequence.current) {
          setCorroborationLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [evidenceId, partitionId, selected]);

  const showDetails = React.useCallback((selection: DetailSelection) => {
    setSelected(selection);
    setDetailTab(0);
  }, []);

  const inventoryColumns = React.useMemo<GridColDef<InstalledApplicationRow>[]>(
    () => [
      {
        field: "is_present",
        headerName: "Presence",
        width: 122,
        renderCell: ({ row }) =>
          row.is_present ? (
            <Chip size="small" color="success" variant="outlined" label="Present bundle" />
          ) : (
            <Chip size="small" color="warning" variant="outlined" label="Evidence only" />
          ),
      },
      { field: "platform", headerName: "Platform", width: 88 },
      {
        field: "display_name",
        headerName: "Application",
        minWidth: 190,
        flex: 0.8,
        renderCell: (params) => clipped(params.value),
      },
      {
        field: "bundle_id",
        headerName: "Bundle / package identifier",
        minWidth: 230,
        flex: 1,
        renderCell: (params) => clipped(params.value),
      },
      {
        field: "version",
        headerName: "Version",
        width: 125,
        renderCell: ({ row }) => clipped(
          [row.version, row.build_version && `build ${row.build_version}`]
            .filter(Boolean)
            .join(" · "),
        ),
      },
      { field: "install_type", headerName: "Class", width: 150 },
      { field: "state", headerName: "State", width: 145 },
      {
        field: "application_path",
        headerName: "Instance path",
        minWidth: 260,
        flex: 1.2,
        renderCell: (params) => clipped(params.value),
      },
      {
        field: "observation_count",
        headerName: "Observations",
        width: 116,
        type: "number",
      },
      {
        field: "source_path",
        headerName: "Source path",
        minWidth: 260,
        flex: 1.1,
        renderCell: (params) => clipped(params.value),
      },
      { field: "parser", headerName: "Anchor parser", width: 205 },
      sourceActions(
        evidenceId,
        partitionId,
        onRevealFile,
        (row) => showDetails({ pane: "inventory", row }),
        setError,
      ),
    ],
    [evidenceId, onRevealFile, partitionId, showDetails],
  );

  const eventColumns = React.useMemo<
    GridColDef<InstalledApplicationObservationRow>[]
  >(
    () => [
      {
        field: "timestamp_ms",
        headerName: "Event time",
        width: 210,
        renderCell: ({ row }) => timestampCell(row),
      },
      {
        field: "time_basis",
        headerName: "Time basis",
        width: 210,
        renderCell: ({ value }) => (
          <Chip
            size="small"
            color={value === "UTC resolved" ? "success" : "warning"}
            variant="outlined"
            label={String(value)}
          />
        ),
      },
      { field: "platform", headerName: "Platform", width: 88 },
      { field: "event_type", headerName: "Event", width: 155 },
      { field: "subject_type", headerName: "Subject", width: 130 },
      {
        field: "display_name",
        headerName: "Application / package",
        minWidth: 190,
        flex: 0.8,
        renderCell: (params) => clipped(params.value ?? params.row.text),
      },
      {
        field: "bundle_id",
        headerName: "Identifier",
        minWidth: 220,
        flex: 1,
        renderCell: (params) => clipped(params.value),
      },
      { field: "version", headerName: "Version", width: 115 },
      { field: "state", headerName: "Result / state", width: 135 },
      {
        field: "source_path",
        headerName: "Source path",
        minWidth: 260,
        flex: 1.15,
        renderCell: (params) => clipped(params.value),
      },
      { field: "parser", headerName: "Parser", width: 205 },
      sourceActions(
        evidenceId,
        partitionId,
        onRevealFile,
        (row) => showDetails({ pane: "events", row }),
        setError,
      ),
    ],
    [evidenceId, onRevealFile, partitionId, showDetails],
  );

  const observationColumns = React.useMemo<
    GridColDef<InstalledApplicationObservationRow>[]
  >(
    () => [
      { field: "platform", headerName: "Platform", width: 88 },
      {
        field: "display_name",
        headerName: "Name",
        minWidth: 175,
        flex: 0.75,
        renderCell: (params) => clipped(params.value ?? params.row.text),
      },
      {
        field: "bundle_id",
        headerName: "Normalized identifier",
        minWidth: 220,
        flex: 0.9,
        renderCell: (params) => clipped(params.value),
      },
      {
        field: "object_kind",
        headerName: "Observation kind",
        minWidth: 225,
        flex: 0.8,
        renderCell: (params) => clipped(params.value),
      },
      { field: "parser", headerName: "Parser", width: 210 },
      { field: "install_type", headerName: "Class", width: 145 },
      { field: "state", headerName: "State", width: 145 },
      {
        field: "application_path",
        headerName: "Observed path",
        minWidth: 245,
        flex: 1,
        renderCell: (params) => clipped(params.value),
      },
      {
        field: "source_path",
        headerName: "Source path",
        minWidth: 260,
        flex: 1.1,
        renderCell: (params) => clipped(params.value),
      },
      sourceActions(
        evidenceId,
        partitionId,
        onRevealFile,
        (row) => showDetails({ pane: "observations", row }),
        setError,
      ),
    ],
    [evidenceId, onRevealFile, partitionId, showDetails],
  );

  const selectedRow = selected?.row ?? null;
  const selectedRaw = prettyJson(selectedRow?.json);
  const isInventoryDetail = selected?.pane === "inventory";

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        p: 1,
        gap: 0.75,
      }}
    >
      <Paper variant="outlined" sx={{ flexShrink: 0 }}>
        <Tabs
          value={pane}
          onChange={(_event, value: Pane) => setPane(value)}
          aria-label="Installed application investigation panes"
          sx={{ minHeight: 36, borderBottom: 1, borderColor: "divider" }}
        >
          <Tab
            value="inventory"
            label={
              hasCurrentApplicationFacets
                ? `Inventory (${displayedFacets.instances.toLocaleString()})`
                : "Inventory"
            }
            sx={{ minHeight: 36 }}
          />
          <Tab
            value="events"
            label={
              hasCurrentEventFacets
                ? `Installation Events (${displayedEventFacets.observations.toLocaleString()})`
                : "Installation Events"
            }
            sx={{ minHeight: 36 }}
          />
          <Tab
            value="observations"
            label={
              hasCurrentApplicationFacets
                ? `Observations (${displayedFacets.observations.toLocaleString()})`
                : "Observations"
            }
            sx={{ minHeight: 36 }}
          />
        </Tabs>
        <Stack
          direction="row"
          spacing={0.75}
          useFlexGap
          sx={{ p: 0.75, alignItems: "center", flexWrap: "wrap" }}
        >
          <TextField
            size="small"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search name, identifier, path, parser…"
            aria-label="Search installed applications"
            sx={{ minWidth: 280, flex: "1 1 340px" }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
          {pane === "inventory" && (
            <>
              <FacetSelect label="Platforms" value={inventoryFilters.platform} options={displayedFacets.platforms} onChange={(platform) => setInventoryFilters((current) => ({ ...current, platform }))} />
              <FacetSelect label="Kinds" value={inventoryFilters.objectKind} options={displayedFacets.objectKinds} onChange={(objectKind) => setInventoryFilters((current) => ({ ...current, objectKind }))} />
              <FacetSelect label="Parsers" value={inventoryFilters.parser} options={displayedFacets.parsers} onChange={(parser) => setInventoryFilters((current) => ({ ...current, parser }))} />
              <FacetSelect label="Classes" value={inventoryFilters.installType} options={displayedFacets.installTypes} onChange={(installType) => setInventoryFilters((current) => ({ ...current, installType }))} />
              <FacetSelect label="States" value={inventoryFilters.state} options={displayedFacets.states} onChange={(state) => setInventoryFilters((current) => ({ ...current, state }))} />
            </>
          )}
          {pane === "events" && (
            <>
              <FacetSelect label="Platforms" value={eventFilters.platform} options={displayedEventFacets.platforms} onChange={(platform) => setEventFilters((current) => ({ ...current, platform }))} />
              <FacetSelect label="Parsers" value={eventFilters.parser} options={displayedEventFacets.parsers} onChange={(parser) => setEventFilters((current) => ({ ...current, parser }))} />
              <FacetSelect label="Events" value={eventFilters.eventType} options={displayedEventFacets.eventTypes} onChange={(eventType) => setEventFilters((current) => ({ ...current, eventType }))} />
              <FacetSelect label="Subjects" value={eventFilters.subjectType} options={displayedEventFacets.subjectTypes} onChange={(subjectType) => setEventFilters((current) => ({ ...current, subjectType }))} />
            </>
          )}
          {pane === "observations" && (
            <>
              <FacetSelect label="Platforms" value={observationFilters.platform} options={displayedFacets.sourcePlatforms} onChange={(platform) => setObservationFilters((current) => ({ ...current, platform }))} />
              <FacetSelect label="Kinds" value={observationFilters.objectKind} options={displayedFacets.sourceObjectKinds} onChange={(objectKind) => setObservationFilters((current) => ({ ...current, objectKind }))} />
              <FacetSelect label="Parsers" value={observationFilters.parser} options={displayedFacets.sourceParsers} onChange={(parser) => setObservationFilters((current) => ({ ...current, parser }))} />
            </>
          )}
        </Stack>
        {pane === "inventory" && hasCurrentApplicationFacets && (
          <Stack direction="row" spacing={0.75} useFlexGap sx={{ px: 0.75, pb: 0.75, flexWrap: "wrap" }}>
            <Chip size="small" label={`${displayedFacets.presentInstances.toLocaleString()} present bundle instances`} />
            <Chip size="small" variant="outlined" color="warning" label={`${displayedFacets.syntheticEntries.toLocaleString()} evidence-only entries`} />
            <Chip size="small" variant="outlined" label={`${displayedFacets.distinctIdentifiers.toLocaleString()} distinct identifiers`} />
            <Chip size="small" variant="outlined" label={`Partition ${partitionId}`} />
          </Stack>
        )}
      </Paper>

      {error && (
        <Alert severity="error" variant="outlined" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {pane === "inventory" && hasScopedTimeRange && (
        <Alert severity="info" variant="outlined" icon={false} sx={{ py: 0, px: 1 }}>
          <Typography variant="caption">
            Investigation time: {scopedRangeLabel} UTC. The cross-source inventory is intentionally unfiltered so current bundle presence and corroborating evidence remain auditable together; use Installation Events for time-scoped review.
          </Typography>
        </Alert>
      )}
      {pane === "events" && (
        <>
          <TimeFilterBanner mode="intrinsic" noun="resolved installation events" timestampLabel="resolved UTC event timestamp" sx={{ px: 0, pt: 0 }} />
          <Alert severity={hasScopedTimeRange ? "warning" : "info"} variant="outlined" icon={false} sx={{ py: 0, px: 1 }}>
            <Typography variant="caption">
              UTC scope applies only to resolved event times. iOS MobileInstallation rows marked “Device-local; timezone unresolved” remain visible so ambiguous timestamps are never silently discarded.
            </Typography>
          </Alert>
        </>
      )}
      {pane === "observations" && hasScopedTimeRange && (
        <Alert severity="info" variant="outlined" icon={false} sx={{ py: 0, px: 1 }}>
          <Typography variant="caption">
            Investigation time: {scopedRangeLabel} UTC. Raw observations are intentionally unfiltered so timestamped and non-timestamped sources can be audited together; use Installation Events for time-scoped review.
          </Typography>
        </Alert>
      )}

      <Paper variant="outlined" sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {pane === "inventory" && (
          <DataGridPro
            rows={inventoryRows}
            columns={inventoryColumns}
            loading={loading}
            rowCount={inventoryCount}
            pagination
            paginationMode="server"
            paginationModel={inventoryPagination}
            onPaginationModelChange={setInventoryPagination}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            sortingMode="server"
            sortModel={inventorySort}
            onSortModelChange={setInventorySort}
            density="compact"
            rowHeight={36}
            disableColumnFilter
            disableRowSelectionOnClick
            pinnedColumns={{ left: ["is_present", "display_name"], right: ["actions"] }}
            onRowDoubleClick={({ row }) => showDetails({ pane: "inventory", row })}
            slots={{ noRowsOverlay: () => <EmptyRows text="No installed application instances match this scope." /> }}
            sx={{ border: 0, height: "100%" }}
          />
        )}
        {pane === "events" && (
          <DataGridPro
            rows={eventRows}
            columns={eventColumns}
            loading={loading}
            rowCount={eventCount}
            pagination
            paginationMode="server"
            paginationModel={eventPagination}
            onPaginationModelChange={setEventPagination}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            sortingMode="server"
            sortModel={eventSort}
            onSortModelChange={setEventSort}
            density="compact"
            rowHeight={36}
            disableColumnFilter
            disableRowSelectionOnClick
            pinnedColumns={{ left: ["timestamp_ms"], right: ["actions"] }}
            onRowDoubleClick={({ row }) => showDetails({ pane: "events", row })}
            slots={{ noRowsOverlay: () => <EmptyRows text="No installation events match this scope." /> }}
            sx={{ border: 0, height: "100%" }}
          />
        )}
        {pane === "observations" && (
          <DataGridPro
            rows={observationRows}
            columns={observationColumns}
            loading={loading}
            rowCount={observationCount}
            pagination
            paginationMode="server"
            paginationModel={observationPagination}
            onPaginationModelChange={setObservationPagination}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            sortingMode="server"
            sortModel={observationSort}
            onSortModelChange={setObservationSort}
            density="compact"
            rowHeight={36}
            disableColumnFilter
            disableRowSelectionOnClick
            pinnedColumns={{ left: ["display_name"], right: ["actions"] }}
            onRowDoubleClick={({ row }) => showDetails({ pane: "observations", row })}
            slots={{ noRowsOverlay: () => <EmptyRows text="No application observations match this scope." /> }}
            sx={{ border: 0, height: "100%" }}
          />
        )}
      </Paper>

      <Drawer
        anchor="right"
        open={selected != null}
        onClose={() => setSelected(null)}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 680 }, p: 0 } } }}
      >
        <Stack direction="row" sx={{ px: 2, py: 1.15, alignItems: "center", justifyContent: "space-between" }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap>
              {selectedRow?.display_name ?? selectedRow?.bundle_id ?? "Application observation"}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {selectedRow?.application_path ?? selectedRow?.source_path ?? "No path recorded"}
            </Typography>
          </Box>
          <IconButton aria-label="Close details" onClick={() => setSelected(null)}>
            <CloseIcon />
          </IconButton>
        </Stack>
        <Divider />
        <Tabs value={detailTab} onChange={(_event, value: number) => setDetailTab(value)} sx={{ px: 1 }}>
          <Tab label="Summary" />
          {isInventoryDetail && <Tab label={`Corroboration (${corroborationCount.toLocaleString()})`} />}
          <Tab label="Raw JSON" />
        </Tabs>
        <Divider />
        <Box sx={{ p: 2, overflow: "auto", flex: 1 }}>
          {detailTab === 0 && selectedRow && (
            <Stack spacing={1.1}>
              {isInventoryDetail && selected?.pane === "inventory" && (
                <Alert severity={selected.row.is_present ? "success" : "warning"} variant="outlined">
                  {selected.row.is_present
                    ? selected.row.platform === "iOS"
                      ? "Current presence is anchored by a direct-root iOS application bundle manifest."
                      : "Current presence is anchored by a filesystem macOS application bundle manifest; its placement may be primary, embedded or a standalone copy."
                    : "No present bundle manifest matched this identifier; this inventory entry is synthesized from corroborating evidence."}
                </Alert>
              )}
              {isInventoryDetail && selected?.pane === "inventory" && selected.row.bundle_id && (
                <Alert severity="info" variant="outlined">
                  Corroboration uses exact identifier text only. Matching package or container identifiers are source observations, not independently verified application identity.
                </Alert>
              )}
              <DetailLine label="Platform" value={selectedRow.platform} />
              <DetailLine label="Identifier" value={selectedRow.bundle_id} mono />
              <DetailLine label="Version" value={selectedRow.version} />
              <DetailLine label="Build" value={selectedRow.build_version} />
              <DetailLine label="Executable" value={selectedRow.executable} mono />
              <DetailLine label="Team ID" value={selectedRow.team_id} mono />
              <DetailLine label="Class" value={selectedRow.install_type} />
              <DetailLine label="State" value={selectedRow.state} />
              <DetailLine label="Observation kind" value={selectedRow.object_kind} mono />
              <DetailLine label="Parser" value={selectedRow.parser} mono />
              <DetailLine label="Application path" value={selectedRow.application_path} mono />
              <DetailLine label="Source path" value={selectedRow.source_path} mono />
              <DetailLine label="Artifact source" value={selectedRow.source_artifact_name} />
              <DetailLine label="Time" value={selectedRow.timestamp_label} />
              <DetailLine label="Time basis" value={selectedRow.time_basis} />
              <DetailLine label="Source file size" value={formatBytes(selectedRow.file_size)} />
              <Stack direction="row" spacing={1} sx={{ pt: 0.5 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<VisibilityOutlinedIcon />}
                  disabled={
                    selectedRow.file_id == null ||
                    selectedRow.fs_identifier == null ||
                    selectedRow.file_size == null ||
                    !selectedRow.file_path
                  }
                  onClick={() => void openSourceFile(evidenceId, partitionId, selectedRow).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}
                >
                  Open Source File
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<FolderOpenOutlinedIcon />}
                  disabled={selectedRow.file_id == null}
                  onClick={() => selectedRow.file_id != null && onRevealFile(selectedRow.file_id)}
                >
                  Reveal in Files
                </Button>
              </Stack>
            </Stack>
          )}
          {isInventoryDetail && detailTab === 1 && (
            <Stack spacing={1}>
              <Alert severity="info" variant="outlined">
                These records share the exact normalized identifier text and platform. This is corroboration, not semantic identity proof. App-group containers are intentionally excluded.
              </Alert>
              {corroborationLoading && <Typography color="text.secondary">Loading corroborating observations…</Typography>}
              {!corroborationLoading && corroboration.length === 0 && <Typography color="text.secondary">No corroborating observations.</Typography>}
              {corroboration.map((item) => (
                <Box key={item.id} component="details" sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1 }}>
                  <Box component="summary" sx={{ cursor: "pointer" }}>
                    <Typography component="span" variant="body2">{item.parser}</Typography>
                    <Typography component="span" variant="caption" color="text.secondary"> · {item.object_kind} · {item.source_path ?? "no source path"}</Typography>
                  </Box>
                  <Box component="pre" sx={{ m: 0, mt: 1, p: 1, bgcolor: "background.default", borderRadius: 1, overflow: "auto", fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {prettyJson(item.json)}
                  </Box>
                </Box>
              ))}
              {corroborationCount > corroboration.length && (
                <Typography variant="caption" color="text.secondary">
                  Showing the first {corroboration.length.toLocaleString()} of {corroborationCount.toLocaleString()} observations. Use the Observations pane to inspect the full server-paged set.
                </Typography>
              )}
            </Stack>
          )}
          {detailTab === (isInventoryDetail ? 2 : 1) && (
            <Stack spacing={1}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ContentCopyOutlinedIcon />}
                sx={{ alignSelf: "flex-end" }}
                onClick={() => void navigator.clipboard.writeText(selectedRaw)}
              >
                Copy JSON
              </Button>
              <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: "background.default", borderRadius: 1, overflow: "auto", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {selectedRaw}
              </Box>
            </Stack>
          )}
        </Box>
      </Drawer>
    </Box>
  );
}

function EmptyRows({ text }: { text: string }) {
  return (
    <Stack sx={{ height: "100%", alignItems: "center", justifyContent: "center" }}>
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
    </Stack>
  );
}

function DetailLine({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: unknown;
  mono?: boolean;
}) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "150px minmax(0, 1fr)", gap: 1.5 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ wordBreak: "break-word", fontFamily: mono ? "monospace" : undefined }}
      >
        {String(value ?? "—")}
      </Typography>
    </Box>
  );
}
