# Benchmark de competidores

- [homming-habitamax.md](homming-habitamax.md): Homming y Habitamax (alquiler, España), 52 funcionalidades comparadas.
- [vecinos360.md](vecinos360.md): Vecinos360 (administración de condominios, Perú), 17 brechas adicionales.

## Plan consolidado

Orden de entrega. Cada paso es una rebanada vertical con su migración D1, server action, pantalla y tests, en su propio PR.

1. Rentas esperadas: generar `charges` mensuales por contrato activo (cron `/api/cron/*`).
2. Morosidad: antigüedad de deuda 0–30 / 31–60 / +60 por inquilino y aviso al primer atraso.
3. Cargos adicionales y conceptos editables desde el panel.
4. Reparto de servicios entre unidades activas (iguales, m², ocupantes, días) respetando tope; cubre el "diseñador de cuotas" de Vecinos360.
5. Estado de cuenta mensual generado.
6. Recibo PDF al aprobar un pago.
7. Garantía: cobro, descuentos y devolución.
8. Renovación de contrato con un clic.
9. Reajuste de renta.
10. Cajas y bancos con movimientos, liquidación mensual y anual exportable (V1–V3).
11. Presupuesto por categoría, real vs presupuestado (V4).
12. Solicitudes con fecha estimada, vencida y responsable (V7).
13. Reservas de áreas comunes (V8).
14. Activos con plan de mantenimiento (V10).
15. Importar extracto bancario y conciliar.
16. Resto de P1 de `homming-habitamax.md` §5 (propietarios, proveedores, documentos, roles, exportación).

Pagos con costo (PSE SUNAT como Nubefact, pasarelas Culqi o Mercado Pago) requieren aprobación antes de contratar.
