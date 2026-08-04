"use client";

import { useEffect, useState } from "react";
import type { DiagnosisResult, PeriodPriceResult, StepResult } from "@/lib/siglo21";

// ── Marca Conversia ─────────────────────────────────────────────────────────────

function ConversiaLogo({ className = "" }: { className?: string }) {
  return (
    <svg width="149" height="25" viewBox="0 0 149 25" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} role="img" aria-label="Conversia">
      <path d="M13.8772 18.4049L16.9378 20.0669C16.1918 21.109 15.2429 21.9427 14.0911 22.568C12.9502 23.1933 11.7106 23.506 10.3723 23.506C8.8584 23.506 7.47619 23.1165 6.22561 22.3377C4.986 21.5588 3.99321 20.5166 3.24725 19.2112C2.51226 17.8948 2.14477 16.4413 2.14477 14.8506C2.14477 13.6439 2.35868 12.5195 2.78651 11.4774C3.21434 10.4242 3.80124 9.50276 4.5472 8.71292C5.30413 7.91211 6.18173 7.28682 7.18 6.83705C8.17827 6.38728 9.24235 6.1624 10.3723 6.1624C11.7106 6.1624 12.9502 6.47504 14.0911 7.10033C15.2429 7.72562 16.1918 8.56483 16.9378 9.61795L13.8772 11.2799C13.4164 10.7314 12.8789 10.3145 12.2646 10.0293C11.6503 9.73313 11.0195 9.58504 10.3723 9.58504C9.47272 9.58504 8.65546 9.83186 7.92047 10.3255C7.19645 10.8082 6.62053 11.4499 6.1927 12.2507C5.77584 13.0406 5.56741 13.9072 5.56741 14.8506C5.56741 15.7831 5.78132 16.6497 6.20915 17.4505C6.63698 18.2404 7.21291 18.8766 7.93693 19.3593C8.67192 19.842 9.48369 20.0833 10.3723 20.0833C11.0524 20.0833 11.6996 19.9297 12.314 19.6226C12.9283 19.3154 13.4493 18.9095 13.8772 18.4049ZM59.7604 12.7608V23.0781H56.3377V13.6001C56.3377 12.8651 56.1567 12.1959 55.7947 11.5925C55.4437 10.9892 54.9665 10.512 54.3631 10.161C53.7707 9.79895 53.1016 9.61795 52.3556 9.61795C51.6316 9.61795 50.9679 9.79895 50.3646 10.161C49.7612 10.512 49.2785 10.9892 48.9165 11.5925C48.5545 12.1959 48.3735 12.8651 48.3735 13.6001V23.0781H44.9509V6.62314H48.3735V8.36737C48.944 7.68723 49.646 7.1497 50.4798 6.75478C51.3135 6.35986 52.213 6.1624 53.1784 6.1624C54.396 6.1624 55.504 6.45859 56.5023 7.05097C57.5005 7.64335 58.2904 8.43867 58.8718 9.43694C59.4642 10.4352 59.7604 11.5432 59.7604 12.7608ZM71.8466 23.0781H67.4531L61.447 6.59023H65.1L69.6416 19.1289L74.1996 6.59023H77.8362L71.8466 23.0781ZM86.9651 23.506C85.4512 23.506 84.069 23.1165 82.8184 22.3377C81.5788 21.5588 80.586 20.5166 79.8401 19.2112C79.1051 17.8948 78.7376 16.4413 78.7376 14.8506C78.7376 13.6439 78.9515 12.5195 79.3793 11.4774C79.8072 10.4242 80.3941 9.50276 81.14 8.71292C81.8969 7.91211 82.7745 7.28682 83.7728 6.83705C84.7711 6.38728 85.8352 6.1624 86.9651 6.1624C88.2266 6.1624 89.384 6.42568 90.4371 6.95224C91.4902 7.46783 92.3897 8.18636 93.1357 9.10784C93.8817 10.0184 94.4302 11.0715 94.7812 12.2672C95.1322 13.452 95.2365 14.7135 95.0938 16.0518H82.4071C82.5497 16.8088 82.8239 17.4944 83.2298 18.1087C83.6467 18.7121 84.1732 19.1893 84.8095 19.5403C85.4567 19.8913 86.1752 20.0723 86.9651 20.0833C87.7988 20.0833 88.5557 19.8749 89.2359 19.458C89.927 19.0412 90.4919 18.4652 90.9307 17.7303L94.4027 18.5365C93.7445 19.9956 92.7518 21.1913 91.4244 22.1237C90.097 23.0452 88.6106 23.506 86.9651 23.506ZM82.2919 13.4355H91.6383C91.5286 12.6457 91.2489 11.9326 90.7991 11.2964C90.3603 10.6491 89.8063 10.139 89.1371 9.76604C88.4789 9.38209 87.7549 9.19012 86.9651 9.19012C86.1862 9.19012 85.4622 9.37661 84.793 9.74958C84.1348 10.1226 83.5863 10.6327 83.1475 11.2799C82.7197 11.9162 82.4345 12.6347 82.2919 13.4355ZM97.819 23.0781V6.62314H101.242V8.36737C101.812 7.68723 102.514 7.1497 103.348 6.75478C104.182 6.35986 105.081 6.1624 106.046 6.1624C106.661 6.1624 107.27 6.24467 107.873 6.40922L106.507 9.86477C106.079 9.70022 105.652 9.61795 105.224 9.61795C104.5 9.61795 103.836 9.79895 103.233 10.161C102.629 10.512 102.147 10.9892 101.785 11.5925C101.423 12.1959 101.242 12.8651 101.242 13.6001V23.0781H97.819ZM114.711 23.3908C113.844 23.3359 113 23.1604 112.177 22.8642C111.354 22.568 110.63 22.1676 110.005 21.663C109.391 21.1474 108.93 20.5441 108.623 19.8529L111.535 18.6024C111.678 18.8986 111.925 19.1893 112.276 19.4745C112.638 19.7597 113.06 19.9956 113.543 20.182C114.025 20.3576 114.53 20.4453 115.057 20.4453C115.572 20.4453 116.049 20.374 116.488 20.2314C116.938 20.0778 117.305 19.8475 117.591 19.5403C117.876 19.2331 118.018 18.8656 118.018 18.4378C118.018 17.9551 117.854 17.5822 117.525 17.3189C117.207 17.0446 116.806 16.8362 116.324 16.6936C115.841 16.551 115.358 16.4139 114.876 16.2822C113.801 16.0409 112.813 15.7118 111.914 15.2949C111.025 14.8671 110.318 14.3241 109.791 13.6659C109.264 12.9967 109.001 12.1794 109.001 11.2141C109.001 10.161 109.286 9.25045 109.857 8.48255C110.427 7.70368 111.173 7.10582 112.095 6.68896C113.027 6.2721 114.02 6.06367 115.073 6.06367C116.389 6.06367 117.596 6.3434 118.693 6.90287C119.79 7.46234 120.629 8.23024 121.211 9.20657L118.496 10.8192C118.331 10.4901 118.084 10.1939 117.755 9.93059C117.426 9.66731 117.053 9.45888 116.636 9.3053C116.219 9.14075 115.786 9.04751 115.336 9.02557C114.777 9.00363 114.256 9.06945 113.773 9.22303C113.301 9.36564 112.923 9.59601 112.638 9.91414C112.352 10.2323 112.21 10.6382 112.21 11.1318C112.21 11.6145 112.38 11.9765 112.72 12.2178C113.06 12.4482 113.488 12.6347 114.003 12.7773C114.53 12.9199 115.068 13.079 115.616 13.2545C116.592 13.5617 117.508 13.9401 118.364 14.3899C119.22 14.8287 119.911 15.3717 120.437 16.0189C120.964 16.6662 121.216 17.456 121.194 18.3885C121.194 19.4196 120.882 20.3247 120.256 21.1035C119.642 21.8824 118.841 22.4748 117.854 22.8807C116.867 23.2866 115.819 23.4566 114.711 23.3908ZM123.723 6.62314H127.145V23.0781H123.723V6.62314ZM125.467 4.23716C124.94 4.23716 124.502 4.06713 124.151 3.72706C123.799 3.38699 123.624 2.95916 123.624 2.44357C123.624 1.93895 123.799 1.51661 124.151 1.17654C124.502 0.825497 124.935 0.649978 125.45 0.649978C125.955 0.649978 126.383 0.825497 126.734 1.17654C127.085 1.51661 127.261 1.93895 127.261 2.44357C127.261 2.95916 127.085 3.38699 126.734 3.72706C126.394 4.06713 125.972 4.23716 125.467 4.23716ZM143.595 6.62314H147.018V23.0781H143.579L143.447 20.6922C142.964 21.5368 142.312 22.217 141.489 22.7326C140.666 23.2482 139.695 23.506 138.576 23.506C137.37 23.506 136.234 23.2811 135.17 22.8313C134.106 22.3706 133.168 21.7343 132.356 20.9225C131.556 20.1107 130.93 19.1783 130.481 18.1252C130.031 17.0611 129.806 15.9202 129.806 14.7025C129.806 13.5287 130.025 12.4263 130.464 11.3951C130.903 10.3529 131.512 9.44243 132.291 8.66356C133.069 7.88469 133.969 7.27585 134.989 6.83705C136.02 6.38728 137.123 6.1624 138.297 6.1624C139.492 6.1624 140.546 6.43665 141.456 6.98515C142.378 7.52268 143.14 8.21379 143.743 9.05848L143.595 6.62314ZM138.494 20.1985C139.459 20.1985 140.304 19.9626 141.028 19.4909C141.752 19.0083 142.312 18.361 142.707 17.5492C143.113 16.7375 143.315 15.8379 143.315 14.8506C143.315 13.8524 143.113 12.9473 142.707 12.1356C142.301 11.3238 141.736 10.682 141.012 10.2103C140.299 9.72765 139.459 9.48631 138.494 9.48631C137.54 9.48631 136.668 9.72765 135.878 10.2103C135.088 10.693 134.463 11.3402 134.002 12.152C133.541 12.9638 133.311 13.8633 133.311 14.8506C133.311 15.8489 133.547 16.7539 134.018 17.5657C134.501 18.3665 135.132 19.0083 135.911 19.4909C136.701 19.9626 137.562 20.1985 138.494 20.1985Z" fill="currentColor" />
      <g clipPath="url(#clog0)">
        <path d="M33.177 17.9581L32.6489 17.4253C31.9409 16.7117 31.6667 15.679 31.9281 14.7123L33.4416 9.11835C33.6515 8.34094 33.4309 7.51141 32.86 6.93925L32.831 6.91054C32.2537 6.33094 31.4064 6.10441 30.6138 6.31817L22.7506 8.43665C21.8165 8.6887 20.9639 7.83046 21.2306 6.90629V6.90416C21.3506 6.48833 21.6816 6.16397 22.1025 6.05124L29.7472 4.00827C31.4257 3.55947 33.2177 4.03273 34.4484 5.25149L34.4709 5.27382C35.7124 6.50216 36.1923 8.29733 35.7285 9.97446L33.5487 17.8624C33.5037 18.0262 33.2959 18.0804 33.1759 17.9592L33.177 17.9581Z" fill="#86F874" />
        <path d="M24.4011 15.6798L25.1284 15.4873C26.1031 15.23 27.1421 15.5043 27.8587 16.2084L32.0062 20.2826C32.5824 20.8484 33.4179 21.0685 34.2009 20.859L34.2406 20.8484C35.0332 20.6368 35.6502 20.0178 35.8558 19.2287L37.8942 11.3961C38.1363 10.4655 39.3092 10.155 39.9851 10.842H39.9861C40.2914 11.1525 40.4103 11.5981 40.3011 12.0171L38.3077 19.6243C37.8696 21.294 36.5681 22.6063 34.8929 23.0647L34.8618 23.0732C33.1726 23.5358 31.3635 23.0626 30.1253 21.8321L24.3004 16.0478C24.1794 15.9276 24.2351 15.7224 24.4 15.6777L24.4011 15.6798Z" fill="#86F874" />
        <path d="M30.8379 9.22771L30.6183 10.0253C30.3516 10.992 29.5889 11.7461 28.6131 12.0066L22.965 13.5115C22.1916 13.7178 21.5843 14.3112 21.3647 15.0748C21.1366 15.866 21.3594 16.7168 21.9453 17.2986L27.5859 22.8925C28.3003 23.6008 27.9115 24.8143 26.9164 24.9823C26.5201 25.0493 26.1152 24.9217 25.8303 24.6388L20.3568 19.2128C19.1111 17.9781 18.6333 16.1712 19.1089 14.4888C19.5706 12.8521 20.8645 11.577 22.5173 11.1303L30.5658 8.95545C30.7318 8.91078 30.8839 9.0618 30.8389 9.22664L30.8379 9.22771Z" fill="#86F874" />
      </g>
      <defs>
        <clipPath id="clog0"><rect width="21.4131" height="21.1582" fill="white" transform="translate(18.9277 3.8418)" /></clipPath>
      </defs>
    </svg>
  );
}

function ConversiaMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="18.9 3.8 21.5 21.2" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M33.177 17.9581L32.6489 17.4253C31.9409 16.7117 31.6667 15.679 31.9281 14.7123L33.4416 9.11835C33.6515 8.34094 33.4309 7.51141 32.86 6.93925L32.831 6.91054C32.2537 6.33094 31.4064 6.10441 30.6138 6.31817L22.7506 8.43665C21.8165 8.6887 20.9639 7.83046 21.2306 6.90629V6.90416C21.3506 6.48833 21.6816 6.16397 22.1025 6.05124L29.7472 4.00827C31.4257 3.55947 33.2177 4.03273 34.4484 5.25149L34.4709 5.27382C35.7124 6.50216 36.1923 8.29733 35.7285 9.97446L33.5487 17.8624C33.5037 18.0262 33.2959 18.0804 33.1759 17.9592L33.177 17.9581Z" fill="#86F874" />
      <path d="M24.4011 15.6798L25.1284 15.4873C26.1031 15.23 27.1421 15.5043 27.8587 16.2084L32.0062 20.2826C32.5824 20.8484 33.4179 21.0685 34.2009 20.859L34.2406 20.8484C35.0332 20.6368 35.6502 20.0178 35.8558 19.2287L37.8942 11.3961C38.1363 10.4655 39.3092 10.155 39.9851 10.842H39.9861C40.2914 11.1525 40.4103 11.5981 40.3011 12.0171L38.3077 19.6243C37.8696 21.294 36.5681 22.6063 34.8929 23.0647L34.8618 23.0732C33.1726 23.5358 31.3635 23.0626 30.1253 21.8321L24.3004 16.0478C24.1794 15.9276 24.2351 15.7224 24.4 15.6777L24.4011 15.6798Z" fill="#86F874" />
      <path d="M30.8379 9.22771L30.6183 10.0253C30.3516 10.992 29.5889 11.7461 28.6131 12.0066L22.965 13.5115C22.1916 13.7178 21.5843 14.3112 21.3647 15.0748C21.1366 15.866 21.3594 16.7168 21.9453 17.2986L27.5859 22.8925C28.3003 23.6008 27.9115 24.8143 26.9164 24.9823C26.5201 25.0493 26.1152 24.9217 25.8303 24.6388L20.3568 19.2128C19.1111 17.9781 18.6333 16.1712 19.1089 14.4888C19.5706 12.8521 20.8645 11.577 22.5173 11.1303L30.5658 8.95545C30.7318 8.91078 30.8839 9.0618 30.8389 9.22664L30.8379 9.22771Z" fill="#86F874" />
    </svg>
  );
}

