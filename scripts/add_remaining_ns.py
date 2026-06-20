import json, pathlib

root = pathlib.Path(__file__).parent.parent / "src" / "messages"

NEW = {
    "en": {
        "createProperty": {
            "openButton": "Add Property",
            "modalTitle": "New Property",
            "nameLabel": "Property Name",
            "namePlaceholder": "e.g. Oak Street Complex",
            "addressLabel": "Address",
            "addressPlaceholder": "123 Oak Street",
            "cityLabel": "City",
            "cityPlaceholder": "New York",
            "countryLabel": "Country",
            "countryPlaceholder": "US",
            "submit": "Create",
            "cancel": "Cancel"
        },
        "tasksTab": {
            "title": "Assigned Tasks",
            "newTask": "+ New Task",
            "empty": "No tasks assigned",
            "due": "Due:",
            "completed": "Completed:"
        }
    },
    "es": {
        "createProperty": {
            "openButton": "Agregar propiedad",
            "modalTitle": "Nueva propiedad",
            "nameLabel": "Nombre de la propiedad",
            "namePlaceholder": "p.ej. Complejo Calle Roble",
            "addressLabel": "Dirección",
            "addressPlaceholder": "Av. Roble 123",
            "cityLabel": "Ciudad",
            "cityPlaceholder": "Lima",
            "countryLabel": "País",
            "countryPlaceholder": "PE",
            "submit": "Crear",
            "cancel": "Cancelar"
        },
        "tasksTab": {
            "title": "Tareas asignadas",
            "newTask": "+ Nueva tarea",
            "empty": "Sin tareas asignadas",
            "due": "Vence:",
            "completed": "Completado:"
        }
    },
    "pt": {
        "createProperty": {
            "openButton": "Adicionar propriedade",
            "modalTitle": "Nova propriedade",
            "nameLabel": "Nome da propriedade",
            "namePlaceholder": "ex.: Complexo Rua Carvalho",
            "addressLabel": "Endereço",
            "addressPlaceholder": "Rua Carvalho, 123",
            "cityLabel": "Cidade",
            "cityPlaceholder": "São Paulo",
            "countryLabel": "País",
            "countryPlaceholder": "BR",
            "submit": "Criar",
            "cancel": "Cancelar"
        },
        "tasksTab": {
            "title": "Tarefas atribuídas",
            "newTask": "+ Nova tarefa",
            "empty": "Sem tarefas atribuídas",
            "due": "Vencimento:",
            "completed": "Concluído:"
        }
    }
}

for lang in ["en", "es", "pt"]:
    path = root / f"{lang}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    for key, value in NEW[lang].items():
        data[key] = value
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Updated {lang}.json")

print("Done.")
