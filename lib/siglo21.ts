// Réplica del flujo get-price-v4/v5 del lambda siglo21-price-proxy, con fines de
// diagnóstico: en lugar de retornar solo el precio o un error, registra cada
// paso (URL, status HTTP, respuesta cruda, duración) para que se pueda ver
// exactamente dónde y por qué falló la consulta contra la API de Siglo 21.
// Para ED/EHD también replica la selección del período activo del lambda
// (tabla hardcodeada + regla de extensión del ticket HF-0113) y marca cada
// período como principal o alternativo, igual que lo vería el bot.

// Configurable por env var para apuntar a otros entornos (ej. QA:
// https://price-simulator-facade-qa.uesiglo21.edu.ar/api/v1). Default: prod.
const BASE_URL =
  process.env.SIGLO21_BASE_URL ??
  "https://price-simulator-facade.uesiglo21.edu.ar/api/v1";
const AUTH_URL =
  process.env.SIGLO21_AUTH_URL ?? "https://auth.ues21.edu.ar/menu/api/oauth2/token";
const REQUEST_TIMEOUT_MS = 10_000; // mismo timeout que el lambda (http.Client{Timeout: 10s})

// ── Tipos de entrada ──────────────────────────────────────────────────────────

export interface PricingInput {
  cau_id?: unknown;
  modality_id?: unknown;
  program_id?: unknown;
}

// ── Tipos de diagnóstico ──────────────────────────────────────────────────────

export type StepStatus = "ok" | "fail" | "skipped" | "warning";

export interface StepResult {
  id: string;
  title: string;
  status: StepStatus;
  method?: string;
  url?: string;
  httpStatus?: number;
  durationMs?: number;
  /** Respuesta cruda de la API de Siglo 21 (truncada si es muy larga) */
  rawResponse?: string;
  /** Explicación en español de qué pasó en este paso */
  detail: string;
}

export interface PeriodPriceResult {
  periodName: string;
  subPeriod: string;
  periodId: number;
  subPeriodId: number;
  url: string;
  ok: boolean;
  httpStatus?: number;
  durationMs: number;
  total?: number;
  totalListPrice?: number;
  totalDiscounts?: number;
  rawResponse?: string;
  errorDetail?: string;
  /** Rol que le asigna el lambda (ED/EHD): principal visible o alternativo oculto */
  role?: "primary" | "alternative";
  /** Clave del bimestre en la tabla hardcodeada del lambda (ej: "2A/26") */
  periodKey?: string;
  /** Nombre legible del período según la tabla del lambda (ej: "agosto 2026") */
  periodLabel?: string;
  /** Meses de cursado que abarca el período según la API (ej: "agosto 2026 a octubre 2026") */
  coverageLabel?: string;
}

export type VerdictCode =
  | "OK"
  | "OK_PARTIAL"
  | "MISSING_REQUIRED_FIELD"
  | "PRESENCIAL_MODALITY"
  | "AUTH_FAILED"
  | "NO_SCHEDULES_AVAILABLE"
  | "NO_PERIODS_AVAILABLE"
  | "PRICE_FETCH_ERROR";

export interface Verdict {
  code: VerdictCode;
  /** Código HTTP que retornaría el lambda real en este caso */
  httpEquivalent: number;
  title: string;
  /** Explicación en lenguaje claro para el equipo de CS */
  explanation: string;
  /** A quién corresponde el problema */
  responsible: "siglo21" | "config" | "comportamiento_esperado" | "nadie";
}

export interface DiagnosisResult {
  input: { cau_id: string; modality_id: number; program_id: number };
  modalityName: string;
  verdict: Verdict;
  steps: StepResult[];
  periodPrices: PeriodPriceResult[];
  turnoCode?: string;
  turnoName?: string;
  /** Clave del período activo según la tabla hardcodeada del lambda (ED/EHD) */
  primaryPeriodKey?: string;
  /** Nombre legible del período activo (ej: "agosto 2026") */
  primaryPeriodName?: string;
  totalDurationMs: number;
}

// ── Mapeos (mismos que el lambda) ─────────────────────────────────────────────

export const MODALITY_NAMES: Record<number, string> = {
  1: "DISTANCIA - ED HOME [EDH]",
  2: "DISTANCIA - EDUCACIÓN DISTRIBUIDA [ED]",
  3: "PRESENCIAL",
  5: "PRESENCIAL HOME",
  7: "PRESENCIAL HOME RÍO IV [PH - RIVO]",
  9: "PRESENCIAL",
  10: "PRESENCIAL RÍO IV",
  12: "PRESENCIAL DISTRIBUIDA [PD]",
};

