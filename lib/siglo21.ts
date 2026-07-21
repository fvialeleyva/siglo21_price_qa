// Réplica del flujo get-price-v5 del lambda siglo21-price-proxy, con fines de
// diagnóstico: en lugar de retornar solo el precio o un error, registra cada
// paso (URL, status HTTP, respuesta cruda, duración) para que se pueda ver
// exactamente dónde y por qué falló la consulta contra la API de Siglo 21.

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
  totalDurationMs: number;
}

// ── Mapeos (mismos que el lambda) ─────────────────────────────────────────────

export const MODALITY_NAMES: Record<number, string> = {
  1: "DISTANCIA - ED HOME [EDH]",
  2: "DISTANCIA - EDUCACIÓN DISTRIBUIDA [ED]",
  5: "PRESENCIAL HOME [PH - CÓRDOBA]",
  7: "PRESENCIAL HOME RÍO IV [PH - RIVO]",
  9: "PRESENCIAL",
  10: "PRESENCIAL RÍO IV",
  12: "PRESENCIAL DISTRIBUIDA [PD]",
};

const PRESENCIAL_MODALITIES = new Set([5, 9, 10, 12]);

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
    totalDurationMs: Date.now() - startedAt,
    ...extra,
  });

  // ── Paso 1: Validación de campos (igual que validatePricingRequestV4) ──────
  const missing: string[] = [];
  const cauId = typeof raw.cau_id === "string" ? raw.cau_id.trim() : "";
  const modalityId = typeof raw.modality_id === "number" ? raw.modality_id : NaN;
  const programId = typeof raw.program_id === "number" ? raw.program_id : NaN;

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
        explanation: `La modalidad ${modalityId} (${MODALITY_NAMES[modalityId]}) es presencial y por diseño NO tiene precio online: el bot debe derivar al estudiante a un asesor de Admisión. Esto no es una falla — es el comportamiento configurado. No hay nada que reportar a Siglo 21.`,
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
            : `La consulta de turnos a Siglo 21 falló: ${reason}. Este es el primer paso de la consulta de precio, así que el bot no pudo dar precio. Reportar a Siglo 21 con el detalle técnico.`,
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

  // ── Paso 6: Precios por período (secuencial, igual que el lambda) ──────────
  for (const item of periodItems) {
    const periodId = item.period?.id ?? 0;
    const subPeriodId = item.id;
    const subPeriod = item.subperiod ?? "";
    const periodName = item.name ?? item.period?.name ?? "?";

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
        explanation: `Los turnos y períodos existen, pero la API de precios de Siglo 21 falló para TODOS los períodos (${periodPrices.length}). El bot no pudo dar precio. Puede ser un error temporal de Siglo 21 o que los períodos no estén activos en su configuración de precios. Reportar a Siglo 21 adjuntando los errores de cada período (detalle técnico abajo).`,
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
      detail: `${okCount} período(s) con precio OK, pero ${failCount} período(s) fallaron y el middleware los OMITE EN SILENCIO (no aparecen en la respuesta del bot). Ver detalle por período.`,
    });
    return finish(
      {
        code: "OK_PARTIAL",
        httpEquivalent: 200,
        title: "Precio obtenido, pero con períodos omitidos",
        explanation: `El bot SÍ recibió precio (${okCount} de ${periodPrices.length} períodos), pero ${failCount} período(s) fallaron en Siglo 21 y se omitieron en silencio. Si el estudiante preguntaba por uno de los períodos omitidos, el bot no tenía ese dato. Revisar el detalle por período para ver cuáles fallaron y por qué.`,
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
      explanation: `La consulta completa funcionó: hay turno, ${periodPrices.length} período(s) y todos con precio. Si el bot no dio precio en la conversación, el problema NO fue esta consulta a Siglo 21 en este momento — pudo ser un error temporal en el momento de la conversación, o un problema en otro punto del flujo del bot.`,
      responsible: "nadie",
    },
    input,
    { turnoCode, turnoName }
  );
}
