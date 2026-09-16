/**
 * FLM — Extracción de IP de cliente con política explícita.
 *
 * POLÍTICA DE CONFIANZA (documentada, no implícita):
 * - En producción la app corre detrás de un proxy/reverse-proxy de confianza
 *   (el balanceador de la plataforma), que establece `X-Forwarded-For`.
 * - `X-Forwarded-For` SOLO se lee cuando `FLM_TRUST_PROXY === "true"`.
 *   Actívalo únicamente si el proxy de borde es de confianza y SOBRESCRIBE
 *   (no concatena a ciegas) la cabecera con la IP real del cliente.
 * - Con la confianza desactivada (valor por defecto, desarrollo y tests), la
 *   cabecera se IGNORA por completo: un cliente que envíe un
 *   `X-Forwarded-For` falsificado no puede elegir su bucket de rate limiting.
 *   En ese caso la IP se considera desconocida ("unknown").
 *
 * Cuando se confía en el proxy, se toma la primera IP válida de la lista
 * (la más a la izquierda). Solo se aceptan literales IPv4/IPv6 con formato
 * válido; cualquier otra cosa se descarta.
 */

const IPV4_RE = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_RE = /^[0-9a-fA-F:]{2,45}$/;

function cleanToken(token: string): string | null {
  let t = token.trim();
  // Quita corchetes de IPv6 "[::1]" y puerto final ":1234" en IPv4.
  if (t.startsWith("[") && t.endsWith("]")) t = t.slice(1, -1);
  const v4WithPort = t.match(/^(.+):\d+$/);
  if (v4WithPort && IPV4_RE.test(v4WithPort[1])) t = v4WithPort[1];
  if (IPV4_RE.test(t) || IPV6_RE.test(t)) return t;
  return null;
}

/** ¿El despliegue confía en el proxy de borde para `X-Forwarded-For`? */
export function trustProxyEnabled(): boolean {
  return process.env.FLM_TRUST_PROXY === "true";
}

/**
 * IP del cliente según la política de confianza. Retorna null cuando no se
 * puede determinar (confianza desactivada o cabecera ausente/inválida).
 * Nunca lanza.
 */
export function getClientIp(req: {
  headers: { get(name: string): string | null };
}): string | null {
  if (!trustProxyEnabled()) return null;
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return null;
  for (const token of xff.split(",")) {
    const ip = cleanToken(token);
    if (ip) return ip;
  }
  return null;
}
