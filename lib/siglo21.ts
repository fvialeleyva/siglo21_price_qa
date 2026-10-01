// Réplica de get-price-v4 del lambda siglo21-price-proxy (rama
// feat/v4-next-period-fallback, sobre PR #22 de conversia-legacy-lambdas) con fines de
// diagnóstico: en lugar de retornar solo el output o un error, registra cada
// paso (URL, status HTTP, respuesta cruda, duración), qué hace v4 con cada
// período que devuelve Siglo 21 y la respuesta exacta (HTTP + body) que daría
// el lambda. La lógica pura (tabla de bimestres, formateador) vive en
// ./get-price-v4.ts.

import {
  ADVISOR_MESSAGE,
  ADVISOR_MODALITIES,
  ALT_PERIOD_PREFIX,
  BIMESTER_MODALITIES,
  DEFAULT_LLM_INSTRUCTION_ERROR,
  ED_EHD_PERIOD_ORDER,
  ED_EHD_PERIODS,
  MODALITY_NAMES,
  buildCourseCoverageLine,
  buildEdEhdPeriodKey,
  buildNextPeriodNotice,
  buildPeriodCoverageLabel,
  formatPriceResponseV4,
  getActiveEdEhdPeriodKey,
  resolveV4PrimaryPeriod,
  round2,
  shownEdEhdAlternatives,
  type PriceData,
  type PriceDataMap,
  type PriceResponse,
  type V4Request,
} from "./get-price-v4";

export { MODALITY_NAMES };

// Configurable por env var para apuntar a otros entornos (ej. QA:
// https://price-simulator-facade-qa.uesiglo21.edu.ar/api/v1). Default: prod.
const BASE_URL =
  process.env.SIGLO21_BASE_URL ??
  "https://price-simulator-facade.uesiglo21.edu.ar/api/v1";
const AUTH_URL =
  process.env.SIGLO21_AUTH_URL ?? "https://auth.ues21.edu.ar/menu/api/oauth2/token";
const REQUEST_TIMEOUT_MS = 10_000; // mismo timeout que el lambda (http.Client{Timeout: 10s})

// ── Tipos de entrada ──────────────────────────────────────────────────────────

/** Body tal cual lo recibiría POST /v1/get-price-v4. */
export type PricingInput = unknown;

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

/** Resultado de una llamada a /precios hecha por v4. */
export interface PriceFetchResult {
  url: string;
  ok: boolean;
  httpStatus?: number;
  durationMs: number;
  total?: number;
  totalListPrice?: number;
  totalDiscounts?: number;
  rawResponse?: string;
  errorDetail?: string;
}

/**
 * Qué hace v4 con cada período que devuelve Siglo 21 (rama bimestral):
 * - primary / alternative / alternative_not_shown
 * - ignored: v4 no lo cotiza (ver useLabel)
 */
export type PeriodUse = "primary" | "alternative" | "alternative_not_shown" | "ignored";

export interface PeriodRow {
  name: string;
  subPeriod: string;
  periodId: number;
  subPeriodId: number;
  from: string;
  to: string;
  /** Clave del bimestre armada como el lambda (ej: "2B/26"), si aplica */
  key?: string;
  /** Nombre legible según la tabla del lambda (ej: "octubre 2026") */
  keyLabel?: string;
  /** Meses de cursado que abarca (regla comercial fija; solo rama bimestral) */
  coverageLabel?: string;
  use: PeriodUse;
  /** Explicación de por qué v4 lo usa o lo ignora */
  useLabel: string;
  /** Llamada de precio que hizo v4 para este período (si la hizo) */
  fetch?: PriceFetchResult;
}

export type VerdictCode =
  | "OK"
  | "OK_PARTIAL"
  | "INVALID_REQUEST_BODY"
  | "MISSING_REQUIRED_FIELD"
  | "ADVISOR_MODALITY"
  | "AUTH_FAILED"
  | "NO_SCHEDULES_AVAILABLE"
  | "NO_PERIODS_AVAILABLE"
  | "NO_ACTIVE_ED_EHD_PERIOD"
  | "NO_ACTIVE_OR_NEXT_PERIOD"
  | "PRICE_FETCH_ERROR"
  | "UNSUPPORTED_MODALITY";

export interface Verdict {
  code: VerdictCode;
  /** Código HTTP que retornaría get-price-v4 en este caso */
  httpEquivalent: number;
  title: string;
  /** Explicación en lenguaje claro para el equipo de CS */
  explanation: string;
  /** A quién corresponde el problema */
  responsible: "siglo21" | "config" | "middleware" | "comportamiento_esperado" | "nadie";
}

/** Rama de v4 por la que pasa la consulta. */
export type V4Branch = "validation" | "advisor" | "bimester" | "unsupported";

