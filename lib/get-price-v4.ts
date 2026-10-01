// Port fiel (lógica pura, sin red) de get-price-v4 del lambda siglo21-price-proxy,
// rama feat/v4-next-period-fallback (sobre PR #22 de conversia-legacy-lambdas):
// pkg/services/pricing-service.go → HandleGetPriceV4, getPricesByModalityV4,
// FormatPriceResponseByModalityV4 / formatPriceResponseByModalityV3 (isV4 = true)
// y helpers.
//
// Todo lo que depende del reloj recibe `now` como parámetro para poder probarlo
// con fechas fijas; en producción la herramienta pasa `new Date()` (igual que el
// lambda usa time.Now()). Mantener en sync con el lambda: cualquier cambio de
// textos, tablas o reglas allá debe replicarse acá.

// ── Request v4 ────────────────────────────────────────────────────────────────

export interface V4Request {
  programId: number;
  modalityId: number;
  cauId: string;
  llmInstruction: string;
  llmInstructionError: string;
  /** undefined = no vino en el request (el lambda lo toma como true) */
  includePaymentMethods?: boolean;
  customPaymentMethodsInfo: string;
  /** undefined = no vino en el request (el lambda lo toma como true) */
  includeRestrictions?: boolean;
  customRestrictions: string;
}

// ── Modelos de precio (models/sigloxxi.go) ────────────────────────────────────

export interface PriceDiscount {
  motivo: string;
  porcentaje: number;
  monto: number;
}

export interface PriceItem {
  nombre: string;
  precioLista: number;
  descuentos: PriceDiscount[];
}

export interface PriceResponse {
  total: number;
  totalPrecioLista: number;
  totalDescuentos: number;
  items: PriceItem[];
}

export interface PriceData {
  periodName: string;
  subPeriod: string;
  startDate: string;
  endDate: string;
  price: PriceResponse;
}

/**
 * Mismas claves que el map[string]*PriceData del lambda en v4:
 * "primary" y "alt::<clave>" (modalidades bimestrales 1, 2, 3, 4, 5, 7).
 */
export type PriceDataMap = Record<string, PriceData>;

export const ALT_PERIOD_PREFIX = "alt::";

// ── Modalidades (mapeo oficial de Siglo 21) ───────────────────────────────────

export const MODALITY_NAMES: Record<number, string> = {
  1: "DISTANCIA - ED HOME [EDH]",
  2: "DISTANCIA - EDUCACIÓN DISTRIBUIDA [ED]",
  3: "PRESENCIAL",
  4: "PRESENCIAL HOME [PH - CÓRDOBA]",
  5: "PRESENCIAL HOME RÍO IV [PH - RÍO IV]",
  7: "PRESENCIAL HOME RÍO IV (ID previo al mapeo oficial)",
  9: "PRESENCIAL (ID previo al mapeo oficial)",
  10: "PRESENCIAL RÍO IV",
  12: "PRESENCIAL DISTRIBUIDA [PD]",
};

/** HandleGetPriceV4: derivan a asesor (200) sin consultar a Siglo 21. */
export const ADVISOR_MODALITIES = new Set([9, 10, 12]);
/**
 * v4BimesterModalities: lógica bimestral con tabla hardcodeada (regla HF-0113).
 * Distancia (1, 2) + presenciales del mapeo oficial (3, 4, 5) + la 7 (ID previo),
 * que usan la misma tabla de venta y extensión.
 */
export const BIMESTER_MODALITIES = new Set([1, 2, 3, 4, 5, 7]);

export const ADVISOR_MESSAGE =
  "Indicale al estudiante que para conocer el arancel y las opciones de inscripción de esta modalidad debe comunicarse directamente con un asesor de Admisión. No inventes ni estimes precios. Ofrecé derivarlo al equipo de Admisión para que le brinden toda la información completa.";

