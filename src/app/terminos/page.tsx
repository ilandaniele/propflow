import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Términos y condiciones',
  description: 'Términos de uso de PropFlow, su asistente de inteligencia artificial y el portal de inquilinos.',
  robots: { index: true, follow: true },
};

// Public legal page — required for Meta's WhatsApp app review and Google OAuth
// verification. Kept as a plain server component, no client interactivity.
export const dynamic = 'force-static';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white" lang="es">
      <header className="border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center">
          <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm">
              <span className="text-white text-sm font-bold">P</span>
            </div>
            <span className="text-lg">PropFlow</span>
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 space-y-4 text-slate-700 leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_li]:my-0 [&_a]:font-medium">
        <h1 className="text-2xl font-bold text-slate-900">Términos y condiciones</h1>
        <p className="text-sm text-slate-500">Última actualización: 27 de septiembre de 2026</p>

        <p>
          PropFlow es una plataforma de gestión de propiedades compartidas que incluye un asistente
          de inteligencia artificial disponible por WhatsApp y por el sitio web. Al escribirle al
          asistente, reservar una visita o usar el portal de inquilinos, aceptás estos términos.
        </p>

        <h2 className="text-lg font-semibold text-slate-900 mt-8">1. Qué es el servicio</h2>
        <p>
          PropFlow centraliza contratos, pagos, incidentes y comunicaciones entre administradores de
          propiedades e inquilinos, y ofrece un asistente conversacional que responde consultas sobre
          propiedades en alquiler o venta, coordina visitas y deriva a un asesor humano cuando hace falta.
        </p>

        <h2 className="text-lg font-semibold text-slate-900 mt-8">2. El asistente de IA</h2>
        <ul>
          <li>Las respuestas del asistente se generan automáticamente y pueden contener errores; la información sobre precios, disponibilidad y condiciones debe confirmarse siempre con un asesor humano antes de firmar cualquier contrato.</li>
          <li>El asistente puede derivar la conversación a una persona en cualquier momento, a tu pedido o por decisión propia del administrador de la propiedad.</li>
          <li>Las visitas reservadas a través del asistente están sujetas a confirmación y disponibilidad real del asesor.</li>
        </ul>

        <h2 className="text-lg font-semibold text-slate-900 mt-8">3. Uso aceptable</h2>
        <p>
          No está permitido usar el asistente ni el portal para enviar contenido ilegal, fraudulento,
          difamatorio o que infrinja derechos de terceros, ni para intentar vulnerar la seguridad de
          la plataforma.
        </p>

        <h2 className="text-lg font-semibold text-slate-900 mt-8">4. Datos personales</h2>
        <p>
          El tratamiento de tus datos personales se describe en nuestra{' '}
          <Link href="/privacidad" className="text-brand-600 hover:underline">política de privacidad</Link>.
        </p>

        <h2 className="text-lg font-semibold text-slate-900 mt-8">5. Limitación de responsabilidad</h2>
        <p>
          PropFlow se ofrece &quot;tal cual&quot;. No garantizamos que el servicio esté libre de
          interrupciones o errores, y no somos responsables por decisiones tomadas exclusivamente
          en base a una respuesta automática del asistente sin confirmación de un asesor humano.
        </p>

        <h2 className="text-lg font-semibold text-slate-900 mt-8">6. Cambios a estos términos</h2>
        <p>
          Podemos actualizar estos términos ocasionalmente. La fecha de la última actualización
          figura al inicio de esta página.
        </p>

        <h2 className="text-lg font-semibold text-slate-900 mt-8">7. Contacto</h2>
        <p>
          Ante cualquier consulta sobre estos términos, escribinos a{' '}
          <a href="mailto:ilan.daniele@gmail.com" className="text-brand-600 hover:underline">ilan.daniele@gmail.com</a>.
        </p>
      </main>
    </div>
  );
}
