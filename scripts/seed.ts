/**
 * FLM — Seed de demostración (`npm run seed`).
 *
 * Crea la comuna de Pudahuel, 14 categorías, organizaciones, departamentos,
 * 7 usuarios demo (password `Demo1234!`) y 9 reportes con cronologías
 * completas vía statusEvents que cubren todos los recorridos del MVP.
 *
 * Idempotente: si `mun-pudahuel` ya existe, no hace nada (salvo --reset).
 * Uso: `npm run seed` | `npm run seed -- --reset`
 *
 * NOTA: las coordenadas son puntos públicos cercanos (plazas, avenidas),
 * nunca domicilios particulares. Las "fotos" son SVGs generados, no fotos reales.
 */
import {
  Database,
  newId,
  nextSequence,
  nowIso,
  transact,
} from "@/lib/db/store";
import { createUser } from "@/lib/auth/auth";
import { audit } from "@/lib/audit";
import { formatReportCode, haversineMeters } from "@/lib/domain/geo";
import {
  Category,
  Report,
  ReportState,
  Role,
  StatusEvent,
} from "@/lib/domain/types";
import {
  ExternalAgency,
  MunicipalActionType,
  Municipality,
} from "@/lib/domain/entities";

const RESET = process.argv.includes("--reset");
const PASSWORD = "Demo1234!";

const daysAgo = (days: number, hours = 0): string =>
  new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString();