export const DEFAULT_LLM_INSTRUCTION_ERROR =
  "[INSTRUCCIÓN DE ERROR — OBLIGATORIA]\n\nNo obtuviste información de precios o aranceles del sistema para esta carrera o modalidad.\n\n✅ CHECKLIST — LO QUE DEBES HACER (verificá cada punto antes de responder):\n□ Informale al estudiante que en este momento no tenés el dato disponible en el sistema.\n□ Ofrecele derivarlo al equipo de Admisión para obtener toda la información completa.\n□ Usá un tono empático, cálido y de acompañamiento.\n□ Cerrá con una pregunta de cierre, por ejemplo: \"¿Querés que te conecte con un asesor de Admisión que te ayude con esto?\"\n\n🚫 CHECKLIST — LO QUE JAMÁS DEBES HACER (verificá que ninguno aplique a tu respuesta):\n□ JAMÁS inventes, supongas, estimes ni calcules ningún precio, arancel, cuota o monto.\n□ JAMÁS menciones números relacionados a costos, aunque sean aproximados o referenciales.\n□ JAMÁS uses frases como \"debería costar\", \"aproximadamente\", \"suele ser\", \"normalmente cuesta\".\n□ JAMÁS menciones que no hay precios, fechas o turnos disponibles.\n□ JAMÁS menciones que el sistema falló, tuvo un error o no respondió.\n□ JAMÁS ofrezcas buscar el precio por otra vía ni estimes cuándo estará disponible.\n\n⚠️ VERIFICACIÓN FINAL — Antes de enviar tu respuesta, confirmá punto por punto:\n1. ¿Tu respuesta contiene algún número o monto económico? → Si SÍ: eliminalo completamente.\n2. ¿Tu respuesta menciona cuotas, aranceles o precios de alguna manera? → Si SÍ: eliminalo.\n3. ¿Tu respuesta ofrece derivar al equipo de Admisión? → Si NO: agregalo obligatoriamente.\n4. ¿Tu respuesta menciona un problema técnico, error de sistema o falta de datos? → Si SÍ: eliminalo.\n\n[FIN INSTRUCCIÓN DE ERROR]";

/** Texto exacto que devuelve el formateador cuando ninguna rama arma bloque de precio. */
const UNDETERMINED_TARIFF_OUTPUT = "No se pudo determinar el tipo de arancel para esta modalidad.";

// ── Formato numérico idéntico a Go ────────────────────────────────────────────

/** math.Round(x*100)/100 de Go (redondeo "half away from zero"). */
export function round2(x: number): number {
  return (Math.sign(x) * Math.round(Math.abs(x) * 100)) / 100;
}

/**
 * fmt.Sprintf("%.Nf") de Go. Difiere de toFixed solo en empates exactos
 * (Go redondea al par: 12.5 → "12" con %.0f; toFixed daría "13").
 */
export function goFixed(x: number, digits: number): string {
  const scale = 10 ** digits;
  const scaled = x * scale;
  if (Number.isFinite(scaled) && Math.abs(scaled % 1) === 0.5) {
    const floor = Math.floor(scaled);
    const even = floor % 2 === 0 ? floor : floor + 1;
    return (even / scale).toFixed(digits);
  }
  return x.toFixed(digits);
}

const f2 = (x: number) => goFixed(x, 2);

// ── Tabla bimestral (edEhdPeriods / edEhdPeriodOrder) ─────────────────────────

export interface BimesterPeriodInfo {
  fechaInicio: string; // inicio ventana de venta (dd/mm/yyyy)
  fechaFin: string; // fin ventana de venta oficial (dd/mm/yyyy)
  fechaExtension: string; // límite de extensión de venta (dd/mm/yyyy) — "" si no hay
  inicioClases: string; // inicio de clases (dd/mm/yyyy)
  nombre: string; // nombre legible (ej: "agosto 2026")
}

