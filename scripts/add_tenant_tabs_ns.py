import json

ns = {
    'en': {
        'activityTab': {
            'title': 'Activity Timeline',
            'emptyState': 'No recent activity'
        },
        'contractsTab': {
            'title': 'Contracts',
            'emptyState': 'No contracts',
            'perMonth': '/mo',
            'downloadPdf': 'Download PDF'
        },
        'documentsTab': {
            'contractPdfsTitle': 'Contract PDFs',
            'noContracts': 'No contracts',
            'contractsAvailable': '{count} contract(s) available. See the Contracts tab for download links.',
            'signatureRequestsTitle': 'Signature Requests',
            'noSignatureRequests': 'No signature requests',
            'sentLabel': 'Sent:'
        },
        'incidentsTab': {
            'title': 'Incidents',
            'emptyState': 'No incidents'
        },
        'sanctionsTab': {
            'title': 'Sanctions',
            'emptyState': 'No sanctions'
        },
        'whatsappTab': {
            'title': 'WhatsApp',
            'noConversation': 'No WhatsApp conversation for this tenant yet.',
            'addPhoneHint': 'Add a WhatsApp phone number to the tenant profile to start receiving messages.',
            'conversationWith': 'Conversation with',
            'openFullConversation': 'Open full conversation',
            'noMessages': 'No messages yet',
            'attachment': '(attachment)'
        },
        'notesTab': {
            'addTitle': 'Add Internal Note',
            'notesTitle': 'Internal Notes',
            'placeholder': 'Write an internal note about this tenant...',
            'adding': 'Adding...',
            'addNote': 'Add Note',
            'emptyState': 'No internal notes yet'
        },
        'overviewTab': {
            'financialTitle': 'Financial Summary',
            'totalCharged': 'Total Charged',
            'totalPaid': 'Total Paid',
            'balance': 'Balance',
            'noFinancialData': 'No financial data yet',
            'contractTitle': 'Active Contract',
            'monthlyRent': 'Monthly rent',
            'perMonth': '/mo',
            'period': 'Period',
            'status': 'Status',
            'noActiveContract': 'No active contract',
            'activeIncidents': 'Active Incidents',
            'pendingTasks': 'Pending Tasks',
            'lastWhatsApp': 'Last WhatsApp Message',
            'attachment': '(attachment)'
        }
    },
    'es': {
        'activityTab': {
            'title': 'Linea de tiempo',
            'emptyState': 'Sin actividad reciente'
        },
        'contractsTab': {
            'title': 'Contratos',
            'emptyState': 'Sin contratos',
            'perMonth': '/mes',
            'downloadPdf': 'Descargar PDF'
        },
        'documentsTab': {
            'contractPdfsTitle': 'PDFs de contratos',
            'noContracts': 'Sin contratos',
            'contractsAvailable': '{count} contrato(s) disponible(s). Ver pestana Contratos para los enlaces.',
            'signatureRequestsTitle': 'Solicitudes de firma',
            'noSignatureRequests': 'Sin solicitudes de firma',
            'sentLabel': 'Enviado:'
        },
        'incidentsTab': {
            'title': 'Incidentes',
            'emptyState': 'Sin incidentes'
        },
        'sanctionsTab': {
            'title': 'Sanciones',
            'emptyState': 'Sin sanciones'
        },
        'whatsappTab': {
            'title': 'WhatsApp',
            'noConversation': 'No hay conversacion de WhatsApp para este inquilino aun.',
            'addPhoneHint': 'Agrega un numero de WhatsApp al perfil del inquilino para recibir mensajes.',
            'conversationWith': 'Conversacion con',
            'openFullConversation': 'Ver conversacion completa',
            'noMessages': 'Sin mensajes aun',
            'attachment': '(adjunto)'
        },
        'notesTab': {
            'addTitle': 'Agregar nota interna',
            'notesTitle': 'Notas internas',
            'placeholder': 'Escribe una nota interna sobre este inquilino...',
            'adding': 'Agregando...',
            'addNote': 'Agregar nota',
            'emptyState': 'Sin notas internas aun'
        },
        'overviewTab': {
            'financialTitle': 'Resumen financiero',
            'totalCharged': 'Total cobrado',
            'totalPaid': 'Total pagado',
            'balance': 'Saldo',
            'noFinancialData': 'Sin datos financieros aun',
            'contractTitle': 'Contrato activo',
            'monthlyRent': 'Renta mensual',
            'perMonth': '/mes',
            'period': 'Periodo',
            'status': 'Estado',
            'noActiveContract': 'Sin contrato activo',
            'activeIncidents': 'Incidentes activos',
            'pendingTasks': 'Tareas pendientes',
            'lastWhatsApp': 'Ultimo mensaje de WhatsApp',
            'attachment': '(adjunto)'
        }
    },
    'pt': {
        'activityTab': {
            'title': 'Linha do tempo',
            'emptyState': 'Sem atividade recente'
        },
        'contractsTab': {
            'title': 'Contratos',
            'emptyState': 'Sem contratos',
            'perMonth': '/mes',
            'downloadPdf': 'Baixar PDF'
        },
        'documentsTab': {
            'contractPdfsTitle': 'PDFs de contratos',
            'noContracts': 'Sem contratos',
            'contractsAvailable': '{count} contrato(s) disponivel(is). Ver aba Contratos para os links.',
            'signatureRequestsTitle': 'Pedidos de assinatura',
            'noSignatureRequests': 'Sem pedidos de assinatura',
            'sentLabel': 'Enviado:'
        },
        'incidentsTab': {
            'title': 'Incidentes',
            'emptyState': 'Sem incidentes'
        },
        'sanctionsTab': {
            'title': 'Sancoes',
            'emptyState': 'Sem sancoes'
        },
        'whatsappTab': {
            'title': 'WhatsApp',
            'noConversation': 'Sem conversa WhatsApp para este inquilino ainda.',
            'addPhoneHint': 'Adicione um numero de WhatsApp ao perfil do inquilino para receber mensagens.',
            'conversationWith': 'Conversa com',
            'openFullConversation': 'Abrir conversa completa',
            'noMessages': 'Sem mensagens ainda',
            'attachment': '(anexo)'
        },
        'notesTab': {
            'addTitle': 'Adicionar nota interna',
            'notesTitle': 'Notas internas',
            'placeholder': 'Escreva uma nota interna sobre este inquilino...',
            'adding': 'Adicionando...',
            'addNote': 'Adicionar nota',
            'emptyState': 'Sem notas internas ainda'
        },
        'overviewTab': {
            'financialTitle': 'Resumo financeiro',
            'totalCharged': 'Total cobrado',
            'totalPaid': 'Total pago',
            'balance': 'Saldo',
            'noFinancialData': 'Sem dados financeiros ainda',
            'contractTitle': 'Contrato ativo',
            'monthlyRent': 'Renda mensal',
            'perMonth': '/mes',
            'period': 'Periodo',
            'status': 'Estado',
            'noActiveContract': 'Sem contrato ativo',
            'activeIncidents': 'Incidentes ativos',
            'pendingTasks': 'Tarefas pendentes',
            'lastWhatsApp': 'Ultima mensagem WhatsApp',
            'attachment': '(anexo)'
        }
    }
}

for lang, values in ns.items():
    with open(f'src/messages/{lang}.json', encoding='utf-8') as f:
        d = json.load(f)
    d['tenantTabs'] = values
    with open(f'src/messages/{lang}.json', 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print(f'{lang}.json updated')
