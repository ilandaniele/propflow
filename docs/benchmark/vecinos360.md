# Benchmark funcional: Vecinos360 frente a Propflow

Fuente: navegación de solo lectura (GET) de la consola de Vecinos360 con una cuenta de residente de un edificio en Lima, más el sitio público. No se envió ningún formulario. Solo se registran módulos, campos y acciones; ningún dato personal de vecinos.

Vecinos360 es software de administración de condominios (cuotas de mantenimiento, áreas comunes, junta directiva). Propflow es software de alquiler (renta por unidad). Muchas funciones aplican igual a un edificio de habitaciones en alquiler; las que solo tienen sentido para condominios se marcan "condominio".

## 1. Planes (sitio público)

- **Pro:** USD 35/mes + USD 1 por unidad (1–299 unidades).
- **Club:** USD 300/mes hasta 300 unidades.
- **Business:** 500+ unidades, a medida.
- Apps móviles para administradores y vecinos.

## 2. Inventario por módulo (vista residente)

### Inicio
- Saldo acumulado de la unidad con enlace al estado de cuenta.
- Código de recaudación para pagar en banco.
- Muro de publicaciones: tipo, visibilidad pública/privada, marca "importante", fijar arriba, adjuntos, comentarios.
- Notificaciones y selector de comunidad (un usuario en varias comunidades).
- Accesos rápidos: Liquidación Anual, Activos, Documentos, Registrar Visita.

### Estado de cuenta por unidad (`estcta_depa`)
- Recibos de mantenimiento por mes: nro. recibo, fecha de emisión, monto, fecha de cobro.
- Detalle de cuota por concepto.
- Filtro por fecha real de cobro o mes de cobranza, desde/hasta.
- **Constancias de pago** subidas por el residente: fecha de pago, monto, mes al que corresponde, mensaje, archivo. Lista "Mis confirmaciones de pago".

### Comunicaciones
- **Mensajes internos** a Administradores, Junta Directiva o ambos; tipo (mantenimiento preventivo/correctivo/predictivo, zonas comunes, administración, servicios, vecinos, obras, otros, consulta, notificación), asunto, mensaje con editor rico. Bandeja.
- **Crear publicación** en el muro: título, visibilidad, tipo, comentario, imagen.
- **Encuestas y votaciones**: listado con filtro por fecha, crear encuesta/votación.
- Configuración de notificaciones por correo en el perfil.

### Solicitudes a la administración (`solicitudes`)
- Tipo (mismo catálogo), estado (Por atender, Programada, Terminada, Vencida, Fuera de fecha), solicitante o proveedor, responsable, responsable de término, comentario de término.
- Fechas: inicio, estimada, término (fecha y hora).
- Visibilidad pública/privada, observación, adjuntos, comentarios del administrador.
- Filtros por rango, tipo, estado, responsable, proveedor; paginación; imprimir.

### Reservas de áreas comunes (`agenda`)
- Calendario mes/semana/día de áreas (p. ej. parrilla, terraza) con franja horaria.
- Acciones del día, alertas. Las reservas aparecen también en el muro.

### Registro de visitas (`reg_invitados`)
- Fecha y hora de entrada/salida, tipo (proveedor, amigos/familia), palabra clave (mín. 5 letras) para validar en portería, observación.
- Lista de visitantes: nombres, apellidos, sexo, tipo y número de documento (DNI, CE, pasaporte, RUC), email, teléfonos, foto.
- Personas autorizadas permanentes.

