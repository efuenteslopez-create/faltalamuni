/**
 * @vitest-environment jsdom
 *
 * FLM — Iteración 1 (auditoría): prueba de interfaz del timeline público.
 *
 * No basta con probar `getTimeline` (servicio): aquí se siembra el store
 * JSON, se invoca el handler REAL `GET /api/reports/[code]/timeline` con
 * un `NextRequest`, y su respuesta se entrega al componente ciudadano
 * `TimelineList` (el mismo que usa ReportDetail). Se aserta que la acción
 * municipal recibida desde el endpoint aparece efectivamente en el DOM:
 * tipo, municipalidad, descripción, fecha, estado de acreditación y
 * respaldo. Las referencias URL deben ser enlaces seguros; las notas
 * internas jamás deben mostrarse.
 */
import { describe, it, expect, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";
import {
  transact,
  newId,
  nowIso,
  CollectionName,
  Doc,
} from "@/lib/db/store";
import { GET as timelineGET } from "@/app/api/reports/[code]/timeline/route";
import {
  createReport,
  registerPublicReference,
  recordMunicipalAction,
  addInternalNote,
} from "@/lib/services/reports";
import { TimelineList } from "@/components/timeline/TimelineList";
import { TimelineItem } from "@/lib/domain/entities";
import { Actor } from "@/lib/domain/permissions";
import { freshDb, makeUser, makeActor } from "@/lib/__tests__/support";

beforeEach(() => {
  freshDb();
});

interface Seeded {
  code: string;
  paula: Actor;
  urlRef: string;
}

async function seed(): Promise<Seeded> {
  await transact((db) => {
    const t = (coll: CollectionName, doc: Doc) => {
      db[coll][doc.id] = doc;
    };
    t("municipalities", {
      id: "mun-t", name: "Pudahuel", prefix: "PUD",
      center: { lng: -70.7449, lat: -33.4378 }, createdAt: nowIso(),
    });
    t("categories", {
      id: "cat-t", slug: "basural", name: "Basural",
      icon: "trash", sensitiveLocation: false,
    });
    t("organizations", {
      id: "org-t", kind: "MUNICIPALITY", name: "Muni Pudahuel",
      shortName: "MP", verified: true, municipalityId: "mun-t", createdAt: nowIso(),
    });
  });
  const camilaU = await makeUser({ email: "camila@f.cl", displayName: "Camila", role: "RESIDENT" });
  const paulaU = await makeUser({ email: "paula@f.cl", displayName: "Paula", role: "MUNICIPAL_MANAGER" });
  await transact((db) => {
    const id = newId();
    db.memberships[id] = {
      id, userId: paulaU.id, organizationId: "org-t", role: "MUNICIPAL_MANAGER",
      createdAt: nowIso(),
    } as unknown as (typeof db.memberships)[string];
  });
  const paula = makeActor(paulaU, { organizationId: "org-t", municipalityIds: ["mun-t"] });
  const report = await createReport(makeActor(camilaU), {
    categoryId: "cat-t",
    municipalityId: "mun-t",
    title: "Microbasural en sitio eriazo",
    description: "Se acumula basura y escombros hace semanas.",
    location: { lng: -70.7489, lat: -33.4408 },
  });

  // Respaldo URL público + respaldo documento, y una acción respaldada.
  const urlRef = await registerPublicReference(paula, report.code, {
    kind: "url",
    reference: "https://muni.cl/oficios/OF-2026-1187",
    summary: "Oficio público de coordinación con la empresa eléctrica.",
  });
  await recordMunicipalAction(paula, report.code, {
    type: "EXTERNAL_COORDINATION_RECORDED",
    publicDescription: "Coordinación registrada con la empresa eléctrica.",
    evidenceRef: urlRef.id,
  });
  const docRef = await registerPublicReference(paula, report.code, {
    kind: "document",
    reference: "OF-2026-1190",
    summary: "Oficio de seguimiento semanal.",
  });
  await recordMunicipalAction(paula, report.code, {
    type: "FOLLOW_UP_RECORDED",
    publicDescription: "Seguimiento semanal realizado en terreno.",
    evidenceRef: docRef.id,
  });
  // Una nota interna que JAMÁS debe aparecer en la interfaz ciudadana.
  await addInternalNote(paula, report.code, {
    message: "nota interna secreta que nadie debe ver",
  });

  return { code: report.code, paula, urlRef: urlRef.id };
}

describe("timeline ciudadano: acción municipal desde el endpoint real", () => {
  it("la acción municipal del endpoint aparece en el DOM ciudadano", async () => {
    const { code } = await seed();

    // Handler REAL del endpoint público (sin sesión: vista ciudadana).
    const res = await timelineGET(
      new NextRequest(`http://localhost/api/reports/${code}/timeline`),
      { params: { code } }
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { ok: boolean; data: TimelineItem[] };
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.data)).toBe(true);

    // La respuesta del endpoint alimenta el componente ciudadano real.
    render(<TimelineList items={payload.data} variant="citizen" />);

    // Tipo de acción + municipalidad + descripción + acreditación.
    expect(screen.getByText("Coordinación externa acreditada")).toBeInTheDocument();
    // Ambas acciones pertenecen a la misma municipalidad.
    expect(screen.getAllByText(/Muni Pudahuel/).length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText("Coordinación registrada con la empresa eléctrica.")
    ).toBeInTheDocument();
    expect(screen.getAllByText("Respaldo verificado").length).toBeGreaterThan(0);

    // Respaldo URL: enlace seguro http/https con target y rel correctos.
    const link = screen.getByRole("link", {
      name: "https://muni.cl/oficios/OF-2026-1187",
    });
    expect(link.getAttribute("href")).toBe("https://muni.cl/oficios/OF-2026-1187");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");

    // Respaldo documento: el folio se muestra como texto, no como enlace.
    expect(screen.getByText("OF-2026-1190")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "OF-2026-1190" })
    ).not.toBeInTheDocument();

    // Las notas internas jamás aparecen.
    expect(
      screen.queryByText(/nota interna secreta/i)
    ).not.toBeInTheDocument();
  });
});
