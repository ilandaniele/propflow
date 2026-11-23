# Benchmark funcional: Homming y Habitamax frente a Propflow

Fecha: 2026-11-22. Fuente: páginas públicas (solo GET) de homming.com y habitamax.com, más lectura del repo de Propflow (`src/app`, `src/lib`, `src/lib/db/schema.ts`, `docs/01-PRD.md`, `docs/ESTADO.md`).
Alcance: solo funcionalidad. No copiamos marca, textos ni diseño.

Notas de método:
- Homming no publica precios. Su tabla de planes perdió los símbolos al extraerla, así que algunos niveles son inferidos (marcados con "inf.").
- Habitamax publica precios en € con IVA. Algunas páginas de producto son de marketing y no detallan la lógica (se indica).
- En Propflow, varias tablas (`account_statements`, `tax_receipts`, `service_payments`, `additional_charges`, `owners`, `deposit_accounts`) solo se leen: se llenaban con la sincronización de Airtable, que ya se quitó (#96), y el código no tiene ningún `insert` ni `update` sobre ellas. Las cuento como **parcial**: la pantalla existe, pero no hay forma de generar datos nuevos.

---

## 1. Homming (homming.com)

Planes: **Starter** (3 usuarios, 120 firmas Signaturit/año, 500 MB por inmueble), **Advanced** (5 usuarios, 300 firmas/año, 750 MB, funciones de IA), **Enterprise** (usuarios ilimitados, cupo de firmas a medida, 1 GB, API y app con marca propia). Complementos de pago: portal de anuncios propio con motor de reservas, y app iOS/Android propia. El 30 % de descuento anual es una promo de temporada.

### Prealquiler y captación
- Publicación de anuncios en portales mediante channel manager, o en un portal propio (Enterprise; complemento). Plan: Idealista solo en Enterprise.
- Etiquetas de características del inmueble (ascensor, cochera, amoblado, aire acondicionado, terraza, piscina, internet).
- Anuncios con tour virtual, sesión de fotos y planos 2D/3D (servicio).
- Alta de leads, con filtro por intereses.
- Envío de una solicitud al lead, que devuelve sus datos y documentos.
- Pipeline de solicitudes: abierta, visita hecha, reserva, cerrada o descartada.
- Scoring de solvencia y ranking de candidatos para priorizar visitas.
- Convertir un lead en inquilino con un clic cuando queda libre el inmueble.
- Motor de reservas propio y sincronización de disponibilidad y precio con Airbnb y Spotahome (habitaciones / media estancia; complemento).
- Filtros de compatibilidad entre inquilinos y piso (habitaciones).

### Contratos y firma
- Contratos de alquiler desde plantillas propias, todas las que se necesiten (todos los planes).
- Otros documentos desde plantilla: reserva, servicios y contrato de gestión con el propietario.
- Firma digital de inquilino y propietario desde cualquier dispositivo, con Signaturit. Cupo anual por plan.
- Seguimiento del estado de cada firma.
- Archivo de documentos firmados con su evidencia probatoria.
- Gestión de fianzas (todos los planes).
- Actualización de renta (todos los planes).
- Seguimiento de contratos (todos los planes).

### Cobros, pagos y facturación
- Cobro con tarjeta (todos los planes; pasarela básica en Starter), con transferencia (Advanced+) y con domiciliación bancaria.
- Conexión bancaria e importación de movimientos (Advanced+).
- Conciliación automática de movimientos con inmuebles y pagos pendientes.
- Estado de pago de cada alquiler.
- Ingresos, gastos y rentas por inmueble y por habitación.
- Repercusión de suministros al inquilino, con balance de suministros por contrato.
- Ingresos y gastos recurrentes programados.
- Seguimiento automático de cobros y liquidaciones.
- Liquidación al propietario (con portal del propietario, Advanced+).
- Recordatorios automáticos de facturas pendientes (impagos).
- Facturas y recibos automáticos (todos los planes).
- Factura configurable: serie de numeración, impuestos, retenciones, conceptos y logo.
- Factura electrónica Verifactu (Advanced+). Específico de España.
- Escáner de facturas con IA (Advanced+).
- Integración contable con Sage 50c, Holded, Navision, Diezcon y A3 (Enterprise).
- Saldo automático por inquilino (habitaciones).

### Incidencias y proveedores
- El inquilino reporta la incidencia con fotos y video.
- El gestor acepta o rechaza la incidencia.
- Estados y seguimiento de cada incidencia.
- Proveedores propios o de una red homologada. Se pueden compartir sus datos de contacto con el inquilino.
- Asignación de la incidencia a un proveedor.
- El proveedor envía un presupuesto desde su portal y el gestor lo valida.
- El proveedor sube factura y evidencia de resolución.
- Plazos de resolución y control de SLA.
- Conversación en la plataforma entre proveedor, inquilino, gestor y propietario.
- Agenda de limpieza y mantenimiento (habitaciones).

### Reportes (básicos en Starter, avanzados en Advanced, a medida en Enterprise)
- Informes de un clic con filtros (fechas, ubicación, tipo de vivienda): rentabilidad, declaración de la renta, impagos, ficha de inquilinos, incidencias y liquidaciones.
- Informes dinámicos: ingresos generados, caja mensual, impagos por inmueble, balance de suministros y facturas emitidas.
- Rentabilidad por inmueble y agregada por tipo o grupo; rendimiento por gestor; morosidad y recuperación; renta media.
- Panel de resultados por habitación.
- Agente de IA y generación de informes con IA (Advanced+). Informes de IA a medida (Enterprise).

### Comunicación y alertas
- Chat en tiempo real con el inquilino, con historial y fotos adjuntas.
- Alertas al gestor: vencimiento de contratos y seguros, pagos pendientes e impagos, actualización de renta e incidencias.
- Aviso al gestor cuando el inquilino sube un comprobante de pago.
- Avisos al inquilino de cobros disponibles y pendientes.
- Notificaciones push en la app y mensajería entre usuarios (todos los planes).

### Gestión inmobiliaria
- Gestor documental centralizado, con documentos compartibles con el inquilino.
- Carga masiva de alquileres.
- Historial de inquilinos, facturas e incidencias por inmueble.
- Agrupación de inmuebles con etiquetas (edificio, sociedad, ciudad, zona) e informes por grupo.
- Buscador por palabras clave: alquileres, contratos, inquilinos, seguros y documentos.
- Importación desde otros CRM inmobiliarios (viviendas, inquilinos, propietarios).
- Almacenamiento por inmueble con cupo según el plan.

### Calendario
- Eventos manuales: firma, check-in, check-out, actualización de renta, visita, limpieza, mantenimiento e incidencia.
- Eventos automáticos por vencimiento de contratos, seguros y certificados.
- Sincronización iCal (todos los planes).
- Agenda de contactos: inquilinos, propietarios, proveedores, administradores de edificio y porteros.

### Equipo, marca y plataforma
- Equipos multiusuario con invitación de miembros. El número de usuarios depende del plan.
- Permisos por usuario (Advanced+).
- App iOS/Android con logo y colores propios (Enterprise; complemento).
- Acceso desde un enlace en la web del cliente.
- API para desarrolladores (Enterprise).
- Registro con Google y Apple, validación de email, backups y cifrado.

### Portales
- Portal del propietario (Advanced+): rentabilidad, movimientos, cobros, liquidaciones, y descarga de facturas e informes.
- Portal del inquilino (todos los planes): datos del alquiler, reporte de incidencias, descarga de contrato, facturas y recibos, mensajes y subida de comprobante de pago.
- Portal del proveedor (Enterprise; inf.): incidencias asignadas, notificaciones, envío de presupuestos, facturas y evidencias, y seguimiento hasta el cierre.

### Herramientas gratuitas
- Calculadora de rentabilidad (plantilla descargable): beneficio, ingresos y gastos mensuales y totales, rentabilidad bruta y neta anual.

---

## 2. Habitamax (habitamax.com)

Planes (€/mes con IVA; facturación anual con 2 meses gratis): **Gratis** (0 €, 2 unidades, 1 persona), **Casero** (19 €, 12 unidades, 1 persona), **Gestor** (39 €, 40 unidades, 3 personas), **Operador** (69 €, 100 unidades, 10 personas), **A medida** (más de 100 unidades, sin límite de personas).
Incluido en todos los planes: edificio, piso, habitación y cama; contratos y firma; plantillas propias; rentas, gastos y recibos; multimoneda; portales de inquilino, propietario y agente; panel web; servidor MCP para Claude y ChatGPT.
Desde Casero: Telegram, incidencias, campos y categorías propios, soporte por email. Desde Gestor: informes y exportación, y varias cuentas con un solo acceso. Desde Operador: soporte prioritario. A medida: migración acompañada.

### Propiedades y unidades
- Jerarquía de hasta 3 niveles: propiedad, habitación y cama. Se alquila la hoja de cada rama (todos).
- Los balances del padre suman los de sus hijos. Los gastos comunes se cargan en la propiedad principal.
- Ficha con dirección, descripción, notas internas, propietario asignado y campos personalizados (Casero+).
- Inventario (muebles, electrodomésticos, llaves y su estado) que se inserta en el acta de entrega por variable. El acta firmada queda inmutable.
- Página pública por propiedad con la galería ordenada y las habitaciones disponibles.
- Moneda por propiedad (EUR, USD, GBP, CHF, COP, MXN, UYU, ARS), sin conversión entre ellas.
- Vista de ocupación (ocupadas y libres) con aviso de contratos por vencer.
- Calendario operativo de entradas, salidas y fin de contrato (residencias).

### Inquilinos y captación
- Formulario de solicitud personalizable, con orden de llegada de cada solicitud.
- Score de compatibilidad y solvencia del candidato.
- Alta manual o masiva de inquilinos.
- Ficha con datos, documentos e historial, vinculada a contrato y unidad.
- Documentos por inquilino (DNI, nóminas, contrato, comprobantes, seguro) con aviso de vencimiento.
- Línea de tiempo de interacciones: mensajes, notificaciones y notas.
- Al entrar: fianza y pagos adelantados vinculados a la persona y al mes.
- Al salir: devolución de fianza con monto y motivo.
- Seguimiento de leads asignables a miembros del equipo, con recordatorios (agentes).

### Contratos
- Plantillas con variables, vista previa y cláusulas reutilizables. Incluye plantillas base.
- Generación automática al elegir inquilino y unidad.
- Un contrato por habitación. Se combinan contratos temporales, de curso académico y de larga duración.
- Firma del propietario guardada una sola vez.
- Firma remota del inquilino por enlace, sin cuenta. El PDF con ambas firmas se envía por email a las dos partes.
- Archivo en la nube con buscador e historial de versiones.
- Alerta antes del vencimiento y renovación con un clic.
- Generación masiva de contratos. Tres modelos para agentes: comisión, subarriendo (rent-to-rent) y tarifa fija.
- Anexos (normas) y actas de entrega desde plantilla.

### Pagos y cobros
- Renta esperada por contrato (monto, día de vencimiento y método).
- Registro de pagos manual o por importación.
- Cruce automático de pagos con rentas esperadas. Detección de pendientes y atrasos.
- Recibo digital automático por cada pago, descargable en el portal.
- Historial de pagos y de morosidad por inquilino ("desde cuándo debe").
- Importación de extracto bancario en CSV, TSV, Excel u OFX/QFX/CAMT.053, hasta 10 MB y 1.000 filas. Pasos: subir, revisar fila por fila (propiedad, categoría y estado) e importar como lote. Sugiere la categoría por palabras clave y no pide credenciales del banco.
- Compras financiadas: cuotas vinculadas a la compra sin contar dos veces el gasto.
- Flujo de caja mensual por propiedad, con acumulado anual.

### Gastos compartidos
- Se registra la factura del servicio y se reparte entre las habitaciones con contrato activo.
- Métodos: partes iguales, proporcional (m² u ocupantes), por días (entradas y salidas a mitad de mes) o personalizado.
- Recibo individual con el desglose, visible en el portal y enviado automáticamente.
- PDF de gastos pendientes por contrato, vinculado a cada gasto original.
- Opción de sumar el reparto a la cuota mensual en un solo cargo.
- Categorías: luz, agua, gas, internet, comunidad, limpieza y propias.

### Informes (Gestor+)
- Rentabilidad bruta y neta por propiedad.
- Ocupación actual e histórica por propiedad y por habitación.
- Gastos por categoría y flujo de caja con gráficos.
- Comparativa de propiedades lado a lado.
- Exportación a PDF y Excel por propiedad y periodo.
- Estadísticas de mantenimiento: tiempo medio de resolución, incidencias por propiedad y tendencia.
- Agentes: informe mensual al propietario (automático o PDF) y desglose de comisiones. Franquicias: vista consolidada de sucursales.

### Incidencias (Casero+)
- El inquilino crea un ticket desde el portal con descripción, fotos y categoría.
- Urgencia alta, media o baja. Las urgentes se destacan.
- Asignación a técnico o empresa, comentarios y cierre.
- Historial de acciones.
- Avisos al propietario (panel, email, WhatsApp) y aviso al inquilino cuando se cierra.

### Notificaciones
- Canales: panel, email y WhatsApp (con opt-in), y Telegram si se activa.
- Avisos de bienvenida, invitación al inquilino, solicitud recibida, respuesta en una incidencia, recordatorio unos días antes del vencimiento, primer impago y actividad de la propiedad.
- Configuración de quién recibe los emails de consultas públicas.

### Documentos y plantillas
- Subir o generar documentos y vincularlos a propiedad, contrato, transacción o usuario.
- Categorías, etiquetas, búsqueda y visibilidad restringida por usuario (página de marketing; la documentación no lo detalla).

### Roles y portales
- Portales de inquilino, propietario y agente, cada uno con acceso solo a lo suyo (todos).
- Roles de staff: captador, coordinador, contable y administrador, con acceso limitado a finanzas, contratos o datos.
- Varias cuentas con un solo acceso (Gestor+).

### Asistentes
- Bot de Telegram (Casero+): texto o voz en lenguaje natural para registrar gastos, ingresos y pagos de renta (marca pagada la renta pendiente sin duplicarla), consultar el balance, filtrar, editar o borrar movimientos y adjuntar foto o PDF del comprobante. Confirma antes de guardar.
- Servidor MCP (todos): 11 lecturas (propiedades, ocupación, inquilinos, vencimientos, estado de rentas, transacciones, rendimiento, categorías, incidencias) y 3 escrituras en dos pasos (preparar y luego confirmar). OAuth en el navegador. No puede borrar, mover dinero ni tocar contratos.

### Herramientas gratuitas
- Calculadora de actualización de renta por IPC/IRAV, con su tope.
- Calculadora de gastos compartidos (por días y por habitación).
- Calculadora de rentabilidad bruta y neta, con los costos que se suelen olvidar.
- Plantillas descargables (por ejemplo, acta de entrega de llaves).

---

## 3. Lo que Propflow ya tiene (resumen)

- Multi-organización con roles `admin` y `tenant`, sin roles granulares (`profiles.role`; `docs/01-PRD.md` §5).
- Propiedades y unidades de un solo nivel (sin cama), con fotos, portada, m² y tipo de baño (`schema.ts` `properties`/`units`/`unit_images`).
- Inquilinos con ficha 360°, notas internas, invitación al portal e importación CSV (`src/app/dashboard/tenants/[id]`, `src/app/api/admin/tenants/import`).
- Contratos desde plantilla, PDF y firma propia por enlace (`src/app/actions/contractDoc.ts`, `/sign/[token]`).
- Pagos informados por el inquilino con aprobación del admin, cargos, importación CSV y KPIs de cobranza (`src/app/actions/payments.ts`, `src/lib/finance/payment-kpis.ts`).
- Incidencias con foto, prioridad, comentarios, asignación a un admin y costo (`incidents`, `incident_comments`).
- Finanzas: gastos por categoría, recibos con OCR y cruce con pagos, P&L y flujo de caja, rentabilidad por habitación, pronósticos, tarifas (`src/lib/finance/reports.ts`, `src/app/dashboard/finance/*`, `/forecasting`, `/pricing`).
- Agente de IA de leasing por WhatsApp, widget web y voz, con pipeline de leads, scoring, ruteo, seguimientos, visitas sincronizadas con Google Calendar y catálogo público (`src/lib/agent/*`, `src/lib/leads/*`, `/p/[orgSlug]`).
- Operación: tareas con prueba, sanciones con disputa, anuncios, comunidad, limpieza, visitantes, encuestas de feedback y turnos de basura.
- Recordatorios por email y WhatsApp (renovación a 30 días; vencimiento de pago a 3 días y el mismo día) y resumen semanal (`src/lib/notifications/reminder-engine.ts`).
- IA interna: brief ejecutivo, analista y asistente de chat (`/dashboard/executive-brief`, `/ai-analyst`, `/ai-assistant`).
- Solo lectura (datos del Airtable anterior, sin forma de crear nuevos): estados de cuenta (EECC), comprobantes tributarios con IGV, servicios con tope, cargos adicionales, propietarios y cuentas de depósito.

---

## 4. Tabla de brechas

Leyenda: H = Homming, X = Habitamax. ✔ tiene, ~ parcial o no detallado, — no tiene. Prioridad para un propietario peruano: P0 imprescindible, P1 importante, P2 deseable. "adaptar" = la función es española y se replica con su equivalente peruano.

| # | Funcionalidad | H | X | Propflow | Evidencia en Propflow | Prioridad |
|---|---|---|---|---|---|---|
| 1 | Cronograma de rentas esperadas por contrato (vencimiento mensual automático) | ✔ | ✔ | parcial | `charges` existe, pero no se generan mes a mes; `contracts.monthlyRent` | P0 |
| 2 | Detección automática de pendientes y atrasos, y antigüedad de deuda por inquilino | ✔ | ✔ | parcial | `reminder-engine.ts` usa `charges.dueDate`; no hay reporte de morosidad por antigüedad | P0 |
| 3 | Recibo automático (PDF) por cada pago aprobado, descargable en el portal | ✔ | ✔ | falta | `payment_receipts` guarda comprobantes subidos, no recibos emitidos | P0 |
| 4 | Estado de cuenta mensual (EECC) generado por el sistema y enviado por WhatsApp/email | ~ | ✔ | parcial | `account_statements` y `/dashboard/account-statements` solo se leen (antes Airtable) | P0 |
| 5 | Reparto de servicios (luz, agua, internet) entre habitaciones activas: iguales, m², ocupantes, días | ✔ | ✔ | parcial | `service_payments` (tope por propiedad) solo se lee; `properties.topeLuz/topeAgua`; no hay motor de reparto | P0 |
| 6 | Cargos adicionales y conceptos creados desde la app (no solo importados) | ✔ | ✔ | parcial | `additional_charges` y `charge_concepts` solo se leen; `createCharge` en `payments.ts` | P0 |
| 7 | Importar extracto bancario (CSV/Excel) y conciliar con rentas esperadas | ✔ | ✔ | parcial | CSV de pagos con plantilla (`/api/admin/payments/import`); no lee formatos de BCP, Interbank o BBVA ni concilia con el esperado | P0 |
| 8 | Comprobante electrónico SUNAT (boleta/factura, IGV, serie y correlativo) — adaptar de Verifactu | ✔ | — | parcial | `tax_receipts` con IGV solo se lee; no hay emisión vía OSE/PSE (Nubefact, etc.) | P0 (adaptar) |
| 9 | Cobro en línea: tarjeta, Yape/Plin y transferencia con conciliación — adaptar a Culqi, Mercado Pago o Niubiz | ✔ | — | falta | PRD §7: "no hay integración" | P1 |
| 10 | Fianza (garantía): cobro al entrar y devolución al salir con descuentos y motivo | ✔ | ✔ | parcial | solo el campo `contracts.deposit`; `deposit_accounts` es catálogo bancario de solo lectura | P0 |
| 11 | Actualización de renta (reajuste % anual o pactado) con alerta y calculadora | ✔ | ✔ | falta | no hay lógica de reajuste | P1 |
| 12 | Renovación de contrato con un clic (nuevo periodo desde el mismo contrato o plantilla) | ~ | ✔ | parcial | recordatorio a 30 días en `reminder-engine.ts`; `updateContractStatus` sin acción de renovar | P0 |
| 13 | Variables en plantillas, vista previa y firma del propietario guardada | ✔ | ✔ | parcial | `contract_templates` y `contractDoc.ts`; verificar variables y firma del propietario | P1 |
| 14 | PDF firmado por ambas partes con evidencia (IP, hora, hash) enviado a las dos | ✔ | ✔ | parcial | `signature_requests`, `/api/sign/[token]`; falta evidencia y doble firma | P1 |
| 15 | Acta de entrega y devolución con inventario (check-in y check-out) firmable | ~ | ✔ | falta | — | P1 |
| 16 | Jerarquía con cama (propiedad › habitación › cama) y balances que suman hacia arriba | ~ | ✔ | parcial | `units` de un solo nivel bajo `properties`; rentabilidad por habitación en `/finance/rooms` | P2 |
| 17 | Portal del propietario: rentabilidad, movimientos, liquidaciones e informes | ✔ | ✔ | falta | `owners` sin vínculo a propiedad ni login (solo lectura) | P1 |
| 18 | Liquidación mensual al propietario: renta − gastos − comisión %, en PDF | ✔ | ✔ | falta | — | P1 |
| 19 | Proveedores: catálogo, asignar incidencia, presupuesto, factura y evidencia (y portal) | ✔ | ~ | parcial | `incidents.assignedTo` solo apunta a un admin; `responsables` es contacto; `incidents.cost` | P1 |
| 20 | SLA y plazo por incidencia, aceptar o rechazar, e historial de acciones | ✔ | ✔ | parcial | `status` pending/in_progress/solved; sin SLA ni rechazo | P2 |
| 21 | Aviso al inquilino de cambio de estado o cierre de incidencia (WhatsApp/email) | ✔ | ✔ | parcial | `notification_inbox` y eventos; verificar el disparo al cerrar | P1 |
| 22 | Estadísticas de mantenimiento (tiempo medio de resolución, incidencias por propiedad) | ✔ | ✔ | falta | — | P2 |
| 23 | Roles y permisos granulares (contable, coordinador, solo lectura) | ✔ | ✔ | falta | PRD §5 y §7: solo admin/tenant | P1 |
| 24 | Usuario con varias organizaciones y un solo acceso | ~ | ✔ | falta | `profiles.user_id` único | P2 |
| 25 | Gestor documental: documentos por inquilino, contrato o propiedad, con vencimiento y visibilidad | ✔ | ✔ | falta | solo fotos, comprobantes y PDF de contrato en storage | P1 |
| 26 | Vencimiento de DNI, seguros y certificados con alertas | ✔ | ✔ | falta | — | P2 |
| 27 | Informe exportable (PDF/Excel) de rentabilidad, morosidad y liquidaciones con filtros | ✔ | ✔ | parcial | KPIs en pantalla (`reports.ts`); sin exportación ni filtro por grupo | P1 |
| 28 | Ocupación histórica y vacancia por unidad | ✔ | ✔ | parcial | `units.status` actual; salud de datos en `lib/dashboard/health.ts` | P1 |
| 29 | Comparativa de propiedades lado a lado | ~ | ✔ | parcial | P&L por propiedad (`PropertyPnL`) | P2 |
| 30 | Reporte para el impuesto a la renta de primera categoría (5 % efectivo, Formulario 1683) — adaptar de "declaración de la renta" | ✔ | — | falta | — | P1 (adaptar) |
| 31 | Gastos e ingresos recurrentes programados | ✔ | ~ | falta | `expenses` sin recurrencia | P2 |
| 32 | Agrupación de inmuebles por etiqueta (edificio, propietario, zona) e informes por grupo | ✔ | — | falta | — | P2 |
| 33 | Buscador global (inquilino, contrato, documento) | ✔ | ✔ | falta | búsqueda por pantalla | P2 |
| 34 | Calendario operativo: entradas, salidas, vencimientos, limpiezas y visitas, con iCal | ✔ | ✔ | parcial | Google Calendar solo para visitas (`lib/calendar`); limpieza en `cleaning_tasks` | P2 |
| 35 | Chat inquilino-admin en el portal, con adjuntos | ✔ | ~ | parcial | WhatsApp bidireccional (`/dashboard/whatsapp`); comunidad y anuncios; no hay chat 1:1 en el portal | P2 |
| 36 | Aviso al admin cuando el inquilino sube comprobante | ✔ | ~ | parcial | el pago queda `pending`; verificar la notificación | P1 |
| 37 | Publicación en portales — adaptar de Idealista a Urbania, Adondevivir e Infocasas | ✔ | — | parcial | catálogo público `/p/[orgSlug]` y `listings`; sin feed XML a portales | P2 (adaptar) |
| 38 | Formulario de solicitud del candidato con documentos y scoring de solvencia | ✔ | ✔ | parcial | `lib/agent/scoring.ts` puntúa intención del lead, no solvencia; sin formulario con documentos | P1 |
| 39 | Convertir lead en inquilino y contrato con un clic | ✔ | — | parcial | pipeline `crm_leads` y `lead_pipeline_stages`; sin conversión directa | P1 |
| 40 | Motor de reservas y sincronización de disponibilidad con Airbnb (media estancia) | ✔ | — | falta | — | P2 |
| 41 | Multimoneda por propiedad (PEN/USD) en reportes, sin convertir | — | ✔ | parcial | `payments.currency`, `listings.currency`; los reportes no separan moneda | P1 |
| 42 | Asistente por Telegram o WhatsApp del dueño para registrar gastos y pagos por voz o foto | — | ✔ | parcial | OCR de recibos (`/api/receipts/ocr`), asistente web; agente WhatsApp solo para leads | P1 |
| 43 | Servidor MCP o API pública para Claude/ChatGPT e integraciones | ✔ (API) | ✔ (MCP) | falta | — | P2 |
| 44 | Escáner de facturas con IA | ✔ | — | tiene | `src/lib/ocr/run-ocr.ts`, `/dashboard/finance/receipts` | — |
| 45 | Agente de IA e informes con IA | ✔ | ~ | tiene | `lib/agent`, `/executive-brief`, `/ai-analyst` | — |
| 46 | Portal del inquilino (contrato, pagos, incidencias, avisos) | ✔ | ✔ | tiene | `src/app/portal/*` | — |
| 47 | Integración contable — adaptar a Contasis, Siscont o exportación PLE | ✔ | — | falta | — | P2 (adaptar) |
| 48 | App móvil con marca propia | ✔ | — | falta | portal web responsive (PRD §7) | P2 |
| 49 | Calculadoras públicas (rentabilidad, reajuste, reparto) para SEO | ✔ | ✔ | falta | — | P2 |
| 50 | Importación desde otro software o Excel (inmuebles, inquilinos, propietarios) | ✔ | ✔ | parcial | CSV de inquilinos y pagos (`/dashboard/admin/import`) | P1 |
| 51 | Visitas agendadas con recordatorios | ~ | — | tiene | `/dashboard/visits`, `property_visits` | — |
| 52 | Recordatorio de pago por WhatsApp antes del vencimiento | ✔ | ✔ | tiene | `reminder-engine.ts` (3 días antes y el mismo día) | — |

Conteo (52 filas): **falta 20**, **parcial 27**, **tiene 5** (filas 44, 45, 46, 51 y 52).

---

## 5. Orden sugerido de implementación (rebanadas verticales)

Cada rebanada se puede desplegar sola, con su migración, server action, pantalla y tests.

1. **Rentas esperadas**: un cron mensual crea `charges` por contrato activo (monto, día de vencimiento); la pantalla de pagos muestra esperado, cobrado y pendiente.
2. **Morosidad**: estado vencido o al día por cargo, antigüedad de deuda (0–30/31–60/+60) por inquilino y aviso al primer atraso.
3. **Cargos adicionales editables**: CRUD de `charge_concepts` y `additional_charges` desde el panel (deja de ser solo lectura).
4. **Reparto de servicios**: registrar el recibo de luz, agua o internet por propiedad y repartirlo entre unidades activas (iguales, m², ocupantes o días) como cargos adicionales; respetar el tope existente.
5. **EECC generado**: estado de cuenta mensual (renta, adicionales y saldo anterior) en PDF, con envío por la plantilla de WhatsApp existente.
6. **Recibo de pago**: PDF automático al aprobar un pago, descargable en `/portal/payments`.
7. **Fianza**: libro de garantía por contrato (cobro, descuentos con motivo y devolución) y liquidación final al salir.
8. **Renovación con un clic**: crear contrato nuevo desde el que vence (nuevas fechas y renta) y marcar el anterior como `expired`.
9. **Reajuste de renta**: % pactado por contrato con alerta antes del aniversario, que aplica la nueva renta a los cargos futuros.
10. **Importar extracto bancario**: CSV o Excel de BCP, Interbank o BBVA; revisión fila por fila y cruce con cargos pendientes (monto, referencia, nombre).
11. **Comprobante SUNAT**: emitir boleta o factura vía PSE/OSE (por ejemplo Nubefact) desde un cargo cobrado, guardado en `tax_receipts`. Pedir confirmación antes de contratar un PSE, porque tiene costo.
12. **Exportación de informes**: P&L, morosidad y cobranza por propiedad y periodo a Excel y PDF.
13. **Propietarios**: vincular `owners` a propiedades con CRUD y comisión %; liquidación mensual en PDF (renta − gastos − comisión).
14. **Portal del propietario**: rol `owner` de solo lectura (sus propiedades, liquidaciones y PDF).
15. **Proveedores**: catálogo y asignación de una incidencia a un proveedor, con presupuesto y costo; aviso por WhatsApp; enlace con token para que suba evidencia (sin portal completo).
16. **Aviso de incidencia al inquilino**: notificación en cada cambio de estado o cierre; estadística de tiempo de resolución.
17. **Gestor documental**: tabla `documents` (entidad, categoría, vencimiento, visible para el inquilino) con alertas de vencimiento.
18. **Acta de entrega**: inventario por unidad que se inserta en una plantilla y se firma con el flujo `/sign` actual (entrada y salida).
19. **Roles granulares**: `admin`, `staff_finanzas`, `staff_operaciones` y `viewer`, aplicados en `lib/auth/guards.ts`.
20. **Solicitud del candidato**: formulario público con documentos y scoring de solvencia (ingreso/renta), con conversión lead → inquilino → contrato.
21. **Asistente del dueño por WhatsApp**: registrar gasto o pago por texto, voz o foto (reusa el OCR) con confirmación en dos pasos.
22. **Moneda en reportes**: separar PEN y USD en KPIs y P&L.
23. **Reporte de renta de primera categoría**: renta anual por propiedad y 5 % estimado para el Formulario 1683.
24. P2 después: cama como subunidad, etiquetas y grupos, buscador global, calendario operativo con iCal, feed a Urbania y Adondevivir, MCP o API, calculadoras públicas, exportación contable (PLE) y app con marca propia.

## PRs de implementación

Las filas 44, 45, 46, 51 y 52 ya existían en Propflow.

| Fila | PR |
|---|---|
| 1 | #121 |
| 2 | #122 |
| 3 | #126 |
| 4 | #125 |
| 5 | #124 |
| 6 | #123 |
| 7 | #135 |
| 8 | #180 |
| 9 | #181 |
| 10 | #127 |
| 11 | #129 |
| 12 | #128 |
| 13 | #144 |
| 14 | #145 |
| 15 | #146 |
| 16 | #176 |
| 17 | #150 |
| 18 | #139 |
| 19 | #137 |
| 20 | #170 |
| 21 | #169 |
| 22 | #167 |
| 23 | #152 |
| 24 | #166 |
| 25 | #147 |
| 26 | #171 |
| 27 | #138 |
| 28 | #140 |
| 29 | #172 |
| 30 | #136 |
| 31 | #168 |
| 32 | #173 |
| 33 | #174 |
| 34 | #175 |
| 35 | #159 |
| 36 | #142 |
| 37 | #177 |
| 38 | #143 |
| 39 | #141 |
| 40 | #178, #179 |
| 41 | #151 |
| 42 | #153 |
| 43 | #157, #182 |
| 47 | #155 |
| 48 | #156 |
| 49 | #154 |
| 50 | #149 |