### Reportes: Finanzas
- **Resumen**: saldo de la comunidad, número de morosos, cuentas por cobrar, cuentas por pagar.
- **Liquidación mensual**: saldo inicial (por banco/caja: monto real, cheques pendientes, total); ingresos por unidad y concepto; ingresos externos; egresos por partida/subpartida/proveedor; saldo final bruto; conciliación bancaria; cheques no cobrados; cuentas por cobrar y por pagar; responsables de la liquidación; comentarios. Imprimir.
- **Liquidación anual**: matriz ENE–DIC con resumen financiero, detalle de saldo inicial, ingresos, egresos, cuotas adelantadas, saldo económico, cuentas por cobrar y por pagar. Exportar a Excel.
- **Cajas y bancos**: cuentas (banco, activa, nro., monto inicial, monto actual) y movimientos por mes (fecha, concepto, documento, ingreso, egreso). Exportar.
- **Emisión y justificación de cuota**: cómo se compone la cuota del mes (diseñador de cuotas: conceptos repartidos por unidad).
- **Gastos**: egresos por partida (mantenimiento, personal, servicios administrativos, servicios públicos, suministros, otros, extras) y subpartida, rango de fechas, flujo anual consolidado, adjunto del comprobante.
- **Presupuesto de egresos**: por partida/subpartida, presupuestado vs real y diferencia; filtro excedido/dentro; flujo anual.
- **Reporte de ingresos**: por unidad, residente, concepto, fecha de cobro, documento, monto; tipo de cuota ordinaria/extraordinaria; filtro por morosidad; exportar todo o por lote.
- **Reporte de egresos**: partida/subpartida/proveedor, concepto, fecha de pago, documento, estado (emitido/cobrado), tipo ordinario/extraordinario. Exportar.
- **Cierre del mes**: estado de cierre por mes del año (bloquea el periodo).

### Reportes: Seguridad
- Visitantes en la comunidad, directorio de empleados (nombre, cargo, foto, documento), personas autorizadas.

### Reportes: Mantenimiento
- **Activos y componentes**: foto, nombre, último y próximo mantenimiento, cantidad realizada, componentes (código, nombre, descripción, estado), historial. Imprimir.
- **Cuadro de mantenimiento**: plan anual por tarea (tipo, responsable, proveedor, periodicidad, costo, total) con columnas ENE–DIC; tareas frecuentes vs independientes.
- Solicitudes a la administración (arriba).

### Reportes: Convivencia
- **Incidencias de la comunidad**: fecha/hora, tipo (vecinos, activos, instalaciones), reportado por, asunto, actores, fecha de subsanación, estado. Imprimir.
- Encuestas, documentos de la comunidad (categorías como reglamentos, con archivo y descripción), directorio de residentes.

### Otros
- **Actividad del administrador**: feed de lo que hizo la administración, filtrable por fecha (transparencia).
- **Mi perfil**: datos personales, unidad (edificio, sección, intercomunicador, integrantes del grupo), usuario y contraseña, notificaciones por correo.
- El módulo de administración no es accesible con rol residente.

## 3. Brechas frente a Propflow

Leyenda como en `homming-habitamax.md`. Se omiten filas ya cubiertas allí (estado de cuenta, recibo, morosidad, proveedores, documentos, roles).

| # | Funcionalidad | Propflow | Evidencia | Prioridad |
|---|---|---|---|---|
| V1 | Cuentas de caja y banco con saldo inicial/actual y movimientos | falta | `deposit_accounts` es catálogo de solo lectura | P1 |
| V2 | Liquidación mensual (saldo inicial + ingresos − egresos = saldo final, por cuenta) imprimible | parcial | P&L y flujo de caja en `/dashboard/finance` sin saldos por cuenta | P1 |
| V3 | Liquidación anual ENE–DIC exportable a Excel | parcial | reportes en pantalla sin matriz anual ni exportación | P1 |
| V4 | Presupuesto por categoría con real vs presupuestado | falta | `expense_categories` sin montos presupuestados | P1 |
| V5 | Gastos con partida/subpartida y tipo ordinario/extraordinario | parcial | `expenses` + `expense_categories` (un nivel) | P2 |
| V6 | Cierre de mes que bloquea edición del periodo | falta | — | P2 |
| V7 | Solicitudes con estados programada/vencida, fechas estimada y de término, responsable | parcial | `incidents` pending/in_progress/solved, sin fecha estimada ni vencida | P1 |
| V8 | Reserva de áreas comunes con calendario y franjas | falta | — | P1 |
| V9 | Visitas con palabra clave y personas autorizadas permanentes | parcial | `visitor_logs`, portal `/portal/visitors` | P2 |
| V10 | Activos con plan de mantenimiento preventivo y cuadro anual | falta | `cleaning_tasks`, `tenant_tasks` no modelan activos | P1 |
| V11 | Publicaciones del muro con importante, fijar y visibilidad | parcial | `announcements`, `community_posts` | P2 |
| V12 | Encuestas y votaciones a residentes | parcial | `tenant_feedback` (satisfacción), no votación | P2 |
| V13 | Feed de actividad del administrador visible al inquilino | falta | — | P2 |
| V14 | Directorio de empleados/personal del edificio | parcial | `responsables` | P2 |
| V15 | Usuario en varias comunidades con selector | falta | igual a fila 24 de homming-habitamax | P2 |
| V16 | Diseñador de cuotas / reparto de conceptos por unidad | parcial | igual a fila 5 (reparto de servicios) | P0 |
| V17 | Mensajes internos inquilino a admin con tipo y bandeja | parcial | WhatsApp y comunidad; sin bandeja en portal | P2 |
| V18 | Cuentas por pagar a proveedores con vencimiento, pagos parciales y saldo | falta | `expenses` registra solo gasto pagado, sin vencimiento ni saldo | P1 |
| V19 | Preferencias de notificaciones por correo en el perfil | falta | — | P2 |
| V20 | Inquilino registra constancia de pago con archivo y periodo | parcial | `RecordPaymentForm` sin archivo ni periodo y sin montar en el portal | P1 |