export const ED_EHD_PERIODS: Record<string, BimesterPeriodInfo> = {
  "1A/26": { fechaInicio: "25/08/2025", fechaFin: "15/03/2026", fechaExtension: "29/03/2026", inicioClases: "16/03/2026", nombre: "marzo 2026" },
  "1B/26": { fechaInicio: "16/03/2026", fechaFin: "17/05/2026", fechaExtension: "31/05/2026", inicioClases: "18/05/2026", nombre: "mayo 2026" },
  "2A/26": { fechaInicio: "18/05/2026", fechaFin: "02/08/2026", fechaExtension: "16/08/2026", inicioClases: "03/08/2026", nombre: "agosto 2026" },
  "2B/26": { fechaInicio: "03/08/2026", fechaFin: "04/10/2026", fechaExtension: "18/10/2026", inicioClases: "05/10/2026", nombre: "octubre 2026" },
  "1A/27": { fechaInicio: "28/07/2026", fechaFin: "14/03/2027", fechaExtension: "", inicioClases: "15/03/2027", nombre: "marzo 2027" },
};

export const ED_EHD_PERIOD_ORDER = ["1A/26", "1B/26", "2A/26", "2B/26", "1A/27"];

function parseDdMmYyyy(value: string): number | null {
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

/** time.Now().UTC().Truncate(24h) */
function truncateUtcDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * getActiveEdEhdPeriodsAt (ticket HF-0113): primer período, en orden de inicio
 * de clases, cuya ventana de venta —incluida la extensión— contiene el día UTC
 * de `now`. Ambos extremos inclusivos. "" si ninguno.
 */
export function getActiveEdEhdPeriodKey(now: Date): string {
  const today = truncateUtcDay(now);
  for (const key of ED_EHD_PERIOD_ORDER) {
    const info = ED_EHD_PERIODS[key];
    const inicio = parseDdMmYyyy(info.fechaInicio);
    const cierre = parseDdMmYyyy(info.fechaExtension || info.fechaFin);
    if (inicio === null || cierre === null) continue;
    if (today < inicio || today > cierre) continue;
    return key;
  }
  return "";
}

/** buildEdEhdPeriodKey: "1/27" + "A" → "1A/27". */
export function buildEdEhdPeriodKey(periodName: string, subperiod: string): string {
  if (!periodName || !subperiod) return "";
  const idx = periodName.indexOf("/");
  if (idx === -1) return "";
  const a = periodName.slice(0, idx);
  const b = periodName.slice(idx + 1);
  if (!a || !b) return "";
  return `${a}${subperiod}/${b}`;
}

/**
 * resolveV4PrimaryPeriod: elige el período principal de V4 entre los que devolvió
 * la API: el activo de la tabla si vino; si no, el primero posterior al activo
 * (en orden de ED_EHD_PERIOD_ORDER) que sí vino. Ej: activo 2B/26 y la API
 * devuelve solo 1/27 A → 1A/27. Si no hay ninguno de esos, devuelve null (se
 * deriva). `index` es la posición del primer período de la API con esa clave.
 */
export function resolveV4PrimaryPeriod(
  activeKey: string,
  periods: { name: string; subPeriod: string }[]
): { index: number; key: string } | null {
  const byKey = new Map<string, number>();
  periods.forEach((p, idx) => {
    const key = buildEdEhdPeriodKey(p.name, p.subPeriod);
    if (key !== "" && !byKey.has(key)) byKey.set(key, idx);
  });
  const activeIdx = ED_EHD_PERIOD_ORDER.lastIndexOf(activeKey);
  if (activeIdx === -1) return null;
  for (const key of ED_EHD_PERIOD_ORDER.slice(activeIdx)) {
    const index = byKey.get(key);
    if (index !== undefined) return { index, key };
  }
  return null;
}

/** periodCycle: "2B/26" → "26". */
function periodCycle(periodKey: string): string {
  const idx = periodKey.lastIndexOf("/");
  return idx === -1 ? "" : periodKey.slice(idx + 1);
}

/**
 * buildNextPeriodNotice: aclaración que se muestra cuando V4 cotiza un período
 * posterior al activo porque la API no devolvió el activo. Si el período es de
 * otro ciclo se aclara que es para el próximo año. "" si es el activo.
 */
export function buildNextPeriodNotice(primaryKey: string, activeKey: string): string {
  if (primaryKey === "" || primaryKey === activeKey) return "";
  const nombre = ED_EHD_PERIODS[primaryKey]?.nombre || primaryKey;
  if (periodCycle(primaryKey) !== periodCycle(activeKey)) {
    return `Para esta carrera y modalidad, la inscripción disponible es para el próximo año: las clases comienzan en ${nombre}.`;
  }
  return `Para esta carrera y modalidad, el próximo inicio disponible es en ${nombre}.`;
}

// ── Cobertura de cursado (V4) ─────────────────────────────────────────────────

const PROGRAM_DEGREE_TYPES: Record<number, "licenciatura" | "tecnicatura"> = {
  8416: "licenciatura",
  12: "licenciatura",
  1865: "tecnicatura",
  7590: "licenciatura",
  8720: "licenciatura",
  26: "licenciatura",
  8738: "licenciatura",
  5570: "licenciatura",
  22: "licenciatura",
  23: "licenciatura",
  5550: "tecnicatura",
  586: "tecnicatura",
  1912: "tecnicatura",
  4942: "tecnicatura",
};

function getCoveredSubjects(programId: number, periodKey: string): number | null {
  const degreeType = PROGRAM_DEGREE_TYPES[programId];
  if (!degreeType) return null;
  const isB = periodKey.length >= 2 && periodKey[1] === "B";
  if (degreeType === "tecnicatura") return isB ? 2 : 4;
  return isB ? 3 : 6;
}

const SPANISH_MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** parsePeriodDate: mismos layouts que el lambda. Devuelve {year, month} literales. */
function parsePeriodDate(value: string): { year: number; month: number } | null {
  const v = value.trim();
  if (!v) return null;
  const iso =
    v.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/) ??
    v.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(\.\d+)?$/) ??
    v.match(/^(\d{4})-(\d{2})-(\d{2}) \d{2}:\d{2}:\d{2}(\.\d+)?$/) ??
    v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const month = Number(iso[2]);
    if (month < 1 || month > 12) return null;
    return { year: Number(iso[1]), month };
  }
  const dmy = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) {
    const month = Number(dmy[2]);
    if (month < 1 || month > 12) return null;
    return { year: Number(dmy[3]), month };
  }
  return null;
}

