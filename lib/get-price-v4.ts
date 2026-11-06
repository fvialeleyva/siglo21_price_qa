// Port fiel (lógica pura, sin red) de get-price-v4 del lambda siglo21-price-proxy,
// rama fix/v4-calendario-comercial-2027 de conversia-legacy-lambdas (ticket HF-0123):
// pkg/services/pricing-service.go → HandleGetPriceV4, getPricesByModalityV4,
// FormatPriceResponseByModalityV4 / formatV4BimesterResponse y helpers.
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

// ── Tabla de períodos comerciales (edEhdPeriods / edEhdPeriodOrder) ──────────
// Calendario comercial oficial de Siglo 21 (cuadro "NI", ticket HF-0123).

export interface BimesterPeriodInfo {
  fechaInicio: string; // inicio ventana de venta (dd/mm/yyyy) — uso interno
  fechaFin: string; // fin ventana de venta oficial (dd/mm/yyyy) — uso interno
  fechaExtension: string; // límite de extensión (dd/mm/yyyy) — SOLO selección del activo; nunca se informa
  inicioClases: string; // inicio de clases confirmado por Siglo 21 (ej: "marzo 2027"); "" si no está confirmado
  nombre: string; // nombre legible del inicio (ej: "marzo 2027"); "" si no está confirmado
}

// Las filas de 2026 se conservan como histórico (ventanas ya cerradas).
export const ED_EHD_PERIODS: Record<string, BimesterPeriodInfo> = {
  "1A/26": { fechaInicio: "25/08/2025", fechaFin: "15/03/2026", fechaExtension: "29/03/2026", inicioClases: "16/03/2026", nombre: "marzo 2026" },
  "1B/26": { fechaInicio: "16/03/2026", fechaFin: "17/05/2026", fechaExtension: "31/05/2026", inicioClases: "18/05/2026", nombre: "mayo 2026" },
  "2A/26": { fechaInicio: "18/05/2026", fechaFin: "02/08/2026", fechaExtension: "16/08/2026", inicioClases: "03/08/2026", nombre: "agosto 2026" },
  "2B/26": { fechaInicio: "03/08/2026", fechaFin: "04/10/2026", fechaExtension: "18/10/2026", inicioClases: "05/10/2026", nombre: "octubre 2026" },
  "1A/27": { fechaInicio: "28/07/2026", fechaFin: "14/03/2027", fechaExtension: "28/03/2027", inicioClases: "marzo 2027", nombre: "marzo 2027" },
  "1B/27": { fechaInicio: "15/03/2027", fechaFin: "16/05/2027", fechaExtension: "30/05/2027", inicioClases: "", nombre: "" },
  "2A/27": { fechaInicio: "17/05/2027", fechaFin: "01/08/2027", fechaExtension: "15/08/2027", inicioClases: "", nombre: "" },
  "2B/27": { fechaInicio: "02/08/2027", fechaFin: "03/10/2027", fechaExtension: "17/10/2027", inicioClases: "", nombre: "" },
};

export const ED_EHD_PERIOD_ORDER = ["1A/26", "1B/26", "2A/26", "2B/26", "1A/27", "1B/27", "2A/27", "2B/27"];

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

/**
 * isEdEhdPeriodOnSaleAt: la ventana de venta del período (incluida la extensión)
 * contiene el día UTC de `now`. Un período fuera de la tabla se considera fuera
 * de venta. Filtra los alternativos (la API puede devolver períodos cerrados).
 */
export function isEdEhdPeriodOnSale(periodKey: string, now: Date): boolean {
  const info = ED_EHD_PERIODS[periodKey];
  if (!info) return false;
  const inicio = parseDdMmYyyy(info.fechaInicio);
  const cierre = parseDdMmYyyy(info.fechaExtension || info.fechaFin);
  if (inicio === null || cierre === null) return false;
  const today = truncateUtcDay(now);
  return today >= inicio && today <= cierre;
}

/** periodCycle: "2B/26" → "26". */
function periodCycle(periodKey: string): string {
  const idx = periodKey.lastIndexOf("/");
  return idx === -1 ? "" : periodKey.slice(idx + 1);
}

