import { getMainDb } from "../dbutils/db";
import type {
  ExternalApplication,
  ExternalApplicationInput,
  ExternalApplicationOpenMode,
} from "./types";

type ExternalApplicationRow = {
  id: number;
  name: string;
  description: string;
  url: string;
  open_mode: ExternalApplicationOpenMode;
  allow_insecure_http: number;
  enabled: number;
  show_dashboard: number;
  show_sidebar: number;
  icon_data_url: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function fromRow(row: ExternalApplicationRow): ExternalApplication {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    url: row.url,
    openMode: row.open_mode,
    allowInsecureHttp: row.allow_insecure_http === 1,
    enabled: row.enabled === 1,
    showDashboard: row.show_dashboard === 1,
    showSidebar: row.show_sidebar === 1,
    iconDataUrl: row.icon_data_url,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listExternalApplications(): Promise<ExternalApplication[]> {
  const database = await getMainDb();
  const rows = await database.select<ExternalApplicationRow[]>(
    `SELECT id, name, description, url, open_mode, allow_insecure_http,
            enabled, show_dashboard, show_sidebar, icon_data_url, sort_order,
            created_at, updated_at
       FROM external_applications
      ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC`,
  );
  return rows.map(fromRow);
}

function inputParameters(input: ExternalApplicationInput): unknown[] {
  return [
    input.name.trim(),
    input.description.trim(),
    input.url.trim(),
    input.openMode,
    Number(input.allowInsecureHttp),
    Number(input.enabled),
    Number(input.showDashboard),
    Number(input.showSidebar),
    input.iconDataUrl,
  ];
}

export async function createExternalApplication(
  input: ExternalApplicationInput,
): Promise<void> {
  const database = await getMainDb();
  await database.execute(
    `INSERT INTO external_applications (
       name, description, url, open_mode, allow_insecure_http, enabled,
       show_dashboard, show_sidebar, icon_data_url, sort_order
     )
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9,
            COALESCE(MAX(sort_order), -1) + 1
       FROM external_applications`,
    inputParameters(input),
  );
}

export async function updateExternalApplication(
  id: number,
  input: ExternalApplicationInput,
): Promise<void> {
  const database = await getMainDb();
  const result = await database.execute(
    `UPDATE external_applications
        SET name = $1,
            description = $2,
            url = $3,
            open_mode = $4,
            allow_insecure_http = $5,
            enabled = $6,
            show_dashboard = $7,
            show_sidebar = $8,
            icon_data_url = $9,
            updated_at = datetime('now')
      WHERE id = $10`,
    [...inputParameters(input), id],
  );
  if (result.rowsAffected !== 1) {
    throw new Error("The external application no longer exists.");
  }
}

export async function deleteExternalApplication(id: number): Promise<void> {
  const database = await getMainDb();
  const result = await database.execute(
    "DELETE FROM external_applications WHERE id = $1",
    [id],
  );
  if (result.rowsAffected !== 1) {
    throw new Error("The external application no longer exists.");
  }
}
