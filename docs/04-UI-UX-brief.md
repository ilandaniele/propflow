# 04 — Brief de UI/UX (sistema de diseño implementado)

> Documenta el sistema de diseño tal como está hoy en `src/app/globals.css`, `src/app/layout.tsx`, `src/components/ui/*` y `src/components/shell/*`. No propone rediseños: las brechas encontradas se listan al final como "Mejoras sugeridas". Lo inferido está marcado como **Supuesto**. Pantallas y flujos: ver `03-app-flow.md`.

## 1. Principios observados

- **Panel denso y sobrio para el admin**: fondo `slate-50`, tarjetas blancas con borde `slate-200`, un único color de marca (índigo/azul) para acciones y estado activo.
- **Portal móvil primero para el inquilino**: columna angosta (`max-w-2xl`), navegación inferior fija en móvil, acceso a cámara para incidencias.
- **Server Components por defecto**: la UI se renderiza en el servidor y solo los formularios y controles interactivos son componentes cliente (`'use client'`).
- **Utilidades Tailwind sin librería de componentes externa**: no hay shadcn, Radix ni `clsx`; las clases se componen con `[...].join(' ')`.

## 2. Tokens

Tailwind CSS v4 con `@import "tailwindcss"` y un bloque `@theme` en `globals.css`. No existe `tailwind.config.*`: los tokens viven en CSS.

### 2.1 Color de marca (`--color-brand-*`, OKLCH, tono 264)

| Token | Valor | Uso principal |
|---|---|---|
| `brand-50` | `oklch(0.97 0.01 264)` | Fondo del ítem de navegación activo |
| `brand-100` | `oklch(0.93 0.03 264)` | Contador de pestaña activa, avatar |
| `brand-500` | `oklch(0.52 0.20 264)` | Anillo de foco de inputs; inicio del degradé del logo |
| `brand-600` | `oklch(0.44 0.22 264)` | Botón primario, logo, ícono activo, borde de pestaña activa |
| `brand-700` | `oklch(0.37 0.20 264)` | Hover del primario, texto activo, fin del degradé del logo |
| `brand-800` | `oklch(0.30 0.16 264)` | Estado `active` (presionado) del primario |

También existen `brand-200/300/400/900/950`, sin uso relevante detectado.

### 2.2 Colores semánticos

| Token | Texto/acento | Fondo (`-bg`) |
|---|---|---|
| `success` | `oklch(0.60 0.16 142)` | `oklch(0.96 0.03 142)` |
| `warning` | `oklch(0.65 0.17 58)` | `oklch(0.97 0.03 58)` |
| `danger` | `oklch(0.55 0.20 25)` | `oklch(0.96 0.03 25)` |
| `info` | `oklch(0.58 0.18 230)` | `oklch(0.96 0.03 230)` |

Los usa `Badge`. Los banners y errores de formulario, en cambio, usan la paleta por defecto de Tailwind (`red-50/200/600/700`, `amber-50/200/800`).

### 2.3 Neutros

Paleta `slate` de Tailwind: texto principal `slate-900` (el `body` fija `#0f172a`), secundario `slate-500/600`, bordes `slate-200`, fondos de app `slate-50`, scrollbar `#cbd5e1` / hover `#94a3b8`.

### 2.4 Radios y sombras

| Token | Valor | Uso |
|---|---|---|
| `--radius-sm` | 6 px | — |
| `--radius-md` | 10 px | — |
| `--radius-lg` | 16 px | — |
| `--radius-full` | 9999 px | Badges, avatares |

En la práctica los componentes usan las clases nativas de Tailwind: `rounded-md` (botones), `rounded-lg` (inputs, ítems de navegación, banners), `rounded-xl` (tarjetas) y `rounded-2xl` (tarjetas de login y onboarding). Sombra de `Card`: `0 1px 2px rgba(0,0,0,.05), 0 1px 3px rgba(0,0,0,.08)`; botones primario y secundario usan `shadow-sm`.

### 2.5 Espaciado y layout

- Escala por defecto de Tailwind.
- Admin: `flex h-screen` con barra lateral `w-60`, barra superior `h-16` y `main` con `p-6` y scroll propio.
- Portal: barra superior `h-14` (escritorio), `main` `max-w-2xl px-4 py-6 pb-20` (el `pb-20` deja lugar a la barra inferior móvil).
- Auth: tarjeta centrada `max-w-sm` (`max-w-lg` en onboarding de inquilino) con `p-7`.
- Breakpoints: `sm` (portal: alterna barra superior e inferior), `md` (admin: barra lateral fija).

## 3. Tipografía