/**
 * buildNextPeriodNotice: aclaración que se muestra cuando V4 cotiza un período
 * posterior al activo porque la API no devolvió el activo. Solo menciona el
 * inicio de clases si Siglo 21 lo confirmó (HF-0123). "" si es el activo.
 */
export function buildNextPeriodNotice(primaryKey: string, activeKey: string): string {
  if (primaryKey === "" || primaryKey === activeKey) return "";
  const target = periodCycle(primaryKey) !== periodCycle(activeKey) ? "el próximo año" : "el próximo período";
  const inicio = ED_EHD_PERIODS[primaryKey]?.inicioClases;
  if (inicio) {
    return `Para esta carrera y modalidad, la inscripción disponible es para ${target}: las clases inician en ${inicio}.`;
  }
  return `Para esta carrera y modalidad, la inscripción disponible es para ${target}.`;
}

// ── Materias por semestre (V4, HF-0123) ──────────────────────────────────────

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

/**
 * v4SubjectsLine: tecnicaturas 4 materias por semestre; licenciaturas entre 5 y
 * 6. Solo carreras de la lista; "" si la carrera no está (no se informa).
 */
export function v4SubjectsLine(programId: number): string {
  const degreeType = PROGRAM_DEGREE_TYPES[programId];
  if (degreeType === "tecnicatura") return "Te cuento, nuestro arancel es integral: en esta carrera cursás 4 materias por semestre.";
  if (degreeType === "licenciatura") return "Te cuento, nuestro arancel es integral: en esta carrera cursás entre 5 y 6 materias por semestre.";
  return "";
}

/** Oración de inicio de clases ("" si Siglo 21 no lo confirmó). */
export function classStartLine(periodKey: string): string {
  const inicio = ED_EHD_PERIODS[periodKey]?.inicioClases;
  return inicio ? `Las clases inician en ${inicio}.` : "";
}

export const V4_EARLY_ENROLLMENT_LINE = "Si te inscribís esta semana, contás con beneficios especiales por inscripción anticipada.";

const V4_INFO_STRUCTURE_RULE =
  "- Estructura del primer mensaje: carrera consultada, inicio de clases (solo si figura en el bloque), beneficio por inscripción anticipada, arancel en 6 cuotas fijas, conceptos incluidos y la pregunta de avance. No agregues otros datos.\n";

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

/** buildV4AlternativesContext: sin fechas de venta/extensión ni meses de cursado (HF-0123). */
function buildV4AlternativesContext(priceData: PriceDataMap): string {
  const alts = shownEdEhdAlternatives(priceData);
  if (alts.length === 0) return "";
  let b = "";
  b += "\n\n" + SEP;
  b += "📅 PERÍODOS ALTERNATIVOS (Referencia interna — NO mostrar salvo que el estudiante no pueda comenzar en el período principal o pregunte por otro inicio / el próximo año):\n";
  b += SEP;
  b += "Ofrecé uno a la vez, con el mismo formato del bloque de precio principal y solo con los datos de ese período. Nunca informes fechas de venta, de cierre ni de extensión.\n\n";
  for (const alt of alts) {
    const inicio = ED_EHD_PERIODS[alt.key]?.inicioClases;
    const cuota6 = round2(alt.pd.price.total / 6);
    const cuota3 = round2(alt.pd.price.total / 3);
    b += `── Opción: período ${alt.key} ──\n`;
    b += inicio
      ? `Oración de inicio de clases: Las clases inician en ${inicio}.\n`
      : "Inicio de clases: no confirmado — no informes día ni mes de inicio.\n";
    b += `Total del período (matrícula + aranceles — NO de la carrera completa): $${f2(alt.pd.price.total)} | 6 cuotas: $${f2(cuota6)}\n`;
    b += `Oración de precio sugerida: **Hoy podés inscribirte y abonar el período en 6 cuotas fijas de $${f2(cuota6)}, dependiendo del banco de tu tarjeta.**\n`;
    b += `Solo ante objeción de financiación: También contamos con la alternativa de abonar en 3 cuotas fijas de $${f2(cuota3)}, dependiendo del banco de tu tarjeta. ¿Te gustaría evaluar esta opción?\n\n`;
  }
  return b;
}

