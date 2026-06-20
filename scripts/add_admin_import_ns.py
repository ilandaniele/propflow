import json

ns = {
    'en': {
        'accountMapping': {
            'addTitle': 'Add account mapping',
            'addSubtitle': 'Link an external account code to an internal category.',
            'savedTitle': 'Saved mappings',
            'loadError': 'Error loading mappings.',
            'emptyState': 'No account mappings yet.',
            'colExternal': 'External code',
            'colInternal': 'Internal category',
            'colType': 'Type',
            'colAffectsNet': 'Affects net',
            'unassigned': 'Unassigned',
            'income': 'Income',
            'expense': 'Expense',
            'yes': 'Yes',
            'no': 'No'
        },
        'propertyMapping': {
            'addTitle': 'Add property mapping',
            'addSubtitle': 'Link an external name (as in the CSV) to an internal property.',
            'savedTitle': 'Saved mappings',
            'emptyState': 'No property mappings yet.',
            'colExternal': 'External name',
            'colInternal': 'Internal property',
            'colLastUsed': 'Last used',
            'unassigned': 'Unassigned'
        },
        'phantomRooms': {
            'banner': 'CSV labels that do not match any unit in the system. Map each label to an existing unit or ignore it if invalid.',
            'bannerBold': 'Phantom rooms',
            'loadError': 'Error loading data.',
            'pendingTitle': 'Unmapped',
            'pendingEmpty': 'No pending phantom rooms.',
            'colCsvLabel': 'CSV label',
            'colTargetUnit': 'Target unit',
            'colAction': 'Action',
            'resolvedTitle': 'Existing mappings',
            'colResolution': 'Resolution',
            'colUnit': 'Unit',
            'colDate': 'Date',
            'statusMapped': 'Mapped',
            'statusIgnored': 'Ignored'
        }
    },
    'es': {
        'accountMapping': {
            'addTitle': 'Agregar mapeo de cuenta',
            'addSubtitle': 'Vincula un codigo de cuenta externo con una categoria interna del plan de cuentas.',
            'savedTitle': 'Mapeos guardados',
            'loadError': 'Error al cargar mapeos.',
            'emptyState': 'No hay mapeos de cuentas aun.',
            'colExternal': 'Codigo externo',
            'colInternal': 'Categoria interna',
            'colType': 'Tipo',
            'colAffectsNet': 'Afecta neto',
            'unassigned': 'Sin asignar',
            'income': 'Ingreso',
            'expense': 'Gasto',
            'yes': 'Si',
            'no': 'No'
        },
        'propertyMapping': {
            'addTitle': 'Agregar mapeo de propiedad',
            'addSubtitle': 'Vincula un nombre externo (tal como aparece en el CSV) con una propiedad interna del sistema.',
            'savedTitle': 'Mapeos guardados',
            'emptyState': 'No hay mapeos de propiedades aun.',
            'colExternal': 'Nombre externo',
            'colInternal': 'Propiedad interna',
            'colLastUsed': 'Ultimo uso',
            'unassigned': 'No asignado'
        },
        'phantomRooms': {
            'banner': 'Etiquetas en CSV que no coinciden con ninguna unidad del sistema. Mapea cada etiqueta a una unidad existente o ignorala si es invalida.',
            'bannerBold': 'Cuartos fantasma',
            'loadError': 'Error al cargar datos.',
            'pendingTitle': 'Sin mapear',
            'pendingEmpty': 'No hay cuartos fantasma pendientes.',
            'colCsvLabel': 'Etiqueta en CSV',
            'colTargetUnit': 'Unidad destino',
            'colAction': 'Accion',
            'resolvedTitle': 'Mapeos existentes',
            'colResolution': 'Resolucion',
            'colUnit': 'Unidad',
            'colDate': 'Fecha',
            'statusMapped': 'Mapeado',
            'statusIgnored': 'Ignorado'
        }
    },
    'pt': {
        'accountMapping': {
            'addTitle': 'Adicionar mapeamento de conta',
            'addSubtitle': 'Vincule um codigo de conta externo a uma categoria interna do plano de contas.',
            'savedTitle': 'Mapeamentos guardados',
            'loadError': 'Erro ao carregar mapeamentos.',
            'emptyState': 'Nenhum mapeamento de conta ainda.',
            'colExternal': 'Codigo externo',
            'colInternal': 'Categoria interna',
            'colType': 'Tipo',
            'colAffectsNet': 'Afeta liquido',
            'unassigned': 'Nao atribuido',
            'income': 'Receita',
            'expense': 'Despesa',
            'yes': 'Sim',
            'no': 'Nao'
        },
        'propertyMapping': {
            'addTitle': 'Adicionar mapeamento de propriedade',
            'addSubtitle': 'Vincule um nome externo (como aparece no CSV) a uma propriedade interna do sistema.',
            'savedTitle': 'Mapeamentos guardados',
            'emptyState': 'Nenhum mapeamento de propriedade ainda.',
            'colExternal': 'Nome externo',
            'colInternal': 'Propriedade interna',
            'colLastUsed': 'Ultimo uso',
            'unassigned': 'Nao atribuido'
        },
        'phantomRooms': {
            'banner': 'Etiquetas CSV que nao correspondem a nenhuma unidade no sistema. Mapeie cada etiqueta para uma unidade existente ou ignore-a se for invalida.',
            'bannerBold': 'Quartos fantasma',
            'loadError': 'Erro ao carregar dados.',
            'pendingTitle': 'Nao mapeados',
            'pendingEmpty': 'Nenhum quarto fantasma pendente.',
            'colCsvLabel': 'Etiqueta CSV',
            'colTargetUnit': 'Unidade destino',
            'colAction': 'Acao',
            'resolvedTitle': 'Mapeamentos existentes',
            'colResolution': 'Resolucao',
            'colUnit': 'Unidade',
            'colDate': 'Data',
            'statusMapped': 'Mapeado',
            'statusIgnored': 'Ignorado'
        }
    }
}

for lang, values in ns.items():
    with open(f'src/messages/{lang}.json', encoding='utf-8') as f:
        d = json.load(f)
    d['adminImport'] = values
    with open(f'src/messages/{lang}.json', 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print(f'{lang}.json updated')