// ── Parser tolerante: acepta un objeto, un array, o varios objetos pegados ────

function parseInputs(text: string): { inputs: Record<string, unknown>[]; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { inputs: [], error: "Pegá al menos un JSON." };

  // Intento directo: JSON válido (objeto o array)
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return { inputs: parsed };
    if (typeof parsed === "object" && parsed !== null) return { inputs: [parsed] };
  } catch {
    // sigue el parser tolerante
  }

  // Parser tolerante: extraer objetos {...} balanceados aunque estén pegados
  // uno tras otro, separados por comas, saltos de línea o texto suelto.
  const inputs: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          const obj = JSON.parse(candidate);
          if (typeof obj === "object" && obj !== null) inputs.push(obj);
        } catch {
          return { inputs: [], error: `Hay un bloque que no es JSON válido:\n${candidate.slice(0, 200)}` };
        }
        start = -1;
      }
    }
  }

  if (inputs.length === 0) {
    return { inputs: [], error: "No se encontró ningún JSON válido. Verificá el formato (llaves, comillas, comas)." };
  }
  return { inputs };
}

// ── Componentes de presentación ───────────────────────────────────────────────

const VERDICT_STYLES: Record<string, { badge: string; card: string; label: string }> = {
  OK: { badge: "bg-primary-600", card: "border-primary-200 bg-primary-50", label: "✅ TODO OK" },
  OK_PARTIAL: { badge: "bg-amber-500", card: "border-amber-200 bg-amber-50", label: "⚠️ OK CON OMISIONES" },
  PRESENCIAL_MODALITY: { badge: "bg-secondary-600", card: "border-secondary-200 bg-secondary-50", label: "ℹ️ MODALIDAD PRESENCIAL" },
  MISSING_REQUIRED_FIELD: { badge: "bg-orange-600", card: "border-orange-200 bg-orange-50", label: "✏️ DATOS INCOMPLETOS" },
  AUTH_FAILED: { badge: "bg-red-600", card: "border-red-200 bg-red-50", label: "🔒 FALLÓ AUTENTICACIÓN" },
  NO_SCHEDULES_AVAILABLE: { badge: "bg-red-600", card: "border-red-200 bg-red-50", label: "❌ SIN TURNOS" },
  NO_PERIODS_AVAILABLE: { badge: "bg-red-600", card: "border-red-200 bg-red-50", label: "❌ SIN PERÍODOS" },
  PRICE_FETCH_ERROR: { badge: "bg-red-600", card: "border-red-200 bg-red-50", label: "❌ FALLÓ PRECIO" },
};