- Fuentes cargadas con `next/font/google`: **Geist** y **Geist Mono**, expuestas como variables `--font-geist-sans` y `--font-geist-mono` en `<html>`.
- Tokens: `--font-sans: 'Geist', 'Inter', ui-sans-serif, system-ui, sans-serif` y `--font-mono: 'Geist Mono', ui-monospace, monospace`; el `body` usa `var(--font-sans)` con antialiasing.
- Jerarquía usada en el código:

| Rol | Clases |
|---|---|
| Título de pantalla de auth | `text-2xl font-bold text-slate-900` |
| Título de topbar | `text-base font-semibold` |
| Título de tarjeta (`CardTitle`, `h3`) | `text-base font-semibold text-slate-900` |
| Cuerpo y controles | `text-sm` |
| Etiquetas de sección de navegación | `text-xs font-semibold uppercase tracking-wider text-slate-400` |
| Ayudas, errores de campo, badges | `text-xs` |

## 4. Componentes base (`src/components/ui`)

| Componente | API | Notas de comportamiento |
|---|---|---|
| `Button` | `variant: primary \| secondary \| ghost \| danger`; `size: sm (h-8) \| md (h-9) \| lg (h-11)`; `loading`; `icon` | Con `loading` muestra spinner y queda deshabilitado; foco con `ring-2` y offset; `disabled:opacity-50`. |
| `Input`, `Textarea`, `Select` | `label`, `error`, `hint`, `required` | `label` asociado por `id` (derivado del texto si no se pasa); `aria-invalid` y `aria-describedby`; error con `role="alert"`; asterisco rojo si es requerido. |
| `Card`, `CardHeader`, `CardTitle` | `padding: none \| sm \| md \| lg` | Contenedor estándar de contenido. |
| `Badge`, `StatusPill`, `PriorityPill` | `variant: default \| success \| warning \| danger \| info \| pending \| active` | Píldora `rounded-full` con borde al 20 %. `StatusPill` mapea `active`, `expired`, `terminated`, `pending`, `approved`, `in_progress`, `solved`, `vacant`, `occupied`; `PriorityPill` mapea `low`, `medium`, `high`, `urgent`. Las etiquetas están en inglés fijo. |
| `Tabs` | `tabs[{id,label,badge?,content}]`, `defaultTab` | Patrón ARIA de pestañas con flechas izquierda/derecha y `tabIndex` móvil; solo monta el panel activo; contador `99+`. |
| `TabFallback` | — | Skeleton para `<Suspense>` dentro de pestañas, con `role="status"`. |
| `Skeleton` y variantes | `SkeletonText`, `SkeletonCard`, `SkeletonLine`, `SkeletonTable`, `SkeletonCardGrid`, `SkeletonStats`, `SkeletonDetailCard` | `animate-pulse bg-slate-200`; las variantes compuestas llevan `role="status"` y `aria-busy`. |
| `EmptyState` | `icon`, `title`, `description`, `action{label, href \| onClick}` | Centrado con ícono en círculo `slate-100`. |
| `ClickableRow` | `href` | `<tr>` navegable con clic, Enter o Espacio; ignora clics en `a`/`button` internos; foco con anillo `inset`. |
| `Avatar` | `name`, `src`, `size: sm \| md \| lg` | Foto firmada de Tigris o iniciales con color derivado del nombre. |
| `GoogleSignInButton` | `redirectTo`, `intendedDestination` | Botón `h-11` secundario; guarda `auth_redirect_to` por 600 s; spinner mientras redirige. |

Componentes de shell (`src/components/shell`): `AdminSidebar` (secciones Núcleo, Finanzas, Operaciones, Inteligencia, Comunidad, Agente, Admin, con íconos SVG inline estilo Lucide de 18 px), `AdminTopbar` (idioma, avatar, cerrar sesión), `TenantNav` (barra superior y barra inferior móvil, íconos de 20 px), `AdminShellClient` (envoltorio con cajón móvil; hoy no se usa).

## 5. Patrones de estado

| Estado | Implementación |
|---|---|
| Cargando ruta | `loading.tsx` en 29 rutas de `/dashboard` con las variantes de `Skeleton`. El portal no tiene `loading.tsx`. |
| Cargando acción | `useFormStatus` / `useActionState` + `Button loading`; textos como "Ingresando...". |
| Cargando en cliente | Spinner circular `border-4 border-brand-600 border-t-transparent animate-spin` (por ejemplo en `/invite/accept`). |
| Vacío | `EmptyState` con acción opcional. |
| Error de formulario | Caja `role="alert"` `bg-red-50 border-red-200 text-red-700`; error de campo bajo el input. |
| Aviso | Banner `bg-amber-50 border-amber-200 text-amber-800` (errores OAuth en `/login`). |
| Éxito | Revalidación con `revalidatePath` y re-render; no hay sistema de toasts. |
| Deshabilitado | `opacity-50` + `cursor-not-allowed`. |
| Activo en navegación | `bg-brand-50 text-brand-700` + `aria-current="page"`. |
| No encontrado | Solo `/p/[orgSlug]/not-found.tsx`; el resto usa la página por defecto. |