const SEP = "═══════════════════════════════════════════════════════════════\n";
const DASH = "------------------------------------------------------------------\n";

// ── FormatPriceResponseByModalityV4 → formatV4BimesterResponse ────────────────

export function formatPriceResponseV4(priceData: PriceDataMap, modalityId: number, req: V4Request, now: Date): string {
  // ── Lógica bimestral (1, 2, 3, 4, 5, 7) ── criterios HF-0123
  if (BIMESTER_MODALITIES.has(modalityId)) {
    const primaryData = priceData["primary"];
    if (!primaryData) return "No se pudo obtener el precio del período activo.";

    // V4 puede cotizar un período posterior al activo (ver resolveV4PrimaryPeriod):
    // la clave sale del período cotizado.
    const activeKey = getActiveEdEhdPeriodKey(now);
    const primaryKey = buildEdEhdPeriodKey(primaryData.periodName, primaryData.subPeriod) || activeKey;
    const nextPeriodNotice = buildNextPeriodNotice(primaryKey, activeKey);

    const cuota6 = round2(primaryData.price.total / 6);
    const cuota3 = round2(primaryData.price.total / 3);
    const classStart = classStartLine(primaryKey);
    const subjectsLine = v4SubjectsLine(req.programId);

    const pricePhrase = `**Hoy podés inscribirte y abonar el período en 6 cuotas fijas de $${f2(cuota6)}, dependiendo del banco de tu tarjeta.**`;
    const objectionPhrase = `También contamos con la alternativa de abonar en 3 cuotas fijas de $${f2(cuota3)}, dependiendo del banco de tu tarjeta. ¿Te gustaría evaluar esta opción?`;
    const headerSuffix = nextPeriodNotice !== "" ? "" : " (período comercial activo)";

    const userMessage =
      "[INSTRUCTION:\n\nUsa el siguiente **Bloque de Precio**:\n\n" +
      `🎓 Te paso la información que pediste sobre la {carrera consultada}${headerSuffix}:\n` +
      formatOptionalPromptLine(boldOptional(nextPeriodNotice)) +
      formatOptionalPromptLine(classStart) +
      V4_EARLY_ENROLLMENT_LINE + "\n" +
      pricePhrase + "\n" +
      "Esta cotización corresponde al período activo e incluye matrícula, paquete de materias, derechos de examen y materiales de estudio digitales.\n" +
      formatOptionalPromptLine(subjectsLine) +
      "**¿Te parece viable esta forma de pago o querés que te conecte con un asesor de Admisiones para avanzar con la inscripción o evaluar opciones?**\n\n";

    let rules = "[REGLAS CRÍTICAS (OBLIGATORIAS):\n";
    rules += "- Variable opcional ({carrera consultada}): si no está disponible, reformula mínimamente sin inventar contenido ni mostrar llaves.\n";
    rules += V4_INFO_STRUCTURE_RULE;
    rules += `- La **oración del precio** es inmutable: "${pricePhrase}". No la modifiques ni parafrasees.\n`;
    rules += classStart
      ? `- La **oración de inicio de clases** es inmutable: "${classStart}". No agregues un día ni otra fecha de inicio.\n`
      : "- Para este período **no hay inicio de clases confirmado**: no informes ningún día ni mes de inicio de clases. Si el estudiante lo pregunta, ofrecé derivarlo a un asesor de Admisión para confirmarlo.\n";
    rules += `- La **oración del beneficio** es inmutable: "${V4_EARLY_ENROLLMENT_LINE}". No agregues montos, porcentajes ni condiciones del beneficio.\n`;
    rules += subjectsLine
      ? `- La **oración de materias** es inmutable: "${subjectsLine}". No la modifiques ni parafrasees.\n`
      : "- No informes cuántas materias se cursan: esta herramienta no tiene ese dato para esta carrera.\n";
    if (nextPeriodNotice !== "") {
      rules += `- La **aclaración del período** es inmutable y obligatoria: "${nextPeriodNotice}". No la omitas, modifiques ni parafrasees.\n`;
      rules += `- El período ${activeKey} **no está disponible** para esta carrera y modalidad: no lo ofrezcas ni lo menciones como opción.\n`;
    }
    rules += "- **Nunca** informes fechas de inicio o fin de venta, de cierre de inscripción ni de extensión, aunque el estudiante las pida. Tampoco informes qué meses o fechas cubre el pago.\n";
    if (shownEdEhdAlternatives(priceData).length > 0) {
      rules +=
        "- Existen **otros períodos disponibles** como alternativa. Primero ofrecé siempre el período principal. Ofrecé un alternativo **solo** si el estudiante dice que no puede comenzar en el período principal **o si pregunta explícitamente por otro inicio o por el próximo año**; en ese caso usá solo los datos y el precio de ese período, sin mezclarlos con los del principal. De a uno por vez y con el mismo formato del bloque de precio. Los detalles están al final, en la sección \"PERÍODOS ALTERNATIVOS\" del contexto interno.\n";
    }
    rules += "- **Nunca** muestres llaves {} ni nombres de variables en la respuesta.\n";
    rules += "- En el primer mensaje ofrecé **solo** las 6 cuotas fijas: **no menciones** la opción de 3 cuotas. NUNCA ofrezcas más cuotas por iniciativa propia.\n";
    rules += `- Solo si el estudiante manifiesta una objeción con la financiación o dice que la propuesta no le resulta viable, respondé: "${objectionPhrase}"\n`;
    rules +=
      "- Todos los importes de esta herramienta corresponden ÚNICAMENTE al **período activo** (matrícula + aranceles). Esta herramienta **NO dispone del costo total de la carrera completa**: si el usuario pregunta cuánto cuesta toda la carrera, NUNCA presentes ninguno de estos montos como \"precio total de la carrera\"; explicá que el arancel es por período y ofrecé derivarlo a un asesor de Admisión para esa proyección.\n";
    rules += "- No hagas cálculos ni expliques precios adicionales salvo pedido explícito del usuario.\n";
    rules += "- Si el usuario pregunta por medios de pago, bancos, cuotas sin interés, tasas o promociones: **invoca la Tool de Admisión › Matrícula y Medios de Pago de la Carrera** y entregá exactamente su resultado.\n";
    rules += "- Prohibido decir que los aranceles se pueden pagar por transferencia bancaria.\n";
    rules += "- Si el usuario expresa objeción económica o intención de postergar con interés real en estudiar: **activá el Protocolo de Beneficios Económicos**.\n";
    rules += "- Después de presentar el precio, **actualiza el custom field con key \"interest_qualification_reason\" del deal con el valor 55**.]\n\n";

    let ctx = "";
    if (req.llmInstruction !== "") {
      ctx += "\n\n" + SEP + "🤖 CONTEXTO PARA EL AGENTE DE IA\n" + SEP + "\n";
      ctx += req.llmInstruction + "\n\n";
    }
    ctx += "📋 DATOS DEL PERÍODO ACTIVO (no mostrar al usuario):\n" + DASH;
    ctx += buildTodayLine(now);
    ctx += `Período: ${primaryKey}\n`;
    if (nextPeriodNotice !== "") {
      ctx += `Nota: el período vigente según calendario (${activeKey}) no vino para esta carrera y modalidad; se cotiza el próximo período disponible.\n`;
    }
    ctx += `Total del período (matrícula + aranceles — NO de la carrera completa): $${f2(primaryData.price.total)} | 6 cuotas: $${f2(cuota6)}\n`;
    ctx += createPriceNoteV2(primaryData.price);
    ctx += buildPaymentAndRestrictionsContext(req);
    ctx += buildV4AlternativesContext(priceData);

    return userMessage + rules + ctx;
  }

  // En v4 ninguna otra modalidad llega al formateador (getPricesByModalityV4 corta con 500).
  return UNDETERMINED_TARIFF_OUTPUT;
}