function formatMonthYear(value: string): string | null {
  const p = parsePeriodDate(value);
  return p ? `${SPANISH_MONTHS[p.month - 1]} ${p.year}` : null;
}

/** edEhdCoverageMonths: regla comercial fija por bimestre. */
export function edEhdCoverageMonths(periodKey: string): [string, string] | null {
  if (periodKey.length < 2) return null;
  const k = periodKey.slice(0, 2);
  if (k === "1A") return ["marzo", "julio"];
  if (k === "1B") return ["mayo", "julio"];
  if (k === "2A") return ["agosto", "diciembre"];
  if (k === "2B") return ["octubre", "diciembre"];
  return null;
}

function edEhdPeriodYear(periodKey: string): number {
  const idx = periodKey.lastIndexOf("/");
  if (idx === -1) return 0;
  const tail = periodKey.slice(idx + 1);
  if (!/^[+-]?\d+$/.test(tail)) return 0;
  return 2000 + Number(tail);
}

/** buildPeriodCoverageLabel: "octubre 2026 a diciembre 2026". */
export function buildPeriodCoverageLabel(periodKey: string, pd?: { startDate: string; endDate: string }): string {
  const months = edEhdCoverageMonths(periodKey);
  if (months) {
    const year = edEhdPeriodYear(periodKey);
    if (year !== 0) return `${months[0]} ${year} a ${months[1]} ${year}`;
  }
  if (!pd) return "";
  const start = formatMonthYear(pd.startDate);
  const end = formatMonthYear(pd.endDate);
  if (!start || !end) return "";
  return `${start} a ${end}`;
}

