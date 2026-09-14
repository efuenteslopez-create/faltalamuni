import { describe, expect, it } from "vitest";
import { suggestCategory } from "./suggest";
import { newDraft } from "./draft";

describe("suggestCategory", () => {
  const slugs = ["baches", "alumbrado", "basura", "areas-verdes", "agua"];

  it("sugiere baches cuando el texto habla de un hoyo en la calzada", () => {
    expect(
      suggestCategory("Hay un hoyo enorme en la calzada frente a mi casa", slugs)
    ).toBe("baches");
  });

  it("sugiere alumbrado cuando el texto habla de un poste sin luz", () => {
    expect(suggestCategory("El poste de la esquina está sin luz hace días", slugs)).toBe(
      "alumbrado"
    );
  });

  it("ignora tildes y mayúsculas", () => {
    expect(suggestCategory("INUNDACIÓN en el pasaje por la lluvia", slugs)).toBe("agua");
  });

  it("no sugiere categorías que no están disponibles", () => {
    expect(suggestCategory("Hay un bache gigante", ["basura"])).toBeNull();
  });

  it("devuelve null con texto muy corto o sin coincidencias", () => {
    expect(suggestCategory("hola", slugs)).toBeNull();
    expect(suggestCategory("todo bien por aquí", slugs)).toBeNull();
  });
});

describe("newDraft", () => {
  it("genera una idempotencyKey única por borrador", () => {
    const a = newDraft();
    const b = newDraft();
    expect(a.idempotencyKey).toBeTruthy();
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });
});
