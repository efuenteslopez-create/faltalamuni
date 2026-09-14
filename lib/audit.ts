/**
 * FLM — Auditoría append-only (spec §2, §11).
 * Toda acción sensible escribe aquí. Nada se borra ni se edita.
 */
import { transact, newId, nowIso } from "@/lib/db/store";
import { AuditEvent } from "@/lib/domain/types";

export async function audit(input: {
  action: string;
  actorId: string | null;
  entityType: string;
  entityId: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const event: AuditEvent = {
    id: newId(),
    action: input.action,
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId,
    detail: input.detail ?? {},
    createdAt: nowIso(),
  };
  await transact((db) => {
    db.auditEvents[event.id] = event as unknown as Record<string, unknown> & { id: string };
  });
}