const RESPONSIBLE_LABELS: Record<string, string> = {
  siglo21: "🏛️ Reportar a Siglo 21",
  config: "🛠️ Corregir datos / configuración",
  comportamiento_esperado: "✔️ Comportamiento esperado (no es una falla)",
  nadie: "✔️ Sin acción necesaria",
};

const STEP_ICONS: Record<string, string> = {
  ok: "✅",
  fail: "❌",
  warning: "⚠️",
  skipped: "⏭️",
};

function money(n?: number): string {
  if (typeof n !== "number") return "—";
  return "$" + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StepRow({ step }: { step: StepResult }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(step.url || step.rawResponse);
  return (
    <div className="border-b border-gray-100 last:border-0 py-2">
      <div className="flex items-start gap-2">
        <span className="shrink-0">{STEP_ICONS[step.status]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-gray-900">{step.title}</span>
            {step.httpStatus !== undefined && (
              <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${step.httpStatus < 400 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                HTTP {step.httpStatus}
              </span>
            )}
            {step.durationMs !== undefined && (
              <span className="text-xs text-gray-400">{step.durationMs} ms</span>
            )}
          </div>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{step.detail}</p>
          {hasDetail && (
            <button
              onClick={() => setOpen(!open)}
              className="text-xs text-secondary-600 hover:underline mt-1"
            >
              {open ? "Ocultar detalle técnico ▲" : "Ver detalle técnico ▼"}
            </button>
          )}
          {open && (
            <div className="mt-2 text-xs bg-gray-900 text-gray-100 rounded p-3 overflow-x-auto space-y-2">
              {step.url && (
                <div>
                  <span className="text-gray-400">URL:</span>{" "}
                  <span className="font-mono break-all">{step.method} {step.url}</span>
                </div>
              )}
              {step.rawResponse && (
                <div>
                  <span className="text-gray-400">Respuesta cruda de Siglo 21:</span>
                  <pre className="font-mono whitespace-pre-wrap break-all mt-1">{step.rawResponse}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PeriodRow({ p }: { p: PeriodPriceResult }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={p.ok ? "" : "bg-red-50"}>
        <td className="px-3 py-2 whitespace-nowrap">{p.ok ? "✅" : "❌"}</td>
        <td className="px-3 py-2 font-mono whitespace-nowrap">{p.periodName}-{p.subPeriod}</td>
        <td className="px-3 py-2 whitespace-nowrap">{p.ok ? money(p.total) : "—"}</td>
        <td className="px-3 py-2">
          {p.ok ? (
            <span className="text-gray-500 text-xs">HTTP {p.httpStatus} · {p.durationMs} ms</span>
          ) : (
            <span className="text-red-700 text-xs">{p.errorDetail}</span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <button onClick={() => setOpen(!open)} className="text-xs text-secondary-600 hover:underline whitespace-nowrap">
            {open ? "ocultar ▲" : "detalle ▼"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="px-3 pb-3">
            <div className="text-xs bg-gray-900 text-gray-100 rounded p-3 overflow-x-auto space-y-2">
              <div>
                <span className="text-gray-400">URL:</span>{" "}
                <span className="font-mono break-all">GET {p.url}</span>
              </div>
              {p.rawResponse && (
                <div>
                  <span className="text-gray-400">Respuesta cruda:</span>
                  <pre className="font-mono whitespace-pre-wrap break-all mt-1">{p.rawResponse}</pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function buildReport(r: DiagnosisResult): string {
  const lines: string[] = [];
  lines.push(`DIAGNÓSTICO SIGLO 21 — carrera ${r.input.program_id} / modalidad ${r.input.modality_id} (${r.modalityName}) / CAU ${r.input.cau_id}`);
  lines.push(`Resultado: ${r.verdict.code} (equivale a HTTP ${r.verdict.httpEquivalent} del middleware)`);
  lines.push(`${r.verdict.title}: ${r.verdict.explanation}`);
  if (r.turnoCode) lines.push(`Turno usado: ${r.turnoName} (código ${r.turnoCode})`);
  lines.push("");
  lines.push("Pasos:");
  for (const s of r.steps) {
    lines.push(`  [${s.status.toUpperCase()}] ${s.title}${s.httpStatus ? ` (HTTP ${s.httpStatus})` : ""} — ${s.detail}`);
    if (s.url) lines.push(`    URL: ${s.method} ${s.url}`);
    if (s.status === "fail" && s.rawResponse) lines.push(`    Respuesta: ${s.rawResponse.slice(0, 500)}`);
  }
  if (r.periodPrices.length > 0) {
    lines.push("");
    lines.push("Precios por período:");
    for (const p of r.periodPrices) {
      if (p.ok) {
        lines.push(`  [OK] ${p.periodName}-${p.subPeriod}: total del período ${p.total}`);
      } else {
        lines.push(`  [FALLÓ] ${p.periodName}-${p.subPeriod}: ${p.errorDetail}`);
        lines.push(`    URL: GET ${p.url}`);
        if (p.rawResponse) lines.push(`    Respuesta: ${p.rawResponse.slice(0, 500)}`);
      }
    }
  }
  return lines.join("\n");
}

// ── Ejemplo del mensaje que daría el agente IA al estudiante ───────────────────

type BotPreview =
  | { tone: "price"; cuota6: number; cuota3: number; alternatives: { label: string; cuota6: number }[] }
  | { tone: "advisor" }
  | { tone: "derive" }
  | { tone: "none"; reason: string };

function botPreview(r: DiagnosisResult): BotPreview {
  const code = r.verdict.code;
  if (code === "PRESENCIAL_MODALITY") return { tone: "advisor" };
  if (code === "MISSING_REQUIRED_FIELD")
    return {
      tone: "none",
      reason:
        "El agente IA no llega a responder nada: la consulta ni siquiera se arma porque faltan datos obligatorios. Es un problema de configuración, no algo que el estudiante llegue a ver.",
    };

  const okPeriods = r.periodPrices.filter((p) => p.ok && typeof p.total === "number");
  if (okPeriods.length > 0) {
    const [primary, ...rest] = okPeriods;
    const total = primary.total as number;
    const round2 = (n: number) => Math.round(n * 100) / 100;
    return {
      tone: "price",
      cuota6: round2(total / 6),
      cuota3: round2(total / 3),
      alternatives: rest.map((p) => ({
        label: `${p.periodName}-${p.subPeriod}`,
        cuota6: round2((p.total as number) / 6),
      })),
    };
  }

  // AUTH_FAILED · NO_SCHEDULES_AVAILABLE · NO_PERIODS_AVAILABLE · PRICE_FETCH_ERROR
  return { tone: "derive" };
}

function BotMessage({ result }: { result: DiagnosisResult }) {
  const preview = botPreview(result);
  return (
    <div className="mt-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary-700 mb-2">
        💬 Lo que le diría el agente IA al estudiante
      </p>
      <div className="flex items-start gap-3">
        <span className="shrink-0 grid place-items-center w-9 h-9 rounded-full bg-primary-100 border border-primary-200">
          <ConversiaMark className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1 bg-white border border-gray-200 rounded-2xl rounded-tl-md p-4 shadow-sm text-brand-ink">
          {preview.tone === "price" && (
            <>
              <p className="text-sm">
                Mirá 👋. Con lo que me contaste, tiene sentido que aproveches el próximo inicio.
              </p>
              <div className="my-2 rounded-xl bg-primary-50 border border-primary-100 px-3 py-2">
                <p className="font-semibold text-primary-800">
                  Hoy podés inscribirte y abonar el período de cursado en 6 cuotas fijas de{" "}
                  {money(preview.cuota6)} (dependiendo del banco de tu tarjeta).
                </p>
              </div>
              <p className="text-sm text-gray-700">
                Este arancel incluye: matrícula, paquete de materias, derechos de exámenes y
                materiales de estudio digitales y acceso a biblioteca.
              </p>
              <p className="mt-1 text-sm font-medium">¿Te parece viable esta forma de pago?</p>
              <div className="mt-3 border-t border-dashed border-gray-200 pt-2 text-xs text-gray-500 space-y-1">
                <p>
                  🔁 Si el estudiante no puede con 6 cuotas, el agente IA ofrece{" "}
                  <span className="font-semibold text-gray-700">3 cuotas de {money(preview.cuota3)}</span>.
                </p>
                {preview.alternatives.length > 0 && (
                  <p>
                    📅 Además tiene {preview.alternatives.length} período(s) alternativo(s) que ofrece{" "}
                    <span className="font-semibold text-gray-700">solo si el estudiante rechaza este</span>:{" "}
                    {preview.alternatives.map((a) => `${a.label} (6× ${money(a.cuota6)})`).join(" · ")}.
                  </p>
                )}
              </div>
            </>
          )}

          {preview.tone === "advisor" && (
            <>
              <p className="text-sm">
                Para conocer el arancel y las opciones de inscripción de esta modalidad, lo mejor es
                que hables con un <span className="font-semibold">asesor de Admisión</span>, que te va a
                dar toda la información completa. ¿Querés que te conecte con uno?
              </p>
              <p className="mt-2 text-xs text-gray-500">
                ℹ️ Modalidad presencial: el agente IA deriva a Admisión y nunca inventa ni estima precios.
              </p>
            </>
          )}

          {preview.tone === "derive" && (
            <>
              <p className="text-sm">
                En este momento no tengo ese dato a mano, pero puedo conectarte con el equipo de{" "}
                <span className="font-semibold">Admisión</span> para que te den toda la información
                completa. ¿Querés que te conecte con un asesor que te ayude con esto?
              </p>
              <p className="mt-2 text-xs text-gray-500">
                🤫 El agente IA nunca menciona que hubo una falla ni inventa precios: solo deriva con calidez.
              </p>
            </>
          )}

          {preview.tone === "none" && <p className="text-sm text-gray-600">{preview.reason}</p>}
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-2 ml-12">
        Ejemplo ilustrativo — el texto final lo arma Conversia con sus plantillas y puede variar; los
        montos salen del precio real obtenido arriba.
      </p>
    </div>
  );
}

// ── Dialog: el contexto interno que recibiría el agente IA ─────────────────────

function PeriodContextBlock({
  title,
  subtitle,
  period,
  tone,
}: {
  title: string;
  subtitle?: string;
  period: PeriodPriceResult;
  tone: "primary" | "alt";
}) {
  const total = period.total as number;
  const cuota6 = Math.round((total / 6) * 100) / 100;
  const cuota3 = Math.round((total / 3) * 100) / 100;
  const box = tone === "primary" ? "bg-primary-50 border-primary-100" : "bg-gray-50 border-gray-200";
  return (
    <div className={`rounded-xl border ${box} p-4`}>
      <div className="flex items-center justify-between gap-2">
        <h5 className="font-semibold text-brand-ink text-sm">{title}</h5>
        <span className="font-mono text-xs text-gray-600">
          {period.periodName}-{period.subPeriod}
        </span>
      </div>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <div className="col-span-2 flex justify-between border-b border-dashed border-gray-200 pb-1.5">
          <dt className="text-gray-500">Total del período (no de la carrera)</dt>
          <dd className="font-semibold">{money(total)}</dd>
        </div>
        {typeof period.totalListPrice === "number" && (
          <div className="flex justify-between">
            <dt className="text-gray-500">Precio de lista</dt>
            <dd>{money(period.totalListPrice)}</dd>
          </div>
        )}
        {typeof period.totalDiscounts === "number" && (
          <div className="flex justify-between">
            <dt className="text-gray-500">Descuento</dt>
            <dd className="text-primary-700">−{money(period.totalDiscounts)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-gray-500">6 cuotas</dt>
          <dd className="font-semibold">{money(cuota6)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">3 cuotas</dt>
          <dd>{money(cuota3)}</dd>
        </div>
      </dl>
    </div>
  );
}

const AGENT_RULES = [
  "La oración del precio es inmutable: no la modifica ni la parafrasea.",
  "Los montos son únicamente del período de cursado activo (matrícula + aranceles), no de la carrera completa. Si preguntan cuánto cuesta toda la carrera, nunca presenta estos montos como tal: explica que el arancel es por período y ofrece derivar a un asesor de Admisión.",
  "Ofrece primero 6 cuotas fijas; 3 cuotas solo si hay objeción. Nunca ofrece más por iniciativa propia.",
  "Nunca inventa ni estima precios.",
  "Si preguntan por medios de pago, bancos o promociones: invoca la Tool de Admisión y entrega su resultado tal cual.",
  "Prohibido mencionar transferencia bancaria como medio de pago.",
  "Ante objeción económica con interés real: activa el Protocolo de Beneficios Económicos.",
  "Al entregar el precio, marca el CRM: interest_qualification_reason = 55.",
];

function AgentContextDialog({ result, onClose }: { result: DiagnosisResult; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const okPeriods = result.periodPrices.filter((p) => p.ok && typeof p.total === "number");
  const preview = botPreview(result);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Contexto interno del agente IA"
    >
      <div className="absolute inset-0 bg-brand-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid place-items-center w-9 h-9 rounded-full bg-primary-100 border border-primary-200 shrink-0">
              <ConversiaMark className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-bold text-brand-ink leading-tight">🧠 Contexto interno del agente IA</h3>
              <p className="text-xs text-gray-500">
                Lo que el agente recibe además del mensaje — NO se muestra al estudiante.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 rounded-full w-8 h-8 grid place-items-center text-gray-500 hover:bg-gray-100 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {okPeriods.length > 0 ? (
            <>
              <PeriodContextBlock
                title="📋 Período principal"
                subtitle="El agente arma el bloque de precio con este período."
                period={okPeriods[0]}
                tone="primary"
              />

              {okPeriods.length > 1 && (
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <h4 className="font-semibold text-brand-ink text-sm">📅 Períodos alternativos</h4>
                    <span className="text-xs bg-secondary-50 text-secondary-700 border border-secondary-100 rounded-full px-2 py-0.5">
                      ocultos
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mb-2.5">
                    El agente los ofrece <span className="font-semibold">solo si el estudiante rechaza el principal</span>, de a uno por vez.
                  </p>
                  <div className="space-y-2.5">
                    {okPeriods.slice(1).map((p, i) => (
                      <PeriodContextBlock key={i} title={`Alternativa ${i + 1}`} period={p} tone="alt" />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="font-semibold text-brand-ink text-sm mb-2">📏 Instrucciones que recibe el agente</h4>
                <ul className="space-y-1.5">
                  {AGENT_RULES.map((r, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-700">
                      <span className="text-primary-600 shrink-0">✓</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-secondary-100 bg-secondary-25 p-4 text-sm text-gray-700 space-y-2">
              <h4 className="font-semibold text-brand-ink text-sm">📏 Instrucción que recibe el agente</h4>
              {preview.tone === "advisor" && (
                <p>
                  Derivar al estudiante a un <span className="font-semibold">asesor de Admisión</span> para conocer el
                  arancel y las opciones de inscripción. No consultar, inventar ni estimar precios.
                </p>
              )}
              {preview.tone === "derive" && (
                <p>
                  Informar que en este momento no tiene el dato disponible y ofrecer derivar a Admisión, con tono cálido.
                  <span className="font-semibold"> Jamás</span> mencionar la falla ni inventar montos, cuotas o precios.
                </p>
              )}
              {preview.tone === "none" && (
                <p>
                  No hay contexto de precio: la consulta no llega a ejecutarse porque faltan datos obligatorios en el
                  request. Es un problema de configuración, previo al agente.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ result, index }: { result: DiagnosisResult; index: number }) {
  const [copied, setCopied] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const style = VERDICT_STYLES[result.verdict.code] ?? VERDICT_STYLES.PRICE_FETCH_ERROR;

  const copy = async () => {
    await navigator.clipboard.writeText(buildReport(result));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`border rounded-xl p-5 ${style.card}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-white text-sm font-bold px-3 py-1 rounded-full ${style.badge}`}>
            {style.label}
          </span>
          <span className="text-sm text-gray-600 font-mono">
            #{index + 1} · carrera {result.input.program_id} · modalidad {result.input.modality_id} · CAU {result.input.cau_id}
          </span>
        </div>
        <button
          onClick={copy}
          className="text-xs bg-white border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50 font-medium"
        >
          {copied ? "¡Copiado! ✓" : "📋 Copiar reporte"}
        </button>
      </div>

      <p className="text-xs text-gray-500 mb-1">{result.modalityName}</p>
      <h3 className="font-semibold text-gray-900">{result.verdict.title}</h3>
      <p className="text-sm text-gray-700 mt-1">{result.verdict.explanation}</p>
      <p className="text-sm font-medium mt-2">
        {RESPONSIBLE_LABELS[result.verdict.responsible]}
        <span className="text-gray-400 font-normal"> · el middleware respondería HTTP {result.verdict.httpEquivalent}</span>
      </p>

      <div className="mt-4 bg-white rounded-lg border border-gray-200 px-4 py-2">
        {result.steps.map((s) => (
          <StepRow key={s.id} step={s} />
        ))}
      </div>

      {result.periodPrices.length > 0 && (
        <div className="mt-3 bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2">Período</th>
                <th className="px-3 py-2">Total del período</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {result.periodPrices.map((p, i) => (
                <PeriodRow key={i} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BotMessage result={result} />

      <div className="mt-3">
        <button
          onClick={() => setShowContext(true)}
          className="inline-flex items-center gap-2 text-sm font-medium text-secondary-700 bg-secondary-50 hover:bg-secondary-100 border border-secondary-100 rounded-full px-4 py-2 transition-colors"
        >
          🧠 Ver el contexto que tendría el agente IA
        </button>
      </div>

      {showContext && <AgentContextDialog result={result} onClose={() => setShowContext(false)} />}

      <p className="text-xs text-gray-400 mt-4 text-right">
        Diagnóstico completo en {(result.totalDurationMs / 1000).toFixed(1)} s
      </p>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

const EXAMPLE = `{
  "cau_id": "C167",
  "modality_id": 1,
  "program_id": 1865
}`;

type PendingItem =
  | { status: "pending"; input: Record<string, unknown> }
  | { status: "running"; input: Record<string, unknown> }
  | { status: "done"; input: Record<string, unknown>; result: DiagnosisResult }
  | { status: "error"; input: Record<string, unknown>; message: string };

export default function Home() {
  const [texts, setTexts] = useState<string[]>([""]);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [running, setRunning] = useState(false);
  const [parseErrors, setParseErrors] = useState<Record<number, string>>({});

  const setTextAt = (i: number, value: string) => {
    setTexts((prev) => prev.map((t, j) => (j === i ? value : t)));
    setParseErrors((prev) => {
      if (!(i in prev)) return prev;
      const next = { ...prev };
      delete next[i];
      return next;
    });
  };

  const addBox = () => setTexts((prev) => [...prev, ""]);

  const removeBox = (i: number) => {
    setTexts((prev) => prev.filter((_, j) => j !== i));
    setParseErrors({});
  };

  const hasContent = texts.some((t) => t.trim());

  const run = async () => {
    // Parsear cada caja por separado; si en una caja pegaron varios JSON
    // igual los separamos internamente.
    const inputs: Record<string, unknown>[] = [];
    const errors: Record<number, string> = {};
    texts.forEach((t, i) => {
      if (!t.trim()) return; // cajas vacías se ignoran
      const parsed = parseInputs(t);
      if (parsed.error) errors[i] = parsed.error;
      else inputs.push(...parsed.inputs);
    });

    if (Object.keys(errors).length > 0 || inputs.length === 0) {
      if (inputs.length === 0 && Object.keys(errors).length === 0) {
        errors[0] = "Pegá al menos un JSON.";
      }
      setParseErrors(errors);
      return;
    }
    setParseErrors({});
    setRunning(true);

    const initial: PendingItem[] = inputs.map((input) => ({ status: "pending", input }));
    setItems(initial);

    // Secuencial a propósito: Siglo 21 tira 500 con requests concurrentes.
    for (let i = 0; i < inputs.length; i++) {
      setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: "running" } : it)) as PendingItem[]);
      try {
        const res = await fetch("/api/diagnose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(inputs[i]),
        });
        if (!res.ok) throw new Error(`El servidor de la herramienta respondió HTTP ${res.status}`);
        const result: DiagnosisResult = await res.json();
        setItems((prev) =>
          prev.map((it, j) => (j === i ? { status: "done", input: inputs[i], result } : it))
        );
      } catch (err) {
        setItems((prev) =>
          prev.map((it, j) =>
            j === i
              ? { status: "error", input: inputs[i], message: err instanceof Error ? err.message : String(err) }
              : it
          )
        );
      }
    }
    setRunning(false);
  };

  const doneCount = items.filter((i) => i.status === "done" || i.status === "error").length;

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <ConversiaLogo className="h-6 w-auto text-brand-ink" />
          <span className="text-xs font-medium text-secondary-700 bg-secondary-50 border border-secondary-100 rounded-full px-2.5 py-0.5">
            Herramienta interna · QA
          </span>
        </div>
        <h1 className="text-2xl font-bold text-brand-ink">🔍 Diagnóstico de precios — Siglo 21</h1>
        <p className="text-gray-600 mt-1">
          Pegá el JSON de la consulta (o varios) y la herramienta ejecuta el mismo flujo que el agente IA
          — turnos → períodos → precios — contra la API real de Siglo 21, te dice en qué paso falló y
          por qué, y te muestra <span className="font-medium text-brand-ink">un ejemplo de lo que le
          diría el agente IA al estudiante</span>.
        </p>
      </header>

      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Pegá el JSON de la consulta. Si tenés más de una, usá el botón{" "}
          <span className="font-semibold">“Agregar otra consulta”</span>:
        </label>

        <div className="space-y-3">
          {texts.map((t, i) => (
            <div key={i} className="relative">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-400">Consulta #{i + 1}</span>
                {texts.length > 1 && (
                  <button
                    onClick={() => removeBox(i)}
                    disabled={running}
                    className="text-xs text-red-500 hover:text-red-700 hover:underline disabled:opacity-40"
                    title="Quitar esta consulta"
                  >
                    ✕ Quitar
                  </button>
                )}
              </div>
              <textarea
                value={t}
                onChange={(e) => setTextAt(i, e.target.value)}
                placeholder={EXAMPLE}
                rows={6}
                spellCheck={false}
                className={`w-full font-mono text-sm border rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-primary-400 placeholder:text-gray-300 ${
                  parseErrors[i] ? "border-red-400 bg-red-50" : "border-gray-300"
                }`}
              />
              {parseErrors[i] && (
                <p className="text-sm text-red-600 mt-1 whitespace-pre-wrap">⚠️ {parseErrors[i]}</p>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button
            onClick={addBox}
            disabled={running}
            className="border border-primary-200 text-primary-700 bg-primary-50 hover:bg-primary-100 disabled:opacity-40 font-medium px-4 py-2.5 rounded-full transition-colors"
          >
            ➕ Agregar otra consulta
          </button>
          <button
            onClick={run}
            disabled={running || !hasContent}
            className="bg-primary-300 hover:bg-primary-400 disabled:bg-gray-200 disabled:text-gray-400 text-brand-ink font-semibold px-5 py-2.5 rounded-full shadow-sm transition-colors"
          >
            {running ? `Diagnosticando… (${doneCount}/${items.length})` : "▶ Diagnosticar"}
          </button>
          {running && (
            <span className="text-sm text-gray-500">
              Las consultas se procesan de a una (Siglo 21 no acepta consultas simultáneas).
            </span>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {items.map((item, i) => {
          if (item.status === "done") return <ResultCard key={i} result={item.result} index={i} />;
          if (item.status === "error")
            return (
              <div key={i} className="border border-red-300 bg-red-50 rounded-xl p-5">
                <p className="font-semibold text-red-800">
                  #{i + 1} — Error de la herramienta (no de Siglo 21)
                </p>
                <p className="text-sm text-red-700">{item.message}</p>
              </div>
            );
          return (
            <div key={i} className="border border-gray-200 bg-gray-50 rounded-xl p-5 flex items-center gap-3">
              {item.status === "running" ? (
                <span className="inline-block w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="text-gray-400">⏳</span>
              )}
              <span className="text-sm text-gray-600 font-mono">
                #{i + 1} · carrera {String(item.input.program_id ?? "?")} · modalidad {String(item.input.modality_id ?? "?")} · CAU {String(item.input.cau_id ?? "?")}
              </span>
              <span className="text-sm text-gray-400">
                {item.status === "running" ? "consultando Siglo 21…" : "en cola"}
              </span>
            </div>
          );
        })}
      </div>

      <footer className="mt-10 text-xs text-gray-400 border-t border-gray-100 pt-4">
        Réplica del flujo <span className="font-mono">get-price-v5</span> del middleware siglo21-price-proxy ·
        Herramienta interna de Conversia · Los resultados reflejan el estado de la API de Siglo 21 en este momento
        (una falla ocurrida durante una conversación pasada pudo haber sido temporal).
      </footer>
    </main>
  );
}
