# Puesta en marcha de WhatsApp (Meta)

Guía para conectar Propflow a WhatsApp Cloud API. La pantalla `/dashboard/agent/setup` muestra en vivo qué paso falta.

Costo: la API no cobra por tener la cuenta. Meta cobra por conversación iniciada con plantilla (las de categoría UTILITY son las más baratas; las respuestas dentro de las 24 h de un mensaje del cliente son gratis). Confirmá la tarifa vigente para Perú en la página de precios de Meta antes de activar envíos masivos.

## 1. Cuenta y app en Meta (lo hace el dueño)

1. Entrá a business.facebook.com con la cuenta del negocio y verificá el negocio si Meta lo pide.
2. En developers.facebook.com creá una app de tipo **Business** y agregale el producto **WhatsApp**.
3. En **WhatsApp → API Setup**, agregá el número de teléfono real del negocio (no puede estar usándose en la app de WhatsApp del celular) y verificalo por SMS o llamada.
4. Anotá dos datos de esa misma pantalla: **Phone number ID** y **WhatsApp Business Account ID (WABA)**.
5. En **App Settings → Basic**, anotá el **App Secret**.
6. En **business.facebook.com → Configuración → Usuarios del sistema**, creá un usuario del sistema con rol admin, asignale la app y el WABA, y generá un token **sin vencimiento** con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.

## 2. Secretos del Worker (lo hace el dueño, una vez)

Cada comando pide el valor. No los pegues en el chat ni en el repo.

```powershell
pnpm exec wrangler secret put WHATSAPP_ACCESS_TOKEN
pnpm exec wrangler secret put WHATSAPP_PHONE_NUMBER_ID
pnpm exec wrangler secret put WHATSAPP_BUSINESS_ACCOUNT_ID
pnpm exec wrangler secret put META_APP_SECRET
pnpm exec wrangler secret put WHATSAPP_WEBHOOK_VERIFY_TOKEN
```

`WHATSAPP_WEBHOOK_VERIFY_TOKEN` es un texto largo al azar que inventás vos; usá el mismo valor en el paso 4.

## 3. Vincular el número a la organización

En `/dashboard/agent/setup`, sección **Vincular número de WhatsApp**: Phone number ID y número en formato `+51…`. Guardar.

## 4. Webhook

En **WhatsApp → Configuration → Webhook** de la app de Meta:

- Callback URL: `https://propflow-app.ilandaniele.workers.dev/api/whatsapp/webhook`
- Verify token: el mismo de `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
- Suscribí el campo `messages`.

Escribile al número desde tu celular; el paso "Recepción de mensajes confirmada" pasa a ✔.

## 5. Plantillas

En `/dashboard/agent/setup`, sección **Plantillas de WhatsApp**, tocá **Enviar plantillas a Meta**. La app crea en tu WABA las que falten (nunca borra ni edita las existentes) y muestra el estado de revisión. Meta suele aprobar en minutos y como máximo en 24 h.

Las plantillas, con texto, categoría y ejemplos, están definidas en `src/lib/whatsapp/templates-catalog.ts`:

| Plantilla | Categoría | La usa |
|---|---|---|
| `recordatorio_visita_24h` | UTILITY | recordatorio de visita |
| `recordatorio_visita_2h` | UTILITY | recordatorio de visita |
| `feedback_post_visita` | UTILITY | seguimiento de visita |
| `seguimiento_lead` | MARKETING | seguimiento de leads |
| `reactivacion_lead` | MARKETING | seguimiento de leads |
| `propiedad_nueva` | MARKETING | alertas de propiedades nuevas |
| `confirmar_visita_voz` | UTILITY | confirmación de visita por voz (apagada) |
| `comunicado_inquilinos` | UTILITY | comunicados masivos |

Si una queda **REJECTED**, la columna de error muestra el motivo de Meta. Corregí el texto en el catálogo, cambiá el nombre (Meta no deja reusar un nombre rechazado por 30 días) y volvé a enviar.

## 6. Activar el agente

En **Configuración del agente**, activá el canal WhatsApp. Dejá el **modo sombra** encendido la primera semana: el agente sugiere respuestas sin enviarlas.
