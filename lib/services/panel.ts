/**
 * FLM — Servicios del panel institucional (bandeja + exportación).
 */
import { read } from "@/lib/db/store";
import { ReportState } from "@/lib/domain/types";
import {
  Actor,
  assertCapability,
  hasCapability,
} from "@/lib/domain/permissions";
import { DomainError } from "@/lib/domain/types";
import { Referral, ReportDto } from "@/lib/domain/entities";
import { Report } from "@/lib/domain/types";
import { all, requireActor, toReportDto } from "./common";

/** Estados que requieren acción institucional en la bandeja. */
const INBOX_STATES: ReportState[] = [
  "AWAITING_RESPONSE",
  "REOPENED",
  "ACKNOWLEDGED",
  "TRIAGED",
  "ASSIGNED",
  "REFERRED",
  "IN_PROGRESS",
];

export async function getInbox(
  actor: Actor | null,
  opts: { page?: number; pageSize?: number } = {}
): Promise<{ items: ReportDto[]; total: number; page: number; pageSize: number }> {
  const a = requireActor(actor);
  const isInstitutional =
    hasCapability(a.role, "institutional.acknowledge") ||
    hasCapability(a.role, "institutional.triage") ||
    hasCapability(a.role, "institutional.progress");
  if (!isInstitutional) {
    throw new DomainError(
      "FORBIDDEN",
      "La bandeja es solo para roles institucionales"
    );
  }
  const page = opts.page ?? 1;
  const pageSize = Math.min(opts.pageSize ?? 20, 100);

  return read((db) => {
    let items = all<Report>(db, "reports").filter((r) =>
      INBOX_STATES.includes(r.state)
    );

    if (a.role === "EXTERNAL_AGENCY_AGENT") {
      // La agencia externa solo ve lo derivado a su organización.
      const orgOfAgency = new Map(
        all<{ id: string; organizationId: string }>(db, "externalAgencies").map(
          (ag) => [ag.id, ag.organizationId]
        )
      );
      const referredIds = new Set(
        all<Referral>(db, "referrals")
          .filter((x) => orgOfAgency.get(x.agencyId) === a.organizationId)
          .map((x) => x.reportId)
      );
      items = items.filter((r) => referredIds.has(r.id));
    } else {
      items = items.filter((r) => a.municipalityIds.includes(r.municipalityId));
    }

    // Los más antiguos primero: lo urgente es lo que más espera.
    items.sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));
    const total = items.length;
    const slice = items.slice((page - 1) * pageSize, page * pageSize);
    return {
      items: slice.map((r) => toReportDto(db, r, a)),
      total,
      page,
      pageSize,
    };
  });
}

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Exportación CSV de una comuna (MUNICIPAL_MANAGER, su comuna).
 * Solo columnas públicas/operativas: jamás la ubicación exacta.
 */
export async function exportReportsCsv(
  actor: Actor | null,
  municipalityId: string
): Promise<string> {
  const a = requireActor(actor);
  assertCapability(a.role, "institutional.export");
  if (!a.municipalityIds.includes(municipalityId)) {
    throw new DomainError(
      "SCOPE_FORBIDDEN",
      "Solo puedes exportar reportes de tu comuna"
    );
  }
  return read((db) => {
    const items = all<Report>(db, "reports")
      .filter((r) => r.municipalityId === municipalityId)
      .sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
    const header = [
      "code",
      "title",
      "category_id",
      "state",
      "confirmations",
      "followers",
      "public_lng",
      "public_lat",
      "created_at",
      "updated_at",
    ];
    const lines = [header.map(csvCell).join(",")];
    for (const r of items) {
      lines.push(
        [
          r.code,
          r.title,
          r.categoryId,
          r.state,
          r.confirmationsCount,
          r.followersCount,
          r.publicLocation.lng,
          r.publicLocation.lat,
          r.createdAt,
          r.updatedAt,
        ]
          .map(csvCell)
          .join(",")
      );
    }
    return lines.join("\n") + "\n";
  });
}