/** buildCourseCoverageLine (solo V4). "" si no aplica. */
export function buildCourseCoverageLine(programId: number, periodKey: string, pd?: PriceData): string {
  const subjects = getCoveredSubjects(programId, periodKey);
  if (subjects === null || !pd || !periodKey) return "";
  let year = 0;
  if (pd.startDate) {
    const parsed = parsePeriodDate(pd.startDate);
    if (parsed) year = parsed.year;
  }
  if (year === 0) year = edEhdPeriodYear(periodKey);
  if (year === 0) return "";
  const months = edEhdCoverageMonths(periodKey);
  if (!months) return "";
  return `Te cuento, nuestro arancel es integral y es por periodo de cursado. Ahora abonarías el periodo de ${months[0]} ${year} a ${months[1]} ${year} que te cubre hasta ${subjects} materias`;
}

// ── Bloques de texto (copias literales del lambda) ────────────────────────────

const SPANISH_WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** buildTodayLine: fecha en hora Argentina fija (UTC-3). */
export function buildTodayLine(now: Date): string {
  const art = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const dd = String(art.getUTCDate()).padStart(2, "0");
  const mm = String(art.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = art.getUTCFullYear();
  return `Fecha de HOY: ${SPANISH_WEEKDAYS[art.getUTCDay()]} ${dd}/${mm}/${yyyy} — usá esta fecha como única referencia temporal para cualquier cálculo o mención de plazos, inicios de clases o períodos.\n`;
}

/** boldOptional: envuelve el texto en negrita markdown; "" si no hay texto. */
function boldOptional(text: string): string {
  return text === "" ? "" : `**${text}**`;
}

function formatOptionalPromptLine(line: string): string {
  return line === "" ? "" : line + "\n";
}

function createPriceNoteV2(p: PriceResponse): string {
  let s = "";
  s += "[INFORMACIÓN DETALLADA DEL PRECIO (Referencia interna — NO mostrar salvo pedido explícito)\n";
  s += "Úsalo solo si el usuario pide: \"precio total/descuento total\", \"matrícula y arancel\", \"descuento aplicado/precio de lista\".\n";
  s += "REGLAS:\n";
  s += "- TODOS los importes de esta sección corresponden ÚNICAMENTE al **período de cursado activo** (matrícula + aranceles), NO al costo total de la carrera completa.\n";
  s += "- Esta herramienta NO dispone del costo total de la carrera completa. Si el usuario pregunta cuánto cuesta toda la carrera, NUNCA presentes estos montos como \"precio total de la carrera\": explicá que el arancel es por período de cursado y ofrecé derivar a un asesor de Admisión.\n";
  s += "- Muestra **exactamente** los importes tal como figuran (sin redondear, estimar ni recalcular).\n";
  s += "- Si un dato no está, responde: \"En este momento no tengo ese detalle exacto.\" y ofrece derivar a Admisiones.\n\n";
  s += "DETALLES DISPONIBLES (del período de cursado activo)\n";
  s += "--------------------\n";
  s += `• Precio total del período de cursado activo (NO de la carrera completa): $${f2(p.total)}\n`;
  s += `• Descuento total del período de cursado activo: $${f2(p.totalDescuentos)}\n`;
  s += `• Precio lista total del período de cursado activo: $${f2(p.totalPrecioLista)}\n\n`;
  s += "ÍTEMS INCLUIDOS\n";
  s += "---------------\n";
  for (const item of p.items) {
    s += `• ${item.nombre}\n`;
    s += `  - Precio de lista: $${f2(item.precioLista)}\n`;
    if (item.descuentos.length > 0) {
      s += "  - Descuentos aplicados:\n";
      for (const d of item.descuentos) {
        s += `    • ${d.motivo}: ${goFixed(d.porcentaje, 0)}% ($${f2(d.monto)})\n`;
      }
    }
  }
  s += "\nRESTRICCIONES ADICIONALES:\n";
  s += "- NO ofrezcas links directos de inscripción/pago.\n";
  s += "- Si después de presentar el precio el usuario quiere inscribirse/pagar ya, deriva al equipo de Admisiones.]\n";
  return s;
}

/** buildPaymentAndRestrictionsContext: los textos por defecto están comentados en el lambda. */
function buildPaymentAndRestrictionsContext(req: V4Request): string {
  let s = "";
  if (req.includePaymentMethods ?? true) s += "\n" + req.customPaymentMethodsInfo + "\n";
  if (req.includeRestrictions ?? true) s += "\n" + req.customRestrictions + "\n";
  return s;
}

/** Alternativos que el formateador MUESTRA: solo claves de la tabla, en su orden. */
export function shownEdEhdAlternatives(priceData: PriceDataMap): { key: string; pd: PriceData }[] {
  const out: { key: string; pd: PriceData }[] = [];
  for (const key of ED_EHD_PERIOD_ORDER) {
    const pd = priceData[ALT_PERIOD_PREFIX + key];
    if (pd) out.push({ key, pd });
  }
  return out;
}

function buildEdEhdAlternativesContext(priceData: PriceDataMap): string {
  const alts = shownEdEhdAlternatives(priceData);
  if (alts.length === 0) return "";
  let b = "";
  b += "\n\n═══════════════════════════════════════════════════════════════\n";
  // Encabezado de V4 (isV4 = true en el lambda): también si pregunta por otro inicio / el próximo año.
  b += "📅 PERÍODOS ALTERNATIVOS (Referencia interna — NO mostrar salvo que el usuario rechace el período principal o pregunte por otro inicio / el próximo año):\n";
  b += "═══════════════════════════════════════════════════════════════\n";
  b += "Usar SOLO si el estudiante no puede o no quiere el período principal, o si pregunta explícitamente por otro inicio o por el próximo año (en ese caso, dale el precio del período que pide aunque el principal siga disponible). Ofrecé uno a la vez, con el mismo formato del bloque de precio principal.\n";
  b += "Al ofrecer cualquiera de estas opciones, aclarale SIEMPRE al estudiante qué meses de cursado abarca ese período (dato \"Meses de cursado\" de cada opción).\n\n";
  for (const alt of alts) {
    const info = ED_EHD_PERIODS[alt.key];
    const nombre = info?.nombre || alt.key;
    const cuota6 = round2(alt.pd.price.total / 6);
    const cuota3 = round2(alt.pd.price.total / 3);
    b += `── Opción: ${nombre} (período ${alt.key}) ──\n`;
    if (info) {
      b += `Inicio de clases: ${info.inicioClases}\n`;
      b += info.fechaExtension
        ? `Ventana de venta: ${info.fechaInicio} → ${info.fechaFin} (extensión hasta ${info.fechaExtension})\n`
        : `Ventana de venta: ${info.fechaInicio} → ${info.fechaFin}\n`;
    }
    const coverage = buildPeriodCoverageLabel(alt.key, alt.pd);
    if (coverage) b += `Meses de cursado que abarca este período: ${coverage}\n`;
    b += `Total del período de cursado (matrícula + aranceles — NO de la carrera completa): $${f2(alt.pd.price.total)} | 6 cuotas: $${f2(cuota6)} | 3 cuotas: $${f2(cuota3)}\n`;
    b += `Oración de precio sugerida: **Hoy podés inscribirte y abonar el periodo de cursado en 6 cuotas fijas de $${f2(cuota6)} (dependiendo del banco de tu tarjeta).**\n\n`;
  }
  return b;
}

const SEP = "═══════════════════════════════════════════════════════════════\n";
const DASH = "------------------------------------------------------------------\n";

// ── FormatPriceResponseByModalityV4 ───────────────────────────────────────────

export function formatPriceResponseV4(priceData: PriceDataMap, modalityId: number, req: V4Request, now: Date): string {
  const llmInstruction = req.llmInstruction;

  // ── Lógica bimestral (1, 2, 3, 4, 5, 7) ──
  if (BIMESTER_MODALITIES.has(modalityId)) {
    const primaryData = priceData["primary"];
    if (!primaryData) return "No se pudo obtener el precio del período activo.";

    // V4 puede cotizar un período posterior al activo (ver resolveV4PrimaryPeriod):
    // la clave sale del período cotizado.
    const activeKey = getActiveEdEhdPeriodKey(now);
    const primaryKey = buildEdEhdPeriodKey(primaryData.periodName, primaryData.subPeriod) || activeKey;
    const nextPeriodNotice = buildNextPeriodNotice(primaryKey, activeKey);
    const primaryInfo = ED_EHD_PERIODS[primaryKey];

    const cuota6 = round2(primaryData.price.total / 6);
    const cuota3 = round2(primaryData.price.total / 3);
    const periodDisplayName = primaryInfo?.nombre || primaryKey;
    const courseCoverageLine = buildCourseCoverageLine(req.programId, primaryKey, primaryData);
    const pricePhrase = `**Hoy podés inscribirte y abonar el periodo de cursado en 6 cuotas fijas de $${f2(cuota6)} (dependiendo del banco de tu tarjeta).**`;

    const userMessage =
      "[INSTRUCTION:\n\nUsa el siguiente **Bloque de Precio**:\n\n" +
      `Mirá, {nombre}. Con lo que me contaste —{impacto esperado del usuario}—, tiene sentido que aproveches el próximo inicio en ${periodDisplayName}.\n` +
      formatOptionalPromptLine(boldOptional(nextPeriodNotice)) +
      formatOptionalPromptLine(courseCoverageLine) +
      `${pricePhrase}\n` +
      "Este arancel incluye: matrícula, paquete de materias, derechos de exámenes y materiales de estudio digitales y acceso a biblioteca.\n" +
      "**¿Te parece viable esta forma de pago?**\n\n";

    let courseCoverageRule = courseCoverageLine
      ? `- La **oración del período de cursado** es inmutable: "${courseCoverageLine}". No la modifiques ni parafrasees.\n`
      : "";
    if (nextPeriodNotice !== "") {
      const activeName = ED_EHD_PERIODS[activeKey]?.nombre || activeKey;
      courseCoverageRule += `- La **aclaración del período** es inmutable y obligatoria: "${nextPeriodNotice}". No la omitas, modifiques ni parafrasees.\n`;
      courseCoverageRule += `- El inicio de ${activeName} **no está disponible** para esta carrera y modalidad: no lo ofrezcas ni lo menciones como opción.\n`;
    }
    const altRule =
      shownEdEhdAlternatives(priceData).length > 0
        ? "- Existen **otros períodos de inicio disponibles** como alternativa. Ofrecelos **solo** si el estudiante rechaza el período principal **o si pregunta explícitamente por otro inicio o por el próximo año** (ej: \"¿y para marzo?\", \"¿cuánto sale el año que viene?\"); en ese caso dale el precio del período que pide aunque el principal siga disponible. De a uno por vez y con el mismo formato del bloque de precio. Los detalles están al final, en la sección \"PERÍODOS ALTERNATIVOS\" del contexto interno.\n"
        : "";
    const coverageMonthsRule =
      "- Siempre que presentes un período (el principal o un alternativo), aclarale al estudiante **qué meses de cursado abarca** (ej: \"este período cubre de octubre a diciembre 2026\"). Usá los meses que figuran en el contexto interno de cada período; si no figuran, no los inventes.\n";

    const criticalRules =
      "[REGLAS CRÍTICAS (OBLIGATORIAS):\n" +
      "- Variables opcionales ({nombre}, {impacto esperado del usuario}): si no están disponibles, reformula mínimamente sin inventar contenido ni mostrar llaves.\n" +
      `- La **oración del precio** es inmutable: "${pricePhrase}". No la modifiques ni parafrasees.\n` +
      courseCoverageRule +
      altRule +
      coverageMonthsRule +
      "- **Nunca** muestres llaves {} ni nombres de variables en la respuesta.\n" +
      "- SIEMPRE ofrecer primero 6 cuotas fijas. NUNCA ofrecer más cuotas por iniciativa propia.\n" +
      `- Si el usuario tiene objeción con las cuotas o dificultad para pagar en 6 cuotas: ofrecer **3 cuotas fijas de $${f2(cuota3)} (dependiendo del banco de tu tarjeta)** como alternativa.\n` +
      "- Todos los importes de esta herramienta corresponden ÚNICAMENTE al **período de cursado activo** (matrícula + aranceles). Esta herramienta **NO dispone del costo total de la carrera completa**: si el usuario pregunta cuánto cuesta toda la carrera, NUNCA presentes ninguno de estos montos como \"precio total de la carrera\"; explicá que el arancel es por período de cursado y ofrecé derivarlo a un asesor de Admisión para esa proyección.\n" +
      "- No hagas cálculos ni expliques precios adicionales salvo pedido explícito del usuario.\n" +
      "- Si el usuario pregunta por medios de pago, bancos, cuotas sin interés, tasas o promociones: **invoca la Tool de Admisión › Matrícula y Medios de Pago de la Carrera** y entregá exactamente su resultado.\n" +
      "- Prohibido decir que los aranceles se pueden pagar por transferencia bancaria.\n" +
      "- Si el usuario expresa objeción económica o intención de postergar con interés real en estudiar: **activá el Protocolo de Beneficios Económicos**.\n" +
      "- Después de presentar el precio, **actualiza el custom field con key \"interest_qualification_reason\" del deal con el valor 55**.]\n\n";

    let ctx = "";
    if (llmInstruction !== "") {
      ctx += "\n\n" + SEP + "🤖 CONTEXTO PARA EL AGENTE DE IA\n" + SEP + "\n";
      ctx += llmInstruction + "\n\n";
    }
    ctx += "📋 DATOS DEL PERÍODO ACTIVO (no mostrar al usuario):\n" + DASH;
    ctx += buildTodayLine(now);
    ctx += `Período: ${primaryKey}\n`;
    if (nextPeriodNotice !== "") {
      ctx += `Nota: el período vigente según calendario (${activeKey}) no vino para esta carrera y modalidad; se cotiza el próximo período disponible.\n`;
    }
    if (primaryInfo) {
      ctx += `Inicio de clases: ${primaryInfo.inicioClases}\n`;
      ctx += primaryInfo.fechaExtension
        ? `Ventana de venta: ${primaryInfo.fechaInicio} → ${primaryInfo.fechaFin} (extensión hasta ${primaryInfo.fechaExtension})\n`
        : `Ventana de venta: ${primaryInfo.fechaInicio} → ${primaryInfo.fechaFin}\n`;
    }
    const coverage = buildPeriodCoverageLabel(primaryKey, primaryData);
    if (coverage) ctx += `Meses de cursado que abarca este período: ${coverage}\n`;
    ctx += `Total del período de cursado (matrícula + aranceles — NO de la carrera completa): $${f2(primaryData.price.total)} | 6 cuotas: $${f2(cuota6)} | 3 cuotas: $${f2(cuota3)}\n`;
    ctx += createPriceNoteV2(primaryData.price);
    ctx += buildPaymentAndRestrictionsContext(req);
    ctx += buildEdEhdAlternativesContext(priceData);

    return userMessage + criticalRules + ctx;
  }

  // En v4 ninguna otra modalidad llega al formateador (getPricesByModalityV4 corta con 500).
  return UNDETERMINED_TARIFF_OUTPUT;
}