/** Datos del bloque de precio que arma v4 (para el preview del mensaje del bot). */
export interface Quote {
  kind: "bimester";
  periodKey: string;
  periodName: string;
  total: number;
  cuota6: number;
  cuota3: number;
  coverageLabel: string;
  courseCoverageLine: string;
  /** Clave del período activo según la tabla (difiere de periodKey si se cotiza el próximo) */
  activePeriodKey: string;
  /** Aclaración que agrega v4 cuando el activo no vino y se cotiza el próximo período ("" si no aplica) */
  nextPeriodNotice: string;
  alternatives: { key: string; name: string; total: number; cuota6: number; cuota3: number; coverageLabel: string }[];
}

export interface DiagnosisResult {
  input: { cau_id: string; modality_id: number; program_id: number };
  modalityName: string;
  branch: V4Branch;
  verdict: Verdict;
  steps: StepResult[];
  /** Todos los períodos que devolvió Siglo 21 y qué hizo v4 con cada uno */
  periods: PeriodRow[];
  turnoCode?: string;
  turnoName?: string;
  /** Clave del período activo según la tabla hardcodeada del lambda (rama bimestral) */
  activePeriodKey?: string;
  /** Período principal que cotiza v4: el activo o, si no vino, el próximo de la tabla que sí vino */
  primaryPeriodKey?: string;
  primaryPeriodName?: string;
  quote?: Quote;
  /** Respuesta exacta que daría POST /v1/get-price-v4 */
  lambdaResponse: { httpStatus: number; body: unknown };
  /** Instante usado como "ahora" (el lambda usa time.Now()) */
  evaluatedAt: string;
  totalDurationMs: number;
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
    return { ok: res.status === 200, httpStatus: res.status, body, durationMs: Date.now() - start };
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

const money = (n: number) => `$${n.toFixed(2)}`;

// ── Decodificación estilo encoding/json de Go ─────────────────────────────────
// El lambda decodifica en structs tipados: un campo con tipo incorrecto hace
// fallar todo el decode (→ error). Replicamos esos chequeos de tipo.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNil = (v: unknown) => v === undefined || v === null;

class DecodeError extends Error {}

function goString(o: Obj, field: string): string {
  const v = o[field];
  if (isNil(v)) return "";
  if (typeof v !== "string") throw new DecodeError(`"${field}" debería ser texto y vino ${JSON.stringify(v)}`);
  return v;
}

function goInt(o: Obj, field: string): number {
  const v = o[field];
  if (isNil(v)) return 0;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new DecodeError(`"${field}" debería ser un entero y vino ${JSON.stringify(v)}`);
  return v;
}

function goFloat(o: Obj, field: string): number {
  const v = o[field];
  if (isNil(v)) return 0;
  if (typeof v !== "number") throw new DecodeError(`"${field}" debería ser un número y vino ${JSON.stringify(v)}`);
  return v;
}

function goObj(v: unknown, what: string): Obj {
  if (isNil(v)) return {};
  if (!isObj(v)) throw new DecodeError(`${what} debería ser un objeto`);
  return v;
}

function goArray(v: unknown, what: string): unknown[] {
  if (isNil(v)) return [];
  if (!Array.isArray(v)) throw new DecodeError(`${what} debería ser una lista`);
  return v;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new DecodeError("la respuesta no es JSON válido");
  }
}

interface ScheduleItem {
  id: number;
  code: string;
  name: string;
}

function decodeSchedules(body: string): ScheduleItem[] {
  const root = goObj(parseJson(body), "la respuesta");
  return goArray(root.items, '"items"').map((it) => {
    const o = goObj(it, "cada turno");
    return { id: goInt(o, "id"), code: goString(o, "code"), name: goString(o, "name") };
  });
}

interface PeriodItem {
  subPeriodId: number;
  periodId: number;
  startDate: string;
  endDate: string;
  subPeriod: string;
  name: string;
}

function decodePeriods(body: string): PeriodItem[] {
  const root = goObj(parseJson(body), "la respuesta");
  return goArray(root.items, '"items"').map((it) => {
    const o = goObj(it, "cada período");
    const p = goObj(o.period, '"period"');
    goInt(p, "id");
    for (const f of ["name", "description", "from", "to", "salesFrom", "salesTo", "usePkg"]) goString(p, f);
    goString(o, "description");
    return {
      subPeriodId: goInt(o, "id"),
      periodId: goInt(p, "id"),
      startDate: goString(o, "from"),
      endDate: goString(o, "to"),
      subPeriod: goString(o, "subperiod"),
      name: goString(o, "name"),
    };
  });
}

