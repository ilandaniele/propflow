#!/usr/bin/env python3
"""Add translation keys for remaining analytics enhancements."""
import json

FILES = {
    'en': 'src/messages/en.json',
    'es': 'src/messages/es.json',
    'pt': 'src/messages/pt.json',
}

ADDITIONS = {
    'en': {
        'tenants.kpi.tenure':    'Tenant Tenure',
        'tenants.kpi.lt3m':      '< 3 months',
        'tenants.kpi.bt3_12m':   '3–12 months',
        'tenants.kpi.bt1_2y':    '1–2 years',
        'tenants.kpi.gt2y':      '2+ years',
        'contracts.kpi.rentDistribution': 'Rent Distribution',
        'contracts.kpi.newContracts':     'New Contracts',
        'payments.kpi.monthlyTrend':      'Monthly Collected',
        'incidents.kpi.costTrend':        'Cost Trend (6 months)',
        'utilities.overLimitAlert':        '{count} service(s) over limit — S/ {variance} total excess',
        'utilities.overBy':               'over by',
    },
    'es': {
        'tenants.kpi.tenure':    'Antigüedad de Inquilinos',
        'tenants.kpi.lt3m':      '< 3 meses',
        'tenants.kpi.bt3_12m':   '3–12 meses',
        'tenants.kpi.bt1_2y':    '1–2 años',
        'tenants.kpi.gt2y':      '2+ años',
        'contracts.kpi.rentDistribution': 'Distribución de Renta',
        'contracts.kpi.newContracts':     'Nuevos Contratos',
        'payments.kpi.monthlyTrend':      'Cobros Mensuales',
        'incidents.kpi.costTrend':        'Tendencia de Costos (6 meses)',
        'utilities.overLimitAlert':        '{count} servicio(s) sobre el tope — S/ {variance} de exceso total',
        'utilities.overBy':               'excede en',
    },
    'pt': {
        'tenants.kpi.tenure':    'Tempo de Locação',
        'tenants.kpi.lt3m':      '< 3 meses',
        'tenants.kpi.bt3_12m':   '3–12 meses',
        'tenants.kpi.bt1_2y':    '1–2 anos',
        'tenants.kpi.gt2y':      '2+ anos',
        'contracts.kpi.rentDistribution': 'Distribuição de Aluguel',
        'contracts.kpi.newContracts':     'Novos Contratos',
        'payments.kpi.monthlyTrend':      'Cobranças Mensais',
        'incidents.kpi.costTrend':        'Tendência de Custos (6 meses)',
        'utilities.overLimitAlert':        '{count} serviço(s) acima do limite — S/ {variance} de excesso total',
        'utilities.overBy':               'excede em',
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
