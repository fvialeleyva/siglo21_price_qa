# Diagnóstico de precios — Siglo 21 (QA)

Herramienta interna de Conversia para que el equipo de CS pueda diagnosticar por qué
falló una consulta de precio del bot, sin depender de alguien técnico.

Replica **`get-price-v4`** del middleware `siglo21-price-proxy` tal como queda con el PR
[Conversia-AI/conversia-legacy-lambdas#22](https://github.com/Conversia-AI/conversia-legacy-lambdas/pull/22)
(rama `feat/v4-presencial-bimester`; `pkg/services/pricing-service.go` → `HandleGetPriceV4`,
`getPricesByModalityV4`, `FormatPriceResponseByModalityV4`):

```
Validación v4 → ¿Deriva a asesor (9, 10, 12)? → Token (client_credentials) → 1) Turnos (se usa el PRIMERO) → 2) Períodos → 3) Precios según la rama (en secuencia)
```

Ramas de precio (igual que el lambda):

| Modalidad | Rama | Qué cotiza |
|---|---|---|
| 1 EHD · 2 ED · 3 PRESENCIAL · 4 PH Córdoba · 5 PH Río IV · 7 PH Río IV (ID previo) | bimestral | Período activo por la tabla hardcodeada del lambda (regla HF-0113: el de inicio de clases más próximo cuya venta, incluida la extensión, cubre hoy) + el resto de períodos como alternativos ocultos. 6 cuotas → 3 cuotas, frase de período de cursado y meses de cursado. Las presenciales usan la misma tabla que la distancia |
| 9 PRESENCIAL (ID previo) · 10 · 12 | deriva a asesor | 200 sin consultar a Siglo 21 |
| cualquier otra | — | Consulta token, turnos y períodos y termina en 500 |

Si Siglo 21 no devuelve el período activo de la tabla, el lambda cotiza el **primer período
de la API** como respaldo y el texto muestra el nombre y los meses del período de la tabla
(la herramienta lo marca como "período de respaldo"). La tabla termina el 14/03/2027.

El `cau_id` se usa tal cual llega (sin overrides) y `schedule_id` no se usa.

Para cada paso muestra si funcionó, el status HTTP, la URL exacta y la respuesta cruda de
Siglo 21; para cada período devuelto, qué hace v4 con él (principal, alternativo o
ignorado); y la **respuesta exacta que daría v4** (HTTP + body, con el mismo `output`
que arma el lambda) para comparar con la auditoría de la tool.

Veredictos (con el HTTP equivalente del lambda):

| Código | HTTP v4 | Cuándo |
|---|---|---|
| `OK` | 200 | Precio obtenido |
| `OK_PARTIAL` | 200 | Precio obtenido, pero algún alternativo falló y el lambda lo omite en silencio |
| `ADVISOR_MODALITY` | 200 | Modalidades 9, 10, 12 |
| `INVALID_REQUEST_BODY` / `MISSING_REQUIRED_FIELD` | 400 | Body ilegible o falta `program_id` / `modality_id` / `cau_id` |
| `AUTH_FAILED` | 401 | Falla el token |
| `NO_SCHEDULES_AVAILABLE` / `NO_PERIODS_AVAILABLE` | 404 | Error o lista vacía en turnos / períodos |
| `NO_ACTIVE_ED_EHD_PERIOD` | 500 | Modalidad bimestral (1, 2, 3, 4, 5, 7) fuera de todas las ventanas de la tabla del lambda |
| `PRICE_FETCH_ERROR` | 500 | Falla el precio del período principal |
| `UNSUPPORTED_MODALITY` | 500 | Modalidad sin lógica de precio en v4 |

La lógica pura (tabla de bimestres, formateador del `output`) está en `lib/get-price-v4.ts` y la
ejecución contra Siglo 21 en `lib/siglo21.ts`. **Si cambia el lambda, hay que actualizar
ambos.** `diagnose()` acepta `{ now }` opcional para probar con fechas fijas (la app usa
siempre la hora actual, igual que el lambda).

## Uso

Pegar en el textarea el JSON de la consulta (el mismo formato que envía el frontend):

```json
{
  "cau_id": "C167",
  "modality_id": 1,
  "program_id": 1865
}
```

Se aceptan también los campos opcionales de v4 (`llm_instruction`, `llm_instruction_error`,
`include_payment_methods`, `custom_payment_methods_info`, `include_restrictions`,
`custom_restrictions`) para que el `output` replicado sea el mismo que vio el bot.

Para consultar **varias** a la vez, usar el botón **“➕ Agregar otra consulta”** (una caja
por consulta — no hace falta armar arrays). Igualmente, si se pega un array `[{...}, {...}]`
o varios JSON en una misma caja, la herramienta los separa sola.
Se procesan en secuencia (Siglo 21 devuelve 500 ante requests concurrentes con el mismo token).

Cada resultado tiene un botón **Copiar reporte** que genera un resumen en texto listo
para reenviar (por ejemplo, al equipo de Siglo 21).

## Desarrollo

```bash
npm install
cp .env.example .env.local   # y completar las credenciales
npm run dev
```

## Deploy en Vercel

1. Importar el repo en Vercel.
2. Configurar las variables de entorno `SIGLO21_CLIENT_ID` y `SIGLO21_CLIENT_SECRET`
   (las mismas que usa el lambda en producción).
3. Deploy. No requiere nada más.

## Notas

- El diagnóstico refleja el estado **actual** de la API de Siglo 21: una falla ocurrida
  durante una conversación pasada pudo haber sido temporal y ya no reproducirse.
- Igual que el lambda, la herramienta pide un token nuevo (client_credentials contra
  `auth.ues21.edu.ar`) en cada diagnóstico, así que también detecta fallas de autenticación
  (`AUTH_FAILED`). El token nunca se muestra en la UI (se oculta en la respuesta cruda).
- Timeout por request: 10 s (igual que el lambda).
