export default function PublicCatalogNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-slate-900">Página no encontrada</h1>
        <p className="text-sm text-slate-500">Este catálogo o propiedad no existe o ya no está disponible.</p>
      </div>
    </div>
  );
}