## PRs de implementación

| Fila | PR |
|---|---|
| V1, V2, V3 | #130 |
| V4 | #131 |
| V5 | #162 |
| V6 | #161 |
| V7 | #132 |
| V8 | #133 |
| V9 | #163 |
| V10 | #134 |
| V11 | #160 |
| V12 | #158 |
| V13 | #164 |
| V14 | #165 |
| V15 | #166 |
| V16 | #124 |
| V17 | #159 |
| V18 | #184 |
| V19 | #183 |
| V20 | #185 |

## Cobertura por página de la consola

Lectura solo con GET de cada página enlazada desde el menú del residente y desde Reportes. Las páginas `adm_*` y `pnl_admin` redirigen a la portada pública también al navegar, porque esta cuenta no tiene rol administrador. `constancia_pago` y `recibo_mantenimiento` no se abren sueltas; se leyeron desde `estcta_depa`. La pestaña "Recibos y Constancias" lista por mes: recibos emitidos, mis constancias de pago y mis confirmaciones de pago. El modal "Registrar Constancias de Pago" pide fecha de pago, monto, mes al que corresponde, mensaje y archivo (se abrió y se canceló sin guardar).

| Página | Función | Fila / PR |
|---|---|---|
| `pnl_user` | Menú inicial: saldo, muro, reservas | V11, V8 |
| `cuentas_usuario` | Mis comunidades (selector) | V15 / #166 |
| `cuenta` | Perfil, unidad, persona autorizada, correos | V9 / #163, V19 / #183 |
| `agrega_post_ci` | Enviar mensaje a la administración | V17 / #159 |
| `agrega_post`, `comunicaciones` | Muro de publicaciones | V11 / #160 |
| `solicitudes` | Solicitudes a la administración | V7 / #132 |
| `blog_votaciones` | Encuestas y votaciones | V12 / #158 |
| `agenda`, `agenda_lista`, `agrega_post_ae` | Reservas: instalación, franjas, cantidad de personas, comentario | V8 / #133 |
| `reg_invitados` | Visitantes y palabra clave | V9 / #163 |
| `estcta_depa`, `constancia_pago`, `recibo_mantenimiento` | Estado de cuenta, recibos emitidos, constancias y confirmaciones de pago | estado de cuenta #125, recibo PDF #126, aviso al admin #142, constancia con archivo y periodo V20 / #185 |
| `cobroOnlineController` | Cobro online | fila 9 / #181 |
| `cierre_mes` | Cierre del mes | V6 / #161 |
| `cajasbancos` | Cajas y bancos | V1 / #130 |
| `liquidacion_mensual`, `liquidacion_anual`, `expexcel`, `exppdf` | Liquidaciones y exportación | V2, V3 / #130 |
| `emisionjustificacion` | Emisión y justificación de cuotas | V16 / #124 |
| `presupuestos` | Presupuesto de egresos | V4 / #131 |
| `estadisticas` | Gastos por partida y obligaciones de pago | V5 / #162, V18 / #184 |
| `lista_ingresos`, `lista_egresos` | Reportes de ingresos y egresos | ya existe (finanzas), V5 / #162 |
| `activos`, `cuadro_mantenimiento` | Activos y plan de mantenimiento | V10 / #134 |
| `incidentes` | Incidentes | ya existe (`incidents`) |
| `docs_comunidad` | Documentos de la comunidad | fila 25 / #147 |
| `directorio` | Directorio | V14 / #165 |
| `actividad_admin` | Actividad del administrador | V13 / #164 |
