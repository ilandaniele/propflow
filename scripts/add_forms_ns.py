import json, pathlib

root = pathlib.Path(__file__).parent.parent / "src" / "messages"

NEW = {
    "en": {
        "forms": {
            "createCharge": {
                "openButton": "Add Charge",
                "modalTitle": "New Charge",
                "selectContract": "Select contract",
                "periodLabel": "Period",
                "dueDateLabel": "Due Date",
                "cancel": "Cancel",
                "submit": "Create Charge",
                "creating": "Creating…",
                "perMonth": "/mo"
            },
            "approvePayment": {
                "pending": "…",
                "approve": "Approve"
            },
            "createContract": {
                "openButton": "New Contract",
                "modalTitle": "New Contract",
                "selectTenant": "Select tenant",
                "selectUnit": "Select unit",
                "startDate": "Start Date",
                "endDate": "End Date",
                "monthlyRent": "Monthly Rent ($)",
                "deposit": "Deposit ($)",
                "cancel": "Cancel",
                "submit": "Create"
            },
            "contractTemplate": {
                "saving": "Saving…",
                "submit": "Create Template",
                "nameLabel": "Template name",
                "namePlaceholder": "Standard Lease Agreement",
                "bodyLabel": "(Markdown, use {{variable_name}} for substitution)"
            },
            "updateIncident": {
                "submit": "Save Changes",
                "saved": "Saved",
                "statusLabel": "Status",
                "priorityLabel": "Priority",
                "assignLabel": "Assign to",
                "unassigned": "Unassigned",
                "statusPending": "Pending",
                "statusInProgress": "In Progress",
                "statusSolved": "Solved",
                "priorityLow": "Low",
                "priorityMedium": "Medium",
                "priorityHigh": "High",
                "priorityUrgent": "Urgent"
            },
            "comment": {
                "submit": "Post Comment",
                "placeholder": "Add a comment…"
            },
            "announcement": {
                "saving": "Saving…",
                "submit": "Save Draft",
                "titleLabel": "Title",
                "titlePlaceholder": "Building maintenance notice",
                "bodyLabel": "Body",
                "bodyPlaceholder": "There will be scheduled maintenance on…",
                "audienceLabel": "Audience",
                "audienceAll": "All tenants",
                "audienceProperty": "Specific property",
                "audienceUnit": "Specific unit"
            },
            "cleaningTask": {
                "saving": "Saving…",
                "submit": "Create Task",
                "titleLabel": "Task title",
                "titlePlaceholder": "Clean unit 1A",
                "dateLabel": "Scheduled date"
            },
            "createLead": {
                "saving": "Saving…",
                "submit": "Add Lead",
                "nameLabel": "Full name",
                "emailLabel": "Email",
                "phoneLabel": "Phone",
                "interestLabel": "Property interest",
                "sourceLabel": "Source",
                "namePlaceholder": "Jane Smith",
                "emailPlaceholder": "jane@example.com",
                "phonePlaceholder": "+1 555 000 0000",
                "interestPlaceholder": "2-bedroom apartment",
                "sourcePlaceholder": "Zillow, referral, walk-in…"
            },
            "createTenant": {
                "submit": "Create",
                "openButton": "Add Tenant",
                "modalTitle": "New Tenant",
                "nameLabel": "Full Name",
                "emailLabel": "Email",
                "phoneLabel": "Phone",
                "notesLabel": "Notes",
                "cancel": "Cancel"
            },
            "createUnit": {
                "submit": "Create",
                "openButton": "Add Unit",
                "modalTitle": "New Unit",
                "selectProperty": "Select property",
                "unitLabelField": "Unit Label",
                "floorLabel": "Floor",
                "bedroomsLabel": "Bedrooms",
                "defaultRentLabel": "Default Monthly Rent ($)",
                "bathroomLabel": "Bathroom",
                "privateBathroom": "🚿 Private",
                "sharedBathroom": "🚽 Shared",
                "noBathroom": "— No bathroom",
                "cancel": "Cancel"
            },
            "createVisitor": {
                "logging": "Logging…",
                "submit": "Log Visitor",
                "nameLabel": "Visitor name",
                "namePlaceholder": "John Doe",
                "dateLabel": "Visit date",
                "purposeLabel": "Purpose",
                "purposePlaceholder": "Delivery, guest, maintenance…"
            },
            "createExpenseCategory": {
                "saving": "Saving…",
                "submit": "Add Category",
                "nameLabel": "Category name",
                "namePlaceholder": "e.g. Maintenance",
                "colorLabel": "Color (optional)"
            },
            "pricingTable": {
                "saving": "Saving…",
                "submit": "Create Table",
                "tiersLabel": "Rent Tiers",
                "addTier": "+ Add tier",
                "labelPlaceholder": "Label",
                "bedsPlaceholder": "Beds",
                "minPlaceholder": "Min $",
                "maxPlaceholder": "Max $",
                "suggestedPlaceholder": "Suggested $"
            }
        },
        "community": {
            "pinned": "Pinned",
            "unpin": "Unpin",
            "pin": "Pin"
        },
        "ocrReceiptsClient": {
            "matchedSuccess": "Matched successfully",
            "ocrFailed": "OCR failed. Please try again.",
            "ocrTriggered": "OCR triggered — refresh in a moment to see results.",
            "amountLabel": "Amount:",
            "dateLabel": "Date:",
            "vendorLabel": "Vendor:",
            "confidenceLabel": "Confidence:",
            "selectPayment": "Select payment…",
            "confirmMatch": "Confirm Match",
            "cancel": "Cancel",
            "runOcr": "Run OCR",
            "matchToPayment": "Match to Payment"
        },
        "profileHeader": {
            "overdue": "Overdue",
            "balanceOk": "Balance OK",
            "balanceDue": "Balance Due",
            "noPortal": "No Portal",
            "portalActive": "Portal Active",
            "noUnit": "No unit assigned",
            "onTime": "On-time",
            "disputes": "Disputes",
            "response": "Response"
        },
        "quickActions": {
            "sendWhatsApp": "Send WhatsApp",
            "recordPayment": "Record Payment",
            "newTask": "New Task",
            "proposeSanction": "Propose Sanction"
        },
        "aiAssistant": {
            "title": "AI Property Insights",
            "subtitle": "Ask questions about your portfolio KPIs and metrics.",
            "placeholder": "Ask about occupancy, overdue payments, incidents…",
            "emptyPrompt": "Ask a question about your portfolio",
            "send": "Send",
            "loading": "…",
            "limitReached": "Daily message limit reached. Please try again tomorrow.",
            "failed": "Failed to get a response. Please try again.",
            "error": "An error occurred. Please try again.",
            "prompt1": "What is my current occupancy rate?",
            "prompt2": "How many tenants are overdue?",
            "prompt3": "What is the net income this month?",
            "prompt4": "How many open incidents are there?"
        }
    },
    "es": {
        "forms": {
            "createCharge": {
                "openButton": "Agregar Cargo",
                "modalTitle": "Nuevo Cargo",
                "selectContract": "Seleccionar contrato",
                "periodLabel": "Período",
                "dueDateLabel": "Fecha de vencimiento",
                "cancel": "Cancelar",
                "submit": "Crear Cargo",
                "creating": "Creando…",
                "perMonth": "/mes"
            },
            "approvePayment": {
                "pending": "…",
                "approve": "Aprobar"
            },
            "createContract": {
                "openButton": "Nuevo Contrato",
                "modalTitle": "Nuevo Contrato",
                "selectTenant": "Seleccionar inquilino",
                "selectUnit": "Seleccionar unidad",
                "startDate": "Fecha de inicio",
                "endDate": "Fecha de fin",
                "monthlyRent": "Renta mensual (S/)",
                "deposit": "Depósito (S/)",
                "cancel": "Cancelar",
                "submit": "Crear"
            },
            "contractTemplate": {
                "saving": "Guardando…",
                "submit": "Crear plantilla",
                "nameLabel": "Nombre de la plantilla",
                "namePlaceholder": "Contrato de arrendamiento estándar",
                "bodyLabel": "(Markdown, usa {{nombre_variable}} para sustitución)"
            },
            "updateIncident": {
                "submit": "Guardar cambios",
                "saved": "Guardado",
                "statusLabel": "Estado",
                "priorityLabel": "Prioridad",
                "assignLabel": "Asignar a",
                "unassigned": "Sin asignar",
                "statusPending": "Pendiente",
                "statusInProgress": "En progreso",
                "statusSolved": "Resuelto",
                "priorityLow": "Baja",
                "priorityMedium": "Media",
                "priorityHigh": "Alta",
                "priorityUrgent": "Urgente"
            },
            "comment": {
                "submit": "Publicar comentario",
                "placeholder": "Agregar un comentario…"
            },
            "announcement": {
                "saving": "Guardando…",
                "submit": "Guardar borrador",
                "titleLabel": "Título",
                "titlePlaceholder": "Aviso de mantenimiento del edificio",
                "bodyLabel": "Contenido",
                "bodyPlaceholder": "Habrá mantenimiento programado el…",
                "audienceLabel": "Audiencia",
                "audienceAll": "Todos los inquilinos",
                "audienceProperty": "Propiedad específica",
                "audienceUnit": "Unidad específica"
            },
            "cleaningTask": {
                "saving": "Guardando…",
                "submit": "Crear tarea",
                "titleLabel": "Título de la tarea",
                "titlePlaceholder": "Limpiar unidad 1A",
                "dateLabel": "Fecha programada"
            },
            "createLead": {
                "saving": "Guardando…",
                "submit": "Agregar prospecto",
                "nameLabel": "Nombre completo",
                "emailLabel": "Correo electrónico",
                "phoneLabel": "Teléfono",
                "interestLabel": "Propiedad de interés",
                "sourceLabel": "Fuente",
                "namePlaceholder": "Juan Pérez",
                "emailPlaceholder": "juan@ejemplo.com",
                "phonePlaceholder": "+51 999 000 000",
                "interestPlaceholder": "Apartamento de 2 dormitorios",
                "sourcePlaceholder": "Referido, cartel, walk-in…"
            },
            "createTenant": {
                "submit": "Crear",
                "openButton": "Agregar inquilino",
                "modalTitle": "Nuevo inquilino",
                "nameLabel": "Nombre completo",
                "emailLabel": "Correo electrónico",
                "phoneLabel": "Teléfono",
                "notesLabel": "Notas",
                "cancel": "Cancelar"
            },
            "createUnit": {
                "submit": "Crear",
                "openButton": "Agregar unidad",
                "modalTitle": "Nueva unidad",
                "selectProperty": "Seleccionar propiedad",
                "unitLabelField": "Etiqueta de unidad",
                "floorLabel": "Piso",
                "bedroomsLabel": "Dormitorios",
                "defaultRentLabel": "Renta mensual predeterminada (S/)",
                "bathroomLabel": "Baño",
                "privateBathroom": "🚿 Privado",
                "sharedBathroom": "🚽 Compartido",
                "noBathroom": "— Sin baño",
                "cancel": "Cancelar"
            },
            "createVisitor": {
                "logging": "Registrando…",
                "submit": "Registrar visita",
                "nameLabel": "Nombre del visitante",
                "namePlaceholder": "Juan Pérez",
                "dateLabel": "Fecha de visita",
                "purposeLabel": "Motivo",
                "purposePlaceholder": "Entrega, visita, mantenimiento…"
            },
            "createExpenseCategory": {
                "saving": "Guardando…",
                "submit": "Agregar categoría",
                "nameLabel": "Nombre de categoría",
                "namePlaceholder": "p.ej. Mantenimiento",
                "colorLabel": "Color (opcional)"
            },
            "pricingTable": {
                "saving": "Guardando…",
                "submit": "Crear tabla",
                "tiersLabel": "Niveles de renta",
                "addTier": "+ Agregar nivel",
                "labelPlaceholder": "Etiqueta",
                "bedsPlaceholder": "Dorm.",
                "minPlaceholder": "Mín S/",
                "maxPlaceholder": "Máx S/",
                "suggestedPlaceholder": "Sugerido S/"
            }
        },
        "community": {
            "pinned": "Fijado",
            "unpin": "Desfijar",
            "pin": "Fijar"
        },
        "ocrReceiptsClient": {
            "matchedSuccess": "Emparejado correctamente",
            "ocrFailed": "OCR falló. Por favor intenta de nuevo.",
            "ocrTriggered": "OCR iniciado — actualiza en un momento para ver los resultados.",
            "amountLabel": "Monto:",
            "dateLabel": "Fecha:",
            "vendorLabel": "Proveedor:",
            "confidenceLabel": "Confianza:",
            "selectPayment": "Seleccionar pago…",
            "confirmMatch": "Confirmar coincidencia",
            "cancel": "Cancelar",
            "runOcr": "Ejecutar OCR",
            "matchToPayment": "Emparejar con pago"
        },
        "profileHeader": {
            "overdue": "Vencido",
            "balanceOk": "Balance OK",
            "balanceDue": "Saldo pendiente",
            "noPortal": "Sin portal",
            "portalActive": "Portal activo",
            "noUnit": "Sin unidad asignada",
            "onTime": "Puntual",
            "disputes": "Disputas",
            "response": "Respuesta"
        },
        "quickActions": {
            "sendWhatsApp": "Enviar WhatsApp",
            "recordPayment": "Registrar pago",
            "newTask": "Nueva tarea",
            "proposeSanction": "Proponer sanción"
        },
        "aiAssistant": {
            "title": "Insights de IA",
            "subtitle": "Haz preguntas sobre los KPIs y métricas de tu portafolio.",
            "placeholder": "Pregunta sobre ocupación, pagos vencidos, incidencias…",
            "emptyPrompt": "Haz una pregunta sobre tu portafolio",
            "send": "Enviar",
            "loading": "…",
            "limitReached": "Límite diario de mensajes alcanzado. Intenta mañana.",
            "failed": "No se pudo obtener respuesta. Intenta de nuevo.",
            "error": "Ocurrió un error. Intenta de nuevo.",
            "prompt1": "¿Cuál es mi tasa de ocupación actual?",
            "prompt2": "¿Cuántos inquilinos están vencidos?",
            "prompt3": "¿Cuál es el ingreso neto este mes?",
            "prompt4": "¿Cuántas incidencias abiertas hay?"
        }
    },
    "pt": {
        "forms": {
            "createCharge": {
                "openButton": "Adicionar Cobrança",
                "modalTitle": "Nova Cobrança",
                "selectContract": "Selecionar contrato",
                "periodLabel": "Período",
                "dueDateLabel": "Data de vencimento",
                "cancel": "Cancelar",
                "submit": "Criar Cobrança",
                "creating": "Criando…",
                "perMonth": "/mês"
            },
            "approvePayment": {
                "pending": "…",
                "approve": "Aprovar"
            },
            "createContract": {
                "openButton": "Novo Contrato",
                "modalTitle": "Novo Contrato",
                "selectTenant": "Selecionar inquilino",
                "selectUnit": "Selecionar unidade",
                "startDate": "Data de início",
                "endDate": "Data de término",
                "monthlyRent": "Aluguel mensal (R$)",
                "deposit": "Depósito (R$)",
                "cancel": "Cancelar",
                "submit": "Criar"
            },
            "contractTemplate": {
                "saving": "Salvando…",
                "submit": "Criar modelo",
                "nameLabel": "Nome do modelo",
                "namePlaceholder": "Contrato de locação padrão",
                "bodyLabel": "(Markdown, use {{nome_variável}} para substituição)"
            },
            "updateIncident": {
                "submit": "Salvar alterações",
                "saved": "Salvo",
                "statusLabel": "Status",
                "priorityLabel": "Prioridade",
                "assignLabel": "Atribuir a",
                "unassigned": "Não atribuído",
                "statusPending": "Pendente",
                "statusInProgress": "Em andamento",
                "statusSolved": "Resolvido",
                "priorityLow": "Baixa",
                "priorityMedium": "Média",
                "priorityHigh": "Alta",
                "priorityUrgent": "Urgente"
            },
            "comment": {
                "submit": "Publicar comentário",
                "placeholder": "Adicionar um comentário…"
            },
            "announcement": {
                "saving": "Salvando…",
                "submit": "Salvar rascunho",
                "titleLabel": "Título",
                "titlePlaceholder": "Aviso de manutenção do edifício",
                "bodyLabel": "Conteúdo",
                "bodyPlaceholder": "Haverá manutenção programada em…",
                "audienceLabel": "Público",
                "audienceAll": "Todos os inquilinos",
                "audienceProperty": "Propriedade específica",
                "audienceUnit": "Unidade específica"
            },
            "cleaningTask": {
                "saving": "Salvando…",
                "submit": "Criar tarefa",
                "titleLabel": "Título da tarefa",
                "titlePlaceholder": "Limpar unidade 1A",
                "dateLabel": "Data agendada"
            },
            "createLead": {
                "saving": "Salvando…",
                "submit": "Adicionar lead",
                "nameLabel": "Nome completo",
                "emailLabel": "E-mail",
                "phoneLabel": "Telefone",
                "interestLabel": "Propriedade de interesse",
                "sourceLabel": "Fonte",
                "namePlaceholder": "João Silva",
                "emailPlaceholder": "joao@exemplo.com",
                "phonePlaceholder": "+55 11 99999-0000",
                "interestPlaceholder": "Apartamento de 2 quartos",
                "sourcePlaceholder": "Referência, anúncio, visita…"
            },
            "createTenant": {
                "submit": "Criar",
                "openButton": "Adicionar inquilino",
                "modalTitle": "Novo inquilino",
                "nameLabel": "Nome completo",
                "emailLabel": "E-mail",
                "phoneLabel": "Telefone",
                "notesLabel": "Notas",
                "cancel": "Cancelar"
            },
            "createUnit": {
                "submit": "Criar",
                "openButton": "Adicionar unidade",
                "modalTitle": "Nova unidade",
                "selectProperty": "Selecionar propriedade",
                "unitLabelField": "Rótulo da unidade",
                "floorLabel": "Andar",
                "bedroomsLabel": "Quartos",
                "defaultRentLabel": "Aluguel mensal padrão (R$)",
                "bathroomLabel": "Banheiro",
                "privateBathroom": "🚿 Privativo",
                "sharedBathroom": "🚽 Compartilhado",
                "noBathroom": "— Sem banheiro",
                "cancel": "Cancelar"
            },
            "createVisitor": {
                "logging": "Registrando…",
                "submit": "Registrar visita",
                "nameLabel": "Nome do visitante",
                "namePlaceholder": "João Silva",
                "dateLabel": "Data da visita",
                "purposeLabel": "Finalidade",
                "purposePlaceholder": "Entrega, visita, manutenção…"
            },
            "createExpenseCategory": {
                "saving": "Salvando…",
                "submit": "Adicionar categoria",
                "nameLabel": "Nome da categoria",
                "namePlaceholder": "ex.: Manutenção",
                "colorLabel": "Cor (opcional)"
            },
            "pricingTable": {
                "saving": "Salvando…",
                "submit": "Criar tabela",
                "tiersLabel": "Faixas de aluguel",
                "addTier": "+ Adicionar faixa",
                "labelPlaceholder": "Rótulo",
                "bedsPlaceholder": "Quartos",
                "minPlaceholder": "Mín R$",
                "maxPlaceholder": "Máx R$",
                "suggestedPlaceholder": "Sugerido R$"
            }
        },
        "community": {
            "pinned": "Fixado",
            "unpin": "Desafixar",
            "pin": "Fixar"
        },
        "ocrReceiptsClient": {
            "matchedSuccess": "Associado com sucesso",
            "ocrFailed": "OCR falhou. Tente novamente.",
            "ocrTriggered": "OCR iniciado — atualize em instantes para ver os resultados.",
            "amountLabel": "Valor:",
            "dateLabel": "Data:",
            "vendorLabel": "Fornecedor:",
            "confidenceLabel": "Confiança:",
            "selectPayment": "Selecionar pagamento…",
            "confirmMatch": "Confirmar associação",
            "cancel": "Cancelar",
            "runOcr": "Executar OCR",
            "matchToPayment": "Associar ao pagamento"
        },
        "profileHeader": {
            "overdue": "Vencido",
            "balanceOk": "Saldo OK",
            "balanceDue": "Saldo devedor",
            "noPortal": "Sem portal",
            "portalActive": "Portal ativo",
            "noUnit": "Sem unidade atribuída",
            "onTime": "Pontual",
            "disputes": "Disputas",
            "response": "Resposta"
        },
        "quickActions": {
            "sendWhatsApp": "Enviar WhatsApp",
            "recordPayment": "Registrar pagamento",
            "newTask": "Nova tarefa",
            "proposeSanction": "Propor sanção"
        },
        "aiAssistant": {
            "title": "Insights de IA",
            "subtitle": "Faça perguntas sobre os KPIs e métricas do seu portfólio.",
            "placeholder": "Pergunte sobre ocupação, pagamentos vencidos, incidentes…",
            "emptyPrompt": "Faça uma pergunta sobre o seu portfólio",
            "send": "Enviar",
            "loading": "…",
            "limitReached": "Limite diário de mensagens atingido. Tente amanhã.",
            "failed": "Não foi possível obter resposta. Tente novamente.",
            "error": "Ocorreu um erro. Tente novamente.",
            "prompt1": "Qual é minha taxa de ocupação atual?",
            "prompt2": "Quantos inquilinos estão inadimplentes?",
            "prompt3": "Qual é o rendimento líquido deste mês?",
            "prompt4": "Quantos incidentes abertos existem?"
        }
    }
}

for lang in ["en", "es", "pt"]:
    path = root / f"{lang}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    for key, value in NEW[lang].items():
        data[key] = value
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Updated {lang}.json — keys: {list(NEW[lang].keys())}")

print("Done.")