function decodePrice(body: string): PriceResponse {
  const root = goObj(parseJson(body), "la respuesta");
  goString(root, "requestId");
  return {
    total: goFloat(root, "total"),
    totalPrecioLista: goFloat(root, "totalPrecioLista"),
    totalDescuentos: goFloat(root, "totalDescuentos"),
    items: goArray(root.items, '"items"').map((it) => {
      const o = goObj(it, "cada ítem");
      return {
        nombre: goString(o, "nombre"),
        precioLista: goFloat(o, "precioLista"),
        descuentos: goArray(o.descuentos, '"descuentos"').map((d) => {
          const dd = goObj(d, "cada descuento");
          return { motivo: goString(dd, "motivo"), porcentaje: goFloat(dd, "porcentaje"), monto: goFloat(dd, "monto") };
        }),
      };
    }),
  };
}

/** models.IntOrString: número (se trunca a int) o string numérico (strconv.Atoi). */
function decodeIntOrString(o: Obj, field: string): number {
  const v = o[field];
  if (v === undefined) return 0;
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string" && /^[+-]?\d+$/.test(v)) return Number(v);
  throw new DecodeError(`"${field}" debe ser número o string numérico, vino ${JSON.stringify(v)}`);
}

function decodeOptionalBool(o: Obj, field: string): boolean | undefined {
  const v = o[field];
  if (isNil(v)) return undefined;
  if (typeof v !== "boolean") throw new DecodeError(`"${field}" debe ser true/false, vino ${JSON.stringify(v)}`);
  return v;
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

  let outcome: { status?: number; body: string };
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

export interface DiagnoseOptions {
  /** Instante a usar como "ahora". Solo para tests; en producción se omite (= new Date()). */
  now?: Date;
}

export async function diagnose(
  raw: PricingInput,
  creds: Siglo21Credentials,
  options: DiagnoseOptions = {}
): Promise<DiagnosisResult> {
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const steps: StepResult[] = [];
  const periods: PeriodRow[] = [];
  const extra: Partial<DiagnosisResult> = {};
  let branch: V4Branch = "validation";
  let input: DiagnosisResult["input"] = { cau_id: "—", modality_id: 0, program_id: 0 };
  let llmInstructionError = DEFAULT_LLM_INSTRUCTION_ERROR;

  const finish = (verdict: Verdict, lambdaResponse: DiagnosisResult["lambdaResponse"]): DiagnosisResult => ({
    input,
    modalityName: MODALITY_NAMES[input.modality_id] ?? `Modalidad ${input.modality_id} (sin mapeo en v4)`,
    branch,
    verdict,
    steps,
    periods,
    ...extra,
    lambdaResponse,
    evaluatedAt: now.toISOString(),
    totalDurationMs: Date.now() - startedAt,
  });

  const validationError = (message: string) => ({
    httpStatus: 400,
    body: { error: { code: "COMMON_INVALID_REQUEST", type: "VALIDATION", message } },
  });
  const authError = () => ({
    httpStatus: 401,
    body: { error: { code: "COMMON_UNAUTHORIZED", type: "AUTHORIZATION", message: "Authentication failed" } },
  });
  const businessError = (httpStatus: 404 | 500) => ({ httpStatus, body: { error: llmInstructionError } });

  // ── Paso 1: decodificar el body (json.Unmarshal en models.PricingRequest) ──
  let req: V4Request;
  let rawObj: Obj;
  try {
    if (!isObj(raw)) throw new DecodeError("el body debe ser un objeto JSON");
    rawObj = raw;
    req = {
      programId: decodeIntOrString(raw, "program_id"),
      modalityId: decodeIntOrString(raw, "modality_id"),
      cauId: goString(raw, "cau_id"),
      llmInstruction: goString(raw, "llm_instruction"),
      llmInstructionError: goString(raw, "llm_instruction_error"),
      includePaymentMethods: decodeOptionalBool(raw, "include_payment_methods"),
      customPaymentMethodsInfo: goString(raw, "custom_payment_methods_info"),
      includeRestrictions: decodeOptionalBool(raw, "include_restrictions"),
      customRestrictions: goString(raw, "custom_restrictions"),
    };
    decodeIntOrString(raw, "schedule_id");
    goString(raw, "date");
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    if (isObj(raw)) {
      input = {
        cau_id: typeof raw.cau_id === "string" ? raw.cau_id : String(raw.cau_id ?? "—"),
        modality_id: typeof raw.modality_id === "number" ? raw.modality_id : 0,
        program_id: typeof raw.program_id === "number" ? raw.program_id : 0,
      };
    }
    steps.push({
      id: "validation",
      title: "Validación del request",
      status: "fail",
      detail: `El lambda no puede leer el body (${why}). Responde 400 "Invalid request body".`,
    });
    return finish(
      {
        code: "INVALID_REQUEST_BODY",
        httpEquivalent: 400,
        title: "El request tiene un formato inválido",
        explanation: `get-price-v4 rechaza el body antes de consultar nada: ${why}. No es un error de Siglo 21 — hay que corregir los datos que envía la tool.`,
        responsible: "config",
      },
      validationError("Invalid request body")
    );
  }

  if (req.llmInstructionError !== "") llmInstructionError = req.llmInstructionError;
  input = { cau_id: req.cauId || "—", modality_id: req.modalityId, program_id: req.programId };

  // validatePricingRequestV4: devuelve el PRIMER campo faltante, en este orden.
  const missing =
    req.programId === 0 ? "program_id" : req.modalityId === 0 ? "modality_id" : req.cauId === "" ? "cau_id" : "";
  if (missing) {
    steps.push({
      id: "validation",
      title: "Validación del request",
      status: "fail",
      detail: `Falta ${missing} (o vino en 0 / vacío). get-price-v4 exige program_id, modality_id y cau_id; schedule_id no se usa.`,
    });
    return finish(
      {
        code: "MISSING_REQUIRED_FIELD",
        httpEquivalent: 400,
        title: "El request está incompleto",
        explanation: `El JSON no trae ${missing} (el lambda responde 400 "${missing} is required"). Esto NO es un error de Siglo 21 — hay que corregir los datos que se envían.`,
        responsible: "config",
      },
      validationError(`${missing} is required`)
    );
  }

  const ignoredFields = ["schedule_id", "date"].filter((f) => rawObj[f] !== undefined);
  steps.push({
    id: "validation",
    title: "Validación del request",
    status: "ok",
    detail: `Campos completos: carrera ${req.programId}, modalidad ${req.modalityId}, CAU ${req.cauId} (se usa tal cual, sin overrides).${
      ignoredFields.length ? ` ${ignoredFields.join(" y ")} vino en el request pero v4 no lo usa.` : ""
    }`,
  });

  const { programId, modalityId, cauId } = req;
  const modalityName = MODALITY_NAMES[modalityId] ?? "sin mapeo en v4";

  // ── Paso 2: modalidades que derivan a asesor (9, 10, 12) ───────────────────
  if (ADVISOR_MODALITIES.has(modalityId)) {
    branch = "advisor";
    const output = req.llmInstruction !== "" ? req.llmInstruction : ADVISOR_MESSAGE;
    steps.push({
      id: "modality-check",
      title: "Chequeo de modalidad",
      status: "ok",
      detail: `La modalidad ${modalityId} (${modalityName}) deriva a asesor en v4: responde 200 sin pedir token ni consultar a Siglo 21${
        req.llmInstruction !== "" ? " (el output es el llm_instruction del request, que reemplaza el mensaje por defecto)" : ""
      }.`,
    });
    return finish(
      {
        code: "ADVISOR_MODALITY",
        httpEquivalent: 200,
        title: "Deriva a asesor — comportamiento esperado",
        explanation: `La modalidad ${modalityId} (${modalityName}) no cotiza en get-price-v4: el lambda responde 200 con la instrucción de derivar al estudiante a un asesor de Admisión, sin consultar a Siglo 21. No es una falla y no hay nada que reportar.`,
        responsible: "comportamiento_esperado",
      },
      { httpStatus: 200, body: { output } }
    );
  }

  branch = BIMESTER_MODALITIES.has(modalityId) ? "bimester" : "unsupported";

  steps.push({
    id: "modality-check",
    title: "Chequeo de modalidad",
    status: branch === "unsupported" ? "warning" : "ok",
    detail:
      branch === "bimester"
        ? `Modalidad ${modalityId} (${modalityName}) — rama bimestral (1, 2, 3, 4, 5, 7): período activo por tabla hardcodeada (o, si Siglo 21 no lo devuelve, el próximo de la tabla que sí vino) + alternativos ocultos.`
        : `La modalidad ${modalityId} (${modalityName}) no tiene lógica de precio en v4. El lambda NO la rechaza: igual pide token, turnos y períodos, y termina en 500.`,
  });

  // ── Paso 3: Token ──────────────────────────────────────────────────────────
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
      authError()
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
        explanation: `El servidor de autenticación de Siglo 21 (auth.ues21.edu.ar) no entregó un token válido: ${tokenOutcome.errorDetail}. get-price-v4 responde 401 "Authentication failed". Suele ser temporal del lado de Siglo 21; si persiste, reportarles adjuntando el detalle técnico.`,
        responsible: "siglo21",
      },
      authError()
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
    detail: `Token obtenido correctamente (igual que el lambda en cada consulta)${
      tokenOutcome.expiresIn ? ` — expira en ${tokenOutcome.expiresIn} segundos` : ""
    }.`,
  });

  // ── Paso 4: Turnos de cursado (se toma el PRIMER ítem) ─────────────────────
  const turnosUrl = `${BASE_URL}/variables/turnos-cursado/carrera/${programId}/modalidad/${modalityId}/cau/${encodeURIComponent(cauId)}`;
  const turnosOutcome = await timedFetch(turnosUrl, token);
  let schedules: ScheduleItem[] = [];
  let turnosError: string | undefined;
  if (!turnosOutcome.ok) {
    turnosError = describeHttpFailure(turnosOutcome);
  } else {
    try {
      schedules = decodeSchedules(turnosOutcome.body);
      if (schedules.length === 0) turnosError = "La API respondió HTTP 200 pero la lista de turnos vino VACÍA.";
    } catch (err) {
      turnosError = `La API respondió HTTP 200 pero el lambda no puede leerla: ${err instanceof Error ? err.message : String(err)}.`;
    }
  }

  if (turnosError) {
    steps.push({
      id: "turnos",
      title: "1/3 — Turnos de cursado",
      status: "fail",
      method: "GET",
      url: turnosUrl,
      httpStatus: turnosOutcome.httpStatus,
      durationMs: turnosOutcome.durationMs,
      rawResponse: truncate(turnosOutcome.body),
      detail: turnosError,
    });
    const tokenRejected = turnosOutcome.httpStatus === 401 || turnosOutcome.httpStatus === 403;
    const emptyList = turnosOutcome.ok && schedules.length === 0 && turnosError.includes("VACÍA");
    return finish(
      {
        code: "NO_SCHEDULES_AVAILABLE",
        httpEquivalent: 404,
        title: tokenRejected ? "Siglo 21 rechazó el token al pedir turnos" : "No hay turnos de cursado disponibles",
        explanation: tokenRejected
          ? `Siglo 21 rechazó el token recién emitido (HTTP ${turnosOutcome.httpStatus}) al consultar turnos. get-price-v4 no distingue este caso: responde 404 con la instrucción de error (el bot deriva a Admisión). Reportar a Siglo 21 adjuntando el detalle técnico.`
          : emptyList
            ? `Siglo 21 no tiene turnos cargados para la carrera ${programId}, modalidad ${modalityId}, CAU ${cauId}. get-price-v4 responde 404 y el bot deriva a Admisión. Verificar que la combinación carrera/modalidad/CAU sea correcta; si lo es, reportar a Siglo 21.`
            : `La consulta de turnos falló: ${turnosError} get-price-v4 responde 404 y el bot deriva a Admisión. Reportar a Siglo 21 con el detalle técnico.`,
        responsible: emptyList ? "config" : "siglo21",
      },
      businessError(404)
    );
  }

  const turnoCode = schedules[0].code;
  const turnoName = schedules[0].name;
  extra.turnoCode = turnoCode;
  extra.turnoName = turnoName;
  steps.push({
    id: "turnos",
    title: "1/3 — Turnos de cursado",
    status: "ok",
    method: "GET",
    url: turnosUrl,
    httpStatus: turnosOutcome.httpStatus,
    durationMs: turnosOutcome.durationMs,
    rawResponse: truncate(turnosOutcome.body),
    detail: `Siglo 21 devolvió ${schedules.length} turno(s). v4 usa el PRIMERO: "${turnoName}" (código ${turnoCode}).`,
  });

  // ── Paso 5: Períodos del turno ─────────────────────────────────────────────
  const periodosUrl = `${BASE_URL}/variables/periodos/carrera/${programId}/modalidad/${modalityId}/cau/${encodeURIComponent(cauId)}/turno/${encodeURIComponent(turnoCode)}`;
  const periodosOutcome = await timedFetch(periodosUrl, token);
  let apiPeriods: PeriodItem[] = [];
  let periodosError: string | undefined;
  if (!periodosOutcome.ok) {
    periodosError = describeHttpFailure(periodosOutcome);
  } else {
    try {
      apiPeriods = decodePeriods(periodosOutcome.body);
      if (apiPeriods.length === 0) periodosError = "La API respondió HTTP 200 pero la lista de períodos vino VACÍA.";
    } catch (err) {
      periodosError = `La API respondió HTTP 200 pero el lambda no puede leerla: ${err instanceof Error ? err.message : String(err)}.`;
    }
  }

  if (periodosError) {
    steps.push({
      id: "periodos",
      title: "2/3 — Períodos del turno",
      status: "fail",
      method: "GET",
      url: periodosUrl,
      httpStatus: periodosOutcome.httpStatus,
      durationMs: periodosOutcome.durationMs,
      rawResponse: truncate(periodosOutcome.body),
      detail: periodosError,
    });
    return finish(
      {
        code: "NO_PERIODS_AVAILABLE",
        httpEquivalent: 404,
        title: "El turno no tiene períodos",
        explanation:
          periodosOutcome.ok && apiPeriods.length === 0
            ? `Siglo 21 encontró el turno "${turnoName}" pero NO devolvió períodos. get-price-v4 responde 404 y el bot deriva a Admisión. Suele significar inscripción cerrada o períodos sin configurar del lado de Siglo 21.`
            : `La consulta de períodos falló: ${periodosError} get-price-v4 responde 404 y el bot deriva a Admisión. Reportar a Siglo 21 con el detalle técnico.`,
        responsible: "siglo21",
      },
      businessError(404)
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
    detail: `Siglo 21 devolvió ${apiPeriods.length} período(s): ${apiPeriods.map((p) => `${p.name || "?"}-${p.subPeriod || "?"}`).join(", ")}.`,
  });

  // Una fila por período de la API; el uso se completa según la rama.
  for (const p of apiPeriods) {
    periods.push({
      name: p.name,
      subPeriod: p.subPeriod,
      periodId: p.periodId,
      subPeriodId: p.subPeriodId,
      from: p.startDate,
      to: p.endDate,
      use: "ignored",
      useLabel: "v4 no lo cotiza",
    });
  }

  /** Llamada de precio de v4 (secuencial, con el turnoCode descubierto). */
  const fetchPrice = async (idx: number): Promise<PriceData | null> => {
    const p = apiPeriods[idx];
    const url = `${BASE_URL}/precios/carrera/${programId}/modalidad/${modalityId}/cau/${encodeURIComponent(cauId)}/turno/${encodeURIComponent(turnoCode)}/periodo/${p.periodId}/subperiodo/${p.subPeriodId}/codigo/${encodeURIComponent(p.subPeriod)}`;
    const outcome = await timedFetch(url, token);
    let price: PriceResponse | undefined;
    let errorDetail: string | undefined;
    if (!outcome.ok) {
      errorDetail = describeHttpFailure(outcome);
    } else {
      try {
        price = decodePrice(outcome.body);
      } catch (err) {
        errorDetail = `Respondió HTTP 200 pero el lambda no puede leerla: ${err instanceof Error ? err.message : String(err)}.`;
      }
    }
    periods[idx].fetch = {
      url,
      ok: Boolean(price),
      httpStatus: outcome.httpStatus,
      durationMs: outcome.durationMs,
      total: price?.total,
      totalListPrice: price?.totalPrecioLista,
      totalDiscounts: price?.totalDescuentos,
      rawResponse: truncate(outcome.body),
      errorDetail,
    };
    if (!price) return null;
    return { periodName: p.name, subPeriod: p.subPeriod, startDate: p.startDate, endDate: p.endDate, price };
  };

  const priceData: PriceDataMap = {};
  let partialFailures = 0;

  // ── Paso 6: Rama bimestral (1, 2, 3, 4, 5, 7) ──────────────────────────────
  if (branch === "bimester") {
    const activeKey = getActiveEdEhdPeriodKey(now);
    for (const row of periods) {
      const key = buildEdEhdPeriodKey(row.name, row.subPeriod);
      if (key) {
        row.key = key;
        row.keyLabel = ED_EHD_PERIODS[key]?.nombre;
        row.coverageLabel = buildPeriodCoverageLabel(key, { startDate: row.from, endDate: row.to }) || undefined;
      }
    }

    if (!activeKey) {
      steps.push({
        id: "periodo-activo",
        title: "Selección del período activo (tabla del lambda)",
        status: "fail",
        detail: `Ninguna ventana de venta de la tabla hardcodeada contiene el día UTC ${now.toISOString().slice(0, 10)}. El lambda corta acá con 500 (no consulta precios).`,
      });
      return finish(
        {
          code: "NO_ACTIVE_ED_EHD_PERIOD",
          httpEquivalent: 500,
          title: "La tabla de períodos bimestrales del lambda no cubre la fecha de hoy",
          explanation: `get-price-v4 busca el período activo en su tabla hardcodeada (${ED_EHD_PERIOD_ORDER.join(", ")}) y hoy no cae en ninguna ventana de venta. Responde 500 y el bot deriva a Admisión. Hay que cargar las fechas del ciclo nuevo en el lambda — no es un problema de Siglo 21.`,
          responsible: "middleware",
        },
        businessError(500)
      );
    }

    const activeInfo = ED_EHD_PERIODS[activeKey];
    const activeName = activeInfo?.nombre || activeKey;
    extra.activePeriodKey = activeKey;

    // resolveV4PrimaryPeriod: el activo si vino; si no, el primero posterior de la tabla que vino.
    const resolved = resolveV4PrimaryPeriod(activeKey, periods);
    if (!resolved) {
      const activeIdx = ED_EHD_PERIOD_ORDER.indexOf(activeKey);
      for (const row of periods) {
        const idx = row.key ? ED_EHD_PERIOD_ORDER.indexOf(row.key) : -1;
        row.useLabel = !row.key
          ? "Ignorado: no se puede armar la clave (name/subperiod)"
          : idx === -1
            ? `Ignorado: ${row.key} no está en la tabla del lambda`
            : idx < activeIdx
              ? `Ignorado: anterior al período activo ${activeKey}`
              : "Ignorado";
      }
      const outsideTable = periods.some((r) => !r.key || !ED_EHD_PERIOD_ORDER.includes(r.key));
      steps.push({
        id: "periodo-activo",
        title: "Selección del período principal (tabla del lambda)",
        status: "fail",
        detail: `La tabla indica que el activo es ${activeKey} (${activeName}), pero Siglo 21 no devolvió ese período ni uno posterior de la tabla (${ED_EHD_PERIOD_ORDER.slice(Math.max(activeIdx, 0)).join(", ")}). El lambda corta acá con 500 (no consulta precios).`,
      });
      return finish(
        {
          code: "NO_ACTIVE_OR_NEXT_PERIOD",
          httpEquivalent: 500,
          title: "Siglo 21 no devolvió el período activo ni uno posterior",
          explanation: `get-price-v4 cotiza el período activo de su tabla (${activeKey}, ${activeName}) o, si no vino, el próximo de la tabla que sí vino. Siglo 21 devolvió solo ${periods.map((r) => r.key || `${r.name || "?"}-${r.subPeriod || "?"}`).join(", ")}${outsideTable ? " (incluye períodos fuera de la tabla del lambda)" : ""}, así que no cotiza un período desconocido: responde 500 con la instrucción de error y el bot deriva a Admisión. ${outsideTable ? "Si Siglo 21 ya abrió un período nuevo, hay que cargarlo en la tabla del lambda." : "Verificar con Siglo 21 si el período activo debería estar habilitado para esta carrera/modalidad/CAU."}`,
          responsible: outsideTable ? "middleware" : "siglo21",
        },
        businessError(500)
      );
    }

    const primaryIdx = resolved.index;
    const primaryKey = resolved.key;
    const isNextPeriod = primaryKey !== activeKey;
    const primaryInfo = ED_EHD_PERIODS[primaryKey];
    const primaryName = primaryInfo?.nombre || primaryKey;
    const nextPeriodNotice = buildNextPeriodNotice(primaryKey, activeKey);
    extra.primaryPeriodKey = primaryKey;
    extra.primaryPeriodName = primaryInfo?.nombre;
    const primaryRow = periods[primaryIdx];
    steps.push({
      id: "periodo-activo",
      title: "Selección del período principal (tabla del lambda)",
      status: isNextPeriod ? "warning" : "ok",
      detail: isNextPeriod
        ? `La tabla indica que el activo es ${activeKey} (${activeName}), pero Siglo 21 NO devolvió ese período. v4 cotiza el próximo período de la tabla que sí vino: ${primaryKey} (${primaryName}), con sus propios nombre, fechas y meses, y agrega la aclaración: "${nextPeriodNotice}"`
        : `Período activo según la tabla hardcodeada (regla HF-0113): ${activeKey} (${activeName}), ventana ${activeInfo?.fechaInicio} → ${activeInfo?.fechaFin}${activeInfo?.fechaExtension ? ` con extensión hasta ${activeInfo.fechaExtension}` : ""}. Es el precio que ve el estudiante; el resto queda como alternativo oculto.`,
    });

    primaryRow.use = "primary";
    primaryRow.useLabel = isNextPeriod
      ? `Principal: próximo período disponible (no vino el activo ${activeKey})`
      : "Principal (el que ve el estudiante)";
    const primaryPd = await fetchPrice(primaryIdx);
    if (!primaryPd) {
      steps.push({
        id: "precios",
        title: "3/3 — Precio del período principal",
        status: "fail",
        detail: `Falló el precio del período principal (${primaryRow.name}-${primaryRow.subPeriod}): ${primaryRow.fetch?.errorDetail}. El lambda corta acá con 500 y NO consulta los alternativos.`,
      });
      for (const row of periods) if (row !== primaryRow) row.useLabel = "No consultado: el lambda cortó al fallar el principal";
      return finish(
        {
          code: "PRICE_FETCH_ERROR",
          httpEquivalent: 500,
          title: "Siglo 21 no devolvió el precio del período principal",
          explanation: `Turnos y períodos existen, pero la API de precios falló para el período principal ${primaryRow.name}-${primaryRow.subPeriod}. get-price-v4 responde 500 (aunque haya otros períodos) y el bot deriva a Admisión. Reportar a Siglo 21 con el detalle técnico.`,
          responsible: "siglo21",
        },
        businessError(500)
      );
    }
    priceData["primary"] = primaryPd;

    // Alternativos: secuenciales; los que fallan se omiten en silencio.
    for (let i = 0; i < periods.length; i++) {
      const row = periods[i];
      if (row === primaryRow) continue;
      if (row.periodId === primaryRow.periodId && row.subPeriodId === primaryRow.subPeriodId) {
        row.useLabel = "Omitido: mismos IDs que el principal";
        continue;
      }
      if (!row.key) {
        row.useLabel = "Omitido: no se puede armar la clave (name/subperiod)";
        continue;
      }
      if (priceData[ALT_PERIOD_PREFIX + row.key]) {
        row.useLabel = `Omitido: la clave ${row.key} ya se cotizó`;
        continue;
      }
      const shown = ED_EHD_PERIOD_ORDER.includes(row.key);
      row.use = shown ? "alternative" : "alternative_not_shown";
      const pd = await fetchPrice(i);
      if (!pd) {
        partialFailures++;
        row.useLabel = "Alternativo — FALLÓ el precio, se omite en silencio";
        continue;
      }
      priceData[ALT_PERIOD_PREFIX + row.key] = pd;
      row.useLabel = shown
        ? "Alternativo oculto (si rechaza el principal o pregunta por otro inicio)"
        : `Cotizado pero NO se muestra (${row.key} no está en la tabla del lambda)`;
    }

    const alts = shownEdEhdAlternatives(priceData);
    steps.push({
      id: "precios",
      title: "3/3 — Precios (principal + alternativos)",
      status: partialFailures > 0 ? "warning" : "ok",
      detail: `Precio principal OK (${money(primaryPd.price.total)}). Alternativos que ve el bot: ${alts.length}${
        partialFailures > 0 ? `. ${partialFailures} alternativo(s) fallaron y el lambda los omite en silencio` : ""
      }.`,
    });

    const cuota6 = round2(primaryPd.price.total / 6);
    extra.quote = {
      kind: "bimester",
      periodKey: primaryKey,
      periodName: primaryName,
      total: primaryPd.price.total,
      cuota6,
      cuota3: round2(primaryPd.price.total / 3),
      coverageLabel: buildPeriodCoverageLabel(primaryKey, primaryPd),
      courseCoverageLine: buildCourseCoverageLine(programId, primaryKey, primaryPd),
      activePeriodKey: activeKey,
      nextPeriodNotice,
      alternatives: alts.map((a) => ({
        key: a.key,
        name: ED_EHD_PERIODS[a.key]?.nombre || a.key,
        total: a.pd.price.total,
        cuota6: round2(a.pd.price.total / 6),
        cuota3: round2(a.pd.price.total / 3),
        coverageLabel: buildPeriodCoverageLabel(a.key, a.pd),
      })),
    };

    const output = formatPriceResponseV4(priceData, modalityId, req, now);
    return finish(
      partialFailures > 0
        ? {
            code: "OK_PARTIAL",
            httpEquivalent: 200,
            title: "Precio obtenido, pero con alternativos omitidos",
            explanation: `El bot SÍ recibió precio de ${primaryName} (6 cuotas de ${money(cuota6)}), pero ${partialFailures} período(s) alternativos fallaron en Siglo 21 y se omitieron en silencio.${
              isNextPeriod ? ` Ojo: Siglo 21 no devolvió el activo ${activeKey}, así que se cotiza el próximo período disponible (${primaryKey}).` : ""
            }`,
            responsible: "siglo21",
          }
        : {
            code: "OK",
            httpEquivalent: 200,
            title: isNextPeriod ? "Precio obtenido — próximo período disponible" : "Todo funcionó correctamente",
            explanation: isNextPeriod
              ? `get-price-v4 responde 200 con precio de ${primaryName} (${primaryKey}): 6 cuotas de ${money(cuota6)}. Siglo 21 no devolvió el período activo ${activeKey} (${activeName}) para esta carrera/modalidad, así que v4 cotiza el próximo período disponible y el bot lo aclara ("${nextPeriodNotice}"). No es una falla.`
              : `get-price-v4 responde 200 con precio de ${primaryName}: 6 cuotas de ${money(cuota6)}${alts.length ? ` y ${alts.length} alternativo(s) oculto(s)` : ""}. Si el bot no dio precio en la conversación, el problema no fue esta consulta en este momento (pudo ser temporal o de otro punto del flujo).`,
            responsible: isNextPeriod ? "comportamiento_esperado" : "nadie",
          },
      { httpStatus: 200, body: { output } }
    );
  }

  // ── Modalidad sin lógica de precio en v4 → 500 ─────────────────────────────
  // getPricesByModalityV4 no cotiza nada: "no prices could be obtained for any period".
  for (const r of periods) r.useLabel = "Ignorado: modalidad sin lógica de precio en v4";
  steps.push({
    id: "precios",
    title: "3/3 — Precios",
    status: "fail",
    detail: `La modalidad ${modalityId} no entra en ninguna rama de precio de v4: no se consulta ningún precio y el lambda responde 500.`,
  });
  return finish(
    {
      code: "UNSUPPORTED_MODALITY",
      httpEquivalent: 500,
      title: "Modalidad no soportada en get-price-v4",
      explanation: `get-price-v4 solo cotiza las modalidades 1, 2, 3, 4, 5 y 7 (lógica bimestral) y deriva 9, 10 y 12. La modalidad ${modalityId} pasa la validación, consume token + turnos + períodos y termina en 500 (el bot deriva a Admisión). Verificar que el modality_id que envía la tool sea el correcto según el mapeo oficial.`,
      responsible: "config",
    },
    businessError(500)
  );
}