## 6. Movimiento

- Transiciones cortas de color: `transition-colors duration-100` (navegación, pestañas) y `duration-150` (botones, inputs).
- Cajón lateral móvil: `transition-transform duration-200 ease-in-out`.
- Animaciones: `animate-spin` (spinners) y `animate-pulse` (skeletons).
- `scroll-behavior: smooth` global.
- `prefers-reduced-motion: reduce` reduce animaciones y transiciones a 0,01 ms y desactiva el scroll suave.

## 7. Accesibilidad

- Foco visible global: `:focus-visible` con contorno de 2 px `brand-500` y offset de 2 px; los componentes agregan `ring-2`.
- Formularios: etiquetas asociadas, `aria-invalid`, `aria-describedby`, `role="alert"` en errores, `autoComplete` correcto en login.
- Navegación: `<nav aria-label>`, listas con `role="list"`, `aria-current="page"`; íconos decorativos con `aria-hidden="true"`; botones de solo ícono con `aria-label`.
- Pestañas con patrón ARIA completo; filas de tabla operables por teclado.
- `lang` de `<html>` según la cookie de idioma; `main` con `id="main-content"`.
- Skeletons con `role="status"` y `aria-busy`.
- Permisos del navegador restringidos (cámara solo en `/portal`).

## 8. Contenido e idioma

- `next-intl` con `es` (por defecto), `en` y `pt`; selector `LanguageDropdown` en ambas barras superiores; preferencia persistida en cookie y en perfil (`updateMyPreferredLanguage`).
- Tono: español neutro con tuteo en auth ("Ingresa a tu cuenta") y voseo en el landing ("Centralizá…"). **Supuesto:** el voseo del landing es intencional para el mercado objetivo.
- Moneda en soles (S/) en KPIs financieros.

## 9. Mejoras sugeridas

1. **Fuente efectiva**: `--font-sans` referencia el nombre literal `'Geist'`, pero `next/font` registra la familia con un nombre generado y la expone en `--font-geist-sans`, que no se usa. **Supuesto:** el texto se muestra con Inter o la fuente del sistema. Usar `--font-sans: var(--font-geist-sans), …`.
2. **Navegación móvil del admin**: `dashboard/layout.tsx` no conecta `open`, `onClose` ni `onMenuClick`; usar `AdminShellClient` o equivalente. El botón hamburguesa apunta a `aria-controls="main-nav"`, pero ningún elemento tiene ese `id`.
3. **Textos sin traducir**: `TenantNav` ("Overview", "Payments", "Sign out"), `AdminTopbar` ("Sign out", "Open navigation"), `StatusPill`, `PriorityPill`, `aria-label` de skeletons y el `aria-label="Tenant detail tabs"` fijo en `Tabs` están en inglés. Pasarlos a `next-intl` y hacer el `aria-label` de `Tabs` configurable.
4. **Tokens sin uso**: `--radius-*` y los colores semánticos no se usan en banners ni errores. Unificar banners en un componente `Alert` sobre `danger`/`warning`/`info`.
5. **Interactivo anidado**: `EmptyState` envuelve un `<button>` dentro de un `<a>`; usar `Link` con estilos de botón.
6. **Límites de error**: no hay `error.tsx` ni `global-error.tsx`. Agregar uno por área (`dashboard`, `portal`) con reintento y mensaje genérico.
7. **Carga del portal**: agregar `loading.tsx` en las rutas de `/portal`, sobre todo en `payments`, que trae datos en el cliente.
8. **Skip link**: existe `id="main-content"`, pero ningún enlace "Saltar al contenido". Agregarlo en ambos layouts.
9. **Avatar con error de imagen**: al fallar la carga se oculta la imagen sin mostrar iniciales; renderizar el fallback de iniciales.
10. **Feedback de éxito**: no hay toasts ni mensajes de confirmación tras las mutaciones; agregar una región `aria-live="polite"` compartida.
11. **Consistencia de tono**: definir tuteo o voseo en una guía de contenido y aplicarlo en todos los textos.
12. **Portal en móvil**: la barra inferior muestra 4 de 8 secciones (más la campana); Avisos, Comunidad, Tareas y Sanciones no son alcanzables desde la navegación móvil. Agregar un ítem "Más".
