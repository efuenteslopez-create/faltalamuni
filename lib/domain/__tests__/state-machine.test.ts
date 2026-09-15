import { describe, it, expect } from "vitest";
import {
  assertTransition,
  canTransition,
  allowedTransitions,
  findRule,
} from "@/lib/domain/state-machine";
import { DomainError } from "@/lib/domain/types";

function codeOf(fn: () => void): string | null {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return null;
}

describe("máquina de estados", () => {
  it("permite recepción institucional válida", () => {
    expect(
      codeOf(() =>
        assertTransition("AWAITING_RESPONSE", "ACKNOWLEDGED", "MUNICIPAL_AGENT")
      )
    ).toBeNull();
  });

  it("rechaza transiciones no listadas", () => {
    expect(
      codeOf(() =>
        assertTransition("ACKNOWLEDGED", "VERIFIED_RESOLVED", "RESIDENT")
      )
    ).toBe("INVALID_TRANSITION");
    expect(canTransition("ACKNOWLEDGED", "VERIFIED_RESOLVED")).toBe(false);
  });

  it("exige fundamento público cuando la regla lo pide", () => {
    expect(
      codeOf(() => assertTransition("TRIAGED", "REFERRED", "MUNICIPAL_AGENT"))
    ).toBe("REASON_REQUIRED");
    expect(
      codeOf(() =>
        assertTransition("TRIAGED", "REFERRED", "MUNICIPAL_AGENT", {
          reason: "Competencia de la sanitaria",
        })
      )
    ).toBeNull();
  });

  it("exige evidencia para informar solución", () => {
    expect(
      codeOf(() =>
        assertTransition("IN_PROGRESS", "SOLUTION_PROPOSED", "MUNICIPAL_AGENT")
      )
    ).toBe("EVIDENCE_REQUIRED");
    expect(
      codeOf(() =>
        assertTransition("IN_PROGRESS", "SOLUTION_PROPOSED", "MUNICIPAL_AGENT", {
          hasEvidence: true,
        })
      )
    ).toBeNull();
  });

  it("PRUEBA CLAVE: ningún rol institucional puede verificar directamente", () => {
    for (const role of [
      "MUNICIPAL_AGENT",
      "MUNICIPAL_MANAGER",
      "EXTERNAL_AGENCY_AGENT",
    ] as const) {
      expect(
        codeOf(() =>
          assertTransition("AWAITING_VERIFICATION", "VERIFIED_RESOLVED", role)
        )
      ).toBe("FORBIDDEN_TRANSITION");
    }
  });

  it("la verificación solo la ejecuta el sistema tras el quórum ciudadano", () => {
    // Iteración 1: NINGÚN rol humano puede transicionar directo a
    // VERIFIED_RESOLVED —ni ciudadanía, ni moderación, ni administración.
    for (const role of [
      "RESIDENT",
      "VERIFIED_RESIDENT",
      "INDEPENDENT_MODERATOR",
      "PLATFORM_ADMIN",
      "MUNICIPAL_AGENT",
      "MUNICIPAL_MANAGER",
      "EXTERNAL_AGENCY_AGENT",
    ] as const) {
      expect(
        codeOf(() =>
          assertTransition("AWAITING_VERIFICATION", "VERIFIED_RESOLVED", role)
        )
      ).toBe("FORBIDDEN_TRANSITION");
    }
    // Solo el actor interno SYSTEM (quórum evaluado en la transacción del voto).
    expect(
      codeOf(() =>
        assertTransition("AWAITING_VERIFICATION", "VERIFIED_RESOLVED", "SYSTEM")
      )
    ).toBeNull();
    // Reapertura exige fundamento
    expect(
      codeOf(() =>
        assertTransition("AWAITING_VERIFICATION", "REOPENED", "RESIDENT")
      )
    ).toBe("REASON_REQUIRED");
    expect(
      codeOf(() =>
        assertTransition("AWAITING_VERIFICATION", "REOPENED", "RESIDENT", {
          reason: "Sigue igual",
        })
      )
    ).toBeNull();
  });

  it("la moderación puede ocultar desde estados no terminales con fundamento", () => {
    const rule = findRule("IN_PROGRESS", "HIDDEN_BY_MODERATION");
    expect(rule?.requiresReason).toBe(true);
    expect(
      codeOf(() =>
        assertTransition(
          "IN_PROGRESS",
          "HIDDEN_BY_MODERATION",
          "INDEPENDENT_MODERATOR",
          { reason: "Contenido inapropiado" }
        )
      )
    ).toBeNull();
    // Pero no desde un estado terminal
    expect(canTransition("VERIFIED_RESOLVED", "HIDDEN_BY_MODERATION")).toBe(
      false
    );
  });

  it("allowedTransitions refleja la tabla", () => {
    expect(allowedTransitions("REPORTED")).toContain("AWAITING_RESPONSE");
    expect(allowedTransitions("AWAITING_VERIFICATION")).toEqual(
      expect.arrayContaining(["VERIFIED_RESOLVED", "REOPENED"])
    );
  });
});