const PRESENCIAL_MODALITIES = new Set([9, 10, 12]);
const ED_EHD_MODALITIES = new Set([1, 2, 3, 5]);

// CAU forzado por modalidad (igual que el lambda, forcedCauByModality): para las
// modalidades 3 y 5 el middleware usa SIEMPRE este CAU, ignorando el del request.
// Ambas cotizan con la lógica bimestral ED/EHD. Solo aplica a V4.
const FORCED_CAU_BY_MODALITY: Record<number, string> = {
  3: "C60",
  5: "C20",
};

// ── Selección del período activo ED/EHD ───────────────────────────────────────
// Réplica de la tabla hardcodeada y la regla de selección del lambda
// (pkg/services/pricing-service.go — rama fix/active-period, ticket HF-0113).
// Mantener en sync con el lambda: al inicio de cada ciclo se AGREGAN filas nuevas
// (las claves llevan el ciclo, ej. "1A/27"), no se reemplazan las vigentes.

interface BimesterPeriodInfo {
  fechaInicio: string; // inicio ventana de venta (dd/mm/yyyy)
  fechaFin: string; // fin ventana de venta oficial (dd/mm/yyyy)
  fechaExtension: string; // límite de extensión de venta (dd/mm/yyyy) — "" si no hay
  inicioClases: string; // inicio de clases (dd/mm/yyyy)
  nombre: string; // nombre legible (ej: "agosto 2026")
}

const ED_EHD_PERIODS: Record<string, BimesterPeriodInfo> = {
  "1A/26": { fechaInicio: "25/08/2025", fechaFin: "15/03/2026", fechaExtension: "29/03/2026", inicioClases: "16/03/2026", nombre: "marzo 2026" },
  "1B/26": { fechaInicio: "16/03/2026", fechaFin: "17/05/2026", fechaExtension: "31/05/2026", inicioClases: "18/05/2026", nombre: "mayo 2026" },
  "2A/26": { fechaInicio: "18/05/2026", fechaFin: "02/08/2026", fechaExtension: "16/08/2026", inicioClases: "03/08/2026", nombre: "agosto 2026" },
  "2B/26": { fechaInicio: "03/08/2026", fechaFin: "04/10/2026", fechaExtension: "18/10/2026", inicioClases: "05/10/2026", nombre: "octubre 2026" },
  "1A/27": { fechaInicio: "28/07/2026", fechaFin: "14/03/2027", fechaExtension: "", inicioClases: "15/03/2027", nombre: "marzo 2027" },
};

// Orden cronológico por inicio de clases: ante un overlap gana el primero cuya
// ventana (incluida la extensión) contiene la fecha de hoy.
const ED_EHD_PERIOD_ORDER = ["1A/26", "1B/26", "2A/26", "2B/26", "1A/27"];

