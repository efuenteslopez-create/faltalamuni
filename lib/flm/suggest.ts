/**
 * FLM — Sugerencia simple de categoría por palabras clave.
 * Heurística liviana en cliente: si el texto del título/descripción contiene
 * palabras asociadas a un slug de categoría, se sugiere esa categoría.
 * El usuario siempre puede cambiarla; esto solo ahorra un clic.
 */

const KEYWORDS: Record<string, string[]> = {
  baches: ["bache", "hoyo", "hueco", "calzada", "pavimento", "asfalto", "vereda rota", "solera"],
  alumbrado: ["luz", "alumbrado", "poste", "luminaria", "oscuro", "foco", "amapola"],
  basura: ["basura", "escombro", "microbasural", "contenedor", "desecho", "reciclaje"],
  "areas-verdes": ["plaza", "pasto", "árbol", "arbol", "jardín", "jardin", "parque", "podar", "riego"],
  agua: ["agua", "alcantarilla", "inundación", "inundacion", "fuga", "cañería", "caneria", "grifo"],
  transito: ["semáforo", "semaforo", "señal", "senal", "tránsito", "transito", "lomo de toro", "paso peatonal", "ciclovía", "ciclovia"],
  seguridad: ["seguridad", "delincuencia", "robo", "iluminación", "iluminacion", "cámara", "camara"],
  ruidos: ["ruido", "molestia", "fiesta", "música", "musica", "taller"],
  animales: ["perro", "gato", "animal", "mascota", "paloma"],
  "espacio-publico": ["grafiti", "rayado", "mobiliario", "banca", "escaño", "juegos infantiles", "feria"],
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, " ");
}

/**
 * Devuelve el slug de la categoría sugerida o null.
 * Solo sugiere si el slug existe entre las categorías disponibles.
 */
export function suggestCategory(
  text: string,
  availableSlugs: string[]
): string | null {
  const hay = normalize(text);
  if (hay.trim().length < 3) return null;
  const available = new Set(availableSlugs.map((s) => s.toLowerCase()));
  let best: { slug: string; hits: number } | null = null;
  for (const [slug, words] of Object.entries(KEYWORDS)) {
    if (!available.has(slug)) continue;
    let hits = 0;
    for (const w of words) {
      if (hay.includes(normalize(w))) hits += 1;
    }
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { slug, hits };
    }
  }
  return best?.slug ?? null;
}
