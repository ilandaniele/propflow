import json, pathlib

root = pathlib.Path(__file__).parent.parent / "src" / "messages"

# Extend existing adminImport namespace with form sub-keys
EXTENSIONS = {
    "en": {
        "adminImport": {
            "accountMapping": {
                "saving": "Saving…",
                "save": "Save Mapping",
                "externalCodeLabel": "External account code",
                "externalCodePlaceholder": "e.g. 4100, Rent Income, etc.",
                "internalCategoryLabel": "Internal category",
                "selectCategory": "Select category…",
                "isIncome": "Is income",
                "affectsNetProfit": "Affects net profit",
                "savedOk": "Mapping saved successfully"
            },
            "propertyMapping": {
                "saving": "Saving…",
                "save": "Save Mapping",
                "externalNameLabel": "External name (in CSV)",
                "externalNamePlaceholder": "e.g. Casa Palermo A",
                "internalPropertyLabel": "Internal property",
                "selectProperty": "Select property…",
                "savedOk": "Mapping saved successfully"
            },
            "phantomRooms": {
                "saving": "Saving…",
                "mapped": "Mapped",
                "ignored": "Ignored",
                "savedOk": "Saved successfully",
                "mapAction": "Map",
                "ignoreAction": "Ignore",
                "selectUnit": "Select target unit…",
                "saveMapping": "Save Mapping",
                "saveIgnore": "Ignore"
            }
        }
    },
    "es": {
        "adminImport": {
            "accountMapping": {
                "saving": "Guardando...",
                "save": "Guardar mapeo",
                "externalCodeLabel": "Código de cuenta externo",
                "externalCodePlaceholder": "Ej: 4100, Rent Income, etc.",
                "internalCategoryLabel": "Categoría interna",
                "selectCategory": "Seleccionar categoría…",
                "isIncome": "Es ingreso",
                "affectsNetProfit": "Afecta ganancia neta",
                "savedOk": "Mapeo guardado correctamente"
            },
            "propertyMapping": {
                "saving": "Guardando...",
                "save": "Guardar mapeo",
                "externalNameLabel": "Nombre externo (en CSV)",
                "externalNamePlaceholder": "Ej: Casa Palermo A",
                "internalPropertyLabel": "Propiedad interna",
                "selectProperty": "Seleccionar propiedad…",
                "savedOk": "Mapeo guardado correctamente"
            },
            "phantomRooms": {
                "saving": "Guardando...",
                "mapped": "Mapeado",
                "ignored": "Ignorado",
                "savedOk": "Guardado correctamente",
                "mapAction": "Mapear",
                "ignoreAction": "Ignorar",
                "selectUnit": "Seleccionar unidad…",
                "saveMapping": "Guardar mapeo",
                "saveIgnore": "Ignorar"
            }
        }
    },
    "pt": {
        "adminImport": {
            "accountMapping": {
                "saving": "Salvando...",
                "save": "Salvar mapeamento",
                "externalCodeLabel": "Código de conta externo",
                "externalCodePlaceholder": "Ex.: 4100, Rent Income, etc.",
                "internalCategoryLabel": "Categoria interna",
                "selectCategory": "Selecionar categoria…",
                "isIncome": "É receita",
                "affectsNetProfit": "Afeta lucro líquido",
                "savedOk": "Mapeamento salvo com sucesso"
            },
            "propertyMapping": {
                "saving": "Salvando...",
                "save": "Salvar mapeamento",
                "externalNameLabel": "Nome externo (no CSV)",
                "externalNamePlaceholder": "Ex.: Casa Palermo A",
                "internalPropertyLabel": "Propriedade interna",
                "selectProperty": "Selecionar propriedade…",
                "savedOk": "Mapeamento salvo com sucesso"
            },
            "phantomRooms": {
                "saving": "Salvando...",
                "mapped": "Mapeado",
                "ignored": "Ignorado",
                "savedOk": "Salvo com sucesso",
                "mapAction": "Mapear",
                "ignoreAction": "Ignorar",
                "selectUnit": "Selecionar unidade…",
                "saveMapping": "Salvar mapeamento",
                "saveIgnore": "Ignorar"
            }
        }
    }
}

for lang in ["en", "es", "pt"]:
    path = root / f"{lang}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    ext = EXTENSIONS[lang]
    for ns, sub in ext.items():
        if ns not in data:
            data[ns] = {}
        for subkey, subval in sub.items():
            if subkey not in data[ns]:
                data[ns][subkey] = {}
            if isinstance(subval, dict):
                data[ns][subkey].update(subval)
            else:
                data[ns][subkey] = subval
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Updated {lang}.json")

print("Done.")
