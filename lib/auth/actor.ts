/**
 * FLM — Construcción del Actor a partir de la sesión.
 * El Actor es lo que los servicios reciben: rol + organización + alcance.
 */
import { read } from "@/lib/db/store";
import { Actor } from "@/lib/domain/permissions";
import { Membership, Organization, User } from "@/lib/domain/types";

/** Deriva el Actor de un usuario autenticado (vía sus memberships). */
export async function buildActor(user: User): Promise<Actor> {
  const { memberships, organizations } = await read((db) => {
    const ms = (Object.values(db.memberships) as unknown as Membership[]).filter(
      (m) => m.userId === user.id
    );
    const orgs: Organization[] = [];
    for (const m of ms) {
      const org = db.organizations[m.organizationId] as unknown as
        | Organization
        | undefined;
      if (org) orgs.push(org);
    }
    return { memberships: ms, organizations: orgs };
  });

  const municipalityIds = Array.from(
    new Set(
      organizations
        .map((o) => o.municipalityId)
        .filter((id): id is string => id !== null)
    )
  );

  return {
    id: user.id,
    role: user.role,
    organizationId: memberships[0]?.organizationId ?? null,
    municipalityIds,
    verifiedResident: user.verifiedResident,
  };
}