function parseDdMmYyyy(value: string): number | null {
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

/** Fecha de hoy (UTC, truncada al día) — mismo criterio que el lambda. */
function todayUtc(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Período activo: el de inicio de clases más próximo cuya ventana de venta
 * —incluida la extensión— contiene la fecha de hoy. Mientras un bimestre esté
 * en extensión sigue siendo el principal aunque el siguiente ya haya abierto
 * su venta. Devuelve "" si ninguna ventana contiene la fecha.
 */
export function getActiveEdEhdPeriodKey(today: number = todayUtc()): string {
  for (const key of ED_EHD_PERIOD_ORDER) {
    const info = ED_EHD_PERIODS[key];
    const inicio = parseDdMmYyyy(info.fechaInicio);
    const cierre = parseDdMmYyyy(info.fechaExtension || info.fechaFin);
    if (inicio === null || cierre === null) continue;
    if (today >= inicio && today <= cierre) return key;
  }
  return "";
}

/** "1/27" + "A" → "1A/27" (el ciclo es parte de la clave, igual que en el lambda). */
export function buildEdEhdPeriodKey(periodName: string, subperiod: string): string {
  if (!periodName || !subperiod) return "";
  const parts = periodName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return "";
  return `${parts[0]}${subperiod}/${parts[1]}`;
}

const SPANISH_MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function monthYearLabel(isoDate?: string): string {
  if (!isoDate) return "";
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${SPANISH_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// Meses de cursado que cubre el arancel de cada bimestre — regla comercial fija
// de Siglo 21 (el arancel de los períodos A incluye ambos bimestres del
// cuatrimestre). Igual que el lambda (edEhdCoverageMonths).
const COVERAGE_MONTHS: Record<string, [string, string]> = {
  "1A": ["marzo", "julio"],
  "1B": ["mayo", "julio"],
  "2A": ["agosto", "diciembre"],
  "2B": ["octubre", "diciembre"],
};

/**
 * "2B/26" → "octubre 2026 a diciembre 2026" (regla comercial fija, año del
 * ciclo). Si la clave no es reconocible, cae a las fechas de cursado de la API.
 */
function coverageLabel(periodKey: string, from?: string, to?: string): string {
  const months = COVERAGE_MONTHS[periodKey.slice(0, 2)];
  const cycle = periodKey.split("/")[1];
  if (months && cycle && /^\d{2}$/.test(cycle)) {
    const year = 2000 + Number(cycle);
    return `${months[0]} ${year} a ${months[1]} ${year}`;
  }
  const start = monthYearLabel(from);
  const end = monthYearLabel(to);
  if (!start || !end) return "";
  return `${start} a ${end}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n… [truncado, ${text.length} caracteres en total]`;
}

interface FetchOutcome {
  ok: boolean;
  httpStatus?: number;
  body: string;
  durationMs: number;
  networkError?: string;
}

async function timedFetch(url: string, token: string): Promise<FetchOutcome> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "Conversia",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    const body = await res.text();
    return {
      ok: res.ok,
      httpStatus: res.status,
      body,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      body: "",
      durationMs: Date.now() - start,
      networkError: isTimeout
        ? `La API de Siglo 21 no respondió en ${REQUEST_TIMEOUT_MS / 1000} segundos (timeout)`
        : `Error de conexión: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function describeHttpFailure(outcome: FetchOutcome): string {
  if (outcome.networkError) return outcome.networkError;
  return `La API de Siglo 21 respondió con HTTP ${outcome.httpStatus}${
    outcome.body ? ` — respuesta: ${truncate(outcome.body, 300)}` : " (sin cuerpo de respuesta)"
  }`;
}

// ── Token (mismo flujo que el lambda: client_credentials contra auth.ues21) ───

export interface Siglo21Credentials {
  clientId: string;
  clientSecret: string;
}

interface TokenOutcome {
  token?: string;
  httpStatus?: number;
  durationMs: number;
  /** Respuesta cruda con el access_token oculto (no exponer el token en la UI) */
  rawResponse?: string;
  errorDetail?: string;
  expiresIn?: number;
}

async function fetchToken(creds: Siglo21Credentials): Promise<TokenOutcome> {
  const start = Date.now();
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: "conversia:read",
  });

  let outcome: { status?: number; body: string; networkError?: string };
  try {
    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Conversia",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    outcome = { status: res.status, body: await res.text() };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return {
      durationMs: Date.now() - start,
      errorDetail: isTimeout
        ? `El servidor de autenticación de Siglo 21 no respondió en ${REQUEST_TIMEOUT_MS / 1000} segundos (timeout)`
        : `Error de conexión con el servidor de autenticación: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const durationMs = Date.now() - start;

  if (outcome.status !== 200) {
    return {
      httpStatus: outcome.status,
      durationMs,
      rawResponse: truncate(outcome.body, 1000),
      errorDetail: `El servidor de autenticación respondió HTTP ${outcome.status}${
        outcome.body ? ` — respuesta: ${truncate(outcome.body, 300)}` : ""
      }`,
    };
  }

  let parsed: { access_token?: string; token_type?: string; expires_in?: number };
  try {
    parsed = JSON.parse(outcome.body);
  } catch {
    return {
      httpStatus: outcome.status,
      durationMs,
      rawResponse: truncate(outcome.body, 1000),
      errorDetail: "El servidor de autenticación respondió 200 pero el cuerpo no es JSON válido.",
    };
  }

  // Ocultar el token en la respuesta cruda que se muestra en la UI
  const redacted = parsed.access_token
    ? outcome.body.replace(parsed.access_token, "…[token oculto]")
    : outcome.body;

  // Mismas validaciones que el lambda (GetToken)
  if (!parsed.access_token) {
    return {
      httpStatus: outcome.status,
      durationMs,
      rawResponse: truncate(redacted, 1000),
      errorDetail: "La respuesta de autenticación vino sin access_token.",
    };
  }
  if (parsed.token_type !== "bearer") {
    return {
      httpStatus: outcome.status,
      durationMs,
      rawResponse: truncate(redacted, 1000),
      errorDetail: `Tipo de token inesperado: "${parsed.token_type}" (se esperaba "bearer").`,
    };
  }

  return {
    token: parsed.access_token,
    httpStatus: outcome.status,
    durationMs,
    rawResponse: truncate(redacted, 1000),
    expiresIn: parsed.expires_in,
  };
}

// ── Diagnóstico principal ─────────────────────────────────────────────────────

export async function diagnose(raw: PricingInput, creds: Siglo21Credentials): Promise<DiagnosisResult> {
  const startedAt = Date.now();
  const steps: StepResult[] = [];
  const periodPrices: PeriodPriceResult[] = [];
  const primarySel: { key?: string; name?: string } = {};

  const finish = (
    verdict: Verdict,
    input: DiagnosisResult["input"],
    extra?: Partial<DiagnosisResult>
  ): DiagnosisResult => ({
    input,
    modalityName: MODALITY_NAMES[input.modality_id] ?? `Modalidad ${input.modality_id} (desconocida)`,
    verdict,
    steps,
    periodPrices,
    primaryPeriodKey: primarySel.key,
    primaryPeriodName: primarySel.name,
    totalDurationMs: Date.now() - startedAt,
    ...extra,
  });

  // ── Paso 1: Validación de campos (igual que validatePricingRequestV4) ──────
  const missing: string[] = [];
  const rawCauId = typeof raw.cau_id === "string" ? raw.cau_id.trim() : "";
  const modalityId = typeof raw.modality_id === "number" ? raw.modality_id : NaN;
  const programId = typeof raw.program_id === "number" ? raw.program_id : NaN;

  // Modalidades 3 y 5: el CAU se fuerza internamente, así que no se exige en el request
  const forcedCau = Number.isFinite(modalityId) ? FORCED_CAU_BY_MODALITY[modalityId] : undefined;
  const cauId = forcedCau ?? rawCauId;

  if (!cauId) missing.push("cau_id");
  if (!Number.isFinite(modalityId)) missing.push("modality_id");
  if (!Number.isFinite(programId)) missing.push("program_id");

  const input = {
    cau_id: cauId || String(raw.cau_id ?? "—"),
    modality_id: Number.isFinite(modalityId) ? modalityId : 0,
    program_id: Number.isFinite(programId) ? programId : 0,
  };

  if (missing.length > 0) {
    steps.push({
      id: "validation",
      title: "Validación del request",
      status: "fail",
      detail: `Faltan o son inválidos los campos: ${missing.join(", ")}. El JSON debe tener cau_id (texto), modality_id (número) y program_id (número).`,
    });
    return finish(
      {
        code: "MISSING_REQUIRED_FIELD",
        httpEquivalent: 400,
        title: "El request está incompleto",
        explanation: `El JSON enviado no tiene todos los campos obligatorios (falta o es inválido: ${missing.join(", ")}). Esto NO es un error de Siglo 21 — hay que corregir los datos que se envían.`,
        responsible: "config",
      },
      input
    );
  }

  steps.push({
    id: "validation",
    title: "Validación del request",
    status: "ok",
    detail: `Campos completos: carrera ${programId}, modalidad ${modalityId}, CAU ${cauId}.`,
  });

  // ── Paso 1b: Override de CAU por modalidad (igual que el lambda) ───────────
  if (forcedCau) {
    steps.push({
      id: "cau-override",
      title: "Override de CAU por modalidad",
      status: "ok",
      detail: `La modalidad ${modalityId} (${MODALITY_NAMES[modalityId]}) usa SIEMPRE el CAU ${forcedCau} — regla del middleware pedida por el cliente. ${
        rawCauId
          ? `El cau_id del request ("${rawCauId}") se ignora.`
          : "El request no traía cau_id (para esta modalidad es opcional)."
      } Todas las consultas a Siglo 21 se hacen con el CAU ${forcedCau}.`,
    });
  }

  // ── Paso 2: Chequeo de modalidad presencial ────────────────────────────────
  if (PRESENCIAL_MODALITIES.has(modalityId)) {
    steps.push({
      id: "modality-check",
      title: "Chequeo de modalidad",
      status: "fail",
      detail: `La modalidad ${modalityId} (${MODALITY_NAMES[modalityId]}) es presencial. El middleware NO consulta precios para modalidades presenciales: devuelve error 422 a propósito.`,
    });
    return finish(
      {
        code: "PRESENCIAL_MODALITY",
        httpEquivalent: 422,
        title: "Modalidad presencial — comportamiento esperado",
        explanation: `La modalidad ${modalityId} (${MODALITY_NAMES[modalityId]}) es presencial y por diseño NO tiene precio online: el agente IA debe derivar al estudiante a un asesor de Admisión. Esto no es una falla — es el comportamiento configurado. No hay nada que reportar a Siglo 21.`,
        responsible: "comportamiento_esperado",
      },
      input
    );
  }

  steps.push({
    id: "modality-check",
    title: "Chequeo de modalidad",
    status: "ok",
    detail: `Modalidad ${modalityId} (${MODALITY_NAMES[modalityId] ?? "desconocida"}) — habilitada para consulta de precios online.`,
  });

  // ── Paso 3: Token (igual que el lambda: client_credentials en cada consulta) ──
  if (!creds.clientId || !creds.clientSecret) {
    steps.push({
      id: "auth",
      title: "Autenticación (token)",
      status: "fail",
      detail: "Faltan las credenciales de Siglo 21 en esta herramienta (env vars SIGLO21_CLIENT_ID / SIGLO21_CLIENT_SECRET).",
    });
    return finish(
      {
        code: "AUTH_FAILED",
        httpEquivalent: 401,
        title: "Faltan configurar las credenciales en esta herramienta",
        explanation: "Esta herramienta de QA no tiene configuradas las credenciales de Siglo 21 (env vars SIGLO21_CLIENT_ID y SIGLO21_CLIENT_SECRET). Avisale a Diego para que las configure en Vercel.",
        responsible: "config",
      },
      input
    );
  }

  const tokenOutcome = await fetchToken(creds);

  if (!tokenOutcome.token) {
    steps.push({
      id: "auth",
      title: "Autenticación (token)",
      status: "fail",
      method: "POST",
      url: AUTH_URL,
      httpStatus: tokenOutcome.httpStatus,
      durationMs: tokenOutcome.durationMs,
      rawResponse: tokenOutcome.rawResponse,
      detail: tokenOutcome.errorDetail ?? "No se pudo obtener el token.",
    });
    return finish(
      {
        code: "AUTH_FAILED",
        httpEquivalent: 401,
        title: "No se pudo obtener el token de autenticación de Siglo 21",
        explanation: `El servidor de autenticación de Siglo 21 (auth.ues21.edu.ar) no entregó un token válido: ${tokenOutcome.errorDetail}. Sin token no se puede consultar ningún precio — este es el mismo error AUTH_FAILED que devuelve el middleware. Suele ser un problema temporal del lado de Siglo 21; si persiste, reportarles adjuntando el detalle técnico.`,
        responsible: "siglo21",
      },
      input
    );
  }

  const token = tokenOutcome.token;
  steps.push({
    id: "auth",
    title: "Autenticación (token)",
    status: "ok",
    method: "POST",
    url: AUTH_URL,
    httpStatus: tokenOutcome.httpStatus,
    durationMs: tokenOutcome.durationMs,
    rawResponse: tokenOutcome.rawResponse,
    detail: `Token obtenido correctamente de Siglo 21 (igual que hace el middleware en cada consulta)${
      tokenOutcome.expiresIn ? ` — expira en ${tokenOutcome.expiresIn} segundos` : ""
    }.`,
  });

  // ── Paso 4: Turnos de cursado ──────────────────────────────────────────────
  const turnosUrl = `${BASE_URL}/variables/turnos-cursado/carrera/${programId}/modalidad/${modalityId}/cau/${encodeURIComponent(cauId)}`;
  const turnosOutcome = await timedFetch(turnosUrl, token);

  let schedules: Array<{ id: number; code: string; name: string }> = [];
  let turnosParseError: string | undefined;

  if (turnosOutcome.ok) {
    try {
      const parsed = JSON.parse(turnosOutcome.body);
      schedules = Array.isArray(parsed?.items) ? parsed.items : [];
    } catch {
      turnosParseError = "La API respondió 200 pero el cuerpo no es JSON válido.";
    }
  }

  if (!turnosOutcome.ok || turnosParseError || schedules.length === 0) {
    const reason = !turnosOutcome.ok
      ? describeHttpFailure(turnosOutcome)
      : turnosParseError ?? "La API respondió correctamente (HTTP 200) pero la lista de turnos vino VACÍA.";
    steps.push({
      id: "turnos",
      title: "1/3 — Turnos de cursado",
      status: "fail",
      method: "GET",
      url: turnosUrl,
      httpStatus: turnosOutcome.httpStatus,
      durationMs: turnosOutcome.durationMs,
      rawResponse: truncate(turnosOutcome.body),
      detail: reason,
    });

    const isAuthProblem = turnosOutcome.httpStatus === 401 || turnosOutcome.httpStatus === 403;
    return finish(
      {
        code: isAuthProblem ? "AUTH_FAILED" : "NO_SCHEDULES_AVAILABLE",
        httpEquivalent: isAuthProblem ? 401 : 404,
        title: isAuthProblem
          ? "Siglo 21 rechazó el token de autenticación"
          : "No hay turnos de cursado disponibles",
        explanation: isAuthProblem
          ? `Siglo 21 rechazó el token recién emitido (HTTP ${turnosOutcome.httpStatus}) al consultar los turnos. Es una inconsistencia entre su servidor de autenticación y su API de precios. Reportar a Siglo 21 adjuntando el detalle técnico.`
          : schedules.length === 0 && turnosOutcome.ok
            ? `Siglo 21 no tiene turnos de cursado cargados para la carrera ${programId} en modalidad ${modalityId} con el CAU ${cauId}. Puede ser que la combinación carrera/modalidad/CAU no exista o no esté configurada del lado de Siglo 21. Verificar primero que los datos sean correctos; si lo son, reportar a Siglo 21.`
            : `La consulta de turnos a Siglo 21 falló: ${reason}. Este es el primer paso de la consulta de precio, así que el agente IA no pudo dar precio. Reportar a Siglo 21 con el detalle técnico.`,
        responsible: isAuthProblem || !turnosOutcome.ok ? "siglo21" : "config",
      },
      input
    );
  }

  const turnoCode = schedules[0].code;
  const turnoName = schedules[0].name;
  steps.push({
    id: "turnos",
    title: "1/3 — Turnos de cursado",
    status: "ok",
    method: "GET",
    url: turnosUrl,
    httpStatus: turnosOutcome.httpStatus,
    durationMs: turnosOutcome.durationMs,
    rawResponse: truncate(turnosOutcome.body),
    detail: `Siglo 21 devolvió ${schedules.length} turno(s). Se usa el primero: "${turnoName}" (código ${turnoCode}) — igual que el middleware.`,
  });

  // ── Paso 5: Períodos ───────────────────────────────────────────────────────
  const periodosUrl = `${BASE_URL}/variables/periodos/carrera/${programId}/modalidad/${modalityId}/cau/${encodeURIComponent(cauId)}/turno/${encodeURIComponent(turnoCode)}`;
  const periodosOutcome = await timedFetch(periodosUrl, token);

  interface RawPeriodItem {
    id: number;
    period?: { id: number; name?: string };
    subperiod?: string;
    name?: string;
    from?: string;
    to?: string;
  }
  let periodItems: RawPeriodItem[] = [];
  let periodosParseError: string | undefined;

  if (periodosOutcome.ok) {
    try {
      const parsed = JSON.parse(periodosOutcome.body);
      periodItems = Array.isArray(parsed?.items) ? parsed.items : [];
    } catch {
      periodosParseError = "La API respondió 200 pero el cuerpo no es JSON válido.";
    }
  }

  if (!periodosOutcome.ok || periodosParseError || periodItems.length === 0) {
    const reason = !periodosOutcome.ok
      ? describeHttpFailure(periodosOutcome)
      : periodosParseError ?? "La API respondió correctamente (HTTP 200) pero la lista de períodos vino VACÍA.";
    steps.push({
      id: "periodos",
      title: "2/3 — Períodos del turno",
      status: "fail",
      method: "GET",
      url: periodosUrl,
      httpStatus: periodosOutcome.httpStatus,
      durationMs: periodosOutcome.durationMs,
      rawResponse: truncate(periodosOutcome.body),
      detail: reason,
    });
    return finish(
      {
        code: "NO_PERIODS_AVAILABLE",
        httpEquivalent: 404,
        title: "El turno no tiene períodos activos",
        explanation:
          periodItems.length === 0 && periodosOutcome.ok
            ? `Siglo 21 encontró el turno "${turnoName}" pero NO tiene períodos de cursado activos para esta carrera. Normalmente significa que la inscripción está cerrada para este ciclo, o que falta configurar los períodos del lado de Siglo 21. Reportar a Siglo 21 si debería haber inscripción abierta.`
            : `La consulta de períodos a Siglo 21 falló: ${reason}. Reportar a Siglo 21 con el detalle técnico.`,
        responsible: "siglo21",
      },
      input,
      { turnoCode, turnoName }
    );
  }

  steps.push({
    id: "periodos",
    title: "2/3 — Períodos del turno",
    status: "ok",
    method: "GET",
    url: periodosUrl,
    httpStatus: periodosOutcome.httpStatus,
    durationMs: periodosOutcome.durationMs,
    rawResponse: truncate(periodosOutcome.body),
    detail: `Siglo 21 devolvió ${periodItems.length} período(s): ${periodItems
      .map((p) => `${p.name ?? p.period?.name ?? "?"}-${p.subperiod ?? "?"}`)
      .join(", ")}.`,
  });

  // ── Paso 5b: Selección del período activo (ED/EHD, igual que el lambda) ────
  // El lambda elige UN período principal con su tabla hardcodeada (regla del
  // ticket HF-0113: gana el de inicio de clases más próximo cuya ventana de
  // venta —incluida la extensión— contiene la fecha de hoy). El resto queda
  // como alternativos ocultos que el bot solo ofrece si rechazan el principal.
  let primaryItemId: number | undefined;
  if (ED_EHD_MODALITIES.has(modalityId)) {
    const itemKey = (i: RawPeriodItem) =>
      buildEdEhdPeriodKey(i.name ?? i.period?.name ?? "", i.subperiod ?? "");
    const activeKey = getActiveEdEhdPeriodKey();
    const match = activeKey ? periodItems.find((i) => itemKey(i) === activeKey) : undefined;
    const activeInfo = activeKey ? ED_EHD_PERIODS[activeKey] : undefined;

    if (match) {
      primaryItemId = match.id;
      primarySel.key = activeKey;
      primarySel.name = activeInfo?.nombre;
      steps.push({
        id: "periodo-activo",
        title: "Selección del período activo (tabla del middleware)",
        status: "ok",
        detail: `Período activo según la tabla hardcodeada: ${activeKey} (${activeInfo?.nombre ?? "?"}), ventana de venta ${activeInfo?.fechaInicio} → ${activeInfo?.fechaFin}${activeInfo?.fechaExtension ? ` con extensión hasta ${activeInfo.fechaExtension}` : ""}. Ese es el precio que ve el estudiante; los demás períodos quedan como alternativos ocultos.`,
      });
    } else if (activeKey) {
      // Mismo fallback que el lambda: sin match exacto usa el primer item de la API.
      primaryItemId = periodItems[0]?.id;
      primarySel.key = activeKey;
      primarySel.name = activeInfo?.nombre;
      steps.push({
        id: "periodo-activo",
        title: "Selección del período activo (tabla del middleware)",
        status: "warning",
        detail: `La tabla hardcodeada indica que el activo es ${activeKey} (${activeInfo?.nombre ?? "?"}), pero Siglo 21 NO devolvió ese período. El middleware usa como respaldo el primer período de la lista (${periodItems[0] ? `${periodItems[0].name ?? "?"}-${periodItems[0].subperiod ?? "?"}` : "—"}). Verificar si la tabla del middleware está desactualizada o si falta el período del lado de Siglo 21.`,
      });
    } else {
      steps.push({
        id: "periodo-activo",
        title: "Selección del período activo (tabla del middleware)",
        status: "warning",
        detail: "Ninguna ventana de venta de la tabla hardcodeada del middleware contiene la fecha de hoy: el middleware respondería con derivación a Admisión (sin precio). Hay que cargar las fechas del ciclo nuevo en la tabla.",
      });
    }
  }

  // ── Paso 6: Precios por período (secuencial, igual que el lambda) ──────────
  for (const item of periodItems) {
    const periodId = item.period?.id ?? 0;
    const subPeriodId = item.id;
    const subPeriod = item.subperiod ?? "";
    const periodName = item.name ?? item.period?.name ?? "?";
    const periodKey = ED_EHD_MODALITIES.has(modalityId)
      ? buildEdEhdPeriodKey(periodName, subPeriod)
      : "";
    const roleFields: Pick<PeriodPriceResult, "role" | "periodKey" | "periodLabel" | "coverageLabel"> = {
      role:
        primaryItemId === undefined
          ? undefined
          : item.id === primaryItemId
            ? "primary"
            : "alternative",
      periodKey: periodKey || undefined,
      periodLabel: (periodKey && ED_EHD_PERIODS[periodKey]?.nombre) || undefined,
      coverageLabel: coverageLabel(periodKey, item.from, item.to) || undefined,
    };

    const preciosUrl = `${BASE_URL}/precios/carrera/${programId}/modalidad/${modalityId}/cau/${encodeURIComponent(cauId)}/turno/${encodeURIComponent(turnoCode)}/periodo/${periodId}/subperiodo/${subPeriodId}/codigo/${encodeURIComponent(subPeriod)}`;
    const outcome = await timedFetch(preciosUrl, token);

    if (outcome.ok) {
      let total: number | undefined;
      let totalListPrice: number | undefined;
      let totalDiscounts: number | undefined;
      let parseError: string | undefined;
      try {
        const parsed = JSON.parse(outcome.body);
        total = typeof parsed?.total === "number" ? parsed.total : undefined;
        totalListPrice = typeof parsed?.totalPrecioLista === "number" ? parsed.totalPrecioLista : undefined;
        totalDiscounts = typeof parsed?.totalDescuentos === "number" ? parsed.totalDescuentos : undefined;
      } catch {
        parseError = "Respondió 200 pero el cuerpo no es JSON válido.";
      }

      periodPrices.push({
        periodName,
        subPeriod,
        periodId,
        subPeriodId,
        url: preciosUrl,
        ok: !parseError,
        httpStatus: outcome.httpStatus,
        durationMs: outcome.durationMs,
        total,
        totalListPrice,
        totalDiscounts,
        rawResponse: truncate(outcome.body),
        errorDetail: parseError,
        ...roleFields,
      });
    } else {
      periodPrices.push({
        periodName,
        subPeriod,
        periodId,
        subPeriodId,
        url: preciosUrl,
        ok: false,
        httpStatus: outcome.httpStatus,
        durationMs: outcome.durationMs,
        rawResponse: truncate(outcome.body),
        errorDetail: describeHttpFailure(outcome),
        ...roleFields,
      });
    }
  }

  const okCount = periodPrices.filter((p) => p.ok).length;
  const failCount = periodPrices.length - okCount;

  if (okCount === 0) {
    steps.push({
      id: "precios",
      title: "3/3 — Precios por período",
      status: "fail",
      detail: `Se consultó el precio de los ${periodPrices.length} período(s) y TODOS fallaron. Ver el detalle por período más abajo.`,
    });
    return finish(
      {
        code: "PRICE_FETCH_ERROR",
        httpEquivalent: 500,
        title: "Siglo 21 no devolvió precio para ningún período",
        explanation: `Los turnos y períodos existen, pero la API de precios de Siglo 21 falló para TODOS los períodos (${periodPrices.length}). El agente IA no pudo dar precio. Puede ser un error temporal de Siglo 21 o que los períodos no estén activos en su configuración de precios. Reportar a Siglo 21 adjuntando los errores de cada período (detalle técnico abajo).`,
        responsible: "siglo21",
      },
      input,
      { turnoCode, turnoName }
    );
  }

  if (failCount > 0) {
    steps.push({
      id: "precios",
      title: "3/3 — Precios por período",
      status: "warning",
      detail: `${okCount} período(s) con precio OK, pero ${failCount} período(s) fallaron y el middleware los OMITE EN SILENCIO (no aparecen en la respuesta del agente IA). Ver detalle por período.`,
    });
    return finish(
      {
        code: "OK_PARTIAL",
        httpEquivalent: 200,
        title: "Precio obtenido, pero con períodos omitidos",
        explanation: `El agente IA SÍ recibió precio (${okCount} de ${periodPrices.length} períodos), pero ${failCount} período(s) fallaron en Siglo 21 y se omitieron en silencio. Si el estudiante preguntaba por uno de los períodos omitidos, el agente IA no tenía ese dato. Revisar el detalle por período para ver cuáles fallaron y por qué.`,
        responsible: "siglo21",
      },
      input,
      { turnoCode, turnoName }
    );
  }

  steps.push({
    id: "precios",
    title: "3/3 — Precios por período",
    status: "ok",
    detail: `Se obtuvo precio para los ${okCount} período(s) sin errores.`,
  });

  return finish(
    {
      code: "OK",
      httpEquivalent: 200,
      title: "Todo funcionó correctamente",
      explanation: `La consulta completa funcionó: hay turno, ${periodPrices.length} período(s) y todos con precio. Si el agente IA no dio precio en la conversación, el problema NO fue esta consulta a Siglo 21 en este momento — pudo ser un error temporal en el momento de la conversación, o un problema en otro punto del flujo del agente IA.`,
      responsible: "nadie",
    },
    input,
    { turnoCode, turnoName }
  );
}
