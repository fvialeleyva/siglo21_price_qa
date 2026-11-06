# Diagnóstico de precios — Siglo 21 (QA)

Herramienta interna de Conversia para que el equipo de CS pueda diagnosticar por qué
falló una consulta de precio del bot, sin depender de alguien técnico.

Replica **`get-price-v4`** del middleware `siglo21-price-proxy` tal como queda con la rama
`fix/v4-calendario-comercial-2027` de
[Conversia-AI/conversia-legacy-lambdas](https://github.com/Conversia-AI/conversia-legacy-lambdas)
(ticket HF-0123: calendario comercial 2027 y criterios de comunicación;
`pkg/services/pricing-service.go` → `HandleGetPriceV4`, `getPricesByModalityV4`,
`resolveV4PrimaryPeriod`, `FormatPriceResponseByModalityV4` / `formatV4BimesterResponse`):

```
Validación v4 → ¿Deriva a asesor (9, 10, 12)? → Token (client_credentials) → 1) Turnos (se usa el PRIMERO) → 2) Períodos → 3) Precios según la rama (en secuencia)
```

Ramas de precio (igual que el lambda):

| Modalidad | Rama | Qué cotiza |
|---|---|---|
| 1 EHD · 2 ED · 3 PRESENCIAL · 4 PH Córdoba · 5 PH Río IV · 7 PH Río IV (ID previo) | bimestral | Período activo por el calendario comercial hardcodeado del lambda (reglas HF-0113 y HF-0123: el vigente más próximo cuya venta, incluida la extensión, cubre hoy) o, si Siglo 21 no lo devuelve, el próximo período de la tabla que sí vino + los demás períodos **en venta** como alternativos ocultos. Primero 6 cuotas; 3 cuotas solo ante objeción. Las presenciales usan la misma tabla que la distancia |
| 9 PRESENCIAL (ID previo) · 10 · 12 | deriva a asesor | 200 sin consultar a Siglo 21 |
| cualquier otra | — | Consulta token, turnos y períodos y termina en 500 |

Calendario comercial (cuadro "NI" de Siglo 21): 1A/27 28/07/2026–14/03/2027 (ext. 28/03/2027),
1B/27 15/03–16/05/2027 (ext. 30/05), 2A/27 17/05–01/08/2027 (ext. 15/08), 2B/27
02/08–03/10/2027 (ext. 17/10). Las filas de 2026 se conservan como histórico (ventanas ya
cerradas). Las fechas de venta y extensión son de uso interno: el agente
nunca las informa. Solo 1A/27 tiene inicio de clases confirmado ("Las clases inician en marzo
2027."). El bloque de precio informa además el beneficio por inscripción anticipada y, para
las carreras de la lista, las materias por semestre (tecnicaturas 4; licenciaturas entre 5 y 6).
No informa meses ni fechas que cubre el pago.

Selección del período principal (rama bimestral):

1. Si Siglo 21 devuelve el **período activo** de la tabla, se cotiza ese.
2. Si no, se cotiza el **primer período posterior al activo** (en el orden de la tabla:
   1A/26 → … → 2B/26 → 1A/27 → 1B/27 → 2A/27 → 2B/27) que sí vino, con su propio precio, y el bloque de precio
   agrega en negrita una aclaración: *"Para esta carrera y modalidad, la inscripción
   disponible es para el próximo período."* (o *"…para el próximo año."* si es de otro
   ciclo; con *": las clases inician en {inicio}."* si el período tiene inicio confirmado).
   Las reglas críticas prohíben ofrecer el período activo y el contexto interno suma una
   línea `Nota:`.
3. Si no vino ni el activo ni uno posterior de la tabla (solo períodos anteriores o fuera de
   la tabla), **no se cotiza**: responde 500 con la instrucción de error (el bot deriva).

En v4 los alternativos ocultos (solo los que están en su ventana de venta) se ofrecen si el
estudiante no puede comenzar en el principal **o si pregunta explícitamente por otro inicio o
por el próximo año**. El calendario cargado termina el 17/10/2027.

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
| `NO_ACTIVE_OR_NEXT_PERIOD` | 500 | Siglo 21 no devolvió el período activo ni uno posterior de la tabla (solo anteriores o fuera de tabla) |
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
