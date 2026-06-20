#!/usr/bin/env python3
import json

FILES = {
    'en': 'src/messages/en.json',
    'es': 'src/messages/es.json',
    'pt': 'src/messages/pt.json',
}

ADDITIONS = {
    'en': {
        'importLogs.filterLabel':           'Status',
        'importLogs.filterAll':             'All',
        'importLogs.totalCount':            '{count} records',
        'importLogs.loadError':             'Failed to load import history.',
        'importLogs.empty':                 'No import records found.',
        'importLogs.colType':               'Type',
        'importLogs.colFile':               'File',
        'importLogs.colPeriod':             'Period',
        'importLogs.colStatus':             'Status',
        'importLogs.colRows':               'Rows',
        'importLogs.colErrors':             'Errors',
        'importLogs.colDate':               'Date',
        'importLogs.pagination':            'Page {page} of {total}',
        'importLogs.prev':                  'Previous',
        'importLogs.next':                  'Next',
        'importLogs.status.dryRun':         'Dry run',
        'importLogs.status.committed':      'Committed',
        'importLogs.status.failed':         'Failed',
        'importLogs.types.monthlyBilled':   'Monthly billed',
        'importLogs.types.monthlyCollected':'Monthly collected',
        'importLogs.types.monthlySummary':  'Monthly summary',
        'importLogs.types.roomPerformance': 'Room performance',
    },
    'es': {
        'importLogs.filterLabel':           'Estado',
        'importLogs.filterAll':             'Todos',
        'importLogs.totalCount':            '{count} registros',
        'importLogs.loadError':             'Error al cargar historial.',
        'importLogs.empty':                 'No hay registros de importación.',
        'importLogs.colType':               'Tipo',
        'importLogs.colFile':               'Archivo',
        'importLogs.colPeriod':             'Periodo',
        'importLogs.colStatus':             'Estado',
        'importLogs.colRows':               'Filas',
        'importLogs.colErrors':             'Errores',
        'importLogs.colDate':               'Fecha',
        'importLogs.pagination':            'Página {page} de {total}',
        'importLogs.prev':                  'Anterior',
        'importLogs.next':                  'Siguiente',
        'importLogs.status.dryRun':         'Simulación',
        'importLogs.status.committed':      'Confirmado',
        'importLogs.status.failed':         'Fallido',
        'importLogs.types.monthlyBilled':   'Facturación mensual',
        'importLogs.types.monthlyCollected':'Cobros mensuales',
        'importLogs.types.monthlySummary':  'Resumen mensual',
        'importLogs.types.roomPerformance': 'Rendimiento de habitaciones',
    },
    'pt': {
        'importLogs.filterLabel':           'Status',
        'importLogs.filterAll':             'Todos',
        'importLogs.totalCount':            '{count} registros',
        'importLogs.loadError':             'Falha ao carregar histórico.',
        'importLogs.empty':                 'Nenhum registro de importação.',
        'importLogs.colType':               'Tipo',
        'importLogs.colFile':               'Arquivo',
        'importLogs.colPeriod':             'Período',
        'importLogs.colStatus':             'Status',
        'importLogs.colRows':               'Linhas',
        'importLogs.colErrors':             'Erros',
        'importLogs.colDate':               'Data',
        'importLogs.pagination':            'Página {page} de {total}',
        'importLogs.prev':                  'Anterior',
        'importLogs.next':                  'Próximo',
        'importLogs.status.dryRun':         'Simulação',
        'importLogs.status.committed':      'Confirmado',
        'importLogs.status.failed':         'Falhou',
        'importLogs.types.monthlyBilled':   'Faturamento mensal',
        'importLogs.types.monthlyCollected':'Cobranças mensais',
        'importLogs.types.monthlySummary':  'Resumo mensal',
        'importLogs.types.roomPerformance': 'Desempenho de quartos',
    },
}

def set_nested(d, dotkey, value):
    keys = dotkey.split('.')
    for k in keys[:-1]:
        d = d.setdefault(k, {})
    d[keys[-1]] = value

for lang, path in FILES.items():
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    for dotkey, value in ADDITIONS[lang].items():
        set_nested(data, dotkey, value)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f'Updated {path}')

print('Done.')