/** Placeholder visual generado (NO es una foto real). */
function svgDataUrl(label: string, bg: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">` +
    `<rect width="640" height="480" fill="${bg}"/>` +
    `<text x="320" y="230" font-family="sans-serif" font-size="52" fill="#ffffff" text-anchor="middle">${label}</text>` +
    `<text x="320" y="290" font-family="sans-serif" font-size="20" fill="#ffffff" text-anchor="middle">Imagen de demostración — FLM</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

const CATEGORIES: Array<Pick<Category, "id" | "slug" | "name" | "icon">> = [
  { id: "cat-basural", slug: "basural", name: "Basural / microbasural", icon: "trash" },
  { id: "cat-luminaria", slug: "luminaria", name: "Luminaria apagada o dañada", icon: "lamp" },
  { id: "cat-bache", slug: "bache", name: "Bache en la calzada", icon: "pothole" },
  { id: "cat-vereda", slug: "vereda", name: "Vereda en mal estado", icon: "sidewalk" },
  { id: "cat-semaforo", slug: "semaforo", name: "Semáforo defectuoso", icon: "traffic-light" },
  { id: "cat-senaletica", slug: "senaletica", name: "Señalética vial", icon: "sign" },
  { id: "cat-mobiliario", slug: "mobiliario", name: "Mobiliario urbano dañado", icon: "bench" },
  { id: "cat-arbol", slug: "arbol", name: "Árbol caído o riesgoso", icon: "tree" },
  { id: "cat-area-verde", slug: "area-verde", name: "Área verde abandonada", icon: "leaf" },
  { id: "cat-vehiculo-abandonado", slug: "vehiculo-abandonado", name: "Vehículo abandonado", icon: "car" },
  { id: "cat-fuga-agua", slug: "fuga-agua", name: "Fuga de agua", icon: "droplet" },
  { id: "cat-accesibilidad", slug: "accesibilidad", name: "Barrera de accesibilidad", icon: "accessibility" },
  { id: "cat-espacio-inseguro", slug: "espacio-inseguro", name: "Espacio público inseguro", icon: "alert" },
  { id: "cat-alcantarillado", slug: "alcantarillado", name: "Alcantarillado tapado", icon: "drain" },
];

const MUNICIPALITY: Municipality = {
  id: "mun-pudahuel",
  name: "Pudahuel",
  prefix: "PUD",
  center: { lng: -70.7449, lat: -33.4378 },
  createdAt: nowIso(),
};

// ---------------------------------------------------------------------------
// Helpers de escritura
// ---------------------------------------------------------------------------

interface SeedStep {
  to: ReportState;
  by: string | null; // userId o null (sistema)
  reason?: string;
  at: string;
}

const codeBySeq = new Map<number, { code: string; id: string }>();

async function seedReport(spec: {
  categoryId: string;
  title: string;
  description: string;
  lng: number;
  lat: number;
  authorId: string;
  createdAt: string;
  managingOrgId?: string | null;
  executorOrgId?: string | null;
  responsibleOrgId?: string | null;
  steps: SeedStep[];
}): Promise<{ code: string; id: string }> {
  const seq = await nextSequence("report-seq:PUD");
  const code = formatReportCode("PUD", seq);

  const id = await transact((db: Database) => {
    const reportId = newId();
    const report: Report = {
      id: reportId,
      code,
      municipalityId: MUNICIPALITY.id,
      categoryId: spec.categoryId,
      title: spec.title,
      description: spec.description,
      location: { lng: spec.lng, lat: spec.lat },
      publicLocation: { lng: spec.lng, lat: spec.lat },
      state: "AWAITING_RESPONSE",
      version: 1,
      authorId: spec.authorId,
      anonymousPublic: false,
      responsibleOrgId: spec.responsibleOrgId ?? null,
      managingOrgId: spec.managingOrgId ?? null,
      executorOrgId: spec.executorOrgId ?? null,
      verifierId: null,
      confirmationsCount: 0,
      followersCount: 0,
      createdAt: spec.createdAt,
      updatedAt: spec.createdAt,
    };
    db.reports[reportId] = report as unknown as (typeof db.reports)[string];

    const push = (
      from: ReportState | null,
      to: ReportState,
      actorId: string | null,
      reason: string | null,
      at: string
    ) => {
      const e: StatusEvent = {
        id: newId(),
        reportId,
        from,
        to,
        actorId,
        reason,
        idempotencyKey: null,
        createdAt: at,
      };
      db.statusEvents[e.id] = e as unknown as (typeof db.statusEvents)[string];
      report.state = to;
      report.version += 1;
      report.updatedAt = at;
    };

    push(null, "REPORTED", spec.authorId, null, spec.createdAt);
    push("REPORTED", "AWAITING_RESPONSE", null, null, spec.createdAt);
    let prev: ReportState = "AWAITING_RESPONSE";
    for (const s of spec.steps) {
      push(prev, s.to, s.by, s.reason ?? null, s.at);
      prev = s.to;
    }
    return reportId;
  });

  codeBySeq.set(seq, { code, id });
  return { code, id };
}

async function addConfirmation(reportId: string, userId: string, at: string) {
  await transact((db: Database) => {
    const id = newId();
    db.confirmations[id] = { id, reportId, userId, createdAt: at } as unknown as (typeof db.confirmations)[string];
    const r = db.reports[reportId] as unknown as Report;
    r.confirmationsCount += 1;
  });
}

async function addEvidenceMedia(
  reportId: string,
  label: string,
  bg: string,
  kind: "problem" | "solution",
  uploadedBy: string,
  at: string,
  description: string | null
) {
  await transact((db: Database) => {
    const mediaId = newId();
    const dataUrl = svgDataUrl(label, bg);
    db.reportMedia[mediaId] = {
      id: mediaId,
      reportId,
      dataUrl,
      mimeType: "image/svg+xml",
      sizeBytes: Buffer.byteLength(dataUrl, "utf8"),
      kind,
      uploadedBy,
      createdAt: at,
    } as unknown as (typeof db.reportMedia)[string];
    const evId = newId();
    db.resolutionEvidence[evId] = {
      id: evId,
      reportId,
      mediaId,
      description,
      uploadedBy,
      createdAt: at,
    } as unknown as (typeof db.resolutionEvidence)[string];
  });
}

async function addVote(
  reportId: string,
  voterId: string,
  voterRole: Role,
  approve: boolean,
  comment: string | null,
  weight: number,
  at: string
) {
  await transact((db: Database) => {
    const id = newId();
    db.verificationVotes[id] = {
      id,
      reportId,
      voterId,
      voterRole,
      approve,
      comment,
      weight,
      createdAt: at,
    } as unknown as (typeof db.verificationVotes)[string];
  });
}

/** Acción municipal acreditable (iteración 1): sustenta "Ya estuvo la Muni". */
async function addMunicipalAction(
  reportId: string,
  organizationId: string,
  actorId: string,
  type: MunicipalActionType,
  publicDescription: string,
  at: string
) {
  await transact((db: Database) => {
    const id = newId();
    db.municipalActions[id] = {
      id,
      reportId,
      organizationId,
      actorId,
      type,
      publicDescription,
      evidenceRef: null,
      createdAt: at,
    } as unknown as (typeof db.municipalActions)[string];
    const auditId = newId();
    db.auditEvents[auditId] = {
      id: auditId,
      action: "report.municipal_action",
      actorId,
      entityType: "report",
      entityId: reportId,
      detail: { type, organizationId },
      createdAt: at,
    } as unknown as (typeof db.auditEvents)[string];
  });
}

async function addReferral(
  reportId: string,
  agencyId: string,
  reason: string,
  createdBy: string,
  at: string
) {
  await transact((db: Database) => {
    const id = newId();
    db.referrals[id] = { id, reportId, agencyId, reason, createdBy, createdAt: at } as unknown as (typeof db.referrals)[string];
  });
}

async function addAssignment(
  reportId: string,
  departmentId: string,
  assignedBy: string,
  at: string
) {
  await transact((db: Database) => {
    const id = newId();
    db.assignments[id] = { id, reportId, departmentId, assignedBy, createdAt: at } as unknown as (typeof db.assignments)[string];
  });
}

async function addResponse(
  reportId: string,
  organizationId: string,
  actorId: string,
  kind: "response" | "note",
  message: string,
  at: string
) {
  await transact((db: Database) => {
    const id = newId();
    db.institutionalResponses[id] = {
      id,
      reportId,
      organizationId,
      actorId,
      kind,
      internal: kind === "note",
      message,
      createdAt: at,
    } as unknown as (typeof db.institutionalResponses)[string];
  });
}

async function addDuplicate(reportId: string, candidateReportId: string, at: string) {
  await transact((db: Database) => {
    const a = db.reports[reportId] as unknown as Report;
    const b = db.reports[candidateReportId] as unknown as Report;
    const id = newId();
    db.possibleDuplicates[id] = {
      id,
      reportId,
      candidateReportId,
      distanceMeters: Math.round(haversineMeters(a.location, b.location)),
      reason: "geo-category",
      createdAt: at,
    } as unknown as (typeof db.possibleDuplicates)[string];
  });
}

async function addReopenRequest(reportId: string, requestedBy: string, reason: string, at: string) {
  await transact((db: Database) => {
    const id = newId();
    db.reopenRequests[id] = {
      id,
      reportId,
      requestedBy,
      reason,
      status: "accepted",
      createdAt: at,
    } as unknown as (typeof db.reopenRequests)[string];
  });
}

async function addVerificationRequest(reportId: string, requestedBy: string | null, status: "open" | "resolved" | "reopened", at: string) {
  await transact((db: Database) => {
    const id = newId();
    db.verificationRequests[id] = { id, reportId, requestedBy, status, createdAt: at } as unknown as (typeof db.verificationRequests)[string];
  });
}

async function setVerifier(reportId: string, verifierId: string | null) {
  await transact((db: Database) => {
    (db.reports[reportId] as unknown as Report).verifierId = verifierId;
  });
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main() {
  const { read } = await import("@/lib/db/store");
  const existing = await read(
    (db: Database) => db.municipalities[MUNICIPALITY.id]
  );
  if (existing && !RESET) {
    console.log(
      "Seed: mun-pudahuel ya existe. Nada que hacer (usa --reset para recrear)."
    );
    return;
  }
  if (RESET) {
    await transact((db: Database) => {
      for (const coll of Object.keys(db) as Array<keyof Database>) {
        db[coll] = {};
      }
    });
    console.log("Seed: base limpiada (--reset).");
  }

  const now = nowIso();

  // Comuna + categorías
  await transact((db: Database) => {
    db.municipalities[MUNICIPALITY.id] = MUNICIPALITY as unknown as (typeof db.municipalities)[string];
    for (const c of CATEGORIES) {
      const cat: Category = {
        ...c,
        sensitiveLocation: false,
        // createdAt no es parte del contrato; se omite
      } as Category;
      db.categories[c.id] = cat as unknown as (typeof db.categories)[string];
    }
  });

  // Organizaciones
  const ORG_MUNI = "org-muni-pudahuel";
  const ORG_ELECTRICA = "org-electrica-demo";
  const ORG_SANITARIA = "org-sanitaria-demo";
  const ORG_PLATFORM = "org-plataforma-flm";
  await transact((db: Database) => {
    const orgs = [
      { id: ORG_MUNI, kind: "MUNICIPALITY", name: "Municipalidad de Pudahuel", shortName: "Muni Pudahuel", verified: true, municipalityId: MUNICIPALITY.id, createdAt: now },
      { id: ORG_ELECTRICA, kind: "EXTERNAL_AGENCY", name: "Empresa Eléctrica Demo", shortName: "Eléctrica Demo", verified: true, municipalityId: MUNICIPALITY.id, createdAt: now },
      { id: ORG_SANITARIA, kind: "EXTERNAL_AGENCY", name: "Empresa Sanitaria Demo", shortName: "Sanitaria Demo", verified: true, municipalityId: MUNICIPALITY.id, createdAt: now },
      { id: ORG_PLATFORM, kind: "PLATFORM", name: "Falta la Muni", shortName: "FLM", verified: true, municipalityId: null, createdAt: now },
    ];
    for (const o of orgs) {
      db.organizations[o.id] = o as unknown as (typeof db.organizations)[string];
    }
    const agencies: ExternalAgency[] = [
      { id: "ag-electrica", organizationId: ORG_ELECTRICA, name: "Empresa Eléctrica Demo", createdAt: now },
      { id: "ag-sanitaria", organizationId: ORG_SANITARIA, name: "Empresa Sanitaria Demo", createdAt: now },
    ];
    for (const a of agencies) {
      db.externalAgencies[a.id] = a as unknown as (typeof db.externalAgencies)[string];
    }
    const depts = [
      { id: "dep-aseo", name: "Aseo y Ornato" },
      { id: "dep-alumbrado", name: "Alumbrado Público" },
      { id: "dep-obras", name: "Obras Municipales" },
      { id: "dep-transito", name: "Tránsito" },
    ];
    for (const d of depts) {
      db.departments[d.id] = {
        id: d.id,
        name: d.name,
        municipalityId: MUNICIPALITY.id,
        organizationId: ORG_MUNI,
        createdAt: now,
      } as unknown as (typeof db.departments)[string];
    }
  });

  // Usuarios demo
  const users: Array<{ email: string; name: string; role: Role; verified: boolean; orgId: string | null }> = [
    { email: "vecina@demo.flm", name: "Camila Rojas", role: "RESIDENT", verified: false, orgId: null },
    { email: "vecino.verificado@demo.flm", name: "Jorge Paredes", role: "VERIFIED_RESIDENT", verified: true, orgId: null },
    { email: "agente@demo.flm", name: "Ana Agente", role: "MUNICIPAL_AGENT", verified: false, orgId: ORG_MUNI },
    { email: "gestora@demo.flm", name: "Paula Gestora", role: "MUNICIPAL_MANAGER", verified: false, orgId: ORG_MUNI },
    { email: "externo@demo.flm", name: "Pedro Externo", role: "EXTERNAL_AGENCY_AGENT", verified: false, orgId: ORG_ELECTRICA },
    { email: "moderacion@demo.flm", name: "Marta Moderadora", role: "INDEPENDENT_MODERATOR", verified: false, orgId: ORG_PLATFORM },
    { email: "admin@demo.flm", name: "Admin Plataforma", role: "PLATFORM_ADMIN", verified: false, orgId: ORG_PLATFORM },
  ];
  const userIds: Record<string, string> = {};
  for (const u of users) {
    const created = await createUser({
      email: u.email,
      password: PASSWORD,
      displayName: u.name,
      role: u.role,
    });
    userIds[u.email] = created.id;
    await transact((db: Database) => {
      const doc = db.users[created.id] as unknown as { verifiedResident: boolean };
      doc.verifiedResident = u.verified;
      if (u.orgId) {
        const mid = newId();
        db.memberships[mid] = {
          id: mid,
          userId: created.id,
          organizationId: u.orgId,
          role: u.role,
          createdAt: now,
        } as unknown as (typeof db.memberships)[string];
      }
    });
  }
  const U = (email: string) => userIds[email];
  const CAMILA = U("vecina@demo.flm");
  const JORGE = U("vecino.verificado@demo.flm");
  const ANA = U("agente@demo.flm");
  const PAULA = U("gestora@demo.flm");

  // ---- R1: microbasural pendiente (AWAITING_RESPONSE) -----------------------
  const r1 = await seedReport({
    categoryId: "cat-basural",
    title: "Microbasural en sitio eriazo",
    description:
      "Hace dos semanas se acumula basura y escombros en el sitio eriazo. Hay mal olor y presencia de vectores. Pasa el camión pero no alcanza.",
    lng: -70.7489,
    lat: -33.4408,
    authorId: CAMILA,
    createdAt: daysAgo(2),
    steps: [],
  });
  await addConfirmation(r1.id, JORGE, daysAgo(1));

  // ---- R2: luminaria derivada a eléctrica (REFERRED) ------------------------
  const r2 = await seedReport({
    categoryId: "cat-luminaria",
    title: "Poste sin luz hace un mes",
    description:
      "El poste de la esquina lleva un mes apagado. La cuadra queda a oscuras y los vecinos reportan asaltos.",
    lng: -70.739,
    lat: -33.434,
    authorId: JORGE,
    createdAt: daysAgo(12),
    managingOrgId: ORG_MUNI,
    executorOrgId: ORG_ELECTRICA,
    steps: [
      { to: "ACKNOWLEDGED", by: ANA, at: daysAgo(11) },
      { to: "TRIAGED", by: ANA, at: daysAgo(10) },
      {
        to: "REFERRED",
        by: PAULA,
        reason: "Corresponde a la empresa eléctrica concesionaria del sector.",
        at: daysAgo(9),
      },
    ],
  });
  await addReferral(r2.id, "ag-electrica", "Red de alumbrado concesionada.", PAULA, daysAgo(9));
  await addResponse(r2.id, ORG_MUNI, ANA, "response", "Recibimos tu reporte. Lo estamos evaluando para su derivación.", daysAgo(11));
  await addResponse(r2.id, ORG_MUNI, ANA, "note", "Derivado a Eléctrica Demo. Seguimiento semanal hasta la reposición.", daysAgo(9));

  // ---- R3: bache recibido (ACKNOWLEDGED) ------------------------------------
  const r3 = await seedReport({
    categoryId: "cat-bache",
    title: "Bache profundo frente al paradero",
    description:
      "Bache de unos 40 cm frente al paradero. Los autos lo esquivan invadiendo la pista contraria.",
    lng: -70.752,
    lat: -33.433,
    authorId: CAMILA,
    createdAt: daysAgo(5),
    managingOrgId: ORG_MUNI,
    steps: [{ to: "ACKNOWLEDGED", by: ANA, at: daysAgo(4) }],
  });
  await addResponse(r3.id, ORG_MUNI, ANA, "response", "Recibimos tu reporte; será evaluado en terreno esta semana.", daysAgo(4));
  await addConfirmation(r3.id, JORGE, daysAgo(4));

  // ---- R4: área verde en trabajo (IN_PROGRESS) -------------------------------
  const r4 = await seedReport({
    categoryId: "cat-area-verde",
    title: "Plaza sin mantención",
    description:
      "La plaza lleva meses sin corte de pasto ni riego. Los juegos están oxidados y hay basura entre los arbustos.",
    lng: -70.736,
    lat: -33.442,
    authorId: JORGE,
    createdAt: daysAgo(15),
    managingOrgId: ORG_MUNI,
    steps: [
      { to: "ACKNOWLEDGED", by: ANA, at: daysAgo(14) },
      { to: "TRIAGED", by: ANA, at: daysAgo(13) },
      { to: "ASSIGNED", by: PAULA, at: daysAgo(12) },
      { to: "IN_PROGRESS", by: ANA, at: daysAgo(8) },
    ],
  });
  await addAssignment(r4.id, "dep-aseo", PAULA, daysAgo(12));
  await addResponse(r4.id, ORG_MUNI, ANA, "response", "Cuadrilla de Aseo y Ornato en terreno desde esta semana.", daysAgo(8));

  // ---- R5: señalética con solución informada (AWAITING_VERIFICATION) ---------
  const r5 = await seedReport({
    categoryId: "cat-senaletica",
    title: "Señalética de pare caída",
    description:
      "La señal de pare de la intersección está caída desde el choque de la semana pasada. Los autos no respetan la preferencia.",
    lng: -70.755,
    lat: -33.437,
    authorId: CAMILA,
    createdAt: daysAgo(20),
    managingOrgId: ORG_MUNI,
    steps: [
      { to: "ACKNOWLEDGED", by: ANA, at: daysAgo(19) },
      { to: "TRIAGED", by: ANA, at: daysAgo(18) },
      { to: "ASSIGNED", by: PAULA, at: daysAgo(17) },
      { to: "IN_PROGRESS", by: ANA, at: daysAgo(12) },
      { to: "SOLUTION_PROPOSED", by: ANA, at: daysAgo(6) },
      { to: "AWAITING_VERIFICATION", by: null, at: daysAgo(6, 1) },
    ],
  });
  await addAssignment(r5.id, "dep-transito", PAULA, daysAgo(17));
  await addEvidenceMedia(r5.id, "DESPUÉS", "#1d6f42", "solution", ANA, daysAgo(6), "Señalética repuesta y pintada.");
  await addVerificationRequest(r5.id, ANA, "open", daysAgo(6, 1));
  await addResponse(r5.id, ORG_MUNI, ANA, "response", "Se repuso la señalética. Queda abierta a verificación vecinal.", daysAgo(6));

  // ---- R6: basural retirado y verificado (VERIFIED_RESOLVED, sello) ----------
  const r6 = await seedReport({
    categoryId: "cat-basural",
    title: "Basural clandestino en bandejón",
    description:
      "En el bandejón se formó un basural clandestino: colchones, escombros y basura domiciliaria. Urge retiro y fiscalización.",
    lng: -70.742,
    lat: -33.439,
    authorId: CAMILA,
    createdAt: daysAgo(25),
    managingOrgId: ORG_MUNI,
    steps: [
      { to: "ACKNOWLEDGED", by: ANA, at: daysAgo(24) },
      { to: "TRIAGED", by: ANA, at: daysAgo(23) },
      { to: "ASSIGNED", by: PAULA, at: daysAgo(22) },
      { to: "IN_PROGRESS", by: ANA, at: daysAgo(18) },
      { to: "SOLUTION_PROPOSED", by: ANA, at: daysAgo(10) },
      { to: "AWAITING_VERIFICATION", by: null, at: daysAgo(10, 1) },
      { to: "VERIFIED_RESOLVED", by: JORGE, at: daysAgo(3) },
    ],
  });
  await addAssignment(r6.id, "dep-aseo", PAULA, daysAgo(22));
  await addEvidenceMedia(r6.id, "ANTES", "#6b4f2a", "problem", CAMILA, daysAgo(25), "Estado del bandejón al reportar.");
  await addEvidenceMedia(r6.id, "DESPUÉS", "#1d6f42", "solution", ANA, daysAgo(10), "Bandejón limpio y con cierre perimetral.");
  await addVote(r6.id, CAMILA, "RESIDENT", true, "Pasé hoy y está limpio. ¡Gracias!", 2, daysAgo(4));
  await addVote(r6.id, JORGE, "VERIFIED_RESIDENT", true, "Confirmo: retiraron todo el escombro.", 1, daysAgo(3));
  // Acción municipal acreditable ANTES de la solución informada (daysAgo(10)):
  // es lo que sustenta el sello "Ya estuvo la Muni" (iteración 1).
  await addMunicipalAction(
    r6.id,
    ORG_MUNI,
    ANA,
    "FIELD_WORK_RECORDED",
    "Cuadrilla municipal retiró el basural e instaló cierre perimetral.",
    daysAgo(12)
  );
  // Auditoría de la resolución por quórum ciudadano (vía A: autora + vecino verificado).
  await transact((db: Database) => {
    const id = newId();
    db.auditEvents[id] = {
      id,
      action: "report.verification_resolved",
      actorId: null,
      entityType: "report",
      entityId: r6.id,
      detail: {
        code: r6.code,
        via: "author-plus-neighbor",
        approvingVoterIds: [CAMILA, JORGE],
      },
      createdAt: daysAgo(3),
    } as unknown as (typeof db.auditEvents)[string];
  });
  await addVerificationRequest(r6.id, ANA, "resolved", daysAgo(10, 1));
  await addConfirmation(r6.id, JORGE, daysAgo(20));
  await addResponse(r6.id, ORG_MUNI, ANA, "response", "Retiro completado por cuadrilla municipal. Se instaló cierre perimetral.", daysAgo(10));

  // ---- R7: caso reabierto (REOPENED) -----------------------------------------
  const r7 = await seedReport({
    categoryId: "cat-vereda",
    title: "Vereda hundida",
    description:
      "La vereda se hundió frente al local. Adultos mayores han tropezado; se necesita reparación urgente.",
    lng: -70.747,
    lat: -33.435,
    authorId: JORGE,
    createdAt: daysAgo(30),
    managingOrgId: ORG_MUNI,
    steps: [
      { to: "ACKNOWLEDGED", by: ANA, at: daysAgo(29) },
      { to: "TRIAGED", by: ANA, at: daysAgo(28) },
      { to: "ASSIGNED", by: PAULA, at: daysAgo(27) },
      { to: "IN_PROGRESS", by: ANA, at: daysAgo(20) },
      { to: "SOLUTION_PROPOSED", by: ANA, at: daysAgo(14) },
      { to: "AWAITING_VERIFICATION", by: null, at: daysAgo(14, 1) },
      {
        to: "REOPENED",
        by: JORGE,
        reason: "La vereda se volvió a hundir con la lluvia de esta semana.",
        at: daysAgo(5),
      },
    ],
  });
  await addAssignment(r7.id, "dep-obras", PAULA, daysAgo(27));
  await addEvidenceMedia(r7.id, "DESPUÉS", "#1d6f42", "solution", ANA, daysAgo(14), "Reparación inicial.");
  await addReopenRequest(r7.id, JORGE, "La vereda se volvió a hundir con la lluvia de esta semana.", daysAgo(5));
  await addVerificationRequest(r7.id, ANA, "reopened", daysAgo(14, 1));

  // ---- R8: reporte duplicado de R1 (possibleDuplicates) ----------------------
  const r8 = await seedReport({
    categoryId: "cat-basural",
    title: "Basura acumulada en sitio eriazo",
    description:
      "Mucha basura acumulada en el sitio eriazo, al parecer el mismo que reportó otra vecina.",
    lng: -70.7485,
    lat: -33.4405,
    authorId: JORGE,
    createdAt: daysAgo(1),
    steps: [],
  });
  await addDuplicate(r8.id, r1.id, daysAgo(1));

  // ---- R9: fuga de agua derivada a sanitaria, gestionada por la muni ---------
  const r9 = await seedReport({
    categoryId: "cat-fuga-agua",
    title: "Fuga de agua en la vereda",
    description:
      "Sale agua limpia a presión por una grieta de la vereda. Lleva tres días y se está socavando el pavimento.",
    lng: -70.75,
    lat: -33.444,
    authorId: CAMILA,
    createdAt: daysAgo(9),
    managingOrgId: ORG_MUNI,
    executorOrgId: ORG_SANITARIA,
    steps: [
      { to: "ACKNOWLEDGED", by: ANA, at: daysAgo(8) },
      { to: "TRIAGED", by: ANA, at: daysAgo(8, 2) },
      {
        to: "REFERRED",
        by: PAULA,
        reason:
          "La red de agua potable es competencia de la empresa sanitaria; la municipalidad hará seguimiento.",
        at: daysAgo(7),
      },
      { to: "IN_PROGRESS", by: ANA, at: daysAgo(6) },
    ],
  });
  await addReferral(r9.id, "ag-sanitaria", "Fuga en red de agua potable.", PAULA, daysAgo(7));
  await addResponse(r9.id, ORG_MUNI, ANA, "response", "Derivado a la sanitaria. La municipalidad hace seguimiento diario.", daysAgo(7));

  await audit({
    action: "seed.run",
    actorId: null,
    entityType: "seed",
    entityId: "pudahuel-demo",
    detail: {
      reports: [r1.code, r2.code, r3.code, r4.code, r5.code, r6.code, r7.code, r8.code, r9.code],
    },
  });

  console.log("Seed OK — 9 reportes demo en Pudahuel:");
  for (const r of [r1, r2, r3, r4, r5, r6, r7, r8, r9]) {
    console.log(`  ${r.code}`);
  }
  console.log("Usuarios demo en scripts/seed-users.md (password: Demo1234!).");
}

main().catch((err) => {
  console.error("Seed falló:", err);
  process.exit(1);
});
