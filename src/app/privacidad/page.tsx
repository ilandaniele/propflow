import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Política de privacidad',
  description: 'Cómo PropFlow recolecta, usa y protege los datos de propietarios, inquilinos y prospectos.',
  robots: { index: true, follow: true },
};

// Public legal page — required for Meta's WhatsApp app review and Google OAuth
// verification. Kept as a plain server component, no client interactivity.
export const dynamic = 'force-static';

export default function PrivacyPolicyPage() {
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
        <h1 className="text-2xl font-bold text-slate-900">Política de privacidad</h1>
        <p className="text-sm text-slate-500">Última actualización: 27 de septiembre de 2026</p>

        <p>
          PropFlow es una plataforma de gestión de propiedades e inquilinos que incluye un
          asistente de inteligencia artificial disponible por WhatsApp y por el sitio web, para
          responder consultas, calificar prospectos y coordinar visitas a propiedades en alquiler
          o venta. Esta política explica qué datos personales recolectamos, para qué los usamos,
          con quién los compartimos y qué derechos tenés sobre ellos.
        </p>

        <h2 className="text-lg font-semibold text-slate-900 mt-8">1. Datos que recolectamos</h2>
        <ul>
          <li>Nombre y datos de contacto (teléfono, email).</li>
          <li>El contenido de las conversaciones que mantenés con nuestro asistente por WhatsApp o por el widget del sitio web.</li>
          <li>Preferencias sobre la propiedad que buscás (zona, presupuesto, tipo de operación, dormitorios).</li>
          <li>Reservas y confirmaciones de visitas a propiedades.</li>
          <li>Si sos inquilino de una propiedad gestionada con PropFlow: datos del contrato, pagos, incidentes y comunicaciones asociadas a tu unidad.</li>
        </ul>

        <h2 className="text-lg font-semibold text-slate-900 mt-8">2. Para qué usamos estos datos</h2>
        <ul>
          <li>Responder tus consultas y coordinar visitas a través del asistente de IA.</li>
          <li>Gestionar contratos, pagos e incidentes si sos inquilino de una propiedad administrada con PropFlow.</li>
          <li>Enviar recordatorios de visitas, pagos y otras notificaciones operativas por WhatsApp o email.</li>
          <li>Mejorar la calidad de las respuestas del asistente.</li>
        </ul>

        <h2 className="text-lg font-semibold text-slate-900 mt-8">3. Con quién compartimos tus datos</h2>
        <p>No vendemos tus datos. Los compartimos únicamente con los proveedores que operan la plataforma:</p>
        <ul>
          <li><strong>Meta / WhatsApp Business Platform</strong> — para enviar y recibir mensajes de WhatsApp.</li>
          <li><strong>Anthropic</strong> — provee el modelo de lenguaje que redacta las respuestas del asistente.</li>
          <li><strong>Google Calendar</strong> — para coordinar la disponibilidad y el registro de las visitas de los asesores que conectan su calendario.</li>
          <li><strong>Fly.io</strong> — aloja la aplicación y la base de datos.</li>
          <li><strong>Tigris</strong> — almacena archivos adjuntos (fotos, comprobantes) de forma segura.</li>
          <li><strong>Resend</strong> — envía notificaciones por email.</li>
        </ul>

        <h2 className="text-lg font-semibold text-slate-900 mt-8">4. Retención</h2>
        <p>
          Conservamos tus datos mientras exista una relación activa (conversación en curso, contrato
          vigente) y, luego, durante el plazo necesario para cumplir obligaciones legales o
          contables. Podés solicitar la eliminación de tus datos según se describe en la sección 5.
        </p>

        <h2 className="text-lg font-semibold text-slate-900 mt-8">5. Tus derechos (Ley N.º 29733, Perú)</h2>
        <p>
          Como titular de datos personales, tenés derecho a acceder, rectificar, cancelar y oponerte
          al tratamiento de tus datos, así como a revocar tu consentimiento en cualquier momento.
          Para ejercer estos derechos, escribinos a{' '}
          <a href="mailto:ilan.daniele@gmail.com" className="text-brand-600 hover:underline">ilan.daniele@gmail.com</a>.
        </p>

        <h2 className="text-lg font-semibold text-slate-900 mt-8">6. Contacto</h2>
        <p>
          Ante cualquier consulta sobre esta política, escribinos a{' '}
          <a href="mailto:ilan.daniele@gmail.com" className="text-brand-600 hover:underline">ilan.daniele@gmail.com</a>.
        </p>
      </main>
    </div>
  );
}
